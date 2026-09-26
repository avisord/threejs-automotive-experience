import * as THREE from 'three'
import { createHexLights } from './hex-lights'
import { createInteriorLights, fixtureMembers, type InteriorMember } from './interior'
import { assembleRoom, box, createFloor, floorTileTexture, glowMaterial, type GarageDef, type Room } from './kit'

/** bay dimensions (metres): x = width, y = height, z = depth. Car sits at the origin, nose to +z. */
const ROOM = { w: 18, h: 10, d: 24 }

const ACCENT = 0x35e0ff
const LED = 0xe6f1ff

type Materials = ReturnType<typeof materials>

/** made per room, so disposing one garage never pulls materials out from under the next */
function materials() {
  return {
    panel: new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.42, metalness: 0.35 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55, metalness: 0.6 }),
    slat: new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.3, metalness: 0.85 }),
    led: glowMaterial(LED, 3),
    accent: glowMaterial(ACCENT, 2.6),
  }
}

// wall profile (heights in metres) — panels run up to a dark frieze under the ceiling
const KICK_TOP = 0.32
const PANEL_TOP = ROOM.h - 1.6
const BAND_TOP = PANEL_TOP + 0.14

/**
 * One wall run built in local space: runs along x, faces +z (into the room).
 * `opening` leaves a gap in the panels, e.g. for the garage door.
 */
function buildWall(m: Materials, length: number, opening?: [from: number, to: number]): THREE.Group {
  const wall = new THREE.Group()
  const half = length / 2

  // recessed kick plate with a cyan cove strip that washes the floor edge
  box(wall, [length, KICK_TOP, 0.1], m.trim, [0, KICK_TOP / 2, 0.05])
  box(wall, [length, 0.025, 0.035], m.accent, [0, 0.0125, 0.12])

  // continuous LED line above the panels
  box(wall, [length, BAND_TOP - PANEL_TOP, 0.06], m.led, [0, (PANEL_TOP + BAND_TOP) / 2, 0.03])

  const count = Math.round(length / 2)
  const pitch = length / count
  const panelH = PANEL_TOP - KICK_TOP - 0.06
  for (let i = 0; i < count; i++) {
    const x = -half + pitch * (i + 0.5)
    const skip = opening && x + pitch / 2 > opening[0] && x - pitch / 2 < opening[1]
    if (!skip) {
      const panel = box(wall, [pitch - 0.08, panelH, 0.14], m.panel, [x, KICK_TOP + 0.03 + panelH / 2, 0.07])
      // alternate panels sit proud for a bit of relief
      if (i % 2 === 1) panel.position.z += 0.05
    }
    // vertical LED seam every third panel
    const seamX = -half + pitch * (i + 1)
    const seamInOpening = opening && seamX > opening[0] - 0.1 && seamX < opening[1] + 0.1
    if (i % 3 === 2 && i < count - 1 && !seamInOpening) {
      box(wall, [0.035, panelH, 0.04], m.led, [seamX, KICK_TOP + 0.03 + panelH / 2, 0.06])
    }
  }
  return wall
}

/** Horizontal-slat roller door with a lit frame, local space like buildWall. */
function buildDoor(m: Materials, width: number, height: number): THREE.Group {
  const door = new THREE.Group()
  const slatH = 0.3
  const count = Math.floor(height / slatH)
  for (let i = 0; i < count; i++) {
    box(door, [width, slatH - 0.035, 0.08], m.slat, [0, slatH * (i + 0.5), 0.04])
  }
  // frame: two jambs and a header, with LED lines on their inner edge
  const jambW = 0.3
  box(door, [jambW, height + jambW, 0.24], m.trim, [-(width + jambW) / 2, (height + jambW) / 2, 0.12])
  box(door, [jambW, height + jambW, 0.24], m.trim, [(width + jambW) / 2, (height + jambW) / 2, 0.12])
  box(door, [width + jambW * 2, jambW, 0.24], m.trim, [0, height + jambW / 2, 0.12])
  box(door, [0.04, height, 0.04], m.accent, [-width / 2 - 0.02, height / 2, 0.25])
  box(door, [0.04, height, 0.04], m.accent, [width / 2 + 0.02, height / 2, 0.25])
  box(door, [width + 0.08, 0.04, 0.04], m.accent, [0, height + 0.02, 0.25])
  return door
}

