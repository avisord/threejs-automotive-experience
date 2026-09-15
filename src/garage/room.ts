import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { createHexLights } from './hex-lights'

/** garage bay dimensions (metres): x = width, y = height, z = depth. Car sits at the origin, nose to +z. */
export const ROOM = { w: 18, h: 10, d: 24 }

const ACCENT = 0x35e0ff
const LED = 0xe6f1ff

/** unlit HDR material — values above 1 bloom and light up reflections */
function glowMaterial(color: THREE.ColorRepresentation, glow: number): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(glow) })
  material.userData.glow = true // picked up by the "lights only" bloom, see collectGlowMeshes()
  return material
}

/** every mesh drawn with a light-emitting material — what "lights only" bloom blooms */
export function collectGlowMeshes(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  root.traverse((obj) => {
    const material = (obj as THREE.Mesh).material as THREE.Material | undefined
    if ((obj as THREE.Mesh).isMesh && material?.userData.glow) found.push(obj)
  })
  return found
}

const panelMat = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.42, metalness: 0.35 })
const trimMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0f, roughness: 0.55, metalness: 0.6 })
const slatMat = new THREE.MeshStandardMaterial({ color: 0x2a2e36, roughness: 0.3, metalness: 0.85 })
const ledMat = glowMaterial(LED, 3)
const accentMat = glowMaterial(ACCENT, 2.6)

function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  parent.add(mesh)
  return mesh
}

// wall profile (heights in metres) — panels run up to a dark frieze under the ceiling
const KICK_TOP = 0.32
const PANEL_TOP = ROOM.h - 1.6
const BAND_TOP = PANEL_TOP + 0.14

/**
 * One wall run built in local space: runs along x, faces +z (into the room).
 * `opening` leaves a gap in the panels, e.g. for the garage door.
 */
function buildWall(length: number, opening?: [from: number, to: number]): THREE.Group {
  const wall = new THREE.Group()
  const half = length / 2

  // recessed kick plate with a cyan cove strip that washes the floor edge
  box(wall, [length, KICK_TOP, 0.1], trimMat, [0, KICK_TOP / 2, 0.05])
  box(wall, [length, 0.025, 0.035], accentMat, [0, 0.0125, 0.12])

  // continuous LED line above the panels
  box(wall, [length, BAND_TOP - PANEL_TOP, 0.06], ledMat, [0, (PANEL_TOP + BAND_TOP) / 2, 0.03])

  const count = Math.round(length / 2)
  const pitch = length / count
  const panelH = PANEL_TOP - KICK_TOP - 0.06
  for (let i = 0; i < count; i++) {
    const x = -half + pitch * (i + 0.5)
    const skip = opening && x + pitch / 2 > opening[0] && x - pitch / 2 < opening[1]
    if (!skip) {
      const panel = box(wall, [pitch - 0.08, panelH, 0.14], panelMat, [x, KICK_TOP + 0.03 + panelH / 2, 0.07])
      // alternate panels sit proud for a bit of relief
      if (i % 2 === 1) panel.position.z += 0.05
    }
    // vertical LED seam every third panel
    const seamX = -half + pitch * (i + 1)
    const seamInOpening = opening && seamX > opening[0] - 0.1 && seamX < opening[1] + 0.1
    if (i % 3 === 2 && i < count - 1 && !seamInOpening) {
      box(wall, [0.035, panelH, 0.04], ledMat, [seamX, KICK_TOP + 0.03 + panelH / 2, 0.06])
    }
  }
  return wall
}

