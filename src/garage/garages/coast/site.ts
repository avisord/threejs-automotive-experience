import * as THREE from 'three'
import { fbm, lerp, noise, ridged, smoothstep } from '../landform'

/**
 * The coastal garage's site, in metres: the garage at the origin on a hillside
 * terrace ~34 m above the sea, its glass wall facing −z. Everything the coast
 * modules place — terrain, sea, rocks, road, plants, the far mountains — reads
 * its layout from here, so it all agrees.
 *
 *   garage on a lawn terrace, a planted slope falling away below the glass
 *   → the shore: rocky points under the garage, a sand cove ahead-right
 *     (~300–550 m), then headland after headland receding to the right
 *   → a coast road winding down the hillside on the right
 *   → the bay: open sea to the left and out to the horizon, the sun over it
 *   → coastal hills rising behind the right-hand shore, middle ridges, a big
 *     mountain mass across the bay (~24 km) and pale ranges beyond
 *
 * The shoreline is one mask (`isLand`), turned into a signed distance to the
 * coast (`shore`) once, on two rasters: every module that needs "how far
 * inland" or "how far offshore" samples it, so the beach, the surf, the
 * seabed's colour and the cliffs all follow the same line.
 */

/** the lawn terrace around the garage (the floor is y = 0) */
export const GROUND = -0.5
/** sea level */
export const SEA = -34
/** eye height the far landscape is laid out for (a standing view inside the garage) */
export const EYE = 1.3

export const COAST = {
  /** real-scale land reaches this far; beyond, far layers are distance-compressed */
  realRadius: 4000,
  compress: { start: 4000, factor: 5 },
  /** how far the far terrain and the sea run, real metres */
  farRadius: 40000,
  /** Earth's radius with the usual refraction allowance (k ≈ 0.13): the sea curves away over the horizon */
  earth: 7.3e6,
}

/** where something `real` metres away is drawn, and how much it's scaled */
export function farPlacement(real: number): { distance: number; scale: number } {
  const { start, factor } = COAST.compress
  const distance = real <= start ? real : start + (real - start) / factor
  return { distance, scale: distance / real }
}

/** how far the Earth's curve drops a point `real` metres away, metres */
export const curveDrop = (real: number) => (real * real) / (2 * COAST.earth)

/**
 * Height to draw a far point at, for its real height above the sea and its
 * placement scale — anchored on the eye, so elevation angles from the garage
 * are exact (curvature included).
 */
export function farY(realAboveSea: number, real: number, scale: number): number {
  const eyeAboveSea = EYE - SEA
  return EYE + scale * (realAboveSea - curveDrop(real) - eyeAboveSea)
}

/**
 * Map geometry built in real metres (x/z around the garage, y above the sea)
 * into the compressed placement vertex by vertex: every point keeps its
 * direction from the eye and its depth order. Compute normals first.
 */
export function mapFar(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const real = Math.max(1, Math.hypot(x, z))
    const { distance, scale } = farPlacement(real)
    pos.setXYZ(i, (x * distance) / real, farY(pos.getY(i), real, scale), (z * distance) / real)
  }
  pos.needsUpdate = true
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

// ─── the shoreline ──────────────────────────────────────────────────────────

const DEG = Math.PI / 180
/** bearing from the garage, radians: 0 straight out through the glass (−z), + to the right (+x) */
export const bearing = (x: number, z: number) => Math.atan2(x, -z)

/**
 * The right-hand coast, as the bearing it lies at for each distance: close in
 * it wraps round under the garage's left, sweeps across the view as the cove
 * (~300–550 m), then recedes nearly edge-on to the right, and far across the
 * bay swings back left as the far shore under the big mountain.
 */
const COAST_LINE: [dist: number, bearingDeg: number][] = [
  [110, -150],
  [170, -70],
  [230, -28],
  [300, -4],
  [420, 11],
  [600, 19],
  [900, 24],
  [1500, 27],
  [2600, 28],
  [4500, 27],
  [8000, 24],
  [13000, 17],
  [18000, 7],
  [23000, -5],
  [30000, -17],
  [40000, -26],
  [60000, -34],
]

