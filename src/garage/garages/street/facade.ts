import * as THREE from 'three'
import { seeded } from '../landform'
import { CellMesh } from './mesh'
import { UPPER, type FamilyId, type Lot } from './lots'
import { ROAD, streetY } from './site'
import { SHOP_CELLS } from './signs'

/**
 * Facades: a house's street wall built with its openings cut through it —
 * doors, windows, French windows onto balconies, shopfronts — each with its
 * reveal (the wall's thickness, so every opening holds a real shadow), its
 * infill set back in it (frames, glazing bars, glass, panelled doors), stone
 * or white surrounds and sills, and the family's balconies, iron, cornices
 * and pilasters. What a house gets follows its family, not chance: a
 * colonial house has wide bays, a tall portón with a fanlight, cantera
 * surrounds and long iron balconies; a stone house small square windows and
 * no balconies; a shop a glazed front. Chance only picks within the family
 * (which bay the door is in, curtains, which frame paint, a storey's balcony).
 */

const lin = (hex: string) => new THREE.Color(hex)

type WindowKind = 'tall' | 'french' | 'narrow' | 'square'
/** opening sizes (m): width, height, sill above its floor */
const WINDOWS: Record<WindowKind, { w: number; h: number; sill: number }> = {
  tall: { w: 1.1, h: 2.2, sill: 0.8 },
  french: { w: 1.15, h: 2.55, sill: 0.04 },
  narrow: { w: 0.8, h: 1.8, sill: 0.9 },
  square: { w: 0.9, h: 1.0, sill: 1.1 },
}

type Balcony = 'none' | 'slab' | 'continuous' | 'juliet'

interface Style {
  /** bay width range (m) */
  bay: [number, number]
  /** plain wall kept at each end of the facade */
  margin: number
  door: { w: number; h: number; fanlight: boolean }
  /** the ground floor's windows; 'shop': a glazed shopfront */
  ground: WindowKind | 'shop'
  upper: WindowKind
  /** odds of each balcony for an upper storey (the whole storey takes one) */
  balcony: Partial<Record<Balcony, number>>
  /** surrounds and sills: cantera stone, white render, or none (bare reveals) */
  surround: string[] | null
  frames: string[]
  /** a moulded band at each upper floor line */
  string: boolean
  /** stone pilasters at the facade's ends */
  pilasters: boolean
  /** odds of an iron grille (reja) over a ground-floor window */
  grille: number
}

const WHITE_RENDER = ['#efe9dd', '#f2ead8', '#e9e2d2']
const STYLES: Record<FamilyId, Style> = {
  colonial: {
    bay: [3.0, 3.6], margin: 0.8, door: { w: 2.0, h: 3.3, fanlight: true }, ground: 'tall', upper: 'french',
    balcony: { continuous: 0.5, slab: 0.4, juliet: 0.1 }, surround: ['#d9ccb4', '#cdb49c', '#d4c3a8'],
    frames: ['#efeae0', '#5a3a28', '#2f4a3a'], string: true, pilasters: true, grille: 0.6,
  },
  terracotta: {
    bay: [2.6, 3.2], margin: 0.5, door: { w: 1.4, h: 2.9, fanlight: false }, ground: 'tall', upper: 'french',
    balcony: { continuous: 0.25, slab: 0.35, juliet: 0.3, none: 0.1 }, surround: WHITE_RENDER,
    frames: ['#efeae0', '#3d2a20'], string: true, pilasters: false, grille: 0.4,
  },
  ochre: {
    bay: [2.4, 3.0], margin: 0.45, door: { w: 1.3, h: 2.7, fanlight: false }, ground: 'tall', upper: 'tall',
    balcony: { slab: 0.3, juliet: 0.3, none: 0.4 }, surround: WHITE_RENDER,
    frames: ['#efeae0', '#6b3d24', '#2e4a6a'], string: false, pilasters: false, grille: 0.5,
  },
  blue: {
    bay: [2.3, 2.9], margin: 0.4, door: { w: 1.2, h: 2.6, fanlight: false }, ground: 'tall', upper: 'tall',
    balcony: { slab: 0.2, juliet: 0.3, none: 0.5 }, surround: WHITE_RENDER,
    frames: ['#efeae0', '#4a2e22'], string: false, pilasters: false, grille: 0.5,
  },
  green: {
    bay: [2.3, 2.9], margin: 0.4, door: { w: 1.2, h: 2.6, fanlight: false }, ground: 'tall', upper: 'tall',
    balcony: { slab: 0.25, juliet: 0.35, none: 0.4 }, surround: WHITE_RENDER,
    frames: ['#efeae0', '#5a3a28'], string: false, pilasters: false, grille: 0.4,
  },
  stone: {
    bay: [2.6, 3.4], margin: 0.5, door: { w: 1.3, h: 2.4, fanlight: false }, ground: 'square', upper: 'square',
    balcony: { none: 1 }, surround: null, frames: ['#4a3426', '#3a2a20'], string: false, pilasters: false, grille: 0.7,
  },
  shop: {
    bay: [2.6, 3.2], margin: 0.4, door: { w: 1.2, h: 2.7, fanlight: false }, ground: 'shop', upper: 'tall',
    balcony: { slab: 0.3, juliet: 0.2, none: 0.5 }, surround: WHITE_RENDER,
    frames: ['#2c2c2c', '#efeae0', '#6b2e28'], string: true, pilasters: false, grille: 0,
  },
  townhouse: {
    bay: [2.2, 2.8], margin: 0.35, door: { w: 1.1, h: 2.6, fanlight: false }, ground: 'narrow', upper: 'french',
    balcony: { slab: 0.3, juliet: 0.5, none: 0.2 }, surround: WHITE_RENDER,
    frames: ['#efeae0', '#2f4a3a'], string: false, pilasters: false, grille: 0.3,
  },
}

