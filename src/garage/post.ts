import * as THREE from 'three'
import {
  BlendFunction,
  BloomEffect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
  type Effect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { GradeEffect } from './grade-effect'

export type AoQuality = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
export type ToneMapper = 'agx' | 'aces' | 'neutral'
export type GradeLook = 'natural' | 'cyber' | 'warm' | 'cold' | 'noir'
export type Msaa = 0 | 2 | 4 | 8
export type Smaa = 'off' | 'low' | 'medium' | 'high' | 'ultra'
/** floor mirror resolution relative to the canvas; 0 turns the mirror off */
export type Reflections = 'off' | 'low' | 'medium' | 'high'
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra'

export interface GraphicsSettings {
  ao: { enabled: boolean; intensity: number; radius: number; quality: AoQuality }
  bloom: { enabled: boolean; lightsOnly: boolean; intensity: number; threshold: number; radius: number }
  grade: {
    enabled: boolean
    toneMapper: ToneMapper
    look: GradeLook
    exposure: number
    contrast: number
    saturation: number
    temperature: number
    split: number
  }
  vignette: { enabled: boolean; darkness: number; offset: number }
  aa: { msaa: Msaa; smaa: Smaa }
  /** applied outside the composer (renderer, room, textures) — see main.ts */
  quality: { renderScale: number; reflections: Reflections; anisotropy: number }
  /** frame loop and camera — see main.ts */
  display: {
    /** 0 = uncapped (display refresh rate) */
    fpsCap: number
    /** only draw when something changed (camera, car, settings); idle costs nothing */
    onDemand: boolean
    /** stop drawing while the window is in the background; hidden tabs always stop */
    pauseUnfocused: boolean
    fov: number
    showFps: boolean
  }
}

export type GraphicsSection = keyof GraphicsSettings

export const REFLECTION_SCALE: Record<Reflections, number> = { off: 0, low: 0.25, medium: 0.5, high: 1 }

type PresetValues = Pick<GraphicsSettings, 'aa' | 'quality'> & { ao: Pick<GraphicsSettings['ao'], 'enabled' | 'quality'> }

/** what each quality preset sets; everything else (looks, intensities) is left alone */
export const QUALITY_PRESETS: Record<QualityPreset, PresetValues> = {
  low: {
    aa: { msaa: 0, smaa: 'medium' },
    quality: { renderScale: 0.75, reflections: 'off', anisotropy: 2 },
    ao: { enabled: false, quality: 'Performance' },
  },
  medium: {
    aa: { msaa: 2, smaa: 'off' },
    quality: { renderScale: 1, reflections: 'low', anisotropy: 4 },
    ao: { enabled: true, quality: 'Medium' },
  },
  high: {
    aa: { msaa: 4, smaa: 'off' },
    quality: { renderScale: 1, reflections: 'medium', anisotropy: 8 },
    ao: { enabled: true, quality: 'High' },
  },
  ultra: {
    aa: { msaa: 4, smaa: 'high' },
    quality: { renderScale: 1.5, reflections: 'high', anisotropy: 16 },
    ao: { enabled: true, quality: 'Ultra' },
  },
}

/** the preset the current settings equal, or null for a custom mix */
export function matchingPreset(s: GraphicsSettings): QualityPreset | null {
  const same = (a: object, b: object) => Object.entries(b).every(([k, v]) => (a as Record<string, unknown>)[k] === v)
  const hit = (Object.keys(QUALITY_PRESETS) as QualityPreset[]).find((name) => {
    const p = QUALITY_PRESETS[name]
    return same(s.aa, p.aa) && same(s.quality, p.quality) && same(s.ao, p.ao)
  })
  return hit ?? null
}

const SMAA_PRESET: Record<Exclude<Smaa, 'off'>, SMAAPreset> = {
  low: SMAAPreset.LOW,
  medium: SMAAPreset.MEDIUM,
  high: SMAAPreset.HIGH,
  ultra: SMAAPreset.ULTRA,
}

/** AO debug view — for tuning, deliberately not saved */
export type AoView = 'final' | 'ao' | 'split'
const AO_DISPLAY = { final: 'Combined', ao: 'AO', split: 'Split AO' } as const

interface Look {
  contrast: number
  saturation: number
  temperature: number
  split: number
  shadowTint: THREE.ColorRepresentation
  highlightTint: THREE.ColorRepresentation
}

/** a look sets the grade sliders to a starting point; the sliders fine-tune from there */
export const LOOKS: Record<GradeLook, Look> = {
  natural: { contrast: 1, saturation: 1, temperature: 0, split: 0, shadowTint: 0xffffff, highlightTint: 0xffffff },
  cyber: { contrast: 1.12, saturation: 1.1, temperature: -0.1, split: 0.3, shadowTint: 0x1fb6c9, highlightTint: 0xff7ad9 },
  warm: { contrast: 1.08, saturation: 1.05, temperature: 0.45, split: 0.2, shadowTint: 0x3c6e8f, highlightTint: 0xffb46b },
  cold: { contrast: 1.1, saturation: 0.9, temperature: -0.5, split: 0.2, shadowTint: 0x2a4a8a, highlightTint: 0xd8f0ff },
  noir: { contrast: 1.3, saturation: 0, temperature: 0, split: 0, shadowTint: 0xffffff, highlightTint: 0xffffff },
}

/** bloom threshold that suits each mode — only emitters vs anything bright */
export const BLOOM_THRESHOLD = { lightsOnly: 0.35, all: 1.6 }

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  ao: { enabled: true, intensity: 5, radius: 0.9, quality: 'High' },
  bloom: { enabled: true, lightsOnly: true, intensity: 1.4, threshold: BLOOM_THRESHOLD.lightsOnly, radius: 0.75 },
  // Neutral keeps the livery's saturated pink; AgX washes it out, ACES crushes the walls
  grade: { enabled: true, toneMapper: 'neutral', look: 'cyber', exposure: 0, ...pick(LOOKS.cyber) },
  vignette: { enabled: true, darkness: 0.55, offset: 0.3 },
  aa: { ...QUALITY_PRESETS.high.aa },
  quality: { ...QUALITY_PRESETS.high.quality },
  display: { fpsCap: 0, onDemand: true, pauseUnfocused: false, fov: 42, showFps: true },
}

