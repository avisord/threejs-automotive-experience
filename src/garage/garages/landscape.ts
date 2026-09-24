import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createFujiMountain } from './fuji-mountain'
import { createCanopy } from './canopy'
import { fbm, noRaycast, seeded, smoothstep } from './landform'
import { createRanges } from './ranges'
import { createRoadside } from './roadside'
import { SITE, forestDensity, heightAt, roomBelowView } from './site'
import { createSky } from './sky'
import { createTerrain, outdoorMaterial } from './terrain'
import { createGreenery } from './greenery'
import { createTown } from './town'
import { createForest } from './trees'
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
 * Seven curved blades from one root, of different heights and leans, their tips
 * paler and yellower than their bases — one instance of the meadow.
 */
function grassClump(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = []
  const levels = [0, 0.35, 0.7, 1]
  const widths = [0.012, 0.01, 0.006, 0]
  const rand = seeded(3)
  for (let b = 0; b < 7; b++) {
    const turn = (b / 7) * Math.PI * 2 + rand() * 0.9
    const lean = 0.12 + rand() * 0.3
    const tall = 0.55 + rand() * 0.45
    // blades stand a little apart at the root
    const ox = (rand() - 0.5) * 0.06
    const oz = (rand() - 0.5) * 0.06
    const positions: number[] = []
    const colors: number[] = []
    for (const [k, y] of levels.entries()) {
      const bend = y * y * lean // curls over toward the tip
      for (const side of widths[k] ? [-1, 1] : [0]) {
        const lx = side * widths[k]
        positions.push(ox + Math.cos(turn) * lx - Math.sin(turn) * bend, y * tall, oz + Math.sin(turn) * lx + Math.cos(turn) * bend)
        // darker at the root, paler and yellower toward the tip
        const shade = 0.6 + 0.6 * y
        colors.push(shade * (1 + 0.25 * y), shade * (1 + 0.1 * y), shade * (1 - 0.25 * y))
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    // lit like the ground it grows from, so the meadow and the terrain match
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill([0, 1, 0]).flat(), 3))
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6])
    blades.push(g)
  }
  const clump = mergeGeometries(blades)!
  for (const g of blades) g.dispose()
  return clump
}

/**
 * Grass around the pavilion: a short mown lawn behind it (tall grass there
 * would hide the valley from inside), a meadow at the sides and front with
 * patches of taller grass.
 */
function createMeadow(keepClear: LandscapeOptions['keepClear']): THREE.InstancedMesh {
  const COUNT = 42000
  const INNER = 2
  const OUTER = 44
  const mesh = new THREE.InstancedMesh(
    grassClump(),
    outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide })),
    COUNT,
  )
  mesh.name = 'meadow'
  const rand = seeded(21)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  let n = 0
  for (let tries = 0; n < COUNT && tries < COUNT * 6; tries++) {
    const r = Math.sqrt(rand() * (OUTER * OUTER - INNER * INNER) + INNER * INNER)
    const a = rand() * Math.PI * 2
    p.set(Math.cos(a) * r, 0, Math.sin(a) * r)
    if (keepClear(p.x, p.z)) continue
    // thinner toward the edge, where the terrain's texture takes over
    if (rand() > 1 - 0.6 * smoothstep(r, OUTER * 0.6, OUTER)) continue
    p.y = heightAt(p.x, p.z)
    q.setFromAxisAngle(up, rand() * Math.PI * 2)
    // patches of taller, seeding grass
    const tall = smoothstep(fbm(p.x / 9 + 3, p.z / 9, 2), 0.55, 0.7)
    // …kept below the view of the valley past the glass (a fringe along the sill, not a screen)
    const room = roomBelowView(p.x, p.z)
    if (room < 0.25) continue
    const height = Math.min(room, 0.3 + rand() * 0.4 + tall * (0.5 + rand() * 0.4))
    s.set(0.8 + rand() * 0.5, height, 0.8 + rand() * 0.5)
    mesh.setMatrixAt(n, m.compose(p, q, s))
    // green, with drifts of dry golden grass (late in the season, as in the valley's fields)
    const dry = smoothstep(fbm(p.x / 5 + 9, p.z / 5 - 3, 2), 0.48, 0.62) * (0.6 + 0.4 * rand())
    c.setHSL(
      THREE.MathUtils.lerp(0.23 - tall * 0.04 + rand() * 0.04, 0.12 + rand() * 0.02, dry),
      THREE.MathUtils.lerp(0.4 + rand() * 0.2, 0.42, dry),
      THREE.MathUtils.lerp(0.27 + tall * 0.06 + rand() * 0.1, 0.42 + rand() * 0.08, dry),
      THREE.SRGBColorSpace,
    )
    mesh.setColorAt(n, c)
    n++
  }
  mesh.count = n
  mesh.computeBoundingSphere()
  return noRaycast(mesh)
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

export function createLandscape(opts: LandscapeOptions): Landscape {
  const group = new THREE.Group()
  group.name = 'landscape'
  const sky = createSky()
  const outdoor = new THREE.Group()
  outdoor.name = 'outdoor'

  const meadow = createMeadow(opts.keepClear)
  const roadside = createRoadside()
  const canopy = createCanopy()
  const town = createTown()
  const greenery = createGreenery(town.houses)
  const terrain = createTerrain()
  outdoor.add(terrain.mesh, canopy, town.group, greenery, createFujiMountain(), createRanges(), roadside.group, meadow)

  const farDetail: THREE.Object3D[] = [...roadside.details, canopy, town.group, greenery]
  // the lake can't show anything near the pavilion: skip it all in its mirror pass
  const nearDetail: THREE.Object3D[] = [meadow, roadside.group]
  const lake = createLake(opts, () => [...nearDetail, ...opts.hideFromLake()])
  group.add(sky.mesh, outdoor, lake.mesh)

  const forestReady = createForest({
    seed: 5,
    heightAt,
    density: forestDensity,
    bushRoom: (x, z) => (opts.keepClear(x, z) || Math.abs(x) + Math.abs(z) <= 20 || forestDensity(x, z) >= 0.5 ? 0 : roomBelowView(x, z)),
    accents: ACCENTS,
  })
    .then(async (forest) => {
      outdoor.add(forest.group)
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
