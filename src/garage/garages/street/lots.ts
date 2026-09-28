import { seeded } from '../landform'
import { CHURCH, FRONT, MAIN, SIDES, SIDE_ROAD, type SideStreet, Street } from './site'

/**
 * Who builds where: the frontage of every street divided into lots, each a
 * building of one architectural family. Not random colours and sizes: each
 * family carries the walls, base bands, storeys, widths and roof that belong
 * together (a stone house is low with a tiled roof, a colonial house tall and
 * wide with a parapet), the street is walked lot by lot so a family doesn't
 * repeat within two lots and storeys step by at most one, shops gather near
 * the corners, and alleys break the street wall now and then. Round the car
 * the sequence is set by hand for the composition.
 */

export type FamilyId = 'colonial' | 'terracotta' | 'ochre' | 'blue' | 'green' | 'stone' | 'shop' | 'townhouse'

export interface Family {
  id: FamilyId
  /** wall paints (sRGB), one per building */
  walls: string[]
  /** the base band's colour (a painted dado, or bare stone) */
  bases: string[]
  /** relative odds of 1, 2 and 3 storeys */
  storeys: [number, number, number]
  /** frontage width range (m) */
  width: [number, number]
  /** ground floor height (m): colonial ceilings are high, a shop's higher */
  ground: number
  roof: 'flat' | 'tiled'
  /** how often it turns up along a street (relative) */
  odds: number
}

export const FAMILIES: Record<FamilyId, Family> = {
  // white or cream stucco, a red or stone dado, tall, wide — the grand houses of the old centre
  colonial: { id: 'colonial', walls: ['#e8e3d6', '#ede3cc', '#e2dccf', '#f0e8d8'], bases: ['#8e2f25', '#a3463a', '#7d6a58'], storeys: [0, 0.5, 0.5], width: [12, 19], ground: 4.4, roof: 'flat', odds: 0.8 },
  terracotta: { id: 'terracotta', walls: ['#c65a4a', '#b8503f', '#cf6a55', '#b5453a'], bases: ['#e6dccb', '#8a3528'], storeys: [0, 0.6, 0.4], width: [9, 15], ground: 4.2, roof: 'flat', odds: 1 },
  ochre: { id: 'ochre', walls: ['#e2b441', '#d9a63a', '#e8c35a', '#d7a94f'], bases: ['#8f3a2c', '#6f5a48', '#e8dfcc'], storeys: [0.3, 0.7, 0], width: [7, 12], ground: 4.0, roof: 'flat', odds: 1 },
  blue: { id: 'blue', walls: ['#6d9fc4', '#7fb0cf', '#5f8fb6', '#8bb5c9'], bases: ['#e8e0cf', '#34506a'], storeys: [0.35, 0.65, 0], width: [6, 11], ground: 4.0, roof: 'flat', odds: 0.9 },
  green: { id: 'green', walls: ['#8fc7a8', '#9fcfb3', '#79b39a', '#5fb3ad'], bases: ['#e6dccb', '#2f5a4e'], storeys: [0.3, 0.7, 0], width: [6, 10], ground: 4.0, roof: 'flat', odds: 0.9 },
  // the older houses: bare rubble stone, low, a tiled roof
  stone: { id: 'stone', walls: ['#9b8f7d', '#8a806f', '#a39680'], bases: ['#6f675b', '#7a7064'], storeys: [0.5, 0.5, 0], width: [6, 12], ground: 3.8, roof: 'tiled', odds: 0.45 },
  shop: { id: 'shop', walls: ['#efe2c4', '#f0c9b0', '#d8e3c6', '#e9d6a8'], bases: ['#5a3a2a', '#3f4a52', '#6b2e28'], storeys: [0.5, 0.5, 0], width: [8, 14], ground: 4.6, roof: 'flat', odds: 0.6 },
  // narrow, tall, pastel
  townhouse: { id: 'townhouse', walls: ['#e8a9a0', '#f2c6c0', '#c9a6c9', '#a8d4c8', '#f1d7a6'], bases: ['#e8e0cf', '#7a4b45'], storeys: [0, 0.6, 0.4], width: [4.5, 6.5], ground: 4.0, roof: 'flat', odds: 0.8 },
}

/** an upper floor's height (m) */
export const UPPER = 3.5

export interface Lot {
  street: Street
  /** which side of the street (+1: toward its side vector) */
  side: 1 | -1
  /** frontage along the street (arc lengths) */
  s0: number
  s1: number
  /** from the building line back */
  depth: number
  family: Family
  storeys: number
  /** paint and base, picked from the family's */
  wall: string
  base: string
  /** 0–1: how faded the paint is */
  fade: number
  /** parapet over the flat roof (m) */
  parapet: number
  /** a walled front garden: the house stands `setback` m back behind a low wall */
  setback: number
  seed: number
}

