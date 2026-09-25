import * as THREE from 'three'
import { fbm, lerp, noRaycast, noise, seeded, smoothstep } from './landform'
import { fujiSurface } from './fuji-mountain'
import type { ImpostorSet } from './impostors'
import { EYE, SITE, farPlacement, farY, heightAt, mapFar } from './site'
import { plantImpostors } from './trees'
import type { Plant } from './vegetation-layout'
import { outdoorMaterial } from './terrain'

/**
 * The land beyond the real-scale valley, all round the horizon: foothills,
 * the mountain ranges around Mount Fuji and the high ranges far off — one
 * continuous terrain in real metres, mapped into the site's distance
 * compression (site.mapFar), so valleys run on from the near land and the
 * ranges stand behind each other as they would.
 *
 * It's built from large forms down, not from one noise function:
 *  1. a few mountain masses (MASSIFS), each a main ridge through its summit
 *     with spurs branching off it — broad or sharp, asymmetric (a steep face
 *     and a long gentle back), a plateau here and there — in three layers:
 *     low rounded foothills, the middle ranges, and big pale ranges far off;
 *  2. broad roots under each mass and rolling ground between them;
 *  3. valley corridors (VALLEYS) cut back into the ranges from the lake's
 *     basin, floored with fields and woods;
 *  4. erosion on the slopes: gullies and spurs running downhill from every
 *     ridge, notches along the crests — small next to the forms they cut;
 * then vegetation and colour by elevation, slope, aspect and moisture, and
 * cast shadows from a horizon map (the ridges shade the valleys behind them
 * at a low sun). Mount Fuji is its own mesh (fuji-mountain.ts); the land here
 * keeps clear of it.
 */

// ─── the forms ──────────────────────────────────────────────────────────────

interface Massif {
  /** azimuth of the summit, degrees from straight behind the pavilion (toward Fuji) toward +x */
  az: number
  /** distance of the summit, metres */
  dist: number
  /** summit above the lake, metres */
  height: number
  /** half-length of the main ridge, metres */
  reach: number
  /** half-width of the ridge's slopes at the summit, metres */
  width: number
  /** direction the main ridge runs, degrees, relative to the line of sight (90 = across the view) */
  axis: number
  /** −1…1: which flank is the steep one and how much (+ = the side facing the pavilion) */
  steep: number
  /** 0 = rounded, 1 = sharp crest */
  sharp: number
  /** 0–1: a flat top */
  plateau?: number
  /** spurs off the main ridge */
  spurs: number
  /** where along the main ridge the summit is, −1…1 (0 = the middle): off-centre peaks make lopsided ridges */
  peakAt?: number
  seed: number
}

const MASSIFS: Massif[] = [
  // foothills: low, broad, rounded — the ends of the ranges' spurs coming down to the valley
  { az: -8, dist: 5200, height: 190, reach: 1800, width: 1100, axis: 80, steep: 0.1, sharp: 0.1, spurs: 3, seed: 1 },
  { az: -32, dist: 4900, height: 340, reach: 2000, width: 1300, axis: 60, steep: 0.2, sharp: 0.15, spurs: 4, peakAt: 0.3, seed: 2 },
  { az: 19, dist: 5500, height: 270, reach: 1700, width: 1200, axis: 105, steep: -0.2, sharp: 0.1, spurs: 3, seed: 3 },
  { az: -68, dist: 4600, height: 390, reach: 2200, width: 1300, axis: 70, steep: 0.3, sharp: 0.2, spurs: 4, seed: 4 },
  { az: 60, dist: 4900, height: 360, reach: 2000, width: 1300, axis: 110, steep: 0.2, sharp: 0.2, spurs: 4, peakAt: -0.3, seed: 5 },
  // the middle ranges: a few dominant masses with long ridges and deep saddles between them
  // a long, level ridge in front of Fuji's foot, hiding its lower skirts — a slight saddle, no peak to compete
  { az: 2, dist: 8900, height: 700, reach: 4800, width: 2600, axis: 92, steep: 0.35, sharp: 0.3, plateau: 0.25, spurs: 5, peakAt: 0.3, seed: 6 },
  // the big mass left of Fuji: a sharp summit, a steep face toward the lake, a long gentle back
  { az: -35, dist: 11200, height: 1320, reach: 4600, width: 3200, axis: 70, steep: 0.55, sharp: 0.85, spurs: 6, peakAt: -0.25, seed: 7 },
  // a sharp peak right of Fuji
  { az: 27, dist: 10200, height: 1120, reach: 3400, width: 2700, axis: 115, steep: -0.4, sharp: 0.95, spurs: 5, peakAt: 0.2, seed: 8 },
  // a broad, rounded mass further right
  { az: 57, dist: 9000, height: 860, reach: 3600, width: 3000, axis: 100, steep: 0.3, sharp: 0.5, spurs: 5, seed: 9 },
  // a plateau on the left, beyond the valley
  { az: -63, dist: 8600, height: 800, reach: 3800, width: 2600, axis: 75, steep: 0.5, sharp: 0.4, plateau: 0.7, spurs: 5, seed: 10 },
  // the ranges round the rest of the horizon, behind the pavilion
  { az: 100, dist: 8200, height: 720, reach: 4000, width: 2800, axis: 85, steep: 0.2, sharp: 0.35, spurs: 5, seed: 11 },
  { az: 138, dist: 7400, height: 560, reach: 3000, width: 2400, axis: 100, steep: -0.2, sharp: 0.2, plateau: 0.4, spurs: 4, seed: 12 },
  { az: 178, dist: 9400, height: 930, reach: 4200, width: 3000, axis: 80, steep: 0.4, sharp: 0.8, spurs: 6, peakAt: 0.3, seed: 13 },
  { az: -142, dist: 8000, height: 650, reach: 3600, width: 2600, axis: 95, steep: -0.3, sharp: 0.3, spurs: 5, seed: 14 },
  { az: -100, dist: 9200, height: 980, reach: 3800, width: 3000, axis: 75, steep: 0.4, sharp: 0.75, spurs: 5, peakAt: -0.2, seed: 15 },
  // the high ranges far off to either side of Fuji (the Southern Alps side): big, simple and pale
  { az: -52, dist: 24000, height: 2450, reach: 9000, width: 6500, axis: 80, steep: 0.4, sharp: 0.8, spurs: 4, peakAt: 0.25, seed: 16 },
  { az: -84, dist: 21000, height: 1900, reach: 8000, width: 6000, axis: 95, steep: 0.2, sharp: 0.5, spurs: 3, seed: 17 },
  { az: 44, dist: 25500, height: 2250, reach: 8500, width: 6500, axis: 100, steep: -0.3, sharp: 0.7, spurs: 4, peakAt: -0.3, seed: 18 },
  { az: 80, dist: 21500, height: 1750, reach: 8000, width: 6000, axis: 85, steep: 0.2, sharp: 0.4, plateau: 0.3, spurs: 3, seed: 19 },
  { az: 128, dist: 23000, height: 1900, reach: 9000, width: 6500, axis: 90, steep: 0.3, sharp: 0.6, spurs: 3, seed: 20 },
  { az: -165, dist: 22000, height: 2100, reach: 9000, width: 6500, axis: 90, steep: -0.3, sharp: 0.7, spurs: 3, seed: 21 },
]

