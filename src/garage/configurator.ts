import * as THREE from 'three'
import { createPaintMaterial, type Finish, type PaintMaterial, type PaintStyle } from './paint'
import { matches, type CarProfile } from './cars'

export type PartId = 'body' | 'wing' | 'rims' | 'calipers' | 'cage' | 'glass'

export interface PartConfig {
  style: PaintStyle
  colorA: string
  colorB: string
  hue: number
  finish: Finish
  /** glass only: 0 = factory, 1 = limo */
  tint: number
}

export type CarConfig = Record<PartId, PartConfig>

/** which meshes a part covers is per car — see CarProfile.parts */
export interface PartDef {
  id: PartId
  label: string
  styles: PaintStyle[]
}

export const PART_DEFS: PartDef[] = [
  { id: 'body', label: 'Body', styles: ['factory', 'solid', 'stripes', 'two-tone', 'carbon', 'camo'] },
  { id: 'wing', label: 'Rear wing', styles: ['factory', 'solid', 'carbon'] },
  { id: 'rims', label: 'Rims', styles: ['factory', 'solid', 'carbon'] },
  { id: 'calipers', label: 'Brake calipers', styles: ['factory', 'solid'] },
  { id: 'cage', label: 'Roll cage', styles: ['factory', 'solid'] },
  { id: 'glass', label: 'Window tint', styles: [] },
]

const part = (p: Partial<PartConfig> = {}): PartConfig => ({
  style: 'factory',
  colorA: '#e9edf2',
  colorB: '#15171b',
  hue: 0,
  finish: 'factory',
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
    body: { style: 'solid', colorA: '#16181c', finish: 'matte' },
    wing: { style: 'carbon', colorA: '#30343b', finish: 'gloss' },
    rims: { style: 'solid', colorA: '#1b1d21', finish: 'satin' },
    calipers: { style: 'solid', colorA: '#e0202a', finish: 'gloss' },
    cage: { style: 'solid', colorA: '#111214', finish: 'matte' },
    glass: { tint: 0.85 },
  },
  Arctic: {
    body: { style: 'stripes', colorA: '#eef1f5', colorB: '#0d0f12', finish: 'gloss' },
    wing: { style: 'carbon', colorA: '#30343b', finish: 'gloss' },
    rims: { style: 'solid', colorA: '#c9ccd2', finish: 'metallic' },
    calipers: { style: 'solid', colorA: '#1e6bff', finish: 'gloss' },
    glass: { tint: 0.4 },
  },
  Heritage: {
    body: { style: 'stripes', colorA: '#8ec5e6', colorB: '#f36f21', finish: 'gloss' },
    wing: { style: 'solid', colorA: '#8ec5e6', finish: 'gloss' },
    rims: { style: 'solid', colorA: '#16181c', finish: 'satin' },
    calipers: { style: 'solid', colorA: '#f36f21', finish: 'gloss' },
  },
  Carbon: {
    body: { style: 'carbon', colorA: '#3a3f47', finish: 'gloss' },
    wing: { style: 'carbon', colorA: '#3a3f47', finish: 'gloss' },
    rims: { style: 'solid', colorA: '#c9a227', finish: 'metallic' },
    calipers: { style: 'solid', colorA: '#ffd400', finish: 'gloss' },
    glass: { tint: 0.6 },
  },
  Camo: {
    body: { style: 'camo', colorA: '#5a6648', colorB: '#1d231a', finish: 'matte' },
    wing: { style: 'solid', colorA: '#1d231a', finish: 'matte' },
    rims: { style: 'solid', colorA: '#1b1d21', finish: 'matte' },
    calipers: { style: 'solid', colorA: '#ff5a1f', finish: 'gloss' },
    glass: { tint: 0.7 },
  },
  'Liquid Chrome': {
    // real chrome reflects ~55% — brighter albedos turn the ceiling light into a bloom blob
    body: { style: 'solid', colorA: '#b4b8bd', finish: 'chrome' },
    wing: { style: 'solid', colorA: '#16181c', finish: 'gloss' },
    rims: { style: 'solid', colorA: '#16181c', finish: 'gloss' },
    calipers: { style: 'solid', colorA: '#35e0ff', finish: 'gloss' },
    glass: { tint: 0.9 },
  },
}

export function presetConfig(name: string): CarConfig {
  const preset = PRESETS[name] ?? {}
  const config = structuredClone(DEFAULT_CONFIG)
  for (const id of Object.keys(config) as PartId[]) Object.assign(config[id], preset[id])
  return config
}

// each car remembers its own paint job
const storageKey = (carId: string) => `garage.car-config.v2.${carId}`

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
      if (id === 'glass') {
        // tinted film: dark solid colour with the alpha pushed up
        paint.apply(
          c.tint > 0
            ? { ...c, style: 'solid', colorA: '#05070a', finish: 'factory', opacity: THREE.MathUtils.lerp(0.35, 0.96, c.tint) }
            : { ...c, style: 'factory', finish: 'factory', opacity: null },
        )
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