function coastBearing(r: number): number {
  const l = Math.log(Math.max(r, COAST_LINE[0][0]))
  for (let i = 1; i < COAST_LINE.length; i++) {
    const [r1, b1] = COAST_LINE[i]
    if (r <= r1 || i === COAST_LINE.length - 1) {
      const [r0, b0] = COAST_LINE[i - 1]
      const t = THREE.MathUtils.clamp((l - Math.log(r0)) / (Math.log(r1) - Math.log(r0)), 0, 1)
      return lerp(b0, b1, t * t * (3 - 2 * t)) * DEG
    }
  }
  return COAST_LINE[COAST_LINE.length - 1][1] * DEG
}

/** 0 inside the sand cove ahead-right, where the shore is one smooth crescent; 1 elsewhere */
export const coveCalm = (r: number) => 1 - smoothstep(r, 250, 300) * (1 - smoothstep(r, 520, 580))

/**
 * Headlands and bays along the coast, as a sideways shift of its bearing.
 * Self-similar (in log distance): points and coves a few hundred metres
 * across close by, kilometres across far off — seen from the garage they
 * overlap in receding layers, as a real coastline does.
 */
function wobble(r: number): number {
  const l = Math.log(r)
  const big = (fbm(l * 2.6 + 3.1, 0.7, 3) - 0.5) * 0.3
  const small = (noise(l * 11 + 1.3, 4.2) - 0.5) * 0.12 + (noise(l * 27 - 5, 1.9) - 0.5) * 0.05
  // sharper points: the noise rectified, so headlands jut out and bays are broad
  const points = Math.max(0, noise(l * 7.3 + 9, 2.2) - 0.55) * 0.9
  // (calmer far out, where the coast runs across the view: there an angular wobble of a few degrees is
  // kilometres of shore, and it folded the far coast into thin spits with bright water behind them)
  return (big + small + points) * coveCalm(r) * smoothstep(r, 180, 320) * (1 - 0.85 * smoothstep(r, 6000, 14000))
}

/** the rocky point that closes the cove on its far side, and the one under the garage at its near end */
const POINTS = [
  { r: 575, width: 0.1, reach: 0.12 },
  { r: 285, width: 0.07, reach: 0.1 },
]

/** small islands and sea stacks, real metres (x, z), radii and a seed */
export const ISLANDS: { x: number; z: number; rx: number; rz: number; seed: number }[] = [
  // stacks off the cove's rocky points (surf breaks round them)
  { x: 95, z: -610, rx: 9, rz: 7, seed: 1 },
  { x: 118, z: -632, rx: 5, rz: 4, seed: 2 },
  { x: -235, z: -392, rx: 8, rz: 6, seed: 3 },
  { x: 290, z: -1080, rx: 14, rz: 10, seed: 4 },
  { x: 182, z: -478, rx: 7, rz: 6, seed: 5 },
  // islands out in the bay (left of centre, as in the reference)
  { x: -1500, z: -9200, rx: 420, rz: 260, seed: 6 },
  { x: -2300, z: -11800, rx: 900, rz: 420, seed: 7 },
  { x: 900, z: -12500, rx: 260, rz: 180, seed: 8 },
]

/** the coast's bearing by distance, headlands and points included — it depends on distance alone, so it's tabulated */
const LIMIT = (() => {
  const n = 8192
  const lo = Math.log(100)
  const hi = Math.log(80000)
  const table = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = Math.exp(lo + ((hi - lo) * i) / (n - 1))
    let limit = coastBearing(r) + wobble(r)
    for (const p of POINTS) limit -= p.reach * Math.exp(-(((Math.log(r) - Math.log(p.r)) / p.width) ** 2))
    table[i] = limit
  }
  return { table, lo, hi, n }
})()
function coastLimit(r: number): number {
  const { table, lo, hi, n } = LIMIT
  const f = THREE.MathUtils.clamp((Math.log(Math.max(r, 100)) - lo) / (hi - lo), 0, 1) * (n - 1)
  const i = Math.min(Math.floor(f), n - 2)
  return lerp(table[i], table[i + 1], f - i)
}

