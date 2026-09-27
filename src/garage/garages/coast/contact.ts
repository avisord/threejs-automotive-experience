import * as THREE from 'three'

/**
 * Where things meet the ground: a raster of soft occlusion round every
 * plant, palm and rock and along the edges of built things standing on the
 * land, baked once when the room is built. The terrain reads it to darken
 * its ambient light and a little of its colour there — the dark, damp,
 * leaf-littered ground a shrub or a boulder sits in — so nothing looks set
 * down on the lawn. One texture instead of a decal per object; past its
 * extent the objects are small on screen and the far shadow map carries it.
 */
export class ContactMap {
  /** half the square's side, metres; its texel is `2 × half / n` */
  readonly half: number
  readonly n: number
  private data: Float32Array
  constructor(half = 320, n = 1600) {
    this.half = half
    this.n = n
    this.data = new Float32Array(n * n)
  }
  private get cell(): number {
    return (2 * this.half) / this.n
  }
  /** combine one more occluder into a texel: 1 − (1 − a)(1 − b), so overlaps deepen but never exceed 1 */
  private put(i: number, j: number, v: number): void {
    const k = j * this.n + i
    this.data[k] = 1 - (1 - this.data[k]) * (1 - v)
  }
  /** a round occluder: full `strength` inside `core`, fading out to `radius` (metres) */
  blob(x: number, z: number, radius: number, strength: number, core = radius * 0.35): void {
    if (Math.abs(x) > this.half + radius || Math.abs(z) > this.half + radius) return
    const c = this.cell
    const i0 = Math.max(0, Math.floor((x - radius + this.half) / c))
    const i1 = Math.min(this.n - 1, Math.ceil((x + radius + this.half) / c))
    const j0 = Math.max(0, Math.floor((z - radius + this.half) / c))
    const j1 = Math.min(this.n - 1, Math.ceil((z + radius + this.half) / c))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot((i + 0.5) * c - this.half - x, (j + 0.5) * c - this.half - z)
        if (d >= radius) continue
        const t = 1 - THREE.MathUtils.smoothstep(d, core, radius)
        this.put(i, j, strength * t)
      }
  }
  /** an axis-aligned footprint (a terrace, a plinth): dark under it, fading out over `reach` metres beyond its edges */
  box(x0: number, z0: number, x1: number, z1: number, reach: number, strength: number): void {
    const c = this.cell
    const i0 = Math.max(0, Math.floor((x0 - reach + this.half) / c))
    const i1 = Math.min(this.n - 1, Math.ceil((x1 + reach + this.half) / c))
    const j0 = Math.max(0, Math.floor((z0 - reach + this.half) / c))
    const j1 = Math.min(this.n - 1, Math.ceil((z1 + reach + this.half) / c))
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const x = (i + 0.5) * c - this.half
        const z = (j + 0.5) * c - this.half
        const d = Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1))
        if (d >= reach) continue
        // (squared falloff: dark in the corner where wall meets grass, gone within a hand's width or two)
        const t = (1 - d / reach) ** 2
        this.put(i, j, strength * t)
      }
  }
  /** the raster as a single-channel texture, and the rect to look it up with ((xz − rect.xy) × rect.zw) */
  texture(): { texture: THREE.DataTexture; rect: THREE.Vector4 } {
    const bytes = new Uint8Array(this.data.length)
    for (let k = 0; k < bytes.length; k++) bytes[k] = Math.round(Math.min(1, this.data[k]) * 255)
    const texture = new THREE.DataTexture(bytes, this.n, this.n, THREE.RedFormat, THREE.UnsignedByteType)
    texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = true
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
    texture.needsUpdate = true
    return { texture, rect: new THREE.Vector4(-this.half, -this.half, 1 / (2 * this.half), 1 / (2 * this.half)) }
  }
}
