import { CARS, NO_CAR, type CarProfile } from '../cars'
import type { Page } from './panel'
import { el } from './widgets'

export interface CollectionState {
  /** car currently in the bay */
  current(): string | null
  /** car being loaded, if any */
  loading(): string | null
  select(id: string): void
  /** the user's own models */
  uploads(): CarProfile[]
}

/** Menu › Collection — one card per car; picking one swaps the car in the bay */
export function collectionPage(state: CollectionState): Page {
  return {
    title: 'Collection',
    hint: `Choose a car · ${CARS.length} in the collection`,
    render(body, nav) {
      const grid = el('div', 'cfg-cars')

      // an empty bay: the garage on its own, for its lighting and scenery
      const empty = state.current() === NO_CAR
      const none = el('button', `cfg-car cfg-car-none${empty ? ' is-active' : ''}`)
      none.type = 'button'
      none.append(
        el('span', 'cfg-car-make', 'No car'),
        el('span', 'cfg-car-model', 'Empty bay'),
        el('span', 'cfg-car-tag', 'Just the garage — its light, floor and walls'),
      )
      if (empty) none.append(el('span', 'cfg-car-badge', 'In the bay'))
      none.addEventListener('click', () => {
        if (empty) return
        state.select(NO_CAR)
        nav.refresh()
      })
      grid.append(none)

      // bring your own: opens Menu › Collection › Upload
      const add = el('button', 'cfg-car cfg-car-add')
      add.type = 'button'
      add.append(
        el('span', 'cfg-car-make', 'Upload'),
        el('span', 'cfg-car-model', 'Your own model'),
        el('span', 'cfg-car-tag', 'A car or bike: glb, gltf, fbx, obj, dae, 3ds, usdz or zip'),
      )
      add.addEventListener('click', () => nav.open('upload'))
      grid.append(add)

      for (const car of [...state.uploads(), ...CARS]) {
        const active = state.current() === car.id
        const loading = state.loading() === car.id
        const card = el('button', `cfg-car${active ? ' is-active' : ''}${loading ? ' is-loading' : ''}`)
        card.type = 'button'
        card.append(
          el('span', 'cfg-car-make', car.year ? `${car.make} · ${car.year}` : car.make),
          el('span', 'cfg-car-model', car.model),
          el('span', 'cfg-car-tag', car.tag),
        )
        if (active || loading) card.append(el('span', 'cfg-car-badge', loading ? 'Loading…' : 'In the bay'))
        if (car.credit) {
          // (a link can't sit inside the card's button: a span that opens the model's page)
          const { author, licence, url, title } = car.credit
          const credit = el('span', 'cfg-car-credit is-link', `${author} · ${licence}`)
          credit.title = `“${title}” on Sketchfab`
          credit.addEventListener('click', (e) => {
            e.stopPropagation()
            window.open(url, '_blank', 'noopener')
          })
          card.append(credit)
        }
        card.addEventListener('click', () => {
          if (active || loading) return
          state.select(car.id)
          nav.refresh()
        })
        grid.append(card)
      }
      body.append(grid)
      const credits = el('p', 'cfg-note')
      const link = el('a', '', 'Model credits and licences')
      link.href = '/credits.html'
      link.target = '_blank'
      credits.append(link)
      body.append(credits)
    },
  }
}
