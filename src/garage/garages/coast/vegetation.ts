import * as THREE from 'three'
import { fbm, lerp, noRaycast, seeded, smoothstep } from '../landform'
import type { PbrMaps } from '../kit'
import { WIND, foliage } from '../foliage'
import { PATCH_KINDS, farPatch, grassPatch, type PatchKind, type PatchSpec } from '../grass'
import { outdoorMaterial } from '../terrain'
import { createForest } from '../trees'
import { layoutVegetation, type VegetationLayout } from '../vegetation-layout'
import { createPalms, type PalmKind, type PalmSpot } from './palms'
import { createPlants, type PlantKind, type PlantSpot } from './plants'
import { SEA, VIEW_EYE, beachness, bearing, heightAt, inView, onRoad, nearestRoad, shore, woodedness } from './site'

/**
 * Where the coast's plants grow — not spread evenly, but in the ecological
 * bands a coast has, each its own mix:
 *
 *   by the garage: a planted garden — strelitzia, agave, flax, cycads, young
 *     palms, bougainvillea spilling over the planter, a mown lawn
 *   the slope below: dense shrubs and palms in clumps
 *   the cove's backshore: a line of coconut palms leaning out over the sand,
 *     sea grape mounds and beach grass
 *   the sand: next to nothing
 *   the rocky shore and the cliff tops: scattered salt-tolerant scrub
 *   the hills: woods (the valley forest's system: clustered stands, four
 *     levels of detail down to impostors), palms among them low down
 *
 * Nothing on the slope rises into the view of the cove from inside: plants
 * there keep under the line to it (`roomBelowCove`). Palms frame the view at
 * its sides, as the reference's do.
 */

const DEG = Math.PI / 180

/** how tall something at (x, z) may grow before it rises into the view of the cove from inside (Infinity: no limit) */
export function roomBelowCove(x: number, z: number): number {
  const b = bearing(x, z) / DEG
  const r = Math.hypot(x, z)
  if (r > 470) return Infinity
  // In front of the sand (−18°…+20°) nothing may rise above the sill's line (8.4° down from the
  // design eye): the beach lies just above it. Toward the sides, up to the line under the sea's
  // (6.6°), and past the cove's ends, anything — palms frame the view there.
  const centre = smoothstep(b, -24, -17) * (1 - smoothstep(b, 20, 26))
  const side = smoothstep(b, -36, -28) * (1 - smoothstep(b, 30, 38))
  if (side <= 0) return Infinity
  const angle = lerp(6.6, 8.4, centre) * DEG
  const line = VIEW_EYE.y - (r + VIEW_EYE.z) * Math.tan(angle)
  return line - heightAt(x, z) + (1 - side) * 30
}

/** the garage's footprint and terrace, where nothing grows but the lawn */
const inGarage = (x: number, z: number) => Math.abs(x) < 12 && z > -8.3 && z < 9

export interface CoastVegetation {
  group: THREE.Group
  /** detail the garage's floor mirror can skip */
  far: THREE.Object3D[]
  /** the coast's grass meadow near the garage, and its layout's cover (the terrain darkens the ground under trees) */
  layout: VegetationLayout
  ready: Promise<void>
}

// ─── palms ──────────────────────────────────────────────────────────────────

/** palms placed by hand around the garage: framing the view at its sides, as a photographer would stand them */
const HERO_PALMS: Omit<PalmSpot, 'y' | 'tone'>[] = [
  { x: -15, z: -17, kind: 'coconut', height: 14, turn: Math.PI * 0.95 },
  { x: -20, z: -27, kind: 'slender', height: 19, turn: 2.2 },
  { x: -12.5, z: -24, kind: 'leaning', height: 12, turn: Math.PI * 1.05 },
  { x: -24, z: -14, kind: 'mature', height: 9, turn: 0.4 },
  { x: 17, z: -19, kind: 'coconut', height: 13, turn: 0.15 },
  { x: 23, z: -30, kind: 'slender', height: 18, turn: -0.4 },
  { x: 14, z: -29, kind: 'young', height: 4.5, turn: 1.1 },
  { x: -9, z: -12.5, kind: 'young', height: 3.6, turn: 0.3 },
  { x: 11, z: -12.5, kind: 'young', height: 3.2, turn: 2.4 },
  { x: -30, z: 4, kind: 'mature', height: 10, turn: 1.4 },
  { x: 28, z: -6, kind: 'coconut', height: 12, turn: 0.8 },
]

