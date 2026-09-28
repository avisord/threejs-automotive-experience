import * as THREE from 'three'
import {
  BlendFunction,
  BloomEffect,
  DepthOfFieldEffect,
  EffectComposer,
  EffectPass,
  Pass,
  RenderPass,
  SelectiveBloomEffect,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  type Effect,
} from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { AUTO_KEY, GradeEffect } from './grade-effect'
import { ExposureMeter } from './exposure-meter'
import { AtmosphereEffect, type AtmosphereParams } from './atmosphere-effect'
import { LensFlareEffect } from './lens-flare-effect'
import { ToneMapEffect, type ToneMapper } from './tone-map-effect'
import { ColourBalanceEffect, NEUTRAL_WHEEL, type Wheel } from './colour-balance-effect'
import { FilmEffect } from './film-effect'
import { SsaoPass } from './ssao'
import { SsrPass, type SsrQuality, type SsrScope } from './ssr'
import { DEFAULT_SHADOWS, type ShadowSettings } from './shadows'

export type { ToneMapper } from './tone-map-effect'
export type { Wheel } from './colour-balance-effect'
export type { SsrQuality, SsrScope } from './ssr'

export type AoQuality = 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'
/** N8AO or a classic SSAO (ssao.ts) — both half res, normals from depth */
export type AoMethod = 'n8ao' | 'ssao'
export type GradeLook = 'natural' | 'daylight' | 'afternoon' | 'golden' | 'cyber' | 'warm' | 'cold' | 'noir'
export type Msaa = 0 | 2 | 4 | 8
export type Smaa = 'off' | 'low' | 'medium' | 'high' | 'ultra'
/** floor mirror resolution relative to the canvas; 0 turns the mirror off */
export type Reflections = 'off' | 'low' | 'medium' | 'high'
export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra'
export type VolumetricQuality = 'low' | 'medium' | 'high'
/** depth of field: on where the garage asks for it (a photographic location), always, or never */
/** the background's blur, as a fraction of the bokeh scale the foreground can reach (see `lensCoc`) */
const FAR_BLUR = 0.35

/**
 * A lens's blur instead of pmndrs' step: its circle of confusion is one smoothstep over the focus
 * range, so everything past it got the same blur — the bushes a few metres from the lens no softer
 * than the hills. A thin lens's grows as |d − f| / d: the background levels off (at `FAR_BLUR` of the
 * bokeh scale) while the foreground keeps growing toward the lens, full blur inside a quarter of
 * the focus distance. The sharp zone round the car (`focusRange`) is kept.
 */
function lensCoc(material: THREE.ShaderMaterial): void {
  const stock = 'float magnitude=smoothstep(0.0,focusRange,abs(signedDistance));'
  if (!material.fragmentShader.includes(stock)) {
    console.warn('[garage] depth of field: CoC shader changed, lens blur not applied')
    return
  }
  material.fragmentShader = material.fragmentShader.replace(
    stock,
    `float magnitude=smoothstep(0.0,focusRange,abs(signedDistance))*min(1.0,${FAR_BLUR.toFixed(3)}*abs(signedDistance)/max(distance,1e-3));`,
  )
  material.needsUpdate = true
}

export type DofMode = 'auto' | 'on' | 'off'
/** ray-march steps per pixel for each volumetric quality */
const VOLUMETRIC_STEPS: Record<VolumetricQuality, number> = { low: 14, medium: 28, high: 48 }

