import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { noRaycast, seeded } from '../landform'
import { CellMesh } from './mesh'
import { SIGN, type Cell } from './signs'
import type { Buildings } from './buildings'
import { CORNER, FRONT, MAIN, ROAD, SIDES, SIDE_ROAD, Street, streetY } from './site'

/**
 * The street's infrastructure: cast-iron lamp posts along the main street's
 * pavements and lanterns on brackets down the narrow side streets; concrete
 * utility poles with their power and telephone lines sagging from pole to pole
 * and service wires looping across to the houses; traffic signs, the blue
 * street plaques on the corner houses; gutter grates and manhole covers; iron
 * bollards round the kerb corners. Everything repeated is instanced; the wires
 * are thin three-sided tubes kept at least ~0.8 px wide (see wireMaterial) so
 * they read as lines at any distance instead of breaking into dashes.
 */

const lin = (hex: string) => new THREE.Color(hex)

export interface InfraMaterials {
  iron: THREE.Material
  /** the lanterns' glass: its emissive is what the Street lamps group switches */
  lampGlass: THREE.MeshStandardMaterial
  /** concrete poles, crossarms, transformers (vertex coloured) */
  pole: THREE.Material
  wire: THREE.Material
  /** the sign atlas on plates */
  signs: THREE.Material
  /** the sign atlas lying on the road (grates, manholes) */
  decals: THREE.Material
}

// ─── placement helpers ───────────────────────────────────────────────────
/**
 * A main-street pole that would stand just ahead of the car's spot goes on up the street a little:
 * right there it stood in the middle of the opening view, between the car and the vanishing point.
 */
const keepClear = (s: number) => (s > -5 && s < 26 ? 30 : s)

/** the main street's junction mouths on one side (arc lengths), kept clear of posts */
function inMouth(s: number, side: 1 | -1, margin = 1): boolean {
  const half = SIDE_ROAD.width / 2 + CORNER + margin
  return SIDES.some((j) => j.side === side && Math.abs(s - j.at) < half)
}

const Y_UP = new THREE.Vector3(0, 1, 0)
/** an instance's matrix: at p, turned so local +z points along (dx, dz) */
function place(p: THREE.Vector3, dx: number, dz: number, scale = 1): THREE.Matrix4 {
  const q = new THREE.Quaternion().setFromAxisAngle(Y_UP, Math.atan2(dx, dz))
  return new THREE.Matrix4().compose(p, q, new THREE.Vector3(scale, scale, scale))
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], name: string, cast = true): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length))
  matrices.forEach((m, i) => mesh.setMatrixAt(i, m))
  mesh.count = matrices.length
  mesh.castShadow = cast
  mesh.receiveShadow = true
  mesh.name = name
  mesh.computeBoundingSphere()
  return mesh
}

// ─── geometry ────────────────────────────────────────────────────────────
/** a cast-iron lamp post: moulded base, fluted-looking tapered shaft, a hexagonal lantern on top */
function lampPost(): { iron: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const profile = [
    [0, 0], [0.21, 0], [0.21, 0.08], [0.17, 0.13], [0.16, 0.42], [0.12, 0.52], [0.1, 0.6], [0.08, 0.72],
    [0.07, 1.2], [0.085, 1.24], [0.065, 1.3], [0.052, 3.3], [0.08, 3.36], [0.08, 3.42], [0.05, 3.5], [0.05, 3.66], [0.12, 3.72], [0.12, 3.76], [0, 3.77],
  ].map(([r, y]) => new THREE.Vector2(r, y))
  const parts: THREE.BufferGeometry[] = [
    new THREE.LatheGeometry(profile, 10),
    // the lantern's floor ring, roof and finial
    new THREE.CylinderGeometry(0.16, 0.13, 0.06, 6).translate(0, 3.8, 0),
    new THREE.ConeGeometry(0.3, 0.26, 6).translate(0, 4.43, 0),
    new THREE.CylinderGeometry(0.03, 0.05, 0.14, 6).translate(0, 4.62, 0),
    new THREE.SphereGeometry(0.045, 8, 6).translate(0, 4.72, 0),
  ]
  // the lantern's corner bars
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2
    const bar = new THREE.BoxGeometry(0.018, 0.56, 0.018)
    bar.rotateZ(0.12).rotateY(-a).translate(Math.cos(a) * 0.17, 4.07, Math.sin(a) * 0.17)
    parts.push(bar)
  }
  const glass = new THREE.CylinderGeometry(0.2, 0.13, 0.55, 6).translate(0, 4.07, 0)
  return { iron: merged(parts), glass }
}

