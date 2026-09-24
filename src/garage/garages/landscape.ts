import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createFujiMountain } from './fuji-mountain'
import { fbm, noRaycast, seeded, smoothstep } from './landform'
import { createRanges } from './ranges'
import { createRoadside } from './roadside'
import { SITE, forestDensity, heightAt, inView } from './site'
import { createSky } from './sky'
import { createTerrain, outdoorMaterial } from './terrain'
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
}

/** three curved blades from one root — one instance of the meadow */
function grassClump(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = []
  const levels = [0, 0.35, 0.7, 1]
  const widths = [0.024, 0.02, 0.012, 0]
  for (let b = 0; b < 3; b++) {
    const turn = (b / 3) * Math.PI * 2 + b * 0.7
    const lean = 0.18 + b * 0.07
    const positions: number[] = []
    const colors: number[] = []
    for (const [k, y] of levels.entries()) {
      const bend = y * y * lean // curls over toward the tip
      for (const side of widths[k] ? [-1, 1] : [0]) {
        const lx = side * widths[k]
        positions.push(Math.cos(turn) * lx - Math.sin(turn) * bend, y, Math.sin(turn) * lx + Math.cos(turn) * bend)
        const shade = 0.45 + 0.55 * y // darker at the root
        colors.push(shade, shade, shade)
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
  const COUNT = 38000
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
    // the lawn behind the pavilion, toward the view, is mown: no meadow grass there
    if (p.z < -8) continue
    // thinner toward the edge, where the terrain's texture takes over
    if (rand() > 1 - 0.6 * smoothstep(r, OUTER * 0.6, OUTER)) continue
    p.y = heightAt(p.x, p.z)
    q.setFromAxisAngle(up, rand() * Math.PI * 2)
    // patches of taller, seeding grass
    const tall = smoothstep(fbm(p.x / 9 + 3, p.z / 9, 2), 0.55, 0.7)
    const height = 0.3 + rand() * 0.4 + tall * (0.5 + rand() * 0.4)
    s.set(0.8 + rand() * 0.5, height, 0.8 + rand() * 0.5)
    mesh.setMatrixAt(n, m.compose(p, q, s))
    c.setHSL(0.24 - tall * 0.05 + rand() * 0.04, 0.45 + rand() * 0.2, 0.25 + tall * 0.08 + rand() * 0.08, THREE.SRGBColorSpace)
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
  outdoor.add(createTerrain(), createFujiMountain(), createRanges(), roadside.group, meadow)

  const farDetail: THREE.Object3D[] = [...roadside.details]
  // the lake can't show anything near the pavilion: skip it all in its mirror pass
  const nearDetail: THREE.Object3D[] = [meadow, roadside.group]
  const lake = createLake(opts, () => [...nearDetail, ...opts.hideFromLake()])
  group.add(sky.mesh, outdoor, lake.mesh)

  const ready = createForest({
    seed: 5,
    heightAt,
    density: forestDensity,
    bushAllowed: (x, z) =>
      !opts.keepClear(x, z) && !(z < -8 && inView(x, z)) && Math.abs(x) + Math.abs(z) > 20 && forestDensity(x, z) < 0.5,
  })
    .then(async (forest) => {
      outdoor.add(forest.group)
      farDetail.push(...forest.mid, ...forest.far)
      nearDetail.push(...forest.near, ...forest.mid, ...forest.bushes)
      await forest.ready
    })
    .catch((err: unknown) => console.error('[garage] forest failed', err))
  return { group, outdoor, sky, lake, farDetail, ready }
}
