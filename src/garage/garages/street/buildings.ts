import * as THREE from 'three'
import { seeded } from '../landform'
import { CellMesh } from './mesh'
import { buildFacade, gardenFront, type FacadeMeshes } from './facade'
import { UPPER, endLots, planLots, type Lot } from './lots'
import { CHURCH, FRONT, MAIN, ROAD, SIDES, SIDE_ROAD, streetY } from './site'

/**
 * The town's houses: each lot a block standing on the valley floor, its front
 * on the building line, its roofline at its storeys plus a parapet or under a
 * tiled roof, the paint a little faded house to house. Neighbouring lots share
 * their corners along the street, so the street wall is continuous round the
 * bends. The street front — and a corner house's side on the side street — is
 * a facade with its openings (facade.ts); party walls and backs stay plain.
 */

const lin = (hex: string) => new THREE.Color(hex) // (THREE.Color parses CSS hex as sRGB → linear)
/** a faded paint: toward a chalky grey-white, as limewash and sun do */
const CHALK = lin('#d9d3c7')
const ROOF_FLAT = lin('#a89a88')
const ROOF_TILE = lin('#9c4a33')

export interface Buildings {
  meshes: THREE.Mesh[]
  /** the houses' service-wire brackets, with the street and side they face */
  drops: { p: THREE.Vector3; street: Lot['street']; side: 1 | -1; s: number }[]
  lots: Lot[]
  /** the church (its own meshes) */
  church: THREE.Group
}

/** a block from four ground corners (front-left, front-right, back-right, back-left, seen from the street) */
function block(mesh: CellMesh, corners: THREE.Vector2[], bottom: number, top: number, colors: { wall: THREE.Color; roof: THREE.Color }, roof: 'flat' | 'tiled' = 'flat', skip: number[] = []): void {
  const lo = corners.map((c) => new THREE.Vector3(c.x, bottom, c.y))
  const hi = corners.map((c) => new THREE.Vector3(c.x, top, c.y))
  const centre = new THREE.Vector3()
  for (const p of lo) centre.add(p)
  centre.divideScalar(4)
  // walls, each facing out from the block's centre
  for (let i = 0; i < 4; i++) {
    if (skip.includes(i)) continue
    const j = (i + 1) % 4
    wall(mesh, lo[i], lo[j], hi[j], hi[i], centre, colors.wall)
  }
  if (roof === 'flat') {
    upQuad(mesh, hi[0], hi[1], hi[2], hi[3], colors.roof)
    return
  }
  // a tiled roof: a ridge along the street, halfway back, at a 22° pitch; gable ends in the wall paint
  const depth = hi[0].distanceTo(hi[3])
  const rise = Math.tan(THREE.MathUtils.degToRad(22)) * depth * 0.5
  const r0 = hi[0].clone().lerp(hi[3], 0.5).setY(top + rise)
  const r1 = hi[1].clone().lerp(hi[2], 0.5).setY(top + rise)
  // (eaves over the walls a little)
  const eave = (p: THREE.Vector3, from: THREE.Vector3) => p.clone().add(p.clone().sub(from).setY(0).setLength(0.35)).setY(top - 0.12)
  const e0 = eave(hi[0], hi[3])
  const e1 = eave(hi[1], hi[2])
  const e2 = eave(hi[2], hi[1])
  const e3 = eave(hi[3], hi[0])
  upQuad(mesh, e0, e1, r1, r0, colors.roof)
  upQuad(mesh, e2, e3, r0, r1, colors.roof)
  wall(mesh, hi[0], hi[3], r0, r0, centre, colors.wall)
  wall(mesh, hi[2], hi[1], r1, r1, centre, colors.wall)
}

/** a wall quad facing away from `centre` */
function wall(mesh: CellMesh, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, centre: THREE.Vector3, color: THREE.Color): void {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
  const out = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5).sub(centre)
  if (n.dot(out) >= 0) mesh.quad(a, b, c, d, color)
  else mesh.quad(a, d, c, b, color)
}

/** a quad facing up */
function upQuad(mesh: CellMesh, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void {
  const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a))
  if (n.y >= 0) mesh.quad(a, b, c, d, color)
  else mesh.quad(a, d, c, b, color)
}

/** does a lot's end at `s` stand on a corner — a side street's mouth or the church's plaza beside it */
function onCorner(lot: Lot, s: number): boolean {
  if (lot.street !== MAIN) return false
  const c = SIDE_ROAD.width / 2 + SIDE_ROAD.sidewalk
  const ends = SIDES.filter((j) => j.side === lot.side).flatMap((j) => [j.at - c, j.at + c])
  if (lot.side === Math.sign(CHURCH.d)) ends.push(CHURCH.s - 26, CHURCH.s + 26)
  return ends.some((e) => Math.abs(e - s) < 0.3)
}

