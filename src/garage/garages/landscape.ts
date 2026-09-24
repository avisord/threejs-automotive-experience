import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { createSky } from './sky'
import { createForest } from './trees'

/**
 * An open-air world for a garage to stand in: an analytic clear sky for any
 * sun position (sky.ts), a 3D Mount Fuji, rolling grassland out to distant
 * ranges, grass around the building and conifer forests (trees.ts).
 *
 * Distance haze isn't painted in: the atmosphere post effect adds it from
 * depth, so it follows the sun and the view.
 *
 * Everything is placed from a fixed seed, so every load — and every frame of
 * an exported video — sees the same landscape.
 */

export interface LandscapeOptions {
  /** ground level around the building */
  groundY: number
  /** true where no grass or tree may grow (under the building, in a pool) */
  keepClear(x: number, z: number): boolean
}

export interface Landscape {
  group: THREE.Group
  /** everything lit by the open sky (the room captures an outdoor environment map for it) */
  outdoor: THREE.Object3D
  sky: ReturnType<typeof createSky>
  /** far detail (distant forests) to leave out of mirror passes — filled once the trees are in */
  farDetail: THREE.Object3D[]
  /** resolves once the trees and their textures are in (never rejects) */
  ready: Promise<void>
}

// ─── noise ────────────────────────────────────────────────────────────────

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** smooth value noise, 0–1 */
function noise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** fractal noise, roughly 0–1 */
function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0
  let amp = 0.5
  let freq = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise(x * freq + i * 17.1, y * freq - i * 9.3)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

/** sharp crests where the noise crosses its middle: mountain ranges, gullies */
const ridged = (x: number, y: number, octaves = 4) => 1 - Math.abs(2 * fbm(x, y, octaves) - 1)

/** deterministic random numbers (mulberry32) */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = THREE.MathUtils.smoothstep
/** meshes out here are far from anything the camera clamps against — skip them in raycasts */
const noRaycast = (o: THREE.Object3D) => (o.raycast = () => {})

/**
 * A disc of `rings` × `segments` vertices, rings spaced by `spacing(i/rings)`
 * (0–1 → radius fraction), shaped and coloured by `vertex`.
 */
function polarGrid(
  radius: number,
  rings: number,
  segments: number,
  spacing: (t: number) => number,
  vertex: (x: number, z: number, t: number, angle: number, color: THREE.Color) => number,
  uvScale = 0,
): THREE.BufferGeometry {
  const count = 1 + rings * segments
  const position = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  const uv = uvScale ? new Float32Array(count * 2) : null
  const c = new THREE.Color()
  const put = (k: number, x: number, z: number, t: number, a: number) => {
    const y = vertex(x, z, t, a, c)
    position.set([x, y, z], k * 3)
    color.set([c.r, c.g, c.b], k * 3)
    uv?.set([x * uvScale, z * uvScale], k * 2)
  }
  put(0, 0, 0, 0, 0)
  for (let i = 1; i <= rings; i++) {
    const t = spacing(i / rings)
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2
      put(1 + (i - 1) * segments + j, Math.cos(a) * t * radius, Math.sin(a) * t * radius, t, a)
    }
  }
  const index: number[] = []
  for (let j = 0; j < segments; j++) index.push(0, 1 + ((j + 1) % segments), 1 + j)
  for (let i = 1; i < rings; i++) {
    const inner = 1 + (i - 1) * segments
    const outer = inner + segments
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments
      index.push(inner + j, inner + j1, outer + j, inner + j1, outer + j1, outer + j)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('color', new THREE.BufferAttribute(color, 3))
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  return g
}

// ─── Mount Fuji ───────────────────────────────────────────────────────────

/**
 * Far enough that its summit sits ~9° up — under the roof line seen from
 * inside the pavilion — and its skirt spreads ~30° either side.
 */
const FUJI = { radius: 540, height: 155, crater: 0.03, craterDepth: 5, at: new THREE.Vector3(0, -8, -900) }