/** what the glass shows: the dark room, net curtains, a coloured curtain */
const GLASS = ['#15171a', '#15171a', '#1c1e20', '#9c978c', '#b8ae9a', '#6a2d28', '#3c4a3a'].map(lin)
const DOORS = ['#5a3a28', '#3d2a20', '#e8e2d6', '#2f4a3a', '#6b2e28'].map(lin)
const THRESHOLD = lin('#8f8779')

export interface FacadeMeshes {
  /** walls, reveals, surrounds, frames, doors (vertex coloured) */
  wall: CellMesh
  glass: CellMesh
  /** iron rails, posts, grille bars */
  iron: CellMesh
  /** alpha-tested railing infill (uv: metres along × a pattern's row) */
  lace: CellMesh
  /** painted signs (uv into the sign atlas, signs.ts) */
  signs: CellMesh
}

/** a facade's plane: u along it (m), y up (world), d into the wall (m; negative stands proud) */
class Face {
  readonly o: THREE.Vector2
  readonly u: THREE.Vector2
  readonly n: THREE.Vector2
  readonly length: number
  /** world directions: out of the wall, along it, up */
  readonly out: THREE.Vector3
  readonly along: THREE.Vector3

  constructor(a: THREE.Vector2, b: THREE.Vector2, outward: THREE.Vector2) {
    this.o = a.clone()
    this.length = a.distanceTo(b)
    this.u = b.clone().sub(a).divideScalar(this.length)
    this.n = new THREE.Vector2(-this.u.y, this.u.x)
    if (this.n.dot(outward) < 0) this.n.negate()
    this.out = new THREE.Vector3(this.n.x, 0, this.n.y)
    this.along = new THREE.Vector3(this.u.x, 0, this.u.y)
  }

  p(u: number, y: number, d: number): THREE.Vector3 {
    return new THREE.Vector3(this.o.x + this.u.x * u - this.n.x * d, y, this.o.y + this.u.y * u - this.n.y * d)
  }

  /** the pavement's height in front of the wall at u */
  ground(u: number): number {
    const x = this.o.x + this.u.x * u + this.n.x * 0.3
    const z = this.o.y + this.u.y * u + this.n.y * 0.3
    return streetY(x, z) + ROAD.curb
  }

  /** an upright quad in the wall's plane (or parallel to it at depth d), facing out */
  front(mesh: CellMesh, u0: number, u1: number, y0: number, y1: number, d: number, color: THREE.Color, uv?: [number, number][]): void {
    mesh.facing(this.p(u0, y0, d), this.p(u1, y0, d), this.p(u1, y1, d), this.p(u0, y1, d), this.out, color, uv)
  }

  /** a box in the facade's frame (its back face, against the wall, left out) */
  box(mesh: CellMesh, u0: number, u1: number, y0: number, y1: number, d0: number, d1: number, color: THREE.Color): void {
    const P = (u: number, y: number, d: number) => this.p(u, y, d)
    const down = new THREE.Vector3(0, -1, 0)
    const up = new THREE.Vector3(0, 1, 0)
    mesh.facing(P(u0, y0, d0), P(u1, y0, d0), P(u1, y1, d0), P(u0, y1, d0), this.out, color)
    mesh.facing(P(u0, y1, d0), P(u1, y1, d0), P(u1, y1, d1), P(u0, y1, d1), up, color)
    mesh.facing(P(u0, y0, d0), P(u1, y0, d0), P(u1, y0, d1), P(u0, y0, d1), down, color)
    mesh.facing(P(u0, y0, d0), P(u0, y1, d0), P(u0, y1, d1), P(u0, y0, d1), this.along.clone().negate(), color)
    mesh.facing(P(u1, y0, d0), P(u1, y1, d0), P(u1, y1, d1), P(u1, y0, d1), this.along, color)
  }
}

