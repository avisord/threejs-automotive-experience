import { PART_DEFS, PRESETS, presetConfig, type CarConfigurator, type PartDef } from '../configurator'
import type { Nav, Page } from './panel'
import { materialControls } from './material-controls'
import type { CarPlacement } from '../placement'
import { actionButton, el, section, segmented, slider, toggle } from './widgets'

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
    const deg = Math.round((placement.heading * 180) / Math.PI)
    const at = `x ${p.x.toFixed(2)} · y ${p.y.toFixed(2)} · z ${p.z.toFixed(2)} m · facing ${deg}°`
    if (placement.active) {
      s.append(
        segmented(['move', 'turn'] as const, { move: 'Move', turn: 'Turn' }, placement.mode, (m) => {
          placement.setMode(m)
          nav.refresh()
        }),
      )
    }
    s.append(
      el('p', 'cfg-note', placement.active ? `${placement.mode === 'move' ? 'Drag the arrows' : 'Drag the ring'} on the car. ${at}` : at),
    )
    // which way it faces: a slider (release to apply — the lamps' shadows re-bake) and quarter turns
    const heading = slider('Facing', deg, { min: -180, max: 180, step: 1 }, (v) => `${v}°`, () => {})
    const input = heading.querySelector('input')!
    input.addEventListener('change', () => {
      placement.setHeading((Number(input.value) * Math.PI) / 180)
      nav.refresh()
    })
    s.append(heading)
    const turns = el('div', 'cfg-actions')
    const turnBy = (d: number) => () => {
      placement.setHeading(placement.heading + (d * Math.PI) / 180)
      nav.refresh()
    }
    for (const [label, d] of [['⟲ 90°', 90], ['⟳ 90°', -90], ['↻ 180°', 180]] as const) {
      const b = el('button', 'cfg-mini', label)
      b.type = 'button'
      b.addEventListener('click', turnBy(d))
      turns.append(b)
    }
    s.append(turns)
    if (p.lengthSq() > 1e-6 || Math.abs(placement.heading) > 1e-4)
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
      // an upload has no parts set up yet: paint it through Menu › Parts' groups
      if (configurator.parts.length === 0) {
        body.append(
          el('p', 'cfg-note cfg-gap', 'No paintable parts yet — say which meshes are body, wheels, glass… in Part roles, or group and paint meshes freely in Menu › Parts.'),
          actionButton('Set up part roles ›', () => nav.open('roles')),
        )
        return
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