function placePalms(rand: () => number): PalmSpot[] {
  const spots: PalmSpot[] = HERO_PALMS.map((p) => ({ ...p, y: heightAt(p.x, p.z), tone: rand() }))
  const taken = (x: number, z: number, gap: number) => spots.some((s) => (s.x - x) ** 2 + (s.z - z) ** 2 < gap * gap)
  const pickKind = (w: Partial<Record<PalmKind, number>>): PalmKind => {
    const total = Object.values(w).reduce((a, b) => a + b, 0)
    let r = rand() * total
    for (const [k, v] of Object.entries(w) as [PalmKind, number][]) if ((r -= v) <= 0) return k
    return 'coconut'
  }
  const heightOf = (kind: PalmKind) => ({ slender: 15, coconut: 12, leaning: 11, young: 4, mature: 8 })[kind] * (0.75 + rand() * 0.5)
  const tryPlace = (x: number, z: number, kind: PalmKind, lean?: number): boolean => {
    if (inGarage(x, z) || taken(x, z, kind === 'young' ? 2.5 : 4)) return false
    const s = shore(x, z)
    if (s < 6 || onRoad(x, z) > 0 || nearestRoad(x, z).d < 7) return false
    const h0 = heightAt(x, z)
    const slope = Math.hypot(heightAt(x + 2, z) - h0, heightAt(x, z + 2) - h0) / 2
    if (slope > 0.9) return false
    let height = heightOf(kind)
    const room = roomBelowCove(x, z)
    if (room < 2.5) return false
    height = Math.min(height, room)
    if (height < 2.5) return false
    spots.push({ x, y: h0, z, kind: height < 5 ? 'young' : kind, height, turn: lean ?? rand() * Math.PI * 2, tone: rand() })
    return true
  }
  // the cove's backshore: coconuts in a loose line, leaning out toward the sea
  for (let i = 0; i < 2500 && spots.length < 90; i++) {
    const r = 180 + rand() * 360
    const b = (-22 + rand() * 50) * DEG
    const x = Math.sin(b) * r
    const z = -Math.cos(b) * r
    const s = shore(x, z)
    // behind the sand, and only toward the cove's ends: palms in the middle would stand in front of the beach
    if (beachness(x, z) < 0.1 || s < 150 || s > 215 || Math.abs(b) < 13 * DEG) continue
    // toward the sea: down the shore field
    const gx = shore(x + 4, z) - shore(x - 4, z)
    const gz = shore(x, z + 4) - shore(x, z - 4)
    const seaward = Math.atan2(-gz, -gx) // (palm geometry leans toward +x; turn it to face the sea)
    tryPlace(x, z, pickKind({ coconut: 3, leaning: 3, slender: 1, young: 1 }), -seaward + (rand() - 0.5) * 0.8)
  }
  // clumps on the slope below the garage and round its sides
  for (let c = 0; c < 36; c++) {
    const r = 30 + rand() * 230
    const b = (rand() - 0.5) * 200 * DEG
    const cx = Math.sin(b) * r
    const cz = -Math.cos(b) * r
    const n = 2 + Math.floor(rand() * 5)
    for (let k = 0; k < n * 3; k++) {
      const x = cx + (rand() - 0.5) * 16
      const z = cz + (rand() - 0.5) * 16
      tryPlace(x, z, pickKind({ coconut: 2, slender: 2, mature: 1, young: 2, leaning: 1 }))
    }
  }
  // palms scattered through the valley and the low hills, clumped, out to ~2 km
  for (let i = 0; i < 30000 && spots.length < 1400; i++) {
    const r = 80 + 2000 * rand() ** 1.3
    const b = (rand() - 0.5) * 250 * DEG
    const x = Math.sin(b) * r
    const z = -Math.cos(b) * r
    const h = heightAt(x, z)
    if (h - SEA > 90) continue
    const clump = smoothstep(fbm(x / 120 + 7, z / 120 - 3, 2), 0.5, 0.68)
    if (rand() > clump * 0.6) continue
    tryPlace(x, z, pickKind({ coconut: 3, slender: 3, mature: 1, young: 1, leaning: 1 }))
  }
  return spots
}

