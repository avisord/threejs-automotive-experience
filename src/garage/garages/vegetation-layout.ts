import { fbm, seeded, smoothstep } from './landform'

/**
 * Where the valley's trees and shrubs stand — decided once, from a seed, before
 * any geometry exists, so the terrain can darken the ground under them and
 * every level of detail places the same trees.
 *
 * Clustered, the way woods grow, not scattered one by one:
 *  1. cluster centres, drawn in proportion to how wooded the land wants to be
 *     (`wood`): big dense stands on the hillsides, small copses in the fields
 *  2. each cluster a stretched, turned Gaussian blob of trees with its own
 *     radius, density, dominant species and colour cast; trees near its rim
 *     are younger and smaller, and shrubs fill its fringe
 *  3. a scatter of lone trees between clusters
 *  4. clearings: a broad noise field that empties parts of the land entirely
 *
 * Sizes follow a log-normal (most trees near the norm, some small, a few tall)
 * with the odd veteran; crowns vary in width independently of height; trunks
 * lean a few degrees. Everything is terrain-aware through `site` callbacks.
 */

/** tunables: density, variation and the level-of-detail bands */
export const VEGETATION = {
  /** cluster centres attempted over the real-scale land */
  clusters: 3200,
  /** cluster radius range, metres (log-uniform); woods get the upper end */
  clusterRadius: [10, 110] as [number, number],
  /** trees per 100 m² at a cluster's centre (range; woods get the upper end) */
  density: [0.8, 2.8] as [number, number],
  /** lone trees attempted between clusters */
  isolated: 2600,
  /** shrubs per tree, around clusters' rims */
  shrubsPerTree: 0.7,
  /** shrubs are planted only this close, metres (a 2 m shrub is under a pixel beyond) */
  shrubReach: 900,
  /** log-normal spread of tree size */
  sizeSigma: 0.2,
  /** chance of a veteran, ×1.35 */
  veteran: 0.05,
  /** crown width spread (× height), independent of height */
  widthSpread: 0.22,
  /** trunk lean, degrees (max) */
  lean: 3.5,
  /** fraction of the land left open by clearings */
  clearings: 0.3,
  /**
   * Level-of-detail bands, metres from the pavilion (the orbit camera stays within ~15 m of it):
   * LOD 0 hero trees → LOD 1 skeleton + foliage masses → LOD 2 three crossed cards → LOD 3 two.
   * Chosen by screen size, not a driving game's metres: through the 36° lens a tree looks ~1.3×
   * bigger than through a ~60° game camera, so each band reaches that much farther.
   */
  lod: { hero: 30, masses: 70, cards: 160 },
  /** hard caps per band (a hero tree is ~27k triangles, LOD 1 ~1k, a card 6) — a full band passes on its farthest */
  caps: { hero: 60, masses: 400, cards: 4000 },
  /** beyond this, trees cast no shadow of their own: the canopy shell carries the woods' shadow */
  shadowless: 1500,
  /** heights, metres */
  height: { conifer: 19, broadleaf: 13, shrub: 2.2 },
}

export type PlantKind = 'conifer' | 'broadleaf' | 'shrub'

export interface Plant {
  x: number
  z: number
  kind: PlantKind
  /** metres */
  height: number
  /** crown width relative to the species' own (0.75–1.3) */
  width: number
  /** yaw, radians */
  turn: number
  /** lean about x and z, radians */
  leanX: number
  leanZ: number
  /** 0–1: colour variation within the species, shared a little by a cluster */
  tone: number
  /** 0–1: which variant of the species (stable per plant) */
  pick: number
}

export interface LayoutSite {
  /** 0–1: how wooded the land wants to be here (hillsides high, fields low) */
  wood(x: number, z: number): number
  /** can a plant of this height stand here? (not water, road, houses, steep ground, the view…) */
  allowed(x: number, z: number, height: number): boolean
  /** 0–1: conifer share here (more on the heights) */
  conifers(x: number, z: number): number
  /** inner and outer radius of the land to plant */
  radius: [number, number]
}

export interface VegetationLayout {
  plants: Plant[]
  /** 0–1: how much canopy stands over a point (for darkening the ground under woods) */
  cover(x: number, z: number): number
}

