import * as THREE from 'three'
import type { AtmosphereParams } from '../../atmosphere-effect'
import { GROUND_BOUNCE, aimFarShadow, createFarShadowLight } from '../far-shadow'
import type { Room } from '../kit'
import { WIND } from '../foliage'
import { createSky, sunDirection, sunLight, type SunPosition } from '../sky'
import { createCumulus } from './clouds'
import { createOcean } from './ocean'
import { COAST, SEA, SURF } from './site'
import { COAST_SURFACES, createCoastTerrain } from './terrain'
import { createRocks } from './rocks'
import { createCoastRanges } from './ranges'
import { createCoastVegetation } from './vegetation'
import { pbrMaps } from '../kit'
import { ContactMap } from './contact'

/**
 * A clear tropical midday, as an open-world racing game shows it: the sun
 * high behind the camera's right shoulder, so everything the view faces is
 * sunlit, the car throws a short crisp shadow forward and to the left, and
 * the sea shows its turquoise shallows instead of a glitter path. (Golden
 * hour — the sun low out over the sea, `{ azimuth: -146, elevation: 10 }` —
 * is a sun preset away.)
 */
export const COAST_SUN: SunPosition = { azimuth: 55, elevation: 52 }

/** the mean albedo of the ground round the car (linear), for the bounce light */
const GROUND_ALBEDO = new THREE.Color(0.26, 0.26, 0.19)

export interface CoastWorldOptions {
  /** the room's own reaction to the sun (key lights, dust) */
  onSun?(sun: { direction: THREE.Vector3; elevation: number; day: number; atmosphere: AtmosphereParams }): void
  /** dustier air in this box (under the roof) */
  dust?: THREE.Box3
  /** plant the bed along the garage's glass (default true; the open-air overlook has no garage) */
  planter?: boolean
  /** what the room builds on the land (x0, z0, x1, z1): the ground darkens along their feet */
  footprints?: [number, number, number, number][]
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
  /** textures only shader uniforms hold (disposeTree frees material properties, not uniforms) */
  textures: THREE.Texture[]
  /** the world is going: free what the room's disposeTree can't reach, clear the ground bounce */
  dispose(): void
}

/**
 * The world around the coastal garage: terrain and sea (and, added by later
 * layers, the rocks, plants and far mountains), the sky, a movable sun with
 * its near and landscape-wide shadows, and the air.
 */
export function createCoastWorld(group: THREE.Group, opts: CoastWorldOptions = {}): CoastWorld {
  const outdoor = new THREE.Group()
  outdoor.name = 'coast-outdoor'
  // a clean upper sky, thin cloud banked low; the heaped cumulus are impostors (clouds.ts)
  const sky = createSky({ coverage: 0.38, scale: 0.42, density: 0.8 })
  const cumulus = createCumulus()
  // every plant, planned first: the terrain darkens the ground under the woods
  const vegetation = createCoastVegetation({ bark: pbrMaps(COAST_SURFACES.palmBark), planter: opts.planter ?? true })
  // the cliff photo is shared by the terrain's rock faces and the rocks themselves
  const cliffMaps = pbrMaps(COAST_SURFACES.cliff)
  const rocks = createRocks(cliffMaps)
  // where everything meets the ground: plants, rocks and the room's own footings
  const contact = new ContactMap()
  vegetation.stamp(contact)
  for (const f of rocks.feet) contact.blob(f.x, f.z, Math.max(f.w, f.d) * 0.62, 0.65, Math.min(f.w, f.d) * 0.3)
  for (const [x0, z0, x1, z1] of opts.footprints ?? []) contact.box(x0, z0, x1, z1, 0.9, 0.7)
  const contactMap = contact.texture()
  const terrain = createCoastTerrain(cliffMaps, vegetation.layout.cover, contactMap)
  const ocean = createOcean()
  const ranges = createCoastRanges()
  outdoor.add(terrain.mesh, ocean.mesh, rocks.group, ranges, vegetation.group)
  group.add(sky.mesh, cumulus.group, outdoor)

  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 })
  sun.shadow.camera.updateProjectionMatrix()
  // (a low sun grazes the floor: at the valley's bias it striped the lit floor with acne that crawled as
  // the camera moved)
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.06
  sun.shadow.autoUpdate = false
  group.add(sun)
  const farShadow = createFarShadowLight() // must come right after the sun (far-shadow.ts)
  group.add(farShadow)
  const fill = new THREE.HemisphereLight(0xbcd2f0, 0x6a6a4c, 0.45)
  group.add(fill)
  // Bounce: sunlit ground is a big dim lamp facing up. A Lambertian plane of albedo ρ under irradiance E
  // lights a surface facing straight down with ρ·E (and a wall with half that) — the light that fills
  // palm crowns' undersides, the shade inside bushes and every overhang on a bright day, where a
  // game's GI would. The landscape's materials add it (far-shadow.ts GROUND_BOUNCE). ×2 on the single
  // bounce: sky light on the ground adds ~a fifth to E, and the light goes on bouncing between the
  // leaves, the lawn and the stone (a tropical garden is mostly lit surfaces facing each other).

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
    cumulus.setSun(dir, light.color, day)
    sun.position.copy(dir).multiplyScalar(150)
    sun.color.copy(light.color)
    sun.intensity = light.intensity * 1.7
    sun.shadow.needsUpdate = true
    aimFarShadow(farShadow, dir)
    fill.intensity = 0.04 + 0.06 * day
    // (ρ: the terrace's pale stone and the lawn round it, a warm grey-green)
    const onGround = sun.intensity * Math.max(0, Math.sin(THREE.MathUtils.degToRad(sunAt.elevation))) * 2
    GROUND_BOUNCE.value.copy(GROUND_ALBEDO).multiply(sun.color).multiplyScalar(onGround)
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
    dispose() {
      for (const t of this.textures) t.dispose()
      GROUND_BOUNCE.value.setRGB(0, 0, 0)
    },
    textures: [...terrain.textures, contactMap.texture, cliffMaps.maps.map, cliffMaps.maps.normalMap, cliffMaps.maps.roughnessMap, cumulus.atlas],
  }
}
