import * as THREE from 'three'
import { createFujiMountain } from './fuji-mountain'
import { createCanopy } from './canopy'
import { fbm, noRaycast, seeded, smoothstep } from './landform'
import { createRanges } from './ranges'
import { createRoadside } from './roadside'
import { SITE, forestDensity, heightAt, inView, lakeShape, onRoad, roadZ, roomBelowView, woodedness } from './site'
import { createSky } from './sky'
import { createTerrain, orchardFarmland, outdoorMaterial } from './terrain'
import { createGreenery } from './greenery'
import { createTown, type House } from './town'
import { layoutVegetation, type VegetationLayout } from './vegetation-layout'
import { createRangeForest } from './ranges'
import { createForest } from './trees'
import { WIND, foliage } from './foliage'
import { PATCH_KINDS, farPatch, grassPatch, type PatchKind, type PatchSpec } from './grass'
import { createWater, type WaterSurface } from './water'

/**
 * The world around the Fuji Pavilion, in depth layers (site.ts has the plan):
 * the lawn and meadow → the valley falling away to a winding road with poles,
 * cars and farmhouses → rolling wooded ground and a village → a lake with a
 * real reflection → its forested far shore → foothill ranges → Mount Fuji,
 * at their real angular sizes. An analytic sky over it all (sky.ts); distance
 * haze is added from depth by the atmosphere effect, not painted in.
 *
 * Everything is placed from fixed seeds, so every load — and every frame of an
 * exported video — sees the same landscape.
 */

export interface LandscapeOptions {
  /** true where no grass or bush may grow (the pavilion's footprint, its pool) */
  keepClear(x: number, z: number): boolean
  sunDirection: THREE.Vector3
  /** the pavilion's own things the lake's mirror needn't draw (they can't appear in it) */
  hideFromLake(): THREE.Object3D[]
}

/** a tree placed by hand (see ACCENTS) */
type Accent = { x: number; z: number; kind: 'pine' | 'sakura'; height: number }

export interface Landscape {
  group: THREE.Group
  /** everything lit by the open sky (the room captures an outdoor environment map for it) */
  outdoor: THREE.Object3D
  sky: ReturnType<typeof createSky>
  lake: WaterSurface
  /** detail the pavilion's own mirrors (deck, pool) can skip — a few pixels there at most */
  farDetail: THREE.Object3D[]
  /** resolves once the trees and their textures are in (never rejects) */
  ready: Promise<void>
  /** 0 by day … 1 at dusk: lit windows in the towns */
  setEvening(amount: number): void
}

/**
 * Trees placed by hand beyond the back glass: tall pines at the edges of the
 * view, framing it as the window's sides would, and a few cherries in bloom
 * lower down on the bank. Kept off the line to the lake and the mountain.
 */
const ACCENTS: Accent[] = [
  { x: -24, z: -34, kind: 'pine', height: 24 },
  { x: -33, z: -52, kind: 'pine', height: 27 },
  { x: -18, z: -27, kind: 'pine', height: 17 },
  { x: 25, z: -35, kind: 'pine', height: 25 },
  { x: 20, z: -26, kind: 'pine', height: 16 },
  { x: -14, z: -22, kind: 'sakura', height: 7 },
  { x: -20, z: -21, kind: 'sakura', height: 6 },
  { x: 15, z: -21, kind: 'sakura', height: 6.5 },
]

/**
 * The meadow around the building, in layers of grass patches (grass.ts), not
 * blades: a dense short sward close in; tufts of mixed grass and low
 * broad-leaved plants over the whole meadow; tall and seeding grass in stands.
 * Where it grows is as before — full close in, thinning with distance and
 * giving out over an uneven edge with stray patches beyond, kept under the
 * view of the valley past the glass. What grows where is decided by broad,
 * smooth noise fields, so neighbouring patches share their height, density,
 * lean and colour and the meadow varies patch by patch, not blade by blade.
 */