/** a hand-set lot in a sequence: family, width, storeys, and optionally a paint and a garden */
interface Plan {
  f: FamilyId
  w: number
  n: number
  wall?: number
  base?: number
  setback?: number
  /** an alley this wide before the lot */
  gap?: number
}

/**
 * Round the car, set by hand: to its left (+x), past the side street's corner,
 * a tall white colonial house with a red dado, a red house, a yellow one, blue,
 * mint; to its right a blue corner house, a walled garden with trees, a red
 * house and on up the street. Behind the camera the street walks on its own.
 */
const HERO: { side: 1 | -1; from: number; plan: Plan[] }[] = [
  {
    side: 1,
    from: -3 + SIDE_ROAD.width / 2 + SIDE_ROAD.sidewalk,
    plan: [
      { f: 'colonial', w: 17, n: 2, wall: 0, base: 0 },
      { f: 'terracotta', w: 13, n: 3, wall: 0, base: 0 },
      { f: 'ochre', w: 8.5, n: 2, wall: 0, base: 0 },
      { f: 'blue', w: 7, n: 2, wall: 1, base: 0 },
      { f: 'green', w: 7.5, n: 2, wall: 1, base: 0 },
      { f: 'townhouse', w: 5.5, n: 3, wall: 1, base: 0 },
      { f: 'terracotta', w: 9, n: 2, wall: 2, base: 0, gap: 2.2 },
      { f: 'shop', w: 10, n: 1, wall: 0, base: 0 },
    ],
  },
  {
    side: 1,
    from: -3 - SIDE_ROAD.width / 2 - SIDE_ROAD.sidewalk - 12,
    plan: [{ f: 'shop', w: 12, n: 2, wall: 3, base: 2 }],
  },
  {
    side: -1,
    from: -14,
    plan: [
      { f: 'blue', w: 12, n: 2, wall: 0, base: 1 },
      { f: 'stone', w: 4, n: 1, wall: 0, base: 0 },
      { f: 'colonial', w: 18, n: 1, wall: 1, base: 2, setback: 9 },
      { f: 'terracotta', w: 11, n: 2, wall: 1, base: 0 },
      { f: 'ochre', w: 9, n: 2, wall: 2, base: 1 },
      { f: 'green', w: 7, n: 1, wall: 3, base: 0 },
      { f: 'townhouse', w: 6, n: 2, wall: 0, base: 0 },
    ],
  },
]

/** the frontages to build along: [street, side, from, to] with junction mouths taken out */
function frontages(): { street: Street; side: 1 | -1; a: number; b: number; nearCorner: number[]; depth: number }[] {
  const out: { street: Street; side: 1 | -1; a: number; b: number; nearCorner: number[]; depth: number }[] = []
  // the main street: broken at each side street's mouth (the corner houses stop at its house line)
  const c = SIDE_ROAD.width / 2 + SIDE_ROAD.sidewalk
  for (const side of [1, -1] as const) {
    const cuts = SIDES.filter((j) => j.side === side).map((j) => [j.at - c, j.at + c])
    // the church's plaza
    if (side === Math.sign(CHURCH.d)) cuts.push([CHURCH.s - 26, CHURCH.s + 26])
    cuts.sort((p, q) => p[0] - q[0])
    let from = MAIN.start + 8
    for (const [a, b] of cuts) {
      out.push({ street: MAIN, side, a: from, b: a, nearCorner: cuts.flat(), depth: 13 })
      from = b
    }
    out.push({ street: MAIN, side, a: from, b: MAIN.end - 30, nearCorner: cuts.flat(), depth: 13 })
  }
  // side streets: from behind the main street's corner houses out to where their houses stop
  for (const j of SIDES) {
    for (const side of [1, -1] as const) out.push({ street: j.street, side, a: FRONT + 13.5, b: j.houses, nearCorner: [FRONT + 13.5], depth: 11 })
  }
  return out
}

function pick<T>(list: T[], r: number): T {
  return list[Math.min(list.length - 1, Math.floor(r * list.length))]
}

function makeLot(street: Street, side: 1 | -1, s0: number, s1: number, depth: number, family: Family, storeys: number, rand: () => number, plan?: Plan): Lot {
  return {
    street,
    side,
    s0,
    s1,
    depth: depth + (rand() - 0.5) * 3,
    family,
    storeys,
    wall: plan?.wall !== undefined ? family.walls[plan.wall % family.walls.length] : pick(family.walls, rand()),
    base: plan?.base !== undefined ? family.bases[plan.base % family.bases.length] : pick(family.bases, rand()),
    fade: rand() ** 2 * 0.5,
    parapet: family.roof === 'flat' ? 0.6 + rand() * 0.5 : 0,
    setback: plan?.setback ?? 0,
    seed: Math.floor(rand() * 1e9),
  }
}

