import * as THREE from 'three'
import type { AtmosphereParams } from '../../atmosphere-effect'
import { aimFarShadow, createFarShadowLight } from '../far-shadow'
import type { Room } from '../kit'
import { WIND } from '../foliage'
import { createSky, sunDirection, sunLight, type SunPosition } from '../sky'
import { createOcean } from './ocean'
import { COAST, SEA, SURF } from './site'
import { COAST_SURFACES, createCoastTerrain } from './terrain'
import { createRocks } from './rocks'
import { createCoastRanges } from './ranges'
import { createCoastVegetation } from './vegetation'
import { pbrMaps } from '../kit'

/**
 * Golden hour over the sea: the sun low out past the left of the view, a
 * little ahead — it lies on the water as a glitter path, comes in through
 * the glass from the sea side, rakes across the car and throws the mullions'
 * and beams' shadows long over the floor, and gilds the cliff faces and the
 * palms' edges while the sky keeps the shade blue.
 */
export const COAST_SUN: SunPosition = { azimuth: -132, elevation: 8 }

export interface CoastWorldOptions {
  /** the room's own reaction to the sun (key lights, dust) */
  onSun?(sun: { direction: THREE.Vector3; elevation: number; day: number; atmosphere: AtmosphereParams }): void
  /** dustier air in this box (under the roof) */
  dust?: THREE.Box3
}

export interface CoastWorld {
  /** everything lit by the open sky */
  outdoor: THREE.Group
  sun: THREE.DirectionalLight
  atmosphere: AtmosphereParams
  /** detail the garage's floor mirror can skip */
  farDetail: THREE.Object3D[]
  ready: Promise<void>
  hooks: Pick<Room, 'outdoor' | 'sun' | 'atmosphere' | 'shadowsChanged'>
  update(dt: number): void
}

/**
 * The world around the coastal garage: terrain and sea (and, added by later
 * layers, the rocks, plants and far mountains), the sky, a movable sun with
 * its near and landscape-wide shadows, and the air.
 */
export function createCoastWorld(group: THREE.Group, opts: CoastWorldOptions = {}): CoastWorld {
  const outdoor = new THREE.Group()
  outdoor.name = 'coast-outdoor'
  const sky = createSky()
  // every plant, planned first: the terrain darkens the ground under the woods
  const vegetation = createCoastVegetation({ bark: pbrMaps(COAST_SURFACES.palmBark) })
  // the cliff photo is shared by the terrain's rock faces and the rocks themselves
  const cliffMaps = pbrMaps(COAST_SURFACES.cliff)
  const terrain = createCoastTerrain(cliffMaps, vegetation.layout.cover)
  const ocean = createOcean()
  const rocks = createRocks(cliffMaps)
  const ranges = createCoastRanges()
  outdoor.add(terrain.mesh, ocean.mesh, rocks.group, ranges, vegetation.group)
  group.add(sky.mesh, outdoor)

  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.03
  sun.shadow.autoUpdate = false
  group.add(sun)
  const farShadow = createFarShadowLight() // must come right after the sun (far-shadow.ts)
  group.add(farShadow)
  const fill = new THREE.HemisphereLight(0xbcd2f0, 0x6a6a4c, 0.45)
  group.add(fill)

  // sea air: clear overhead, a salt haze low over the water that pales the far coast and the ranges
  const atmosphere: AtmosphereParams = {
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    airColor: new THREE.Color(),
    // (~80 km visibility at the water: the middle ridges keep their green, the big mountain turns blue)
    density: 4.5e-5,
    falloff: 1 / 600,
    air: { density: 2.2e-5, falloff: 1 / 2000 },
    groundY: SEA,
    compress: COAST.compress,
    shaftLight: sun,
    shaftDensity: 0.005,
    shaftRange: 40,
    dust: opts.dust ? { box: opts.dust, density: 0 } : undefined,
  }
  const noonAir = new THREE.Color(0.28, 0.4, 0.66)
  const lowAir = new THREE.Color(0.28, 0.37, 0.6) // (the air stays blue at a low sun: the gold is in the forward scatter)

  let sunAt: SunPosition = { ...COAST_SUN }
  function applySun(next: SunPosition): void {
    sunAt = { ...next }
    const dir = sunDirection(sunAt)
    const light = sunLight(sunAt.elevation)
    const day = THREE.MathUtils.smoothstep(sunAt.elevation, 0, 25)
    sky.setSun(dir)
    sun.position.copy(dir).multiplyScalar(150)
    sun.color.copy(light.color)
    sun.intensity = light.intensity * 1.7
    sun.shadow.needsUpdate = true
    aimFarShadow(farShadow, dir)
    fill.intensity = 0.04 + 0.06 * day
    fill.color.setRGB(0.74, 0.82, 0.94).lerp(new THREE.Color(0.9, 0.7, 0.6), 1 - day)
    ocean.setSunDirection(dir)
    atmosphere.sunDirection.copy(dir)
    atmosphere.sunColor.copy(light.color).multiplyScalar(light.intensity * 0.35)
    atmosphere.airColor.copy(noonAir).lerp(lowAir, 0.35 * (1 - day)).multiplyScalar(0.4 + 0.6 * day)
    opts.onSun?.({ direction: dir, elevation: sunAt.elevation, day, atmosphere })
  }
  applySun(sunAt)

  const farDetail: THREE.Object3D[] = [...rocks.far, ranges, ...vegetation.far]
  return {
    outdoor,
    sun,
    atmosphere,
    farDetail,
    ready: Promise.all([terrain.ready, cliffMaps.ready, vegetation.ready]).then(() => {
      farDetail.push(...vegetation.far.filter((o) => !farDetail.includes(o)))
      sun.shadow.needsUpdate = true
      farShadow.shadow.needsUpdate = true
    }),
    hooks: {
      outdoor: {
        root: outdoor,
        probe: new THREE.Vector3(0, 25, -60), // out past the glass, above the slope: open sky, the sea below
        beforeCapture: () => sky.showSunDisc(false),
        afterCapture: () => sky.showSunDisc(true),
      },
      sun: { get: () => ({ ...sunAt }), set: applySun },
      atmosphere,
      shadowsChanged: () => {
        sun.shadow.needsUpdate = true
      },
    },
    update(dt) {
      SURF.time.value += dt
      WIND.time.value += dt
    },
  }
}