// ─── garden plants, shrubs and beach grass ─────────────────────────────────

function placePlants(rand: () => number, planter: boolean): PlantSpot[] {
  const spots: PlantSpot[] = []
  const add = (x: number, z: number, kind: PlantKind, size: number, y = heightAt(x, z)) =>
    spots.push({ x, y, z, kind, size, turn: rand() * Math.PI * 2, tone: rand() })
  // the planter along the glass: a garden bed, tall at the ends, low in the middle so the view stays open
  // (planted at its ends only: anything in the middle stands right in front of the beach)
  for (let x = -9.2; planter && x < 10; x += 0.45 + rand() * 0.35) {
    if (x > -5.5 && x < 6.5) continue
    const z = -7.9 + (rand() - 0.5) * 0.7
    const kind: PlantKind = Math.abs(x) > 7.5 ? (rand() < 0.5 ? 'strelitzia' : 'cycad') : (['agave', 'flax', 'bougainvillea'] as PlantKind[])[Math.floor(rand() * 3)]
    add(x, z, kind, kind === 'strelitzia' ? 0.8 + rand() * 0.3 : 0.9 + rand() * 0.4, -0.16)
  }
  // the garden round the garage and down the first of the slope
  for (let i = 0; i < 9000 && spots.length < 2600; i++) {
    const r = 9 + 110 * rand() ** 1.5
    const b = rand() * Math.PI * 2
    const x = Math.sin(b) * r
    const z = -Math.cos(b) * r
    if (inGarage(x, z) || Math.abs(x) < 10.5 && z > -9.5 && z < 9.5) continue
    const s = shore(x, z)
    if (s < 10 || onRoad(x, z) > 0) continue
    const room = roomBelowCove(x, z)
    const bed = smoothstep(fbm(x / 9 + 2, z / 9, 2), 0.42, 0.6)
    if (rand() > bed * (1 - 0.6 * smoothstep(r, 30, 110))) continue
    const pick = rand()
    const kind: PlantKind =
      pick < 0.22 ? 'bougainvillea' : pick < 0.36 ? 'hibiscus' : pick < 0.5 ? 'strelitzia' : pick < 0.62 ? 'agave' : pick < 0.74 ? 'cycad' : pick < 0.86 ? 'flax' : 'seagrape'
    const natural = kind === 'strelitzia' ? 1.4 : kind === 'bougainvillea' || kind === 'hibiscus' ? 1.5 + rand() : 1
    const size = Math.min(natural * (0.7 + rand() * 0.6), room / (kind === 'strelitzia' ? 1.9 : 1.2))
    if (size < 0.35) continue
    add(x, z, kind, size)
  }
  // the slope below the garage and round its sides: dense shrubs in drifts, flowering in patches
  for (let i = 0; i < 60000 && spots.length < 9000; i++) {
    const r = 20 + 430 * rand() ** 1.3
    const b = (rand() - 0.5) * 230 * DEG
    const x = Math.sin(b) * r
    const z = -Math.cos(b) * r
    if (inGarage(x, z)) continue
    const s = shore(x, z)
    if (s < 25 || beachness(x, z) > 0.3 || onRoad(x, z) > 0 || nearestRoad(x, z).d < 6) continue
    const drift = smoothstep(fbm(x / 22 + 11, z / 22 - 4, 3), 0.4, 0.58)
    if (rand() > drift * 0.8) continue
    const room = roomBelowCove(x, z)
    const flowering = smoothstep(fbm(x / 40 - 3, z / 40 + 8, 2), 0.55, 0.7)
    const pick = rand()
    const kind: PlantKind = pick < flowering * 0.6 ? (rand() < 0.6 ? 'bougainvillea' : 'hibiscus') : pick < 0.7 ? 'seagrape' : pick < 0.85 ? 'cycad' : 'strelitzia'
    const size = Math.min((1.4 + rand() * 1.6) * (kind === 'seagrape' ? 1.3 : 1), room / 1.3)
    if (size < 0.5) continue
    add(x, z, kind, size)
  }
  // the backshore: sea grape mounds and beach grass behind the sand, a little grass on the dunes
  for (let i = 0; i < 12000 && spots.length < 11500; i++) {
    const r = 180 + rand() * 450
    const b = (-25 + rand() * 60) * DEG
    const x = Math.sin(b) * r
    const z = -Math.cos(b) * r
    const s = shore(x, z)
    const sand = beachness(x, z)
    // the open sand stays open: dune grass in its upper reaches, sea grape and agave behind it
    const back = sand > 0.2 ? 135 : 14
    if (s < back || s > back + 70 || onRoad(x, z) > 0) continue
    if (rand() > 0.35 + 0.4 * smoothstep(s, back, back + 40)) continue
    const kind: PlantKind = s < back + 25 ? 'beachgrass' : rand() < 0.5 ? 'seagrape' : rand() < 0.5 ? 'beachgrass' : 'agave'
    add(x, z, kind, kind === 'seagrape' ? 1.2 + rand() * 1.4 : 0.8 + rand() * 0.6)
  }
  // salt-tolerant scrub on the cliff tops and the rocky shore
  for (let i = 0; i < 16000 && spots.length < 14500; i++) {
    const r = 150 + 1200 * rand() ** 1.2
    const b = (-40 + rand() * 90) * DEG
    const x = Math.sin(b) * r
    const z = -Math.cos(b) * r
    const s = shore(x, z)
    if (s < 8 || s > 60 || beachness(x, z) > 0.3 || onRoad(x, z) > 0) continue
    if (rand() > 0.3) continue
    add(x, z, rand() < 0.6 ? 'seagrape' : 'beachgrass', 0.9 + rand() * 1.2)
  }
  return spots
}

