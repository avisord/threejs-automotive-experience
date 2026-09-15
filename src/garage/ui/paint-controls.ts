import type { Finish, PaintStyle } from '../paint'
import { colorField, el, segmented, slider } from './widgets'

export const STYLE_LABEL: Record<PaintStyle, string> = {
  factory: 'Factory',
  solid: 'Solid',
  stripes: 'Stripes',
  'two-tone': 'Two-tone',
  carbon: 'Carbon',
  camo: 'Camo',
  glow: 'Glow',
}

export const FINISH_LABEL: Record<Finish, string> = {
  factory: 'Factory',
  gloss: 'Gloss',
  metallic: 'Metallic',
  satin: 'Satin',
  matte: 'Matte',
  chrome: 'Chrome',
}

/** what colour A / B mean for each style; styles missing here use one colour only */
const COLOR_B_LABEL: Partial<Record<PaintStyle, [a: string, b: string]>> = {
  stripes: ['Base', 'Stripes'],
  'two-tone': ['Lower', 'Upper'],
  camo: ['Light', 'Dark'],
}

export interface PaintControlSettings {
  style: PaintStyle
  colorA: string
  colorB: string
  hue: number
  finish: Finish
}

/**
 * Style + colour(s) + finish controls shared by the car configurator and the
 * parts editor. `set` gets `structural = true` when the controls shown should
 * change (re-render), false for continuous input (picker drags, sliders).
 */
export function paintControls(opts: {
  settings: PaintControlSettings
  styles: readonly PaintStyle[]
  factoryLabel?: string
  set(patch: Partial<PaintControlSettings>, structural: boolean): void
}): HTMLElement[] {
  const { settings: c, styles, set } = opts
  const out: HTMLElement[] = []
  const labels = { ...STYLE_LABEL, factory: opts.factoryLabel ?? 'Factory' }
  out.push(segmented(styles, labels, c.style, (style) => set({ style }, true)))

  if (c.style === 'factory') {
    // the factory texture can still be hue-shifted
    out.push(slider('Hue shift', c.hue, { min: 0, max: 360, step: 1 }, (v) => `${v}°`, (v) => set({ hue: v }, false)))
  } else {
    const names = COLOR_B_LABEL[c.style]
    const pick = (key: 'colorA' | 'colorB') => (hex: string, commit: boolean) => set({ [key]: hex }, commit)
    out.push(colorField(names?.[0] ?? (c.style === 'glow' ? 'Light colour' : 'Colour'), c.colorA, pick('colorA')))
    if (names) out.push(colorField(names[1], c.colorB, pick('colorB')))
  }

  out.push(el('div', 'cfg-label cfg-sub', 'Finish'))
  out.push(segmented(Object.keys(FINISH_LABEL) as Finish[], FINISH_LABEL, c.finish, (finish) => set({ finish }, true)))
  return out
}