/** Wall-mounted status display, drawn once to a canvas. */
function buildDisplay(m: Materials, width: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = Math.round((1600 * height) / width)
  const g = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height

  const bg = g.createLinearGradient(0, 0, W, H)
  bg.addColorStop(0, '#04121c')
  bg.addColorStop(1, '#020509')
  g.fillStyle = bg
  g.fillRect(0, 0, W, H)

  g.strokeStyle = 'rgba(53, 224, 255, 0.08)'
  g.lineWidth = 1
  for (let x = 0; x < W; x += 40) {
    g.beginPath()
    g.moveTo(x, 0)
    g.lineTo(x, H)
    g.stroke()
  }
  for (let y = 0; y < H; y += 40) {
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(W, y)
    g.stroke()
  }

  g.fillStyle = '#35e0ff'
  g.font = '500 34px ui-monospace, Consolas, monospace'
  g.fillText('BAY 01  ·  VEHICLE ONLINE', 70, 100)
  g.fillStyle = '#ffffff'
  g.font = '700 150px ui-sans-serif, system-ui, sans-serif'
  g.fillText('992 GT3 R', 64, 270)
  g.fillStyle = 'rgba(255, 255, 255, 0.55)'
  g.font = '400 36px ui-monospace, Consolas, monospace'
  g.fillText('ROXY LIVERY  ·  4.2L FLAT-6  ·  565 HP', 70, 340)

  const stats: [string, number][] = [
    ['TYRE TEMP', 0.72],
    ['BATTERY', 0.94],
    ['FUEL', 0.58],
    ['DOWNFORCE', 0.81],
  ]
  stats.forEach(([label, value], i) => {
    const y = 440 + i * 78
    g.fillStyle = 'rgba(255, 255, 255, 0.5)'
    g.font = '400 28px ui-monospace, Consolas, monospace'
    g.fillText(label, 70, y)
    g.fillStyle = 'rgba(53, 224, 255, 0.15)'
    g.fillRect(360, y - 22, 900, 18)
    g.fillStyle = '#35e0ff'
    g.fillRect(360, y - 22, 900 * value, 18)
    g.fillStyle = '#ffffff'
    g.fillText(`${Math.round(value * 100)}%`, 1290, y)
  })

  g.strokeStyle = '#35e0ff'
  g.lineWidth = 4
  g.strokeRect(12, 12, W - 24, H - 24)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  const screen = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(1.3, 1.3, 1.3) }),
  )
  ;(screen.material as THREE.Material).userData.glow = true
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.08), m.trim)
  bezel.position.z = -0.045
  screen.add(bezel)
  return screen
}