function pick(look: Look) {
  const { contrast, saturation, temperature, split } = look
  return { contrast, saturation, temperature, split }
}

const TONE_MAPPING: Record<ToneMapper, ToneMappingMode> = {
  agx: ToneMappingMode.AGX,
  aces: ToneMappingMode.ACES_FILMIC,
  neutral: ToneMappingMode.NEUTRAL,
}

const STORAGE_KEY = 'garage.graphics.v1'

function loadSaved(): GraphicsSettings {
  const settings = structuredClone(DEFAULT_GRAPHICS)
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<GraphicsSettings> | null
    if (saved) for (const k of Object.keys(settings) as GraphicsSection[]) Object.assign(settings[k], saved[k])
  } catch {
    // storage blocked or corrupt — defaults
  }
  return settings
}

export interface PostProcessing {
  readonly settings: GraphicsSettings
  set<K extends GraphicsSection>(section: K, patch: Partial<GraphicsSettings[K]>): void
  /** set AA, resolution, reflections, textures and AO quality in one go */
  applyPreset(name: QualityPreset): void
  reset(): void
  /** re-read which meshes glow (lights-only bloom), e.g. after a part is set to glow */
  refreshGlow(): void
  /** called after any change with the sections that changed */
  onChange(listener: (sections: GraphicsSection[]) => void): void
  aoView: AoView
  setSize(width: number, height: number): void
  render(dt: number): void
}

