import { el } from './widgets'

export interface Nav {
  /** open a child page by id */
  open(id: string): void
  back(): void
  /** re-render the current page (after a structural change), keeping scroll */
  refresh(): void
}

export interface Page {
  title: string
  /** one-line description shown on menu rows that link here */
  hint?: string
  render(body: HTMLElement, nav: Nav): void
}

/** menu rows linking to other pages */
export function menuList(pages: Record<string, Page>, ids: string[], nav: Nav): HTMLElement {
  const list = el('nav', 'cfg-menu')
  for (const id of ids) {
    const row = el('button', 'cfg-menu-row')
    row.type = 'button'
    const text = el('span', 'cfg-menu-text')
    text.append(el('span', 'cfg-menu-title', pages[id].title))
    if (pages[id].hint) text.append(el('span', 'cfg-menu-hint', pages[id].hint))
    row.append(text, el('span', 'cfg-menu-chevron', '›'))
    row.addEventListener('click', () => nav.open(id))
    list.append(row)
  }
  return list
}

const PATH_KEY = 'garage.panel-path.v1'

/**
 * Side panel with page navigation: a stack of page ids under `rootId`, a
 * clickable breadcrumb (Menu › Settings › Graphics) and a back button. The
 * open path survives reloads.
 */
export function mountPanel(parent: HTMLElement, pages: Record<string, Page>, rootId: string): Nav {
  const panel = el('aside', 'cfg')
  const header = el('header', 'cfg-head')
  const backBtn = el('button', 'cfg-back', '‹')
  backBtn.type = 'button'
  backBtn.title = 'back'
  const crumbs = el('div', 'cfg-crumbs')
  const collapse = el('button', 'cfg-toggle', '–')
  collapse.type = 'button'
  collapse.title = 'collapse'
  header.append(backBtn, crumbs, collapse)
  const body = el('div', 'cfg-body')
  panel.append(header, body)
  parent.append(panel)

  let path: string[] = [rootId]
  try {
    const saved = JSON.parse(localStorage.getItem(PATH_KEY) ?? 'null') as string[] | null
    if (saved?.[0] === rootId && saved.every((id) => id in pages)) path = saved
  } catch {
    // default path
  }

  function go(next: string[]): void {
    const samePage = next.join('/') === path.join('/')
    path = next
    try {
      localStorage.setItem(PATH_KEY, JSON.stringify(path))
    } catch {
      // not persisted — fine
    }
    render(samePage)
  }

  const nav: Nav = {
    open: (id) => go([...path, id]),
    back: () => path.length > 1 && go(path.slice(0, -1)),
    refresh: () => render(true),
  }

  function render(keepScroll: boolean): void {
    const scroll = keepScroll ? body.scrollTop : 0
    backBtn.hidden = path.length === 1
    crumbs.replaceChildren()
    path.forEach((id, i) => {
      if (i > 0) crumbs.append(el('span', 'cfg-crumb-sep', '›'))
      const last = i === path.length - 1
      const crumb = el(last ? 'span' : 'button', last ? 'cfg-crumb is-current' : 'cfg-crumb', pages[id].title)
      if (!last) crumb.addEventListener('click', () => go(path.slice(0, i + 1)))
      crumbs.append(crumb)
    })
    body.replaceChildren()
    pages[path[path.length - 1]].render(body, nav)
    body.scrollTop = scroll
  }

  backBtn.addEventListener('click', nav.back)
  collapse.addEventListener('click', () => {
    const collapsed = panel.classList.toggle('is-collapsed')
    collapse.textContent = collapsed ? '+' : '–'
    collapse.title = collapsed ? 'expand' : 'collapse'
  })

  render(false)
  return nav
}