/**
 * The cove, straight out through the glass: a crescent of sand across the
 * view — its shore ~430 m out in the middle, the sand ~150 m deep and nearly
 * level behind it, so the whole beach lies in the band a camera at car height
 * sees over the sill (4.5–7° down) and faces the garage instead of running
 * away edge-on. Rocky points close it at both ends; past the right one the coast
 * swings out and recedes. Shore distance by bearing (degrees → metres).
 */
const COVE: [bearingDeg: number, dist: number][] = [
  [-29, 520],
  [-24, 485],
  [-17, 452],
  [-8, 436],
  [2, 432],
  [10, 444],
  [16, 480],
  [21, 560],
  [25, 720],
  [28, 1050],
  [31, 1600],
]
const COVE_SPAN = { from: COVE[0][0], to: COVE[COVE.length - 1][0] }

/** the cove's shore distance at a bearing (degrees), null outside it */
function coveShore(bDeg: number): number | null {
  if (bDeg < COVE_SPAN.from || bDeg > COVE_SPAN.to) return null
  for (let i = 1; i < COVE.length; i++) {
    const [b1, r1] = COVE[i]
    if (bDeg <= b1) {
      const [b0, r0] = COVE[i - 1]
      const t = (bDeg - b0) / (b1 - b0)
      // (smooth between the points, in log distance: the far end swings out fast)
      return Math.exp(lerp(Math.log(r0), Math.log(r1), t * t * (3 - 2 * t)))
    }
  }
  return null
}

/** 0–1: how far into the cove's sandy middle a bearing is (the points at its ends are rock) */
const coveSand = (bDeg: number) => smoothstep(bDeg, -21, -14) * (1 - smoothstep(bDeg, 17, 22))

/** the mask: is (x, z) land? (raw, sampled once into the shore rasters) */
export function isLand(x: number, z: number): boolean {
  const r = Math.hypot(x, z)
  if (r < 110) return true
  for (const s of ISLANDS) {
    const dx = (x - s.x) / s.rx
    const dz = (z - s.z) / s.rz
    const d2 = dx * dx + dz * dz
    if (d2 > 2.5) continue
    const a = Math.atan2(dz, dx)
    const edge = 1 + 0.35 * (noise(Math.cos(a) * 2 + s.seed * 7, Math.sin(a) * 2) - 0.5)
    if (d2 < edge * edge) return true
  }
  const b = bearing(x, z)
  const cove = coveShore(b / DEG)
  if (cove !== null && r < 6000) {
    // the rocky points are ragged; the sand between them one smooth curve
    const ragged = (1 - coveSand(b / DEG)) * ((noise(b * 60, 3.3) - 0.5) * 40 + (noise(b * 190, 7.1) - 0.5) * 14)
    return r < cove + ragged
  }
  // (land behind the garage's left, round to its back: the headland it stands on)
  return b > coastLimit(r) || b < -165 * DEG
}

// ─── the rasters: signed distance to the shore ──────────────────────────────

interface Raster {
  n: number
  cx: number
  cz: number
  size: number
  data: Float32Array
}

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher) */
function edt1d(f: Float64Array, n: number, d: Float64Array, v: Int32Array, zz: Float64Array): void {
  let k = 0
  v[0] = 0
  zz[0] = -Infinity
  zz[1] = Infinity
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= zz[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    zz[k] = s
    zz[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (zz[k + 1] < q) k++
    d[q] = (q - v[k]) ** 2 + f[v[k]]
  }
}

/** distance (in cells) from every cell to the nearest cell where `target` is set */
function distanceTo(mask: Uint8Array, n: number, target: number): Float32Array {
  const INF = 1e20
  const grid = new Float64Array(n * n)
  for (let i = 0; i < n * n; i++) grid[i] = mask[i] === target ? 0 : INF
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const zz = new Float64Array(n + 1)
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = grid[y * n + x]
    edt1d(f, n, d, v, zz)
    for (let y = 0; y < n; y++) grid[y * n + x] = d[y]
  }
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) f[x] = grid[y * n + x]
    edt1d(f, n, d, v, zz)
    for (let x = 0; x < n; x++) out[y * n + x] = Math.sqrt(d[x])
  }
  return out
}

