import { GARAGES } from '../garages'
import { SUN_LIMITS, type SunPosition } from '../garages/sky'
import type { Page } from './panel'
import { el, section, segmented, slider } from './widgets'

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
    },
  }
}
