import * as THREE from 'three'

/** where the camera is and what it looks at, for one moment of a move */
export interface CameraPose {
  position: THREE.Vector3
  target: THREE.Vector3
}

/**
 * What a move frames. The car stands grounded at the origin with its nose
 * toward +z (see car.ts), so its size is all a move needs to know.
 */
export interface Framing {
  /** car size: x = width, y = height, z = length */
  size: THREE.Vector3
  /** vertical field of view, degrees */
  fov: number
  /** frame width / height */
  aspect: number
}

export interface CameraMove {
  id: string
  name: string
  /** one-liner for the picker */
  hint: string
  /** seconds the move reads well at */
  duration: number
  /** the pose at `u` ∈ [0, 1] through the move */
  pose(u: number, f: Framing, out: CameraPose): void
}

/** an empty bay still frames a car-sized space */
export const DEFAULT_CAR_SIZE = new THREE.Vector3(1.95, 1.3, 4.6)

const smooth = (u: number) => u * u * (3 - 2 * u)
/** slow in, slow out — quintic, gentler than smoothstep at the ends */
const ease = (u: number) => u * u * u * (u * (u * 6 - 15) + 10)
const deg = THREE.MathUtils.degToRad

/**
 * Distance at which the car fills the frame nicely — its length across ~90%
 * of the width, its height no more than about half the height — times `k`.
 * (A bounding sphere is far too cautious: it leaves the car tiny.)
 */
function fitDistance(f: Framing, k = 1): number {
  const tanV = Math.tan(deg(f.fov) / 2)
  const tanH = tanV * f.aspect
  const across = (0.5 * f.size.z) / (tanH * 0.9)
  const tall = f.size.y / (2 * tanV * 0.55)
  return Math.max(across, tall) * k
}

/** camera on a circle around the car: azimuth 0 = in front (+z), 90° = the car's left (+x) */
function orbit(out: THREE.Vector3, azimuth: number, distance: number, height: number): THREE.Vector3 {
  return out.set(Math.sin(azimuth) * distance, height, Math.cos(azimuth) * distance)
}

export const CAMERA_MOVES: CameraMove[] = [
  {
    id: 'turntable',
    name: 'Turntable',
    hint: 'A full slow circle at eye level',
    duration: 12,
    pose(u, f, out) {
      const a = deg(35) + u * Math.PI * 2
      orbit(out.position, a, fitDistance(f, 1.15), f.size.y * 1.05)
      out.target.set(0, f.size.y * 0.42, 0)
    },
  },
  {
    id: 'hero-sweep',
    name: 'Hero sweep',
    hint: 'Low arc from the front corner round to the rear',
    duration: 8,
    pose(u, f, out) {
      const e = ease(u)
      const a = deg(30) + e * deg(120)
      orbit(out.position, a, fitDistance(f, THREE.MathUtils.lerp(1.25, 1.05, e)), 0.42)
      out.target.set(0, f.size.y * 0.38, 0)
    },
  },
  {
    id: 'push-in',
    name: 'Push in',
    hint: 'Slow dolly toward the nose from the front corner',
    duration: 6,
    pose(u, f, out) {
      const e = ease(u)
      orbit(out.position, deg(28 - 10 * e), fitDistance(f, THREE.MathUtils.lerp(1.35, 0.62, e)), THREE.MathUtils.lerp(1.3, 0.7, e))
      out.target.set(0, f.size.y * 0.4, THREE.MathUtils.lerp(0, f.size.z * 0.22, e))
    },
  },
  {
    id: 'flyover',
    name: 'Flyover',
    hint: 'Crane up from behind, over the roof, down to the front',
    duration: 9,
    pose(u, f, out) {
      // an arc in the car's long vertical plane, offset sideways so the view never points straight down
      const t = ease(u) * Math.PI
      const r = fitDistance(f, 0.95)
      const lift = Math.max(f.size.y * 2.8, r * 0.75)
      out.position.set(r * 0.28, 0.55 + Math.sin(t) * lift, -Math.cos(t) * r)
      out.target.set(0, f.size.y * 0.35, -Math.cos(t) * f.size.z * 0.12)
    },
  },
  {
    id: 'side-track',
    name: 'Side track',
    hint: 'Glide along the flank, tail to nose, like a tracking car',
    duration: 7,
    pose(u, f, out) {
      const e = smooth(u)
      const z = THREE.MathUtils.lerp(-0.85, 0.85, e) * f.size.z
      out.position.set(f.size.x / 2 + Math.max(2.2, f.size.z * 0.5), 0.6, z)
      out.target.set(0, f.size.y * 0.4, z * 0.55) // lags behind the camera so the car drifts through the frame
    },
  },
  {
    id: 'detail-reveal',
    name: 'Detail reveal',
    hint: 'Start tight on the front wheel, pull back to the full car',
    duration: 7,
    pose(u, f, out) {
      const e = ease(u)
      const wheel = new THREE.Vector3(f.size.x / 2, 0.36, f.size.z * 0.32)
      const closeCam = new THREE.Vector3(f.size.x / 2 + 0.95, 0.42, f.size.z * 0.32 + 0.85)
      const wideCam = orbit(new THREE.Vector3(), deg(52), fitDistance(f, 0.95), f.size.y * 1.15)
      out.position.lerpVectors(closeCam, wideCam, e)
      out.target.lerpVectors(wheel, new THREE.Vector3(0, f.size.y * 0.4, 0), smooth(Math.min(1, u * 1.25)))
    },
  },
  {
    id: 'top-down',
    name: 'Top-down spin',
    hint: 'Look straight down and turn a quarter circle',
    duration: 8,
    pose(u, f, out) {
      const a = deg(20) + smooth(u) * deg(90)
      // the car turns under the lens, so its length has to fit the frame's height too
      const r = (0.5 * f.size.z) / (Math.tan(deg(f.fov) / 2) * 0.9)
      // a sliver off vertical keeps lookAt well defined; the room clamp widens the lens under low ceilings
      orbit(out.position, a, r * 0.06, r)
      out.target.set(0, 0, 0)
    },
  },
]

export const moveById = (id: string) => CAMERA_MOVES.find((m) => m.id === id)
