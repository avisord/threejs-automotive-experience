import * as THREE from 'three'
import { fbm, ridged, smoothstep } from '../landform'

/**
 * Calle Colonial's layout: a hillside colonial town in a valley running along
 * +z. The main street comes up the valley floor through the car's spot (the
 * origin, flat for a stretch round it), rising gently ahead toward the church
 * and the forested hill that closes the valley, falling behind toward the open
 * plain. Side streets climb the valley's flanks; past the streets' own houses
 * the town goes on up the slopes (town.ts), then the hills and, far off, the
 * mountains (terrain.ts).
 *
 * Every paved surface is at `streetY` (the smooth valley floor, no noise): the
 * main street is level across, a side street takes the main street's grade
 * across its mouth — as real junctions on a slope do — so the ribbons, the
 * corners and the houses all meet at one height without seams.
 */

/** carriageway width, sidewalk width and kerb height (m) */
export const ROAD = { width: 7.2, sidewalk: 2.2, curb: 0.14 }
/** from a street's centre to its building line */
export const FRONT = ROAD.width / 2 + ROAD.sidewalk
/** side streets are narrower */
export const SIDE_ROAD = { width: 6.0, sidewalk: 1.6 }
/** the kerb corners' radius where a side street leaves the main street */
export const CORNER = 3.4

/** a street's centre line sampled every `STEP` m, with its arc length measured from `origin` */
const STEP = 0.5

export interface StreetPoint {
  /** arc length along the street */
  s: number
  /** signed distance from the centre line (+ toward `side` = +1) */
  d: number
}

export class Street {
  readonly x: Float32Array
  readonly z: Float32Array
  /** unit tangent */
  readonly tx: Float32Array
  readonly tz: Float32Array
  /** arc length of sample 0 (negative: the street starts behind its origin) */
  readonly start: number
  readonly end: number
  readonly count: number

  /**
   * `points`: control points (x, z) through which the centre line runs, in order along
   * one axis (`axis`, increasing by `sign`) — nearest-point lookups rely on it.
   * `origin`: the point whose arc length is 0 (the first control point by default).
   */
  readonly name: string
  readonly axis: 'x' | 'z'
  readonly sign: 1 | -1
  readonly width: number
  readonly sidewalk: number

  constructor(name: string, points: [number, number][], axis: 'x' | 'z', sign: 1 | -1, width: number, sidewalk: number, origin?: [number, number]) {
    this.name = name
    this.axis = axis
    this.sign = sign
    this.width = width
    this.sidewalk = sidewalk
    const curve = new THREE.CatmullRomCurve3(points.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
    curve.arcLengthDivisions = 4000
    const length = curve.getLength()
    const n = Math.max(2, Math.round(length / STEP))
    const pts = curve.getSpacedPoints(n)
    this.count = pts.length
    this.x = new Float32Array(this.count)
    this.z = new Float32Array(this.count)
    this.tx = new Float32Array(this.count)
    this.tz = new Float32Array(this.count)
    for (let i = 0; i < this.count; i++) {
      this.x[i] = pts[i].x
      this.z[i] = pts[i].z
    }
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 1)
      const b = Math.min(this.count - 1, i + 1)
      const dx = this.x[b] - this.x[a]
      const dz = this.z[b] - this.z[a]
      const l = Math.hypot(dx, dz)
      this.tx[i] = dx / l
      this.tz[i] = dz / l
    }
    let start = 0
    if (origin) {
      let best = Infinity
      for (let i = 0; i < this.count; i++) {
        const q = (this.x[i] - origin[0]) ** 2 + (this.z[i] - origin[1]) ** 2
        if (q < best) {
          best = q
          start = -i * (length / n)
        }
      }
    }
    this.start = start
    this.end = start + length
    this.step = length / n
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (let i = 0; i < this.count; i++) {
      x0 = Math.min(x0, this.x[i])
      x1 = Math.max(x1, this.x[i])
      z0 = Math.min(z0, this.z[i])
      z1 = Math.max(z1, this.z[i])
    }
    this.box = { x0, x1, z0, z1 }
  }

  /** sample spacing (m) */
  readonly step: number
  /** the centre line's extent in x and z */
  readonly box: { x0: number; x1: number; z0: number; z1: number }

  /** is (x, z) within `margin` m of the centre line's bounding box */
  near(x: number, z: number, margin: number): boolean {
    const b = this.box
    return x > b.x0 - margin && x < b.x1 + margin && z > b.z0 - margin && z < b.z1 + margin
  }

  private index(s: number): number {
    return THREE.MathUtils.clamp((s - this.start) / this.step, 0, this.count - 1)
  }

  /** the centre line's point and tangent at arc length `s` (straight on past the ends) */
  frame(s: number, out = { x: 0, z: 0, tx: 0, tz: 0 }): { x: number; z: number; tx: number; tz: number } {
    const f = this.index(s)
    const i = Math.min(this.count - 2, Math.floor(f))
    const t = f - i
    out.tx = this.tx[i] + (this.tx[i + 1] - this.tx[i]) * t
    out.tz = this.tz[i] + (this.tz[i + 1] - this.tz[i]) * t
    const l = Math.hypot(out.tx, out.tz)
    out.tx /= l
    out.tz /= l
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t
    // past an end: carry on along the end's tangent
    const over = s < this.start ? s - this.start : s > this.end ? s - this.end : 0
    out.x += out.tx * over
    out.z += out.tz * over
    return out
  }

  /** a point `d` m off the centre line at `s` (+d toward the side vector (tz, −tx)) */
  at(s: number, d: number): THREE.Vector2 {
    const f = this.frame(s)
    return new THREE.Vector2(f.x + f.tz * d, f.z - f.tx * d)
  }

  /** the nearest centre-line point: arc length and signed offset (past the ends, along their tangents) */
  nearest(x: number, z: number, out: StreetPoint = { s: 0, d: 0 }): StreetPoint {
    const c = (this.axis === 'z' ? z : x) * this.sign
    const coord = this.axis === 'z' ? this.z : this.x
    // the samples increase along the axis: bisect, then look round for the true nearest
    let lo = 0
    let hi = this.count - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (coord[mid] * this.sign < c) lo = mid
      else hi = mid
    }
    let best = lo
    let bestQ = Infinity
    for (let i = Math.max(0, lo - 80); i <= Math.min(this.count - 1, lo + 80); i++) {
      const q = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2
      if (q < bestQ) {
        bestQ = q
        best = i
      }
    }
    const px = x - this.x[best]
    const pz = z - this.z[best]
    const along = px * this.tx[best] + pz * this.tz[best]
    // (within a sample step, or straight on past an end)
    const inside = best > 0 && best < this.count - 1
    out.s = this.start + best * this.step + (inside ? THREE.MathUtils.clamp(along, -this.step, this.step) : (best === 0 ? Math.min(0, along) : Math.max(0, along)))
    out.d = px * this.tz[best] - pz * this.tx[best]
    return out
  }
}