interface Opening {
  u0: number
  u1: number
  y0: number
  y1: number
  depth: number
  kind: 'door' | 'window' | 'shop'
  /** the floor it opens from (French windows: the balcony) */
  floor: number
  window?: WindowKind
}

/** pick by odds */
function choose<K extends string>(odds: Partial<Record<K, number>>, r: number): K {
  const entries = Object.entries(odds) as [K, number][]
  const total = entries.reduce((t, [, w]) => t + w, 0)
  let x = r * total
  for (const [k, w] of entries) {
    x -= w
    if (x <= 0) return k
  }
  return entries[entries.length - 1][0]
}

const pick = <T>(list: T[], r: number) => list[Math.min(list.length - 1, Math.floor(r * list.length))]

export interface FacadeOptions {
  /** the pavement-level reference the storeys are measured from */
  base: number
  /** the parapet's top */
  top: number
  /** the wall's foot, under ground */
  bottom: number
  wall: THREE.Color
  dado: THREE.Color
  /** the dado's top */
  dadoTop: number
  /** a side wall on a corner: windows only, no door */
  side?: boolean
}

export interface FacadeResult {
  /** where the house's electricity comes in: a service wire from the street's poles ends here (null: none) */
  drop: THREE.Vector3 | null
}

/**
 * Build one facade of a lot (a to b along the wall, `outward` toward the street) into `meshes`.
 */