export interface GraphicsSettings {
  ao: {
    enabled: boolean
    method: AoMethod
    /** N8AO */
    intensity: number
    /** N8AO, metres */
    radius: number
    /** N8AO: how softly occlusion fades with the depth gap to the occluder */
    falloff: number
    quality: AoQuality
    ssaoIntensity: number
    /** SSAO, metres */
    ssaoRadius: number
    /** SSAO: how far above a surface's tangent plane an occluder must rise to count (cosine) */
    ssaoBias: number
  }
  /** screen-space reflections on the surfaces in `scope` — see ssr.ts */
  ssr: {
    scope: SsrScope
    quality: SsrQuality
    strength: number
    /** surfaces rougher than this don't take traced reflections */
    roughness: number
    /** metres a ray travels at most */
    distance: number
  }
  bloom: { enabled: boolean; lightsOnly: boolean; intensity: number; threshold: number; radius: number }
  /** HDR → display; always on */
  toneMapping: { mode: ToneMapper; whitePoint: number }
  grade: {
    enabled: boolean
    look: GradeLook
    exposure: number
    /** auto exposure, 0 off … 1 full: how far the metered scene is brought to a standard brightness */
    auto: number
    contrast: number
    saturation: number
    temperature: number
    split: number
  }
  /** lift / gamma / gain wheels on the tone-mapped image */
  balance: { enabled: boolean; lift: Wheel; gamma: Wheel; gain: Wheel }
  vignette: { enabled: boolean; darkness: number; offset: number }
  /** contrast-adaptive sharpening, 0 … 1 */
  sharpen: { enabled: boolean; amount: number }
  /** lateral chromatic aberration toward the frame's edges */
  aberration: { enabled: boolean; strength: number }
  /** film grain; size in pixels */
  grain: { enabled: boolean; amount: number; size: number }
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
  /** distance haze in open-air garages — see atmosphere-effect.ts */
  atmosphere: { enabled: boolean; strength: number }
  /**
   * How a street garage lights its shade: measured light probes (the sunlit facades' coloured bounce)
   * and per-point sky visibility, or the earlier estimate (a constant bounce, a fixed sky share)
   */
  gi: { probes: boolean }
  /** the sun's shadow maps in open-air garages — applied by main.ts, see shadows.ts */
  shadows: ShadowSettings
  /** sunlight shafts through the air (ray-marched through the sun's shadow map), open-air garages */
  volumetric: { enabled: boolean; strength: number; quality: VolumetricQuality }
  /** glare, starburst and ghosts when the sun is in view — see lens-flare-effect.ts */
  lensFlare: { enabled: boolean; intensity: number }
  /**
   * A photographer's depth of field, focused on the car (the orbit target): the car sharp, the
   * coast behind it a little soft. `strength` scales the blur (aperture), `range` is how deep the
   * sharp zone is, metres.
   */
  dof: { mode: DofMode; strength: number; range: number }
  /** progressive path tracing once the camera rests — see pathtrace.ts */
  pathTracing: {
    enabled: boolean
    bounces: number
    /** samples per pixel to stop at */
    samples: number
    /** traced buffer size relative to the canvas, in CSS pixels */
    resolution: number
    /** clean up early samples (fades out as the image converges) */
    denoise: boolean
  }
}

export type GraphicsSection = keyof GraphicsSettings

/**
 * Lays the path-traced image over the rasterised frame, straight after the
 * render pass — so everything after it (bloom, grade, tone mapping, vignette)
 * treats both the same, and the raster frame's depth still serves the
 * selective bloom. `weight` fades the traced image in over its first samples.
 */
class PathTraceBlendPass extends Pass {
  private readonly material: THREE.ShaderMaterial

