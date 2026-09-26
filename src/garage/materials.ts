import type * as THREE from 'three'
import type { PaintStyle } from './paint'

export type MaterialCategory = 'original' | 'paint' | 'metal' | 'glass' | 'trim' | 'light'

/** PBR knobs a catalogue entry sets on the part's material */
export interface SurfaceParams {
  roughness: number
  metalness: number
  clearcoat?: number
  clearcoatRoughness?: number
  /** thin-film colour shift — anodised metal, pearl paint, heat-tinted exhausts */
  iridescence?: number
  iridescenceIOR?: number
  iridescenceThicknessRange?: [number, number]
  /** soft fabric rim light — leather, alcantara */
  sheen?: number
  sheenRoughness?: number
  sheenColor?: THREE.ColorRepresentation
  /** see-through: alpha of the surface; left out keeps the part opaque */
  opacity?: number
  /** emissive strength, in HDR units (bloom picks it up above ~0.35) */
  emissive?: number
}

export interface MaterialDef {
  label: string
  category: MaterialCategory
  /** albedo pattern generated in the shader (see paint.ts) */
  style: PaintStyle
  /** colour pickers to show: 0 none, 1 colour, 2 colour + second colour */
  colors: 0 | 1 | 2
  colorA?: string
  colorB?: string
  surface: SurfaceParams
}

const PAINT = { roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 } satisfies SurfaceParams

/**
 * The material library behind every material picker. Entries are pure data:
 * a shader pattern plus PBR parameters, so the same catalogue serves the car
 * configurator and user-made part groups.
 */
