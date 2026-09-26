import * as THREE from 'three'

/** Shared tools for building open-air landscapes: noise, seeded randomness, terrain grids. */

function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** smooth value noise, 0–1 */
export function noise(x: number, y: number): number {
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
export function fbm(x: number, y: number, octaves = 4): number {
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
export const ridged = (x: number, y: number, octaves = 4) => 1 - Math.abs(2 * fbm(x, y, octaves) - 1)

/** deterministic random numbers (mulberry32) */
export function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const smoothstep = THREE.MathUtils.smoothstep
export const lerp = THREE.MathUtils.lerp

/** meshes out in the landscape are far from anything the camera clamps against — skip them in raycasts */
export const noRaycast = <T extends THREE.Object3D>(o: T): T => {
  o.raycast = () => {}
  return o
}

/**
 * A disc of `rings` × `segments` vertices, rings spaced by `spacing(i/rings)`
 * (0–1 → radius fraction), shaped and coloured by `vertex`.
 */
export function polarGrid(
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
    position[k * 3] = x
    position[k * 3 + 1] = y
    position[k * 3 + 2] = z
    color[k * 3] = c.r
    color[k * 3 + 1] = c.g
    color[k * 3 + 2] = c.b
    if (uv) {
      uv[k * 2] = x * uvScale
      uv[k * 2 + 1] = z * uvScale
    }
  }
  put(0, 0, 0, 0, 0)
  for (let i = 1; i <= rings; i++) {
    const t = spacing(i / rings)
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2
      put(1 + (i - 1) * segments + j, Math.cos(a) * t * radius, Math.sin(a) * t * radius, t, a)
    }
  }
  const index = new Uint32Array(segments * 3 + (rings - 1) * segments * 6)
  let n = 0
  for (let j = 0; j < segments; j++) {
    index[n++] = 0
    index[n++] = 1 + ((j + 1) % segments)
    index[n++] = 1 + j
  }
  for (let i = 1; i < rings; i++) {
    const inner = 1 + (i - 1) * segments
    const outer = inner + segments
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments
      index[n++] = inner + j
      index[n++] = inner + j1
      index[n++] = outer + j
      index[n++] = inner + j1
      index[n++] = outer + j1
      index[n++] = outer + j
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('color', new THREE.BufferAttribute(color, 3))
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeVertexNormals()
  return g
}
