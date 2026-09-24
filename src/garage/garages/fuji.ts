import * as THREE from 'three'
import { SURFACES, assembleRoom, box, boxUV, createFloor, glowMaterial, pbrMaps, type GarageDef, type Room } from './kit'
import type { AtmosphereParams } from '../atmosphere-effect'
import { createLandscape } from './landscape'
import { sunDirection, sunLight, type SunPosition } from './sky'
import { createWater } from './water'

/** platform the pavilion stands on (x × z), and its roof height */
const DECK = { w: 26, d: 22 }
const ROOF_Y = 5.5
/** skylight cut into the roof over the car (x × z) */
const SKY = { w: 4, d: 9 }
/** the grass around the deck */
const GROUND_Y = -0.6
/** the reflecting pool in front of the open side (z extent past the deck) */
const POOL = { d: 8, water: -0.28 }
/** front right, mid-morning: lights the car's face and Fuji's near slope, and shapes both */
const DEFAULT_SUN: SunPosition = { azimuth: -40, elevation: 34 }

/**
 * An open concrete-and-glass pavilion on grassland below Mount Fuji, under a
 * clear sky. A cast concrete wall on one side, floor-to-ceiling glass
 * on two others, the front open to a reflecting pool — and a cantilevered
 * roof slab with a skylight over the car. The world around it is landscape.ts.
 */