function lotBlock(meshes: FacadeMeshes, lot: Lot, tanks: THREE.Vector3[], drops: Buildings['drops']): void {
  const { street, side } = lot
  const front = street.width / 2 + street.sidewalk + lot.setback
  const back = street.width / 2 + street.sidewalk + Math.max(lot.depth, lot.setback + 8)
  const corners = [street.at(lot.s0, side * front), street.at(lot.s1, side * front), street.at(lot.s1, side * back), street.at(lot.s0, side * back)]
  const ground = corners.map((c) => streetY(c.x, c.y))
  const frontLow = Math.min(ground[0], ground[1])
  const frontHigh = Math.max(ground[0], ground[1])
  const bottom = Math.min(...ground) - 1.5
  const height = lot.family.ground + (lot.storeys - 1) * UPPER + lot.parapet
  const base = frontHigh + ROAD.curb
  const top = base + height
  const rand = seeded(lot.seed)
  const wallColor = lin(lot.wall).lerp(CHALK, lot.fade)
  const dado = lin(lot.base)
  const roof = lot.family.roof === 'tiled' ? ROOF_TILE.clone().multiplyScalar(0.85 + rand() * 0.3) : ROOF_FLAT.clone().multiplyScalar(0.8 + rand() * 0.3)
  // the facades are built with their openings; the block's own walls stand everywhere else
  const cornerStart = onCorner(lot, lot.s0)
  const cornerEnd = onCorner(lot, lot.s1)
  const skip = [0, ...(cornerEnd ? [1] : []), ...(cornerStart ? [3] : [])]
  block(meshes.wall, corners, bottom, top, { wall: wallColor, roof }, lot.family.roof, skip)
  const street0 = street.at((lot.s0 + lot.s1) / 2, 0)
  const centre = corners.reduce((c, p) => c.add(p), new THREE.Vector2()).divideScalar(4)
  const dadoTop = frontLow + ROAD.curb + (lot.family.id === 'stone' ? 0.6 : 0.8 + rand() * 0.4)
  const opts = { base, top, bottom, wall: wallColor, dado, dadoTop }
  const { drop } = buildFacade(meshes, lot, corners[0], corners[1], street0.clone().sub(corners[0]), opts)
  if (drop && lot.setback === 0) drops.push({ p: drop, street, side, s: street.nearest(drop.x, drop.z).s })
  if (cornerEnd) buildFacade(meshes, lot, corners[1], corners[2], corners[1].clone().sub(centre), { ...opts, side: true })
  if (cornerStart) buildFacade(meshes, lot, corners[3], corners[0], corners[0].clone().sub(centre), { ...opts, side: true })
  // a water tank on a good share of the flat roofs, toward the back
  if (lot.family.roof === 'flat' && rand() < 0.4) {
    const p = corners[2].clone().lerp(corners[3], 0.2 + rand() * 0.6).lerp(centre, 0.35)
    tanks.push(new THREE.Vector3(p.x, top - lot.parapet, p.y))
  }
  // a front garden: a low rendered wall with stone piers and iron railings along the building line, a gate
  if (lot.setback > 0) {
    const line = street.width / 2 + street.sidewalk
    const a = street.at(lot.s0, side * line)
    const b = street.at(lot.s1, side * line)
    gardenFront(meshes, a, b, street0.clone().sub(a), { wall: wallColor, pier: lin('#d6cab2'), seed: lot.seed })
    // the garden's ground, a little under the pavement (its beds and trees come with the planting)
    const yard = [street.at(lot.s0, side * (line + 0.3)), street.at(lot.s1, side * (line + 0.3)), street.at(lot.s1, side * front), street.at(lot.s0, side * front)]
    const gy = Math.min(...yard.map((p) => streetY(p.x, p.y)))
    block(meshes.wall, yard, gy - 0.6, gy + 0.06, { wall: dado, roof: lin('#5d5a3e') })
  }
}