function buildRaster(n: number, cx: number, cz: number, size: number): Raster {
  const cell = size / n
  const mask = new Uint8Array(n * n)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      mask[j * n + i] = isLand(cx - size / 2 + (i + 0.5) * cell, cz - size / 2 + (j + 0.5) * cell) ? 1 : 0
    }
  }
  const toSea = distanceTo(mask, n, 0)
  const toLand = distanceTo(mask, n, 1)
  const data = new Float32Array(n * n)
  // signed, in metres: + inland, − offshore; ±half a cell so the line lies between cells
  for (let k = 0; k < n * n; k++) data[k] = (mask[k] ? toSea[k] - 0.5 : -(toLand[k] - 0.5)) * cell
  return { n, cx, cz, size, data }
}

function sample(r: Raster, x: number, z: number): number | null {
  const cell = r.size / r.n
  const fx = (x - (r.cx - r.size / 2)) / cell - 0.5
  const fz = (z - (r.cz - r.size / 2)) / cell - 0.5
  if (fx < 0 || fz < 0 || fx >= r.n - 1 || fz >= r.n - 1) return null
  const i = Math.floor(fx)
  const j = Math.floor(fz)
  const u = fx - i
  const v = fz - j
  const k = j * r.n + i
  const d = r.data
  return (d[k] * (1 - u) + d[k + 1] * u) * (1 - v) + (d[k + r.n] * (1 - u) + d[k + r.n + 1] * u) * v
}

let rasters: { near: Raster; far: Raster } | null = null
/** built on first use and kept for the page's life (the coast never changes) */
function shoreRasters(): { near: Raster; far: Raster } {
  if (!rasters) {
    const t0 = performance.now()
    rasters = {
      // 4 m cells over the real-scale land; ~100 m cells out to the far ranges
      near: buildRaster(2048, 0, -1200, 8400),
      far: buildRaster(1024, 0, -8000, 104000),
    }
    console.info(`[garage] coast: shore distance fields in ${Math.round(performance.now() - t0)} ms`)
  }
  return rasters
}

/**
 * Signed distance to the shoreline, metres: + inland, − out at sea. Fine
 * (4 m) over the real-scale land, coarse beyond; with a little noise of its
 * own close in so the waterline isn't a smooth interpolated curve.
 */
export function shore(x: number, z: number): number {
  const { near, far } = shoreRasters()
  const s = sample(near, x, z) ?? sample(far, x, z) ?? -5000
  const r = Math.hypot(x, z)
  if (r > 3000) return s
  // ragged at the scale of boulders and rock shelves — less on the sand
  const rough = (noise(x / 9 + 3, z / 9) - 0.5) * 5 + (noise(x / 3.1, z / 3.1 + 7) - 0.5) * 1.6
  return s + rough * (1 - 0.8 * beachness(x, z))
}

// ─── what kind of shore, and the land behind it ────────────────────────────

/** 0–1: sand here — the cove ahead-right, a second small beach further along, pockets of sand in coves */
export function beachness(x: number, z: number): number {
  const r = Math.hypot(x, z)
  const bDeg = bearing(x, z) / DEG
  // the cove: sand from its waterline back ~110 m, out into its shallows
  const cove = coveShore(bDeg)
  if (cove !== null && r < 1200) {
    const d = r - cove // + out to sea, − inland
    return coveSand(bDeg) * smoothstep(d, -190, -150) * (1 - smoothstep(d, 250, 400))
  }
  // (elsewhere only by the right-hand coast: at the same distance out on the water, or on the left shore, no sand)
  const off = bearing(x, z) - coastLimit(r)
  const nearCoast = smoothstep(off, -0.35, -0.08) * (1 - smoothstep(off, 0.25, 0.5))
  if (nearCoast <= 0) return 0
  const second = smoothstep(r, 1180, 1240) * (1 - smoothstep(r, 1420, 1500))
  const pockets = smoothstep(noise(Math.log(r) * 9 + 2, 5.5), 0.62, 0.72) * smoothstep(r, 700, 900)
  return Math.max(second, pockets * 0.9) * nearCoast
}

