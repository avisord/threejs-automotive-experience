import * as THREE from 'three'
import { createPaintMaterial, type PaintMaterial } from './paint'
import type { MaterialId } from './materials'
import { matches, type CarProfile } from './cars'

export type PartId = 'body' | 'wing' | 'rims' | 'calipers' | 'cage' | 'glass'

export interface PartConfig {
  /** entry from the material library */
  material: MaterialId
  colorA: string
  colorB: string
  /** hue shift of the factory texture, degrees (Original only) */
  hue: number
  /** glass only: 0 = factory, 1 = limo */
  tint: number
}

export type CarConfig = Record<PartId, PartConfig>

/** which meshes a part covers is per car — see CarProfile.parts */
export interface PartDef {
  id: PartId
  label: string
}

export const PART_DEFS: PartDef[] = [
  { id: 'body', label: 'Body' },
  { id: 'wing', label: 'Rear wing' },
  { id: 'rims', label: 'Rims' },
  { id: 'calipers', label: 'Brake calipers' },
  { id: 'cage', label: 'Roll cage' },
  { id: 'glass', label: 'Window tint' },
]

const part = (p: Partial<PartConfig> = {}): PartConfig => ({
  material: 'original',
  colorA: '#e9edf2',
  colorB: '#15171b',
  hue: 0,
  tint: 0,
  ...p,
})

export const DEFAULT_CONFIG: CarConfig = {
  body: part({ colorA: '#ff3fa4' }),
  wing: part({ colorA: '#30343b' }),
  rims: part({ colorA: '#1b1d21' }),
  calipers: part({ colorA: '#c8102e' }),
  cage: part({ colorA: '#15171b' }),
  glass: part(),
}

type Preset = { [K in PartId]?: Partial<PartConfig> }

export const PRESETS: Record<string, Preset> = {
  Factory: {},
  Ice: { body: { hue: 200 }, wing: { hue: 200 } },
  Stealth: {
    body: { material: 'matte', colorA: '#16181c' },
    wing: { material: 'carbon' },
    rims: { material: 'gunmetal' },
    calipers: { material: 'gloss', colorA: '#e0202a' },
    cage: { material: 'matte', colorA: '#111214' },
    glass: { tint: 0.85 },
  },
  Arctic: {
    body: { material: 'stripes', colorA: '#eef1f5', colorB: '#0d0f12' },
    wing: { material: 'carbon' },
    rims: { material: 'brushed' },
    calipers: { material: 'gloss', colorA: '#1e6bff' },
    glass: { tint: 0.4 },
  },
  Heritage: {
    body: { material: 'stripes', colorA: '#8ec5e6', colorB: '#f36f21' },
    wing: { material: 'gloss', colorA: '#8ec5e6' },
    rims: { material: 'gunmetal' },
    calipers: { material: 'gloss', colorA: '#f36f21' },
  },
  Carbon: {
    body: { material: 'carbon' },
    wing: { material: 'forged-carbon' },
    rims: { material: 'gold' },
    calipers: { material: 'gloss', colorA: '#ffd400' },
    glass: { tint: 0.6 },
  },
  Camo: {
    body: { material: 'camo', colorA: '#5a6648', colorB: '#1d231a' },
    wing: { material: 'textured-plastic', colorA: '#1d231a' },
    rims: { material: 'matte', colorA: '#1b1d21' },
    calipers: { material: 'gloss', colorA: '#ff5a1f' },
    glass: { tint: 0.7 },
  },
  'Liquid Chrome': {
    body: { material: 'chrome' },
    wing: { material: 'gloss', colorA: '#16181c' },
    rims: { material: 'gloss', colorA: '#16181c' },
    calipers: { material: 'gloss', colorA: '#35e0ff' },
    glass: { tint: 0.9 },
  },
  Pearl: {
    body: { material: 'pearl' },
    wing: { material: 'pearl' },
    rims: { material: 'brushed' },
    calipers: { material: 'anodised', colorA: '#8e5cff' },
    glass: { tint: 0.3 },
  },
}

