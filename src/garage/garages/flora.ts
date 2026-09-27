import type { PresetJson } from './trees'

/**
 * Which trees a landscape grows. The layout (vegetation-layout.ts) only knows two kinds of
 * tree, `conifer` (tall: 19 m on average) and `broadleaf` (13 m); a flora says what each is:
 *  - temperate (the Fuji valley): pines; oaks, ash and aspen
 *  - tropical (the coast): tall emergents standing out of the canopy (kapok, the tropical almond's
 *    tiers); under them rain trees (low umbrella crowns wider than they're tall) and figs (dense
 *    domes). A pine on a tropical hillside is the first thing that reads as wrong.
 *
 * Tropical species are ez-tree presets reshaped from its oak and ash: ez-tree has no tropical
 * leaves, but ash's pinnate cards read as a rain tree's or a tamarind's fine foliage and aspen's
 * round ones as a fig's.
 */

export type FloraId = 'temperate' | 'tropical'

/** a tree species at one level of detail: the ez-tree preset, its seed and crown fullness (trees.grow) */
export interface TreeSpec {
  preset: string
  seed: number
  /** the layout's `conifer` kind (tall) */
  tall: boolean
  fullness: number
}

/** an impostor atlas cell (impostors.ts) */
export interface ImpostorSpec {
  preset: string
  seed: number
  kind: 'conifer' | 'broadleaf' | 'shrub'
  /** light variant (fewer, bigger leaf cards): reads better small */
  light: boolean
  /** crown fullness (trees.grow) — the same as the near trees', so a tree keeps its mass at every distance */
  fullness: number
}

export interface Flora {
  /** LOD 0 trees (tall first) */
  near: TreeSpec[]
  /** LOD 1: grown light, then turned into skeleton + foliage masses (masses.ts) */
  mid: TreeSpec[]
  bushes: TreeSpec[]
  /** the impostor atlas cells, left to right */
  impostors: ImpostorSpec[]
  /** leaf colours: `temperate` olive summer greens, `tropical` deeper, bluer, glossier greens */
  palette: FloraId
}

export const FLORA: Record<FloraId, Flora> = {
  temperate: {
    near: [
      { preset: 'Pine Medium', seed: 101, tall: true, fullness: 1.5 },
      { preset: 'Pine Large', seed: 202, tall: true, fullness: 1.5 },
      { preset: 'Oak Large', seed: 303, tall: false, fullness: 2.2 },
      { preset: 'Oak Medium', seed: 404, tall: false, fullness: 2.4 },
      { preset: 'Ash Large', seed: 505, tall: false, fullness: 2.2 },
      { preset: 'Aspen Large', seed: 606, tall: false, fullness: 2 },
    ],
    mid: [
      { preset: 'Pine Medium', seed: 707, tall: true, fullness: 1.5 },
      { preset: 'Pine Large', seed: 808, tall: true, fullness: 1.5 },
      { preset: 'Oak Large', seed: 909, tall: false, fullness: 2.2 },
      { preset: 'Oak Medium', seed: 1010, tall: false, fullness: 2.4 },
      { preset: 'Ash Large', seed: 1111, tall: false, fullness: 2.2 },
      { preset: 'Aspen Large', seed: 1212, tall: false, fullness: 2 },
    ],
    bushes: [
      { preset: 'Bush 1', seed: 11, tall: false, fullness: 1 },
      { preset: 'Bush 2', seed: 12, tall: false, fullness: 1 },
      { preset: 'Bush 3', seed: 13, tall: false, fullness: 1 },
    ],
    impostors: [
      { preset: 'Pine Large', seed: 1101, kind: 'conifer', light: true, fullness: 1.6 },
      { preset: 'Pine Medium', seed: 1202, kind: 'conifer', light: true, fullness: 1.6 },
      { preset: 'Oak Large', seed: 1303, kind: 'broadleaf', light: true, fullness: 2.4 },
      { preset: 'Oak Medium', seed: 1404, kind: 'broadleaf', light: true, fullness: 2.6 },
      { preset: 'Ash Large', seed: 1505, kind: 'broadleaf', light: true, fullness: 2.4 },
      // (the aspen's cards are autumn yellow; only their light and dark are baked — foliage.ts)
      { preset: 'Aspen Large', seed: 1606, kind: 'broadleaf', light: true, fullness: 2.2 },
      { preset: 'Bush 1', seed: 1707, kind: 'shrub', light: false, fullness: 1.4 },
      { preset: 'Bush 3', seed: 1808, kind: 'shrub', light: false, fullness: 1.4 },
    ],
    palette: 'temperate',
  },
  tropical: {
    near: [
      { preset: 'Kapok', seed: 2101, tall: true, fullness: 2 },
      { preset: 'Albizia', seed: 2202, tall: true, fullness: 2.2 },
      { preset: 'Rain Tree', seed: 2303, tall: false, fullness: 2.4 },
      { preset: 'Rain Tree', seed: 2404, tall: false, fullness: 2.4 },
      { preset: 'Fig', seed: 2505, tall: false, fullness: 2.2 },
      { preset: 'Fig', seed: 2606, tall: false, fullness: 2.2 },
    ],
    mid: [
      { preset: 'Kapok', seed: 2707, tall: true, fullness: 2 },
      { preset: 'Albizia', seed: 2808, tall: true, fullness: 2.2 },
      { preset: 'Rain Tree', seed: 2909, tall: false, fullness: 2.4 },
      { preset: 'Rain Tree', seed: 3010, tall: false, fullness: 2.4 },
      { preset: 'Fig', seed: 3111, tall: false, fullness: 2.2 },
      { preset: 'Fig', seed: 3212, tall: false, fullness: 2.2 },
    ],
    bushes: [
      { preset: 'Bush 1', seed: 11, tall: false, fullness: 1.3 },
      { preset: 'Bush 2', seed: 12, tall: false, fullness: 1.3 },
      { preset: 'Bush 3', seed: 13, tall: false, fullness: 1.3 },
    ],
    impostors: [
      { preset: 'Kapok', seed: 3301, kind: 'conifer', light: true, fullness: 2.2 },
      { preset: 'Albizia', seed: 3402, kind: 'conifer', light: true, fullness: 2.4 },
      { preset: 'Rain Tree', seed: 3503, kind: 'broadleaf', light: true, fullness: 2.6 },
      { preset: 'Rain Tree', seed: 3604, kind: 'broadleaf', light: true, fullness: 2.6 },
      { preset: 'Fig', seed: 3705, kind: 'broadleaf', light: true, fullness: 2.4 },
      { preset: 'Fig', seed: 3806, kind: 'broadleaf', light: true, fullness: 2.4 },
      { preset: 'Bush 1', seed: 1707, kind: 'shrub', light: false, fullness: 1.4 },
      { preset: 'Bush 3', seed: 1808, kind: 'shrub', light: false, fullness: 1.4 },
    ],
    palette: 'tropical',
  },
}