function createFuji(): THREE.Mesh {
  const { radius: R, height: H, crater } = FUJI
  const rock = new THREE.Color(0x3e3036)
  const scree = new THREE.Color(0x5e4c4a)
  const forest = new THREE.Color(0x1f3320)
  const snowWhite = new THREE.Color(0xf4f6fa)
  const geometry = polarGrid(
    R,
    120,
    320,
    (t) => t ** 1.35, // rings bunch up near the summit, where the detail is
    (x, z, t, a, c) => {
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // the famous profile: a steep concave cone with a shallow crater on top
      let h: number
      if (t < crater) h = H - FUJI.craterDepth * (1 - (t / crater) ** 2)
      else h = H * (1 - (t - crater) / (1 - crater)) ** 2.3
      // erosion gullies running down the slope, strongest mid-slope
      const gully = ridged(ca * 9 + t * 1.2, sa * 9 + t * 1.2, 3)
      const envelope = Math.sin(Math.PI * Math.min(1, t * 1.3)) ** 1.2
      h += envelope * H * 0.045 * (gully - 0.55)
      // lumpy lower flanks
      h += smoothstep(t, 0.4, 1) * H * 0.07 * (fbm(x / 70, z / 70) - 0.5)

      // snow down to ~55% of the height, reaching lower in the gullies
      const snowLine = H * (0.5 + 0.1 * (gully - 0.5) + 0.06 * (fbm(ca * 5, sa * 5, 2) - 0.5))
      const snow = smoothstep(h, snowLine - 3, snowLine + 2)
      c.copy(rock).lerp(scree, fbm(x / 25, z / 25, 2))
      c.lerp(forest, smoothstep(t, 0.42, 0.62))
      c.lerp(snowWhite, snow)
      return h
    },
  )
  const fuji = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
  )
  fuji.name = 'fuji'
  fuji.position.copy(FUJI.at)
  noRaycast(fuji)
  return fuji
}

// ─── the land ─────────────────────────────────────────────────────────────

const TERRAIN = { radius: 1500, flat: 40 }

/** ground height at a point — flat round the building, rolling further out, ranges on the horizon */
export function terrainHeight(x: number, z: number, groundY: number): number {
  const r = Math.hypot(x, z)
  let h = groundY
  h += smoothstep(r, TERRAIN.flat, 180) * 8 * (fbm(x / 120, z / 120) - 0.38)
  // distant ranges — kept low straight behind the car, so they don't cut into Fuji
  const towardFuji = Math.exp(-((Math.atan2(x, -z) / 0.7) ** 2))
  h += smoothstep(r, 550, 1400) * 90 * ridged(x / 420, z / 420) * (1 - 0.85 * towardFuji)
  return h
}

/** grey-green noise with little streaks — multiplied over the terrain's colours up close */
function grassDetailTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const img = g.createImageData(size, size)
  const rand = seeded(7)
  for (let i = 0; i < size * size; i++) {
    const v = 190 + rand() * 65
    img.data.set([v * 0.95, v, v * 0.9, 255], i * 4)
  }
  g.putImageData(img, 0, 0)
  for (let i = 0; i < 1400; i++) {
    const x = rand() * size
    const y = rand() * size
    g.strokeStyle = `rgba(${rand() < 0.5 ? '255,255,230' : '60,70,40'},0.25)`
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 5)
    g.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

function createTerrain(groundY: number): THREE.Mesh {
  const lush = new THREE.Color(0x5f8a2e)
  const dry = new THREE.Color(0x8e9a48)
  const deep = new THREE.Color(0x3f6424)
  const range = new THREE.Color(0x5d6f86)
  const geometry = polarGrid(
    TERRAIN.radius,
    150,
    256,
    (t) => t ** 2.2, // dense near the building, sparse at the horizon
    (x, z, t, _a, c) => {
      const h = terrainHeight(x, z, groundY)
      const r = t * TERRAIN.radius
      c.copy(lush).lerp(dry, smoothstep(fbm(x / 45, z / 45), 0.45, 0.75))
      c.lerp(deep, smoothstep(fbm(x / 14 + 5, z / 14), 0.55, 0.8) * 0.7)
      c.lerp(range, smoothstep(h - groundY, 15, 60) * smoothstep(r, 400, 900)) // rock and scrub on the far ridges
      return h
    },
    1 / 3, // grass detail repeats every 3 m
  )
  const terrain = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ vertexColors: true, map: grassDetailTexture(), roughness: 1 }),
  )
  terrain.name = 'terrain'
  noRaycast(terrain)
  return terrain
}

