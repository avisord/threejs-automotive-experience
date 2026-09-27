import type { Page } from './panel'
import { actionButton, el, section, segmented, slider, toggle } from './widgets'

export type PhotoAspect = '16:9' | '3:2' | '4:3' | '1:1' | '4:5' | '9:16' | '21:9'
/** the photo's long edge, px; 'screen' = the framing guide's size on this display */
export type PhotoSize = 'screen' | '1920' | '2560' | '3840'
export type PhotoFormat = 'png' | 'jpeg' | 'webp'

export interface PhotoSettings {
  aspect: PhotoAspect
  size: PhotoSize
  format: PhotoFormat
  /** JPEG / WebP quality, 0.5 … 1 */
  quality: number
  /** render at twice the size and scale down: smoother edges and fine detail */
  supersample: boolean
}

/** what the page needs from the app */
export interface PhotoCamera {
  /** where the framing guide sits on screen for an aspect (CSS px), or null while the view isn't free */
  guide(aspect: number): { x: number; y: number; width: number; height: number } | null
  /** shoot exactly what's inside the guide at this pixel size, without the UI */
  take(width: number, height: number, supersample: boolean, type: string, quality: number): Promise<Blob>
  /** a name for the file: car and garage */
  subject(): string
}

const KEY = 'garage.photo.v1'
const DEFAULTS: PhotoSettings = { aspect: '16:9', size: '2560', format: 'png', quality: 0.92, supersample: true }

const ASPECTS: PhotoAspect[] = ['16:9', '3:2', '4:3', '1:1', '4:5', '9:16', '21:9']
const ASPECT_LABEL = Object.fromEntries(ASPECTS.map((a) => [a, a])) as Record<PhotoAspect, string>
const SIZE_LABEL: Record<PhotoSize, string> = { screen: 'Screen', '1920': 'HD', '2560': 'QHD', '3840': '4K' }
const FORMAT_LABEL: Record<PhotoFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }
/**
 * Supersampling renders twice the size. The frame buffers (4× MSAA, half float, plus every effect's)
 * grow with it: 5K renders in ~0.1 s on an RX 7600, 8K took 2.4 s and then took the tab down.
 */
const MAX_SUPERSAMPLED = 2560

function ratio(a: PhotoAspect): number {
  const [w, h] = a.split(':').map(Number)
  return w / h
}

function load(): PhotoSettings {
  try {
    const saved = { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PhotoSettings> | null) }
    if (!(saved.size in SIZE_LABEL)) saved.size = DEFAULTS.size
    return saved
  } catch {
    return { ...DEFAULTS }
  }
}

/**
 * Menu › Capture › Photo — a still of the current view (orbit, walk or fly), without the panel.
 * While the page is open a guide frames the shot on screen; the photo is exactly what's inside it.
 */
export function photoPage(app: HTMLElement, camera: PhotoCamera): Page {
  const s = load()
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s))
    } catch {
      // not remembered — fine
    }
  }

  // the framing guide: a clear window, the rest of the view dimmed
  const frame = el('div', 'photo-guide')
  let showing = false
  const place = () => {
    const g = camera.guide(ratio(s.aspect))
    frame.hidden = !g
    if (!g) return
    frame.style.left = `${g.x}px`
    frame.style.top = `${g.y}px`
    frame.style.width = `${g.width}px`
    frame.style.height = `${g.height}px`
  }
  window.addEventListener('resize', () => showing && place())

  /** the photo's pixel size */
  function size(): { width: number; height: number } {
    const a = ratio(s.aspect)
    if (s.size === 'screen') {
      const g = camera.guide(a)
      const dpr = Math.min(window.devicePixelRatio, 2)
      return g ? { width: Math.round(g.width * dpr), height: Math.round(g.height * dpr) } : { width: 1920, height: 1080 }
    }
    const long = Number(s.size)
    return a >= 1 ? { width: long, height: Math.round(long / a) } : { width: Math.round(long * a), height: long }
  }
  const canSupersample = () => Math.max(size().width, size().height) <= MAX_SUPERSAMPLED

  let busy = false
  let last = ''
  async function shoot(nav: { refresh(): void }): Promise<void> {
    if (busy) return
    busy = true
    const { width, height } = size()
    const cover = el('div', 'rec is-export')
    cover.append(el('span', 'rec-label', `capturing ${width} × ${height}…`))
    app.append(cover)
    frame.hidden = true
    try {
      const type = `image/${s.format}`
      const blob = await camera.take(width, height, s.supersample && canSupersample(), type, s.quality)
      const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${camera.subject()}-${stamp}.${s.format === 'jpeg' ? 'jpg' : s.format}`
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
      last = `Saved ${a.download} — ${width} × ${height}, ${(blob.size / 1e6).toFixed(1)} MB`
    } catch (err) {
      console.error('[garage] photo failed', err)
      last = `Photo failed: ${(err as Error).message}`
    } finally {
      cover.remove()
      busy = false
      place()
      nav.refresh()
    }
  }

  return {
    title: 'Photo',
    hint: 'A still of the current view, PNG / JPEG / WebP up to 4K',
    render(body, nav) {
      if (!showing) {
        app.prepend(frame) // (first: the panel and HUD draw over its dimming)
        showing = true
      }
      place()
      const set = (patch: Partial<PhotoSettings>) => {
        Object.assign(s, patch)
        save()
        place()
        nav.refresh()
      }

      const shape = section('Frame')
      shape.append(
        el('div', 'cfg-label cfg-sub', 'Aspect ratio'),
        segmented(ASPECTS, ASPECT_LABEL, s.aspect, (aspect) => set({ aspect })),
        el('p', 'cfg-note', 'The bright window on the view is the photo. Orbit, walk or fly to compose it — scroll zooms the lens in walk and fly.'),
      )
      body.append(shape)

      const { width, height } = size()
      const out = section('Output')
      out.append(
        el('div', 'cfg-label cfg-sub', 'Size'),
        segmented(Object.keys(SIZE_LABEL) as PhotoSize[], SIZE_LABEL, s.size, (v) => set({ size: v })),
        el('p', 'cfg-note', `${width} × ${height} px`),
        el('div', 'cfg-label cfg-sub', 'Format'),
        segmented(Object.keys(FORMAT_LABEL) as PhotoFormat[], FORMAT_LABEL, s.format, (format) => set({ format })),
      )
      if (s.format !== 'png') {
        out.append(
          slider('Quality', s.quality, { min: 0.5, max: 1, step: 0.01 }, (v) => `${Math.round(v * 100)}%`, (v) => {
            s.quality = v
            save()
          }),
        )
      }
      const ss = el('div', 'cfg-part-head')
      ss.append(
        el('span', 'cfg-label', 'Supersample 2×'),
        toggle(s.supersample, 'supersample', (on) => set({ supersample: on })),
      )
      out.append(
        ss,
        el(
          'p',
          'cfg-note',
          canSupersample()
            ? 'Renders at twice the size and scales down: cleaner edges and fine detail, a little slower.'
            : 'Supersampling works up to QHD — 4K is rendered directly (twice 4K is more than a browser tab holds).',
        ),
      )
      body.append(out)

      body.append(actionButton(busy ? 'Capturing…' : 'Take photo', () => void shoot(nav)))
      if (last) body.append(el('p', 'cfg-note', last))
    },
    leave() {
      frame.remove()
      showing = false
    },
  }
}