/** valleys running back into the ranges from the lake's basin, between the masses */
const VALLEYS = [
  { az: -48, from: 3600, to: 26000, width: 900, seed: 1 },
  { az: 42, from: 3800, to: 24000, width: 850, seed: 2 },
  { az: 158, from: 3600, to: 20000, width: 1000, seed: 3 },
  { az: -118, from: 3800, to: 18000, width: 900, seed: 4 },
]

/** one straight piece of a ridge crest; the crest height and slope widths run from a to b */
interface Ridge {
  ax: number
  az: number
  dx: number
  dz: number
  len: number
  /** distance along the whole ridge at a (gullies stay continuous across its pieces) */
  along: number
  ha: number
  hb: number
  wa: number
  wb: number
  steep: number
  sharp: number
  plateau: number
  seed: number
  /** which ridge (polyline) this piece belongs to */
  chain: number
  /** spacing of the gullies down its flanks, metres (one for the whole ridge) */
  spacing: number
  /** bounding box, with the slopes */
  box: [number, number, number, number]
}

const deg = THREE.MathUtils.degToRad
const RIDGES: Ridge[] = []
let chains = 0

function addRidge(points: { x: number; z: number; h: number; w: number }[], m: Massif, steep: number, seed: number): void {
  let along = 0
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]
    const b = points[i + 1]
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    const w = Math.max(a.w, b.w) * (1 + Math.abs(steep) * 0.6)
    RIDGES.push({
      ax: a.x,
      az: a.z,
      dx: (b.x - a.x) / len,
      dz: (b.z - a.z) / len,
      len,
      along,
      ha: a.h,
      hb: b.h,
      wa: a.w,
      wb: b.w,
      steep,
      sharp: m.sharp,
      plateau: m.plateau ?? 0,
      seed,
      chain: chains,
      // a few hundred metres on a foothill, a kilometre on a big range
      spacing: Math.max(240, points[0].w * 0.16),
      box: [Math.min(a.x, b.x) - w, Math.min(a.z, b.z) - w, Math.max(a.x, b.x) + w, Math.max(a.z, b.z) + w],
    })
    along += len
  }
  chains++
}

/**
 * A mass's ridges: the main ridge through the summit, meandering, its crest
 * falling away from the summit with knolls and saddles along it; spurs
 * branching off both flanks, lower and shorter, falling to the valley.
 */
function buildMassif(m: Massif): void {
  const rand = seeded(1000 + m.seed * 17)
  const aim = deg(m.az)
  const cx = Math.sin(aim) * m.dist
  const cz = -Math.cos(aim) * m.dist
  // the ridge's direction: `axis` from the line of sight (at 90° it runs across the view)
  const dir = aim + deg(m.axis)
  const ux = Math.sin(dir)
  const uz = -Math.cos(dir)
  // "toward the pavilion" side of the ridge, for the sign of `steep`
  const facing = Math.sign(-(cx * uz - cz * ux)) || 1
  const peakAt = m.peakAt ?? 0
  const steps = 7
  const spine: { x: number; z: number; h: number; w: number; s: number }[] = []
  let bend = 0
  for (let i = 0; i <= steps * 2; i++) {
    const s = i / steps - 1 // −1 … 1 along the ridge
    // a meandering line: the heading drifts a little at each step
    bend += (rand() - 0.5) * 0.35
    const off = (s - peakAt) * m.reach
    const side = Math.sin(bend) * m.reach * 0.12
    const x = cx + ux * off - uz * side
    const z = cz + uz * off + ux * side
    // the crest falls from the summit: steeply at first on a sharp mass, then a long level ridge
    const from = Math.min(1, Math.abs(s - peakAt) / (s > peakAt ? 1 - peakAt : 1 + peakAt)) // 0 at the summit, 1 at either end
    const fall = m.sharp * (1 - Math.exp(-from * 3.2)) * 0.5 + from ** 3 * 0.5
    // knolls and saddles along the crest (a few, not every step)
    const knoll = (rand() - 0.55) * 0.14 * smoothstep(from, 0.05, 0.25)
    const h = m.height * Math.max(0.12, 1 - fall + knoll)
    spine.push({ x, z, h, w: m.width * (0.55 + 0.45 * (1 - from * 0.6)), s })
  }
  // the ends fall to the roots
  spine[0].h *= 0.35
  spine[spine.length - 1].h *= 0.35
  addRidge(spine, m, m.steep * facing, m.seed)
  // spurs: off both flanks at irregular points, angled downhill, lower than the ridge they leave
  for (let k = 0; k < m.spurs; k++) {
    const at = 2 + Math.floor(rand() * (spine.length - 4))
    const root = spine[at]
    const flank = k % 2 === 0 ? 1 : -1
    const angle = deg(35 + rand() * 45) * flank
    const turn = Math.atan2(ux, -uz) + Math.PI / 2 + (flank > 0 ? 0 : Math.PI) - angle * 0.5 * flank
    // from the steep side the spurs are short and steep; from the gentle side they run out long
    const onSteep = flank * Math.sign(m.steep * facing) > 0
    const length = m.reach * (onSteep ? 0.35 + rand() * 0.2 : 0.55 + rand() * 0.35)
    const points: { x: number; z: number; h: number; w: number }[] = []
    let heading = turn
    let x = root.x
    let z = root.z
    const n = 4
    for (let i = 0; i <= n; i++) {
      const f = i / n
      // a spur drops quickly off the ridge, then runs out low
      points.push({ x, z, h: root.h * (0.08 + 0.8 * (1 - f) ** (onSteep ? 2 : 1.5)), w: root.w * (0.6 - 0.25 * f) })
      heading += (rand() - 0.5) * 0.5
      x += Math.sin(heading) * (length / n)
      z += -Math.cos(heading) * (length / n)
    }
    addRidge(points, { ...m, sharp: m.sharp * 0.8 }, m.steep * facing * 0.5, m.seed * 31 + k)
  }
}

