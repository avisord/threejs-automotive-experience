import * as THREE from 'three'
import { assembleRoom, box, concreteTexture, createFloor, glowMaterial, type GarageDef, type Room } from './kit'

/** platform the pavilion stands on (x × z), and its roof height */
const DECK = { w: 26, d: 22 }
const ROOF_Y = 5.5
/** skylight cut into the roof over the car (x × z) */
const SKY = { w: 4, d: 9 }
/** the painted world around the pavilion — inside the environment capture's 60 m far plane */
const PANORAMA_R = 48
const SUN = 0xffb27a
/** the lake's surface, below the deck */
const WATER_Y = -0.45
/** where the sun sits on the panorama: azimuth as a fraction of the circle (0.75 = straight behind, -z), elevation in degrees */
const SUN_AT = { u: 0.86, elevation: 3.2 }

/** direction on the panorama sphere for an azimuth fraction and an elevation — matches the sphere's uv layout below */
function panoramaDirection(u: number, elevationDeg: number): THREE.Vector3 {
  const e = THREE.MathUtils.degToRad(elevationDeg)
  const a = u * Math.PI * 2
  return new THREE.Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e))
}

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
 * The world outside, as an equirectangular painting: a dusk sky, Mount Fuji
 * straight behind the car with its snow catching the last light, pine
 * ridges on the far shore.
 */
