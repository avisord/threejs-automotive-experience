import { PART_DEFS, PRESETS, presetConfig, type CarConfigurator, type PartDef } from '../configurator'
import type { Nav, Page } from './panel'
import { materialControls } from './material-controls'
import { actionButton, el, section, slider } from './widgets'

/**
 * Paint, wheels and glass. Structural changes (style, finish, presets)
 * re-render the page; pickers and sliders only update the car so the control
 * under the pointer keeps its drag.
 */
export function carPage(current: () => CarConfigurator | undefined, placeholder: () => string = () => 'Loading car…'): Page {
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
    s.append(
      ...materialControls({
        settings: c,
        originalLabel: livery ? 'Livery' : 'Original',
        set(patch, structural) {
          activePreset = null
          configurator.set(def.id, patch)
          if (structural) nav.refresh()
        },
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
        body.append(el('p', 'cfg-empty', placeholder()))
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
