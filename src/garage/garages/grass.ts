import * as THREE from 'three'
import { seeded } from './landform'

/**
 * Grass patches: the meadow's unit is a clump, not a blade. Each patch is a
 * small procedural asset — tens of blades rising from about the same spot, of
 * several shapes (thin, broad, curved, bent over, short leafy forbs, dry
 * stems), heights, widths and leans — with its colour varied blade by blade
 * (the instance colour gives the patch's own green; the blade's vertex colour
 * shades it darker at the root, paler toward the tip, and turns the odd blade
 * olive or straw). Geometry is in metres, standing on the origin; the meadow
 * (landscape.ts) instances a handful of variants of each kind.
 */

export type BladeShape = 'thin' | 'broad' | 'curved' | 'bent' | 'leaf' | 'dry'

export interface PatchSpec {
  /** blades in the patch */
  blades: number
  /** radius the blades rise from, metres */
  radius: number
  /** blade heights, metres */
  height: [number, number]
  /** relative weights of the blade shapes */
  mix: Partial<Record<BladeShape, number>>
  /** segments along a blade (more = smoother curve) */
  segments: number
  /** blade width multiplier (the far LOD widens its fewer blades to cover the same ground) */
  widthScale?: number
  seed: number
}

/**
 * The patch's far version (LOD 1): 60 % of the blades, one or two segments,
 * wider — at a few metres' distance the same silhouette for a third of the
 * triangles. Same seed, so it's the same clump, simplified.
 */
export function farPatch(spec: PatchSpec): PatchSpec {
  return { ...spec, blades: Math.max(6, Math.round(spec.blades * 0.6)), segments: Math.min(spec.segments, spec.height[1] > 0.4 ? 2 : 1), widthScale: 1.6 }
}

/** a blade's width along its length (0 root … 1 tip), as a fraction of its widest */
const profiles: Record<BladeShape, (t: number) => number> = {
  thin: (t) => 1 - t, // straight taper
  broad: (t) => Math.sqrt(Math.max(0, 1 - t * t)) * (1 - 0.3 * t), // full, then rounded off
  curved: (t) => (1 - t) ** 0.8,
  bent: (t) => (1 - t) ** 0.9,
  leaf: (t) => Math.sin(Math.PI * Math.min(1, t * 1.05)) ** 0.8, // a leaf: narrow stalk, wide middle, pointed tip
  dry: (t) => (1 - t) ** 1.2,
}

