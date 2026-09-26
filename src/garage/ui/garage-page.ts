import { GARAGES } from '../garages'
import { KELVIN, type InteriorLights, type InteriorSettings, kelvinToRGB } from '../garages/interior'
import { SUN_LIMITS, type SunPosition } from '../garages/sky'
import type { Page } from './panel'
import { actionButton, colorField, el, section, segmented, slider, toggle } from './widgets'

const SUN_PRESETS = {
  morning: { azimuth: 70, elevation: 22 },
  noon: { azimuth: -20, elevation: 68 },
  golden: { azimuth: -115, elevation: 9 },
  sunset: { azimuth: -150, elevation: 3 },
} satisfies Record<string, SunPosition>
type SunPreset = keyof typeof SUN_PRESETS
const SUN_PRESET_LABEL: Record<SunPreset, string> = { morning: 'Morning', noon: 'Noon', golden: 'Golden hour', sunset: 'Sunset' }

/** where the sun is, in words, relative to the car */
function bearing(azimuth: number): string {
  const names = ['in front', 'front left', 'left', 'behind left', 'behind', 'behind right', 'right', 'front right']
  const a = (((azimuth % 360) + 360 + 22.5) % 360) / 45
  return `${Math.round(azimuth)}° · ${names[Math.floor(a)]}`
}

export interface GarageState {
  /** garage the car is standing in */
  current(): string
  /** garage being switched to, if any */
  switching(): string | null
  select(id: string): void
  /** the current garage's sun, if it has one the user can move */
  sun(): SunPosition | null
  setSun(sun: SunPosition): void
  /** the current garage's own lights, if it has any the user can set */
  interior(): { groups: InteriorLights['groups']; settings: InteriorSettings; defaults: InteriorSettings } | null
  setInterior(settings: InteriorSettings): void
}

/** a colour temperature in words, with a swatch of it */
function warmth(kelvin: number): string {
  const name = kelvin < 2900 ? 'candle warm' : kelvin < 3600 ? 'warm white' : kelvin < 4600 ? 'neutral' : kelvin < 5800 ? 'daylight' : 'cool'
  return `${Math.round(kelvin / 50) * 50} K · ${name}`
}

/** Menu › Garage — one card per garage; each is a whole scene with its own lighting */
export function garagePage(state: GarageState): Page {
  return {
    title: 'Garage',
    hint: `Choose where the car stands · ${GARAGES.length} garages`,
    render(body, nav) {
      const grid = el('div', 'cfg-cars')
      for (const garage of GARAGES) {
        const active = state.current() === garage.id
        const switching = state.switching() === garage.id
        const card = el('button', `cfg-car cfg-garage${active ? ' is-active' : ''}${switching ? ' is-loading' : ''}`)
        card.type = 'button'
        const palette = el('span', 'cfg-garage-palette')
        palette.style.setProperty('--palette', `linear-gradient(90deg, ${garage.palette.join(', ')})`)
        card.append(
          palette,
          el('span', 'cfg-car-model', garage.name),
          el('span', 'cfg-car-tag', garage.tag),
          el('span', 'cfg-car-credit', `${garage.look} grade`),
        )
        if (active || switching) card.append(el('span', 'cfg-car-badge', switching ? 'Opening…' : "You're here"))
        card.addEventListener('click', () => {
          if (active || switching) return
          state.select(garage.id)
          nav.refresh()
        })
        grid.append(card)
      }
      body.append(
        grid,
        el('p', 'cfg-note cfg-gap', 'Each garage sets its own colour grade look when picked — fine-tune it in Settings › Graphics.'),
      )

      // open-air garages: put the sun anywhere
      const sun = state.sun()
      if (sun) {
        const s = section('Sun')
        const match = (Object.keys(SUN_PRESETS) as SunPreset[]).find(
          (k) => SUN_PRESETS[k].azimuth === sun.azimuth && SUN_PRESETS[k].elevation === sun.elevation,
        )
        s.append(
          segmented(Object.keys(SUN_PRESETS) as SunPreset[], SUN_PRESET_LABEL, match ?? ('' as SunPreset), (k) => {
            state.setSun({ ...SUN_PRESETS[k] })
            nav.refresh()
          }),
          slider('Direction', sun.azimuth, { min: -180, max: 180, step: 1 }, bearing, (v) => {
            sun.azimuth = v
            state.setSun({ ...sun })
          }),
          slider('Height', sun.elevation, { min: SUN_LIMITS.elevation.min, max: SUN_LIMITS.elevation.max, step: 0.5 }, (v) => `${v.toFixed(1)}°`, (v) => {
            sun.elevation = v
            state.setSun({ ...sun })
          }),
          el('p', 'cfg-note', 'A low sun turns the sky and the light golden and stretches the shadows. Saved per garage.'),
        )
        body.append(s)
      }

      // the garage's own light fittings: switch, dim and warm each group
      const interior = state.interior()
      if (interior) {
        const settings = interior.settings
        const apply = () => state.setInterior(structuredClone(settings))
        const s = section('Interior lights')
        s.append(
          slider('All lights', settings.master, { min: 0, max: 2, step: 0.05 }, (v) => `${Math.round(v * 100)}%`, (v) => {
            settings.master = v
            apply()
          }),
        )
        body.append(s)
        for (const group of interior.groups) {
          const g = settings.groups[group.id]
          const sw = toggle(g.on, group.name, (on) => {
            g.on = on
            apply()
            nav.refresh()
          })
          const block = section(group.name, sw)
          // white light is set by its warmth; coloured light (neon, accents) by any colour
          let tint: HTMLElement
          if (group.tint === 'kelvin') {
            const kelvin = g.kelvin ?? 5000
            const swatch = el('span', 'cfg-kelvin')
            const paint = (k: number) => swatch.style.setProperty('--swatch', `#${kelvinToRGB(k).getHexString()}`)
            paint(kelvin)
            tint = slider('Warmth', kelvin, { min: KELVIN.min, max: KELVIN.max, step: 50 }, warmth, (v) => {
              g.kelvin = v
              paint(v)
              apply()
            })
            tint.querySelector('.cfg-label span')?.prepend(swatch)
          } else {
            tint = colorField('Colour', g.color ?? '#ffffff', (hex, commit) => {
              g.color = hex
              apply()
              if (commit) nav.refresh()
            })
          }
          block.append(
            el('p', 'cfg-note', group.hint),
            slider('Intensity', g.intensity, { min: 0, max: 3, step: 0.05 }, (v) => `${Math.round(v * 100)}%`, (v) => {
              g.intensity = v
              apply()
            }),
            tint,
          )
          if (!g.on) block.classList.add('is-off')
          body.append(block)
        }
        body.append(
          actionButton('Reset interior lights', () => {
            state.setInterior(interior.defaults)
            nav.refresh()
          }),
          el('p', 'cfg-note', 'Saved per garage. The car’s reflections catch up a moment after you stop dragging.'),
        )
      }
    },
  }
}
