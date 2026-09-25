import * as THREE from 'three'
import type { AtmosphereParams } from '../atmosphere-effect'
import { aimFarShadow, createFarShadowLight } from './far-shadow'
import type { Room } from './kit'
import { WIND } from './foliage'
import { createLandscape, type Landscape } from './landscape'
import { SITE } from './site'
import { sunDirection, sunLight, type SunPosition } from './sky'

/**
 * Late afternoon, low from the right (west, looking south to Fuji from its
 * northern lakes) and a little toward the camera: golden side light, so Fuji's
 * face and snow catch the sun while its left flank falls into shade. (Straight
 * behind the camera lights everything flat; from beyond the mountain its face
 * is all shadow.)
 */
export const DEFAULT_SUN: SunPosition = { azimuth: 70, elevation: 14 }

export interface FujiWorldOptions {
  /** true where no grass, shrub or tree may grow (a building's footprint, a pool, a gravel pad) */
  keepClear(x: number, z: number): boolean
  /** the room's own things the lake's mirror needn't draw */
  hideFromLake(): THREE.Object3D[]
  /** raise the land by this much (the car stands at y = 0: a garage without a deck lifts the lawn to it) */
  lift?: number
  /** dustier air in this box (under a roof), its density set by `onSun` */
  dust?: THREE.Box3
  /** the room's own reaction to the sun (key lights, a pool's glint, dust) */
  onSun?(sun: { direction: THREE.Vector3; elevation: number; day: number; atmosphere: AtmosphereParams }): void
}

export interface FujiWorld {
  landscape: Landscape
  sun: THREE.DirectionalLight
  atmosphere: AtmosphereParams
  /** resolves once the landscape's trees and textures are in and the shadows re-rendered */
  ready: Promise<void>
  /** the open-air Room hooks — spread into the room */
  hooks: Pick<Room, 'outdoor' | 'sun' | 'atmosphere' | 'shadowsChanged'>
  resize(width: number, height: number, pixelRatio: number): void
  setReflectionScale(scale: number): void
  update(dt: number): void
}

/**
 * The world around the Fuji garages: the landscape (landscape.ts), a movable
 * sun with its sharp near shadow and the landscape-wide far shadow, the sky's
 * fill, and the air — everything but the room itself.
 */
export function createFujiWorld(group: THREE.Group, opts: FujiWorldOptions): FujiWorld {
  const lift = opts.lift ?? 0
  const landscape = createLandscape({
    keepClear: opts.keepClear,
    sunDirection: sunDirection(DEFAULT_SUN),
    hideFromLake: opts.hideFromLake,
  })
  landscape.group.position.y = lift
  group.add(landscape.group)

  // Its shadow covers the room and the ground around it; the map is only re-rendered when the sun
  // moves or a car comes or goes (shadowsChanged), not in every mirror pass of every frame.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.03
  sun.shadow.autoUpdate = false
  group.add(sun) // aims at the origin by default
  // …and the whole landscape's shadows, coarser (far-shadow.ts) — must come right after the sun
  const farShadow = createFarShadowLight()
  group.add(farShadow)
  const fill = new THREE.HemisphereLight(0xbcd2f0, 0x5a6a3c, 0.45)
  group.add(fill)

  // the air: distance haze and light shafts, kept in step with the sun (atmosphere-effect.ts)
  const atmosphere: AtmosphereParams = {
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    airColor: new THREE.Color(),
    // Late-afternoon air: ~55 km visibility at the lake (extinction 3.9 / 55 km), thinning with a
    // ~1.2 km scale height, and a low mist in the valleys. The road is crisp, the far shore softens,
    // each range stands paler than the one in front with its foot in the mist, and Fuji at 17 km
    // is veiled blue low down while its snow still stands clear.
    density: 7e-5,
    falloff: 1 / 1200,
    mist: { density: 5e-5, falloff: 1 / 220 },
    groundY: SITE.lakeLevel + lift,
    compress: SITE.compress, // far layers are drawn closer than they are (site.ts): haze them for their real distance
    shaftLight: sun,
    shaftDensity: 0.006, // clear open air: a faint glow toward the sun
    shaftRange: 40,
    dust: opts.dust ? { box: opts.dust, density: 0 } : undefined,
  }
  // a touch darker and bluer than the horizon sky: far ridges sit just below it in value, so each
  // one reads against the sky and against the paler one behind (brighter haze washed them all out)
  const noonAir = new THREE.Color(0.27, 0.35, 0.52)
  const lowAir = new THREE.Color(0.42, 0.33, 0.32)

  let sunAt: SunPosition = { ...DEFAULT_SUN }
  function applySun(next: SunPosition): void {
    sunAt = { ...next }
    const dir = sunDirection(sunAt)
    const light = sunLight(sunAt.elevation)
    const day = THREE.MathUtils.smoothstep(sunAt.elevation, 0, 25) // 0 at the horizon, 1 in full day
    landscape.sky.setSun(dir)
    sun.position.copy(dir).multiplyScalar(150)
    sun.color.copy(light.color)
    // a clear day's sun outshines the sky several times over — that contrast is what reads as sunlight
    sun.intensity = light.intensity * 1.7
    sun.shadow.needsUpdate = true
    aimFarShadow(farShadow, dir)
    fill.intensity = 0.04 + 0.06 * day // bounce from the grass; the sky's own fill is the env map
    fill.color.setRGB(0.74, 0.82, 0.94).lerp(new THREE.Color(0.9, 0.7, 0.6), 1 - day)
    landscape.lake.setSunDirection(dir)
    atmosphere.sunDirection.copy(dir)
    atmosphere.sunColor.copy(light.color).multiplyScalar(light.intensity * 0.35)
    // the air is lit by the whole sky, so it stays blue at a low sun, only a little warmer and dimmer;
    // the gold is in the forward scattering toward the sun (sunColor)
    atmosphere.airColor.copy(noonAir).lerp(lowAir, 0.35 * (1 - day)).multiplyScalar(0.4 + 0.6 * day)
    // the lake mirrors hills kilometres off: give their reflection the air they're seen through
    landscape.lake.setHaze(atmosphere.airColor, 0.35)
    landscape.setEvening(1 - THREE.MathUtils.smoothstep(sunAt.elevation, 4, 22))
    opts.onSun?.({ direction: dir, elevation: sunAt.elevation, day, atmosphere })
  }
  applySun(sunAt)

  return {
    landscape,
    sun,
    atmosphere,
    ready: landscape.ready.then(() => {
      sun.shadow.needsUpdate = true // the trees are in: they cast too
      farShadow.shadow.needsUpdate = true
    }),
    hooks: {
      outdoor: {
        root: landscape.outdoor,
        probe: new THREE.Vector3(0, 30, 70), // out front, high up: open sky, the land below
        beforeCapture: () => landscape.sky.showSunDisc(false),
        afterCapture: () => landscape.sky.showSunDisc(true),
      },
      sun: {
        get: () => ({ ...sunAt }),
        set: applySun,
      },
      atmosphere,
      shadowsChanged: () => {
        sun.shadow.needsUpdate = true
      },
    },
    resize: (width, height, pixelRatio) => landscape.lake.resize(width, height, pixelRatio),
    setReflectionScale: (scale) => landscape.lake.setReflectionScale(scale),
    update: (dt) => {
      landscape.lake.update(dt)
      WIND.time.value += dt // grass and trees sway (foliage.ts) — only while frames are drawn
    },
  }
}