for (const m of MASSIFS) buildMassif(m)

// a coarse grid of which ridges reach where
const CELL = 3000
const cells = new Map<number, Ridge[]>()
const cellKey = (i: number, j: number) => (i + 100) * 1000 + (j + 100)
for (const r of RIDGES) {
  for (let i = Math.floor(r.box[0] / CELL); i <= Math.floor(r.box[2] / CELL); i++)
    for (let j = Math.floor(r.box[1] / CELL); j <= Math.floor(r.box[3] / CELL); j++) {
      const k = cellKey(i, j)
      const list = cells.get(k)
      if (list) list.push(r)
      else cells.set(k, [r])
    }
}

// scratch for farLand: every piece's form at the current point, and each ridge's highest
const forms: Form[] = []
const chainMax = new Float64Array(chains)
const chainStamp = new Int32Array(chains)
/** each ridge's blended frame at the point: Σ weight, and Σ weight × (s, d, along, crest) */
const chainFrame = new Float64Array(chains * 5)
let generation = 0
const wetScratch = { v: 0 }
const blended: Form = { h: 0, s: 0, d: 0, along: 0, crest: 0, ridge: null as unknown as Ridge }
/** how quickly a piece's say in its ridge's frame falls off below the ridge's highest piece, metres */
const FRAME_BLEND = 60

/** each mass's broad root: centre, height, 1 / radius² */
const ROOTS = MASSIFS.map((m) => ({
  x: Math.sin(deg(m.az)) * m.dist,
  z: -Math.cos(deg(m.az)) * m.dist,
  h: m.height * 0.1,
  inv2: 1 / (m.reach + m.width) ** 2,
}))

/** a smooth maximum: where two ridges meet they merge into a saddle, not a crease */
function smax(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.max(a, b) + (h * h * k) / 4
}

/** what the land at a point is like, besides its height (filled by farLand) */
interface Ground {
  /** 0–1: in a drainage channel or a valley floor — wetter, more wooded */
  wet: number
  /** 0–1: in a valley corridor */
  valley: number
}

/** a ridge piece's smooth form at a point, before erosion (filled by ridgeForm) */
interface Form {
  h: number
  s: number
  d: number
  along: number
  crest: number
  ridge: Ridge
}

/** a ridge piece's smooth form at (x, z): 0 off its slopes */
function ridgeForm(r: Ridge, x: number, z: number, out: Form): number {
  const px = x - r.ax
  const pz = z - r.az
  const t = Math.min(1, Math.max(0, (px * r.dx + pz * r.dz) / r.len))
  const d = Math.hypot(x - r.ax - r.dx * r.len * t, z - r.az - r.dz * r.len * t)
  // the steep flank is narrower (eased across the crest line, and off the ends, so the width never jumps)
  const w0 = lerp(r.wa, r.wb, t)
  const side = Math.max(-1, Math.min(1, (px * r.dz - pz * r.dx) / (w0 * 0.25)))
  const w = w0 * (1 - 0.5 * r.steep * side)
  const s = d / w
  if (s >= 1) return 0
  const crest = lerp(r.ha, r.hb, t)
  // the slopes: concave under a sharp crest, a shoulder under a rounded one, a table on a plateau
  const sharp = (1 - s) ** 1.7
  const round = 1 - s * s * (3 - 2 * s)
  const table = 1 - smoothstep(s, 0.45, 1)
  out.h = crest * lerp(lerp(round, sharp, r.sharp), table, r.plateau)
  out.s = s
  out.d = d
  out.along = r.along + r.len * t
  out.crest = crest
  out.ridge = r
  return out.h
}

/**
 * Erosion on a ridge's slope: channels and spurs running down the flanks,
 * square to the crest; they wander and join (warped), cut deepest a little
 * below the crest and run out on the lower slopes. Returns the change in
 * height; `wet` gets how far into a channel the point is.
 */
function erosion(f: Form, x: number, z: number, wet: { v: number }): number {
  const slope = smoothstep(f.s, 0.04, 0.22) * (1 - smoothstep(f.s, 0.6, 0.97))
  wet.v = 0
  if (slope === 0) return 0
  const r = f.ridge
  const spacing = r.spacing
  // Across the slope the pattern repeats once per `spacing`, warped strongly (by about a period) so
  // gullies bend, bunch up, fan out and join as they run down — no two alike, no visible lines.
  const phase =
    f.along / spacing +
    1.3 * fbm(x / (spacing * 3.5) + r.seed, z / (spacing * 3.5), 2) +
    (f.d / (spacing * 2.5)) * (fbm(x / 3000 - r.seed, z / 3000, 2) - 0.5) * 2
  const tri = Math.abs(2 * (phase - Math.floor(phase)) - 1) // 0 in a channel, 1 on the spur between two
  // V-shaped channels, rounded spurs; some ravines cut far deeper than their neighbours
  const depth = 0.05 + 0.13 * smoothstep(fbm(f.along / (spacing * 4) + r.seed * 2, f.d / 4000, 2), 0.35, 0.7)
  // broad swells and hollows on top: a slope's large folds
  const fold = fbm(f.along / (spacing * 5) - r.seed, f.d / (spacing * 5), 2) - 0.5
  wet.v = (1 - tri) ** 2 * slope
  return f.crest * slope * (depth * (tri ** 0.7 - 0.6) + 0.12 * fold)
}