  constructor() {
    super('PathTraceBlendPass')
    this.needsSwap = false
    this.material = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: null }, uWeight: { value: 0 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = position.xy * 0.5 + 0.5;
          gl_Position = vec4( position.xy, 1.0, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tMap;
        uniform float uWeight;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4( texture2D( tMap, vUv ).rgb, uWeight );
        }`,
    })
    this.fullscreenMaterial = this.material
  }

  show(texture: THREE.Texture | null, weight: number): void {
    this.material.uniforms.tMap.value = texture
    this.material.uniforms.uWeight.value = texture ? weight : 0
    this.enabled = texture !== null && weight > 0
  }

  render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null): void {
    renderer.setRenderTarget(this.renderToScreen ? null : inputBuffer)
    renderer.render(this.scene, this.camera)
  }
}

export const REFLECTION_SCALE: Record<Reflections, number> = { off: 0, low: 0.25, medium: 0.5, high: 1 }

type PresetValues = Pick<GraphicsSettings, 'aa' | 'quality'> & {
  ao: Pick<GraphicsSettings['ao'], 'enabled' | 'quality'>
  ssr: Pick<GraphicsSettings['ssr'], 'quality'>
}

/** what each quality preset sets; everything else (looks, intensities) is left alone */
export const QUALITY_PRESETS: Record<QualityPreset, PresetValues> = {
  low: {
    aa: { msaa: 0, smaa: 'medium' },
    quality: { renderScale: 0.75, reflections: 'off', anisotropy: 2 },
    ao: { enabled: false, quality: 'Performance' },
    ssr: { quality: 'low' },
  },
  medium: {
    aa: { msaa: 2, smaa: 'off' },
    quality: { renderScale: 1, reflections: 'low', anisotropy: 4 },
    ao: { enabled: true, quality: 'Medium' },
    ssr: { quality: 'low' },
  },
  high: {
    aa: { msaa: 4, smaa: 'off' },
    quality: { renderScale: 1, reflections: 'medium', anisotropy: 8 },
    ao: { enabled: true, quality: 'High' },
    ssr: { quality: 'medium' },
  },
  ultra: {
    aa: { msaa: 4, smaa: 'high' },
    quality: { renderScale: 1.5, reflections: 'high', anisotropy: 16 },
    ao: { enabled: true, quality: 'Ultra' },
    ssr: { quality: 'high' },
  },
}

/** the preset the current settings equal, or null for a custom mix */
export function matchingPreset(s: GraphicsSettings): QualityPreset | null {
  const same = (a: object, b: object) => Object.entries(b).every(([k, v]) => (a as Record<string, unknown>)[k] === v)
  const hit = (Object.keys(QUALITY_PRESETS) as QualityPreset[]).find((name) => {
    const p = QUALITY_PRESETS[name]
    return same(s.aa, p.aa) && same(s.quality, p.quality) && same(s.ao, p.ao) && same(s.ssr, p.ssr)
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

/** metres from the bay a room's mesh may reach and still count as the room for SSR */
const ROOM_REACH = 60

/** SSAO taps per pixel for each AO quality (the same presets drive both methods) */
const SSAO_SAMPLES: Record<AoQuality, number> = { Performance: 8, Low: 12, Medium: 16, High: 24, Ultra: 32 }

interface Look {
  contrast: number
  saturation: number
  temperature: number
  split: number
  shadowTint: THREE.ColorRepresentation
  highlightTint: THREE.ColorRepresentation
  /** stops the deep shade is opened up by (see GradeEffect) */
  lift: number
}

/** a look sets the grade sliders to a starting point; the sliders fine-tune from there */
export const LOOKS: Record<GradeLook, Look> = {
  natural: { contrast: 1, saturation: 1, temperature: 0, split: 0, shadowTint: 0xffffff, highlightTint: 0xffffff, lift: 0 },
  // an open-world racing game's clear midday: punchy mid-tones and colour, but the shade opened up and
  // sky blue-teal rather than crushed, whites staying white
  daylight: { contrast: 1.12, saturation: 1.06, temperature: -0.02, split: 0.2, shadowTint: 0x5f93b8, highlightTint: 0xfff1dc, lift: 0.8 },
  // a warm afternoon in a street: a touch of warmth, gentle bite, and shade kept a soft grey rather than
  // tinted — between sunny facades the shade is lit by them as much as by the sky, and daylight's blue-teal
  // shadow tint turned shaded paving navy
  afternoon: { contrast: 1.08, saturation: 1.04, temperature: 0.06, split: 0.12, shadowTint: 0x8f9aa6, highlightTint: 0xffe9cc, lift: 0.6 },
  // late-afternoon landscape photography: a touch warm, teal shadows, gold highlights, more bite — the
  // long shadows a low sun throws kept readable (they went black-green). The sun is already gold: an
  // orange highlight tint and more saturation on top took every bit of blue out of the sunlit grass
  // and turned it acid yellow-green.
  golden: { contrast: 1.14, saturation: 1.03, temperature: 0.1, split: 0.3, shadowTint: 0x3c7f8f, highlightTint: 0xffcf96, lift: 1.1 },
  cyber: { contrast: 1.12, saturation: 1.1, temperature: -0.1, split: 0.3, shadowTint: 0x1fb6c9, highlightTint: 0xff7ad9, lift: 0 },
  warm: { contrast: 1.08, saturation: 1.05, temperature: 0.45, split: 0.2, shadowTint: 0x3c6e8f, highlightTint: 0xffb46b, lift: 0 },
  cold: { contrast: 1.1, saturation: 0.9, temperature: -0.5, split: 0.2, shadowTint: 0x2a4a8a, highlightTint: 0xd8f0ff, lift: 0 },
  noir: { contrast: 1.3, saturation: 0, temperature: 0, split: 0, shadowTint: 0xffffff, highlightTint: 0xffffff, lift: 0 },
}

/** bloom threshold that suits each mode — only emitters vs anything bright */
export const BLOOM_THRESHOLD = { lightsOnly: 0.35, all: 1.6 }

export const DEFAULT_GRAPHICS: GraphicsSettings = {
  ao: {
    enabled: true,
    method: 'n8ao',
    intensity: 5,
    radius: 0.9,
    falloff: 1,
    quality: 'High',
    ssaoIntensity: 2,
    ssaoRadius: 0.6,
    ssaoBias: 0.05,
  },
  ssr: { scope: 'car', ...QUALITY_PRESETS.high.ssr, strength: 1, roughness: 0.5, distance: 30 },
  bloom: { enabled: true, lightsOnly: true, intensity: 1.4, threshold: BLOOM_THRESHOLD.lightsOnly, radius: 0.75 },
  // Neutral keeps the livery's saturated pink; AgX washes it out, ACES crushes the walls
  toneMapping: { mode: 'neutral', whitePoint: 4 },
  grade: { enabled: true, look: 'cyber', exposure: 0, auto: 0.6, ...pick(LOOKS.cyber) },
  balance: { enabled: false, lift: { ...NEUTRAL_WHEEL }, gamma: { ...NEUTRAL_WHEEL }, gain: { ...NEUTRAL_WHEEL } },
  vignette: { enabled: true, darkness: 0.55, offset: 0.3 },
  sharpen: { enabled: false, amount: 0.4 },
  aberration: { enabled: false, strength: 0.5 },
  grain: { enabled: false, amount: 0.25, size: 1.5 },
  aa: { ...QUALITY_PRESETS.high.aa },
  quality: { ...QUALITY_PRESETS.high.quality },
  // ~37 mm on full frame: a photographer's lens for a car, not a wide game camera
  display: { fpsCap: 0, onDemand: true, pauseUnfocused: false, fov: 36, showFps: true },
  atmosphere: { enabled: true, strength: 1 },
  gi: { probes: true },
  shadows: { ...DEFAULT_SHADOWS },
  volumetric: { enabled: true, strength: 1, quality: 'medium' },
  lensFlare: { enabled: true, intensity: 1 },
  dof: { mode: 'auto', strength: 1, range: 6 },
  pathTracing: { enabled: false, bounces: 4, samples: 256, resolution: 0.75, denoise: true },
}

function pick(look: Look) {
  const { contrast, saturation, temperature, split } = look
  return { contrast, saturation, temperature, split }
}

const STORAGE_KEY = 'garage.graphics.v1'

function loadSaved(): GraphicsSettings {
  const settings = structuredClone(DEFAULT_GRAPHICS)
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<GraphicsSettings> | null
    if (saved) for (const k of Object.keys(settings) as GraphicsSection[]) Object.assign(settings[k], saved[k])
    // the tone mapper used to be part of the grade
    const old = (saved?.grade as { toneMapper?: ToneMapper } | undefined)?.toneMapper
    if (old && !saved?.toneMapping) settings.toneMapping.mode = old
    delete (settings.grade as { toneMapper?: ToneMapper }).toneMapper
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
  /**
   * Re-read which meshes glow (lights-only bloom) and which reflect (SSR): a part set to glow, a
   * material changed, a new car or garage.
   */
  refreshGlow(): void
  /** overlay the path-traced image (null = raster only) */
  showPathTraced(texture: THREE.Texture | null, weight: number): void
  /** the current garage's air (open-air garages), or null for none */
  setAtmosphere(params: AtmosphereParams | null): void
  /**
   * What the lens focuses on (kept live: the orbit target), and whether the garage asks for depth
   * of field — with its own aperture (the blur's scale) — or not (null). See `dof.mode`.
   */
  setFocus(target: THREE.Vector3, garage: { bokehScale: number } | null): void
  /** depth of field is currently in the picture */
  readonly dofActive: boolean
  /** the brightness the current garage is exposed for (its `exposureKey`) */
  setExposureKey(key: number): void
  /** auto exposure's last metered mean log2 luminance (reads back from the GPU: for the console) */
  readMeter(): number
  /** called after any change with the sections that changed */
  onChange(listener: (sections: GraphicsSection[]) => void): void
  aoView: AoView
  /** the SSR pass, for tuning from the console (`garage.post.ssr.debugView = 1`) */
  readonly ssr: SsrPass
  setSize(width: number, height: number): void
  render(dt: number): void
}

/**
 * pmndrs/postprocessing pipeline:
 *   scene (4× MSAA, half-float) → N8AO or SSAO → SSR → [air · flare · bloom · grade · tone mapping ·
 *   colour balance · vignette] → SMAA → [sharpen · aberration · grain]
 * The effects share one fullscreen pass. Toggling an effect or switching bloom
 * mode / tone mapper rebuilds that pass; sliders only touch uniforms.
 */
export function createPostProcessing(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  glowMeshes: () => THREE.Object3D[],
  /** the roots whose meshes take screen-space reflections, for a scope */
  reflectors: (scope: Exclude<SsrScope, 'off'>) => THREE.Object3D[],
): PostProcessing {
  // tone mapping happens in the effect pass, not in every material
  renderer.toneMapping = THREE.NoToneMapping

  const settings = loadSaved()
  const composer = new EffectComposer(renderer, { multisampling: settings.aa.msaa, frameBufferType: THREE.HalfFloatType })
  composer.addPass(new RenderPass(scene, camera))
  const blend = new PathTraceBlendPass()
  blend.enabled = false
  composer.addPass(blend)
  let traced = false // screen-space AO on top of a path-traced image would darken it twice

  const ao = new N8AOPostPass(scene, camera, window.innerWidth, window.innerHeight)
  ao.configuration.gammaCorrection = false // the effect pass after it handles output colour
  // half resolution, upsampled along depth edges: contact shadows under a car are soft anyway, and
  // at full resolution AO was the single most expensive pass (~5 ms at 1080p on an RX 7600)
  ao.configuration.halfRes = true
  composer.addPass(ao)
  // (only one of the two runs)
  const ssao = new SsaoPass(camera)
  composer.addPass(ssao)

  // reflections after AO (a reflection shows the occluded frame) and before the metering and grade
  const ssr = new SsrPass(scene, camera)
  composer.addPass(ssr)
  let ssrScope: SsrScope = 'off'
  /** the scope's meshes are gathered again before the next frame (a hover in the parts editor can ask often) */
  let reflectorsStale = false

  // metering for auto exposure: after the scene (and its depth of field), before the effect pass
  const meter = new ExposureMeter()
  composer.addPass(meter)

  const listeners: ((sections: GraphicsSection[]) => void)[] = []
  let aoQuality: AoQuality | null = null
  let aoView: AoView = 'final'

  let effectPass: EffectPass | null = null
  let smaaPass: EffectPass | null = null
  let filmPass: EffectPass | null = null
  let film: FilmEffect | null = null
  let toneMap: ToneMapEffect | null = null
  let balance: ColourBalanceEffect | null = null
  let bloom: BloomEffect | null = null
  let grade: GradeEffect | null = null
  let vignette: VignetteEffect | null = null
  let atmosphere: AtmosphereEffect | null = null
  let lensFlare: LensFlareEffect | null = null
  let dof: DepthOfFieldEffect | null = null
  let dofPass: EffectPass | null = null
  let focusTarget = new THREE.Vector3()
  let garageDof: { bokehScale: number } | null = null
  const dofWanted = () => settings.dof.mode === 'on' || (settings.dof.mode === 'auto' && garageDof !== null)
  let atmosphereParams: AtmosphereParams | null = null
  let exposureKey = AUTO_KEY
  let structureKey = ''

  function rebuildEffects(): void {
    for (const pass of [dofPass, effectPass, smaaPass, filmPass]) {
      if (!pass) continue
      composer.removePass(pass)
      pass.dispose() // also disposes the effects it holds
    }
    smaaPass = dofPass = filmPass = null
    const s = settings
    const effects: Effect[] = []
    bloom = grade = vignette = atmosphere = lensFlare = dof = toneMap = balance = film = null
    // Depth of field in its own pass, first: it blurs the scene's light as the lens would, and the
    // air, bloom and grade then work on the blurred image (merged into the effect pass, its blur read
    // the frame before the haze — far land lost its haze where it went soft)
    if (dofWanted()) {
      dof = new DepthOfFieldEffect(camera, { focusDistance: 8, focusRange: s.dof.range, bokehScale: 2, resolutionScale: 0.5 })
      dof.target = focusTarget
      lensCoc(dof.cocMaterial)
      dofPass = new EffectPass(camera, dof)
      composer.addPass(dofPass)
    }
    // the air goes first: haze and shafts are part of the scene's light, graded and tone mapped with it
    if ((s.atmosphere.enabled || s.volumetric.enabled) && atmosphereParams) {
      atmosphere = new AtmosphereEffect(camera)
      atmosphere.setParams(atmosphereParams)
      effects.push(atmosphere)
    }
    // the lens sees the scene's light, air included, before it's graded
    if (s.lensFlare.enabled && atmosphereParams) {
      lensFlare = new LensFlareEffect(camera)
      effects.push(lensFlare)
    }
    if (s.bloom.enabled) {
      const options = { mipmapBlur: true, blendFunction: BlendFunction.ADD, luminanceSmoothing: 0.1 }
      if (s.bloom.lightsOnly) {
        const selective = new SelectiveBloomEffect(scene, camera, options)
        // by default it keeps whatever sits at the far plane — an analytic sky is drawn there, and
        // bloomed whole it laid a milky veil over every open-air view
        selective.ignoreBackground = true
        selective.selection.set(glowMeshes())
        bloom = selective
      } else {
        bloom = new BloomEffect(options)
      }
      effects.push(bloom)
    }
    if (s.grade.enabled) effects.push((grade = new GradeEffect()))
    effects.push((toneMap = new ToneMapEffect(s.toneMapping.mode)))
    if (s.balance.enabled) effects.push((balance = new ColourBalanceEffect()))
    if (s.vignette.enabled) effects.push((vignette = new VignetteEffect()))

    effectPass = new EffectPass(camera, ...effects)
    composer.removePass(meter)
    composer.addPass(meter) // (re-added each rebuild so it stays right before the effect pass)
    composer.addPass(effectPass)
    grade?.setMeter(meter.target.texture, meter.topLevel)

    // SMAA gets its own pass so it finds edges in the tone-mapped image, not raw HDR
    if (s.aa.smaa !== 'off') {
      smaaPass = new EffectPass(camera, new SMAAEffect({ preset: SMAA_PRESET[s.aa.smaa] }))
      composer.addPass(smaaPass)
    }

    // sharpening, fringes and grain last: on the anti-aliased image, and SMAA doesn't mistake grain for edges
    if (s.sharpen.enabled || s.aberration.enabled || s.grain.enabled) {
      filmPass = new EffectPass(camera, (film = new FilmEffect()))
      composer.addPass(filmPass)
    }
  }

  /** gather the surfaces in scope again (a new car or room, changed materials) */
  function refreshReflectors(): void {
    reflectorsStale = false
    ssrScope = settings.ssr.scope
    // (the room: its building, not an open-air garage's landscape)
    ssr.setRoots(ssrScope === 'off' ? [] : reflectors(ssrScope), ssrScope === 'room' ? ROOM_REACH : Infinity)
    ssr.enabled = ssrScope !== 'off' && ssr.hasSurfaces && !traced
  }

  function apply(): void {
    const s = settings
    const key = [
      s.bloom.enabled,
      s.bloom.lightsOnly,
      s.grade.enabled,
      s.toneMapping.mode,
      s.balance.enabled,
      s.vignette.enabled,
      s.aa.smaa,
      s.sharpen.enabled || s.aberration.enabled || s.grain.enabled,
      (s.atmosphere.enabled || s.volumetric.enabled) && atmosphereParams !== null,
      s.lensFlare.enabled && atmosphereParams !== null,
      dofWanted(),
    ].join()
    if (key !== structureKey) {
      structureKey = key
      rebuildEffects()
    }

    if (composer.multisampling !== s.aa.msaa) composer.multisampling = s.aa.msaa // reallocates the frame buffers

    ao.enabled = s.ao.enabled && s.ao.method === 'n8ao' && !traced
    if (s.ao.quality !== aoQuality) {
      aoQuality = s.ao.quality
      ao.setQualityMode(s.ao.quality) // recompiles — only on change
    }
    ao.configuration.intensity = s.ao.intensity
    ao.configuration.aoRadius = s.ao.radius
    ao.configuration.distanceFalloff = s.ao.falloff
    ssao.enabled = s.ao.enabled && s.ao.method === 'ssao' && !traced
    ssao.intensity = s.ao.ssaoIntensity
    ssao.radius = s.ao.ssaoRadius
    ssao.bias = s.ao.ssaoBias
    ssao.samples = SSAO_SAMPLES[s.ao.quality]
    ssao.aoOnly = aoView !== 'final'

    if (s.ssr.scope !== ssrScope) refreshReflectors()
    ssr.enabled = ssrScope !== 'off' && ssr.hasSurfaces && !traced
    ssr.steps = SsrPass.stepsFor(s.ssr.quality)
    ssr.strength = s.ssr.strength
    ssr.roughCut = s.ssr.roughness
    ssr.maxDistance = s.ssr.distance

    if (bloom) {
      bloom.intensity = s.bloom.intensity
      bloom.luminanceMaterial.threshold = s.bloom.threshold
      bloom.mipmapBlurPass.radius = s.bloom.radius
    }
    meter.enabled = s.grade.enabled && s.grade.auto > 0
    if (grade) {
      const look = LOOKS[s.grade.look]
      grade.set({ ...s.grade, shadowTint: look.shadowTint, highlightTint: look.highlightTint, lift: look.lift, key: exposureKey })
    }
    if (toneMap) toneMap.whitePoint = s.toneMapping.whitePoint
    balance?.set(s.balance.lift, s.balance.gamma, s.balance.gain)
    film?.set({
      sharpness: s.sharpen.enabled ? s.sharpen.amount : 0,
      aberration: s.aberration.enabled ? s.aberration.strength : 0,
      grain: s.grain.enabled ? s.grain.amount : 0,
      grainSize: s.grain.size,
    })
    if (vignette) {
      vignette.darkness = s.vignette.darkness
      vignette.offset = s.vignette.offset
    }
    if (atmosphere) {
      atmosphere.setParams(atmosphereParams)
      atmosphere.strength = s.atmosphere.enabled ? s.atmosphere.strength : 0
      atmosphere.shaftStrength = s.volumetric.enabled ? s.volumetric.strength : 0
      atmosphere.shaftSteps = VOLUMETRIC_STEPS[s.volumetric.quality]
    }
    if (lensFlare) {
      lensFlare.setSun(atmosphereParams?.sunDirection ?? null, atmosphereParams?.sunColor ?? null)
      lensFlare.intensity = s.lensFlare.intensity
    }
    if (dof) {
      // (bokeh scale is in pixels at the effect's resolution: a garage's aperture × the user's strength)
      dof.bokehScale = (garageDof?.bokehScale ?? 2) * s.dof.strength
      dof.cocMaterial.focusRange = s.dof.range
      dof.target = focusTarget
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
      Object.assign(settings.ssr, p.ssr)
      apply()
      save()
      for (const l of listeners) l(['aa', 'quality', 'ao', 'ssr'])
    },
    onChange(listener) {
      listeners.push(listener)
    },
    setAtmosphere(params) {
      atmosphereParams = params
      apply()
    },
    readMeter: () => meter.read(renderer),
    setExposureKey(key) {
      exposureKey = key
      apply()
    },
    setFocus(target, garage) {
      focusTarget = target
      garageDof = garage
      apply()
    },
    get dofActive() {
      return dof !== null
    },
    showPathTraced(texture, weight) {
      blend.show(texture, weight)
      const nowTraced = texture !== null && weight > 0.5
      if (nowTraced !== traced) {
        traced = nowTraced
        apply() // screen-space AO and reflections off under a traced image, back on after
      }
    },
    refreshGlow() {
      if (bloom instanceof SelectiveBloomEffect) bloom.selection.set(glowMeshes())
      if (settings.ssr.scope !== 'off') reflectorsStale = true
    },
    ssr,
    get aoView() {
      return aoView
    },
    set aoView(view) {
      aoView = view
      ao.setDisplayMode(AO_DISPLAY[view])
      apply()
    },
    reset() {
      for (const k of Object.keys(settings) as GraphicsSection[]) Object.assign(settings[k], structuredClone(DEFAULT_GRAPHICS[k]))
      apply()
      save()
      for (const l of listeners) l(Object.keys(settings) as GraphicsSection[])
    },
    setSize(width, height) {
      composer.setSize(width, height)
    },
    render(dt) {
      if (reflectorsStale) refreshReflectors()
      composer.render(dt)
    },
  }
}