export function buildFacade(meshes: FacadeMeshes, lot: Lot, a: THREE.Vector2, b: THREE.Vector2, outward: THREE.Vector2, opts: FacadeOptions): FacadeResult {
  const face = new Face(a, b, outward)
  const style = STYLES[lot.family.id]
  const rand = seeded(lot.seed + (opts.side ? 77 : 0))
  const L = face.length
  const surround = style.surround ? lin(pick(style.surround, rand())) : null
  const frame = lin(pick(style.frames, rand()))
  const door = pick(DOORS, rand())
  const { base, top } = opts
  const reveal = opts.wall.clone().multiplyScalar(0.9)
  const revealDado = opts.dado.clone().multiplyScalar(0.9)

  // ─── the bays and what opens in them ───────────────────────────────
  const inner = L - 2 * style.margin
  const bays = Math.max(1, Math.round(inner / (style.bay[0] + rand() * (style.bay[1] - style.bay[0]))))
  const bayW = inner / bays
  const centre = (i: number) => style.margin + (i + 0.5) * bayW
  const openings: Opening[] = []
  const floors = lot.storeys
  const floorY = (k: number) => base + (k === 0 ? 0 : lot.family.ground + (k - 1) * UPPER)

  // ground floor
  const doorBay = opts.side ? -1 : lot.family.id === 'colonial' ? Math.floor(bays / 2) : lot.family.id === 'townhouse' ? 0 : Math.floor(rand() * bays)
  const doorTop = base + Math.min(style.door.h, lot.family.ground - 0.9)
  if (style.ground === 'shop' && !opts.side && bays >= 2) {
    // a glazed shopfront over most of the front, its door in the end bay
    const dBay = rand() < 0.5 ? 0 : bays - 1
    const dc = centre(dBay)
    const dw = Math.min(style.door.w, bayW - 0.5)
    openings.push({ u0: dc - dw / 2, u1: dc + dw / 2, y0: 0, y1: doorTop, depth: 0.3, kind: 'door', floor: base })
    const s0 = dBay === 0 ? style.margin + bayW + 0.3 : style.margin + 0.3
    const s1 = dBay === 0 ? L - style.margin - 0.3 : L - style.margin - bayW - 0.3
    if (s1 - s0 > 1.5) openings.push({ u0: s0, u1: s1, y0: base + 0.45, y1: doorTop, depth: 0.18, kind: 'shop', floor: base })
  } else {
    for (let i = 0; i < bays; i++) {
      const c = centre(i)
      if (i === doorBay) {
        const dw = Math.min(style.door.w, bayW - 0.4)
        openings.push({ u0: c - dw / 2, u1: c + dw / 2, y0: 0, y1: doorTop, depth: 0.32, kind: 'door', floor: base })
        continue
      }
      const kind = style.ground === 'shop' ? 'tall' : style.ground
      const w = WINDOWS[kind]
      const ww = Math.min(w.w, bayW - 0.5)
      openings.push({ u0: c - ww / 2, u1: c + ww / 2, y0: Math.max(base + 0.5, doorTop - w.h), y1: doorTop, depth: 0.24, kind: 'window', floor: base, window: kind })
    }
  }
  // upper floors: one window per bay, the storey's balcony chosen once
  const balconies: { k: number; kind: Balcony }[] = []
  for (let k = 1; k < floors; k++) {
    const kind = style.upper
    const w = WINDOWS[kind]
    let balcony = choose(style.balcony, rand())
    // (a plain window can't open onto a slab: a tall window's storey takes a Juliet rail or nothing)
    if (kind !== 'french' && (balcony === 'continuous')) balcony = 'slab'
    balconies.push({ k, kind: balcony })
    const f = floorY(k)
    const sill = balcony === 'none' && kind === 'french' ? 0.5 : w.sill
    const h = kind === 'french' && sill > 0.1 ? w.h - 0.46 : w.h
    for (let i = 0; i < bays; i++) {
      const c = centre(i)
      const ww = Math.min(w.w, bayW - 0.5)
      openings.push({ u0: c - ww / 2, u1: c + ww / 2, y0: f + sill, y1: f + sill + h, depth: 0.24, kind: 'window', floor: f, window: kind })
    }
  }
  // doors run down to the pavement where they stand (the street may slope along the house)
  for (const o of openings) if (o.kind === 'door') o.y0 = face.ground((o.u0 + o.u1) / 2)

  // ─── the wall, round its openings: columns between every opening edge ─
  const cuts = [...new Set([0, L, ...openings.flatMap((o) => [o.u0, o.u1])])].sort((p, q) => p - q)
  for (let i = 0; i + 1 < cuts.length; i++) {
    const ua = cuts[i]
    const ub = cuts[i + 1]
    if (ub - ua < 1e-4) continue
    const mid = (ua + ub) / 2
    const holes = openings.filter((o) => o.u0 <= mid && o.u1 >= mid).sort((p, q) => p.y0 - q.y0)
    let y = opts.bottom
    const solid = (y0: number, y1: number) => {
      // the dado below its line, the paint above
      const split = THREE.MathUtils.clamp(opts.dadoTop, y0, y1)
      if (split > y0) face.front(meshes.wall, ua, ub, y0, split, 0, opts.dado)
      if (y1 > split) face.front(meshes.wall, ua, ub, split, y1, 0, opts.wall)
    }
    for (const h of holes) {
      if (h.y0 > y) solid(y, h.y0)
      y = Math.max(y, h.y1)
    }
    if (top > y) solid(y, top)
  }

  // ─── each opening: reveals, infill, surround ─────────────────────────
  for (const o of openings) {
    const { u0, u1, y0, y1, depth: D } = o
    const P = (u: number, y: number, d: number) => face.p(u, y, d)
    const revealColor = (y: number) => (y < opts.dadoTop ? revealDado : reveal)
    // jambs (split at the dado line), soffit, sill / threshold
    for (const [u, dir] of [[u0, face.along], [u1, face.along.clone().negate()]] as const) {
      const split = THREE.MathUtils.clamp(opts.dadoTop, y0, y1)
      if (split > y0) meshes.wall.facing(P(u, y0, 0), P(u, split, 0), P(u, split, D), P(u, y0, D), dir, revealColor(y0))
      if (y1 > split) meshes.wall.facing(P(u, split, 0), P(u, y1, 0), P(u, y1, D), P(u, split, D), dir, reveal)
    }
    meshes.wall.facing(P(u0, y1, 0), P(u1, y1, 0), P(u1, y1, D), P(u0, y1, D), new THREE.Vector3(0, -1, 0), reveal)
    meshes.wall.facing(P(u0, y0, 0), P(u1, y0, 0), P(u1, y0, D), P(u0, y0, D), new THREE.Vector3(0, 1, 0), o.kind === 'door' ? THRESHOLD : revealColor(y0))

    const back = D - 0.02
    if (o.kind === 'door') doorInfill(meshes, face, o, back, door, frame, style.door.fanlight && y1 - y0 > 2.9)
    else windowInfill(meshes, face, o, back, frame, rand)

    // surrounds: jambs and a lintel standing proud, a sill under windows
    if (surround && o.kind !== 'shop') {
      const t = 0.16
      face.box(meshes.wall, u0 - t, u0, y0, y1, -0.05, 0, surround)
      face.box(meshes.wall, u1, u1 + t, y0, y1, -0.05, 0, surround)
      face.box(meshes.wall, u0 - t - 0.06, u1 + t + 0.06, y1, y1 + 0.22, -0.07, 0, surround)
    }
    if (o.kind === 'window' && o.window !== 'french') {
      const t = surround ? 0.22 : 0.1
      face.box(meshes.wall, u0 - t, u1 + t, y0 - 0.08, y0, -0.09, 0, surround ?? THRESHOLD)
    }
    // an iron grille over a ground-floor window
    if (o.kind === 'window' && o.floor === base && rand() < style.grille) grille(meshes, face, o)
  }

  // ─── balconies ───────────────────────────────────────────────────────
  const slabColor = surround ?? THRESHOLD
  for (const { k, kind } of balconies) {
    if (kind === 'none') continue
    const f = floorY(k)
    const row = openings.filter((o) => o.floor === f)
    const pattern = lot.family.id === 'colonial' ? 1 : rand() < 0.5 ? 0 : 1
    if (kind === 'juliet') {
      for (const o of row) juliet(meshes, face, o, pattern)
    } else if (kind === 'continuous') {
      balcony(meshes, face, row[0].u0 - 0.35, row[row.length - 1].u1 + 0.35, f, 0.85, slabColor, pattern)
    } else {
      for (const o of row) balcony(meshes, face, o.u0 - 0.3, o.u1 + 0.3, f, 0.65, slabColor, pattern)
    }
  }

  // ─── mouldings: string courses, coping, pilasters, spouts ────────────
  const band = surround ?? opts.wall.clone().multiplyScalar(0.92)
  if (style.string) for (let k = 1; k < floors; k++) face.box(meshes.wall, 0, L, floorY(k) - 0.3, floorY(k) - 0.14, -0.05, 0, band)
  if (lot.family.roof === 'flat') {
    face.box(meshes.wall, -0.02, L + 0.02, top - 0.2, top + 0.04, -0.09, 0, band)
    // rain spouts through the parapet (gárgolas), every few metres
    for (let u = 1.6 + rand(); u < L - 1; u += 3.5 + rand() * 2) face.box(meshes.wall, u - 0.07, u + 0.07, top - 0.62, top - 0.5, -0.55, 0, lin('#8a7a66'))
  }
  if (style.pilasters && surround) {
    for (const u of [0, L - 0.32]) face.box(meshes.wall, u, u + 0.32, opts.bottom, top - 0.2, -0.04, 0, surround)
  }

  // ─── the street's services and trade ─────────────────────────────────
  const shop = openings.find((o) => o.kind === 'shop')
  if (shop) {
    // the shop's painted board over its front
    const h = 0.8
    const w = Math.min(shop.u1 - shop.u0, h * 4)
    const c = (shop.u0 + shop.u1) / 2
    const y0 = shop.y1 + 0.35
    face.box(meshes.wall, c - w / 2 - 0.05, c + w / 2 + 0.05, y0 - 0.05, y0 + h + 0.05, -0.08, 0, lin('#3a2f26'))
    const [su0, sv0, su1, sv1] = SHOP_CELLS[lot.seed % SHOP_CELLS.length]
    face.front(meshes.signs, c - w / 2, c + w / 2, y0, y0 + h, -0.081, WHITE, [
      [su0, sv0],
      [su1, sv0],
      [su1, sv1],
      [su0, sv1],
    ])
  }
  const entrance = openings.find((o) => o.kind === 'door')
  let drop: THREE.Vector3 | null = null
  if (entrance && !opts.side) {
    // the electricity meter in its grey box beside the door, and the service wire's bracket high over it
    const u = entrance.u1 + 0.45 < L - 0.3 ? entrance.u1 + 0.45 : entrance.u0 - 0.45
    if (rand() < 0.6) face.box(meshes.wall, u - 0.16, u + 0.16, base + 1.3, base + 1.75, -0.14, 0, lin('#9a9a94'))
    if (rand() < 0.7) {
      const y = top - 0.9
      face.box(meshes.iron, u - 0.02, u + 0.02, y - 0.02, y + 0.02, -0.18, 0, IRON)
      drop = face.p(u, y, -0.18)
    }
  }
  return { drop }
}