/** 0–1: how cliff-like the shore is (tall rock faces on the headlands, lower rocky shore between) */
export function cliffness(x: number, z: number): number {
  const r = Math.hypot(x, z)
  const l = Math.log(Math.max(r, 1))
  const tall = smoothstep(fbm(l * 4 + 1.7, 3.3, 2), 0.4, 0.6)
  return Math.max(0.35, tall) * (1 - beachness(x, z))
}

/** the coast road: a winding line down the right-hand hillside, real metres (x, z) */
const ROAD_POINTS: [number, number][] = [
  [620, 420],
  [430, 170],
  [300, 20],
  [238, -150],
  [258, -330],
  [330, -520],
  [420, -700],
  [500, -866],
  [689, -1102],
  [926, -1426],
  [1230, -1824],
  [1606, -2294],
  [2032, -2850],
]
export const ROAD = { width: 7.5, shoulder: 1.5 }

/** the road's centre line, sampled every ~4 m */
export const roadLine: THREE.Vector3[] = (() => {
  const curve = new THREE.CatmullRomCurve3(ROAD_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
  return curve.getSpacedPoints(Math.round(curve.getLength() / 4))
})()

/** segments of the road in a 64 m grid: nearest-point queries touch only a few */
const ROAD_CELL = 64
const roadGrid = (() => {
  const grid = new Map<string, number[]>()
  for (let i = 0; i < roadLine.length - 1; i++) {
    const a = roadLine[i]
    const b = roadLine[i + 1]
    const cx0 = Math.floor(Math.min(a.x, b.x) / ROAD_CELL)
    const cx1 = Math.floor(Math.max(a.x, b.x) / ROAD_CELL)
    const cz0 = Math.floor(Math.min(a.z, b.z) / ROAD_CELL)
    const cz1 = Math.floor(Math.max(a.z, b.z) / ROAD_CELL)
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cz = cz0; cz <= cz1; cz++) {
        const k = `${cx},${cz}`
        grid.set(k, [...(grid.get(k) ?? []), i])
      }
  }
  return grid
})()

/** distance to the road's centre line (Infinity if more than a cell away) and where along it (index into roadLine, fractional) */
export function nearestRoad(x: number, z: number): { d: number; t: number } {
  const cx = Math.floor(x / ROAD_CELL)
  const cz = Math.floor(z / ROAD_CELL)
  let best = Infinity
  let bestT = 0
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++)
      for (const s of roadGrid.get(`${cx + i},${cz + j}`) ?? []) {
        const a = roadLine[s]
        const b = roadLine[s + 1]
        const abx = b.x - a.x
        const abz = b.z - a.z
        const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1)
        const d = Math.hypot(x - a.x - abx * t, z - a.z - abz * t)
        if (d < best) {
          best = d
          bestT = s + t
        }
      }
  return { d: best, t: bestT }
}

/**
 * The eye the near slope is designed for: a camera ~2 m up in front of the
 * car, looking past it and out through the glass. The floor's edge hides
 * everything more than ~8° below its horizon (a camera at car height sees
 * down to ~5.5°). So the land below the glass falls away under that line —
 * hidden, as the ground below a cliff-top window is — until it's down at the
 * shore, and the cove beyond (at 5–7°) shows whole above the sill. Capping
 * the slope *along* a sightline instead squeezed all of it into one sliver
 * at the sea's edge, and any rise on it hid the beach behind.
 */
export const VIEW_EYE = { y: 2, z: 7.4, depression: 8.4 * DEG }