export function grassPatch(spec: PatchSpec): THREE.BufferGeometry {
  const rand = seeded(spec.seed)
  const shapes = Object.entries(spec.mix) as [BladeShape, number][]
  const total = shapes.reduce((s, [, w]) => s + w, 0)
  const pick = (): BladeShape => {
    let r = rand() * total
    for (const [shape, w] of shapes) if ((r -= w) <= 0) return shape
    return shapes[0][0]
  }
  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  const index: number[] = []
  const n = spec.segments
  for (let b = 0; b < spec.blades; b++) {
    const shape = pick()
    // blades crowd toward the patch's middle; the tallest in the middle too
    const r = spec.radius * Math.sqrt(rand()) * (0.3 + 0.7 * rand())
    const a = rand() * Math.PI * 2
    const ox = Math.cos(a) * r
    const oz = Math.sin(a) * r
    const middle = 1 - r / Math.max(spec.radius, 1e-3)
    const [h0, h1] = spec.height
    let height = h0 + (h1 - h0) * (0.35 * rand() + 0.65 * rand() * (0.5 + 0.5 * middle))
    let width = { thin: 0.014, broad: 0.03, curved: 0.02, bent: 0.02, leaf: 0.06, dry: 0.011 }[shape] * (0.7 + 0.6 * rand()) * (spec.widthScale ?? 1)
    if (shape === 'leaf') height *= 0.45 // forbs stay low
    width *= Math.max(0.6, Math.min(1.8, height / 0.45)) // longer blades are wider too
    // leaning outward from the patch's middle, plus a random turn; curling over toward the tip
    const facing = Math.atan2(oz, ox) + (rand() - 0.5) * 1.4
    const lean = { thin: 0.12, broad: 0.18, curved: 0.4, bent: 0.75, leaf: 0.5, dry: 0.15 }[shape] * (0.6 + 0.8 * rand())
    const dx = Math.cos(facing)
    const dz = Math.sin(facing)
    // the blade's own flat face turns a little from the lean direction
    const twist = (rand() - 0.5) * 1.2
    const sx = -Math.sin(facing + twist)
    const sz = Math.cos(facing + twist)
    // colour: root dark, tip pale; the odd blade olive, straw or deep green
    const cast = rand()
    const tone =
      shape === 'dry'
        ? [1.75, 1.45, 0.75]
        : cast < 0.12
          ? [1.2, 1.1, 0.7] // olive
          : cast < 0.22
            ? [0.8, 0.9, 0.85] // deep
            : [1, 1, 1]
    const base = position.length / 3
    for (let k = 0; k <= n; k++) {
      const t = k / n
      const y = height * (shape === 'bent' ? t * (1 - 0.35 * t * t) : t)
      const bend = height * lean * t ** (shape === 'bent' ? 1.6 : 2.2)
      const w = (width / 2) * profiles[shape](t)
      const cx = ox + dx * bend
      const cz = oz + dz * bend
      const shade = 0.55 + 0.6 * t
      const tipWarm = t * 0.15
      for (const side of k === n ? [0] : [-1, 1]) {
        position.push(cx + sx * w * side, y, cz + sz * w * side)
        // lit like the ground (up), tipped a little toward the blade's face: the meadow shades as one surface
        normal.push(dx * 0.25, 1, dz * 0.25)
        color.push(tone[0] * shade * (1 + tipWarm), tone[1] * shade, tone[2] * shade * (1 - tipWarm))
      }
    }
    // quads up the blade, one triangle at the tip
    for (let k = 0; k < n - 1; k++) {
      const i = base + k * 2
      index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2)
    }
    const last = base + (n - 1) * 2
    index.push(last, last + 1, last + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  const nrm = new THREE.Float32BufferAttribute(normal, 3)
  for (let i = 0; i < nrm.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(nrm, i).normalize()
    nrm.setXYZ(i, v.x, v.y, v.z)
  }
  g.setAttribute('normal', nrm)
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

/** the meadow's layers: patch kinds, each a few variants (seeds) so no clump repeats next to its twin */
export const PATCH_KINDS = {
  /** layer 1: a dense short sward, 5–20 cm, blades too fine to pick out */
  base: { blades: 40, radius: 0.38, height: [0.06, 0.22], mix: { thin: 5, curved: 2, broad: 1, dry: 0.4 }, segments: 2 },
  /** layer 2: tufts of mixed blades, 20–60 cm */
  tuft: { blades: 32, radius: 0.28, height: [0.18, 0.6], mix: { thin: 4, broad: 2, curved: 3, bent: 1.5, dry: 0.6 }, segments: 4 },
  /** low broad-leaved meadow plants among the grass */
  forb: { blades: 14, radius: 0.22, height: [0.2, 0.45], mix: { leaf: 5, broad: 1 }, segments: 3 },
  /** layer 3: tall meadow grass, in stands */
  tall: { blades: 40, radius: 0.34, height: [0.45, 1.15], mix: { thin: 4, curved: 3, bent: 2, broad: 1, dry: 1.2 }, segments: 5 },
  /** dry, seeding stems */
  dry: { blades: 26, radius: 0.28, height: [0.35, 0.9], mix: { dry: 5, thin: 1, bent: 1 }, segments: 4 },
} satisfies Record<string, Omit<PatchSpec, 'seed'>>

export type PatchKind = keyof typeof PATCH_KINDS