/** Horizontal-slat roller door with a lit frame, local space like buildWall. */
function buildDoor(width: number, height: number): THREE.Group {
  const door = new THREE.Group()
  const slatH = 0.3
  const count = Math.floor(height / slatH)
  for (let i = 0; i < count; i++) {
    box(door, [width, slatH - 0.035, 0.08], slatMat, [0, slatH * (i + 0.5), 0.04])
  }
  // frame: two jambs and a header, with LED lines on their inner edge
  const jambW = 0.3
  box(door, [jambW, height + jambW, 0.24], trimMat, [-(width + jambW) / 2, (height + jambW) / 2, 0.12])
  box(door, [jambW, height + jambW, 0.24], trimMat, [(width + jambW) / 2, (height + jambW) / 2, 0.12])
  box(door, [width + jambW * 2, jambW, 0.24], trimMat, [0, height + jambW / 2, 0.12])
  box(door, [0.04, height, 0.04], accentMat, [-width / 2 - 0.02, height / 2, 0.25])
  box(door, [0.04, height, 0.04], accentMat, [width / 2 + 0.02, height / 2, 0.25])
  box(door, [width + 0.08, 0.04, 0.04], accentMat, [0, height + 0.02, 0.25])
  return door
}

/** Wall-mounted status display, drawn once to a canvas. */
function buildDisplay(width: number, height: number): THREE.Mesh {
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
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(width + 0.12, height + 0.12, 0.08), trimMat)
  bezel.position.z = -0.045
  screen.add(bezel)
  return screen
}

/** Seamless 2 m floor tile: bright base (the material colour tints it) with dark seams and a little grain. */
function floorTileTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, size, size)
  const grain = g.getImageData(0, 0, size, size)
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = 235 + Math.random() * 20
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v
  }
  g.putImageData(grain, 0, 0)
  g.fillStyle = '#3a3a3a'
  g.fillRect(0, 0, size, 3)
  g.fillRect(0, 0, 3, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(ROOM.w / 2, ROOM.d / 2)
  texture.anisotropy = 8
  return texture
}

/**
 * Reflector shader with a soft, glossy-epoxy look instead of a perfect mirror:
 * a golden-angle disc of taps over a blurred mip level of the reflection.
 */