function createFujiPavilion(): Room {
  const { w, d } = DECK
  const group = new THREE.Group()
  group.name = 'fuji-pavilion'

  // ─── the world outside ───────────────────────────────────────────────────
  const inPool = (x: number, z: number) => Math.abs(x) < w / 2 + 0.4 && z > d / 2 - 0.1 && z < d / 2 + POOL.d + 0.5
  const underDeck = (x: number, z: number) => Math.abs(x) < w / 2 + 0.15 && Math.abs(z) < d / 2 + 0.15
  const landscape = createLandscape({
    groundY: GROUND_Y,
    keepClear: (x, z) => underDeck(x, z) || inPool(x, z),
  })
  group.add(landscape.group)

  // photographed concrete (kit SURFACES): polished floor concrete for the deck and everything
  // at ground level, cast panels for the wall and the roof slab. UVs are in metres (boxUV),
  // so each set of maps is loaded once and shared by every piece it covers.
  const floorMaps = pbrMaps(SURFACES.concreteFloor)
  const panelMaps = pbrMaps(SURFACES.concretePanels)
  const concrete = new THREE.MeshStandardMaterial({ ...floorMaps.maps, color: 0xffffff, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) })
  const panels = new THREE.MeshStandardMaterial({ ...panelMaps.maps, color: 0xe4e2de, roughness: 1 })
  /** a concrete box, textured at true scale */
  const cast = (size: [number, number, number], material: THREE.MeshStandardMaterial, at: [number, number, number]) => {
    const mesh = box(group, size, material, at)
    boxUV(mesh.geometry, material === panels ? SURFACES.concretePanels.tile : SURFACES.concreteFloor.tile)
    return mesh
  }
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.4, metalness: 0.8 })

  // ─── the platform: polished concrete over a soft mirror ─────────────────
  cast([w, -GROUND_Y, d], concrete, [0, GROUND_Y / 2 - 0.01, 0]) // its edge, top just under the floor
  // uvs in tiles of the floor texture, so the deck shares its maps with the edges
  const deck = new THREE.PlaneGeometry(w, d)
  const deckUV = deck.attributes.uv
  for (let k = 0; k < deckUV.count; k++) deckUV.setXY(k, (deckUV.getX(k) * w) / SURFACES.concreteFloor.tile, (deckUV.getY(k) * d) / SURFACES.concreteFloor.tile)
  const floor = createFloor(group, {
    geometry: deck,
    tint: 0x8a8a8a,
    blur: 0.016,
    surface: new THREE.MeshStandardMaterial({
      ...floorMaps.maps,
      color: 0xffffff,
      roughness: 0.75, // × the map: polished, with duller patches
      normalScale: new THREE.Vector2(0.6, 0.6),
      metalness: 0.02,
      opacity: 0.8,
    }),
  })


  // ─── the reflecting pool in front, with stepping stones ─────────────────
  const water = createWater(new THREE.PlaneGeometry(w, POOL.d), {
    sunDirection: sunDirection(DEFAULT_SUN),
    // the deck's own mirror would render again inside this one; far forests are a few pixels in the pool
    hideWhileReflecting: () => [floor.reflector, ...landscape.farDetail],
  })
  water.mesh.position.set(0, POOL.water, d / 2 + POOL.d / 2)
  group.add(water.mesh)
  // …and the other way round: the deck's mirror doesn't need to see the pool below its edge
  floor.floorLayers.push(water.mesh)
  const rimH = POOL.water - GROUND_Y + 0.06
  cast([w + 0.6, rimH, 0.3], concrete, [0, GROUND_Y + rimH / 2, d / 2 + POOL.d + 0.15])
  for (const side of [-1, 1]) cast([0.3, rimH, POOL.d], concrete, [side * (w / 2 + 0.15), GROUND_Y + rimH / 2, d / 2 + POOL.d / 2])
  for (let i = 0; i < 5; i++) {
    const stone = cast([1.3, 0.3, 0.7], concrete, [1.4 + (i % 2) * 0.7, POOL.water + 0.02, d / 2 + 1.1 + i * 1.5])
    stone.rotation.y = (i % 2 ? 1 : -1) * 0.08
  }
  const OUT_FRONT = 10 // how far past the deck, over the pool, the camera may go

  // ─── the concrete wall (left) ────────────────────────────────────────────
  cast([0.5, ROOF_Y, d], panels, [-w / 2 + 1.5, ROOF_Y / 2, 0])
  // a warm cove light washing up the wall from a slot in the floor
  const cove = new THREE.Mesh(new THREE.PlaneGeometry(d - 1, 0.06), glowMaterial(0xffd2a0, 4))
  cove.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  cove.position.set(-w / 2 + 1.85, 0.005, 0)
  group.add(cove)
  const wash = new THREE.RectAreaLight(0xffc890, 2.2, d - 1, 1.2)
  wash.position.set(-w / 2 + 2.1, 0.3, 0)
  wash.lookAt(-w / 2 + 1.75, 3, 0)
  group.add(wash)

  // ─── glass: floor to roof on the right and at the back ──────────────────
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xb9ccd4,
    roughness: 0.04,
    metalness: 0,
    transparent: true,
    opacity: 0.14,
    envMapIntensity: 1.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  const glassX = w / 2 - 1.5
  const glassZ = -d / 2 + 1
  const rightPane = new THREE.Mesh(new THREE.PlaneGeometry(d / 2 - 1 - glassZ, ROOF_Y), glass)
  rightPane.rotation.y = -Math.PI / 2
  rightPane.position.set(glassX, ROOF_Y / 2, (glassZ + d / 2 - 1) / 2)
  group.add(rightPane)
  const backPane = new THREE.Mesh(new THREE.PlaneGeometry(glassX - (-w / 2 + 1.75), ROOF_Y), glass)
  backPane.position.set((glassX + (-w / 2 + 1.75)) / 2, ROOF_Y / 2, glassZ)
  group.add(backPane)
  // slim mullions and a floor channel; thin enough that the video camera ignores them (see main.ts)
  for (let z = glassZ; z <= d / 2 - 1 + 1e-3; z += (d - 2) / 7) box(group, [0.05, ROOF_Y, 0.12], darkSteel, [glassX, ROOF_Y / 2, z])
  for (let x = glassX; x >= -w / 2 + 1.75; x -= (glassX + w / 2 - 1.75) / 8) box(group, [0.12, ROOF_Y, 0.05], darkSteel, [x, ROOF_Y / 2, glassZ])
  box(group, [0.05, 0.05, d - 2], darkSteel, [glassX, 0.025, 0])
  box(group, [glassX + w / 2 - 1.75, 0.05, 0.05], darkSteel, [(glassX - w / 2 + 1.75) / 2, 0.025, glassZ])

  // ─── the roof: a cantilevered slab with a skylight cut over the car ─────
  const roofW = w + 2
  const roofD = d + 2
  const t = 0.5
  const y = ROOF_Y + t / 2
  const sideW = (roofW - SKY.w) / 2
  const endD = (roofD - SKY.d) / 2
  cast([sideW, t, roofD], panels, [-(SKY.w + sideW) / 2, y, 0])
  cast([sideW, t, roofD], panels, [(SKY.w + sideW) / 2, y, 0])
  cast([SKY.w, t, endD], panels, [0, y, (SKY.d + endD) / 2])
  cast([SKY.w, t, endD], panels, [0, y, -(SKY.d + endD) / 2])
  const skylight = new THREE.Mesh(new THREE.PlaneGeometry(SKY.w, SKY.d), glass)
  skylight.rotation.x = Math.PI / 2
  skylight.position.set(0, ROOF_Y + t - 0.02, 0)
  group.add(skylight)
  // daylight falling through it (scaled with the sun, see applySun)
  const skyLight = new THREE.RectAreaLight(0xdce8ff, 4, SKY.w, SKY.d)
  skyLight.position.set(0, ROOF_Y + 0.1, 0)
  skyLight.up.set(0, 0, -1)
  skyLight.lookAt(0, 0, 0)
  group.add(skyLight)
  // recessed LED slots in the ceiling, framing the skylight and running out to the edges
  const led = glowMaterial(0xfff1dc, 5)
  for (const side of [-1, 1]) {
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.05, roofD - 1), led)
    slot.rotation.x = Math.PI / 2
    slot.position.set(side * (SKY.w / 2 + 0.35), ROOF_Y - 0.005, 0)
    group.add(slot)
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(0.05, roofD - 1), led)
    outer.rotation.x = Math.PI / 2
    outer.position.set(side * (SKY.w / 2 + 4.5), ROOF_Y - 0.005, 0)
    group.add(outer)
  }
  const ceilingLight = new THREE.RectAreaLight(0xfff0dc, 1.4, SKY.w + 9, roofD - 4)
  ceilingLight.position.set(0, ROOF_Y - 0.05, 0)
  ceilingLight.up.set(0, 0, -1)
  ceilingLight.lookAt(0, 0, 0)
  group.add(ceilingLight)
  // two slim columns carry the open corners
  for (const z of [glassZ, d / 2 - 1]) {
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, ROOF_Y, 20), darkSteel)
    column.position.set(glassX, ROOF_Y / 2, z)
    group.add(column)
  }

  // ─── the sun, and the sky and grass filling in ──────────────────────────
  // Its shadow covers the pavilion and the ground around it; the map is only
  // re-rendered when the sun moves or a car comes or goes (shadowsChanged),
  // not in every mirror pass of every frame.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 300 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.bias = -0.0002
  sun.shadow.normalBias = 0.03
  sun.shadow.autoUpdate = false
  group.add(sun) // aims at the origin by default
  const fill = new THREE.HemisphereLight(0xbcd2f0, 0x5a6a3c, 0.45)
  group.add(fill)
  // the pavilion's structure casts the sun's shadow; glass and light strips don't
  for (const obj of group.children) {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && [concrete, panels, darkSteel].includes(mesh.material as THREE.MeshStandardMaterial)) mesh.castShadow = true
  }

  // the air: distance haze and light shafts, kept in step with the sun (atmosphere-effect.ts)
  const atmosphere: AtmosphereParams = {
    sunDirection: new THREE.Vector3(),
    sunColor: new THREE.Color(),
    airColor: new THREE.Color(),
    density: 0.00028, // a clear day: the far ridges soften, the mountain stays crisp
    falloff: 0.004, // thins out over a few hundred metres of height
    groundY: GROUND_Y,
    shaftLight: sun,
    shaftDensity: 0.006, // clear open air: a faint glow toward the sun
    shaftRange: 40,
    // under the roof the air is dustier: sunbeams through the skylight and the open front read clearly
    dust: { box: new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, ROOF_Y, d / 2 + 1)), density: 0.07 },
  }
  const noonAir = new THREE.Color(0.5, 0.62, 0.8)
  const lowAir = new THREE.Color(0.75, 0.52, 0.42)

  let sunAt: SunPosition = { ...DEFAULT_SUN }
  function applySun(next: SunPosition): void {
    sunAt = { ...next }
    const dir = sunDirection(sunAt)
    const light = sunLight(sunAt.elevation)
    const day = THREE.MathUtils.smoothstep(sunAt.elevation, 0, 25) // 0 at the horizon, 1 in full day
    landscape.sky.setSun(dir)
    sun.position.copy(dir).multiplyScalar(150)
    sun.color.copy(light.color)
    sun.intensity = light.intensity
    sun.shadow.needsUpdate = true
    fill.intensity = 0.15 + 0.3 * day
    fill.color.setRGB(0.74, 0.82, 0.94).lerp(new THREE.Color(0.9, 0.7, 0.6), 1 - day)
    skyLight.intensity = 1 + 3 * day
    water.setSunDirection(dir)
    atmosphere.sunDirection.copy(dir)
    atmosphere.sunColor.copy(light.color).multiplyScalar(light.intensity * 0.35)
    atmosphere.airColor.copy(lowAir).lerp(noonAir, day).multiplyScalar(0.35 + 0.65 * day)
  }
  applySun(sunAt)

  const room = assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 2.3, 0.3, -d / 2 + 1.6],
      [glassX - 0.6, ROOF_Y - 0.5, d / 2 + OUT_FRONT],
    ],
    background: 0xa7bdd8, // only until the sky is in
    environmentIntensity: 1,
    ready: Promise.all([landscape.ready, floorMaps.ready, panelMaps.ready]).then(() => {
      sun.shadow.needsUpdate = true // the trees are in: they cast too
      floor.floorLayers.push(...landscape.farDetail) // and the deck's mirror can skip the far ones
    }),
  })
  return {
    ...room,
    resize(width, height, pixelRatio) {
      room.resize(width, height, pixelRatio)
      water.resize(width, height, pixelRatio)
    },
    setReflectionScale(scale) {
      room.setReflectionScale(scale)
      water.setReflectionScale(scale)
    },
    update: water.update,
    outdoor: {
      root: landscape.outdoor,
      probe: new THREE.Vector3(0, 30, 70), // out front, above the roof: open sky, the land below
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
  }
}

export const fujiPavilion: GarageDef = {
  id: 'fuji',
  name: 'Fuji Pavilion',
  tag: 'Concrete and glass on open grassland, Mount Fuji under a clear sky',
  palette: ['#2f5f9e', '#a7bdd8', '#f4f6fa', '#5f8a2e'],
  look: 'natural',
  create: createFujiPavilion,
}
