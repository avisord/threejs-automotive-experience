import * as THREE from 'three'
import { receiveFarShadow } from '../far-shadow'
import { noRaycast, seeded } from '../landform'
import { foliage } from '../foliage'
import { OUTDOOR_SKY_LIGHT } from '../sky'

/**
 * The coast's undergrowth and garden plants, generated from one leaf atlas
 * (a canvas, four cells: a pinnate frond, a broad paddle leaf, a long pointed
 * blade, a leafy spray) as small instanced assets:
 *
 *   agave · strelitzia (paddle leaves on stalks) · cycad (a rosette of fronds)
 *   · flax (a fan of blades) · flowering shrub (a dome of leafy sprays with
 *   magenta or orange blossom, bougainvillea and hibiscus) · sea grape
 *   (rounded leaves, a low mound) · beach grass
 *
 * Each kind has a few seeded variants and a lighter far version; the leaf
 * colours are per vertex (green shades, the blossom's own colour), the
 * instance colour only varies them.
 */

const CELLS = 4
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
  // 3: a leafy spray — small rounded leaves along a twig
  g.save()
  g.translate(W * 3, 0)
  for (let k = 0; k < 60; k++) {
    const y = H * (0.05 + rand() * 0.9)
    const x = W / 2 + (rand() - 0.5) * W * 0.75 * Math.sin(Math.PI * (y / H))
    g.fillStyle = grey(140 + rand() * 90)
    g.beginPath()
    g.ellipse(x, y, 16 + rand() * 14, 11 + rand() * 8, rand() * Math.PI, 0, Math.PI * 2)
    g.fill()
  }
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
      }
    }
    for (let k = 0; k < segs; k++) {
      const a = start + k * 2
      this.index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  /** a flat card facing `normal`, for shrub domes */
  card(center: THREE.Vector3, normal: THREE.Vector3, size: number, cell: number, color: THREE.Color, spin: number): void {
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
    }
    this.index.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3))
    g.setIndex(this.index)
    g.computeBoundingSphere()
    return g
  }
}

export type PlantKind = 'agave' | 'strelitzia' | 'cycad' | 'flax' | 'bougainvillea' | 'hibiscus' | 'seagrape' | 'beachgrass'

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
const GREENS = {
  agave: srgb(0x7f9a86),
  strelitzia: srgb(0x4f7236),
  cycad: srgb(0x456a2a),
  flax: srgb(0x5d6f33),
  shrub: srgb(0x3f6326),
  seagrape: srgb(0x6f8a3a),
  beachgrass: srgb(0x9a9a5e),
}

