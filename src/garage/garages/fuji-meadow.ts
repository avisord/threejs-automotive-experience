import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { createFujiWorld } from './fuji-world'
import { SURFACES, disposeTree, pbrMaps, type GarageDef, type Room } from './kit'
import { seeded } from './landform'
import { GROUND, heightAt, roadZ } from './site'

/**
 * The Fuji valley with no building: the car stands in the open on a round pad
 * of river pebbles in the meadow on the terrace, ringed with edging stones, and
 * a pebble track winds from it down the bank and across the fields to the
 * valley road. Same land, sky, sun and air as the Fuji Pavilion (fuji-world.ts).
 */

/** the pad the car stands on, metres */
const PAD = { radius: 9 }
/** the track: width, and its course from the pad to the road (x, z; the end is put on the road) */
const TRACK = {
  width: 3.4,
  course: [
    [0, -PAD.radius + 0.5],
    [3, -22],
    [16, -55],
    [14, -105],
    [34, -170],
    [70, -250],
    [104, -330],
    [128, -410],
    [140, NaN], // the road
  ] as [number, number][],
}
/** the land is raised so the lawn sits just under the pad's top at y = 0 (the car's ground) */
const LIFT = -GROUND - 0.04

/** the track's centre line, sampled every metre (ground plane; y filled in later) */
function trackLine(): THREE.Vector3[] {
  const points = TRACK.course.map(([x, z]) => new THREE.Vector3(x, 0, Number.isNaN(z) ? roadZ(x) : z))
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal')
  return curve.getSpacedPoints(Math.round(curve.getLength()))
}

/** distance from (x, z) to the track's centre line (a coarse grid keeps it cheap for the landscape's many queries) */
function trackDistance(line: THREE.Vector3[]): (x: number, z: number) => number {
  const CELL = 12
  const grid = new Map<string, THREE.Vector3[]>()
  for (const p of line) {
    const k = `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`
    const list = grid.get(k)
    if (list) list.push(p)
    else grid.set(k, [p])
  }
  return (x, z) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    let best = Infinity
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const p of grid.get(`${cx + i},${cz + j}`) ?? []) best = Math.min(best, Math.hypot(p.x - x, p.z - z))
    return best
  }
}

/** the land's height under the track, in the room's frame (the landscape is lifted) */
const ground = (x: number, z: number) => heightAt(x, z) + LIFT

/**
 * The track as a ribbon draped on the terrain: five vertices across (it
 * follows a camber), uvs in metres of the pebble texture. It rides a little
 * above the ground, more with distance, where the terrain mesh between its
 * vertices is coarser than heightAt.
 */
function trackGeometry(line: THREE.Vector3[]): THREE.BufferGeometry {
  const across = [-1, -0.5, 0, 0.5, 1]
  const tile = SURFACES.riverPebbles.tile
  const position: number[] = []
  const uv: number[] = []
  const color: number[] = []
  const index: number[] = []
  let along = 0
  const side = new THREE.Vector3()
  for (let i = 0; i < line.length; i++) {
    const p = line[i]
    const a = line[Math.max(0, i - 1)]
    const b = line[Math.min(line.length - 1, i + 1)]
    side.set(-(b.z - a.z), 0, b.x - a.x).normalize()
    if (i > 0) along += p.distanceTo(line[i - 1])
    const r = Math.hypot(p.x, p.z)
    const rise = 0.03 + 0.25 * THREE.MathUtils.smoothstep(r, 12, 80)
    // wobbling edges: a track laid by hand and spread by wheels, not a ruled strip
    const wobble = 1 + 0.08 * Math.sin(along * 0.37) + 0.05 * Math.sin(along * 1.3 + 2)
    for (const [k, t] of across.entries()) {
      const w = (TRACK.width / 2) * t * wobble
      const x = p.x + side.x * w
      const z = p.z + side.z * w
      position.push(x, ground(x, z) + rise, z)
      uv.push((w + TRACK.width) / tile, along / tile)
      // the wheel lines are barer and lighter; the verges darker, where the grass creeps in
      const shade = [0.62, 1.05, 0.9, 1.05, 0.62][k]
      color.push(shade, shade, shade)
    }
  }
  for (let i = 0; i < line.length - 1; i++) {
    for (let k = 0; k < across.length - 1; k++) {
      const a = i * across.length + k
      const b = a + across.length
      index.push(a, a + 1, b, a + 1, b + 1, b) // wound to face up
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

/** the pad: a disc with uvs in texture tiles */
function padGeometry(): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(PAD.radius, 128)
  g.rotateX(-Math.PI / 2)
  const pos = g.attributes.position
  const uv = g.attributes.uv
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / SURFACES.riverPebbles.tile, pos.getZ(i) / SURFACES.riverPebbles.tile)
  return g
}

/** a pebble: a squashed, lumpy icosahedron, 1 unit across */
function pebbleGeometry(seed: number): THREE.BufferGeometry {
  const rand = seeded(seed)
  const g = new THREE.IcosahedronGeometry(0.5, 1)
  const pos = g.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const k = 0.85 + rand() * 0.3
    pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.55, pos.getZ(i) * k)
  }
  g.computeVertexNormals()
  return g
}