const BlurredReflectorShader = {
  name: 'BlurredReflectorShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    /** disc radius in screen uv */
    blur: { value: 0.012 },
    /** mip level sampled — each step halves the resolution */
    lod: { value: 1.5 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float blur;
    uniform float lod;
    varying vec4 vUv;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec3 sum = vec3( 0.0 );
      const int TAPS = 16;
      for ( int i = 0; i < TAPS; i ++ ) {
        float fi = float( i ) + 0.5;
        float a = fi * 2.39996323; // golden angle spreads taps evenly over the disc
        vec2 offset = vec2( cos( a ), sin( a ) ) * sqrt( fi / float( TAPS ) ) * blur;
        sum += textureLod( tDiffuse, uv + offset, lod ).rgb;
      }
      gl_FragColor = vec4( color * sum / float( TAPS ), 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

export interface Room {
  group: THREE.Group
  reflector: Reflector
  /**
   * Things lying on the floor (tile overlay, markings, contact shadow). They
   * are hidden while the mirror renders, otherwise they'd block the reflection.
   */
  floorLayers: THREE.Object3D[]
  /** match the mirror's render target to the viewport, at the current reflection scale */
  resize(width: number, height: number, pixelRatio: number): void
  /**
   * Floor mirror resolution relative to the canvas (0.5 reads as polished
   * epoxy). 0 switches the mirror off entirely — the car is then drawn once
   * per frame instead of twice — and makes the tiles opaque.
   */
  setReflectionScale(scale: number): void
}

export function createRoom(): Room {
  const { w, h, d } = ROOM
  const group = new THREE.Group()
  group.name = 'room'

  // outer shell — walls and ceiling seen from inside
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(w, h + 0.02, d),
    new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.8, metalness: 0.2, side: THREE.BackSide }),
  )
  shell.position.y = h / 2 - 0.02
  group.add(shell)

  // ─── floor: mirror underneath, semi-opaque epoxy tiles on top ────────────
  const reflector = new Reflector(new THREE.PlaneGeometry(w, d), {
    color: 0x7a7a7a,
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.003,
    shader: BlurredReflectorShader,
  })
  reflector.rotation.x = -Math.PI / 2
  // the blur samples a mip level, so the mirror target needs a mip chain
  const mirrorTexture = reflector.getRenderTarget().texture
  mirrorTexture.generateMipmaps = true
  mirrorTexture.minFilter = THREE.LinearMipmapLinearFilter
  group.add(reflector)

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshStandardMaterial({
      color: 0x22252b,
      map: floorTileTexture(),
      roughness: 0.3,
      metalness: 0.25,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = 0.002
  group.add(floor)

  // hexagonal bay marking around the car, echoing the ceiling
  const marking = new THREE.Group()
  const hexR = 3.6
  for (let k = 0; k < 6; k++) {
    const a0 = (k * Math.PI) / 3 + Math.PI / 6
    const a1 = a0 + Math.PI / 3
    const x0 = hexR * Math.cos(a0)
    const z0 = hexR * Math.sin(a0)
    const x1 = hexR * Math.cos(a1)
    const z1 = hexR * Math.sin(a1)
    const edge = box(marking, [Math.hypot(x1 - x0, z1 - z0) + 0.03, 0.004, 0.03], glowMaterial(ACCENT, 0.9), [
      (x0 + x1) / 2,
      0.006,
      (z0 + z1) / 2,
    ])
    edge.rotation.y = Math.atan2(-(z1 - z0), x1 - x0)
  }
  group.add(marking)

  // ─── walls ───────────────────────────────────────────────────────────────
  const doorW = 7
  const doorH = 4.2

  const back = buildWall(w, [-doorW / 2 - 0.3, doorW / 2 + 0.3])
  back.position.set(0, 0, -d / 2)
  const door = buildDoor(doorW, doorH)
  back.add(door)

  const front = buildWall(w)
  front.position.set(0, 0, d / 2)
  front.rotation.y = Math.PI

  const left = buildWall(d)
  left.position.set(-w / 2, 0, 0)
  left.rotation.y = Math.PI / 2

  const right = buildWall(d)
  right.position.set(w / 2, 0, 0)
  right.rotation.y = -Math.PI / 2

  const display = buildDisplay(3.6, 2.0)
  display.position.set(0, 2.4, 0.3)
  left.add(display)

  group.add(back, front, left, right)

  // ─── ceiling ─────────────────────────────────────────────────────────────
  const hex = createHexLights({ width: 7.4, depth: 10.2, cell: 0.85, lightIntensity: 4.5 })
  hex.position.y = h - 0.1
  group.add(hex)

  // wall washers along the long walls: linear LEDs near the ceiling edge,
  // tilted toward the panels so the walls read instead of falling to black
  for (const side of [-1, 1]) {
    const x = side * (w / 2 - 1.2)
    box(group, [0.12, 0.05, d - 3], ledMat, [x, h - 0.05, 0])
    const washer = new THREE.RectAreaLight(LED, 16, 0.4, d - 3)
    washer.position.set(x, h - 0.15, 0)
    washer.lookAt(side * (w / 2), h * 0.35, 0)
    group.add(washer)
  }

  const floorLayers: THREE.Object3D[] = [floor, marking]
  const baseBeforeRender = reflector.onBeforeRender
  reflector.onBeforeRender = (...args) => {
    for (const o of floorLayers) o.visible = false
    baseBeforeRender.apply(reflector, args)
    for (const o of floorLayers) o.visible = true
  }

  let reflectionScale = 0.5
  const viewport = { width: 1, height: 1, pixelRatio: 1 }
  const floorMaterial = floor.material as THREE.MeshStandardMaterial
  function sizeMirror(): void {
    const k = viewport.pixelRatio * Math.max(reflectionScale, 0.05)
    reflector.getRenderTarget().setSize(Math.round(viewport.width * k), Math.round(viewport.height * k))
  }

  return {
    group,
    reflector,
    floorLayers,
    resize(width, height, pixelRatio) {
      Object.assign(viewport, { width, height, pixelRatio })
      sizeMirror()
    },
    setReflectionScale(scale) {
      reflectionScale = scale
      reflector.visible = scale > 0
      floorMaterial.opacity = scale > 0 ? 0.8 : 1
      sizeMirror()
    },
  }
}