function createHexBay(): Room {
  const { w, h, d } = ROOM
  const m = materials()
  const group = new THREE.Group()
  group.name = 'hex-bay'

  // outer shell — walls and ceiling seen from inside
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(w, h + 0.02, d),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8, metalness: 0.2, side: THREE.BackSide }),
  )
  shell.position.y = h / 2 - 0.02
  group.add(shell)

  // ─── floor: mirror underneath, semi-opaque epoxy tiles on top ────────────
  const floor = createFloor(group, {
    geometry: new THREE.PlaneGeometry(w, d),
    tint: 0x7a7a7a,
    surface: new THREE.MeshStandardMaterial({
      color: 0x22252b,
      map: floorTileTexture([w / 2, d / 2]),
      roughness: 0.3,
      metalness: 0.25,
      opacity: 0.8,
    }),
  })

  // hexagonal bay marking around the car, echoing the ceiling
  const marking = new THREE.Group()
  const markingMat = glowMaterial(ACCENT, 0.9)
  const hexR = 3.6
  for (let k = 0; k < 6; k++) {
    const a0 = (k * Math.PI) / 3 + Math.PI / 6
    const a1 = a0 + Math.PI / 3
    const x0 = hexR * Math.cos(a0)
    const z0 = hexR * Math.sin(a0)
    const x1 = hexR * Math.cos(a1)
    const z1 = hexR * Math.sin(a1)
    const edge = box(marking, [Math.hypot(x1 - x0, z1 - z0) + 0.03, 0.004, 0.03], markingMat, [
      (x0 + x1) / 2,
      0.006,
      (z0 + z1) / 2,
    ])
    edge.rotation.y = Math.atan2(-(z1 - z0), x1 - x0)
  }
  group.add(marking)
  floor.floorLayers.push(marking)

  // ─── walls ───────────────────────────────────────────────────────────────
  const doorW = 7
  const doorH = 4.2

  const back = buildWall(m, w, [-doorW / 2 - 0.3, doorW / 2 + 0.3])
  back.position.set(0, 0, -d / 2)
  back.add(buildDoor(m, doorW, doorH))

  const front = buildWall(m, w)
  front.position.set(0, 0, d / 2)
  front.rotation.y = Math.PI

  const left = buildWall(m, d)
  left.position.set(-w / 2, 0, 0)
  left.rotation.y = Math.PI / 2

  const right = buildWall(m, d)
  right.position.set(w / 2, 0, 0)
  right.rotation.y = -Math.PI / 2

  const display = buildDisplay(m, 3.6, 2.0)
  display.position.set(0, 2.4, 0.3)
  left.add(display)

  group.add(back, front, left, right)

  // ─── ceiling ─────────────────────────────────────────────────────────────
  const hex = createHexLights({ width: 7.4, depth: 10.2, cell: 0.85, lightIntensity: 4.5 })
  hex.position.y = h - 0.1
  group.add(hex)

  // wall washers along the long walls: linear LEDs near the ceiling edge,
  // tilted toward the panels so the walls read instead of falling to black
  const washers: InteriorMember[] = [{ glow: m.led }]
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 1.2)
    box(group, [0.12, 0.05, d - 3], m.led, [x, h - 0.05, 0])
    const washer = new THREE.RectAreaLight(LED, 16, 0.4, d - 3)
    washer.position.set(x, h - 0.15, 0)
    washer.lookAt(side * (w / 2), h * 0.35, 0)
    group.add(washer)
    washers.push({ light: washer })
  }

  const ambient = new THREE.HemisphereLight(0xbfd6ff, 0x0a0b0d, 0.25)
  group.add(ambient)

  // the fittings the user can switch, dim and warm or recolour (Menu › Garage › Interior lights)
  const interior = createInteriorLights([
    { id: 'hex', name: 'Hex ceiling', hint: 'The honeycomb LED grid over the car: its key light', kelvin: 7200, members: fixtureMembers(hex) },
    { id: 'washers', name: 'Wall washers', hint: 'The linear LEDs along the ceiling edge, the panel seams and the frieze', kelvin: 8000, members: washers },
    { id: 'accent', name: 'Accent trim', hint: 'The cyan skirting, door frame and hexagon on the floor', color: ACCENT, members: [{ glow: m.accent }, { glow: markingMat }] },
    { id: 'ambient', name: 'Ambient fill', hint: 'Soft light from everywhere: lifts the shadows', kelvin: 7500, members: fixtureMembers(ambient) },
  ])

  const room = assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 0.6, 0.3, -d / 2 + 0.6],
      [w / 2 - 0.6, h - 0.45, d / 2 - 0.6],
    ],
    background: 0x050608,
    environmentIntensity: 1,
  })
  return { ...room, interior }
}

export const hexBay: GarageDef = {
  id: 'hex-bay',
  name: 'Hex Bay',
  tag: 'Honeycomb LED ceiling, cyan trim · the original',
  palette: ['#e6f1ff', '#35e0ff', '#3a3f48', '#050608'],
  look: 'cyber',
  exposureKey: -5.5,
  create: createHexBay,
}
