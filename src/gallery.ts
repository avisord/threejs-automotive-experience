// Gallery lightbox: the grid links straight to the full-size images, so it works without
// JS; with it, a click opens the shot over the page with prev/next (arrows, swipe) and Esc.
const links = [...document.querySelectorAll<HTMLAnchorElement>('.grid a')]
const box = document.querySelector<HTMLElement>('.lightbox')!
const img = box.querySelector('img')!
const caption = box.querySelector('figcaption')!
let current = -1

function show(i: number) {
  current = (i + links.length) % links.length
  const link = links[current]
  const alt = link.querySelector('img')?.alt ?? ''
  img.src = link.href
  img.alt = alt
  caption.textContent = `${alt} — ${current + 1} / ${links.length}`
  // warm the neighbours so stepping through doesn't wait on the network
  for (const d of [1, -1]) new Image().src = links[(current + d + links.length) % links.length].href
  if (box.hidden) {
    box.hidden = false
    box.classList.add('open')
    document.body.style.overflow = 'hidden'
  }
}

function close() {
  box.hidden = true
  box.classList.remove('open')
  document.body.style.overflow = ''
  links[current]?.focus()
  current = -1
}

links.forEach((link, i) =>
  link.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
    e.preventDefault()
    show(i)
  }),
)

box.querySelector('.close')!.addEventListener('click', close)
box.querySelector('.prev')!.addEventListener('click', () => show(current - 1))
box.querySelector('.next')!.addEventListener('click', () => show(current + 1))
box.addEventListener('click', (e) => {
  if (e.target === box) close()
})

addEventListener('keydown', (e) => {
  if (current < 0) return
  if (e.key === 'Escape') close()
  else if (e.key === 'ArrowRight') show(current + 1)
  else if (e.key === 'ArrowLeft') show(current - 1)
})

let touchX: number | null = null
box.addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true })
box.addEventListener('touchend', (e) => {
  if (touchX === null) return
  const dx = e.changedTouches[0].clientX - touchX
  touchX = null
  if (Math.abs(dx) > 50) show(current + (dx < 0 ? 1 : -1))
})