function createMeadow(keepClear: LandscapeOptions['keepClear']): THREE.Group {
  const COUNT = 46000
  const BASE = 30000
  /** patches nearer than this get the detailed geometry (LOD 0); beyond, the simplified one */
  const NEAR = 18
  const INNER = 2
  const OUTER = 150
  /** full density out to here, then thinning */
  const FULL = 24
  /** the short sward's reach: past it the terrain's own grass texture is the sward */
  const SWARD = 34
  /** where the meadow gives out, by direction: uneven, 70–125 m — not a circle */
  const edge = (a: number) => 70 + 55 * fbm(Math.cos(a) * 1.6 + 7, Math.sin(a) * 1.6 - 2, 3)
  const VARIANTS = 3
  const kinds = Object.keys(PATCH_KINDS) as PatchKind[]
  const material = foliage(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })), {
    wind: 'grass',
    translucency: 0.3,
  })
  // the palette (sRGB): mixed by the fields, then jittered per patch
  const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
  const deep = srgb(0x4c6a30)
  const medium = srgb(0x6a8c38)
  const yellowGreen = srgb(0x8e9c40)
  const olive = srgb(0x7c7c48)
  const straw = srgb(0xb09c64)
  const rand = seeded(21)
  type Spot = { x: number; z: number; y: number; yaw: number; scale: number; spread: number; color: THREE.Color }
  const spots = new Map<string, Spot[]>()
  const add = (kind: PatchKind, spot: Spot) => {
    const lod = spot.x * spot.x + spot.z * spot.z < NEAR * NEAR ? 0 : 1
    const k = `${kind}|${Math.floor(rand() * VARIANTS)}|${lod}`
    const list = spots.get(k)
    if (list) list.push(spot)
    else spots.set(k, [spot])
  }
  /** the fields at a point: coherent over metres, different a patch or two away */
  const field = (x: number, z: number) => ({
    tall: smoothstep(fbm(x / 11 + 3, z / 11, 3), 0.5, 0.68),
    dry: smoothstep(fbm(x / 20 + 9, z / 20 - 3, 2), 0.5, 0.66),
    hue: fbm(x / 13 + 17, z / 13, 2),
    warm: fbm(x / 27 - 5, z / 27 + 11, 2),
    size: 0.75 + 0.5 * fbm(x / 16, z / 16, 2),
    // patches lean together: a shared direction per few metres, near the wind's
    yaw: Math.atan2(WIND.direction.value.y, WIND.direction.value.x) + (fbm(x / 15 - 2, z / 15 + 6, 2) - 0.5) * 2.4,
  })
  const colour = (f: ReturnType<typeof field>, kind: PatchKind, far: number) => {
    const c = deep.clone().lerp(medium, smoothstep(f.hue, 0.3, 0.6))
    c.lerp(yellowGreen, smoothstep(f.warm, 0.5, 0.7) * 0.8)
    c.lerp(olive, smoothstep(f.hue, 0.6, 0.75) * 0.5)
    c.lerp(straw, f.dry * (kind === 'dry' ? 0.9 : kind === 'tall' ? 0.45 : 0.2))
    // (lighter where the meadow thins out: sparse dark tufts on the lit ground read as spots)
    return c.multiplyScalar((0.9 + 0.2 * rand()) * (1 + 0.25 * far))
  }

  // ─── tufts, forbs and tall stands, where the meadow grows ────────────────
  let n = 0
  for (let tries = 0; n < COUNT && tries < COUNT * 16; tries++) {
    const r = Math.sqrt(rand() * (OUTER * OUTER - INNER * INNER) + INNER * INNER)
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (keepClear(x, z)) continue
    // thinner with distance and gone past an uneven edge, with patches and stray tufts beyond it
    const e = edge(a)
    const patches = smoothstep(fbm(x / 14 + 5, z / 14 - 8, 3), 0.5, 0.68)
    const thin = r < FULL ? 1 : (FULL / r) ** 1.3
    const keep = thin * Math.max(1 - smoothstep(r, e * 0.55, e), patches * (1 - smoothstep(r, e, OUTER)) * 0.8)
    if (rand() > keep) continue
    // …kept below the view of the valley past the glass (a fringe along the sill, not a screen)
    const room = roomBelowView(x, z)
    if (room < 0.25) continue
    const f = field(x, z)
    const kind: PatchKind = rand() < f.tall * 0.85 ? (rand() < f.dry * 0.6 ? 'dry' : 'tall') : rand() < 0.13 ? 'forb' : 'tuft'
    // shorter toward the edge (grazed and trodden where it thins), wider clumps farther out
    const far = smoothstep(r, FULL, e)
    const tallest = PATCH_KINDS[kind].height[1]
    const scale = Math.min(room / tallest, f.size * (0.8 + 0.4 * rand()) * (1 - 0.4 * far))
    add(kind, {
      x,
      z,
      y: heightAt(x, z),
      yaw: f.yaw + (rand() - 0.5) * 1.1,
      scale,
      spread: 1 + 1.4 * smoothstep(r, FULL, OUTER),
      color: colour(f, kind, far),
    })
    n++
  }

  // ─── the short sward, close in ────────────────────────────────────────────
  for (let t = 0, b = 0; b < BASE && t < BASE * 6; t++) {
    const r = Math.sqrt(rand()) * (SWARD + 10)
    const a = rand() * Math.PI * 2
    const x = Math.cos(a) * r
    const z = Math.sin(a) * r
    if (keepClear(x, z) || rand() > 1 - smoothstep(r, SWARD - 8, SWARD + 10)) continue
    const f = field(x, z)
    add('base', { x, z, y: heightAt(x, z), yaw: f.yaw + (rand() - 0.5) * 2, scale: f.size * (0.8 + 0.5 * rand()), spread: 1.3, color: colour(f, 'base', 0).multiplyScalar(0.92) })
    b++
  }

  // ─── one InstancedMesh per patch variant ──────────────────────────────────
  const group = new THREE.Group()
  group.name = 'meadow'
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  let triangles = 0
  kinds.forEach((kind, ki) => {
    for (let v = 0; v < VARIANTS * 2; v++) {
      const lod = v % 2
      const list = spots.get(`${kind}|${v >> 1}|${lod}`) ?? []
      if (list.length === 0) continue
      const spec = { ...PATCH_KINDS[kind], seed: 100 + ki * 10 + (v >> 1) } as PatchSpec
      const geometry = grassPatch(lod ? farPatch(spec) : spec)
      const mesh = new THREE.InstancedMesh(geometry, material, list.length)
      list.forEach((sp, i) => {
        q.setFromAxisAngle(up, sp.yaw)
        mesh.setMatrixAt(i, m.compose(new THREE.Vector3(sp.x, sp.y - 0.02, sp.z), q, new THREE.Vector3(sp.scale * sp.spread, sp.scale, sp.scale * sp.spread)))
        mesh.setColorAt(i, sp.color)
      })
      // the tall stands cast onto the ground and each other; the rest is too low to matter
      mesh.castShadow = kind === 'tall' || kind === 'dry'
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      mesh.name = `meadow-${kind}-lod${lod}`
      triangles += (geometry.index!.count / 3) * list.length
      group.add(noRaycast(mesh))
    }
  })
  console.info(`[garage] meadow: ${n} patches + sward, ${(triangles / 1e6).toFixed(1)} M triangles`)
  return group
}

