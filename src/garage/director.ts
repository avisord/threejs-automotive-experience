import * as THREE from 'three'
import { CAMERA_MOVES, moveById, type CameraPose, type Framing } from './camera-moves'

/** one shot of the reel: a camera move, in a garage, for so long */
export interface Shot {
  move: string
  garage: string
  /** seconds */
  duration: number
}

export type Transition = 'cut' | 'fade'
export const RESOLUTIONS = ['720', '1080', '1440', '2160'] as const
export type Resolution = (typeof RESOLUTIONS)[number]

export const QUALITIES = ['standard', 'high', 'very-high', 'max'] as const
export type VideoQuality = (typeof QUALITIES)[number]

export interface Reel {
  shots: Shot[]
  transition: Transition
  resolution: Resolution
  fps: 30 | 60
  quality: VideoQuality
}

/**
 * H.264 bits per pixel per frame. Renders are hard on an encoder — smooth
 * gradients, glossy reflections, fine livery text, the whole frame moving —
 * so even "standard" is well above what generic presets give (mediabunny's
 * "high" came out at ~6 Mbps for 1080p60, visibly blocky).
 */
const BITS_PER_PIXEL: Record<VideoQuality, number> = { standard: 0.08, high: 0.15, 'very-high': 0.25, max: 0.4 }
/** newer codecs get the same picture from fewer bits */
const CODEC_EFFICIENCY: Record<string, number> = { avc: 1, hevc: 0.65, vp9: 0.65, av1: 0.5 }
/** hardware H.264 encoders top out around here (level 5.2 allows 240 Mbps for High) */
const MAX_BITRATE = 150_000_000

/** target bitrate, bits per second */
export function videoBitrate(reel: Reel, codec = 'avc'): number {
  const { width, height } = frameSize(reel.resolution)
  const bits = width * height * reel.fps * BITS_PER_PIXEL[reel.quality] * (CODEC_EFFICIENCY[codec] ?? 1)
  return Math.min(MAX_BITRATE, Math.round(bits))
}

/** 16:9 frame size for a resolution */
export function frameSize(r: Resolution): { width: number; height: number } {
  const height = Number(r)
  return { width: Math.round((height * 16) / 9), height }
}

/** fade through black: this long out of one shot, and as long into the next */
const FADE_S = 0.4

export const reelDuration = (reel: Reel) => reel.shots.reduce((sum, s) => sum + s.duration, 0)

/** which shot plays at time `t`, how far into it (0–1), and how dark the frame is */
export function shotAt(reel: Reel, t: number): { index: number; u: number; black: number } {
  let start = 0
  const last = reel.shots.length - 1
  for (let index = 0; index <= last; index++) {
    const d = reel.shots[index].duration
    if (t < start + d || index === last) {
      const local = THREE.MathUtils.clamp(t - start, 0, d)
      let black = 0
      if (reel.transition === 'fade') {
        // into every shot and out of every shot, the reel's own start and end included
        const edge = Math.min(local, d - local)
        black = 1 - THREE.MathUtils.smoothstep(edge, 0, Math.min(FADE_S, d / 2))
      }
      return { index, u: local / d, black }
    }
    start += d
  }
  return { index: 0, u: 0, black: 0 }
}

/** what the director needs from the app */
export interface Stage {
  canvas: HTMLCanvasElement
  /** take over the view: hide the UI, stop the app's own drawing, frame at this size (null = the window) */
  begin(size: { width: number; height: number } | null): void
  /** give the view back as it was */
  end(): Promise<void>
  /** the framing for the car in the bay, at the current lens */
  framing(): Framing
  /** switch garage without the UI fade, if it isn't up already; true once it had to switch */
  setGarage(id: string): Promise<boolean>
  /** draw one frame from this pose, `black` = fade to black amount */
  draw(pose: CameraPose, dt: number, black: number): void
}

export interface Progress {
  /** 0–1 */
  done: number
  label: string
}

const pose: CameraPose = { position: new THREE.Vector3(), target: new THREE.Vector3() }

