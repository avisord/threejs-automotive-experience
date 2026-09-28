import * as THREE from 'three'
import { CellMesh } from './mesh'
import { CORNER, FRONT, MAIN, ROAD, SIDES, SIDE_ROAD, Street, streetY } from './site'

/**
 * The paved surfaces: each street's carriageway as a ribbon (running on under
 * its pavements), the pavements raised a kerb's height on it, the kerb faces,
 * and the rounded kerb corners where the side streets leave the main street.
 * Every point lies on `streetY` (site.ts), so the pieces meet without steps.
 */

/** how far the carriageway ribbon runs on under the pavements and the house fronts */
const TUCK = 0.6
/** pavements run this far in under the house walls */
const WALL_TUCK = 0.3

const v3 = (p: THREE.Vector2, y: number) => new THREE.Vector3(p.x, y, p.y)

/** a quad, its winding picked so it faces `dir` */
function facing(mesh: CellMesh, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, dir: THREE.Vector3): void {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
  if (n.dot(dir) >= 0) mesh.quad(a, b, c, d)
  else mesh.quad(a, d, c, b)
}
const UP = new THREE.Vector3(0, 1, 0)

/** arc lengths from a to b, about every `step` m, both ends included */
function stations(a: number, b: number, step = 1): number[] {
  const n = Math.max(1, Math.ceil((b - a) / step))
  return Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n)
}

/**
 * A carriageway: the street's ribbon from `from` to its end, wide enough to run under the pavements.
 * `overlap`: it starts this far back, sunk a centimetre under whatever it runs in beneath (a side
 * street's ribbon meeting the main street's edge edge-to-edge left a hairline crack onto the ground).
 */
function carriageway(mesh: CellMesh, street: Street, from: number, overlap = 0): void {
  const e = street.width / 2 + street.sidewalk + TUCK
  const across = [-e, -street.width / 2, 0, street.width / 2, e]
  const rows = [...(overlap ? [from - overlap] : []), ...stations(from, street.end)].map((s, i) => across.map((d) => {
    const p = street.at(s, d)
    return v3(p, streetY(p.x, p.y) - (overlap && i === 0 ? 0.01 : 0))
  }))
  for (let i = 0; i + 1 < rows.length; i++) {
    for (let j = 0; j + 1 < across.length; j++) facing(mesh, rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1], UP)
  }
}

/**
 * A straight run of pavement along a street, on one side (`side`), from `a` to `b`:
 * its top, the kerb face toward the road and a skirt along the house side (seen
 * in an alley's mouth).
 */
function pavement(top: CellMesh, kerb: CellMesh, street: Street, side: 1 | -1, a: number, b: number): void {
  const inner = street.width / 2
  const outer = inner + street.sidewalk + WALL_TUCK
  const lift = ROAD.curb
  let last: { i: THREE.Vector3; o: THREE.Vector3; ig: THREE.Vector3; og: THREE.Vector3 } | null = null
  for (const s of stations(a, b)) {
    const pi = street.at(s, side * inner)
    const po = street.at(s, side * outer)
    const gi = streetY(pi.x, pi.y)
    const go = streetY(po.x, po.y)
    const row = { i: v3(pi, gi + lift), o: v3(po, go + lift), ig: v3(pi, gi - 0.02), og: v3(po, go - 0.5) }
    if (last) {
      facing(top, last.i, row.i, row.o, last.o, UP)
      // the kerb faces the road (toward the centre line), the skirt faces away
      const toRoad = new THREE.Vector3(last.ig.x - last.og.x, 0, last.ig.z - last.og.z)
      facing(kerb, last.ig, row.ig, row.i, last.i, toRoad)
      facing(kerb, last.og, row.og, row.o, last.o, toRoad.clone().negate())
    }
    last = row
  }
}

/**
 * The pavement round one corner of a junction, in the junction's own frame:
 * u along the main street (−1: the corner before the side street, +1: after),
 * v out from the main street's centre toward the side street. The kerb sweeps
 * round from the main street's kerb line into the side street's on a
 * `CORNER` radius; the pavement runs back to both house lines.
 */