/** the lake: open water with long, slow ripples and a real (low-resolution) reflection */
function createLake(opts: LandscapeOptions, hide: () => THREE.Object3D[]): WaterSurface {
  const { lake, lakeLevel } = SITE
  // an ellipse a little larger than the shore: its edge stays under the land, inside the terrain's reach
  const surface = new THREE.CircleGeometry(1, 96).scale(lake.rx * 1.3, lake.rz * 1.3, 1)
  const lakeWater = createWater(surface, {
    sunDirection: opts.sunDirection,
    hideWhileReflecting: hide,
    scale: 22, // waves tens of metres long, not a pool's ripples
    distortion: 0.0015, // a calm lake: soft reflections, not streaks
    body: new THREE.Color().setRGB(0.02, 0.035, 0.045),
    resolution: 0.5, // it's far away: half the reflection setting's resolution is plenty
  })
  lakeWater.mesh.name = 'lake'
  // the plane runs under the shore; the terrain keeps clear of the water level (site.heightAt)
  lakeWater.mesh.position.set(lake.x, lakeLevel, lake.z)
  return lakeWater
}

/** the valley's vegetation plan (vegetation-layout.ts), with this site's rules for where things grow */
function planVegetation(opts: LandscapeOptions, houses: House[]): VegetationLayout {
  // houses on a coarse grid, so "not on a house" stays cheap
  const CELL = 40
  const lots = new Map<string, House[]>()
  for (const h of houses) {
    const k = `${Math.floor(h.x / CELL)},${Math.floor(h.z / CELL)}`
    lots.set(k, [...(lots.get(k) ?? []), h])
  }
  const onHouse = (x: number, z: number) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const h of lots.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(h.x - x, h.z - z) < Math.max(h.w, h.d) * 0.6 + 2.5) return true
    return false
  }
  const lakeNear = -SITE.lake.z - SITE.lake.rz
  return layoutVegetation(
    {
      radius: [40, SITE.realRadius - 30],
      // hillsides are woods; the valley floor is fields with copses and hedgerow trees
      wood: (x, z) => Math.max(0.1, woodedness(x, z)) * (1 - 0.6 * orchardFarmland(x, z)),
      conifers: (x, z) => 0.4 + 0.45 * smoothstep(heightAt(x, z) - SITE.lakeLevel, 40, 220),
      allowed(x, z, height) {
        const r = Math.hypot(x, z)
        if (r < 40 || r > SITE.realRadius - 30 || opts.keepClear(x, z)) return false
        if (lakeShape(x, z) < 1.04) return false
        if (onRoad(x, z) > 0 || (Math.abs(x) < SITE.road.extent && Math.abs(z - roadZ(x)) < 10)) return false
        if (onHouse(x, z)) return false
        const h = heightAt(x, z)
        const slope = Math.hypot(heightAt(x + 3, z) - h, heightAt(x, z + 3) - h) / 3
        if (slope > 1.2) return false // cliffs and cuttings (a one-sided difference: rougher than a central one)
        // between the pavilion and the lake: nothing may rise into the view of the water
        if (inView(x, z) && -z < lakeNear && roomBelowView(x, z) < height) return false
        return true
      },
    },
    7,
  )
}

