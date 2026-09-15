import { BLOOM_THRESHOLD, LOOKS, type AoQuality, type AoView, type GradeLook, type PostProcessing, type ToneMapper } from '../post'
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
  cyber: 'Cyber',
  warm: 'Warm',
  cold: 'Cold',
  noir: 'Noir',
}

const fixed = (digits: number, unit = '') => (v: number) => `${v.toFixed(digits)}${unit}`
const signed = (digits: number, unit = '') => (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`

/** Menu › Settings › Graphics — post-processing controls */
export function graphicsPage(post: PostProcessing): Page {
  const s = post.settings

  return {
    title: 'Graphics',
    hint: 'Ambient occlusion, bloom, colour grade, vignette',
    render(body, nav) {
      // toggles and mode switches rebuild the effect chain, so re-render to show/hide controls
      const structural = () => nav.refresh()

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

      body.append(
        actionButton('Reset graphics', () => {
          post.reset()
          structural()
        }),
      )
    },
  }
}