const WHITE = new THREE.Color(1, 1, 1)

/** a panelled door (two leaves, raised panels), a fanlight over it on a grand house */
function doorInfill(meshes: FacadeMeshes, face: Face, o: Opening, d: number, color: THREE.Color, frame: THREE.Color, fanlight: boolean): void {
  const { u0, u1, y0, y1 } = o
  const leafTop = fanlight ? y1 - 0.7 : y1
  face.front(meshes.wall, u0, u1, y0, leafTop, d, color)
  if (fanlight) {
    face.front(meshes.glass, u0, u1, leafTop + 0.08, y1, d + 0.01, GLASS[0])
    face.box(meshes.wall, u0, u1, leafTop, leafTop + 0.08, d - 0.04, d, frame)
    face.box(meshes.wall, (u0 + u1) / 2 - 0.03, (u0 + u1) / 2 + 0.03, leafTop, y1, d - 0.03, d, frame)
  }
  const leaves = u1 - u0 > 1.2 ? 2 : 1
  const lw = (u1 - u0) / leaves
  const panel = color.clone().multiplyScalar(0.82)
  for (let l = 0; l < leaves; l++) {
    const a = u0 + l * lw
    // the meeting stile's groove
    if (l > 0) face.box(meshes.wall, a - 0.012, a + 0.012, y0, leafTop, d - 0.005, d, panel.clone().multiplyScalar(0.5))
    // three raised panels up the leaf
    const ph = (leafTop - y0 - 0.5) / 3
    for (let p = 0; p < 3; p++) {
      const py = y0 + 0.2 + p * (ph + 0.05)
      face.box(meshes.wall, a + 0.12, a + lw - 0.12, py, py + ph - 0.05, d - 0.025, d, panel)
    }
  }
}

