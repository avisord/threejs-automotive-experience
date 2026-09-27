/** Small DOM builders shared by the panel pages. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function button(className: string, text?: string): HTMLButtonElement {
  const b = el('button', className, text)
  b.type = 'button'
  return b
}

/** row of mutually exclusive buttons */
export function segmented<T extends string>(
  options: readonly T[],
  labels: Record<T, string>,
  active: T,
  onPick: (value: T) => void,
): HTMLDivElement {
  const row = el('div', 'cfg-seg')
  for (const value of options) {
    const b = button(value === active ? 'is-active' : '', labels[value])
    b.addEventListener('click', () => onPick(value))
    row.append(b)
  }
  return row
}

const SWATCHES = [
  '#f4f5f7',
  '#b0b5bd',
  '#15171b',
  '#c8102e',
  '#ff5a1f',
  '#ffd400',
  '#2bd67b',
  '#1e6bff',
  '#35e0ff',
  '#8e5cff',
  '#ff3fa4',
  '#c9a227',
]

/** swatch row + native picker; `commit` is false while the picker is being dragged */
export function colorField(label: string, value: string, onChange: (hex: string, commit: boolean) => void): HTMLDivElement {
  const field = el('div', 'cfg-color')
  const head = el('div', 'cfg-label')
  head.append(el('span', '', label))
  const picker = el('input')
  picker.type = 'color'
  picker.value = value
  picker.addEventListener('input', () => onChange(picker.value, false))
  picker.addEventListener('change', () => onChange(picker.value, true))
  head.append(picker)
  field.append(head)

  const swatches = el('div', 'cfg-swatches')
  for (const hex of SWATCHES) {
    const swatch = button(hex === value.toLowerCase() ? 'is-active' : '')
    swatch.style.setProperty('--swatch', hex)
    swatch.title = hex
    swatch.addEventListener('click', () => onChange(hex, true))
    swatches.append(swatch)
  }
  field.append(swatches)
  return field
}

export function slider(
  label: string,
  value: number,
  range: { min: number; max: number; step: number },
  format: (v: number) => string,
  onInput: (v: number) => void,
): HTMLLabelElement {
  const row = el('label', 'cfg-slider')
  const head = el('div', 'cfg-label')
  const readout = el('span', 'cfg-readout', format(value))
  head.append(el('span', '', label), readout)
  const input = el('input')
  input.type = 'range'
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step)
  input.value = String(value)
  input.addEventListener('input', () => {
    const v = Number(input.value)
    readout.textContent = format(v)
    onInput(v)
  })
  row.append(head, input)
  return row
}

/** on/off switch */
export function toggle(on: boolean, label: string, onChange: (on: boolean) => void): HTMLButtonElement {
  const b = button(`cfg-switch${on ? ' is-on' : ''}`)
  b.setAttribute('role', 'switch')
  b.setAttribute('aria-checked', String(on))
  b.setAttribute('aria-label', label)
  b.addEventListener('click', () => onChange(!on))
  return b
}

/** titled block; pass a switch to put it in the title row */
export function section(title: string, control?: HTMLElement): HTMLElement {
  const s = el('section', 'cfg-part')
  const head = el('div', 'cfg-part-head')
  head.append(el('h3', '', title))
  if (control) head.append(control)
  s.append(head)
  return s
}

export function actionButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = button('cfg-reset', text)
  b.addEventListener('click', onClick)
  return b
}

/**
 * A colourist's wheel: drag the dot toward a hue (0° red, 120° green, 240° blue, counter-clockwise
 * from the right), the slider under it for brighter or darker; double-click the wheel to centre it.
 */
export function colourWheel(
  label: string,
  value: { x: number; y: number; l: number },
  onInput: (v: { x: number; y: number; l: number }) => void,
): HTMLDivElement {
  const v = { ...value }
  const box = el('div', 'cfg-wheel')
  box.append(el('div', 'cfg-label', label))
  const disc = el('div', 'cfg-wheel-disc')
  const dot = el('div', 'cfg-wheel-dot')
  disc.append(dot)
  const place = () => {
    dot.style.left = `${50 + v.x * 50}%`
    dot.style.top = `${50 - v.y * 50}%`
  }
  place()
  const pick = (e: PointerEvent) => {
    const r = disc.getBoundingClientRect()
    let x = ((e.clientX - r.left) / r.width) * 2 - 1
    let y = 1 - ((e.clientY - r.top) / r.height) * 2
    const len = Math.hypot(x, y)
    if (len > 1) {
      x /= len
      y /= len
    }
    v.x = x
    v.y = y
    place()
    onInput({ ...v })
  }
  disc.addEventListener('pointerdown', (e) => {
    disc.setPointerCapture(e.pointerId)
    pick(e)
  })
  disc.addEventListener('pointermove', (e) => {
    if (disc.hasPointerCapture(e.pointerId)) pick(e)
  })
  disc.addEventListener('dblclick', () => {
    v.x = v.y = 0
    place()
    onInput({ ...v })
  })
  const level = el('input')
  level.type = 'range'
  level.min = '-1'
  level.max = '1'
  level.step = '0.01'
  level.value = String(v.l)
  level.title = 'darker … brighter'
  level.addEventListener('input', () => {
    v.l = Number(level.value)
    onInput({ ...v })
  })
  box.append(disc, level)
  return box
}
