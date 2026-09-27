import { CARS, LICENCE_URL } from './garage/cars'

/** /credits.html: the car models' credits, straight from the profiles the garage loads */
const list = document.querySelector<HTMLUListElement>('#cars')!

function link(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = href
  a.textContent = text
  a.rel = 'noopener'
  return a
}

function line(...parts: (string | Node)[]): HTMLSpanElement {
  const span = document.createElement('span')
  span.append(...parts)
  return span
}

for (const car of CARS) {
  const c = car.credit
  if (!c) continue
  const item = document.createElement('li')
  const name = document.createElement('strong')
  name.textContent = `${car.make} ${car.model}`
  item.append(name, line('“', link(c.title, c.url), '”'), line('by ', link(c.author, c.authorUrl)))
  if (c.basedOn) item.append(line('based on a model by ', link(c.basedOn.author, c.basedOn.authorUrl)))
  const licence = link(c.licence, LICENCE_URL[c.licence])
  licence.className = 'licence'
  item.append(licence)
  list.append(item)
}