/** a window's infill: a painted frame with glazing bars, the glass behind them */
function windowInfill(meshes: FacadeMeshes, face: Face, o: Opening, d: number, frame: THREE.Color, rand: () => number): void {
  const { u0, u1, y0, y1 } = o
  const glass = pick(GLASS, rand())
  face.front(meshes.glass, u0, u1, y0, y1, d, glass)
  const t = 0.06
  // outer frame
  face.box(meshes.wall, u0, u1, y0, y0 + t, d - 0.05, d, frame)
  face.box(meshes.wall, u0, u1, y1 - t, y1, d - 0.05, d, frame)
  face.box(meshes.wall, u0, u0 + t, y0, y1, d - 0.05, d, frame)
  face.box(meshes.wall, u1 - t, u1, y0, y1, d - 0.05, d, frame)
  if (o.kind === 'shop') {
    // a shopfront: mullions every metre or so, a transom band
    const n = Math.max(1, Math.round((u1 - u0) / 1.3))
    for (let i = 1; i < n; i++) {
      const u = u0 + ((u1 - u0) * i) / n
      face.box(meshes.wall, u - 0.035, u + 0.035, y0, y1, d - 0.06, d, frame)
    }
    const ty = y1 - 0.55
    face.box(meshes.wall, u0, u1, ty - 0.035, ty + 0.035, d - 0.06, d, frame)
    return
  }
  // the meeting rails of two casements, a transom, and glazing bars across each light
  const mid = (u0 + u1) / 2
  face.box(meshes.wall, mid - 0.035, mid + 0.035, y0, y1, d - 0.045, d, frame)
  const transom = y1 - Math.min(0.55, (y1 - y0) * 0.25)
  if (y1 - y0 > 1.4) face.box(meshes.wall, u0, u1, transom - 0.03, transom + 0.03, d - 0.045, d, frame)
  const lights = Math.max(1, Math.round((transom - y0) / 0.6))
  for (let i = 1; i < lights; i++) {
    const y = y0 + ((transom - y0) * i) / lights
    face.box(meshes.wall, u0, u1, y - 0.015, y + 0.015, d - 0.035, d, frame)
  }
}

const IRON = lin('#1d1c1b')

/** an iron grille (reja) standing off a ground-floor window: bars, rails top and bottom */
function grille(meshes: FacadeMeshes, face: Face, o: Opening): void {
  const { u0, u1, y0, y1 } = o
  const d = -0.1
  const n = Math.max(3, Math.round((u1 - u0) / 0.13))
  for (let i = 0; i <= n; i++) {
    const u = u0 - 0.05 + ((u1 - u0 + 0.1) * i) / n
    face.box(meshes.iron, u - 0.009, u + 0.009, y0 - 0.02, y1 + 0.05, d - 0.009, d + 0.009, IRON)
  }
  for (const y of [y0 + 0.02, (y0 + y1) / 2, y1 + 0.02]) face.box(meshes.iron, u0 - 0.08, u1 + 0.08, y - 0.02, y + 0.02, d - 0.015, d + 0.015, IRON)
}

