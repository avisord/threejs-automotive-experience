import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { receiveFarShadow } from '../far-shadow'
import { noRaycast, seeded } from '../landform'
import { foliage } from '../foliage'
import { OUTDOOR_SKY_LIGHT } from '../sky'

/**
 * The coast's undergrowth and garden plants, generated from one leaf atlas
 * (a canvas, five cells: a pinnate frond, a broad paddle leaf, a long pointed
 * blade, a leafy spray, and the spray again with small blossoms among its
 * leaves) as small instanced assets:
 *
 *   agave · strelitzia (paddle leaves on stalks) · cycad (a rosette of fronds)
 *   · flax (a fan of blades) · flowering shrub (a dome of leafy sprays with
 *   magenta or orange blossom, bougainvillea and hibiscus) · sea grape
 *   (rounded leaves, a low mound) · beach grass
 *
 * Each kind has a few seeded variants and three levels of detail; the leaf
 * colours are per vertex (muted green shades, darker toward the plant's
 * heart and foot), the instance colour shifts them between olive, yellow-
 * and dark green. Blossom is a mask in the fifth cell (its blue channel
 * above its green), coloured per vertex (`bloom`): flowers stay small and
 * scattered among leaves, and each variant flowers as much as a real bush
 * might — some hardly at all.
 */

const CELLS = 5
const CELL = { w: 256, h: 512 }

function leafAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = CELL.w * CELLS
  canvas.height = CELL.h
  const g = canvas.getContext('2d')!
  const rand = seeded(5)
  const grey = (v: number) => `rgb(${Math.round(v * 0.86)},${Math.round(v)},${Math.round(v * 0.72)})`
  const W = CELL.w
  const H = CELL.h
  // 0: a pinnate frond (v = 0 at its base)
  g.save()
  for (let side = -1; side <= 1; side += 2)
    for (let k = 0; k < 44; k++) {
      const y = (0.03 + (k / 44) * 0.95) * H
      const len = Math.sin(Math.PI * Math.min(1, (k / 44) * 1.05 + 0.03)) ** 0.6 * W * 0.47
      g.strokeStyle = grey(150 + rand() * 70)
      g.lineWidth = 6
      g.lineCap = 'round'
      g.beginPath()
      g.moveTo(W / 2, y)
      g.lineTo(W / 2 + side * len, y + len * 0.45)
      g.stroke()
    }
  g.restore()
  // 1: a paddle leaf — an ellipse with a pale midrib and a few wind tears
  g.save()
  g.translate(W, 0)
  g.fillStyle = grey(175)
  g.beginPath()
  g.ellipse(W / 2, H * 0.52, W * 0.44, H * 0.47, 0, 0, Math.PI * 2)
  g.fill()
  // veins
  g.strokeStyle = grey(140)
  g.lineWidth = 2
  for (let k = 0; k < 30; k++) {
    const y = H * (0.1 + k * 0.028)
    g.beginPath()
    g.moveTo(W / 2, y)
    g.lineTo(W * 0.08, y + 30)
    g.moveTo(W / 2, y)
    g.lineTo(W * 0.92, y + 30)
    g.stroke()
  }
  // tears: the blade split to the midrib here and there
  g.globalCompositeOperation = 'destination-out'
  g.lineWidth = 3
  for (let k = 0; k < 7; k++) {
    const y = H * (0.2 + rand() * 0.65)
    const side = rand() < 0.5 ? -1 : 1
    g.beginPath()
    g.moveTo(W / 2 + side * 10, y)
    g.lineTo(W / 2 + side * W * 0.5, y + 40)
    g.stroke()
  }
  g.globalCompositeOperation = 'source-over'
  g.strokeStyle = 'rgb(200,205,160)'
  g.lineWidth = 5
  g.beginPath()
  g.moveTo(W / 2, H * 0.03)
  g.lineTo(W / 2, H * 0.98)
  g.stroke()
  g.restore()
  // 2: a long pointed blade (agave, flax): full width at the base, tapering to a point
  g.save()
  g.translate(W * 2, 0)
  const grad = g.createLinearGradient(0, 0, W, 0)
  grad.addColorStop(0, grey(130))
  grad.addColorStop(0.5, grey(200))
  grad.addColorStop(1, grey(130))
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(W * 0.1, 0)
  g.quadraticCurveTo(W * 0.05, H * 0.7, W / 2, H)
  g.quadraticCurveTo(W * 0.95, H * 0.7, W * 0.9, 0)
  g.closePath()
  g.fill()
  g.restore()
  // 3 and 4: a leafy spray — twigs, small pointed-oval leaves along them, gaps between (4: blossoms among them)
  const spray = (cell: number, blossoms: number) => {
    g.save()
    g.translate(W * cell, 0)
    const twigs: [number, number, number, number][] = []
    for (let k = 0; k < 7; k++) {
      const x0 = W * (0.35 + rand() * 0.3)
      const y0 = H * (0.98 - rand() * 0.1)
      const x1 = W * (0.1 + rand() * 0.8)
      const y1 = H * (0.04 + rand() * 0.3)
      twigs.push([x0, y0, x1, y1])
      g.strokeStyle = grey(95)
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(x0, y0)
      g.lineTo(x1, y1)
      g.stroke()
    }
    for (let k = 0; k < 150; k++) {
      const [x0, y0, x1, y1] = twigs[k % twigs.length]
      const t = rand()
      const x = x0 + (x1 - x0) * t + (rand() - 0.5) * 34
      const y = y0 + (y1 - y0) * t + (rand() - 0.5) * 34
      g.fillStyle = grey(125 + rand() * 105)
      g.beginPath()
      g.ellipse(x, y, 5 + rand() * 6, 10 + rand() * 9, rand() * Math.PI, 0, Math.PI * 2)
      g.fill()
    }
    // blossoms: a few bunches near the twigs' tips (where a bush flowers), each a handful of small
    // 3–5-petal flowers, painted in the mask colour (blue over green: see the shader)
    for (let k = 0; k < blossoms; k++) {
      const [x0, y0, x1, y1] = twigs[Math.floor(rand() * twigs.length)]
      const t = 0.6 + rand() * 0.4
      const bx = x0 + (x1 - x0) * t
      const by = y0 + (y1 - y0) * t
      const flowers = 3 + Math.floor(rand() * 5)
      for (let f = 0; f < flowers; f++) {
        const cx = bx + (rand() - 0.5) * 34
        const cy = by + (rand() - 0.5) * 34
        const petals = 3 + Math.floor(rand() * 3)
        const r = 4 + rand() * 4
        for (let p = 0; p < petals; p++) {
          const a = (p / petals) * Math.PI * 2 + rand()
          const v = 170 + rand() * 80
          g.fillStyle = `rgb(${Math.round(v)},${Math.round(v * 0.25)},${Math.round(Math.min(255, v + 60))})`
          g.beginPath()
          g.ellipse(cx + Math.cos(a) * r * 0.7, cy + Math.sin(a) * r * 0.7, r * 0.75, r * 0.55, a, 0, Math.PI * 2)
          g.fill()
        }
      }
    }
    g.restore()
  }
  spray(3, 0)
  spray(4, 6)
  g.restore()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.anisotropy = 8
  return texture
}

/** a leaf: a strip along an arching spine, textured with one atlas cell */
interface Leaf {
  cell: number
  /** from where it springs, the direction it points (azimuth, rise) and its length and width */
  at: THREE.Vector3
  azimuth: number
  rise: number
  length: number
  width: number
  /** how far it arcs down under its weight */
  droop: number
  /** a bare stalk before the blade (fraction of length) */
  stalk?: number
  color: THREE.Color
}

