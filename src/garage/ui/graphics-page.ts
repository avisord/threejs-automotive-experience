import {
  BLOOM_THRESHOLD,
  LOOKS,
  matchingPreset,
  type AoQuality,
  type AoView,
  type GradeLook,
  type Msaa,
  type PostProcessing,
  type QualityPreset,
  type Reflections,
  type Smaa,
  type ToneMapper,
} from '../post'
import type { Page } from './panel'
import { actionButton, el, section, segmented, slider, toggle } from './widgets'

const AO_QUALITY: Record<AoQuality, string> = {
  Performance: 'Perf',
  Low: 'Low',
  Medium: 'Med',
  High: 'High',
  Ultra: 'Ultra',
}

const AO_VIEW: Record<AoView, string> = { final: 'Final', ao: 'AO only', split: 'Split' }

const TONE_MAPPER: Record<ToneMapper, string> = { agx: 'AgX', aces: 'ACES', neutral: 'Neutral' }

const LOOK_LABEL: Record<GradeLook, string> = {
  natural: 'Natural',
  golden: 'Golden hour',
  cyber: 'Cyber',
  warm: 'Warm',
  cold: 'Cold',
  noir: 'Noir',
}

const PRESET_LABEL: Record<QualityPreset, string> = { low: 'Low', medium: 'Medium', high: 'High', ultra: 'Ultra' }

const RENDER_SCALES = ['0.5', '0.75', '1', '1.25', '1.5', '2'] as const
type RenderScale = (typeof RENDER_SCALES)[number]
const RENDER_SCALE_LABEL = Object.fromEntries(RENDER_SCALES.map((v) => [v, `${Number(v) * 100}%`])) as Record<RenderScale, string>

const MSAA_OPTIONS = ['0', '2', '4', '8'] as const
const MSAA_LABEL: Record<(typeof MSAA_OPTIONS)[number], string> = { '0': 'Off', '2': '2×', '4': '4×', '8': '8×' }

const SMAA_LABEL: Record<Smaa, string> = { off: 'Off', low: 'Low', medium: 'Med', high: 'High', ultra: 'Ultra' }

const REFLECTION_LABEL: Record<Reflections, string> = { off: 'Off', low: 'Low', medium: 'Med', high: 'High' }

const ANISO_OPTIONS = ['1', '2', '4', '8', '16'] as const
const ANISO_LABEL = Object.fromEntries(ANISO_OPTIONS.map((v) => [v, `${v}×`])) as Record<(typeof ANISO_OPTIONS)[number], string>

const PT_SAMPLES = ['64', '256', '1024', '4096'] as const
const PT_SAMPLES_LABEL = Object.fromEntries(PT_SAMPLES.map((v) => [v, v])) as Record<(typeof PT_SAMPLES)[number], string>
const PT_BOUNCES = ['2', '4', '6', '8'] as const
const PT_BOUNCES_LABEL = Object.fromEntries(PT_BOUNCES.map((v) => [v, v])) as Record<(typeof PT_BOUNCES)[number], string>
const PT_RES = ['0.5', '0.75', '1'] as const
const PT_RES_LABEL: Record<(typeof PT_RES)[number], string> = { '0.5': '50%', '0.75': '75%', '1': '100%' }