const CATALOGUE = {
  original: { label: 'Original', category: 'original', style: 'factory', colors: 0, surface: PAINT },

  // ─── paint ───────────────────────────────────────────────────────────────
  gloss: { label: 'Gloss paint', category: 'paint', style: 'solid', colors: 1, colorA: '#c8102e', surface: PAINT },
  metallic: {
    label: 'Metallic paint',
    category: 'paint',
    style: 'solid',
    colors: 1,
    colorA: '#8e949c',
    surface: { roughness: 0.32, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.05 },
  },
  satin: {
    label: 'Satin paint',
    category: 'paint',
    style: 'solid',
    colors: 1,
    colorA: '#2b6e5a',
    surface: { roughness: 0.5, metalness: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.4 },
  },
  matte: {
    label: 'Matte paint',
    category: 'paint',
    style: 'solid',
    colors: 1,
    colorA: '#16181c',
    surface: { roughness: 0.88, metalness: 0 },
  },
  pearl: {
    label: 'Pearl paint',
    category: 'paint',
    style: 'solid',
    colors: 1,
    colorA: '#e8e6ef',
    surface: {
      roughness: 0.25,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      iridescence: 0.55,
      iridescenceIOR: 1.5,
      iridescenceThicknessRange: [200, 640],
    },
  },
  stripes: {
    label: 'Racing stripes',
    category: 'paint',
    style: 'stripes',
    colors: 2,
    colorA: '#eef1f5',
    colorB: '#0d0f12',
    surface: PAINT,
  },
  'two-tone': {
    label: 'Two-tone',
    category: 'paint',
    style: 'two-tone',
    colors: 2,
    colorA: '#1e6bff',
    colorB: '#15171b',
    surface: PAINT,
  },
  camo: {
    label: 'Camo',
    category: 'paint',
    style: 'camo',
    colors: 2,
    colorA: '#5a6648',
    colorB: '#1d231a',
    surface: { roughness: 0.8, metalness: 0 },
  },

  // ─── metal ───────────────────────────────────────────────────────────────
  chrome: {
    label: 'Chrome',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#b4b8bd', // real chrome reflects ~55%; brighter values blow out under the lights
    surface: { roughness: 0.06, metalness: 1 },
  },
  brushed: {
    label: 'Brushed metal',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#b9bec5',
    surface: { roughness: 0.38, metalness: 1 },
  },
  gunmetal: {
    label: 'Gunmetal',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#3c424a',
    surface: { roughness: 0.48, metalness: 1 },
  },
  gold: {
    label: 'Gold',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#c9a227',
    surface: { roughness: 0.18, metalness: 1 },
  },
  copper: {
    label: 'Copper',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#b56a3f',
    surface: { roughness: 0.28, metalness: 1 },
  },
  anodised: {
    label: 'Anodised',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#1e6bff',
    surface: { roughness: 0.22, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.1, iridescence: 0.25, iridescenceIOR: 1.8 },
  },
  'burnt-steel': {
    label: 'Burnt titanium',
    category: 'metal',
    style: 'solid',
    colors: 1,
    colorA: '#5f666e',
    // heat-tinted exhaust: thin-film blues and purples over steel
    surface: {
      roughness: 0.3,
      metalness: 1,
      iridescence: 0.85,
      iridescenceIOR: 1.9,
      iridescenceThicknessRange: [260, 520],
    },
  },

  // ─── glass ───────────────────────────────────────────────────────────────
  'clear-glass': {
    label: 'Clear glass',
    category: 'glass',
    style: 'solid',
    colors: 1,
    colorA: '#dfe9f2',
    surface: { roughness: 0.04, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, opacity: 0.16 },
  },
  'tinted-glass': {
    label: 'Tinted glass',
    category: 'glass',
    style: 'solid',
    colors: 1,
    colorA: '#2a3340',
    surface: { roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, opacity: 0.42 },
  },
  'privacy-glass': {
    label: 'Privacy glass',
    category: 'glass',
    style: 'solid',
    colors: 1,
    colorA: '#0b0f14',
    surface: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05, opacity: 0.75 },
  },
  'mirror-glass': {
    label: 'Mirror glass',
    category: 'glass',
    style: 'solid',
    colors: 1,
    colorA: '#cfd6dd',
    surface: { roughness: 0.05, metalness: 1 },
  },

  // ─── trim ────────────────────────────────────────────────────────────────
  carbon: {
    label: 'Carbon fibre',
    category: 'trim',
    style: 'carbon',
    colors: 1,
    colorA: '#2f333a',
    surface: { roughness: 0.28, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.06 },
  },
  'forged-carbon': {
    label: 'Forged carbon',
    category: 'trim',
    style: 'camo',
    colors: 2,
    colorA: '#23262b',
    colorB: '#0f1114',
    surface: { roughness: 0.35, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 },
  },
  rubber: {
    label: 'Rubber',
    category: 'trim',
    style: 'solid',
    colors: 1,
    colorA: '#14161a',
    surface: { roughness: 0.95, metalness: 0 },
  },
  plastic: {
    label: 'Gloss plastic',
    category: 'trim',
    style: 'solid',
    colors: 1,
    colorA: '#15171b',
    surface: { roughness: 0.25, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.15 },
  },
  'textured-plastic': {
    label: 'Textured plastic',
    category: 'trim',
    style: 'solid',
    colors: 1,
    colorA: '#1b1e22',
    surface: { roughness: 0.72, metalness: 0 },
  },
  leather: {
    label: 'Leather',
    category: 'trim',
    style: 'solid',
    colors: 1,
    colorA: '#2a2422',
    surface: { roughness: 0.62, metalness: 0, sheen: 0.45, sheenRoughness: 0.55, sheenColor: '#6b5f57' },
  },
  alcantara: {
    label: 'Alcantara',
    category: 'trim',
    style: 'solid',
    colors: 1,
    colorA: '#22252a',
    surface: { roughness: 0.95, metalness: 0, sheen: 1, sheenRoughness: 0.8, sheenColor: '#9aa0a8' },
  },

  // ─── light ───────────────────────────────────────────────────────────────
  glow: {
    label: 'Glow',
    category: 'light',
    style: 'glow',
    colors: 1,
    colorA: '#35e0ff',
    surface: { roughness: 0.4, metalness: 0, emissive: 1.5 },
  },
} as const satisfies Record<string, MaterialDef>

export type MaterialId = keyof typeof CATALOGUE
/** widened to MaterialDef so entries can be read uniformly */
export const MATERIALS: Record<MaterialId, MaterialDef> = CATALOGUE

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  original: 'Original',
  paint: 'Paint',
  metal: 'Metal',
  glass: 'Glass',
  trim: 'Trim',
  light: 'Light',
}

export const MATERIAL_IDS = Object.keys(MATERIALS) as MaterialId[]

export const materialsIn = (category: MaterialCategory): MaterialId[] =>
  MATERIAL_IDS.filter((id) => MATERIALS[id].category === category)

/** a material choice a part or group stores */
export interface MaterialChoice {
  material: MaterialId
  colorA: string
  colorB: string
  /** hue shift for the Original material, degrees */
  hue: number
}

/**
 * Colours to use when switching material: metals carry their own tint, and so
 * does anything moving to another category; staying inside a category (paint →
 * paint) keeps the colours the user picked.
 */
export function colorsFor(next: MaterialId, current: MaterialChoice): Pick<MaterialChoice, 'colorA' | 'colorB'> {
  const from = MATERIALS[current.material]
  const to = MATERIALS[next]
  const keep = from.category === to.category && to.category !== 'metal' && from.colors > 0
  return {
    colorA: (keep ? current.colorA : to.colorA) ?? current.colorA,
    colorB: (keep ? current.colorB : to.colorB) ?? current.colorB,
  }
}