class Builder {
  position: number[] = []
  normal: number[] = []
  uv: number[] = []
  color: number[] = []
  bloom: number[] = []
  index: number[] = []
  leaf(l: Leaf, segs: number, fold = 0): void {
    const dir = new THREE.Vector3(Math.cos(l.azimuth), 0, Math.sin(l.azimuth))
    const across = new THREE.Vector3(-dir.z, 0, dir.x)
    const u0 = l.cell / CELLS
    const u1 = (l.cell + 1) / CELLS
    const start = this.position.length / 3
    const stalk = l.stalk ?? 0
    for (let k = 0; k <= segs; k++) {
      const s = k / segs
      const d = l.length * s
      const p = l.at.clone().addScaledVector(dir, d * Math.cos(l.rise))
      p.y += d * Math.sin(l.rise) - l.droop * l.length * s * s
      // the blade's width: none along the stalk
      const blade = stalk > 0 ? THREE.MathUtils.smoothstep(s, stalk, stalk + 0.08) : 1
      const w = l.width * blade
      const tilt = new THREE.Vector3(0, 1, 0).multiplyScalar(w * fold)
      const a = p.clone().addScaledVector(across, -w).add(tilt)
      const b = p.clone().addScaledVector(across, w).add(tilt)
      const n = dir.clone().multiplyScalar(0.4).setY(0.9).normalize()
      const v = stalk > 0 ? Math.max(0, (s - stalk) / (1 - stalk)) : s
      for (const [q, u] of [[a, u0], [b, u1]] as const) {
        this.position.push(q.x, q.y, q.z)
        this.normal.push(n.x, n.y, n.z)
        this.uv.push(u, v)
        this.color.push(l.color.r, l.color.g, l.color.b)
        this.bloom.push(0, 0, 0)
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = start + k * 2
      this.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  /** a flat card facing `normal`, for shrub domes */
  card(center: THREE.Vector3, normal: THREE.Vector3, size: number, cell: number, color: THREE.Color, spin: number, bloom?: THREE.Color): void {
    const t = new THREE.Vector3(0, 1, 0).cross(normal)
    if (t.lengthSq() < 1e-4) t.set(1, 0, 0)
    t.normalize().applyAxisAngle(normal, spin)
    const bt = normal.clone().cross(t).normalize()
    const start = this.position.length / 3
    const u0 = cell / CELLS
    const u1 = (cell + 1) / CELLS
    const corners: [number, number, number, number][] = [
      [-1, -1, u0, 1],
      [1, -1, u1, 1],
      [1, 1, u1, 0],
      [-1, 1, u0, 0],
    ]
    for (const [sx, sy, u, v] of corners) {
      const q = center.clone().addScaledVector(t, sx * size * 0.5).addScaledVector(bt, sy * size)
      this.position.push(q.x, q.y, q.z)
      const n = normal.clone().setY(normal.y + 0.5).normalize()
      this.normal.push(n.x, n.y, n.z)
      this.uv.push(u, v)
      this.color.push(color.r, color.g, color.b)
      this.bloom.push(bloom?.r ?? 0, bloom?.g ?? 0, bloom?.b ?? 0)
    }
    this.index.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  build(): THREE.BufferGeometry {
    // baked occlusion: a plant is darker in its heart and at its foot, where little sky reaches
    let top = 0
    for (let k = 1; k < this.position.length; k += 3) top = Math.max(top, this.position[k])
    for (let k = 0; k < this.color.length; k += 3) {
      const y = this.position[k + 1]
      const r = Math.hypot(this.position[k], this.position[k + 2])
      const ao = 0.45 + 0.55 * Math.min(1, THREE.MathUtils.smoothstep(y, 0, top * 0.85) * 0.7 + Math.min(1, r * 1.6) * 0.3)
      this.color[k] *= ao
      this.color[k + 1] *= ao
      this.color[k + 2] *= ao
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    g.setAttribute('bloom', new THREE.Float32BufferAttribute(this.bloom, 3))
    g.setIndex(this.index)
    g.computeBoundingSphere()
    return g
  }
}

export type PlantKind = 'agave' | 'strelitzia' | 'cycad' | 'flax' | 'bougainvillea' | 'hibiscus' | 'seagrape' | 'beachgrass'

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
// (muted, natural greens: the low sun and the leaves' translucency warm and brighten them a lot)
const GREENS = {
  agave: srgb(0x7b8c7e),
  strelitzia: srgb(0x566a3c),
  cycad: srgb(0x4c6232),
  flax: srgb(0x5f683c),
  shrub: srgb(0x475a30),
  seagrape: srgb(0x6a7a44),
  beachgrass: srgb(0x979462),
}
/** blossom colours: bougainvillea's bracts and hibiscus, a little quieter than a catalogue photo */
const BLOOM = { bougainvillea: srgb(0xa8406f), hibiscus: srgb(0xc4623f) }
/** how much of a flowering bush's outer sprays carry blossom, by variant: one barely in flower, one in full flower */
const FLOWERING = [0.08, 0.25, 0.5]

/** one plant of a kind, ~1 m across and about its natural height in metres (instances scale it) */
function plantGeometry(kind: PlantKind, seed: number, variant: number, level: 0 | 1 | 2): THREE.BufferGeometry {
  const rand = seeded(seed)
  const b = new Builder()
  const o = new THREE.Vector3()
  const jitter = (c: THREE.Color, k = 0.18) => c.clone().multiplyScalar(1 - k / 2 + rand() * k)
  const far = level > 0
  /** how many of the full plant's leaves a level keeps (level 2: a few pixels across — the silhouette only) */
  const keep = (n: number) => Math.max(3, Math.round(n * [1, 0.5, 0.2][level]))
  const segs = [4, 2, 1][level]
  const thin = [1, 0.55, 0.35][level]
  switch (kind) {
    case 'agave': {
      // stiff, thick blades from a tight rosette, the outer ones spreading
      const n = keep(22 * (0.8 + rand() * 0.4))
      for (let i = 0; i < n; i++) {
        const t = i / n
        b.leaf({ cell: 2, at: o, azimuth: i * 2.4 + rand() * 0.3, rise: 0.25 + 1.1 * t, length: 0.75 - 0.3 * t, width: 0.09 / Math.sqrt(thin), droop: 0.05, color: jitter(GREENS.agave) }, segs, 0.25)
      }
      break
    }
    case 'strelitzia': {
      // paddle leaves held up on long stalks, fanning out
      const n = keep(11)
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + rand() * 0.5
        b.leaf({ cell: 1, at: o, azimuth: az, rise: 1.05 + rand() * 0.3, length: 1.5 + rand() * 0.5, droop: 0.25 + rand() * 0.2, stalk: 0.42, color: jitter(GREENS.strelitzia), width: 0.19 / Math.sqrt(thin) }, segs + 2, 0.08)
      }
      break
    }
    case 'cycad': {
      const n = keep(16)
      for (let i = 0; i < n; i++) {
        b.leaf({ cell: 0, at: new THREE.Vector3(0, 0.25, 0), azimuth: i * 2.4 + rand() * 0.2, rise: 0.3 + rand() * 0.7, length: 0.9 + rand() * 0.3, width: 0.2 / thin, droop: 0.35, color: jitter(GREENS.cycad) }, segs, 0.15)
      }
      break
    }
    case 'flax': {
      const n = keep(26)
      for (let i = 0; i < n; i++) {
        b.leaf({ cell: 2, at: o, azimuth: rand() * Math.PI * 2, rise: 1.0 + rand() * 0.45, length: 0.9 + rand() * 0.6, width: 0.035 / thin, droop: 0.3 + rand() * 0.3, color: jitter(GREENS.flax, 0.3) }, segs, 0.1)
      }
      break
    }
    case 'bougainvillea':
    case 'hibiscus':
    case 'seagrape': {
      // a dome of leafy sprays; on the flowering kinds some outer sprays carry small blossoms among their leaves
      const bloom = kind === 'seagrape' ? null : BLOOM[kind]
      const flowering = FLOWERING[variant % FLOWERING.length]
      const green = kind === 'seagrape' ? GREENS.seagrape : GREENS.shrub
      // (a shell of sprays over an opaque core — coreGeometry — not a solid ball of cards: 44 cards stacked
      // ~10 deep and cost more than the rest of the garden together)
      const n = [26, 12, 6][level]
      const flat = FLAT[kind] ?? 0.8
      for (let i = 0; i < n; i++) {
        // points over an irregular dome
        const u = rand()
        const a = rand() * Math.PI * 2
        const el = Math.asin(u) // more cards low round the sides
        const bump = 0.85 + 0.3 * rand()
        const nrm = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) * flat, Math.sin(a) * Math.cos(el)).normalize()
        const c = new THREE.Vector3(Math.cos(a) * Math.cos(el) * 0.5 * bump, 0.05 + Math.sin(el) * flat * bump, Math.sin(a) * Math.cos(el) * 0.5 * bump)
        // (the sun-facing top flowers most; far away the blossom only tints — the mask averages down with the mips)
        const blossom = bloom !== null && rand() < flowering * (nrm.y > 0.3 ? 1 : 0.4)
        const size = [0.5, 0.72, 0.95][level] * (0.8 + rand() * 0.4)
        b.card(c, nrm, size, blossom ? 4 : 3, jitter(green, 0.3), rand() * Math.PI, blossom ? jitter(bloom!, 0.2) : undefined)
      }
      break
    }
    case 'beachgrass': {
      const n = keep(34)
      for (let i = 0; i < n; i++) {
        b.leaf({ cell: 2, at: new THREE.Vector3((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3), azimuth: rand() * Math.PI * 2, rise: 1.1 + rand() * 0.4, length: 0.5 + rand() * 0.4, width: 0.018 / thin, droop: 0.25 + rand() * 0.25, color: jitter(GREENS.beachgrass, 0.35) }, far ? 1 : 3, 0)
      }
      break
    }
  }
  return b.build()
}

/** how high a dome-shaped plant is for its width */
const FLAT: Partial<Record<PlantKind, number>> = { bougainvillea: 0.85, hibiscus: 0.85, seagrape: 0.55 }
const DOMES = new Set<PlantKind>(['bougainvillea', 'hibiscus', 'seagrape'])

/**
 * A dome plant's heart: a lumpy opaque mound inside its shell of leaf cards,
 * the dark mass of leaves and twigs one sees between them. It hides the
 * cards behind it (cheap depth-tested fill instead of layer on layer of
 * alpha-tested ones), and far away it is most of the plant.
 */
function coreGeometry(kind: PlantKind, seed: number): THREE.BufferGeometry {
  const rand = seeded(seed)
  const flat = FLAT[kind] ?? 0.8
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 2)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g = mergeVertices(g)
  const pos = g.attributes.position
  const lumps = Array.from({ length: 6 }, () => new THREE.Vector3(rand() - 0.5, rand() * 0.6, rand() - 0.5).normalize())
  const v = new THREE.Vector3()
  const colors: number[] = []
  const green = kind === 'seagrape' ? GREENS.seagrape : GREENS.shrub
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    let r = 1
    for (const l of lumps) r += 0.13 * Math.max(0, v.dot(l)) ** 3
    v.multiplyScalar(r)
    const y = Math.max(0.02, (v.y * 0.5 + 0.45) * flat * 0.9)
    pos.setXYZ(i, v.x * 0.42, y, v.z * 0.42)
    // (dark: the inside of a bush, lit only through the leaves; darker still at its foot)
    const shade = 0.32 + 0.22 * THREE.MathUtils.smoothstep(y, 0, flat)
    colors.push(green.r * shade, green.g * shade, green.b * shade)
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

export interface PlantSpot {
  x: number
  y: number
  z: number
  kind: PlantKind
  /** metres: the plant's scale */
  size: number
  turn: number
  /** 0–1 colour variation */
  tone: number
}

export interface Plants {
  group: THREE.Group
  /** all but the garden bed by the glass (the floor mirror skips them) */
  far: THREE.Object3D[]
}

/** metres from the garage where a plant drops a level of detail: full, then half its leaves, then its silhouette */
const LOD = { near: 35, mid: 170 }
/** within this, plants show in the garage's floor mirror (the garden bed by the glass); beyond, the mirror skips them */
const MIRRORED = 16
const VARIANTS = 3

/** the instance's colour cast: dark green in the shade of its neighbours, olive, or sun-bleached yellow-green */
const CASTS = [srgb(0xb4c4a8), srgb(0xffffff), srgb(0xfff2c8)].map((c) => c.multiplyScalar(1 / Math.max(c.r, c.g, c.b)))
function plantCast(tone: number, out: THREE.Color): THREE.Color {
  const t = tone * (CASTS.length - 1)
  const i = Math.min(CASTS.length - 2, Math.floor(t))
  return out.copy(CASTS[i]).lerp(CASTS[i + 1], t - i).multiplyScalar(0.8 + 0.3 * tone)
}

/** blossom: the atlas's mask (blue above green) takes the vertex's `bloom` colour at the petal's brightness */
function blossoms<M extends THREE.MeshStandardMaterial>(material: M): M {
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 bloom;\nvarying vec3 vBloom;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBloom = bloom;')
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBloom;').replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      #ifdef USE_MAP
      {
        float on = step( 1e-3, vBloom.r + vBloom.g + vBloom.b );
        float mask = smoothstep( 0.02, 0.1, sampledDiffuseColor.b - sampledDiffuseColor.g ) * on;
        diffuseColor.rgb = mix( diffuseColor.rgb, vBloom * sampledDiffuseColor.r * 1.6, mask );
      }
      #endif`,
    )
  }
  material.customProgramCacheKey = () => `blossoms|${previousKey()}`
  return material
}

export function createPlants(spots: PlantSpot[]): Plants {
  const t0 = performance.now()
  const material = new THREE.MeshStandardMaterial({
    map: leafAtlas(),
    vertexColors: true,
    alphaTest: 0.45,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.75,
    envMapIntensity: OUTDOOR_SKY_LIGHT,
  })
  receiveFarShadow(material)
  blossoms(material)
  // (translucency modest: into a low sun at 0.4 every bush glowed neon)
  foliage(material, { wind: 'grass', translucency: 0.25, coverage: true, crownNormals: true, matte: true })
  const coreMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, envMapIntensity: OUTDOOR_SKY_LIGHT })
  receiveFarShadow(coreMaterial)
  foliage(coreMaterial, { wind: 'grass', matte: true })
  const cores = new Map<string, THREE.BufferGeometry>()
  const group = new THREE.Group()
  group.name = 'plants'
  const far: THREE.Object3D[] = []
  const buckets = new Map<string, PlantSpot[]>()
  const rand = seeded(3)
  for (const p of spots) {
    const d = Math.hypot(p.x, p.z)
    // band 0: by the glass, mirrored; 1: near, full detail; 2: half the leaves; 3: the silhouette
    const band = d < MIRRORED ? 0 : d < LOD.near ? 1 : d < LOD.mid ? 2 : 3
    const key = `${p.kind}|${Math.floor(rand() * VARIANTS)}|${band}`
    buckets.set(key, [...(buckets.get(key) ?? []), p])
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  let tris = 0
  const kinds: PlantKind[] = ['agave', 'strelitzia', 'cycad', 'flax', 'bougainvillea', 'hibiscus', 'seagrape', 'beachgrass']
  kinds.forEach((kind, ki) => {
    for (let v = 0; v < VARIANTS; v++)
      for (const band of [0, 1, 2, 3]) {
        const list = buckets.get(`${kind}|${v}|${band}`)
        if (!list) continue
        const level = band < 2 ? 0 : band === 2 ? 1 : 2
        const geometry = plantGeometry(kind, 100 + ki * 10 + v, v, level)
        const mesh = new THREE.InstancedMesh(geometry, material, list.length)
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.turn)
          // (a little squash and stretch per plant, so no two of a variant stand the same)
          const sy = p.size * (0.85 + 0.3 * ((p.tone * 7.31) % 1))
          mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y - 0.03, p.z), q, new THREE.Vector3(p.size, sy, p.size)))
          mesh.setColorAt(i, plantCast(p.tone, c))
        })
        mesh.castShadow = level === 0 && kind !== 'beachgrass'
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        mesh.name = `plants-${kind}-band${band}`
        group.add(noRaycast(mesh))
        if (band > 0) far.push(mesh)
        tris += (geometry.index!.count / 3) * list.length
        if (DOMES.has(kind)) {
          const key = `${kind}|${v}`
          if (!cores.has(key)) cores.set(key, coreGeometry(kind, 500 + ki * 10 + v))
          const core = new THREE.InstancedMesh(cores.get(key)!, coreMaterial, list.length)
          core.instanceMatrix.copy(mesh.instanceMatrix)
          core.instanceColor = new THREE.InstancedBufferAttribute((mesh.instanceColor!.array as Float32Array).slice(), 3)
          core.castShadow = mesh.castShadow
          core.receiveShadow = true
          core.renderOrder = -1 // (drawn first: the shell's cards behind it fail the depth test)
          core.computeBoundingSphere()
          core.name = `plants-${kind}-core-band${band}`
          group.add(noRaycast(core))
          if (band > 0) far.push(core)
          tris += (core.geometry.index!.count / 3) * list.length
        }
      }
  })
  console.info(`[garage] coast plants: ${spots.length}, ${(tris / 1e6).toFixed(2)} M triangles, ${Math.round(performance.now() - t0)} ms`)
  return { group, far }
}
