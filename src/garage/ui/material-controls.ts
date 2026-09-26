import {
  CATEGORY_LABEL,
  MATERIALS,
  colorsFor,
  materialsIn,
  type MaterialCategory,
  type MaterialChoice,
  type MaterialId,
} from '../materials'
import { colorField, segmented, slider } from './widgets'

/** what colour A / B mean for the materials that take two */
const COLOR_LABELS: Partial<Record<MaterialId, [a: string, b: string]>> = {
  stripes: ['Base', 'Stripes'],
  'two-tone': ['Lower', 'Upper'],
  camo: ['Light', 'Dark'],
  'forged-carbon': ['Flake', 'Resin'],
}

const SINGLE_LABEL: Partial<Record<MaterialCategory, string>> = {
  glass: 'Tint',
  light: 'Light colour',
}

/**
 * The material picker: a category row, the materials in that category, and
 * the colours that material takes. Shared by the car configurator and the
 * parts editor. `set` gets `structural = true` when the controls themselves
 * should change (re-render), false for continuous input like picker drags.
 */
export function materialControls(opts: {
  settings: MaterialChoice
  /** label for the Original entry — "Livery" on cars that wear one */
  originalLabel?: string
  set(patch: Partial<MaterialChoice>, structural: boolean): void
}): HTMLElement[] {
  const { settings: c, set } = opts
  const def = MATERIALS[c.material] ?? MATERIALS.original
  const out: HTMLElement[] = []

  const categories = Object.keys(CATEGORY_LABEL) as MaterialCategory[]
  const labels = { ...CATEGORY_LABEL, original: opts.originalLabel ?? CATEGORY_LABEL.original }
  out.push(
    segmented(categories, labels, def.category, (category) => {
      const first = materialsIn(category)[0]
      set({ material: first, ...colorsFor(first, c) }, true)
    }),
  )

  const siblings = materialsIn(def.category)
  if (siblings.length > 1) {
    const names = Object.fromEntries(siblings.map((id) => [id, MATERIALS[id].label])) as Record<MaterialId, string>
    out.push(
      segmented(siblings, names, c.material, (material) => set({ material, ...colorsFor(material, c) }, true)),
    )
  }

  if (def.style === 'factory') {
    // the factory texture can still be hue-shifted
    out.push(slider('Hue shift', c.hue, { min: 0, max: 360, step: 1 }, (v) => `${v}°`, (v) => set({ hue: v }, false)))
  }

  const pick = (key: 'colorA' | 'colorB') => (hex: string, commit: boolean) => set({ [key]: hex }, commit)
  const pair = COLOR_LABELS[c.material]
  if (def.colors >= 1) out.push(colorField(pair?.[0] ?? SINGLE_LABEL[def.category] ?? 'Colour', c.colorA, pick('colorA')))
  if (def.colors >= 2) out.push(colorField(pair?.[1] ?? 'Second colour', c.colorB, pick('colorB')))
  return out
}