/**
 * Knolls and notches along a ridge's crest, as a factor on its height — by
 * distance along the ridge, so it's continuous across its pieces; the fine
 * notches only on sharp ridges.
 */
function crestNoise(f: Form): number {
  const r = f.ridge
  return 0.9 + 0.2 * fbm(f.along / 2600 + r.seed * 3.7, r.seed, 3) + 0.1 * r.sharp * (fbm(f.along / 800, r.seed * 1.3, 2) - 0.5)
}

/** 0–1: how far into a valley corridor a point is */
function valleyAt(x: number, z: number, r: number): number {
  let v = 0
  const a = Math.atan2(x, -z)
  for (const c of VALLEYS) {
    if (r < c.from - 1500 || r > c.to) continue
    // the valley winds as it runs back, and widens
    const centre = deg(c.az) + (0.09 * Math.sin(r / 2600 + c.seed * 2) + 0.05 * Math.sin(r / 900 + c.seed)) * Math.min(1, 6000 / r)
    let da = a - centre
    da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2
    const across = Math.abs(da) * r
    const width = c.width + (r - c.from) * 0.07
    const along = smoothstep(r, c.from - 1500, c.from + 500) * (1 - smoothstep(r, c.to - 4000, c.to))
    v = Math.max(v, (1 - smoothstep(across, width * 0.35, width)) * along)
  }
  return v
}

const scratch: Ground = { wet: 0, valley: 0 }

/**
 * Height above the lake of the land at (x, z), real metres. The near valley
 * (site.heightAt) runs out into it between 3.3 and 5 km.
 */
export function farLand(x: number, z: number, ground: Ground = scratch): number {
  ground.wet = 0
  const r = Math.hypot(x, z)
  // rolling ground between the masses: low, broad swells, higher toward the ranges
  const swell = fbm(x / 5200 + 7, z / 5200 - 3, 3)
  let h = (30 + 130 * swell) * smoothstep(r, 3300, 7000) + 120 * smoothstep(r, 9000, 20000) * fbm(x / 9000, z / 9000, 2)
  // the masses' roots: a broad rise under each, so the ranges stand on their own mass
  let roots = 0
  for (const m of ROOTS) {
    const d2 = ((x - m.x) ** 2 + (z - m.z) ** 2) * m.inv2
    if (d2 < 6) roots = smax(roots, m.h * Math.exp(-d2 * 2), 40)
  }
  h += roots
  // the ridges, merged smoothly, standing on the ground below them
  // Each ridge is the max of its pieces' smooth forms, eroded once in a frame blended from the
  // pieces near that max (softly, so it never jumps). Eroding each piece and taking the max
  // picked whichever overlapping piece had no channel there and wiped the erosion out;
  // averaging the pieces' erosion cancelled it.
  let ridges = 0
  generation++
  let n = 0
  const list = cells.get(cellKey(Math.floor(x / CELL), Math.floor(z / CELL)))
  if (list)
    for (const rg of list) {
      if (x < rg.box[0] || x > rg.box[2] || z < rg.box[1] || z > rg.box[3]) continue
      const f = (forms[n] ??= { h: 0, s: 0, d: 0, along: 0, crest: 0, ridge: rg })
      if (ridgeForm(rg, x, z, f) <= 0) continue
      n++
      const k = rg.chain
      if (chainStamp[k] !== generation) {
        chainStamp[k] = generation
        chainMax[k] = 0
        chainFrame.fill(0, k * 5, k * 5 + 5)
      }
      chainMax[k] = Math.max(chainMax[k], f.h)
    }
  for (let i = 0; i < n; i++) {
    const f = forms[i]
    const k = f.ridge.chain
    const w = Math.exp((f.h - chainMax[k]) / FRAME_BLEND)
    if (w < 1e-3) continue
    chainFrame[k * 5] += w
    chainFrame[k * 5 + 1] += w * f.s
    chainFrame[k * 5 + 2] += w * f.d
    chainFrame[k * 5 + 3] += w * f.along
    chainFrame[k * 5 + 4] += w * f.crest
  }
  // (a ridge far below the highest here can't show through the smooth max: skip its erosion)
  let top = 0
  for (let i = 0; i < n; i++) top = Math.max(top, chainMax[forms[i].ridge.chain])
  for (let i = 0; i < n; i++) {
    const k = forms[i].ridge.chain
    if (chainStamp[k] !== generation) continue
    chainStamp[k] = 0 // once per ridge
    if (chainMax[k] * 1.5 + 50 < top * 0.7 - 90) continue
    const sw = chainFrame[k * 5]
    blended.s = chainFrame[k * 5 + 1] / sw
    blended.d = chainFrame[k * 5 + 2] / sw
    blended.along = chainFrame[k * 5 + 3] / sw
    blended.crest = chainFrame[k * 5 + 4] / sw
    blended.ridge = forms[i].ridge
    const e = erosion(blended, x, z, wetScratch)
    ground.wet = Math.max(ground.wet, wetScratch.v)
    ridges = smax(ridges, Math.max(0, (chainMax[k] + e) * crestNoise(blended)), 90)
  }
  h += ridges
  // a little unevenness everywhere, small next to the forms
  h += 18 * (fbm(x / 700, z / 700, 3) - 0.5) * smoothstep(r, 3300, 6000)
  // the valleys: a floor gently rising as it runs back, the slopes above left standing
  const v = valleyAt(x, z, r)
  if (v > 0) {
    const floor = 25 + (r - 3300) * 0.018 + 30 * fbm(x / 1800, z / 1800, 2)
    h = lerp(h, Math.min(h, floor + h * 0.1), smoothstep(v, 0, 0.9))
  }
  ground.valley = v
  // Fuji's skirts: where the land would run just under the mountain's surface it drops well below
  // it — at 17 km the depth buffer can't tell surfaces ~100 m apart, and they'd flicker
  const fuji = fujiSurface(x, z)
  if (fuji > -1e3 && r > 7000) h -= 220 * (1 - smoothstep(h - fuji, -40, 90))
  // out of the near valley
  const near = smoothstep(r, 3300, 5000)
  return near < 1 ? lerp(heightAt(x, z) - SITE.lakeLevel, h, near) : h
}