/** the church at the top of the street: nave, crossing dome on a drum, twin bell towers, facing the street */
function createChurch(): THREE.Group {
  const group = new THREE.Group()
  group.name = 'church'
  const f = MAIN.frame(CHURCH.s)
  const side = Math.sign(CHURCH.d)
  const p = MAIN.at(CHURCH.s, CHURCH.d)
  // (it stands on its plaza, level with the pavement where the plaza meets it; the ground behind rises round its footings)
  const line = MAIN.at(CHURCH.s, side * FRONT)
  group.position.set(p.x, streetY(line.x, line.y), p.y)
  // its front faces the street: local −z toward the street, −side × (tz, −tx)
  group.rotation.y = Math.atan2(side * f.tz, -side * f.tx) + CHURCH.turn
  const stone = new THREE.MeshStandardMaterial({ color: lin('#e3d3b4'), roughness: 0.9 })
  const tile = new THREE.MeshStandardMaterial({ color: lin('#d9a441'), roughness: 0.6 })
  const blue = new THREE.MeshStandardMaterial({ color: lin('#3c6aa4'), roughness: 0.55 })
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, yy: number, z: number) => {
    const mesh = new THREE.Mesh(g, m)
    mesh.position.set(x, yy, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    return mesh
  }
  const nave = { w: 13, l: 36, h: 15 }
  add(new THREE.BoxGeometry(nave.w, nave.h + 3, nave.l), stone, 0, nave.h / 2 - 1.5, nave.l / 2)
  // transepts
  add(new THREE.BoxGeometry(26, nave.h - 1 + 3, 10), stone, 0, (nave.h - 1) / 2 - 1.5, nave.l * 0.66)
  // the dome over the crossing: an octagonal drum, a tiled dome, a lantern
  add(new THREE.CylinderGeometry(5.4, 5.4, 5, 8), stone, 0, nave.h + 2.5, nave.l * 0.66)
  add(new THREE.SphereGeometry(5.6, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), tile, 0, nave.h + 5, nave.l * 0.66)
  add(new THREE.CylinderGeometry(1, 1, 2.6, 8), stone, 0, nave.h + 11.9, nave.l * 0.66)
  add(new THREE.ConeGeometry(1.2, 2, 8), blue, 0, nave.h + 14.2, nave.l * 0.66)
  // twin bell towers on the front corners, each in stages, a spire on top
  for (const x of [-5, 5]) {
    add(new THREE.BoxGeometry(5, 22.5, 5), stone, x, 9.75, -0.5)
    add(new THREE.BoxGeometry(4, 6, 4), stone, x, 24, -0.5)
    add(new THREE.BoxGeometry(3, 3.4, 3), stone, x, 28.7, -0.5)
    add(new THREE.ConeGeometry(1.9, 7, 8), blue, x, 33.9, -0.5)
  }
  // the plaza in front: a paved square down to the street (raised as a pavement is)
  const reach = Math.abs(CHURCH.d) - FRONT - 0.3
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(50, 1.2, reach + 2), new THREE.MeshStandardMaterial({ color: lin('#9c9384'), roughness: 0.85 }))
  plaza.position.set(0, ROAD.curb - 0.6, -reach + (reach + 2) / 2)
  plaza.receiveShadow = true
  group.add(plaza)
  return group
}

export interface BuildingMaterials {
  wall: THREE.Material
  glass: THREE.Material
  iron: THREE.Material
  lace: THREE.Material
  tank: THREE.Material
  signs: THREE.Material
}

/** every house in town with its facades, the side streets' closing houses, the roof tanks, and the church */
export function createBuildings(materials: BuildingMaterials): Buildings {
  const lots = planLots()
  const meshes: FacadeMeshes = { wall: new CellMesh(60), glass: new CellMesh(60), iron: new CellMesh(60), lace: new CellMesh(60), signs: new CellMesh(60) }
  const tanks: THREE.Vector3[] = []
  const drops: Buildings['drops'] = []
  for (const lot of lots) lotBlock(meshes, lot, tanks, drops)
  for (const end of endLots()) {
    const { street, lot } = end
    const half = end.width / 2
    const corners = [street.at(end.s, half), street.at(end.s, -half), street.at(end.s + 12, -half), street.at(end.s + 12, half)]
    const ground = corners.map((c) => streetY(c.x, c.y))
    const base = Math.max(ground[0], ground[1]) + ROAD.curb
    const top = base + lot.family.ground + UPPER + lot.parapet
    const bottom = Math.min(...ground) - 1.5
    const wallColor = lin(lot.wall).lerp(CHALK, lot.fade)
    block(meshes.wall, corners, bottom, top, { wall: wallColor, roof: ROOF_FLAT }, 'flat', [0])
    const toward = street.at(end.s - 10, 0)
    buildFacade(meshes, lot, corners[0], corners[1], toward.clone().sub(corners[0]), { base, top, bottom, wall: wallColor, dado: lin(lot.base), dadoTop: Math.min(ground[0], ground[1]) + ROAD.curb + 0.9 })
  }
  const built = [
    ...meshes.wall.build(materials.wall, 'houses', { colors: true }),
    ...meshes.glass.build(materials.glass, 'windows', { colors: true }),
    ...meshes.iron.build(materials.iron, 'ironwork'),
    ...meshes.lace.build(materials.lace, 'railings', { uv: 'stored' }),
    ...meshes.signs.build(materials.signs, 'shop signs', { uv: 'stored' }),
  ]
  for (const m of built) {
    m.castShadow = true
    m.receiveShadow = true
  }
  // the black plastic water tanks every flat roof in the region carries
  const tankGeometry = new THREE.CylinderGeometry(0.55, 0.6, 1.25, 12).translate(0, 0.625, 0)
  const tankMesh = new THREE.InstancedMesh(tankGeometry, materials.tank, tanks.length)
  const m4 = new THREE.Matrix4()
  tanks.forEach((p, i) => tankMesh.setMatrixAt(i, m4.makeTranslation(p.x, p.y, p.z)))
  tankMesh.castShadow = true
  tankMesh.receiveShadow = true
  tankMesh.name = 'roof tanks'
  tankMesh.computeBoundingSphere()
  return { meshes: [...built, tankMesh], lots, drops, church: createChurch() }
}