/** 0–1: in the view out through the glass (the slope there must stay under the sightline) */
export const inView = (x: number, z: number) => {
  // (wider to the right: the coast recedes that way, and a hill beside the garage would hide it)
  const b = bearing(x, z)
  return b < 0 ? 1 - smoothstep(-b, 38 * DEG, 62 * DEG) : 1 - smoothstep(b, 52 * DEG, 78 * DEG)
}

/** the sightline cap at a point: the land stays under the floor edge's line from the design eye */
export function sightline(x: number, z: number): number {
  const d = Math.hypot(x, z)
  return VIEW_EYE.y - (d + VIEW_EYE.z) * Math.tan(VIEW_EYE.depression) - 0.4
}

/**
 * The terrace: flat lawn round the garage's sides and back; in front it ends
 * at the planter along the glass and the land drops away at once — a lawn
 * running on past the glass would hide the cove below it.
 */
const TERRACE = { x: 13, zFront: -9, zBack: 14 }
const terraceWeight = (x: number, z: number) => {
  const dx = Math.max(0, Math.abs(x) - TERRACE.x)
  const back = 1 - smoothstep(Math.hypot(dx, Math.max(0, z - TERRACE.zBack)), 0, 22)
  const front = 1 - smoothstep(TERRACE.zFront - z, 0, 3)
  return Math.min(back, front)
}

/** the land before the road cuts through it and the terrace is levelled */
function naturalHeight(x: number, z: number, s: number): number {
  const r = Math.hypot(x, z)
  if (s < 0) {
    // the seabed: shelving gently off sand (wide shallows: turquoise water), steeply off rock
    const sand = beachness(x, z)
    const off = -s
    const slope = lerp(0.22, 0.028, sand)
    let depth = 0.4 + off * slope + 8 * smoothstep(off, 60, 600) + 30 * smoothstep(off, 500, 3000)
    // reefs and rocky shelves just off the rocky shore
    depth -= (1 - sand) * 2.5 * smoothstep(fbm(x / 25, z / 25, 3), 0.55, 0.75) * (1 - smoothstep(off, 20, 120))
    return SEA - Math.max(0.25, depth, 0.004 * (r - 700))
  }
  const cliff = cliffness(x, z)
  const sand = beachness(x, z)
  // the shore's rise: a sand beach barely above the water for ~40 m, then dunes and scrub; a cliff
  // rising 15–40 m within a few metres, with ledges (steps of rock strata) on the way up
  // (the cove's sand stays nearly level for 150 m: a beach rising to dunes shows only as a sliver)
  const beachRise = 1.2 * smoothstep(s, 0, 60) + 1.5 * smoothstep(s, 60, 150) + 8 * smoothstep(s, 150, 260)
  // (the cove's own rocky points stay low: tall ones at its ends screened the sea and the sand)
  const inCove = coveShore(bearing(x, z) / DEG) !== null ? 1 - smoothstep(r, 800, 1100) : 0
  const cliffTop = (14 + 26 * smoothstep(fbm(x / 160 + 7, z / 160, 2), 0.3, 0.7)) * (1 - 0.65 * inCove)
  // (a sharp edge and a steep face on the headlands: a slow ramp made every point a rounded sausage)
  const face = smoothstep(s, 0, 4 + 12 * (1 - cliff))
  // ledges: the strata step the face, each a few metres high, the steps wandering along the coast
  const strata = face * cliffTop
  const step = 4.5
  const stepped = Math.floor(strata / step) * step + step * smoothstep((strata % step) / step, 0.55, 1)
  const ledges = lerp(face, stepped / cliffTop, 0.6 * smoothstep(fbm(x / 60, z / 60), 0.35, 0.6))
  const cliffRise = cliffTop * Math.min(1, ledges) + 6 * smoothstep(s, 20, 160)
  let h = SEA + lerp(lerp(cliffRise * 0.55, cliffRise, cliff), beachRise, sand)
  // the hinterland: rolling coastal hills rising inland, gullies running down to the sea
  const inland = smoothstep(s, 40, 1200)
  const hills = 70 * fbm(x / 520 + 11, z / 520 - 3, 4) + 160 * smoothstep(fbm(x / 1400 - 2, z / 1400 + 5, 3), 0.35, 0.8)
  h += inland * hills * smoothstep(r, 150, 700)
  h += 12 * smoothstep(s, 20, 300) * (fbm(x / 140, z / 140, 3) - 0.5)
  // erosion: spurs and hollows down the hillsides (sharp crests, rounded hollows) — the soft noise alone
  // left every hill a smooth dome. Kept off the ground round the garage
  const spurs = ridged(x / 130 + 3, z / 130 + 8, 3)
  h += inland * smoothstep(r, 220, 450) * 16 * (spurs - 0.55) * smoothstep(hills, 10, 60)
  // drainage: small ravines cut down to the shore
  const gully = ridged(x / 240 + 5, z / 240 - 1, 3)
  h -= 9 * smoothstep(gully, 0.82, 0.97) * smoothstep(s, 15, 80) * (1 - smoothstep(s, 400, 900))
  // the cove lies at a valley's mouth: low ground behind the beach, rising gently inland to the hills
  // (without it the land right of the cove rose straight into cliffs and hid the coast beyond)
  const b = bearing(x, z)
  const valley = Math.exp(-(((b - 20 * DEG) / (24 * DEG)) ** 2)) * smoothstep(r, 150, 260) * (1 - smoothstep(r, 480, 640))
  h = lerp(h, SEA + 2.5 + 16 * smoothstep(s, 40, 600) + 6 * (fbm(x / 90, z / 90) - 0.5), valley)
  // the hillside the garage stands on: a broad shoulder at the terrace's level
  const shoulder = Math.exp(-((r / 120) ** 2))
  h = lerp(h, GROUND - 2 - r * 0.05, shoulder * smoothstep(s, 30, 110))
  // Land is land: no hollow behind a beach sinks under the sea (the water would show through as a
  // lagoon). And depth precision a kilometre or more out is metres: low land keeps clear of the
  // water by more the farther it is, or the sea flickers through the far beaches.
  const clearance = Math.max(0, 0.004 * (r - 700))
  return Math.max(h, SEA + Math.min(s * 0.06, 1.2) + clearance * smoothstep(s, 0, 25))
}

