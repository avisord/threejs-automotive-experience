import {
  BLOOM_THRESHOLD,
  LOOKS,
  matchingPreset,
  type AoMethod,
  type AoQuality,
  type AoView,
  type DofMode,
  type GradeLook,
  type Msaa,
  type PostProcessing,
  type QualityPreset,
  type Reflections,
  type Smaa,
  type SsrQuality,
  type SsrScope,
  type ToneMapper,
  type VolumetricQuality,
  type Wheel,
} from '../post'
import { WHITE_POINT_MODES } from '../tone-map-effect'
import { NEUTRAL_WHEEL } from '../colour-balance-effect'
import type { Page } from './panel'
import { actionButton, colourWheel, el, section, segmented, slider, toggle } from './widgets'

const AO_QUALITY: Record<AoQuality, string> = {
  Performance: 'Perf',
  Low: 'Low',
  Medium: 'Med',
  High: 'High',
  Ultra: 'Ultra',
}

const AO_VIEW: Record<AoView, string> = { final: 'Final', ao: 'AO only', split: 'Split' }

const AO_METHOD: Record<AoMethod, string> = { n8ao: 'N8AO', ssao: 'SSAO' }

const TONE_MAPPER: Record<ToneMapper, string> = {
  agx: 'AgX',
  aces: 'ACES',
  neutral: 'Neutral',
  filmic: 'Filmic',
  reinhard: 'Reinhard',
  cineon: 'Cineon',
  linear: 'Linear',
}

const TONE_NOTE: Record<ToneMapper, string> = {
  agx: 'AgX: soft, filmic highlights that bleach toward white; saturated colours lose some punch.',
  aces: 'ACES: the film-industry curve — contrasty, warm highlights, deep shadows.',
  neutral: 'Neutral (Khronos PBR): keeps colours as authored, only the brightest parts roll off.',
  filmic: 'Filmic (Hable): a gentle toe and a long shoulder, as in many games; the white point sets where it clips.',
  reinhard: 'Reinhard: the classic smooth compression, flat and bright; the white point is the HDR level shown as pure white.',
  cineon: 'Cineon: a film-scan look with lifted blacks and strong contrast.',
  linear: 'Linear: no curve, anything over white clips — for checking raw values.',
}

const SSR_SCOPE: Record<SsrScope, string> = { off: 'Off', car: 'Car', room: 'Car + room', all: 'Everything' }

const SSR_QUALITY: Record<SsrQuality, string> = { low: 'Low', medium: 'Medium', high: 'High' }

const LOOK_LABEL: Record<GradeLook, string> = {
  natural: 'Natural',
  daylight: 'Daylight',
  afternoon: 'Afternoon',
  golden: 'Golden hour',
  cyber: 'Cyber',
  warm: 'Warm',
  cold: 'Cold',
  noir: 'Noir',
}

