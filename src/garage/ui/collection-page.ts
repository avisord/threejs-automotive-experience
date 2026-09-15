import { CARS } from '../cars'
import type { Page } from './panel'
import { el } from './widgets'

export interface CollectionState {
  /** car currently in the bay */
  current(): string | null
  /** car being loaded, if any */
  loading(): string | null
  select(id: string): void
}

/** Menu › Collection — one card per car; picking one swaps the car in the bay */
export function collectionPage(state: CollectionState): Page {
  return {
    title: 'Collection',
    hint: `Choose a car · ${CARS.length} in the collection`,
    render(body, nav) {
      const grid = el('div', 'cfg-cars')
      for (const car of CARS) {
        const active = state.current() === car.id
        const loading = state.loading() === car.id
        const card = el('button', `cfg-car${active ? ' is-active' : ''}${loading ? ' is-loading' : ''}`)
        card.type = 'button'
        card.append(
          el('span', 'cfg-car-make', `${car.make} · ${car.year}`),
          el('span', 'cfg-car-model', car.model),
          el('span', 'cfg-car-tag', car.tag),
        )
        if (active || loading) card.append(el('span', 'cfg-car-badge', loading ? 'Loading…' : 'In the bay'))
        if (car.credit) card.append(el('span', 'cfg-car-credit', car.credit))
        card.addEventListener('click', () => {
          if (active || loading) return
          state.select(car.id)
          nav.refresh()
        })
        grid.append(card)
      }
      body.append(grid)
    },
  }
}