export function layoutVegetation(site: LayoutSite, seed: number): VegetationLayout {
  const V = VEGETATION
  const rand = seeded(seed)
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand())
  const plants: Plant[] = []
  const [r0, r1] = site.radius

  // a coarse grid of what's planted: keeps trunks from standing inside each other and answers cover()
  const CELL = 20
  const grid = new Map<number, Plant[]>()
  const key = (cx: number, cz: number) => (cx + 1000) * 4096 + (cz + 1000)
  const add = (p: Plant) => {
    plants.push(p)
    const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL))
    const list = grid.get(k)
    if (list) list.push(p)
    else grid.set(k, [p])
  }
  const crowded = (x: number, z: number, gap: number) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const o of grid.get(key(cx + i, cz + j)) ?? []) if ((o.x - x) ** 2 + (o.z - z) ** 2 < gap * gap) return true
    return false
  }
  const clearing = (x: number, z: number) => fbm(x / 260 + 41, z / 260 - 17, 3) < 0.34 + V.clearings * 0.35 - 0.1
  const size = () => Math.exp(gauss() * V.sizeSigma) * (rand() < V.veteran ? 1.35 : 1)

  const plant = (x: number, z: number, kind: PlantKind, scale: number, tone: number): boolean => {
    const height = V.height[kind] * scale
    // shrubs past shrubReach are under a pixel: not worth planting
    if (kind === 'shrub' && x * x + z * z > V.shrubReach * V.shrubReach) return false
    const gap = kind === 'shrub' ? 1.2 : height * 0.14 // crowns may overlap; trunks may not
    // (the cheap test first: site.allowed samples the terrain)
    if (crowded(x, z, gap) || !site.allowed(x, z, height)) return false
    const lean = ((kind === 'shrub' ? 0 : V.lean) * Math.PI) / 180
    add({
      x,
      z,
      kind,
      height,
      width: Math.max(0.7, 1 + gauss() * V.widthSpread),
      turn: rand() * Math.PI * 2,
      leanX: (rand() - 0.5) * 2 * lean,
      leanZ: (rand() - 0.5) * 2 * lean,
      tone: Math.min(1, Math.max(0, tone + (rand() - 0.5) * 0.35)),
      pick: rand(),
    })
    return true
  }

  // ─── 1–2: clusters ────────────────────────────────────────────────────────
  for (let c = 0; c < V.clusters; c++) {
    const r = Math.sqrt(rand() * (r1 * r1 - r0 * r0) + r0 * r0)
    const a = rand() * Math.PI * 2
    const cx = Math.sin(a) * r
    const cz = -Math.cos(a) * r
    const wood = site.wood(cx, cz)
    if (rand() > 0.12 + 0.88 * wood || clearing(cx, cz)) continue
    // woods: big and dense; field copses: small and loose
    const [ra, rb] = V.clusterRadius
    const radius = ra * (rb / ra) ** Math.min(1, rand() * 0.6 + wood * 0.55)
    const dens = V.density[0] + (V.density[1] - V.density[0]) * Math.min(1, wood * 0.8 + rand() * 0.4)
    const count = Math.max(3, Math.min(900, Math.round((Math.PI * radius * radius * dens) / 100)))
    // a blob stretched along a random axis
    const axis = rand() * Math.PI
    const stretch = 1 + rand() * 0.8
    const ca = Math.cos(axis)
    const sa = Math.sin(axis)
    // the stand's character: mostly one kind, and a shared colour cast
    const coniferShare = site.conifers(cx, cz)
    const dominant: PlantKind = rand() < coniferShare ? 'conifer' : 'broadleaf'
    const tone = rand()
    let placed = 0
    for (let t = 0; t < count * 2.5 && placed < count; t++) {
      const u = gauss() * 0.5 * stretch
      const v = gauss() * 0.5 / stretch
      const x = cx + (u * ca - v * sa) * radius
      const z = cz + (u * sa + v * ca) * radius
      const rim = Math.min(1, Math.hypot(u / stretch, v * stretch)) // 0 at the heart, 1 at the edge
      const kind: PlantKind = rand() < 0.78 ? dominant : dominant === 'conifer' ? 'broadleaf' : 'conifer'
      // younger, smaller trees toward the rim
      if (plant(x, z, kind, size() * (1 - 0.3 * smoothstep(rim, 0.3, 1)), tone)) placed++
    }
    // shrubs in the fringe
    const shrubs = Math.round(placed * V.shrubsPerTree)
    for (let s = 0; s < shrubs; s++) {
      const ang = rand() * Math.PI * 2
      const d = radius * (0.7 + rand() * 0.6)
      const x = cx + Math.cos(ang) * d * stretch * 0.6
      const z = cz + Math.sin(ang) * d * 0.6
      plant(x, z, 'shrub', 0.6 + rand() * 0.8, tone)
    }
  }

  // ─── 3: lone trees ──────────────────────────────────────────────────────
  for (let i = 0; i < V.isolated; i++) {
    const r = Math.sqrt(rand() * (r1 * r1 - r0 * r0) + r0 * r0)
    const a = rand() * Math.PI * 2
    const x = Math.sin(a) * r
    const z = -Math.cos(a) * r
    if (rand() > 0.25 + 0.5 * site.wood(x, z)) continue
    plant(x, z, rand() < site.conifers(x, z) ? 'conifer' : 'broadleaf', size(), rand())
  }

  return {
    plants,
    cover(x, z) {
      // canopy over a point: trees whose crown (≈ a third of their height across) reaches it
      const cx = Math.floor(x / CELL)
      const cz = Math.floor(z / CELL)
      let c = 0
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++)
          for (const o of grid.get(key(cx + i, cz + j)) ?? []) {
            if (o.kind === 'shrub') continue
            const reach = o.height * 0.3 * o.width
            const d2 = (o.x - x) ** 2 + (o.z - z) ** 2
            if (d2 < reach * reach) c += 1 - Math.sqrt(d2) / reach
          }
      return Math.min(1, c)
    },
  }
}