// ─── the mesh ───────────────────────────────────────────────────────────────

/** the terrain's rings: from just inside the real-scale land's edge out to the far ranges */
const INNER = 3240
const OUTER = 34000
const RINGS = 170
/** a vertex every 0.25° all round */
const SEGMENTS = 1440
const ringRadius = (i: number) => INNER * (OUTER / INNER) ** (i / RINGS)

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
const TONES = {
  darkForest: srgb(0x1f341c),
  forest: srgb(0x2b4825),
  youngForest: srgb(0x40602e),
  olive: srgb(0x767a44),
  meadow: srgb(0x82924a),
  field: srgb(0x939a55),
  dry: srgb(0x8e7650),
  scrub: srgb(0x676e56),
  rock: srgb(0x7d786f),
  scree: srgb(0x958d80),
}

/** ranges nearer than this get trees (farther, a tree is under a pixel) */
const TREES_WITHIN = 14000
/** trees on the ranges, in real metres (placed and scaled into the compression by createRangeForest) */
const rangeTrees: { x: number; z: number; y: number; h: number; tone: number; pick: number; conifer: boolean; vertex: number }[] = []
/** the far terrain's horizon map (8 bytes a vertex), for the trees on it */
let terrainHorizon: Uint8Array | null = null

/**
 * Horizon map: for each vertex, the elevation angle of the skyline it sees in
 * eight directions, from a height raster of the whole land (Fuji included).
 * The shader compares the sun's elevation with the horizon toward the sun: a
 * ridge between them shades the slope. Directions are azimuths k·45° (0 =
 * toward Fuji, then toward +x), angles stored 0…HORIZON_MAX.
 */
const HORIZON_MAX = 0.6
const RASTER = { half: 36000, cell: 180 }

interface HeightRaster {
  n: number
  data: Float32Array
  get(x: number, z: number): number
}
// the land doesn't change between visits (fixed seeds): built once, shared by the horizon map and the mist floor
let raster: HeightRaster | null = null

function heightRaster(): HeightRaster {
  if (!raster) raster = buildHeightRaster()
  return raster
}

function buildHeightRaster(): HeightRaster {
  const n = Math.round((RASTER.half * 2) / RASTER.cell) + 1
  const data = new Float32Array(n * n)
  for (let j = 0; j < n; j++) {
    const z = -RASTER.half + j * RASTER.cell
    for (let i = 0; i < n; i++) {
      const x = -RASTER.half + i * RASTER.cell
      const r = Math.hypot(x, z)
      const land = r < 3300 ? heightAt(x, z) - SITE.lakeLevel : farLand(x, z)
      data[j * n + i] = Math.max(land, fujiSurface(x, z), 0)
    }
  }
  return {
    n,
    data,
    get(x, z) {
      const fx = (x + RASTER.half) / RASTER.cell
      const fz = (z + RASTER.half) / RASTER.cell
      if (fx < 0 || fz < 0 || fx >= n - 1 || fz >= n - 1) return 0
      const i = Math.floor(fx)
      const j = Math.floor(fz)
      const u = fx - i
      const v = fz - j
      const k = j * n + i
      return (data[k] * (1 - u) + data[k + 1] * u) * (1 - v) + (data[k + n] * (1 - u) + data[k + n + 1] * u) * v
    },
  }
}

/**
 * Where valley mist pools, for the atmosphere effect (`AtmosphereParams.mist`):
 * a texture over the whole land in real metres (the lake at 0), r = the local
 * valley floor — the land's minimum within ~2.5 km, softened — and g = how
 * thick the mist lies there (0.3–1.5, broad patches a few km across). Mist
 * thins with height above this floor, so it follows the terrain: it lies on
 * the lake and in each valley between the ranges, veils every ridge's foot
 * and leaves its crest clear, instead of one flat layer at lake level.
 */
let mistFloor: { floor: THREE.DataTexture; rect: THREE.Vector4 } | null = null
// kept for the page's life, like the raster (one 401² half-float texture): the land never changes
export function createMistFloor(): { floor: THREE.DataTexture; rect: THREE.Vector4 } {
  if (mistFloor) return mistFloor
  const { n, data } = heightRaster()
  const R = 14 // cells (180 m): ~2.5 km
  // min over a box is separable: rows, then columns
  const pass = (src: Float32Array, op: (a: number, b: number) => number, init: number, horizontal: boolean, mean: boolean) => {
    const out = new Float32Array(n * n)
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        let acc = init
        let count = 0
        for (let k = -R; k <= R; k++) {
          const a = horizontal ? i + k : i
          const b = horizontal ? j : j + k
          if (a < 0 || b < 0 || a >= n || b >= n) continue
          acc = op(acc, src[b * n + a])
          count++
        }
        out[j * n + i] = mean ? acc / count : acc
      }
    }
    return out
  }
  const add = (a: number, b: number) => a + b
  let floor = pass(pass(data, Math.min, Infinity, true, false), Math.min, Infinity, false, false)
  floor = pass(pass(floor, add, 0, true, true), add, 0, false, true)
  const texel = new Uint16Array(n * n * 2)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const x = -RASTER.half + i * RASTER.cell
      const z = -RASTER.half + j * RASTER.cell
      const patch = smoothstep(fbm(x / 3200 + 41.7, z / 3200 - 12.3, 3), 0.28, 0.72)
      texel[k * 2] = THREE.DataUtils.toHalfFloat(floor[k])
      texel[k * 2 + 1] = THREE.DataUtils.toHalfFloat(0.3 + 1.2 * patch)
    }
  }
  const texture = new THREE.DataTexture(texel, n, n, THREE.RGFormat, THREE.HalfFloatType)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  // texel centres sit on the raster's samples
  const size = n * RASTER.cell
  const corner = -RASTER.half - RASTER.cell / 2
  mistFloor = { floor: texture, rect: new THREE.Vector4(corner, corner, 1 / size, 1 / size) }
  return mistFloor
}

