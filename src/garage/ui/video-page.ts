import { track } from '../../analytics'
import { CAMERA_MOVES, moveById } from '../camera-moves'
import {
  QUALITIES,
  RESOLUTIONS,
  exportVideo,
  formatTime,
  preview,
  reelDuration,
  type Progress,
  type Reel,
  type Resolution,
  type Stage,
  type VideoQuality,
  videoBitrate,
} from '../director'
import { GARAGES } from '../garages'
import type { Nav, Page } from './panel'
import { el, section, segmented, slider } from './widgets'

const REEL_KEY = 'garage.reel.v1'
const RES_LABEL: Record<Resolution, string> = { '720': '720p', '1080': '1080p', '1440': '1440p', '2160': '4K' }
const QUALITY_LABEL: Record<VideoQuality, string> = { standard: 'Standard', high: 'High', 'very-high': 'Very high', max: 'Max' }

function loadReel(garage: string): Reel {
  const fallback: Reel = {
    shots: [{ move: 'hero-sweep', garage, duration: moveById('hero-sweep')!.duration }],
    transition: 'fade',
    resolution: '1080',
    fps: 60,
    quality: 'high',
  }
  try {
    const saved = JSON.parse(localStorage.getItem(REEL_KEY) ?? 'null') as Reel | null
    if (!saved || !Array.isArray(saved.shots)) return fallback
    // drop shots whose move or garage no longer exists
    saved.shots = saved.shots.filter((s) => moveById(s.move) && GARAGES.some((g) => g.id === s.garage))
    if (!QUALITIES.includes(saved.quality)) saved.quality = fallback.quality // saved before quality existed
    return { ...fallback, ...saved }
  } catch {
    return fallback
  }
}

/** dropdown in the panel's style */
function select<T extends string>(options: { value: T; label: string }[], value: T, onPick: (v: T) => void): HTMLSelectElement {
  const s = el('select', 'cfg-select')
  for (const o of options) {
    const opt = el('option', '', o.label)
    opt.value = o.value
    opt.selected = o.value === value
    s.append(opt)
  }
  s.addEventListener('change', () => onPick(s.value as T))
  return s
}

function mini(text: string, onClick: () => void, className = ''): HTMLButtonElement {
  const b = el('button', `cfg-mini ${className}`.trim(), text)
  b.type = 'button'
  b.addEventListener('click', onClick)
  return b
}

/**
 * Menu › Video — a shot list (camera move + garage + length each), previewed
 * live or exported to MP4. While either runs, the view belongs to the director:
 * the panel hides and a bar shows progress and a stop button.
 */
