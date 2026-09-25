import * as THREE from 'three'
import { SURFACES, assembleRoom, box, boxUV, createFloor, glowMaterial, pbrMaps, type GarageDef, type Room } from './kit'
import { DEFAULT_SUN, createFujiWorld } from './fuji-world'
import { createInteriorLights } from './interior'
import { GROUND } from './site'
import { sunDirection } from './sky'
import { createGlassMaterial, glassPane } from './glass'
import { createWater } from './water'

/** platform the pavilion stands on (x × z), and its roof height */
const DECK = { w: 26, d: 22 }
const ROOF_Y = 8.25
/** where the two rows of glass meet, a slim transom between them */
const TRANSOM = 4.4
/** skylight cut into the roof over the car (x × z) */
const SKY = { w: 4, d: 9 }
/** the lawn around the deck (site.ts lays out the land) */
const GROUND_Y = GROUND
/** the reflecting pool in front of the open side (z extent past the deck) */
const POOL = { d: 8, water: -0.28 }

/**
 * An open concrete-and-glass pavilion on a lawn terrace above a lake, with
 * Mount Fuji across the valley. A cast concrete wall on one side, floor-to-
 * ceiling glass on two others, the front open to a reflecting pool — and a
 * cantilevered roof slab with a skylight over the car. The world around it
 * is landscape.ts (laid out in site.ts).
 */