function createFarTerrain(): THREE.BufferGeometry {
  const count = (RINGS + 1) * SEGMENTS
  const position = new Float32Array(count * 3)
  const ground = new Float32Array(count * 2) // wet, valley
  const ground1: Ground = { wet: 0, valley: 0 }
  for (let i = 0; i <= RINGS; i++) {
    const R = ringRadius(i)
    for (let j = 0; j < SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2
      const x = Math.sin(a) * R
      const z = -Math.cos(a) * R
      const k = i * SEGMENTS + j
      // the innermost ring tucks just under the real-scale land's edge
      const h = i === 0 ? heightAt(x, z) - SITE.lakeLevel - 4 : farLand(x, z, ground1)
      position.set([x, h, z], k * 3)
      ground[k * 2] = i === 0 ? 0 : ground1.wet
      ground[k * 2 + 1] = i === 0 ? 0 : ground1.valley
    }
  }
  const index = new Uint32Array(RINGS * SEGMENTS * 6)
  let n = 0
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const j1 = (j + 1) % SEGMENTS
      const p = i * SEGMENTS + j
      const p1 = i * SEGMENTS + j1
      const q = p + SEGMENTS
      const q1 = p1 + SEGMENTS
      // wound to face up (angle grows clockwise seen from above)
      index.set([p, p1, q, p1, q1, q], n)
      n += 6
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setIndex(new THREE.BufferAttribute(index, 1))
  g.computeVertexNormals() // from the real shape, before the mapping
  const normal = g.attributes.normal
  if (normal.getY(SEGMENTS * 10) < 0) {
    for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]]
    g.index!.needsUpdate = true
    g.computeVertexNormals()
  }

  // ─── cover and colour, from what each point is like ───
  const color = new Float32Array(count * 3)
  const cover = new Float32Array(count)
  const real = new Float32Array(count * 2)
  const c = new THREE.Color()
  const wood = new THREE.Color()
  const rand = seeded(77)
  for (let k = 0; k < count; k++) {
    const x = position[k * 3]
    const h = position[k * 3 + 1]
    const z = position[k * 3 + 2]
    const r = Math.hypot(x, z)
    real[k * 2] = x
    real[k * 2 + 1] = z
    const slope = Math.acos(Math.min(1, normal.getY(k))) // radians
    // aspect: slopes turned toward the afternoon sun (+x, and a little toward the pavilion) dry out
    const sunward = normal.getX(k) * 0.8 + normal.getZ(k) * 0.3
    const wet = ground[k * 2]
    const valley = ground[k * 2 + 1]
    // moisture: gullies, valley floors, low ground
    const moist = Math.min(1, wet * 0.9 + valley * 0.5 + (1 - smoothstep(h, 80, 450)) * 0.25)
    // Forest: dense low down, thinning up the slopes to scrub near the tops (the treeline is
    // ~1,700 m above the lake here), none on cliffs; in stands with clean edges — clearings,
    // meadows and dry sunny slopes between them, woods following the moist gullies up.
    const zone = 1 - smoothstep(h, 650 + 250 * moist, 1350 + 200 * moist)
    const steepness = 1 - smoothstep(slope, deg(32), deg(44))
    const stands = fbm(x / 1700 + 3, z / 1700 - 8, 3) + 0.35 * moist - 0.18 * Math.max(0, sunward) + 0.12 * (1 - smoothstep(h, 200, 700))
    const forest = zone * steepness * smoothstep(stands, 0.36, 0.44)
    cover[k] = forest
    // bare rock: cliffs, and the steeper ground on the high crests; scree below it
    const rocky = Math.max(smoothstep(slope, deg(33), deg(46)), smoothstep(h, 950, 1350) * smoothstep(slope, deg(16), deg(30)))
    // the open ground: lush meadow low and moist, olive grass higher, straw on the dry sunny slopes,
    // grey-green scrub up high
    c.copy(TONES.meadow).lerp(TONES.olive, smoothstep(h, 250, 800) * (1 - moist * 0.5))
    c.lerp(TONES.dry, smoothstep(sunward, 0.05, 0.5) * 0.6 * (1 - moist))
    c.lerp(TONES.scrub, smoothstep(h, 1000, 1500))
    // woods: darker in the moist hollows and on the shaded side, young and lighter at the stands' edges
    wood.copy(TONES.forest).lerp(TONES.darkForest, Math.min(1, moist * 0.8 + smoothstep(-sunward, 0, 0.4) * 0.5))
    wood.lerp(TONES.youngForest, (1 - smoothstep(stands, 0.44, 0.52)) * 0.7 * (1 - moist))
    c.lerp(wood, forest)
    // valley floors: fields and meadows in patches along the corridor
    // (between the woods along the streams; at this distance a field is a few pixels of lighter green)
    if (valley > 0.3) {
      const fields =
        smoothstep(noise(x / 380, z / 380), 0.4, 0.6) * smoothstep(valley, 0.4, 0.9) * (1 - smoothstep(slope, deg(8), deg(16))) * (1 - forest)
      c.lerp(TONES.field, fields * 0.6 * noise(x / 150 + 5, z / 150))
    }
    c.lerp(TONES.scree, rocky * 0.55).lerp(TONES.rock, smoothstep(rocky, 0.55, 1) * 0.8)
    color.set([c.r, c.g, c.b], k * 3)

    // trees on the nearer ranges, in the stands: a few per vertex (vertices are tens of metres apart)
    if (r > 3600 && r < TREES_WITHIN && forest > 0.5) {
      const chance = (forest - 0.5) * 0.8 * (r < 7000 ? 1 : 0.6)
      if (rand() < chance) {
        const nt = 1 + Math.floor(rand() * 2)
        const cell = (r * Math.PI * 2) / SEGMENTS
        for (let t = 0; t < nt; t++) {
          rangeTrees.push({
            x: x + (rand() - 0.5) * cell,
            z: z + (rand() - 0.5) * cell,
            y: h - 3,
            h: 15 * Math.exp((rand() - 0.5) * 0.5),
            tone: rand() * 0.6,
            pick: rand(),
            // cedar, cypress and pine plantations and conifers up high; broadleaf stands low and in the gullies
            conifer: rand() < 0.65 + 0.3 * smoothstep(h, 300, 900) - 0.3 * wet,
            vertex: k,
          })
        }
      }
    }
  }
  g.setAttribute('cover', new THREE.BufferAttribute(cover, 1))
  g.setAttribute('realXZ', new THREE.BufferAttribute(real, 2))
  plantSkylines(position, cover)
  g.setAttribute('color', new THREE.BufferAttribute(color, 3))

  // ─── the horizon map ───
  const raster = heightRaster()
  // (at every other ring and segment — shadows are soft at this scale — and filled in between)
  const horizon = new Uint8Array(count * 8)
  const dirs = Array.from({ length: 8 }, (_, d) => [Math.sin((d * Math.PI) / 4), -Math.cos((d * Math.PI) / 4)])
  for (let i = 0; i <= RINGS; i += 2) {
    for (let j = 0; j < SEGMENTS; j += 2) {
      const k = i * SEGMENTS + j
      const x = position[k * 3]
      const h = position[k * 3 + 1] + 4
      const z = position[k * 3 + 2]
      for (let d = 0; d < 8; d++) {
        let best = 0
        for (let s = 100; s < 16000; s *= 1.28) {
          const t = (raster.get(x + dirs[d][0] * s, z + dirs[d][1] * s) - h) / s
          if (t > best) best = t
        }
        horizon[k * 8 + d] = Math.round((Math.min(HORIZON_MAX, Math.atan(best)) / HORIZON_MAX) * 255)
      }
    }
  }
  for (let i = 0; i <= RINGS; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      if (i % 2 === 0 && j % 2 === 0) continue
      const is = i % 2 ? [i - 1, Math.min(RINGS, i + 1)] : [i]
      const js = j % 2 ? [j - 1, (j + 1) % SEGMENTS] : [j]
      const k = i * SEGMENTS + j
      for (let d = 0; d < 8; d++) {
        let sum = 0
        for (const a of is) for (const b of js) sum += horizon[(a * SEGMENTS + b) * 8 + d]
        horizon[k * 8 + d] = Math.round(sum / (is.length * js.length))
      }
    }
  }
  const horizonA = new Uint8Array(count * 4)
  const horizonB = new Uint8Array(count * 4)
  for (let k = 0; k < count; k++) {
    horizonA.set(horizon.subarray(k * 8, k * 8 + 4), k * 4)
    horizonB.set(horizon.subarray(k * 8 + 4, k * 8 + 8), k * 4)
  }
  terrainHorizon = horizon
  g.setAttribute('horizonA', new THREE.BufferAttribute(horizonA, 4, true))
  g.setAttribute('horizonB', new THREE.BufferAttribute(horizonB, 4, true))
  return mapFar(g)
}