const VOLUMETRIC_LABEL: Record<VolumetricQuality, string> = { low: 'Low', medium: 'Medium', high: 'High' }

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
    hint: 'Quality, anti-aliasing, AO, reflections, bloom, tone mapping, grade, lens & film',
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

      // ─── screen-space reflections ───────────────────────────────────────
      const ssr = section('Screen-space reflections')
      ssr.append(
        el('div', 'cfg-label cfg-sub', 'Reflecting surfaces'),
        segmented(Object.keys(SSR_SCOPE) as SsrScope[], SSR_SCOPE, s.ssr.scope, (scope) => {
          post.set('ssr', { scope })
          structural()
        }),
      )
      if (s.ssr.scope !== 'off') {
        ssr.append(
          el('div', 'cfg-label cfg-sub', 'Quality'),
          segmented(Object.keys(SSR_QUALITY) as SsrQuality[], SSR_QUALITY, s.ssr.quality, (quality) => {
            post.set('ssr', { quality })
            structural()
          }),
          slider('Strength', s.ssr.strength, { min: 0, max: 1.5, step: 0.05 }, fixed(2), (v) => post.set('ssr', { strength: v })),
          slider('Roughness cut-off', s.ssr.roughness, { min: 0.1, max: 1, step: 0.05 }, fixed(2), (v) => post.set('ssr', { roughness: v })),
          slider('Ray length', s.ssr.distance, { min: 2, max: 100, step: 1 }, fixed(0, ' m'), (v) => post.set('ssr', { distance: v })),
        )
      }
      ssr.append(
        el(
          'p',
          'cfg-note',
          'Glossy surfaces reflect what’s on screen — the car’s own wheels and mirrors in its paint, the room in its panels. What’s off screen keeps the environment reflection. “Everything” draws the whole scene once more: heavy in the open-air garages.',
        ),
      )
      body.append(ssr)

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
          el('div', 'cfg-label cfg-sub', 'Method'),
          segmented(Object.keys(AO_METHOD) as AoMethod[], AO_METHOD, s.ao.method, (method) => {
            post.set('ao', { method })
            structural()
          }),
        )
        if (s.ao.method === 'n8ao') {
          ao.append(
            slider('Intensity', s.ao.intensity, { min: 0.5, max: 8, step: 0.1 }, fixed(1), (v) => post.set('ao', { intensity: v })),
            slider('Radius', s.ao.radius, { min: 0.1, max: 2, step: 0.05 }, fixed(2, ' m'), (v) => post.set('ao', { radius: v })),
            slider('Falloff', s.ao.falloff, { min: 0.1, max: 3, step: 0.05 }, fixed(2), (v) => post.set('ao', { falloff: v })),
          )
        } else {
          ao.append(
            slider('Intensity', s.ao.ssaoIntensity, { min: 0, max: 4, step: 0.05 }, fixed(2), (v) => post.set('ao', { ssaoIntensity: v })),
            slider('Radius', s.ao.ssaoRadius, { min: 0.05, max: 2, step: 0.05 }, fixed(2, ' m'), (v) => post.set('ao', { ssaoRadius: v })),
            slider('Bias', s.ao.ssaoBias, { min: 0, max: 0.3, step: 0.01 }, fixed(2), (v) => post.set('ao', { ssaoBias: v })),
          )
        }
        ao.append(
          el('div', 'cfg-label cfg-sub', 'Quality'),
          segmented(Object.keys(AO_QUALITY) as AoQuality[], AO_QUALITY, s.ao.quality, (quality) => {
            post.set('ao', { quality })
            structural()
          }),
        )
        // (SSAO has no split view)
        const views = (Object.keys(AO_VIEW) as AoView[]).filter((v) => s.ao.method === 'n8ao' || v !== 'split')
        ao.append(
          el('div', 'cfg-label cfg-sub', 'Preview'),
          segmented(views, AO_VIEW, post.aoView === 'split' && s.ao.method === 'ssao' ? 'ao' : post.aoView, (view) => {
            post.aoView = view
            structural()
          }),
        )
        ao.append(
          el(
            'p',
            'cfg-note',
            s.ao.method === 'n8ao'
              ? 'N8AO: soft, physically scaled contact shade (radius in metres), rendered at half resolution.'
              : 'SSAO: the classic screen-space kind — an even contact shade within the radius (metres); bias keeps flat surfaces clean.',
          ),
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

      // ─── tone mapping ───────────────────────────────────────────────────
      // (always on — it's what turns HDR into displayable colour)
      const tone = section('Tone mapping')
      tone.append(
        segmented(Object.keys(TONE_MAPPER) as ToneMapper[], TONE_MAPPER, s.toneMapping.mode, (mode) => {
          post.set('toneMapping', { mode })
          structural()
        }),
      )
      if (WHITE_POINT_MODES.includes(s.toneMapping.mode)) {
        tone.append(
          slider('White point', s.toneMapping.whitePoint, { min: 1, max: 16, step: 0.1 }, fixed(1), (v) => post.set('toneMapping', { whitePoint: v })),
        )
      }
      tone.append(el('p', 'cfg-note', TONE_NOTE[s.toneMapping.mode]))
      body.append(tone)

      // ─── colour grade ───────────────────────────────────────────────────
      const grade = section(
        'Colour grade',
        toggle(s.grade.enabled, 'colour grade', (on) => {
          post.set('grade', { enabled: on })
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
          // (0: the exposure slider alone; 1: every view metered to the same brightness, the slider an offset)
          slider('Auto exposure', s.grade.auto, { min: 0, max: 1, step: 0.05 }, (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off'), (v) => post.set('grade', { auto: v })),
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

      // ─── colour balance ─────────────────────────────────────────────────
      const balance = section(
        'Colour balance',
        toggle(s.balance.enabled, 'colour balance', (on) => {
          post.set('balance', { enabled: on })
          structural()
        }),
      )
      if (s.balance.enabled) {
        const wheels = el('div', 'cfg-wheels')
        const wheel = (label: string, key: 'lift' | 'gamma' | 'gain') =>
          colourWheel(label, s.balance[key], (w: Wheel) => post.set('balance', { [key]: w }))
        wheels.append(wheel('Shadows', 'lift'), wheel('Mid-tones', 'gamma'), wheel('Highlights', 'gain'))
        balance.append(
          wheels,
          el('p', 'cfg-note', 'Push shadows, mid-tones and highlights toward a hue; the slider under each makes them brighter or darker. Double-click a wheel to centre it.'),
          actionButton('Reset wheels', () => {
            post.set('balance', { lift: { ...NEUTRAL_WHEEL }, gamma: { ...NEUTRAL_WHEEL }, gain: { ...NEUTRAL_WHEEL } })
            structural()
          }),
        )
      }
      body.append(balance)

      // ─── sharpening ─────────────────────────────────────────────────────
      const sharpen = section(
        'Sharpening',
        toggle(s.sharpen.enabled, 'sharpening', (on) => {
          post.set('sharpen', { enabled: on })
          structural()
        }),
      )
      if (s.sharpen.enabled) {
        sharpen.append(slider('Amount', s.sharpen.amount, { min: 0, max: 1, step: 0.01 }, fixed(2), (v) => post.set('sharpen', { amount: v })))
      }
      sharpen.append(el('p', 'cfg-note', 'Contrast-adaptive: crisper edges and texture without halos; brings back detail lost to anti-aliasing.'))
      body.append(sharpen)

      // ─── chromatic aberration ───────────────────────────────────────────
      const fringe = section(
        'Chromatic aberration',
        toggle(s.aberration.enabled, 'chromatic aberration', (on) => {
          post.set('aberration', { enabled: on })
          structural()
        }),
      )
      if (s.aberration.enabled) {
        fringe.append(
          slider('Strength', s.aberration.strength, { min: 0, max: 2, step: 0.01 }, fixed(2), (v) => post.set('aberration', { strength: v })),
        )
      }
      fringe.append(el('p', 'cfg-note', 'A real lens’s colour fringes: red and blue drift apart toward the frame’s edges.'))
      body.append(fringe)

      // ─── film grain ─────────────────────────────────────────────────────
      const grain = section(
        'Film grain',
        toggle(s.grain.enabled, 'film grain', (on) => {
          post.set('grain', { enabled: on })
          structural()
        }),
      )
      if (s.grain.enabled) {
        grain.append(
          slider('Amount', s.grain.amount, { min: 0, max: 1, step: 0.01 }, fixed(2), (v) => post.set('grain', { amount: v })),
          slider('Size', s.grain.size, { min: 1, max: 4, step: 0.1 }, fixed(1, ' px'), (v) => post.set('grain', { size: v })),
        )
      }
      grain.append(el('p', 'cfg-note', 'Strongest in the mid-tones, as on film; a new pattern each frame (still while the view rests).'))
      body.append(grain)

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
      air.append(el('p', 'cfg-note', 'Open-air garages: distance haze over the land, thinning with height.'))
      body.append(air)

      // ─── street lighting ────────────────────────────────────────────────
      const gi = section(
        'Street lighting',
        toggle(s.gi.probes, 'light probes', (on) => {
          post.set('gi', { probes: on })
          structural()
        }),
      )
      gi.append(
        el(
          'p',
          'cfg-note',
          s.gi.probes
            ? 'Light probes: the shade lit by the sunlit facades in their own colours and by the sky each point actually sees between the houses. Street garages (Calle Colonial).'
            : 'Off: the earlier estimate — one even bounce and a fixed share of the sky everywhere in the street.',
        ),
      )
      body.append(gi)

      // ─── volumetric light ───────────────────────────────────────────────
      const shafts = section(
        'Volumetric light',
        toggle(s.volumetric.enabled, 'volumetric light', (on) => {
          post.set('volumetric', { enabled: on })
          structural()
        }),
      )
      if (s.volumetric.enabled) {
        shafts.append(
          slider('Strength', s.volumetric.strength, { min: 0, max: 4, step: 0.05 }, fixed(2), (v) => post.set('volumetric', { strength: v })),
          el('div', 'cfg-label cfg-sub', 'Quality'),
          segmented(Object.keys(VOLUMETRIC_LABEL) as VolumetricQuality[], VOLUMETRIC_LABEL, s.volumetric.quality, (quality) => {
            post.set('volumetric', { quality })
            structural() // redraw the page so the picked option shows
          }),
        )
      }
      shafts.append(el('p', 'cfg-note', 'Open-air garages: sunbeams through the air where the sun gets in — through the skylight, past the columns.'))
      body.append(shafts)

      // ─── lens flare ─────────────────────────────────────────────────────
      const flare = section(
        'Lens flare',
        toggle(s.lensFlare.enabled, 'lens flare', (on) => {
          post.set('lensFlare', { enabled: on })
          structural()
        }),
      )
      if (s.lensFlare.enabled) {
        flare.append(
          slider('Intensity', s.lensFlare.intensity, { min: 0, max: 3, step: 0.05 }, fixed(2), (v) => post.set('lensFlare', { intensity: v })),
        )
      }
      flare.append(el('p', 'cfg-note', 'Glare, starburst and ghosts when the sun is in view; anything in front of it puts them out.'))
      body.append(flare)

      // ─── depth of field ─────────────────────────────────────────────────
      const lens = section('Depth of field')
      lens.append(
        segmented(['auto', 'on', 'off'] as DofMode[], { auto: 'Auto', on: 'On', off: 'Off' }, s.dof.mode, (mode) => {
          post.set('dof', { mode })
          structural()
        }),
      )
      if (post.dofActive) {
        lens.append(
          slider('Blur', s.dof.strength, { min: 0, max: 3, step: 0.05 }, fixed(2), (v) => post.set('dof', { strength: v })),
          slider('Sharp zone', s.dof.range, { min: 1, max: 20, step: 0.5 }, (v) => `${v.toFixed(1)} m`, (v) => post.set('dof', { range: v })),
        )
      }
      lens.append(el('p', 'cfg-note', 'Focus on the car, the view behind it a little soft, as a photographer would shoot it. Auto: on in garages shot that way (Coast House).'))
      body.append(lens)

      body.append(
        actionButton('Reset graphics', () => {
          post.reset()
          structural()
        }),
      )
    },
  }
}