function poseAt(reel: Reel, stage: Stage, t: number) {
  const at = shotAt(reel, t)
  const shot = reel.shots[at.index]
  const move = moveById(shot.move) ?? CAMERA_MOVES[0]
  // moves that don't set a lens or roll get the plain framing lens, level
  pose.fov = undefined
  pose.roll = 0
  move.pose(at.u, stage.framing(), pose, at.u * shot.duration)
  return { shot, black: at.black }
}

/**
 * Play the reel live in the window. Garage switches pause the clock, so the
 * preview shows every frame the video would, just not always in real time.
 */
export async function preview(reel: Reel, stage: Stage, signal: AbortSignal, onProgress: (p: Progress) => void): Promise<void> {
  if (reel.shots.length === 0) return
  const total = reelDuration(reel)
  stage.begin(null)
  try {
    let t = 0
    let last = performance.now()
    while (t <= total && !signal.aborted) {
      const { shot, black } = poseAt(reel, stage, t)
      if (await stage.setGarage(shot.garage)) {
        last = performance.now() // switching took a while — don't jump ahead
        continue
      }
      const now = await nextFrame()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      stage.draw(pose, dt, black)
      onProgress({ done: t / total, label: `${formatTime(t)} / ${formatTime(total)}` })
      t += dt
    }
  } finally {
    await stage.end()
  }
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve))
/** a repaint for the progress bar — or a timeout, since a background tab never paints but should keep exporting */
const yieldToPage = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
    setTimeout(resolve, 50)
  })

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/**
 * Render the reel frame by frame at a fixed time step and encode it to MP4
 * with WebCodecs. Nothing depends on how fast the GPU is: a slow frame just
 * takes longer to export, it's never dropped.
 */
export async function exportVideo(
  reel: Reel,
  stage: Stage,
  signal: AbortSignal,
  onProgress: (p: Progress) => void,
): Promise<Blob | null> {
  if (reel.shots.length === 0) return null
  // the encoder is a sizeable module most sessions never need
  const mb = await import('mediabunny')
  const size = frameSize(reel.resolution)
  const codecs = ['avc', 'hevc', 'vp9', 'av1'] as const
  let codec: (typeof codecs)[number] | null = null
  for (const c of codecs) {
    const quality = new mb.Quality({ bitrate: videoBitrate(reel, c) })
    if (await mb.canEncodeVideo(c, { ...size, quality, frameRate: reel.fps })) {
      codec = c
      break
    }
  }
  if (!codec) throw new Error(`this browser can't encode ${size.width}×${size.height} video`)
  const bitrate = videoBitrate(reel, codec)

  const target = new mb.BufferTarget()
  const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target })
  const source = new mb.CanvasSource(stage.canvas, {
    codec,
    quality: new mb.Quality({ bitrate, bitrateMode: 'variable' }),
    keyFrameInterval: 2,
  })
  output.addVideoTrack(source, { frameRate: reel.fps })

  const total = reelDuration(reel)
  const frames = Math.round(total * reel.fps)
  const dt = 1 / reel.fps
  stage.begin(size)
  try {
    await output.start()
    let yieldedAt = performance.now()
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) {
        await output.cancel()
        return null
      }
      const t = i * dt
      const { shot, black } = poseAt(reel, stage, t)
      await stage.setGarage(shot.garage)
      stage.draw(pose, dt, black)
      // captured straight after drawing, in the same task — the drawing buffer is still intact
      await source.add(t, dt)
      if (performance.now() - yieldedAt > 60) {
        onProgress({ done: i / frames, label: `frame ${i + 1} / ${frames} · ${codec.toUpperCase()} ${Math.round(bitrate / 1e6)} Mbps` })
        await yieldToPage() // let the progress repaint and a cancel click land
        yieldedAt = performance.now()
      }
    }
    onProgress({ done: 1, label: 'finishing…' })
    await output.finalize()
    return new Blob([target.buffer!], { type: output.format.mimeType })
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => {})
    throw err
  } finally {
    await stage.end()
  }
}