/** the road's height at a point along it (roadLine index): the land under it, smoothed over ~120 m */
let roadHeightCache: Float32Array | null = null
/** (built on first use: it samples the shore rasters, which only this garage needs) */
function roadHeights(): Float32Array {
  if (roadHeightCache) return roadHeightCache
  const raw = roadLine.map((p) => naturalHeight(p.x, p.z, shore(p.x, p.z)))
  const out = new Float32Array(raw.length)
  const R = 15
  for (let i = 0; i < raw.length; i++) {
    let sum = 0
    let w = 0
    for (let k = -R; k <= R; k++) {
      const j = THREE.MathUtils.clamp(i + k, 0, raw.length - 1)
      const wk = 1 - Math.abs(k) / (R + 1)
      sum += raw[j] * wk
      w += wk
    }
    // the road keeps well above the sea (it runs along the cliff tops)
    out[i] = Math.max(sum / w, SEA + 12)
  }
  return (roadHeightCache = out)
}
export function roadY(t: number): number {
  const heights = roadHeights()
  const i = Math.min(Math.floor(t), heights.length - 2)
  return lerp(heights[i], heights[i + 1], t - i)
}

/** 0…1: how far a point is into the road's cut (1 on the carriageway) */
export function onRoad(x: number, z: number, near = nearestRoad(x, z)): number {
  return 1 - smoothstep(near.d, ROAD.width / 2 + ROAD.shoulder, ROAD.width / 2 + ROAD.shoulder + 14)
}