/** a lantern on a wall bracket: an iron arm with a scroll under it, the lantern hanging off its end (local +z out of the wall) */
function wallLantern(): { iron: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(0.16, 0.22, 0.04).translate(0, 0, 0.02),
    new THREE.BoxGeometry(0.03, 0.03, 0.62).translate(0, 0.05, 0.33),
    new THREE.TorusGeometry(0.16, 0.012, 4, 12, Math.PI).rotateY(Math.PI / 2).translate(0, -0.1, 0.2),
    new THREE.CylinderGeometry(0.012, 0.012, 0.14, 4).translate(0, -0.04, 0.6),
    new THREE.ConeGeometry(0.2, 0.18, 6).translate(0, -0.2, 0.6),
    new THREE.CylinderGeometry(0.1, 0.09, 0.04, 6).translate(0, -0.66, 0.6),
  ]
  const glass = new THREE.CylinderGeometry(0.14, 0.09, 0.38, 6).translate(0, -0.46, 0.6)
  return { iron: merged(parts), glass }
}

/** paint a part for a vertex-coloured material */
export function colour(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const n = g.getAttribute('position').count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3)
  g.setAttribute('color', new THREE.BufferAttribute(a, 3))
  return g
}

/** a concrete utility pole (local x across the street, +x toward the road): crossarm, insulators, telephone bracket */
function utilityPole(): THREE.BufferGeometry {
  const concrete = lin('#a19c92')
  const steel = lin('#5f5e5a')
  const ceramic = lin('#dcd8cc')
  const parts: THREE.BufferGeometry[] = [
    colour(new THREE.CylinderGeometry(0.11, 0.17, 10.5, 8).translate(0, 4.75, 0), concrete),
    colour(new THREE.BoxGeometry(2.0, 0.1, 0.1).translate(0, 9.2, 0), steel),
    colour(new THREE.BoxGeometry(0.05, 0.7, 0.05).rotateZ(0.9).translate(-0.35, 8.95, 0), steel),
    colour(new THREE.BoxGeometry(0.05, 0.7, 0.05).rotateZ(-0.9).translate(0.35, 8.95, 0), steel),
    colour(new THREE.BoxGeometry(0.34, 0.08, 0.12).translate(0.12, 7.2, 0), steel),
  ]
  for (const x of [-0.85, 0, 0.85]) parts.push(colour(new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6).translate(x, 9.33, 0), ceramic))
  return merged(parts)
}

/** a pole-top transformer: a grey drum on a bracket */
function transformer(): THREE.BufferGeometry {
  const grey = lin('#8d8f8c')
  return merged([colour(new THREE.CylinderGeometry(0.28, 0.28, 0.85, 12).translate(-0.42, 7.9, 0), grey), colour(new THREE.BoxGeometry(0.3, 0.08, 0.1).translate(-0.2, 7.6, 0), grey)])
}

/** a cast-iron bollard: a short fluted post with a ball on top */
function bollard(): THREE.BufferGeometry {
  const profile = [[0, 0], [0.13, 0], [0.13, 0.06], [0.1, 0.1], [0.09, 0.62], [0.11, 0.66], [0.11, 0.7], [0.06, 0.74]].map(([r, y]) => new THREE.Vector2(r, y))
  return merged([new THREE.LatheGeometry(profile, 10), new THREE.SphereGeometry(0.075, 10, 6).translate(0, 0.8, 0)])
}

export function merged(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const hasColor = parts.some((p) => p.getAttribute('color'))
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p.clone()
    if (!hasColor) g.deleteAttribute('color')
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name)
    return g
  })
  const out = mergeGeometries(clean)!
  for (const p of parts) p.dispose()
  return out
}

// ─── wires ───────────────────────────────────────────────────────────────
/**
 * Wires as three-sided tubes. Each vertex carries its tube's centre, so the
 * shader can widen a wire to a minimum on-screen width (~0.8 px): at their
 * true 1–2 cm, wires more than a few tens of metres off fell between pixels
 * and broke into crawling dashes.
 */