function createFujiMeadow(): Room {
  const group = new THREE.Group()
  group.name = 'fuji-meadow'

  const line = trackLine()
  const fromTrack = trackDistance(line)
  const onPad = (x: number, z: number) => Math.hypot(x, z) < PAD.radius + 0.6
  const world = createFujiWorld(group, {
    keepClear: (x, z) => onPad(x, z) || fromTrack(x, z) < TRACK.width / 2 + 0.8,
    hideFromLake: () => [pad, track, stones, pebbles],
    lift: LIFT,
  })

  const maps = pbrMaps(SURFACES.riverPebbles)
  // ─── the pad ─────────────────────────────────────────────────────────────
  // the photographed pebbles are dark and wet-looking: lighten them to sun-dried river stone
  const gravel = new THREE.MeshStandardMaterial({ ...maps.maps, color: 0xfff8ee, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) })
  const pad = new THREE.Mesh(padGeometry(), gravel)
  pad.receiveShadow = true
  pad.name = 'pebble-pad'
  group.add(pad)

  // ─── the track, down to the road ─────────────────────────────────────────
  const trackMaterial = new THREE.MeshStandardMaterial({
    ...maps.maps,
    color: 0xfff8ee,
    vertexColors: true,
    roughness: 1,
    normalScale: new THREE.Vector2(0.6, 0.6),
    polygonOffset: true, // it lies on the terrain: win the depth test where they meet
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
  const track = new THREE.Mesh(trackGeometry(line), trackMaterial)
  track.receiveShadow = true
  track.name = 'pebble-track'
  track.raycast = () => {}
  group.add(track)

  // ─── edging stones round the pad, and loose pebbles ──────────────────────
  const rand = seeded(73)
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 })
  const stoneCount = Math.round((2 * Math.PI * PAD.radius) / 0.34)
  const stones = new THREE.InstancedMesh(pebbleGeometry(4), stoneMaterial, stoneCount)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const c = new THREE.Color()
  for (let i = 0; i < stoneCount; i++) {
    const a = (i / stoneCount) * Math.PI * 2 + (rand() - 0.5) * 0.01
    const r = PAD.radius + (rand() - 0.5) * 0.05
    // where the track leaves the pad the ring is open
    const x = Math.sin(a) * r
    const z = -Math.cos(a) * r
    const open = fromTrack(x, z) < TRACK.width / 2
    const s = open ? 0.0001 : 0.3 + rand() * 0.12
    q.setFromEuler(e.set((rand() - 0.5) * 0.3, -a + (rand() - 0.5) * 0.4, (rand() - 0.5) * 0.3))
    stones.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.02, z), q, new THREE.Vector3(s * 1.1, s * 0.9, s * 0.8)))
    stones.setColorAt(i, c.setHSL(0.08, 0.05 + rand() * 0.05, 0.3 + rand() * 0.2, THREE.SRGBColorSpace))
  }
  stones.castShadow = true
  stones.receiveShadow = true
  stones.name = 'edging'
  group.add(stones)

  // loose pebbles, thrown up onto the pad's rim and the track's verges by wheels
  const LOOSE = 2400
  const pebbles = new THREE.InstancedMesh(pebbleGeometry(9), stoneMaterial, LOOSE)
  let n = 0
  for (let t = 0; n < LOOSE && t < LOOSE * 4; t++) {
    let x: number
    let z: number
    let y: number
    if (rand() < 0.55) {
      const a = rand() * Math.PI * 2
      const r = PAD.radius * Math.sqrt(0.3 + 0.75 * rand())
      x = Math.sin(a) * r
      z = -Math.cos(a) * r
      y = 0
    } else {
      const p = line[Math.floor(rand() * Math.min(line.length, 140))]
      const a = rand() * Math.PI * 2
      const d = TRACK.width * (0.3 + rand() * 0.45)
      x = p.x + Math.cos(a) * d
      z = p.z + Math.sin(a) * d
      y = ground(x, z) + 0.03 + 0.25 * THREE.MathUtils.smoothstep(Math.hypot(x, z), 12, 80)
      if (onPad(x, z)) continue
    }
    const s = 0.025 + rand() ** 2 * 0.06
    q.setFromEuler(e.set((rand() - 0.5) * 0.4, rand() * Math.PI * 2, (rand() - 0.5) * 0.4))
    pebbles.setMatrixAt(n, m.compose(new THREE.Vector3(x, y + s * 0.15, z), q, new THREE.Vector3(s, s, s)))
    pebbles.setColorAt(n, c.setHSL(0.08 + rand() * 0.04, 0.08 + rand() * 0.1, 0.35 + rand() * 0.35, THREE.SRGBColorSpace))
    n++
  }
  pebbles.count = n
  pebbles.receiveShadow = true
  pebbles.name = 'loose-pebbles'
  pebbles.raycast = () => {}
  group.add(pebbles)

  // no floor mirror out here: a stand-in the app's bookkeeping can hold, never drawn
  const reflector = new Reflector(new THREE.PlaneGeometry(0.01, 0.01), { textureWidth: 1, textureHeight: 1 })
  reflector.visible = false
  group.add(reflector)

  return {
    group,
    reflector,
    floorLayers: [],
    // out in the open: the camera may go anywhere round the car, above the grass
    bounds: new THREE.Box3(new THREE.Vector3(-24, 0.4, -24), new THREE.Vector3(24, 16, 24)),
    background: new THREE.Color(0xa7bdd8), // only until the sky is in
    environmentIntensity: 1,
    resize: world.resize,
    setReflectionScale: world.setReflectionScale,
    update: world.update,
    ready: Promise.all([world.ready, maps.ready]).then(() => {}),
    dispose: () => disposeTree(group),
    ...world.hooks,
  }
}

export const fujiMeadow: GarageDef = {
  id: 'fuji-meadow',
  name: 'Fuji Meadow',
  tag: 'Out in the open on a pebble pad in the meadow, a track winding down to the valley, Mount Fuji beyond',
  palette: ['#2f5f9e', '#a7bdd8', '#c9bfae', '#5f8a2e'],
  look: 'golden',
  create: createFujiMeadow,
}