/**
 * Trees along the skyline of the nearer ranges: for each column, the point
 * seen highest from the eye — where trees stand against the sky and give a
 * wooded ridge its ragged edge. Only where the crest is wooded, not on rock or open grass.
 */
function plantSkylines(position: Float32Array, cover: Float32Array): void {
  const rand = seeded(91)
  const eyeAboveLake = EYE - SITE.lakeLevel
  const lastRing = RINGS * Math.log(TREES_WITHIN / INNER) / Math.log(OUTER / INNER)
  for (let j = 0; j < SEGMENTS; j++) {
    let best = -1
    let bestAngle = -Infinity
    // the skyline of the near ranges within TREES_WITHIN (a nearer ridge can hide it: fine, trees there too)
    for (let i = 4; i < lastRing; i++) {
      const k = (i * SEGMENTS + j) * 3
      const angle = (position[k + 1] - eyeAboveLake) / Math.hypot(position[k], position[k + 2])
      if (angle > bestAngle) {
        bestAngle = angle
        best = i
      }
    }
    if (best < 0) continue
    const k = best * SEGMENTS + j
    if (cover[k] < 0.25) continue // open or bare crests
    const k2 = best * SEGMENTS + ((j + 1) % SEGMENTS)
    const perColumn = 2 + Math.floor(rand() * 3)
    for (let t = 0; t < perColumn; t++) {
      if (rand() < 0.4 - cover[k] * 0.3) continue // gaps, more toward a stand's edge
      const f = rand()
      rangeTrees.push({
        x: position[k * 3] + (position[k2 * 3] - position[k * 3]) * f,
        z: position[k * 3 + 2] + (position[k2 * 3 + 2] - position[k * 3 + 2]) * f,
        y: position[k * 3 + 1] + (position[k2 * 3 + 1] - position[k * 3 + 1]) * f - 2,
        h: 16 * Math.exp((rand() - 0.5) * 0.5),
        tone: rand() * 0.6,
        pick: rand(),
        conifer: rand() < 0.8,
        vertex: f < 0.5 ? k : k2,
      })
    }
  }
}

/**
 * Cast shadows from the horizon map: a material whose geometry carries the
 * `horizonA`/`horizonB` attributes (per vertex, or per instance) compares the
 * sun's elevation with the skyline toward it, and loses the sun's light where
 * a ridge stands in the way. Applied after all the lighting (translucency
 * included), so a shaded tree doesn't glow. The sun is the first directional light.
 */
function horizonShadow(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      attribute vec4 horizonA;
      attribute vec4 horizonB;
      varying vec4 vHorizonA;
      varying vec4 vHorizonB;`,
    )
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHorizonA = horizonA;\nvHorizonB = horizonB;')
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec4 vHorizonA;
      varying vec4 vHorizonB;
      float horizonAt( int k ) { return k < 4 ? vHorizonA[ k ] : vHorizonB[ k - 4 ]; }`,
    )
    .replace(
      '#include <aomap_fragment>',
      `#if NUM_DIR_LIGHTS > 0
      {
        // the sun's direction in the world (the light's is in view space; the view's rotation is orthonormal)
        vec3 sunDir = transpose( mat3( viewMatrix ) ) * directionalLights[ 0 ].direction;
        float azimuth = atan( sunDir.x, -sunDir.z ); // 0 toward Fuji, + toward +x, as the map
        float f = mod( azimuth / ( PI / 4.0 ) + 8.0, 8.0 );
        int k0 = int( floor( f ) );
        float horizon = mix( horizonAt( k0 ), horizonAt( ( k0 + 1 ) % 8 ), fract( f ) ) * ${HORIZON_MAX.toFixed(3)};
        // (the sun's disc is half a degree: a soft edge of about that)
        float lit = smoothstep( horizon - 0.008, horizon + 0.008, asin( clamp( sunDir.y, -1.0, 1.0 ) ) );
        reflectedLight.directDiffuse *= lit;
        reflectedLight.directSpecular *= lit;
      }
      #endif
      #include <aomap_fragment>`,
    )
}