function createFujiPavilion(): Room {
  const { w, d } = DECK
  const group = new THREE.Group()
  group.name = 'fuji-pavilion'

  // ─── the world outside (fuji-world.ts) ──────────────────────────────────
  const inPool = (x: number, z: number) => Math.abs(x) < w / 2 + 0.4 && z > d / 2 - 0.1 && z < d / 2 + POOL.d + 0.5
  const underDeck = (x: number, z: number) => Math.abs(x) < w / 2 + 0.15 && Math.abs(z) < d / 2 + 0.15
  /** the pavilion itself: nothing the lake's mirror could show (filled once it's built) */
  const pavilionParts: THREE.Object3D[] = []
  // the pavilion's own reactions to the sun, wired once they exist (applySun runs before they do)
  let skyLight: THREE.RectAreaLight | null = null
  /** the skylight's designed output, following the sun; the user's dimmer scales it (interior) */
  let skyOutput = 6
  let interior: ReturnType<typeof createInteriorLights> | null = null
  let water: ReturnType<typeof createWater> | null = null
  const world = createFujiWorld(group, {
    keepClear: (x, z) => underDeck(x, z) || inPool(x, z),
    hideFromLake: () => pavilionParts,
    // under the roof the air is dustier: sunbeams through the skylight read clearly
    dust: new THREE.Box3(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, ROOF_Y, d / 2 + 1)),
    onSun({ direction, elevation, day, atmosphere }) {
      skyOutput = 6 + 2 * day // the key light: brighter by day, never off (unless the user switches it off)
      if (skyLight) skyLight.intensity = skyOutput
      interior?.refresh()
      water?.setSunDirection(direction)
      // a high sun drops a beam through the skylight; a low one floods the whole floor sideways, and
      // lit dust there is a veil over the car streaked with its shadow — so the dust fades with the sun
      atmosphere.dust!.density = 0.004 + 0.066 * THREE.MathUtils.smoothstep(elevation, 20, 45)
    },
  })
  const landscape = world.landscape

  // photographed concrete (kit SURFACES): polished floor concrete for the deck and everything
  // at ground level, cast panels for the wall and the roof slab. UVs are in metres (boxUV),
  // so each set of maps is loaded once and shared by every piece it covers.
  const floorMaps = pbrMaps(SURFACES.concreteFloor)
  const panelMaps = pbrMaps(SURFACES.concretePanels)
  const concrete = new THREE.MeshStandardMaterial({ ...floorMaps.maps, color: 0xffffff, roughness: 1, normalScale: new THREE.Vector2(0.8, 0.8) })
  const panels = new THREE.MeshStandardMaterial({ ...panelMaps.maps, color: 0xe4e2de, roughness: 1 })
  // the roof slab: the same concrete, glowing faintly with the light bounced up off the floor and
  // the car — lifts the ceiling out of black. (An up-facing area light did it at ~1.6 ms a frame:
  // three evaluates every area light on every lit pixel, the whole landscape included.)
  const ceiling = panels.clone()
  ceiling.emissive.setHex(0xe8dccb, THREE.SRGBColorSpace)
  ceiling.emissiveMap = panelMaps.maps.map ?? null
  ceiling.emissiveIntensity = 0.1
  /** a concrete box, textured at true scale */
  const cast = (size: [number, number, number], material: THREE.MeshStandardMaterial, at: [number, number, number]) => {
    const mesh = box(group, size, material, at)
    boxUV(mesh.geometry, material === concrete ? SURFACES.concreteFloor.tile : SURFACES.concretePanels.tile)
    return mesh
  }
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.4, metalness: 0.8 })

  // ─── the platform: polished concrete over a soft mirror ─────────────────
  cast([w, -GROUND_Y, d], concrete, [0, GROUND_Y / 2 - 0.01, 0]) // its edge, top just under the floor
  // uvs in tiles of the floor texture, so the deck shares its maps with the edges
  const deck = new THREE.PlaneGeometry(w, d)
  const deckUV = deck.attributes.uv
  for (let k = 0; k < deckUV.count; k++) deckUV.setXY(k, (deckUV.getX(k) * w) / SURFACES.concreteFloor.tile, (deckUV.getY(k) * d) / SURFACES.concreteFloor.tile)
  // dark polished concrete: the view, the car and the light strips show in it
  const floorSurface = new THREE.MeshStandardMaterial({
    ...floorMaps.maps,
    color: 0xd8d2c8, // the photographed concrete is already dark (~0.085 albedo): a touch darker and warmer
    roughness: 0.45, // × the map: polished, with duller patches
    normalScale: new THREE.Vector2(0.6, 0.6),
    metalness: 0.02,
    // a wet-look polish: the mirror below shows through strongly — the car, the bright windows
    opacity: 0.6,
    // the mirror under it does the reflections; the surface's own sheen of the room's environment
    // (the whole bright sky through the glass) turned the floor navy blue
    envMapIntensity: 0.05,
  })
  // A Fresnel mirror: faint seen from above, strong toward the glass at a grazing angle — the car
  // and the windows stand in it, but the bright sky past the roof edge doesn't turn the floor blue
  floorSurface.name = 'fuji-floor'
  const floor = createFloor(group, { geometry: deck, tint: 0xc8c8c8, fresnel: 0.05, blur: 0.005, lod: 1, surface: floorSurface })
  // sunlight falling in through the glass lies on the floor in patches, with the car's shadow
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === floorSurface) o.receiveShadow = true
  })

  // ─── the reflecting pool in front, with stepping stones ─────────────────
  water = createWater(new THREE.PlaneGeometry(w, POOL.d), {
    sunDirection: sunDirection(DEFAULT_SUN),
    // the deck's own mirror would render again inside this one; far forests are a few pixels in the pool
    // (and no mirror renders another inside its own pass: that would double the work)
    hideWhileReflecting: () => [floor.reflector, landscape.lake.mesh, ...landscape.farDetail],
  })
  water.mesh.position.set(0, POOL.water, d / 2 + POOL.d / 2)
  group.add(water.mesh)
  // …and the other way round: the deck's mirror doesn't need the pool below its edge, nor the lake
  floor.floorLayers.push(water.mesh, landscape.lake.mesh)
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
  const coveGlow = glowMaterial(0xffd2a0, 4)
  const cove = new THREE.Mesh(new THREE.PlaneGeometry(d - 1, 0.06), coveGlow)
  cove.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  cove.position.set(-w / 2 + 1.85, 0.005, 0)
  group.add(cove)
  const wash = new THREE.RectAreaLight(0xffc890, 2.2, d - 1, 1.2)
  wash.position.set(-w / 2 + 2.1, 0.3, 0)
  wash.lookAt(-w / 2 + 1.75, 3, 0)
  group.add(wash)

  // ─── glass: floor to roof on the right and at the back ──────────────────
  // Two panes high, one per bay between the mullions, each hung a fraction of a degree off true
  // (glass.ts): reflections step at every frame instead of running across the wall as one mirror.
  const glass = createGlassMaterial()
  const glassX = w / 2 - 1.5
  const glassZ = -d / 2 + 1
  const rows: [number, number][] = [
    [0, TRANSOM],
    [TRANSOM, ROOF_Y],
  ]
  let paneSeed = 1
  /** a wall of panes from `a` to `b` (world points on the floor), one per bay */
  const glassWall = (a: THREE.Vector3, b: THREE.Vector3, bays: number, turn: number) => {
    const bay = a.distanceTo(b) / bays
    for (let i = 0; i < bays; i++) {
      for (const [y0, y1] of rows) {
        const holder = new THREE.Object3D()
        holder.position.lerpVectors(a, b, (i + 0.5) / bays).setY((y0 + y1) / 2)
        holder.rotation.y = turn
        holder.add(glassPane(glass, bay - 0.02, y1 - y0 - 0.02, paneSeed++))
        group.add(holder)
      }
    }
  }
  glassWall(new THREE.Vector3(glassX, 0, glassZ), new THREE.Vector3(glassX, 0, d / 2 - 1), 7, -Math.PI / 2)
  glassWall(new THREE.Vector3(glassX, 0, glassZ), new THREE.Vector3(-w / 2 + 1.75, 0, glassZ), 8, 0)
  // slim mullions and a floor channel; thin enough that the video camera ignores them (see main.ts)
  for (let z = glassZ; z <= d / 2 - 1 + 1e-3; z += (d - 2) / 7) box(group, [0.05, ROOF_Y, 0.12], darkSteel, [glassX, ROOF_Y / 2, z])
  for (let x = glassX; x >= -w / 2 + 1.75; x -= (glassX + w / 2 - 1.75) / 8) box(group, [0.12, ROOF_Y, 0.05], darkSteel, [x, ROOF_Y / 2, glassZ])
  box(group, [0.05, 0.05, d - 2], darkSteel, [glassX, 0.025, 0])
  box(group, [0.07, 0.05, d - 2], darkSteel, [glassX, TRANSOM, 0])
  box(group, [glassX + w / 2 - 1.75, 0.05, 0.07], darkSteel, [(glassX - w / 2 + 1.75) / 2, TRANSOM, glassZ])
  box(group, [glassX + w / 2 - 1.75, 0.05, 0.05], darkSteel, [(glassX - w / 2 + 1.75) / 2, 0.025, glassZ])

  // ─── the roof: a cantilevered slab with a skylight cut over the car ─────
  const roofW = w + 2
  const roofD = d + 2
  const t = 0.5
  const y = ROOF_Y + t / 2
  const sideW = (roofW - SKY.w) / 2
  const endD = (roofD - SKY.d) / 2
  cast([sideW, t, roofD], ceiling, [-(SKY.w + sideW) / 2, y, 0])
  cast([sideW, t, roofD], ceiling, [(SKY.w + sideW) / 2, y, 0])
  cast([SKY.w, t, endD], ceiling, [0, y, (SKY.d + endD) / 2])
  cast([SKY.w, t, endD], ceiling, [0, y, -(SKY.d + endD) / 2])
  const skylight = new THREE.Mesh(new THREE.PlaneGeometry(SKY.w, SKY.d), createGlassMaterial({ dirt: 0.6 }))
  skylight.rotation.x = Math.PI / 2
  skylight.position.set(0, ROOF_Y + t - 0.02, 0)
  group.add(skylight)
  // daylight falling through it — and a diffuser in the well: the showroom's key light on the car,
  // whatever the sun is doing (scaled with the sun, see applySun)
  skyLight = new THREE.RectAreaLight(0xf2f4ff, 4, SKY.w, SKY.d)
  skyLight.position.set(0, ROOF_Y + 0.1, 0)
  skyLight.up.set(0, 0, -1)
  skyLight.lookAt(0, 0, 0)
  group.add(skyLight)
  // recessed LED slots in the ceiling, framing the skylight and running out to the edges
  const led = glowMaterial(0xfff1dc, 2.5) // dimmer than the day outside: the room stays moody, the car the brightest thing in it
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
  // (the roof is 8 m up: area lights need about twice the output of the old 5.5 m ceiling)
  const ceilingLight = new THREE.RectAreaLight(0xfff0dc, 1.2, SKY.w + 9, roofD - 4)
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

  // the fittings the user can switch, dim and warm (Menu › Garage › Interior lights); each group's
  // design temperature is roughly its fittings' own colour, so the defaults look as built
  interior = createInteriorLights([
    {
      id: 'skylight',
      name: 'Skylight',
      hint: 'The diffuser over the car: its key light, brighter by day',
      kelvin: 7000,
      members: [{ light: skyLight, intensity: () => skyOutput }],
    },
    {
      id: 'ceiling',
      name: 'Ceiling LEDs',
      hint: 'The recessed slots and the soft light they spread over the room',
      kelvin: 4800,
      members: [{ glow: led }, { light: ceilingLight }, { emissive: ceiling }],
    },
    {
      id: 'cove',
      name: 'Wall cove',
      hint: 'The warm strip in the floor washing up the concrete wall',
      kelvin: 3200,
      members: [{ glow: coveGlow }, { light: wash }],
    },
  ])

  // the pavilion's structure casts the sun's shadow; glass and light strips don't
  for (const obj of group.children) {
    const mesh = obj as THREE.Mesh
    if (mesh.isMesh && [concrete, panels, ceiling, darkSteel].includes(mesh.material as THREE.MeshStandardMaterial)) mesh.castShadow = true
  }
  pavilionParts.push(...group.children.filter((o) => o !== landscape.group && !(o as THREE.Light).isLight))
  world.hooks.sun!.set(world.hooks.sun!.get()) // again, now the pavilion's lights and pool are here

  const room = assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 2.3, 0.3, -d / 2 + 1.6],
      [glassX - 0.6, ROOF_Y - 0.5, d / 2 + OUT_FRONT],
    ],
    background: 0xa7bdd8, // only until the sky is in
    environmentIntensity: 1,
    ready: Promise.all([world.ready, floorMaps.ready, panelMaps.ready]).then(() => {
      floor.floorLayers.push(...landscape.farDetail) // the deck's mirror can skip the far ones
    }),
  })
  const pool = water
  return {
    ...room,
    ...world.hooks,
    interior,
    resize(width, height, pixelRatio) {
      room.resize(width, height, pixelRatio)
      pool.resize(width, height, pixelRatio)
      world.resize(width, height, pixelRatio)
    },
    setReflectionScale(scale) {
      room.setReflectionScale(scale)
      pool.setReflectionScale(scale)
      world.setReflectionScale(scale)
    },
    update(dt) {
      pool.update(dt)
      world.update(dt)
    },
  }
}

export const fujiPavilion: GarageDef = {
  id: 'fuji',
  name: 'Fuji Pavilion',
  tag: 'Concrete and glass on a terrace above a lake, Mount Fuji across the valley',
  palette: ['#2f5f9e', '#a7bdd8', '#f4f6fa', '#5f8a2e'],
  look: 'golden',
  create: createFujiPavilion,
}