/** ground height anywhere in the real-scale zone */
export function heightAt(x: number, z: number): number {
  const s = shore(x, z)
  let h = naturalHeight(x, z, s)
  if (s > 0) {
    // the planted slope below the glass keeps under the sightline, so the sea and the cove show
    // (only the land between the glass and the cove: past it the coast rises in headlands as it will)
    const r = Math.hypot(x, z)
    const view = inView(x, z) * smoothstep(r, 8, 18) * (1 - smoothstep(r, 220, 320))
    // (never below the water where the mask says land: the backshore flattens out just above it)
    if (view > 0) h = lerp(h, Math.min(h, Math.max(sightline(x, z), SEA + 0.8 + 1.5 * smoothstep(s, 10, 120))), view)
    // the terrace
    h = lerp(h, GROUND, terraceWeight(x, z))
    // the road cuts a level bed through whatever is there
    const near = nearestRoad(x, z)
    if (near.d < 40) h = lerp(h, roadY(near.t) - 0.05, onRoad(x, z, near))
  }
  return h
}

/** 0–1: how wooded the land is here (hillsides and gullies wooded, the shore and the cliff tops open) */
export function woodedness(x: number, z: number): number {
  const s = shore(x, z)
  if (s < 0) return 0
  return smoothstep(s, 25, 140) * (0.35 + 0.65 * smoothstep(fbm(x / 300 + 4, z / 300 - 9, 3), 0.35, 0.65))
}

let shoreTex: { texture: THREE.DataTexture; rect: THREE.Vector4 } | null = null
/**
 * The near shore field as a texture for the shaders (terrain, sea): r = signed
 * distance to the shore (metres, + inland), g = beachness. 4 m texels over the
 * real-scale land; `rect` maps world xz to uv: (xz − rect.xy) · rect.zw.
 */
export function shoreTexture(): { texture: THREE.DataTexture; rect: THREE.Vector4 } {
  if (shoreTex) return shoreTex
  const { near } = shoreRasters()
  const { n, cx, cz, size, data } = near
  const cell = size / n
  const texel = new Uint16Array(n * n * 2)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i
      const s = data[k]
      texel[k * 2] = THREE.DataUtils.toHalfFloat(s)
      // (beachness is only asked where it can matter: within ~600 m of the shore)
      const beach = Math.abs(s) < 600 ? beachness(cx - size / 2 + (i + 0.5) * cell, cz - size / 2 + (j + 0.5) * cell) : 0
      texel[k * 2 + 1] = THREE.DataUtils.toHalfFloat(beach)
    }
  }
  const texture = new THREE.DataTexture(texel, n, n, THREE.RGFormat, THREE.HalfFloatType)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping
  texture.needsUpdate = true
  const x0 = cx - size / 2
  const z0 = cz - size / 2
  shoreTex = { texture, rect: new THREE.Vector4(x0, z0, 1 / size, 1 / size) }
  return shoreTex
}

/**
 * The surf's clock, shared by the sea (breakers rolling in) and the beach
 * (the uprush and the wet sand behind it), so a wave that breaks runs up the
 * sand in step. Advanced only through the room's update(dt).
 */
export const SURF = { time: { value: 0 } }

/** the GLSL both use: the surf's timing at a point of the shore */
export const SURF_GLSL = /* glsl */ `
  uniform float uSurfTime;
  float surfHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
  float surfNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( surfHash( i ), surfHash( i + vec2( 1, 0 ) ), u.x ), mix( surfHash( i + vec2( 0, 1 ) ), surfHash( i + 1.0 ), u.x ), u.y );
  }
  // 0…1 through a wave's cycle here: sets arrive every ~9 s, their timing drifting along the shore
  float surfPhase( vec2 xz ) {
    float drift = surfNoise( xz / 70.0 ) * 1.6 + surfNoise( xz / 23.0 ) * 0.35;
    return fract( uSurfTime / 9.0 + drift );
  }
  // how far up the beach the water has run at this moment, metres past the still waterline
  float uprush( vec2 xz ) {
    float p = surfPhase( xz );
    // rushes up fast once the wave has broken (p 0 → 0.35), drains back slowly
    float up = p < 0.35 ? sin( p / 0.35 * 1.5707963 ) : 1.0 - smoothstep( 0.35, 1.0, p );
    return 1.5 + 6.0 * up * ( 0.6 + 0.4 * surfNoise( xz / 31.0 + 4.0 ) );
  }
`