/** the lawn and coastal grass round the garage (grass.ts patches), thinning out down the slope */
function createCoastGrass(rand: () => number): { group: THREE.Group; far: THREE.Object3D[] } {
  const COUNT = 22000
  const NEAR = 18
  const material = foliage(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })), {
    wind: 'grass',
    translucency: 0.3,
  })
  const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
  const lush = srgb(0x4f7a2c)
  const warm = srgb(0x8c9a44)
  const dry = srgb(0xa89a62)
  type Spot = { x: number; y: number; z: number; yaw: number; scale: number; color: THREE.Color }
  const spots = new Map<string, Spot[]>()
  let n = 0
  for (let t = 0; n < COUNT && t < COUNT * 10; t++) {
    const r = 6 + 150 * rand() ** 1.6
    const a = rand() * Math.PI * 2
    const x = Math.sin(a) * r
    const z = -Math.cos(a) * r
    if (inGarage(x, z) || (Math.abs(x) < 10.6 && z > -9.1 && z < 9.3)) continue
    const s = shore(x, z)
    if (s < 12 || onRoad(x, z) > 0.2) continue
    const keep = r < 30 ? 1 : (30 / r) ** 1.2
    if (rand() > keep) continue
    const room = roomBelowCove(x, z)
    if (room < 0.3) continue
    // mown lawn on the terrace, longer coastal grass beyond, tufts and tall stands in patches
    const tall = smoothstep(fbm(x / 10 + 3, z / 10, 2), 0.52, 0.7) * smoothstep(r, 25, 45)
    const kind: PatchKind = r < 24 ? 'base' : rand() < tall ? (rand() < 0.4 ? 'dry' : 'tall') : rand() < 0.15 ? 'forb' : 'tuft'
    const tallest = PATCH_KINDS[kind].height[1]
    const scale = Math.min(room / tallest, 0.8 + rand() * 0.5)
    const c = lush.clone().lerp(warm, smoothstep(fbm(x / 25, z / 25, 2), 0.4, 0.7)).lerp(dry, smoothstep(r, 40, 140) * 0.5 * rand())
    const lod = x * x + z * z < NEAR * NEAR ? 0 : 1
    const k = `${kind}|${Math.floor(rand() * 3)}|${lod}`
    const spot = { x, y: heightAt(x, z), z, yaw: Math.atan2(WIND.direction.value.y, WIND.direction.value.x) + (rand() - 0.5) * 2, scale, color: c.multiplyScalar(0.9 + 0.2 * rand()) }
    spots.set(k, [...(spots.get(k) ?? []), spot])
    n++
  }
  const group = new THREE.Group()
  group.name = 'coast-grass'
  const far: THREE.Object3D[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const kinds = Object.keys(PATCH_KINDS) as PatchKind[]
  kinds.forEach((kind, ki) => {
    for (let v = 0; v < 3; v++)
      for (const lod of [0, 1]) {
        const list = spots.get(`${kind}|${v}|${lod}`)
        if (!list) continue
        const spec = { ...PATCH_KINDS[kind], seed: 300 + ki * 10 + v } as PatchSpec
        const geometry = grassPatch(lod ? farPatch(spec) : spec)
        const mesh = new THREE.InstancedMesh(geometry, material, list.length)
        list.forEach((sp, i) => {
          q.setFromAxisAngle(up, sp.yaw)
          mesh.setMatrixAt(i, m.compose(new THREE.Vector3(sp.x, sp.y - 0.02, sp.z), q, new THREE.Vector3(sp.scale * 1.3, sp.scale, sp.scale * 1.3)))
          mesh.setColorAt(i, sp.color)
        })
        mesh.castShadow = kind === 'tall' || kind === 'dry'
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        group.add(noRaycast(mesh))
        if (lod === 1) far.push(mesh) // (the floor mirror sees only the grass by the glass)
      }
  })
  return { group, far }
}