// ─── the main street ─────────────────────────────────────────────────────────
/**
 * Up the valley along +z: straight through the car's spot, then a long easy
 * bend right (−x) and back — gentle enough that the view up the street stays
 * open to ~300 m and the hill at its head shows over the far rooftops, while
 * the left-hand facades turn a little toward the view.
 */
export const MAIN = new Street(
  'main',
  [
    [10, -340],
    [4, -200],
    [0.6, -90],
    [0, -30],
    [0, 0],
    [0, 40],
    [-1, 110],
    [-4, 200],
    [-9, 300],
    [-10, 420],
    [-4, 540],
    [0, 640],
  ],
  'z',
  1,
  ROAD.width,
  ROAD.sidewalk,
  [0, 0],
)

/** half the length of the level showcase stretch round the car */
export const FLAT = 24

/**
 * The main street's height along it: level round the car, climbing the valley
 * ahead at ~3.5 % with a gentle dip and rise at ~200 m (the road rolls rather
 * than running as one ramp), down ~2.5 % behind toward the plain.
 */
export function mainY(s: number): number {
  const u = Math.max(0, Math.abs(s) - FLAT)
  const soft = (g: number, r: number) => g * (Math.sqrt(u * u + r * r) - r)
  if (s >= 0) return soft(0.036, 50) - 1.4 * Math.exp(-(((s - 230) / 70) ** 2))
  return -soft(0.026, 40)
}

// ─── the valley floor every paved surface lies on ────────────────────────────
const nearMain: StreetPoint = { s: 0, d: 0 }

/** the valley's flanks: level for a street's width, then up (steeper on the +x side) */
function flank(d: number): number {
  const u = Math.max(0, Math.abs(d) - 7)
  // (a hill town: the side streets climb at ~8–10 %, the houses stepping up them)
  const g = d > 0 ? 0.1 : 0.08
  return g * (Math.sqrt(u * u + 22 * 22) - 22)
}

/**
 * The valley floor along the main street, past the street's ends too: on up
 * the valley at an easy grade ahead, out onto the plain behind (the street's
 * own climb carried on for kilometres would stand the hills on a plateau).
 */
function valleyY(s: number): number {
  if (s > 700) return mainY(700) + 0.012 * (s - 700)
  if (s < -420) return mainY(-420) - 0.006 * (-420 - s)
  return mainY(s)
}

/** the smooth valley floor (no noise): every street, pavement and house stands on it */
export function streetY(x: number, z: number): number {
  const m = MAIN.nearest(x, z, nearMain)
  return valleyY(m.s) + flank(m.d)
}

// ─── side streets ────────────────────────────────────────────────────────────
export interface SideStreet {
  street: Street
  /** where it leaves the main street (arc length on the main street) and on which side (+1: +x) */
  at: number
  side: 1 | -1
  /** how far its houses run before the town takes over */
  houses: number
}