/**
 * The far terrain's shading: cast shadows from the horizon map, and per-pixel
 * colour detail — tree crowns and clearings, faded out where they'd be under a pixel.
 */
function rangeMaterial(): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })
  material.onBeforeCompile = (shader) => {
    horizonShadow(shader)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float cover;
        attribute vec2 realXZ;
        varying float vCover;
        varying vec2 vReal;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCover = cover;\nvReal = realXZ;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vCover;
        varying vec2 vReal;
        float rHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
        float rNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( rHash( i ), rHash( i + vec2( 1, 0 ) ), u.x ), mix( rHash( i + vec2( 0, 1 ) ), rHash( i + 1.0 ), u.x ), u.y );
        }
        // noise at a scale in real metres, faded to its mean once a cell is under ~2 pixels
        float rDetail( vec2 p, float scale ) {
          vec2 q = p / scale;
          float px = max( length( fwidth( q ) ), 1e-5 );
          return mix( rNoise( q ), 0.5, smoothstep( 0.25, 0.6, px ) );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          // Texture the vertex colours can't carry: in the woods, crowns in clumps with darker gaps
          // between them; on open ground, patchy grass and scrub. Only where a pixel covers less
          // than a few cells — far off it all averages out to the vertex colour.
          float clumps = rDetail( vReal + 13.0, 70.0 );
          float crowns = rDetail( vReal - 7.0, 24.0 );
          float woods = mix( 1.0, ( 0.62 + 0.55 * clumps ) * ( 0.7 + 0.6 * crowns ), vCover );
          float open = mix( 0.86 + 0.28 * rDetail( vReal + 41.0, 55.0 ), 1.0, vCover );
          diffuseColor.rgb *= woods * open;
        }`,
      )
  }
  material.customProgramCacheKey = () => 'far-terrain'
  return outdoorMaterial(material)
}

/** the forest's impostor material, taking the ranges' cast shadows (per instance) as well */
function shadedImpostors(base: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const material = base.clone()
  material.onBeforeCompile = (shader, renderer) => {
    base.onBeforeCompile.call(base, shader, renderer)
    horizonShadow(shader)
  }
  material.customProgramCacheKey = () => `${base.customProgramCacheKey()}|horizon`
  return material
}

/** the ranges' trees as impostors (the forest's atlas), mapped into the far distance like the ranges themselves */
export function createRangeForest(impostors: ImpostorSet): THREE.Group {
  const group = new THREE.Group()
  group.name = 'range-forest'
  const plants: Plant[] = []
  const where = new Map<Plant, { y: number; vertex: number }>()
  for (const t of rangeTrees) {
    const real = Math.hypot(t.x, t.z)
    const { distance, scale } = farPlacement(real)
    const plan: Plant = {
      x: (t.x * distance) / real,
      z: (t.z * distance) / real,
      kind: t.conifer ? 'conifer' : 'broadleaf',
      height: t.h * scale,
      width: 0.85 + t.tone * 0.4,
      turn: t.pick * Math.PI * 2,
      leanX: 0,
      leanZ: 0,
      tone: t.tone * 0.5, // distant woods: the darker end
      pick: t.pick,
    }
    plants.push(plan)
    where.set(plan, { y: farY(t.y, scale), vertex: t.vertex })
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  // each tree takes the horizon map of the terrain vertex it stands on, as instance attributes —
  // on their own geometries (the forest's are shared with the valley's trees)
  const geometries = impostors.geometries.map((g) => g.clone())
  const order: Plant[] = [] // in the order the instances are filled, mesh after mesh
  const meshes = plantImpostors(
    impostors,
    plants,
    () => 0,
    (spot, h) => {
      order.push(spot.plan)
      const w = h * spot.plan.width
      return m.compose(new THREE.Vector3(spot.plan.x, where.get(spot.plan)!.y, spot.plan.z), q.setFromAxisAngle(up, spot.plan.turn), new THREE.Vector3(w, h, w))
    },
    group,
    geometries,
    false, // (the far shadow map is laid out for the real-scale land; the compressed ranges keep out of it)
  )
  const material = shadedImpostors(impostors.material)
  let next = 0
  for (const mesh of meshes as THREE.InstancedMesh[]) {
    const a = new Uint8Array(mesh.count * 4)
    const b = new Uint8Array(mesh.count * 4)
    for (let i = 0; i < mesh.count; i++) {
      const v = where.get(order[next++])!.vertex * 8
      if (terrainHorizon) {
        a.set(terrainHorizon.subarray(v, v + 4), i * 4)
        b.set(terrainHorizon.subarray(v + 4, v + 8), i * 4)
      }
    }
    mesh.geometry.setAttribute('horizonA', new THREE.InstancedBufferAttribute(a, 4, true))
    mesh.geometry.setAttribute('horizonB', new THREE.InstancedBufferAttribute(b, 4, true))
    mesh.material = material
  }
  for (const g of geometries) if (!meshes.some((mesh) => (mesh as THREE.Mesh).geometry === g)) g.dispose()
  group.traverse((o) => {
    o.raycast = () => {}
  })
  console.info(`[garage] range forest: ${plants.length} impostor trees on the ranges`)
  return group
}

export function createRanges(): THREE.Group {
  rangeTrees.length = 0 // a fresh visit to the garage plants afresh
  const t0 = performance.now()
  const group = new THREE.Group()
  group.name = 'ranges'
  const mesh = noRaycast(new THREE.Mesh(createFarTerrain(), rangeMaterial()))
  mesh.name = 'far-terrain'
  group.add(mesh)
  console.info(`[garage] far terrain: ${RIDGES.length} ridge pieces, ${(performance.now() - t0).toFixed(0)} ms`)
  return group
}