/** railing infill: an alpha-tested panel with its pattern, uvs in metres along, rows of the atlas up */
function lace(meshes: FacadeMeshes, face: Face, u0: number, u1: number, y0: number, y1: number, d: number, pattern: number): void {
  const v0 = pattern * 0.5
  const v1 = v0 + 0.5
  face.front(meshes.lace, u0, u1, y0, y1, d, IRON, [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ])
}

/** a rail and its lace panel at height `y`, running along the facade at depth d */
function railRun(meshes: FacadeMeshes, face: Face, u0: number, u1: number, y: number, d: number, pattern: number, h = 0.95): void {
  face.box(meshes.iron, u0, u1, y + h, y + h + 0.045, d - 0.025, d + 0.025, IRON)
  face.box(meshes.iron, u0, u1, y + 0.02, y + 0.06, d - 0.015, d + 0.015, IRON)
  lace(meshes, face, u0, u1, y + 0.06, y + h, d, pattern)
}

/** a Juliet balcony: an iron rail across the French window's opening, a narrow stone ledge */
function juliet(meshes: FacadeMeshes, face: Face, o: Opening, pattern: number): void {
  const d = -0.14
  face.box(meshes.wall, o.u0 - 0.12, o.u1 + 0.12, o.floor - 0.1, o.floor + 0.02, -0.2, 0, THRESHOLD)
  railRun(meshes, face, o.u0 - 0.08, o.u1 + 0.08, o.floor + 0.02, d, pattern, 0.9)
}

/** a stone balcony slab on brackets with an iron railing round its three open sides */
function balcony(meshes: FacadeMeshes, face: Face, u0: number, u1: number, floor: number, depth: number, stone: THREE.Color, pattern: number): void {
  face.box(meshes.wall, u0, u1, floor - 0.15, floor, -depth, 0, stone)
  // the slab's moulded edge and its brackets
  face.box(meshes.wall, u0 - 0.03, u1 + 0.03, floor - 0.19, floor - 0.13, -depth - 0.03, -depth + 0.1, stone.clone().multiplyScalar(0.93))
  for (const u of [u0 + 0.12, u1 - 0.12]) face.box(meshes.wall, u - 0.07, u + 0.07, floor - 0.5, floor - 0.15, -depth + 0.08, 0, stone)
  const d = -depth + 0.05
  railRun(meshes, face, u0 + 0.04, u1 - 0.04, floor, d, pattern)
  // the sides: back to the wall
  for (const u of [u0 + 0.05, u1 - 0.05]) {
    // posts at the front corners
    face.box(meshes.iron, u - 0.02, u + 0.02, floor, floor + 1.0, d - 0.02, d + 0.02, IRON)
    // the side's lace, back to the wall, and its rail
    const a = face.p(u, floor + 0.06, d)
    const b = face.p(u, floor + 0.06, -0.02)
    const c = face.p(u, floor + 0.95, -0.02)
    const e = face.p(u, floor + 0.95, d)
    const v0 = pattern * 0.5
    meshes.lace.facing(a, b, c, e, face.along, IRON, [
      [0, v0],
      [depth - 0.07, v0],
      [depth - 0.07, v0 + 0.5],
      [0, v0 + 0.5],
    ])
    const r0 = face.p(u, floor + 0.95, d)
    const r1 = face.p(u, floor + 0.995, -0.02)
    ironBar(meshes.iron, r0, r1)
  }
}

/** a square iron bar from a to b (a side rail running back into the wall): its top and sides */
function ironBar(mesh: CellMesh, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = b.clone().sub(a)
  const len = dir.length()
  dir.normalize()
  const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(0.022)
  const up = new THREE.Vector3(0, 0.022, 0)
  const q = (p: THREE.Vector3, s: number, t: number) => p.clone().addScaledVector(side, s).addScaledVector(up, t)
  const end = a.clone().addScaledVector(dir, len)
  mesh.facing(q(a, -1, 1), q(end, -1, 1), q(end, 1, 1), q(a, 1, 1), new THREE.Vector3(0, 1, 0), IRON)
  mesh.facing(q(a, 1, -1), q(end, 1, -1), q(end, 1, 1), q(a, 1, 1), side, IRON)
  mesh.facing(q(a, -1, -1), q(end, -1, -1), q(end, -1, 1), q(a, -1, 1), side.clone().negate(), IRON)
}

/**
 * A walled front garden's street side: a rendered plinth wall with a coping, stone
 * piers every few metres carrying iron railings between them, and a pair of iron
 * gates on piers of their own — the fenced gardens a colonial street opens onto.
 */
