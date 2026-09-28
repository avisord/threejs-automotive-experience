import * as THREE from 'three'
import type { AtmosphereParams } from '../../atmosphere-effect'
import { GROUND_BOUNCE, WALL_BOUNCE, aimFarShadow, createFarShadowLight } from '../far-shadow'
import type { Room } from '../kit'
import { createSky, sunDirection, sunLight, type SunPosition } from '../sky'
import { createCumulus } from '../coast/clouds'

/**
 * Late afternoon: the sun behind the camera's right shoulder (−x, −z) at a
 * third of the way up the sky, so the left-hand facades (facing −x) stand in warm light, the
 * right-hand houses shade their own pavement and half the broad road, the car's
 * shadow falls forward and to its left, and the view up the street looks away
 * from the sun into clear blue. (Looking into a low sun the street was all
 * shade — nine-metre houses throw it right across — under a backlit grey
 * cloud deck.)
 */
export const STREET_SUN: SunPosition = { azimuth: -140, elevation: 34 }

/** the mean albedo round the car — stone paving, plaster (linear), for the bounce light */
const GROUND_ALBEDO = new THREE.Color(0.2, 0.18, 0.15)
/** the facades' mean albedo (linear): warm pastels and white render */
const FACADE_ALBEDO = new THREE.Color(0.5, 0.42, 0.34)
/** a hand on the canyon bounce, for tuning against photographs */
const WALL_BOUNCE_GAIN = 1.4

export interface StreetWorld {
  sun: THREE.DirectionalLight
  atmosphere: AtmosphereParams
  hooks: Pick<Room, 'sun' | 'atmosphere' | 'shadowsChanged'>
  /** re-render both sun shadow maps (the trees arrived, a car came or went) */
  shadowsChanged(): void
  sky: ReturnType<typeof createSky>
  cumulus: THREE.Group
  /** the older, constant canyon bounce (off while the street's light probes measure it) */
  setWallBounce(on: boolean): void
  dispose(): void
}

/** the sky, the sun with its near and town-wide shadows, the sky's fill, and the air */
export function createStreetWorld(group: THREE.Group): StreetWorld {
  const sky = createSky({ coverage: 0.3, scale: 0.5, density: 0.8 })
  // heaped fair-weather cumulus round the horizon (impostor cards 11.5 km out), over the sky's thin deck
  const cumulus = createCumulus()
  group.add(sky.mesh, cumulus.group)

  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.05
  sun.shadow.autoUpdate = false
  group.add(sun)
  // The far map (must come right after the sun: far-shadow.ts): here it covers the town rather than a
  // landscape — ±1.5 km at 0.7 m texels, so the houses shade the street and each other all the way up it.
  const farShadow = createFarShadowLight()
  Object.assign(farShadow.shadow.camera, { left: -1500, right: 1500, top: 1500, bottom: -1500 })
  farShadow.shadow.camera.updateProjectionMatrix()
  farShadow.shadow.normalBias = 0.6
  group.add(farShadow)
  const fill = new THREE.HemisphereLight(0xbcd2f0, 0x6a5e4c, 0.45)
  group.add(fill)

  // highland air: clear, with a blue haze that pales the hills a few kilometres off and the far ranges
  const atmosphere: AtmosphereParams = {
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    airColor: new THREE.Color(),
    // (~15 km visibility at street level: the hill at the valley's head, 2–3 km off, stands pale and
    // blue-green behind the rooftops — at 45 km it kept the near hills' dark green and read as a wall)
    density: 2e-4,
    falloff: 1 / 700,
    air: { density: 6e-5, falloff: 1 / 2500 },
    groundY: -10,
    shaftLight: sun,
    shaftDensity: 0.004,
    shaftRange: 40,
  }
  const dayAir = new THREE.Color(0.3, 0.4, 0.62)
  const lowAir = new THREE.Color(0.3, 0.37, 0.56)

  let wallBounceOn = true
  let sunAt: SunPosition = { ...STREET_SUN }
  function applySun(next: SunPosition): void {
    sunAt = { ...next }
    const dir = sunDirection(sunAt)
    const light = sunLight(sunAt.elevation)
    const day = THREE.MathUtils.smoothstep(sunAt.elevation, 0, 25)
    sky.setSun(dir)
    cumulus.setSun(dir, light.color, day)
    sun.position.copy(dir).multiplyScalar(200)
    sun.color.copy(light.color)
    sun.intensity = light.intensity * 1.7
    sun.shadow.needsUpdate = true
    aimFarShadow(farShadow, dir)
    fill.intensity = 0.04 + 0.06 * day
    fill.color.setRGB(0.74, 0.82, 0.94).lerp(new THREE.Color(0.9, 0.7, 0.6), 1 - day)
    const onGround = sun.intensity * Math.max(0, Math.sin(THREE.MathUtils.degToRad(sunAt.elevation))) * 2
    GROUND_BOUNCE.value.copy(GROUND_ALBEDO).multiply(sun.color).multiplyScalar(onGround)
    // the sunny facades lighting the street: pastel render (ρ ~0.45, warm) under the sun's light on a wall
    // (∝ cos elevation), about half of them in sun, filling ~a third of what a point in the street sees,
    // ×2 for the light going on between the walls and the paving
    const onWalls = (wallBounceOn ? 1 : 0) * sun.intensity * Math.cos(THREE.MathUtils.degToRad(sunAt.elevation)) * 0.7
    WALL_BOUNCE.value.copy(FACADE_ALBEDO).multiply(sun.color).multiplyScalar(onWalls * 0.5 * 0.35 * 2 * WALL_BOUNCE_GAIN)
    atmosphere.sunDirection.copy(dir)
    atmosphere.sunColor.copy(light.color).multiplyScalar(light.intensity * 0.35)
    atmosphere.airColor.copy(dayAir).lerp(lowAir, 0.35 * (1 - day)).multiplyScalar(0.4 + 0.6 * day)
  }
  applySun(sunAt)

  return {
    sun,
    atmosphere,
    sky,
    cumulus: cumulus.group,
    setWallBounce(on) {
      wallBounceOn = on
      applySun(sunAt)
    },
    hooks: {
      sun: { get: () => ({ ...sunAt }), set: applySun },
      atmosphere,
      shadowsChanged: () => {
        sun.shadow.needsUpdate = true
        farShadow.shadow.needsUpdate = true
      },
    },
    shadowsChanged() {
      sun.shadow.needsUpdate = true
      farShadow.shadow.needsUpdate = true
    },
    dispose() {
      cumulus.atlas.dispose()
      GROUND_BOUNCE.value.setRGB(0, 0, 0)
      WALL_BOUNCE.value.setRGB(0, 0, 0)
    },
  }
}