export class Wires {
  private position: number[] = []
  private centre: number[] = []
  private normal: number[] = []
  private index: number[] = []

  /** a sagging span from a to b (`sag` m at mid-span), radius r */
  span(a: THREE.Vector3, b: THREE.Vector3, sag: number, r: number, steps = 14): void {
    const pts: THREE.Vector3[] = []
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t)))
    }
    const base = this.position.length / 3
    const n = new THREE.Vector3()
    const side = new THREE.Vector3()
    const up = new THREE.Vector3()
    pts.forEach((p, i) => {
      const next = pts[Math.min(i + 1, pts.length - 1)]
      const prev = pts[Math.max(i - 1, 0)]
      const t = next.clone().sub(prev).normalize()
      side.set(-t.z, 0, t.x).normalize()
      up.crossVectors(side, t).normalize()
      for (let k = 0; k < 3; k++) {
        const ang = (k / 3) * Math.PI * 2
        n.copy(side).multiplyScalar(Math.cos(ang)).addScaledVector(up, Math.sin(ang))
        this.position.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r)
        this.centre.push(p.x, p.y, p.z)
        this.normal.push(n.x, n.y, n.z)
      }
    })
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < 3; k++) {
        const a0 = base + i * 3 + k
        const a1 = base + i * 3 + ((k + 1) % 3)
        const b0 = a0 + 3
        const b1 = a1 + 3
        this.index.push(a0, b0, b1, a0, b1, a1)
      }
    }
  }

  build(material: THREE.Material): THREE.Mesh {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('centre', new THREE.Float32BufferAttribute(this.centre, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setIndex(this.index)
    g.computeBoundingSphere()
    const mesh = noRaycast(new THREE.Mesh(g, material))
    mesh.name = 'wires'
    // (no shadows: a 1–2 cm wire is about one texel of the sun's map and its shadow came out as dotted lines on the road)
    mesh.castShadow = false
    mesh.receiveShadow = true
    return mesh
  }
}

/** the wires' material: dark, and never thinner on screen than ~0.8 px (a perspective view's pixel size per metre of depth) */
export function wireMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: lin('#161616'), roughness: 0.6, metalness: 0.2 })
  const pixel = { value: 0 }
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPixel = pixel
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 centre;\nuniform float uPixel;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      {
        vec3 off = position - centre;
        float r = length( off );
        float depth = -( modelViewMatrix * vec4( centre, 1.0 ) ).z;
        float minR = 0.4 * uPixel * depth;
        transformed = centre + off * max( 1.0, minR / max( r, 1e-4 ) );
      }`,
    )
  }
  material.customProgramCacheKey = () => 'street-wires'
  material.userData.pixel = pixel
  return material
}

/** keep the wire material's pixel size up to date for the camera drawing it (0 for shadow maps: true width) */
export function trackPixel(mesh: THREE.Mesh): void {
  const pixel = (mesh.material as THREE.Material).userData.pixel as { value: number }
  const size = new THREE.Vector2()
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const cam = camera as THREE.PerspectiveCamera
    if (!cam.isPerspectiveCamera) {
      pixel.value = 0
      return
    }
    renderer.getDrawingBufferSize(size)
    const target = renderer.getRenderTarget()
    const height = target ? target.height : size.y
    pixel.value = (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2)) / (cam.zoom * Math.max(1, height))
  }
}

// ─── signs ───────────────────────────────────────────────────────────────
/** a flat plate in the sign mesh: `cell`'s picture on the front, the grey back behind */
function plate(mesh: CellMesh, centre: THREE.Vector3, facing: THREE.Vector3, w: number, h: number, cell: Cell): void {
  const right = new THREE.Vector3(facing.z, 0, -facing.x).normalize()
  const corner = (sx: number, sy: number, push: number) => centre.clone().addScaledVector(right, (sx * w) / 2).add(new THREE.Vector3(0, (sy * h) / 2, 0)).addScaledVector(facing, push)
  const [u0, v0, u1, v1] = cell
  // (seen from the front, `right` is the viewer's right: the picture's u runs along it)
  mesh.facing(corner(-1, -1, 0.004), corner(1, -1, 0.004), corner(1, 1, 0.004), corner(-1, 1, 0.004), facing, undefined, [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ])
  const [b0, c0, b1, c1] = SIGN.back
  mesh.facing(corner(-1, -1, -0.004), corner(1, -1, -0.004), corner(1, 1, -0.004), corner(-1, 1, -0.004), facing.clone().negate(), undefined, [
    [b0, c0],
    [b1, c0],
    [b1, c1],
    [b0, c1],
  ])
}

/** a decal lying on the road: `cell` over a w × l rectangle along `along` */
function decal(mesh: CellMesh, centre: THREE.Vector3, along: THREE.Vector3, w: number, l: number, cell: Cell): void {
  const right = new THREE.Vector3(along.z, 0, -along.x).normalize()
  const at = (sx: number, sz: number) => {
    const p = centre.clone().addScaledVector(right, (sx * w) / 2).addScaledVector(along, (sz * l) / 2)
    return p.setY(streetY(p.x, p.z) + 0.004)
  }
  const [u0, v0, u1, v1] = cell
  mesh.facing(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), Y_UP, undefined, [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ])
}

export interface Infrastructure {
  group: THREE.Group
}

/** the lamps, poles, wires, signs, drains and bollards */
export function createInfrastructure(buildings: Buildings, materials: InfraMaterials): Infrastructure {
  const group = new THREE.Group()
  group.name = 'street-infrastructure'
  const rand = seeded(313)
  const at3 = (street: Street, s: number, d: number, lift = 0) => {
    const p = street.at(s, d)
    return new THREE.Vector3(p.x, streetY(p.x, p.y) + lift, p.y)
  }

  // ─── lamp posts along the main street, lanterns on the side streets' walls ─
  const posts: THREE.Matrix4[] = []
  for (const side of [1, -1] as const) {
    const phase = side === 1 ? 8 : 22
    for (let s = Math.ceil((MAIN.start + 20 - phase) / 28) * 28 + phase; s < MAIN.end - 30; s += 28) {
      if (inMouth(s, side)) continue
      const f = MAIN.frame(s)
      posts.push(place(at3(MAIN, s, side * (ROAD.width / 2 + 0.45), ROAD.curb), f.tx, f.tz))
    }
  }
  const lanterns: THREE.Matrix4[] = []
  for (const j of SIDES) {
    let side: 1 | -1 = 1
    for (let s = FRONT + 16; s < j.houses - 4; s += 22) {
      const front = j.street.width / 2 + j.street.sidewalk
      const f = j.street.frame(s)
      // out of the wall toward the street: −side × the street's side vector
      lanterns.push(place(at3(j.street, s, side * (front - 0.01), ROAD.curb + 3.9), -side * f.tz, side * f.tx))
      side = -side as 1 | -1
    }
  }
  const lamp = lampPost()
  const wall = wallLantern()
  group.add(
    instanced(lamp.iron, materials.iron, posts, 'lamp posts'),
    instanced(lamp.glass, materials.lampGlass, posts, 'lamp glass', false),
    instanced(wall.iron, materials.iron, lanterns, 'wall lanterns'),
    instanced(wall.glass, materials.lampGlass, lanterns, 'wall lantern glass', false),
  )

  // ─── utility poles and their lines ───────────────────────────────────
  interface Pole { street: Street; s: number; base: THREE.Vector3; across: THREE.Vector3; along: THREE.Vector3; drops: number }
  const poles: Pole[] = []
  const addPoles = (street: Street, side: 1 | -1, from: number, to: number, step: number, skip: (s: number) => boolean) => {
    for (let s0 = from; s0 < to; s0 += step) {
      if (skip(s0)) continue
      const s = street === MAIN ? keepClear(s0) : s0
      const f = street.frame(s)
      const d = side * (street.width / 2 + 0.35)
      // (local +x toward the road: −side × the side vector)
      poles.push({ street, s, base: at3(street, s, d, ROAD.curb), across: new THREE.Vector3(-side * f.tz, 0, side * f.tx), along: new THREE.Vector3(f.tx, 0, f.tz), drops: 0 })
    }
  }
  addPoles(MAIN, -1, Math.ceil((MAIN.start + 12 - 16) / 36) * 36 + 16, MAIN.end - 20, 36, (s) => inMouth(s, -1, 2))
  for (const j of SIDES) addPoles(j.street, 1, FRONT + 20, j.houses, 32, () => false)
  const poleMatrices = poles.map((p) => new THREE.Matrix4().compose(p.base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), p.across), new THREE.Vector3(1, 1, 1)))
  const transformers = poleMatrices.filter((_, i) => i % 4 === 1)
  group.add(
    instanced(utilityPole(), materials.pole, poleMatrices, 'utility poles'),
    instanced(transformer(), materials.pole, transformers, 'transformers'),
  )

  const wires = new Wires()
  const onPole = (p: Pole, x: number, y: number) => p.base.clone().addScaledVector(p.across, x).setY(p.base.y + y)
  // pole to pole along each street: three power lines on the crossarm, two telephone lines lower down
  const byStreet = new Map<Street, Pole[]>()
  for (const p of poles) byStreet.set(p.street, [...(byStreet.get(p.street) ?? []), p])
  for (const list of byStreet.values()) {
    list.sort((p, q) => p.s - q.s)
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]
      const b = list[i + 1]
      if (b.s - a.s > 50) continue // (a junction between them: the lines go round the corner out of sight)
      for (const x of [-0.85, 0, 0.85]) wires.span(onPole(a, x, 9.42), onPole(b, x, 9.42), 0.6, 0.011)
      for (const x of [0.22, 0.3]) wires.span(onPole(a, x, 7.24), onPole(b, x, 7.24), 0.45, 0.008)
    }
  }
  // service wires: from the nearest pole on the house's street, across the road when the house is opposite
  for (const drop of buildings.drops) {
    const list = byStreet.get(drop.street)
    if (!list) continue
    let best: Pole | null = null
    for (const p of list) if (Math.abs(p.s - drop.s) < 26 && p.drops < 7 && (!best || Math.abs(p.s - drop.s) < Math.abs(best.s - drop.s))) best = p
    if (!best) continue
    best.drops++
    wires.span(onPole(best, 0.3, 7.24), drop.p, 0.25 + rand() * 0.2, 0.007, 10)
  }
  const wireMesh = wires.build(materials.wire)
  trackPixel(wireMesh)
  group.add(wireMesh)

  // ─── signs: traffic signs on posts, street plaques on the corner houses ─
  const signMesh = new CellMesh(80)
  const signPosts: THREE.Matrix4[] = []
  const signAt = (street: Street, s: number, d: number, facing: THREE.Vector3, cell: Cell, size = 0.6) => {
    const base = at3(street, s, d, ROAD.curb)
    signPosts.push(new THREE.Matrix4().makeTranslation(base.x, base.y, base.z))
    // (the plate on the post's face, not through it)
    plate(signMesh, base.clone().setY(base.y + 2.45).addScaledVector(facing, 0.045), facing, size, size, cell)
  }
  const alongMain = (s: number, dir: 1 | -1) => {
    const f = MAIN.frame(s)
    return new THREE.Vector3(f.tx * dir, 0, f.tz * dir)
  }
  // a stop sign where each side street meets the main street, facing its traffic
  for (const j of SIDES) {
    const f = j.street.frame(FRONT + 2)
    signAt(j.street, FRONT + 2, -(j.street.width / 2 + 0.35), new THREE.Vector3(f.tx, 0, f.tz), SIGN.stop)
  }
  // up the main street: the speed limit facing the way up, parking, a crossing, no parking by the corners
  signAt(MAIN, 34, -(ROAD.width / 2 + 0.4), alongMain(34, -1), SIGN.speed)
  signAt(MAIN, 118, ROAD.width / 2 + 0.4, alongMain(118, -1), SIGN.parking)
  signAt(MAIN, 58, ROAD.width / 2 + 0.4, alongMain(58, -1), SIGN.crossing)
  signAt(MAIN, -40, -(ROAD.width / 2 + 0.4), alongMain(-40, 1), SIGN.noParking)
  signAt(MAIN, 190, -(ROAD.width / 2 + 0.4), alongMain(190, -1), SIGN.yield)
  // one-way arrows on the side streets
  for (const j of SIDES.slice(1)) {
    const f = j.street.frame(FRONT + 6)
    signAt(j.street, FRONT + 6, j.street.width / 2 + 0.35, new THREE.Vector3(-f.tx, 0, -f.tz), SIGN.oneWay, 0.55)
  }
  // plaques high on the corner houses, on both streets' fronts
  SIDES.forEach((j, i) => {
    const cell = i % 2 ? SIGN.plaque2 : SIGN.plaque
    const c = SIDE_ROAD.width / 2 + SIDE_ROAD.sidewalk
    for (const which of [-1, 1]) {
      const s = j.at + which * (c + 0.9)
      const f = MAIN.frame(s)
      const p = at3(MAIN, s, j.side * (FRONT - 0.02), ROAD.curb + 3.3)
      plate(signMesh, p, new THREE.Vector3(-j.side * f.tz, 0, j.side * f.tx), 0.7, 0.35, cell)
    }
  })
  // hazard plates on the transformer poles
  poles.forEach((p, i) => {
    if (i % 4 !== 1) return
    plate(signMesh, onPole(p, 0.19, 2.6), p.across, 0.28, 0.28, SIGN.hazard)
  })
  const signPost = new THREE.CylinderGeometry(0.035, 0.035, 2.8, 8).translate(0, 1.2, 0)
  group.add(instanced(signPost, materials.iron, signPosts, 'sign posts'))
  for (const m of signMesh.build(materials.signs, 'signs', { uv: 'stored' })) {
    m.castShadow = true
    m.receiveShadow = true
    group.add(m)
  }

  // ─── drains: gutter grates along the kerbs, manholes in the road ─────
  const decals = new CellMesh(80)
  for (const side of [1, -1] as const) {
    for (let s = MAIN.start + 15 + (side === 1 ? 0 : 11); s < MAIN.end - 10; s += 23 + rand() * 6) {
      if (inMouth(s, side, 0)) continue
      const f = MAIN.frame(s)
      decal(decals, at3(MAIN, s, side * (ROAD.width / 2 - 0.22)), new THREE.Vector3(f.tx, 0, f.tz), 0.36, 0.9, SIGN.grate)
    }
  }
  for (const j of SIDES) {
    for (let s = FRONT + 10; s < j.street.end - 5; s += 26) {
      const f = j.street.frame(s)
      decal(decals, at3(j.street, s, j.street.width / 2 - 0.2), new THREE.Vector3(f.tx, 0, f.tz), 0.34, 0.8, SIGN.grate)
    }
  }
  // (one just ahead and left of the car's spot, as a real street always has somewhere)
  const manholes: [number, number][] = [[7, 1.5]]
  for (let s = MAIN.start + 30; s < MAIN.end - 20; s += 38 + rand() * 12) if (Math.abs(s - 7) > 20) manholes.push([s, (rand() < 0.5 ? -1 : 1) * (0.6 + rand() * 1.2)])
  for (const [s, d] of manholes) {
    const f = MAIN.frame(s)
    decal(decals, at3(MAIN, s, d), new THREE.Vector3(f.tx, 0, f.tz), 0.75, 0.75, SIGN.manhole)
  }
  for (const m of decals.build(materials.decals, 'drains', { uv: 'stored' })) {
    m.receiveShadow = true
    group.add(noRaycast(m))
  }

  // ─── bollards round the kerb corners ──────────────────────────────────
  const bollards: THREE.Matrix4[] = []
  for (const j of SIDES) {
    const f = MAIN.frame(j.at)
    const nx = f.tz * j.side
    const nz = -f.tx * j.side
    const hw = SIDE_ROAD.width / 2
    const kerb = ROAD.width / 2
    for (const which of [-1, 1]) {
      for (const t of [0.35, 0.8, 1.25]) {
        // on the corner's arc, 0.35 m in from the kerb (the arc's centre is (hw + r, kerb + r) in the junction's frame)
        const r = CORNER - 0.35
        const u = (hw + CORNER - r * Math.sin(t)) * which
        const v = kerb + CORNER - r * Math.cos(t)
        const x = f.x + f.tx * u + nx * v
        const z = f.z + f.tz * u + nz * v
        bollards.push(new THREE.Matrix4().makeTranslation(x, streetY(x, z) + ROAD.curb, z))
      }
    }
  }
  group.add(instanced(bollard(), materials.iron, bollards, 'bollards'))

  return { group }
}