function panoramaTexture(): THREE.CanvasTexture {
  const W = 4096
  const H = 2048
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')!
  const horizon = H / 2
  /** canvas row for an elevation in degrees */
  const rowAt = (deg: number) => horizon - (deg / 180) * H

  // ─── sky ─────────────────────────────────────────────────────────────────
  const sky = g.createLinearGradient(0, 0, 0, horizon)
  sky.addColorStop(0, '#0b1633')
  sky.addColorStop(0.35, '#1f3468')
  sky.addColorStop(0.7, '#5d6ea3')
  sky.addColorStop(0.88, '#c98f98')
  sky.addColorStop(0.96, '#f0b48c')
  sky.addColorStop(1, '#f9cf9a')
  g.fillStyle = sky
  g.fillRect(0, 0, W, horizon)
  // the glow around the sun, low on the horizon
  const sunX = SUN_AT.u * W
  const sunY = rowAt(SUN_AT.elevation)
  for (const dx of [-W, 0, W]) {
    const glow = g.createRadialGradient(sunX + dx, sunY, 0, sunX + dx, sunY, W * 0.16)
    glow.addColorStop(0, 'rgba(255,214,160,0.85)')
    glow.addColorStop(0.4, 'rgba(255,170,120,0.3)')
    glow.addColorStop(1, 'rgba(255,150,110,0)')
    g.fillStyle = glow
    g.fillRect(0, 0, W, horizon + 40)
  }
  // thin streaks of cloud
  for (let i = 0; i < 26; i++) {
    const y = rowAt(6 + Math.random() * 22)
    const x = Math.random() * W
    const len = 200 + Math.random() * 700
    const cloud = g.createLinearGradient(x, 0, x + len, 0)
    const warm = Math.max(0, 1 - Math.abs(y - sunY) / 300)
    const c = `${Math.round(190 + 60 * warm)},${Math.round(150 + 40 * warm)},${Math.round(170 - 20 * warm)}`
    cloud.addColorStop(0, `rgba(${c},0)`)
    cloud.addColorStop(0.5, `rgba(${c},${0.18 + Math.random() * 0.2})`)
    cloud.addColorStop(1, `rgba(${c},0)`)
    g.fillStyle = cloud
    g.fillRect(x, y, len, 3 + Math.random() * 7)
  }

  // ─── Fuji ────────────────────────────────────────────────────────────────
  const peakX = 0.75 * W // straight behind the car
  const peakY = rowAt(15)
  const baseHalf = (52 / 360) * W
  const topHalf = (1.6 / 360) * W // the flat crater rim
  /** mountain surface row at column x (concave slopes, flat top) */
  const ridge = (x: number) => {
    const d = Math.abs(x - peakX)
    if (d <= topHalf) return peakY + ((d / topHalf) ** 2) * 3
    const t = Math.min(1, (d - topHalf) / (baseHalf - topHalf))
    return peakY + (horizon - peakY) * (1 - (1 - t) ** 2.2)
  }
  const mountain = new Path2D()
  mountain.moveTo(peakX - baseHalf, horizon)
  for (let x = peakX - baseHalf; x <= peakX + baseHalf; x += 4) mountain.lineTo(x, ridge(x))
  mountain.lineTo(peakX + baseHalf, horizon)
  mountain.closePath()
  // body: blue-violet, lit from the sun's side (right)
  const body = g.createLinearGradient(peakX - baseHalf * 0.6, 0, peakX + baseHalf * 0.6, 0)
  body.addColorStop(0, '#2c3558')
  body.addColorStop(0.5, '#3d4670')
  body.addColorStop(1, '#5a5a80')
  g.fillStyle = body
  g.fill(mountain)
  // snow cap: the top ~40%, with a ragged lower edge and gullies running down
  g.save()
  g.clip(mountain)
  const snowLine = peakY + (horizon - peakY) * 0.42
  /** lower edge of the snow: ragged, with tongues reaching down the gullies */
  const snowEdge = (x: number) => {
    const d = Math.abs(x - peakX) / baseHalf
    // short wavelengths only — a long one reads as a second, dark mountain in front of the snow
    const jag = 0.5 * Math.sin(x * 0.06) + 0.3 * Math.sin(x * 0.13 + 0.7) + 0.2 * Math.sin(x * 0.29 + 2.1)
    const tongue = Math.max(0, Math.sin(x * 0.041 + 1.3)) ** 6 // narrow fingers of snow down the gullies
    return snowLine - d * 50 + jag * 12 + tongue * 70
  }
  const snow = new Path2D()
  snow.moveTo(peakX - baseHalf, peakY - 10)
  snow.lineTo(peakX + baseHalf, peakY - 10)
  for (let x = peakX + baseHalf; x >= peakX - baseHalf; x -= 3) snow.lineTo(x, snowEdge(x))
  snow.closePath()
  const snowShade = g.createLinearGradient(peakX - baseHalf * 0.3, 0, peakX + baseHalf * 0.3, 0)
  snowShade.addColorStop(0, '#9ea6c8') // shadow side, blue
  snowShade.addColorStop(0.5, '#e6e3ee')
  snowShade.addColorStop(1, '#ffd9cc') // alpenglow
  g.fillStyle = snowShade
  g.fill(snow)
  // rock ribs showing through the snow: thin wedges from the snow line, pointing up toward the summit
  for (let i = 0; i < 90; i++) {
    const x0 = peakX + (Math.random() - 0.5) * baseHalf * 1.1
    const y0 = snowEdge(x0) + 6
    const dx = peakX - x0
    const dy = peakY - y0
    const reach = 0.12 + Math.random() * 0.4
    const half = 1.5 + Math.random() * 4
    g.fillStyle = `rgba(${48 + Math.random() * 20},${56 + Math.random() * 20},${92 + Math.random() * 20},${0.35 + Math.random() * 0.3})`
    g.beginPath()
    g.moveTo(x0 - half, y0)
    g.lineTo(x0 + dx * reach, y0 + dy * reach)
    g.lineTo(x0 + half, y0)
    g.fill()
  }
  // haze rising from the base
  const haze = g.createLinearGradient(0, peakY, 0, horizon)
  haze.addColorStop(0, 'rgba(210,160,170,0)')
  haze.addColorStop(0.7, 'rgba(210,160,170,0.18)')
  haze.addColorStop(1, 'rgba(240,190,160,0.6)')
  g.fillStyle = haze
  g.fillRect(peakX - baseHalf, peakY, baseHalf * 2, horizon - peakY)
  g.restore()

  // ─── ridges with pines, all the way round ────────────────────────────────
  const layers = [
    { top: 3.2, color: '#39365a', pine: 0 },
    { top: 1.8, color: '#221f38', pine: 10 },
    { top: 0.9, color: '#110f1d', pine: 16 },
  ]
  for (const [li, layer] of layers.entries()) {
    g.fillStyle = layer.color
    g.beginPath()
    g.moveTo(0, horizon + 4)
    const phase = li * 2.1
    const rowOf = (x: number) =>
      rowAt(layer.top * (0.55 + 0.3 * Math.sin((x / W) * Math.PI * 6 + phase) + 0.15 * Math.sin((x / W) * Math.PI * 23 + phase * 3)))
    for (let x = 0; x <= W; x += 8) g.lineTo(x, rowOf(x))
    g.lineTo(W, horizon + 4)
    g.closePath()
    g.fill()
    // pine silhouettes: stacked triangles along the ridge
    if (layer.pine) {
      for (let x = 0; x < W; x += layer.pine * (0.6 + Math.random())) {
        const y = rowOf(x)
        const h = layer.pine * (1.2 + Math.random() * 1.6)
        for (let k = 0; k < 3; k++) {
          const w = layer.pine * (0.9 - k * 0.22)
          const ty = y - h * (0.35 + k * 0.3)
          g.beginPath()
          g.moveTo(x - w / 2, ty + h * 0.45)
          g.lineTo(x, ty)
          g.lineTo(x + w / 2, ty + h * 0.45)
          g.fill()
        }
        g.fillRect(x - 1, y - h * 0.3, 2, h * 0.3)
      }
    }
  }

  // below the horizon: dark water (the lake plane covers most of it; this shows past its edge)
  g.fillStyle = '#121828'
  g.fillRect(0, horizon + 4, W, H - horizon - 4)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/**
 * An open concrete-and-glass pavilion on a lake at the foot of Mount Fuji, at dusk.
 * A board-formed concrete wall on one side, floor-to-ceiling glass on two
 * others, the front open to the lake — and a cantilevered roof
 * slab with a skylight over the car.
 */
function createFujiPavilion(): Room {
  const { w, d } = DECK
  const group = new THREE.Group()
  group.name = 'fuji-pavilion'

  // ─── the world outside ───────────────────────────────────────────────────
  const panorama = new THREE.Mesh(
    new THREE.SphereGeometry(PANORAMA_R, 96, 48),
    new THREE.MeshBasicMaterial({ map: panoramaTexture(), color: new THREE.Color(1.35, 1.35, 1.35), side: THREE.BackSide }),
  )
  panorama.scale.x = -1 // seen from inside, un-mirror the painting
  group.add(panorama)
  const sunDir = panoramaDirection(SUN_AT.u, SUN_AT.elevation)
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 48), glowMaterial(0xffd6a0, 6))
  sunDisc.position.copy(sunDir).multiplyScalar(PANORAMA_R - 1)
  sunDisc.lookAt(0, 0, 0)
  group.add(sunDisc)

  const concrete = new THREE.MeshStandardMaterial({ color: 0x9a9894, map: concreteTexture([4, 4], 0.7), roughness: 0.85 })
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x141517, roughness: 0.4, metalness: 0.8 })

  // the pavilion stands in a still lake; it mirrors the sky, the mountain and the sun
  // through the environment map, which is captured from this whole panorama
  const lake = new THREE.Mesh(
    new THREE.CircleGeometry(PANORAMA_R - 2, 96),
    new THREE.MeshStandardMaterial({ color: 0x070a10, roughness: 0.02, metalness: 0, envMapIntensity: 1.8 }),
  )
  lake.rotation.x = -Math.PI / 2
  lake.position.y = WATER_Y
  group.add(lake)

  // ─── the platform: polished concrete over a soft mirror ─────────────────
  box(group, [w, 1, d], concrete, [0, -0.51, 0]) // stands in the water, its top just under the floor
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

  // stepping stones out into the lake from the open front
  for (let i = 0; i < 6; i++) {
    const stone = box(group, [1.3, 0.5, 0.7], concrete, [1.4 + (i % 2) * 0.7, WATER_Y + 0.13, d / 2 + 1.1 + i * 1.6])
    stone.rotation.y = (i % 2 ? 1 : -1) * 0.08
  }
  const OUT_FRONT = 10 // how far over the water in front the camera may go

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
  // cool dusk light falling through it
  const skyLight = new THREE.RectAreaLight(0xc6d4ff, 3.2, SKY.w, SKY.d)
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

  // ─── the low sun behind the mountain rims the car; the sky fills ────────
  const sun = new THREE.DirectionalLight(SUN, 1.6)
  sun.position.copy(sunDir).multiplyScalar(30)
  group.add(sun)
  group.add(new THREE.HemisphereLight(0x8fa2d8, 0x2c2723, 0.7))

  return assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 2.3, 0.3, -d / 2 + 1.6],
      [glassX - 0.6, ROOF_Y - 0.5, d / 2 + OUT_FRONT],
    ],
    background: 0x0b1633,
    environmentIntensity: 1,
  })
}

export const fujiPavilion: GarageDef = {
  id: 'fuji',
  name: 'Fuji Pavilion',
  tag: 'Concrete and glass on a still lake, facing the mountain at dusk',
  palette: ['#0b1633', '#5d6ea3', '#f0b48c', '#e6e3ee'],
  look: 'natural',
  create: createFujiPavilion,
}