/** a family for the next lot: weighted by its odds, never one of the last two, shops likelier near a corner */
function nextFamily(rand: () => number, recent: FamilyId[], nearCorner: boolean): Family {
  const options = Object.values(FAMILIES).filter((f) => !recent.includes(f.id))
  const weight = (f: Family) => f.odds * (f.id === 'shop' ? (nearCorner ? 3 : 0.5) : 1)
  const total = options.reduce((t, f) => t + weight(f), 0)
  let r = rand() * total
  for (const f of options) {
    r -= weight(f)
    if (r <= 0) return f
  }
  return options[options.length - 1]
}

function storeysFor(family: Family, rand: () => number, previous: number): number {
  const [a, b] = family.storeys
  const r = rand() * (family.storeys[0] + family.storeys[1] + family.storeys[2])
  let n = r < a ? 1 : r < a + b ? 2 : 3
  // (a roofline steps, it doesn't jump: a single-storey house doesn't stand against a three-storey one)
  if (previous && Math.abs(n - previous) > 1) n = previous + Math.sign(n - previous)
  return n
}

/** every lot in town */
export function planLots(): Lot[] {
  const lots: Lot[] = []
  const taken: { street: Street; side: number; a: number; b: number }[] = []

  // the hand-set stretches first
  for (const hero of HERO) {
    const rand = seeded(9000 + hero.from * 10 + hero.side)
    let s = hero.from
    for (const p of hero.plan) {
      s += p.gap ?? 0
      const lot = makeLot(MAIN, hero.side, s, s + p.w, 13, FAMILIES[p.f], p.n, rand, p)
      lots.push(lot)
      s += p.w
    }
    taken.push({ street: MAIN, side: hero.side, a: hero.from, b: s })
  }

  let seed = 1
  for (const f of frontages()) {
    // the frontage minus the hand-set stretches
    const spans: [number, number][] = [[f.a, f.b]]
    for (const t of taken) {
      if (t.street !== f.street || t.side !== f.side) continue
      for (let i = spans.length - 1; i >= 0; i--) {
        const [a, b] = spans[i]
        if (t.b <= a || t.a >= b) continue
        spans.splice(i, 1, ...([[a, t.a], [t.b, b]] as [number, number][]).filter(([p, q]) => q - p > 0.01))
      }
    }
    for (const [a, b] of spans) {
      const rand = seeded(seed++ * 7919)
      const recent: FamilyId[] = []
      let previous = 0
      let s = a
      let sinceAlley = 20 + rand() * 40
      while (b - s > 3) {
        // an alley now and then (not right at a corner)
        if (sinceAlley > 45 + rand() * 50 && s - a > 10 && b - s > 14) {
          s += 1.8 + rand() * 0.9
          sinceAlley = 0
          continue
        }
        const near = f.nearCorner.some((c) => Math.abs(c - s) < 30)
        const family = nextFamily(rand, recent, near)
        let w = family.width[0] + rand() * (family.width[1] - family.width[0])
        // the last lot takes up what's left rather than leaving a sliver
        if (b - s - w < 4) w = b - s
        const storeys = storeysFor(family, rand, previous)
        // a walled garden once in a while, on the main street
        const garden = f.street === MAIN && family.id === 'colonial' && rand() < 0.25 ? 6 + rand() * 4 : 0
        lots.push(makeLot(f.street, f.side, s, s + w, f.depth, family, storeys, rand, garden ? { f: family.id, w, n: storeys, setback: garden } : undefined))
        recent.push(family.id)
        if (recent.length > 2) recent.shift()
        previous = storeys
        s += w
        sinceAlley += w
      }
    }
  }
  return lots
}

/** a side street's closing house across its far end, so the view down it ends on a facade */
export function endLots(): { street: Street; s: number; width: number; lot: Lot }[] {
  const rand = seeded(4242)
  const pool: FamilyId[] = ['ochre', 'blue', 'terracotta', 'green']
  return SIDES.map((j: SideStreet, i) => {
    const family = FAMILIES[pool[i % pool.length]]
    const width = j.street.width + 2 * j.street.sidewalk + 8
    // (a lot on no street of its own: its facade is built across the side street's end)
    const lot = makeLot(j.street, 1, 0, width, 12, family, 2, rand)
    return { street: j.street, s: j.houses + 4, width, lot }
  })
}
