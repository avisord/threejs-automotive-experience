import { GARAGES } from '../garages'
import type { Page } from './panel'
import { el } from './widgets'

export interface GarageState {
  /** garage the car is standing in */
  current(): string
  /** garage being switched to, if any */
  switching(): string | null
  select(id: string): void
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
    },
  }
}