export function videoPage(app: HTMLElement, stage: () => Stage, currentGarage: () => string): Page {
  let reel: Reel | null = null
  const getReel = () => (reel ??= loadReel(currentGarage()))
  const save = () => {
    try {
      localStorage.setItem(REEL_KEY, JSON.stringify(reel))
    } catch {
      // not remembered — fine
    }
  }

  // the bar shown while previewing or exporting
  const bar = el('div', 'rec')
  const barLabel = el('span', 'rec-label')
  const barTrack = el('span', 'rec-track')
  const barFill = el('i')
  barTrack.append(barFill)
  const stopBtn = el('button', 'rec-stop', 'Stop')
  stopBtn.type = 'button'
  bar.append(barLabel, barTrack, stopBtn)
  let running: AbortController | null = null
  stopBtn.addEventListener('click', () => running?.abort())
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && running) running.abort()
  })
  const showProgress = (p: Progress) => {
    barLabel.textContent = p.label
    barFill.style.transform = `scaleX(${p.done})`
  }

  async function run(mode: 'preview' | 'export'): Promise<void> {
    if (running) return
    running = new AbortController()
    bar.classList.toggle('is-export', mode === 'export')
    stopBtn.textContent = mode === 'export' ? 'Cancel' : 'Stop'
    showProgress({ done: 0, label: mode === 'export' ? 'preparing encoder…' : 'starting…' })
    app.append(bar)
    const r = getReel()
    const about = {
      shots: r.shots.length,
      seconds: r.shots.reduce((t, s) => t + s.duration, 0),
      resolution: r.resolution,
      fps: r.fps,
      quality: r.quality,
    }
    track(`video_${mode}`, about)
    try {
      if (mode === 'preview') {
        await preview(r, stage(), running.signal, showProgress)
      } else {
        const blob = await exportVideo(r, stage(), running.signal, showProgress)
        if (blob) {
          download(blob)
          track('video_export_done', { ...about, mb: Math.round(blob.size / 1e5) / 10 })
        }
      }
    } catch (err) {
      console.error('[garage] video failed', err)
      track('video_failed', { mode, error: String((err as Error)?.message ?? err).slice(0, 100) })
      alertInPanel = `${mode === 'export' ? 'Export' : 'Preview'} failed: ${(err as Error).message}`
    } finally {
      running = null
      bar.remove()
      lastNav?.refresh()
    }
  }

  let alertInPanel = ''
  let lastNav: Nav | null = null
  function download(blob: Blob): void {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `garage-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.mp4`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
  }

  return {
    title: 'Video',
    hint: 'Camera moves across garages, exported to MP4',
    render(body, nav) {
      lastNav = nav
      const r = getReel()
      const change = () => {
        save()
        nav.refresh()
      }

      const shots = section('Shots')
      r.shots.forEach((shot, i) => {
        const card = el('div', 'cfg-shot')
        const head = el('div', 'cfg-shot-head')
        head.append(el('span', 'cfg-shot-no', String(i + 1).padStart(2, '0')))
        head.append(
          select(
            CAMERA_MOVES.map((m) => ({ value: m.id, label: m.name })),
            shot.move,
            (move) => {
              shot.move = move
              shot.duration = moveById(move)!.duration
              change()
            },
          ),
        )
        const tools = el('div', 'cfg-shot-tools')
        const up = mini('↑', () => {
          ;[r.shots[i - 1], r.shots[i]] = [r.shots[i], r.shots[i - 1]]
          change()
        })
        up.disabled = i === 0
        up.title = 'earlier'
        const down = mini('↓', () => {
          ;[r.shots[i + 1], r.shots[i]] = [r.shots[i], r.shots[i + 1]]
          change()
        })
        down.disabled = i === r.shots.length - 1
        down.title = 'later'
        const remove = mini('✕', () => {
          r.shots.splice(i, 1)
          change()
        })
        remove.title = 'remove shot'
        tools.append(up, down, remove)
        head.append(tools)
        card.append(head, el('p', 'cfg-note', moveById(shot.move)!.hint))
        card.append(
          select(
            GARAGES.map((g) => ({ value: g.id, label: g.name })),
            shot.garage,
            (garage) => {
              shot.garage = garage
              change()
            },
          ),
          slider('Length', shot.duration, { min: 2, max: 30, step: 0.5 }, (v) => `${v.toFixed(1)} s`, (v) => {
            shot.duration = v
            save()
            totalEl.textContent = summary()
          }),
        )
        shots.append(card)
      })
      if (r.shots.length === 0) shots.append(el('p', 'cfg-note', 'No shots yet — add one to start.'))
      const add = mini('+ Add shot', () => {
        // the next move not used yet, in the garage the reel ended in
        const used = new Set(r.shots.map((s) => s.move))
        const move = CAMERA_MOVES.find((m) => !used.has(m.id)) ?? CAMERA_MOVES[0]
        r.shots.push({ move: move.id, garage: r.shots.at(-1)?.garage ?? currentGarage(), duration: move.duration })
        change()
      })
      const actions = el('div', 'cfg-actions cfg-gap')
      actions.append(add)
      shots.append(actions)
      body.append(shots)

      const cuts = section('Between shots')
      cuts.append(
        segmented(['fade', 'cut'] as const, { fade: 'Fade through black', cut: 'Hard cut' }, r.transition, (t) => {
          r.transition = t
          change()
        }),
      )
      body.append(cuts)

      const out = section('Output')
      out.append(
        el('div', 'cfg-label cfg-sub', 'Resolution (16:9)'),
        segmented(RESOLUTIONS, RES_LABEL, r.resolution, (res) => {
          r.resolution = res
          change()
        }),
        el('div', 'cfg-label cfg-sub', 'Frame rate'),
        segmented(['30', '60'] as const, { '30': '30 fps', '60': '60 fps' }, String(r.fps) as '30' | '60', (fps) => {
          r.fps = Number(fps) as 30 | 60
          change()
        }),
      )
      out.append(
        el('div', 'cfg-label cfg-sub', 'Quality'),
        segmented(QUALITIES, QUALITY_LABEL, r.quality, (q) => {
          r.quality = q
          change()
        }),
      )
      const summary = () => {
        const bitrate = videoBitrate(r)
        const mb = (bitrate * reelDuration(r)) / 8 / 1e6
        const size = mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${Math.round(mb)} MB`
        return `${r.shots.length} shot${r.shots.length === 1 ? '' : 's'} · ${formatTime(reelDuration(r))} · ${Math.round(bitrate / 1e6)} Mbps · up to ~${size}`
      }
      const totalEl = el('p', 'cfg-note cfg-gap', summary())
      out.append(totalEl)
      const go = el('div', 'cfg-actions cfg-gap')
      const previewBtn = mini('▶ Preview', () => void run('preview'))
      const exportBtn = mini('Export MP4', () => void run('export'), 'is-primary')
      previewBtn.disabled = exportBtn.disabled = r.shots.length === 0
      go.append(previewBtn, exportBtn)
      out.append(
        go,
        el(
          'p',
          'cfg-note cfg-gap',
          'Export renders every frame at the chosen size and frame rate, so it stays smooth even when live playback wouldn’t — it just takes longer. Path tracing is off while it runs.',
        ),
      )
      if (alertInPanel) {
        out.append(el('p', 'cfg-note cfg-error', alertInPanel))
        alertInPanel = ''
      }
      body.append(out)
    },
  }
}