export function createLandscape(opts: LandscapeOptions): Landscape {
  const group = new THREE.Group()
  group.name = 'landscape'
  const sky = createSky()
  const outdoor = new THREE.Group()
  outdoor.name = 'outdoor'

  const meadow = createMeadow(opts.keepClear)
  const roadside = createRoadside()
  const town = createTown()
  // every tree and shrub of the valley, decided up front: the terrain darkens the ground under them
  const layout = planVegetation(opts, town.houses) // ~2 s: the heaviest part of building the garage
  const terrain = createTerrain(layout.cover)
  const canopy = createCanopy(layout.cover)
  outdoor.add(terrain.mesh, canopy, town.group, createFujiMountain(), createRanges(), roadside.group, meadow)

  const farDetail: THREE.Object3D[] = [...roadside.details, canopy, town.group]
  // the lake can't show anything near the pavilion: skip it all in its mirror pass
  const nearDetail: THREE.Object3D[] = [meadow, roadside.group]
  const lake = createLake(opts, () => [...nearDetail, ...opts.hideFromLake()])
  group.add(sky.mesh, outdoor, lake.mesh)

  const forestReady = createForest({
    seed: 5,
    heightAt,
    layout,
    bushRoom: (x, z) => (opts.keepClear(x, z) || Math.abs(x) + Math.abs(z) <= 20 || forestDensity(x, z) >= 0.5 ? 0 : roomBelowView(x, z)),
    accents: ACCENTS,
  })
    .then(async (forest) => {
      outdoor.add(forest.group)
      // the village gardens and the far ranges' woods share the forest's impostors
      const greenery = createGreenery(town.houses, forest.impostors)
      const rangeForest = createRangeForest(forest.impostors)
      outdoor.add(greenery, rangeForest)
      farDetail.push(greenery, rangeForest)
      // (and the trees and bushes just outside: in the deck's blurred mirror they're a smudge by the sill,
      // and their leaf cards cost a few ms in every pass that draws them)
      farDetail.push(...forest.mid, ...forest.far, ...forest.bushes, ...forest.accents)
      nearDetail.push(...forest.near, ...forest.mid, ...forest.bushes)
      await forest.ready
    })
    .catch((err: unknown) => console.error('[garage] forest failed', err))
  const ready = Promise.all([forestReady, terrain.ready]).then(() => {})
  return { group, outdoor, sky, lake, farDetail, ready, setEvening: town.setEvening }
}