/** three curved blades from one root — one instance of the meadow */
function grassClump(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = []
  const levels = [0, 0.35, 0.7, 1]
  const widths = [0.024, 0.02, 0.012, 0]
  for (let b = 0; b < 3; b++) {
    const turn = (b / 3) * Math.PI * 2 + b * 0.7
    const lean = 0.18 + b * 0.07
    const positions: number[] = []
    const colors: number[] = []
    for (const [k, y] of levels.entries()) {
      const bend = y * y * lean // curls over toward the tip
      for (const side of widths[k] ? [-1, 1] : [0]) {
        const lx = side * widths[k]
        positions.push(Math.cos(turn) * lx - Math.sin(turn) * bend, y, Math.sin(turn) * lx + Math.cos(turn) * bend)
        const shade = 0.45 + 0.55 * y // darker at the root
        colors.push(shade, shade, shade)
      }
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    // lit like the ground it grows from, so the meadow and the terrain match
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length / 3).fill([0, 1, 0]).flat(), 3))
    g.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4, 4, 5, 6])
    blades.push(g)
  }
  const clump = mergeGeometries(blades)!
  for (const g of blades) g.dispose()
  return clump
}

function createMeadow(groundY: number, keepClear: LandscapeOptions['keepClear']): THREE.InstancedMesh {
  const COUNT = 36000
  const INNER = 2
  const OUTER = TERRAIN.flat - 2
  const mesh = new THREE.InstancedMesh(
    grassClump(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    COUNT,
  )
  mesh.name = 'meadow'
  const rand = seeded(21)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const s = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  let n = 0
  while (n < COUNT) {
    const r = Math.sqrt(rand() * (OUTER * OUTER - INNER * INNER) + INNER * INNER)
    const a = rand() * Math.PI * 2
    p.set(Math.cos(a) * r, groundY, Math.sin(a) * r)
    if (keepClear(p.x, p.z)) continue
    // thinner toward the edge, where the terrain's texture takes over
    if (rand() > 1 - 0.6 * smoothstep(r, OUTER * 0.6, OUTER)) continue
    q.setFromAxisAngle(up, rand() * Math.PI * 2)
    const height = 0.3 + rand() * 0.45
    s.set(0.8 + rand() * 0.5, height, 0.8 + rand() * 0.5)
    mesh.setMatrixAt(n, m.compose(p, q, s))
    c.setHSL(0.2 + rand() * 0.06, 0.5 + rand() * 0.25, 0.26 + rand() * 0.1, THREE.SRGBColorSpace) // matched to the terrain's greens
    mesh.setColorAt(n, c)
    n++
  }
  mesh.computeBoundingSphere()
  noRaycast(mesh)
  return mesh
}

export function createLandscape(opts: LandscapeOptions): Landscape {
  const group = new THREE.Group()
  group.name = 'landscape'
  const sky = createSky()
  const outdoor = new THREE.Group()
  outdoor.name = 'outdoor'
  outdoor.add(createFuji(), createTerrain(opts.groundY), createMeadow(opts.groundY, opts.keepClear))
  group.add(sky.mesh, outdoor)
  // straight behind the car the view opens onto the mountain: no trees there
  const towardFuji = (x: number, z: number) => z < -20 && Math.abs(Math.atan2(x, -z)) < 0.42
  const farDetail: THREE.Object3D[] = []
  const ready = createForest({
    seed: 5,
    heightAt: (x, z) => terrainHeight(x, z, opts.groundY),
    keepClear: (x, z) => opts.keepClear(x, z) || towardFuji(x, z) || Math.hypot(x, z) < 44,
  })
    .then(async (forest) => {
      outdoor.add(forest.group)
      farDetail.push(...forest.far)
      await forest.ready
    })
    .catch((err: unknown) => console.error('[garage] forest failed', err))
  return { group, outdoor, sky, farDetail, ready }
}