/** a side street off the main street at `at`, out to `side`, bending by `bend` m over its `length` */
function sideStreet(name: string, at: number, side: 1 | -1, length: number, bend: number, houses: number): SideStreet {
  const f = MAIN.frame(at)
  // (the main street's side vector (tz, −tx) is +x at the car)
  const nx = f.tz * side
  const nz = -f.tx * side
  const pts: [number, number][] = []
  for (let i = 0; i <= 4; i++) {
    const t = (i / 4) * length
    const b = bend * (i / 4) ** 2
    pts.push([f.x + nx * t + f.tx * b, f.z + nz * t + f.tz * b])
  }
  const axis = Math.abs(nx) > Math.abs(nz) ? 'x' : 'z'
  const sign = ((axis === 'x' ? nx : nz) > 0 ? 1 : -1) as 1 | -1
  return { street: new Street(name, pts, axis, sign, SIDE_ROAD.width, SIDE_ROAD.sidewalk), at, side, houses }
}

/**
 * The side streets: one to the left right beside the car (its kerb sweeping
 * round past the car's flank, as in a racing game's town), one to the right
 * down the view ahead, one behind, and a lane far up the street.
 */
export const SIDES: SideStreet[] = [
  sideStreet('left', -3, 1, 150, 10, 110),
  sideStreet('right-ahead', 74, -1, 140, -8, 100),
  sideStreet('right-behind', -58, -1, 130, 6, 90),
  sideStreet('left-far', 262, 1, 150, -12, 100),
]

/** every street, main first */
export const STREETS: Street[] = [MAIN, ...SIDES.map((s) => s.street)]

/** the church at the top of the main street, on its own small plaza to the left */
export const CHURCH = { s: 560, d: 26, turn: 0 }

// ─── the ground ──────────────────────────────────────────────────────────────
const probe: StreetPoint = { s: 0, d: 0 }

/**
 * How much a point is paved, 0–1: 1 under every street and pavement (and a
 * margin), fading to 0 over a few metres behind the building lines.
 */
export function paved(x: number, z: number): number {
  let p = 0
  for (const street of STREETS) {
    if (!street.near(x, z, 20)) continue
    const n = street.nearest(x, z, probe)
    if (n.s < street.start - 2 || n.s > street.end + 2) continue
    const front = street.width / 2 + street.sidewalk
    p = Math.max(p, 1 - smoothstep(Math.abs(n.d), front + 0.4, front + 3))
  }
  return p
}

/**
 * Distance from the town (m): 0 in the valley along the main street, growing
 * out over the flanks, ahead past the church and behind past the last houses.
 */
export function outOfTown(x: number, z: number, m: StreetPoint = MAIN.nearest(x, z, nearMain)): number {
  const ahead = Math.max(0, m.s - 700)
  const behind = Math.max(0, -380 - m.s)
  return Math.hypot(Math.max(0, Math.abs(m.d) - 60), ahead, behind * 0.6)
}

/**
 * The hills round the town and the mountains far off (m above the valley floor
 * they stand on). Ahead, a broad forested hill closes the valley ~1.5–2.5 km
 * out; ridges run along both flanks; behind, the valley opens toward a plain
 * with a mountain range on the far horizon.
 */
export function hills(x: number, z: number, out = outOfTown(x, z)): number {
  // (seen up the street the hill at its head stands ~3–6° over the far rooftops, as a backdrop, not a wall:
  // at twice these heights and a kilometre nearer it filled the sky over the whole street)
  const near = smoothstep(out, 150, 1200)
  // ridges along the flanks: broken, uneven crests
  const crest = 70 * ridged(x / 1300 + 3.1, z / 1700 - 1.2, 5) ** 1.5 + 30 * fbm(x / 500, z / 500, 4)
  // the hill that closes the valley ahead, and a shoulder off to its left
  const head = 190 * Math.exp(-(((x + 250) / 1000) ** 2 + ((z - 2700) / 700) ** 2)) + 110 * Math.exp(-(((x - 900) / 650) ** 2 + ((z - 2000) / 550) ** 2))
  // far ranges at 5–11 km, all round: ~1–3° over the horizon from the street, pale in the haze (at twice
  // the height they stood over the whole view as a dark wall)
  const r = Math.hypot(x, z)
  const far = smoothstep(r, 5000, 10000) * (120 + 380 * ridged(x / 2600 - 4.2, z / 2600 + 2.7, 5) ** 1.3)
  return near * crest + head + far
}

/** the ground: the valley floor, the hills on it, and a little roughness away from the streets */
export function heightAt(x: number, z: number): number {
  const m = MAIN.nearest(x, z, nearMain)
  const floor = valleyY(m.s) + flank(m.d)
  const out = outOfTown(x, z, m)
  const p = paved(x, z)
  const rough = (fbm(x / 40, z / 40, 3) - 0.5) * 2.4 * smoothstep(out, 0, 120) + (fbm(x / 9, z / 9, 2) - 0.5) * 0.35
  // (under the streets the ground sinks out of sight: the ribbons are the surface there)
  return floor + hills(x, z, out) + rough * (1 - p) - 0.4 * p - 0.06
}
