import * as THREE from 'three'
import { assembleRoom, box, concreteTexture, createFloor, glowMaterial, type GarageDef, type Room } from './kit'
import { createLandscape } from './landscape'

/** platform the pavilion stands on (x × z), and its roof height */
const DECK = { w: 26, d: 22 }
const ROOF_Y = 5.5
/** skylight cut into the roof over the car (x × z) */
const SKY = { w: 4, d: 9 }
/** the grass around the deck */
const GROUND_Y = -0.6
/** the reflecting pool in front of the open side (z extent past the deck) */
const POOL = { d: 8, water: -0.28 }

/**
 * Board-formed concrete: blotchy concrete cast against planks, with the
 * seams of the formwork panels and the round tie holes Tadao Ando made his
 * signature. One texture tile = one 1.8 × 0.9 m panel.
 */
function boardFormedTexture(repeat: [number, number]): THREE.CanvasTexture {
  const texture = concreteTexture(repeat, 0.8)
  const canvas = texture.image as HTMLCanvasElement
  const g = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  // plank grain: faint horizontal bands
  for (let y = 0; y < H; y += 32) {
    g.fillStyle = `rgba(0,0,0,${0.02 + Math.random() * 0.03})`
    g.fillRect(0, y, W, 32)
  }
  // panel seams on the tile edges (so they line up across tiles)
  g.fillStyle = 'rgba(40,40,40,0.55)'
  g.fillRect(0, 0, W, 3)
  g.fillRect(0, 0, 3, H)
  // 3 × 2 tie holes, a dark cone with a light rim
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const x = (W / 3) * (i + 0.5)
      const y = (H / 2) * (j + 0.5)
      const hole = g.createRadialGradient(x, y, 0, x, y, 11)
      hole.addColorStop(0, 'rgba(30,30,30,0.9)')
      hole.addColorStop(0.6, 'rgba(70,70,70,0.6)')
      hole.addColorStop(0.8, 'rgba(235,235,235,0.5)')
      hole.addColorStop(1, 'rgba(200,200,200,0)')
      g.fillStyle = hole
      g.fillRect(x - 12, y - 12, 24, 24)
    }
  }
  texture.needsUpdate = true
  return texture
}

/**
 * An open concrete-and-glass pavilion on grassland below Mount Fuji, under a
 * clear sky. A board-formed concrete wall on one side, floor-to-ceiling glass
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
    sunAzimuth: -40, // front right: lights the car's face and Fuji's near slope, shapes both
    keepClear: (x, z) => underDeck(x, z) || inPool(x, z),
  })
  group.add(landscape.group)

  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9894, map: concreteTexture([4, 4], 0.7), roughness: 0.85 })
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.4, metalness: 0.8 })

  // ─── the platform: polished concrete over a soft mirror ─────────────────
  box(group, [w, -GROUND_Y, d], concrete, [0, GROUND_Y / 2 - 0.01, 0]) // its edge, top just under the floor
  const floor = createFloor(group, {
    geometry: new THREE.PlaneGeometry(w, d),
    tint: 0x8a8a8a,
    blur: 0.016,
    surface: new THREE.MeshStandardMaterial({
      color: 0x8c8a86,
      map: concreteTexture([w / 4, d / 4], 0.5),
      roughness: 0.32,
      metalness: 0.02,
      opacity: 0.8,
    }),
  })

  // ─── the reflecting pool in front, with stepping stones ─────────────────
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(w, POOL.d),
    new THREE.MeshStandardMaterial({ color: 0x05080d, roughness: 0.03, metalness: 0, envMapIntensity: 1.6 }),
  )
  pool.rotation.x = -Math.PI / 2
  pool.position.set(0, POOL.water, d / 2 + POOL.d / 2)
  group.add(pool)
  const rimH = POOL.water - GROUND_Y + 0.06
  box(group, [w + 0.6, rimH, 0.3], concrete, [0, GROUND_Y + rimH / 2, d / 2 + POOL.d + 0.15])
  for (const side of [-1, 1]) box(group, [0.3, rimH, POOL.d], concrete, [side * (w / 2 + 0.15), GROUND_Y + rimH / 2, d / 2 + POOL.d / 2])
  for (let i = 0; i < 5; i++) {
    const stone = box(group, [1.3, 0.3, 0.7], concrete, [1.4 + (i % 2) * 0.7, POOL.water + 0.02, d / 2 + 1.1 + i * 1.5])
    stone.rotation.y = (i % 2 ? 1 : -1) * 0.08
  }
  const OUT_FRONT = 10 // how far past the deck, over the pool, the camera may go

  // ─── the concrete wall (left) ────────────────────────────────────────────
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xa6a39d, map: boardFormedTexture([d / 1.8, ROOF_Y / 0.9]), roughness: 0.9 })
  box(group, [0.5, ROOF_Y, d], wallMaterial, [-w / 2 + 1.5, ROOF_Y / 2, 0])
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
  box(group, [sideW, t, roofD], concrete, [-(SKY.w + sideW) / 2, y, 0])
  box(group, [sideW, t, roofD], concrete, [(SKY.w + sideW) / 2, y, 0])
  box(group, [SKY.w, t, endD], concrete, [0, y, (SKY.d + endD) / 2])
  box(group, [SKY.w, t, endD], concrete, [0, y, -(SKY.d + endD) / 2])
  const skylight = new THREE.Mesh(new THREE.PlaneGeometry(SKY.w, SKY.d), glass)
  skylight.rotation.x = Math.PI / 2
  skylight.position.set(0, ROOF_Y + t - 0.02, 0)
  group.add(skylight)
  // daylight falling through it
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

  // ─── the sun, where the sky photo has it; the sky and the grass fill ────
  const sun = new THREE.DirectionalLight(0xfff3e2, 2.2)
  sun.position.copy(landscape.sunDirection).multiplyScalar(50)
  group.add(sun) // aims at the origin by default
  group.add(new THREE.HemisphereLight(0xbcd2f0, 0x5a6a3c, 0.45))

  return assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 2.3, 0.3, -d / 2 + 1.6],
      [glassX - 0.6, ROOF_Y - 0.5, d / 2 + OUT_FRONT],
    ],
    background: 0xa7bdd8, // only until the sky is in
    environmentIntensity: 1,
    ready: landscape.ready,
  })
}

export const fujiPavilion: GarageDef = {
  id: 'fuji',
  name: 'Fuji Pavilion',
  tag: 'Concrete and glass on open grassland, Mount Fuji under a clear sky',
  palette: ['#2f5f9e', '#a7bdd8', '#f4f6fa', '#5f8a2e'],
  look: 'natural',
  create: createFujiPavilion,
}
