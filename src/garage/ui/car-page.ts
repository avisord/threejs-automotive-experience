import type { Finish, PaintStyle } from '../paint'
import { PART_DEFS, PRESETS, presetConfig, type CarConfigurator, type PartDef } from '../configurator'
import type { Nav, Page } from './panel'
import { actionButton, colorField, el, section, segmented, slider } from './widgets'

const STYLE_LABEL: Record<PaintStyle, string> = {
  factory: 'Factory',
  solid: 'Solid',
  stripes: 'Stripes',
  'two-tone': 'Two-tone',
  carbon: 'Carbon',
  camo: 'Camo',
}

const FINISH_LABEL: Record<Finish, string> = {
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

/**
 * Paint, wheels and glass. Structural changes (style, finish, presets)
 * re-render the page; pickers and sliders only update the car so the control
 * under the pointer keeps its drag.
 */
export function carPage(current: () => CarConfigurator | undefined): Page {
  let activePreset: string | null = null
  let lastCar: string | null = null

  function partSection(configurator: CarConfigurator, def: PartDef, nav: Nav): HTMLElement {
    const c = configurator.config[def.id]
    const s = section(def.label)

    if (def.id === 'glass') {
      s.append(
        slider('Tint', c.tint, { min: 0, max: 1, step: 0.01 }, (v) => (v === 0 ? 'factory' : `${Math.round(v * 100)}%`), (v) => {
          activePreset = null
          configurator.set('glass', { tint: v })
        }),
      )
      return s
    }

    const livery = configurator.profile.livery && (def.id === 'body' || def.id === 'wing')
    const labels = { ...STYLE_LABEL, factory: livery ? 'Livery' : 'Factory' }
    s.append(
      segmented(def.styles, labels, c.style, (style) => {
        activePreset = null
        configurator.set(def.id, { style })
        nav.refresh()
      }),
    )

    if (c.style === 'factory') {
      // the livery / factory texture can still be hue-shifted
      s.append(
        slider('Hue shift', c.hue, { min: 0, max: 360, step: 1 }, (v) => `${v}°`, (v) => {
          activePreset = null
          configurator.set(def.id, { hue: v })
        }),
      )
    } else {
      const names = COLOR_B_LABEL[c.style]
      const pick = (key: 'colorA' | 'colorB') => (hex: string, commit: boolean) => {
        activePreset = null
        configurator.set(def.id, { [key]: hex })
        if (commit) nav.refresh()
      }
      s.append(colorField(names?.[0] ?? 'Colour', c.colorA, pick('colorA')))
      if (names) s.append(colorField(names[1], c.colorB, pick('colorB')))
    }

    s.append(el('div', 'cfg-label cfg-sub', 'Finish'))
    s.append(
      segmented(Object.keys(FINISH_LABEL) as Finish[], FINISH_LABEL, c.finish, (finish) => {
        activePreset = null
        configurator.set(def.id, { finish })
        nav.refresh()
      }),
    )
    return s
  }

  return {
    title: 'Car',
    hint: 'Paint, livery, wheels, glass',
    render(body, nav) {
      const configurator = current()
      if (!configurator) {
        body.append(el('p', 'cfg-empty', 'Loading car…'))
        return
      }
      if (configurator.profile.id !== lastCar) {
        lastCar = configurator.profile.id
        activePreset = null
      }

      const presets = section('Presets')
      const chips = el('div', 'cfg-chips')
      for (const name of Object.keys(PRESETS)) {
        const chip = el('button', name === activePreset ? 'is-active' : '', name)
        chip.type = 'button'
        chip.addEventListener('click', () => {
          activePreset = name
          configurator.load(presetConfig(name))
          nav.refresh()
        })
        chips.append(chip)
      }
      presets.append(chips)
      body.append(presets)

      for (const def of PART_DEFS) {
        if (configurator.parts.includes(def.id)) body.append(partSection(configurator, def, nav))
      }

      body.append(
        actionButton('Reset to factory', () => {
          activePreset = 'Factory'
          configurator.load(presetConfig('Factory'))
          nav.refresh()
        }),
      )
    },
  }
}
