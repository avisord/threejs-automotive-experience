import { PART_DEFS, PRESETS, presetConfig, type CarConfigurator, type PartDef } from '../configurator'
import type { Nav, Page } from './panel'
import { materialControls } from './material-controls'
import type { CarPlacement } from '../placement'
import { actionButton, el, section, slider, toggle } from './widgets'

/**
 * Paint, wheels and glass. Structural changes (style, finish, presets)
 * re-render the page; pickers and sliders only update the car so the control
 * under the pointer keeps its drag.
 */
export function carPage(
  current: () => CarConfigurator | undefined,
  placeholder: () => string = () => 'Loading car…',
  placement?: CarPlacement,
): Page {
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

  /** where the car stands: a gizmo on the car to drag it along x / y / z, and a way back */
  function positionSection(placement: CarPlacement, nav: Nav): HTMLElement {
    const s = section(
      'Position',
      toggle(placement.active, 'Move the car', (on) => {
        placement.setActive(on)
        nav.refresh()
      }),
    )
    const p = placement.position!
    const at = `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} · z ${p.z.toFixed(2)} m`
    s.append(el('p', 'cfg-note', placement.active ? `Drag the arrows on the car. ${at}` : at))
    if (p.lengthSq() > 1e-6)
      s.append(
        actionButton('Reset position', () => {
          placement.reset()
          nav.refresh()
        }),
      )
    return s
  }

  return {
    title: 'Car',
    leave() {
      placement?.setActive(false) // the gizmo belongs to this page
    },
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

      if (placement?.position) body.append(positionSection(placement, nav))

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