type Levels = Record<string, number>
interface Reshape {
  /** evergreen: no leader growing on out of each branch's end, children shorter toward its tip */
  type?: 'deciduous' | 'evergreen'
  levels?: number
  angle?: Levels
  children?: Levels
  force?: number
  gnarliness?: Levels
  length?: Levels
  radius?: Levels
  start?: Levels
  taper?: Levels
  leaves?: Partial<{ type: string; count: number; size: number; start: number; angle: number }>
}

/** a preset reshaped from another: the listed values replaced, the rest kept */
function reshape(base: PresetJson, r: Reshape): PresetJson {
  const json = structuredClone(base) as PresetJson & {
    branch: Record<string, unknown> & { force: { strength: number } }
    leaves: Record<string, unknown>
  }
  const b = json.branch as unknown as Record<string, Levels | number>
  for (const key of ['angle', 'children', 'gnarliness', 'length', 'radius', 'start', 'taper'] as const) {
    if (r[key]) b[key] = { ...(b[key] as Levels), ...r[key] }
  }
  if (r.type) (json as unknown as { type: string }).type = r.type
  if (r.levels !== undefined) json.branch.levels = r.levels
  if (r.force !== undefined) json.branch.force.strength = r.force
  if (r.leaves) Object.assign(json.leaves, r.leaves)
  return json
}

/** ez-tree's presets plus the tropical species reshaped from them */
export function withTropical(presets: Record<string, PresetJson>): Record<string, PresetJson> {
  return {
    ...presets,
    // Rain tree (Samanea saman): a short stout trunk forking low into long limbs that reach out and
    // droop at their ends, a broad dome wider than it's tall; fine pinnate leaves (ash cards). Evergreen
    // growth: no leader shooting up out of the trunk's top, limbs longest low down
    'Rain Tree': reshape(presets['Oak Large'], {
      type: 'evergreen',
      angle: { 1: 62, 2: 50, 3: 40 },
      children: { 0: 9, 1: 7, 2: 4 },
      force: -0.03,
      gnarliness: { 0: 0.03, 1: 0.14, 2: 0.14 },
      length: { 0: 34, 1: 95, 2: 40, 3: 8 },
      radius: { 0: 3.4 },
      start: { 1: 0.4, 2: 0.15 },
      taper: { 1: 0.5 },
      leaves: { type: 'ash', count: 12, size: 5, start: 0.05, angle: 20 },
    }),
    // Fig: a thick trunk, many limbs up and out into a dense rounded dome; round leaves (aspen cards)
    Fig: reshape(presets['Oak Large'], {
      angle: { 1: 58, 2: 50, 3: 45 },
      children: { 0: 11, 1: 5, 2: 4 },
      force: -0.01,
      length: { 0: 38, 1: 26, 2: 14, 3: 6 },
      radius: { 0: 3.8 },
      start: { 1: 0.3, 2: 0.1 },
      leaves: { type: 'aspen', count: 16, size: 4.2, start: 0.02, angle: 30 },
    }),
    // Kapok (Ceiba): a tall straight trunk, bare for most of its height, limbs out nearly level from
    // the top third, a wide flat crown standing clear of the canopy
    Kapok: reshape(presets['Ash Large'], {
      type: 'evergreen',
      angle: { 1: 82, 2: 45, 3: 45 },
      children: { 0: 9, 1: 6, 2: 3 },
      force: -0.02,
      gnarliness: { 0: 0.02, 1: 0.1 },
      length: { 0: 60, 1: 130, 2: 26, 3: 6 },
      radius: { 0: 2.8 },
      start: { 1: 0.62, 2: 0.2 },
      taper: { 0: 0.75, 1: 0.55 },
      leaves: { type: 'ash', count: 12, size: 4.6, start: 0.05 },
    }),
    // Albizia: a slender trunk carrying a thin flat umbrella high over the rest — the emergent's
    // silhouette on every tropical skyline
    Albizia: reshape(presets['Ash Large'], {
      type: 'evergreen',
      angle: { 1: 66, 2: 55, 3: 40 },
      children: { 0: 8, 1: 7, 2: 3 },
      force: -0.045,
      gnarliness: { 0: 0.04, 1: 0.12 },
      length: { 0: 55, 1: 200, 2: 34, 3: 6 },
      radius: { 0: 2.2 },
      start: { 1: 0.72, 2: 0.2 },
      taper: { 0: 0.8, 1: 0.55 },
      leaves: { type: 'ash', count: 12, size: 4.4, start: 0.1, angle: 20 },
    }),
  }
}