export function presetConfig(name: string): CarConfig {
  const preset = PRESETS[name] ?? {}
  const config = structuredClone(DEFAULT_CONFIG)
  for (const id of Object.keys(config) as PartId[]) Object.assign(config[id], preset[id])
  return config
}

// each car remembers its own paint job
const storageKey = (carId: string) => `garage.car-config.v3.${carId}`

function loadSaved(carId: string): CarConfig {
  const config = structuredClone(DEFAULT_CONFIG)
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(carId)) ?? 'null') as Partial<CarConfig> | null
    if (saved) for (const id of Object.keys(config) as PartId[]) Object.assign(config[id], saved[id])
  } catch {
    // storage blocked or corrupt — start from factory
  }
  return config
}

export interface CarConfigurator {
  readonly config: CarConfig
  /** parts this car actually has meshes for */
  readonly parts: PartId[]
  /** inverse of the car root's world matrix, kept current by update() — patterns are laid out in it */
  readonly carSpace: THREE.Matrix4
  readonly profile: CarProfile
  /** change one part and re-apply it */
  set(id: PartId, patch: Partial<PartConfig>): void
  /** replace the whole configuration (e.g. a preset) */
  load(config: CarConfig): void
  /** keep car-space patterns attached if the car root moves */
  update(): void
}

/**
 * Give every configurable part repaintable materials (exports share one
 * material across many parts) and drive them from a CarConfig. Each source
 * material inside a part gets its own clone, so factory looks stay distinct.
 */
export function createConfigurator(car: THREE.Object3D, profile: CarProfile): CarConfigurator {
  const carSpace = new THREE.Matrix4()
  const paints = new Map<PartId, Map<THREE.Material, PaintMaterial>>()

  car.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || Array.isArray(mesh.material)) return
    const id = (Object.keys(profile.parts) as PartId[]).find((p) => matches(profile.parts[p]!, mesh, car))
    if (!id) return
    const clones = paints.get(id) ?? new Map<THREE.Material, PaintMaterial>()
    paints.set(id, clones)
    let paint = clones.get(mesh.material)
    if (!paint) {
      paint = createPaintMaterial(mesh.material, carSpace, { lacquer: id === 'body' })
      clones.set(mesh.material, paint)
    }
    mesh.material = paint.material
  })
  for (const id of Object.keys(profile.parts) as PartId[]) {
    if (!paints.has(id)) console.warn(`[garage] ${profile.id}: no meshes matched part "${id}"`)
  }

  const config = loadSaved(profile.id)

  function applyPart(id: PartId): void {
    const c = config[id]
    for (const paint of paints.get(id)?.values() ?? []) {
      if (id === 'glass' && c.tint > 0) {
        // tint film: darken the glass and push its alpha up
        paint.apply({ ...c, material: 'tinted-glass', colorA: '#05070a', opacity: THREE.MathUtils.lerp(0.35, 0.96, c.tint) })
      } else {
        paint.apply({ ...c, opacity: null })
      }
    }
  }

  function save(): void {
    try {
      localStorage.setItem(storageKey(profile.id), JSON.stringify(config))
    } catch {
      // not persisted — fine
    }
  }

  for (const id of Object.keys(config) as PartId[]) applyPart(id)

  return {
    config,
    parts: PART_DEFS.map((d) => d.id).filter((id) => paints.has(id)),
    carSpace,
    profile,
    set(id, patch) {
      Object.assign(config[id], patch)
      applyPart(id)
      save()
    },
    load(next) {
      for (const id of Object.keys(config) as PartId[]) {
        Object.assign(config[id], next[id])
        applyPart(id)
      }
      save()
    },
    update() {
      carSpace.copy(car.matrixWorld).invert()
    },
  }
}