// ─── the woods on the hills ─────────────────────────────────────────────────

function planWoods(): VegetationLayout {
  return layoutVegetation(
    {
      radius: [30, 2400],
      wood: (x, z) => {
        const r = Math.hypot(x, z)
        // (thinner on the slope below the garage: shrubs and palms there, not a forest)
        return woodedness(x, z) * (1 - 0.7 * (1 - smoothstep(r, 150, 350)))
      },
      // (a tropical coast: broadleaf woods, the odd pine high up)
      conifers: (x, z) => 0.02 + 0.12 * smoothstep(heightAt(x, z) - SEA, 200, 450),
      allowed(x, z, height) {
        if (inGarage(x, z) || Math.hypot(x, z) < 22) return false
        const s = shore(x, z)
        if (s < 30 || beachness(x, z) > 0.2) return false
        if (onRoad(x, z) > 0 || nearestRoad(x, z).d < 9) return false
        const h = heightAt(x, z)
        const slope = Math.hypot(heightAt(x + 3, z) - h, heightAt(x, z + 3) - h) / 3
        if (slope > 1.1) return false
        // (and no woods on the slope in the view below the garage: shrubs and palms there)
        return roomBelowCove(x, z) >= height && !(inView(x, z) > 0.5 && Math.hypot(x, z) < 260)
      },
    },
    17,
  )
}

/** `planter`: plant the garage's bed along its glass (a room without the garage has none) */
export function createCoastVegetation(opts: { bark: PbrMaps; planter: boolean }): CoastVegetation {
  const t0 = performance.now()
  const rand = seeded(2024)
  const group = new THREE.Group()
  group.name = 'coast-vegetation'
  const palms = createPalms(placePalms(rand), opts.bark)
  const plants = createPlants(placePlants(rand, opts.planter))
  const grass = createCoastGrass(rand)
  const layout = planWoods()
  group.add(palms.group, plants.group, grass.group)
  const far: THREE.Object3D[] = [...palms.far, ...plants.far, ...grass.far]
  console.info(`[garage] coast vegetation planned in ${Math.round(performance.now() - t0)} ms (${layout.plants.length} woodland plants)`)
  const forestReady = createForest({
    seed: 9,
    heightAt,
    layout,
    // no extra bushes round the building: the garden (plants.ts) is its planting
    bushRoom: () => 0,
    accents: [],
  })
    .then(async (forest) => {
      group.add(forest.group)
      far.push(...forest.mid, ...forest.far, ...forest.bushes)
      await forest.ready
    })
    .catch((err: unknown) => console.error('[garage] coast woods failed', err))
  return { group, far, layout, ready: Promise.all([palms.ready, forestReady]).then(() => {}) }
}