export function gardenFront(meshes: FacadeMeshes, a: THREE.Vector2, b: THREE.Vector2, outward: THREE.Vector2, opts: { wall: THREE.Color; pier: THREE.Color; seed: number }): void {
  const face = new Face(a, b, outward)
  const rand = seeded(opts.seed + 5)
  const L = face.length
  const g = (u: number) => face.ground(u)
  const base = Math.max(g(0), g(L))
  const plinth = base + 0.6
  const gate = { u: L * (0.3 + rand() * 0.4), w: 1.8 }
  // piers: at the ends, either side of the gate, and every ~3 m between
  const piers = [0.2, L - 0.2, gate.u - gate.w / 2 - 0.25, gate.u + gate.w / 2 + 0.25]
  for (let u = 3; u < L - 1.5; u += 3) if (Math.abs(u - gate.u) > gate.w / 2 + 1) piers.push(u)
  piers.sort((p, q) => p - q)
  for (const u of piers) {
    face.box(meshes.wall, u - 0.25, u + 0.25, base - 1, base + 2.0, -0.15, 0.35, opts.pier)
    face.box(meshes.wall, u - 0.3, u + 0.3, base + 2.0, base + 2.12, -0.2, 0.4, opts.pier)
  }
  // the plinth and its railings between the piers (not across the gate)
  for (let i = 0; i + 1 < piers.length; i++) {
    const u0 = piers[i] + 0.25
    const u1 = piers[i + 1] - 0.25
    if (u1 - u0 < 0.1) continue
    const gateway = gate.u > u0 && gate.u < u1
    if (!gateway) {
      face.box(meshes.wall, u0, u1, base - 1, plinth, -0.08, 0.3, opts.wall)
      face.box(meshes.wall, u0, u1, plinth, plinth + 0.07, -0.11, 0.33, opts.pier)
      railRun(meshes, face, u0, u1, plinth + 0.07, 0.1, 0, 1.2)
    } else {
      // the gates: two leaves of the same iron, a step at their foot
      face.box(meshes.wall, u0, u1, base - 1, base + 0.02, -0.1, 0.3, THRESHOLD)
      railRun(meshes, face, u0 + 0.03, gate.u - 0.02, base + 0.08, 0.1, 1, 1.8)
      railRun(meshes, face, gate.u + 0.02, u1 - 0.03, base + 0.08, 0.1, 1, 1.8)
    }
  }
}

/**
 * The railings' pattern atlas: two rows, each a metre of railing 1 m high — plain
 * bars with a band of C-scrolls low down, and the grander colonial kind with rings
 * top and bottom. White where iron is, transparent between (the material's colour
 * paints it).
 */
export function railingTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, size, size)
  g.strokeStyle = '#fff'
  g.fillStyle = '#fff'
  const row = (r: number, draw: (y0: number, h: number) => void) => draw(size - (r + 1) * (size / 2), size / 2)
  const bars = (y0: number, h: number, spacing: number) => {
    for (let x = spacing / 2; x < size; x += spacing) g.fillRect(x - 3, y0, 6, h)
  }
  // row 0: plain bars, C-scrolls in a band near the foot
  row(0, (y0, h) => {
    bars(y0, h, 56)
    g.lineWidth = 5
    for (let x = 0; x < size; x += 56) {
      g.beginPath()
      g.arc(x + 14, y0 + h * 0.8, 11, Math.PI * 0.5, Math.PI * 1.5)
      g.stroke()
      g.beginPath()
      g.arc(x + 42, y0 + h * 0.8, 11, -Math.PI * 0.5, Math.PI * 0.5)
      g.stroke()
    }
    g.fillRect(0, y0 + h * 0.66, size, 5)
  })
  // row 1: bars with rings in bands top and bottom, a lozenge in each bay
  row(1, (y0, h) => {
    bars(y0, h, 64)
    g.lineWidth = 5
    for (let x = 32; x < size + 32; x += 64) {
      for (const f of [0.14, 0.86]) {
        g.beginPath()
        g.arc(x, y0 + h * f, 22, 0, Math.PI * 2)
        g.stroke()
      }
      g.beginPath()
      g.moveTo(x, y0 + h * 0.32)
      g.lineTo(x + 26, y0 + h * 0.5)
      g.lineTo(x, y0 + h * 0.68)
      g.lineTo(x - 26, y0 + h * 0.5)
      g.closePath()
      g.stroke()
    }
    g.fillRect(0, y0 + h * 0.27, size, 5)
    g.fillRect(0, y0 + h * 0.73, size, 5)
  })
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 8
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}