/**
 * pmndrs/postprocessing pipeline:
 *   scene (4× MSAA, half-float) → N8AO → [bloom · grade · tone mapping · vignette]
 * The effects share one fullscreen pass. Toggling an effect or switching bloom
 * mode / tone mapper rebuilds that pass; sliders only touch uniforms.
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  glowMeshes: () => THREE.Object3D[],
): PostProcessing {
  // tone mapping happens in the effect pass, not in every material
  renderer.toneMapping = THREE.NoToneMapping

  const settings = loadSaved()
  const composer = new EffectComposer(renderer, { multisampling: settings.aa.msaa, frameBufferType: THREE.HalfFloatType })
  composer.addPass(new RenderPass(scene, camera))

  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
  ao.configuration.gammaCorrection = false // the effect pass after it handles output colour
  composer.addPass(ao)

  const listeners: ((sections: GraphicsSection[]) => void)[] = []
  let aoQuality: AoQuality | null = null
  let aoView: AoView = 'final'

  let effectPass: EffectPass | null = null
  let smaaPass: EffectPass | null = null
  let bloom: BloomEffect | null = null
  let grade: GradeEffect | null = null
  let vignette: VignetteEffect | null = null
  let structureKey = ''

  function rebuildEffects(): void {
    for (const pass of [effectPass, smaaPass]) {
      if (!pass) continue
      composer.removePass(pass)
      pass.dispose() // also disposes the effects it holds
    }
    smaaPass = null
    const s = settings
    const effects: Effect[] = []
    bloom = grade = vignette = null
    if (s.bloom.enabled) {
      const options = { mipmapBlur: true, blendFunction: BlendFunction.ADD, luminanceSmoothing: 0.1 }
      if (s.bloom.lightsOnly) {
        const selective = new SelectiveBloomEffect(scene, camera, options)
        selective.selection.set(glowMeshes())
        bloom = selective
      } else {
        bloom = new BloomEffect(options)
      }
      effects.push(bloom)
    }
    if (s.grade.enabled) effects.push((grade = new GradeEffect()))
    effects.push(new ToneMappingEffect({ mode: TONE_MAPPING[s.grade.toneMapper] }))
    if (s.vignette.enabled) effects.push((vignette = new VignetteEffect()))

    effectPass = new EffectPass(camera, ...effects)
    composer.addPass(effectPass)

    // SMAA gets its own pass so it finds edges in the tone-mapped image, not raw HDR
    if (s.aa.smaa !== 'off') {
      smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAA_PRESET[s.aa.smaa] }))
      composer.addPass(smaaPass)
    }
  }

  function apply(): void {
    const s = settings
    const key = [s.bloom.enabled, s.bloom.lightsOnly, s.grade.enabled, s.grade.toneMapper, s.vignette.enabled, s.aa.smaa].join()
    if (key !== structureKey) {
      structureKey = key
      rebuildEffects()
    }

    if (composer.multisampling !== s.aa.msaa) composer.multisampling = s.aa.msaa // reallocates the frame buffers

    ao.enabled = s.ao.enabled
    if (s.ao.quality !== aoQuality) {
      aoQuality = s.ao.quality
      ao.setQualityMode(s.ao.quality) // recompiles — only on change
    }
    ao.configuration.intensity = s.ao.intensity
    ao.configuration.aoRadius = s.ao.radius
    ao.configuration.distanceFalloff = 1

    if (bloom) {
      bloom.intensity = s.bloom.intensity
      bloom.luminanceMaterial.threshold = s.bloom.threshold
      bloom.mipmapBlurPass.radius = s.bloom.radius
    }
    if (grade) {
      const look = LOOKS[s.grade.look]
      grade.set({ ...s.grade, shadowTint: look.shadowTint, highlightTint: look.highlightTint })
    }
    if (vignette) {
      vignette.darkness = s.vignette.darkness
      vignette.offset = s.vignette.offset
    }
  }

  function save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    } catch {
      // not persisted — fine
    }
  }

  apply()

  return {
    settings,
    set(section, patch) {
      Object.assign(settings[section], patch)
      apply()
      save()
      for (const l of listeners) l([section])
    },
    applyPreset(name) {
      const p = QUALITY_PRESETS[name]
      Object.assign(settings.aa, p.aa)
      Object.assign(settings.quality, p.quality)
      Object.assign(settings.ao, p.ao)
      apply()
      save()
      for (const l of listeners) l(['aa', 'quality', 'ao'])
    },
    onChange(listener) {
      listeners.push(listener)
    },
    refreshGlow() {
      if (bloom instanceof SelectiveBloomEffect) bloom.selection.set(glowMeshes())
    },
    get aoView() {
      return aoView
    },
    set aoView(view) {
      aoView = view
      ao.setDisplayMode(AO_DISPLAY[view])
    },
    reset() {
      for (const k of Object.keys(settings) as GraphicsSection[]) Object.assign(settings[k], DEFAULT_GRAPHICS[k])
      apply()
      save()
      for (const l of listeners) l(Object.keys(settings) as GraphicsSection[])
    },
    setSize(width, height) {
      composer.setSize(width, height)
    },
    render(dt) {
      composer.render(dt)
    },
  }
}