/** one plant of a kind, ~1 m across and about its natural height in metres (instances scale it) */
function plantGeometry(kind: PlantKind, seed: number, far: boolean): THREE.BufferGeometry {
  const rand = seeded(seed)
  const b = new Builder()
  const o = new THREE.Vector3()
  const jitter = (c: THREE.Color, k = 0.18) => c.clone().multiplyScalar(1 - k / 2 + rand() * k)
  const segs = far ? 2 : 4
  const thin = far ? 0.55 : 1
  switch (kind) {
    case 'agave': {
      // stiff, thick blades from a tight rosette, the outer ones spreading
      const n = Math.round((far ? 11 : 22) * (0.8 + rand() * 0.4))
      for (let i = 0; i < n; i++) {
        const t = i / n
        b.leaf({ cell: 2, at: o, azimuth: i * 2.4 + rand() * 0.3, rise: 0.25 + 1.1 * t, length: 0.75 - 0.3 * t, width: 0.09 * (far ? 1.3 : 1), droop: 0.05, color: jitter(GREENS.agave) }, segs, 0.25)
      }
      break
    }
    case 'strelitzia': {
      // paddle leaves held up on long stalks, fanning out
      const n = far ? 6 : 11
      for (let i = 0; i < n; i++) {
        const az = (i / n) * Math.PI * 2 + rand() * 0.5
        b.leaf({ cell: 1, at: o, azimuth: az, rise: 1.05 + rand() * 0.3, length: 1.5 + rand() * 0.5, width: 0.19, droop: 0.25 + rand() * 0.2, stalk: 0.42, color: jitter(GREENS.strelitzia) }, segs + 2, 0.08)
      }
      break
    }
    case 'cycad': {
      const n = far ? 8 : 16
      for (let i = 0; i < n; i++) {
        b.leaf({ cell: 0, at: new THREE.Vector3(0, 0.25, 0), azimuth: i * 2.4 + rand() * 0.2, rise: 0.3 + rand() * 0.7, length: 0.9 + rand() * 0.3, width: 0.2 / thin, droop: 0.35, color: jitter(GREENS.cycad) }, segs, 0.15)
      }
      break
    }
    case 'flax': {
      const n = far ? 12 : 26
      for (let i = 0; i < n; i++) {
        b.leaf({ cell: 2, at: o, azimuth: rand() * Math.PI * 2, rise: 1.0 + rand() * 0.45, length: 0.9 + rand() * 0.6, width: 0.035 / thin, droop: 0.3 + rand() * 0.3, color: jitter(GREENS.flax, 0.3) }, segs, 0.1)
      }
      break
    }
    case 'bougainvillea':
    case 'hibiscus':
    case 'seagrape': {
      // a dome of leafy sprays; blossom sprays mixed in on the flowering ones
      const bloom = kind === 'bougainvillea' ? srgb(0xc2186e) : kind === 'hibiscus' ? srgb(0xe0502a) : null
      const green = kind === 'seagrape' ? GREENS.seagrape : GREENS.shrub
      const n = far ? 22 : 48
      const flat = kind === 'seagrape' ? 0.55 : 0.85
      for (let i = 0; i < n; i++) {
        // points over an irregular dome
        const u = rand()
        const a = rand() * Math.PI * 2
        const el = Math.asin(u) // more cards low round the sides
        const bump = 0.85 + 0.3 * rand()
        const nrm = new THREE.Vector3(Math.cos(a) * Math.cos(el), Math.sin(el) * flat, Math.sin(a) * Math.cos(el)).normalize()
        const c = new THREE.Vector3(Math.cos(a) * Math.cos(el) * 0.5 * bump, 0.05 + Math.sin(el) * flat * bump, Math.sin(a) * Math.cos(el) * 0.5 * bump)
        const blossom = bloom && rand() < (nrm.y > 0.3 ? 0.4 : 0.2)
        b.card(c, nrm, (far ? 0.6 : 0.46) * (0.8 + rand() * 0.4), 3, blossom ? jitter(bloom!, 0.25) : jitter(green, 0.3), rand() * Math.PI)
      }
      break
    }
    case 'beachgrass': {
      const n = far ? 14 : 34
      for (let i = 0; i < n; i++) {
        b.leaf({ cell: 2, at: new THREE.Vector3((rand() - 0.5) * 0.3, 0, (rand() - 0.5) * 0.3), azimuth: rand() * Math.PI * 2, rise: 1.1 + rand() * 0.4, length: 0.5 + rand() * 0.4, width: 0.018 / thin, droop: 0.25 + rand() * 0.25, color: jitter(GREENS.beachgrass, 0.35) }, far ? 1 : 3, 0)
      }
      break
    }
  }
  return b.build()
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

/** metres from the garage where a plant drops to its far version */
const NEAR = 45
/** within this, plants show in the garage's floor mirror (the garden bed by the glass); beyond, the mirror skips them */
const MIRRORED = 16
const VARIANTS = 3

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
  foliage(material, { wind: 'grass', translucency: 0.4, coverage: true, crownNormals: true, matte: true })
  const group = new THREE.Group()
  group.name = 'plants'
  const far: THREE.Object3D[] = []
  const buckets = new Map<string, PlantSpot[]>()
  const rand = seeded(3)
  for (const p of spots) {
    const d = Math.hypot(p.x, p.z)
    // band 0: by the glass, mirrored; 1: near, full detail; 2: the far version
    const band = d < MIRRORED ? 0 : d < NEAR ? 1 : 2
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
      for (const band of [0, 1, 2]) {
        const list = buckets.get(`${kind}|${v}|${band}`)
        if (!list) continue
        const lod = band === 2 ? 1 : 0
        const geometry = plantGeometry(kind, 100 + ki * 10 + v, lod === 1)
        const mesh = new THREE.InstancedMesh(geometry, material, list.length)
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.turn)
          mesh.setMatrixAt(i, m.compose(new THREE.Vector3(p.x, p.y - 0.03, p.z), q, new THREE.Vector3(p.size, p.size, p.size)))
          mesh.setColorAt(i, c.setScalar(0.85 + p.tone * 0.3))
        })
        mesh.castShadow = lod === 0 && kind !== 'beachgrass'
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        mesh.name = `plants-${kind}-band${band}`
        group.add(noRaycast(mesh))
        if (band > 0) far.push(mesh)
        tris += (geometry.index!.count / 3) * list.length
      }
  })
  console.info(`[garage] coast plants: ${spots.length}, ${(tris / 1e6).toFixed(2)} M triangles, ${Math.round(performance.now() - t0)} ms`)
  return { group, far }
}