const fixed = (digits: number, unit = '') => (v: number) => `${v.toFixed(digits)}${unit}`
const signed = (digits: number, unit = '') => (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`

/** Menu › Settings › Graphics — post-processing controls */
export function graphicsPage(post: PostProcessing): Page {
  const s = post.settings

  return {
    title: 'Graphics',
    hint: 'Quality, anti-aliasing, AO, bloom, grade, vignette',
    render(body, nav) {
      // toggles and mode switches rebuild the effect chain, so re-render to show/hide controls
      const structural = () => nav.refresh()

      // ─── quality preset ─────────────────────────────────────────────────
      const preset = matchingPreset(s)
      const quality = section('Quality preset')
      quality.append(
        segmented(Object.keys(PRESET_LABEL) as QualityPreset[], PRESET_LABEL, preset ?? ('custom' as QualityPreset), (name) => {
          post.applyPreset(name)
          structural()
        }),
        el(
          'p',
          'cfg-note',
          preset
            ? 'Sets resolution, anti-aliasing, reflections, texture filtering and AO quality.'
            : 'Custom — tweaked from a preset below. Pick one to reset those settings.',
        ),
      )
      body.append(quality)

      // ─── resolution & anti-aliasing ─────────────────────────────────────
      const aa = section('Resolution & anti-aliasing')
      aa.append(
        el('div', 'cfg-label cfg-sub', 'Render scale'),
        segmented(RENDER_SCALES, RENDER_SCALE_LABEL, String(s.quality.renderScale) as RenderScale, (v) => {
          post.set('quality', { renderScale: Number(v) })
          structural()
        }),
        el('div', 'cfg-label cfg-sub', 'MSAA'),
        segmented(MSAA_OPTIONS, MSAA_LABEL, String(s.aa.msaa) as (typeof MSAA_OPTIONS)[number], (v) => {
          post.set('aa', { msaa: Number(v) as Msaa })
          structural()
        }),
        el('div', 'cfg-label cfg-sub', 'SMAA'),
        segmented(Object.keys(SMAA_LABEL) as Smaa[], SMAA_LABEL, s.aa.smaa, (smaa) => {
          post.set('aa', { smaa })
          structural()
        }),
        el('p', 'cfg-note', 'MSAA smooths geometry edges, SMAA catches what it misses, render scale above 100% fixes shimmer inside surfaces.'),
      )
      body.append(aa)

      // ─── reflections & textures ─────────────────────────────────────────
      const detail = section('Reflections & textures')
      detail.append(
        el('div', 'cfg-label cfg-sub', 'Floor reflections'),
        segmented(Object.keys(REFLECTION_LABEL) as Reflections[], REFLECTION_LABEL, s.quality.reflections, (reflections) => {
          post.set('quality', { reflections })
          structural()
        }),
        el('div', 'cfg-label cfg-sub', 'Texture filtering'),
        segmented(ANISO_OPTIONS, ANISO_LABEL, String(s.quality.anisotropy) as (typeof ANISO_OPTIONS)[number], (v) => {
          post.set('quality', { anisotropy: Number(v) })
          structural()
        }),
      )
      body.append(detail)

      // ─── path tracing ───────────────────────────────────────────────────
      const pt = s.pathTracing
      const trace = section(
        'Path tracing',
        toggle(pt.enabled, 'path tracing', (on) => {
          post.set('pathTracing', { enabled: on })
          structural()
        }),
      )
      trace.append(
        el(
          'p',
          'cfg-note',
          pt.enabled
            ? 'Once the camera rests, light is traced for real — soft shadows, bounce light, true reflections — and the picture refines until it reaches the sample count. Moving shows the fast renderer again.'
            : 'Photoreal stills: when the camera rests, trace light paths instead of rasterising. Heavy on the GPU while it refines, free once it’s done.',
        ),
      )
      if (pt.enabled) {
        trace.append(
          el('div', 'cfg-label cfg-sub', 'Samples per pixel'),
          segmented(PT_SAMPLES, PT_SAMPLES_LABEL, String(pt.samples) as (typeof PT_SAMPLES)[number], (v) => {
            post.set('pathTracing', { samples: Number(v) })
            structural()
          }),
          el('div', 'cfg-label cfg-sub', 'Bounces'),
          segmented(PT_BOUNCES, PT_BOUNCES_LABEL, String(pt.bounces) as (typeof PT_BOUNCES)[number], (v) => {
            post.set('pathTracing', { bounces: Number(v) })
            structural()
          }),
          el('div', 'cfg-label cfg-sub', 'Resolution'),
          segmented(PT_RES, PT_RES_LABEL, String(pt.resolution) as (typeof PT_RES)[number], (v) => {
            post.set('pathTracing', { resolution: Number(v) })
            structural()
          }),
          el('div', 'cfg-label cfg-sub', 'Denoise'),
          segmented(['on', 'off'] as const, { on: 'On', off: 'Off' }, pt.denoise ? 'on' : 'off', (v) => {
            post.set('pathTracing', { denoise: v === 'on' })
            structural()
          }),
          el('p', 'cfg-note', 'Paint patterns (stripes, carbon, camo) are traced in their main colour, and headlight beams — a raster effect — fade out as the traced image comes in.'),
        )
      }
      body.append(trace)

      // ─── ambient occlusion ──────────────────────────────────────────────
      const ao = section(
        'Ambient occlusion',
        toggle(s.ao.enabled, 'ambient occlusion', (on) => {
          post.set('ao', { enabled: on })
          structural()
        }),
      )
      if (s.ao.enabled) {
        ao.append(
          slider('Intensity', s.ao.intensity, { min: 0.5, max: 8, step: 0.1 }, fixed(1), (v) => post.set('ao', { intensity: v })),
          slider('Radius', s.ao.radius, { min: 0.1, max: 2, step: 0.05 }, fixed(2, ' m'), (v) => post.set('ao', { radius: v })),
          el('div', 'cfg-label cfg-sub', 'Quality'),
          segmented(Object.keys(AO_QUALITY) as AoQuality[], AO_QUALITY, s.ao.quality, (quality) => {
            post.set('ao', { quality })
            structural()
          }),
          el('div', 'cfg-label cfg-sub', 'Preview'),
          segmented(Object.keys(AO_VIEW) as AoView[], AO_VIEW, post.aoView, (view) => {
            post.aoView = view
            structural()
          }),
        )
      }
      body.append(ao)

      // ─── bloom ──────────────────────────────────────────────────────────
      const bloom = section(
        'Bloom',
        toggle(s.bloom.enabled, 'bloom', (on) => {
          post.set('bloom', { enabled: on })
          structural()
        }),
      )
      if (s.bloom.enabled) {
        bloom.append(
          segmented(['lights', 'all'] as const, { lights: 'Lights only', all: 'Everything bright' }, s.bloom.lightsOnly ? 'lights' : 'all', (mode) => {
            const lightsOnly = mode === 'lights'
            // the two modes want very different thresholds — start from the one that suits
            post.set('bloom', { lightsOnly, threshold: lightsOnly ? BLOOM_THRESHOLD.lightsOnly : BLOOM_THRESHOLD.all })
            structural()
          }),
          slider('Intensity', s.bloom.intensity, { min: 0, max: 4, step: 0.05 }, fixed(2), (v) => post.set('bloom', { intensity: v })),
          slider('Threshold', s.bloom.threshold, { min: 0, max: 3, step: 0.05 }, fixed(2), (v) => post.set('bloom', { threshold: v })),
          slider('Radius', s.bloom.radius, { min: 0, max: 1, step: 0.01 }, fixed(2), (v) => post.set('bloom', { radius: v })),
        )
      }
      body.append(bloom)

      // ─── colour grade ───────────────────────────────────────────────────
      const grade = section(
        'Colour grade',
        toggle(s.grade.enabled, 'colour grade', (on) => {
          post.set('grade', { enabled: on })
          structural()
        }),
      )
      // tone mapping always runs — it's what turns HDR into displayable colour
      grade.append(
        el('div', 'cfg-label cfg-sub', 'Tone mapping'),
        segmented(Object.keys(TONE_MAPPER) as ToneMapper[], TONE_MAPPER, s.grade.toneMapper, (toneMapper) => {
          post.set('grade', { toneMapper })
          structural()
        }),
      )
      if (s.grade.enabled) {
        grade.append(
          el('div', 'cfg-label cfg-sub', 'Look'),
          segmented(Object.keys(LOOK_LABEL) as GradeLook[], LOOK_LABEL, s.grade.look, (look) => {
            const { contrast, saturation, temperature, split } = LOOKS[look]
            post.set('grade', { look, contrast, saturation, temperature, split })
            structural()
          }),
          slider('Exposure', s.grade.exposure, { min: -2, max: 2, step: 0.05 }, signed(2, ' EV'), (v) => post.set('grade', { exposure: v })),
          slider('Contrast', s.grade.contrast, { min: 0.6, max: 1.6, step: 0.01 }, fixed(2), (v) => post.set('grade', { contrast: v })),
          slider('Saturation', s.grade.saturation, { min: 0, max: 1.8, step: 0.01 }, fixed(2), (v) => post.set('grade', { saturation: v })),
          slider('Temperature', s.grade.temperature, { min: -1, max: 1, step: 0.01 }, signed(2), (v) => post.set('grade', { temperature: v })),
          slider('Split tone', s.grade.split, { min: 0, max: 1, step: 0.01 }, fixed(2), (v) => post.set('grade', { split: v })),
        )
      }
      body.append(grade)

      // ─── vignette ───────────────────────────────────────────────────────
      const vignette = section(
        'Vignette',
        toggle(s.vignette.enabled, 'vignette', (on) => {
          post.set('vignette', { enabled: on })
          structural()
        }),
      )
      if (s.vignette.enabled) {
        vignette.append(
          slider('Darkness', s.vignette.darkness, { min: 0, max: 1, step: 0.01 }, fixed(2), (v) => post.set('vignette', { darkness: v })),
          slider('Offset', s.vignette.offset, { min: 0, max: 1, step: 0.01 }, fixed(2), (v) => post.set('vignette', { offset: v })),
        )
      }
      body.append(vignette)

      // ─── atmosphere ─────────────────────────────────────────────────────
      const air = section(
        'Atmosphere',
        toggle(s.atmosphere.enabled, 'atmosphere', (on) => {
          post.set('atmosphere', { enabled: on })
          structural()
        }),
      )
      if (s.atmosphere.enabled) {
        air.append(
          slider('Strength', s.atmosphere.strength, { min: 0, max: 3, step: 0.05 }, fixed(2), (v) => post.set('atmosphere', { strength: v })),
        )
      }
      air.append(el('p', 'cfg-note', 'Open-air garages: distance haze, and sunlight shafts through the air where the sun gets in.'))
      body.append(air)

      body.append(
        actionButton('Reset graphics', () => {
          post.reset()
          structural()
        }),
      )
    },
  }
}