function corner(top: CellMesh, kerb: CellMesh, at: number, side: 1 | -1, which: 1 | -1): void {
  const f = MAIN.frame(at)
  const nx = f.tz * side
  const nz = -f.tx * side
  const world = (u: number, v: number) => new THREE.Vector2(f.x + f.tx * u * which + nx * v, f.z + f.tz * u * which + nz * v)
  const hw = SIDE_ROAD.width / 2
  const c = hw + SIDE_ROAD.sidewalk + WALL_TUCK
  const kerbV = ROAD.width / 2
  const r = CORNER
  const outerV = FRONT + WALL_TUCK
  // the kerb arc, from the main street's kerb round into the side street's
  const arc: THREE.Vector2[] = []
  const segments = 10
  for (let i = 0; i <= segments; i++) {
    // centred on (hw + r, kerbV + r): from (hw + r, kerbV) on the main street's kerb to (hw, kerbV + r) on the side street's
    const t = (i / segments) * (Math.PI / 2)
    arc.push(new THREE.Vector2(hw + r - r * Math.sin(t), kerbV + r - r * Math.cos(t)))
  }
  // the outline (u ≥ 0 here; `which` mirrors it): arc, across the side street's pavement, down its house
  // line to the house corner, along the main street's house line, back to the arc's start
  const outline = [...arc, new THREE.Vector2(c, kerbV + r), new THREE.Vector2(c, outerV), new THREE.Vector2(hw + r, outerV)]
  const shape = new THREE.Shape(outline)
  const g = new THREE.ShapeGeometry(shape)
  const pos = g.getAttribute('position')
  const index = g.getIndex()!
  const pts: THREE.Vector3[] = []
  for (let i = 0; i < pos.count; i++) {
    const p = world(pos.getX(i), pos.getY(i))
    pts.push(v3(p, streetY(p.x, p.y) + ROAD.curb))
  }
  for (let i = 0; i < index.count; i += 3) {
    const a = pts[index.getX(i)]
    const b = pts[index.getX(i + 1)]
    const cc = pts[index.getX(i + 2)]
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(cc, a))
    if (n.y >= 0) top.tri(a, b, cc)
    else top.tri(a, cc, b)
  }
  g.dispose()
  // the kerb face round the arc, facing out of the corner (toward the arc's centre is the pavement)
  for (let i = 0; i + 1 < arc.length; i++) {
    const p0 = world(arc[i].x, arc[i].y)
    const p1 = world(arc[i + 1].x, arc[i + 1].y)
    const y0 = streetY(p0.x, p0.y)
    const y1 = streetY(p1.x, p1.y)
    const centre = world(hw + r, kerbV + r)
    const mid = p0.clone().add(p1).multiplyScalar(0.5)
    const out = new THREE.Vector3(mid.x - centre.x, 0, mid.y - centre.y)
    facing(kerb, v3(p0, y0 - 0.02), v3(p1, y1 - 0.02), v3(p1, y1 + ROAD.curb), v3(p0, y0 + ROAD.curb), out)
  }
}

export interface Paving {
  road: THREE.Mesh[]
  pavement: THREE.Mesh[]
  kerb: THREE.Mesh[]
}

/** every street's carriageway, pavements, kerbs and junction corners */
export function createPaving(materials: { road: THREE.Material; pavement: THREE.Material; kerb: THREE.Material }): Paving {
  const road = new CellMesh()
  const top = new CellMesh()
  const kerb = new CellMesh()

  carriageway(road, MAIN, MAIN.start)
  // (a side street's ribbon starts where the main street's ends, at its outer edge)
  for (const side of SIDES) carriageway(road, side.street, FRONT + TUCK, 0.5)

  // the main street's pavements, broken at each side street's mouth for the corners
  const mouth = SIDE_ROAD.width / 2 + CORNER
  for (const s of [1, -1] as const) {
    const cuts = SIDES.filter((j) => j.side === s).map((j) => [j.at - mouth, j.at + mouth]).sort((p, q) => p[0] - q[0])
    let from = MAIN.start
    for (const [a, b] of cuts) {
      pavement(top, kerb, MAIN, s, from, a)
      from = b
    }
    pavement(top, kerb, MAIN, s, from, MAIN.end)
  }
  for (const j of SIDES) {
    corner(top, kerb, j.at, j.side, 1)
    corner(top, kerb, j.at, j.side, -1)
    // the side street's own pavements, from the corners out
    const from = ROAD.width / 2 + CORNER
    pavement(top, kerb, j.street, 1, from, j.street.end)
    pavement(top, kerb, j.street, -1, from, j.street.end)
  }

  const setUp = (meshes: THREE.Mesh[]) => {
    for (const m of meshes) m.receiveShadow = true
    return meshes
  }
  return {
    road: setUp(road.build(materials.road, 'road', { uv: true })),
    pavement: setUp(top.build(materials.pavement, 'pavement', { uv: true })),
    kerb: setUp(kerb.build(materials.kerb, 'kerb', { uv: true })),
  }
}
