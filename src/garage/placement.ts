import * as THREE from 'three'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

/**
 * Moving the whole car around the room with a translate gizmo, and turning it
 * about the vertical with a rotate one (Menu › Car › Position). The car's root is what moves — body, wheels, lamps and their
 * spots, overlays all follow; the contact shadow is a separate mesh on the
 * floor, so it's slid along underneath (and faded as the car is lifted).
 *
 * The gizmo lives on its own layer: the main camera sees it, but mirrors
 * (Reflector's virtual camera), environment captures and picking rays only see
 * layer 0, and the path tracer skips it as an overlay.
 */
export const GIZMO_LAYER = 1
const KEY = 'garage.car-position.v1'

export interface CarPlacement {
  /** the car's offset from where it was loaded (x, y above the floor, z) */
  readonly position: THREE.Vector3 | null
  /** which way the car faces: radians about the vertical, 0 = nose toward +z as loaded */
  readonly heading: number
  readonly active: boolean
  /** what the gizmo does: slide the car or turn it */
  readonly mode: 'move' | 'turn'
  setMode(mode: 'move' | 'turn'): void
  /** turn the car to face `radians` (−π…π), about its own centre */
  setHeading(radians: number): void
  /** show or hide the gizmo on the car */
  setActive(on: boolean): void
  /** put the car back where it loads */
  reset(): void
  /** a car was loaded: give it its saved place, and slide its shadow under it */
  attach(car: { id: string; root: THREE.Object3D; shadow: THREE.Mesh; size: THREE.Vector3 } | null): void
  /** the room changed: keep the car inside the new one */
  refit(): void
  /** the gizmo's own objects, hidden while a video is directed */
  readonly helper: THREE.Object3D
}

interface Hooks {
  camera: THREE.PerspectiveCamera
  dom: HTMLElement
  scene: THREE.Scene
  /** the room's walls, floor to ceiling — the car is kept inside */
  bounds: () => THREE.Box3
  /** true while a drag is on (the orbit controls pause) */
  dragging: (on: boolean) => void
  /** redraw — every gizmo move and hover */
  changed: () => void
  /** the car came to rest somewhere new: re-bake what depends on where it stands */
  moved: () => void
  /** the gizmo was put away */
  done: () => void
}

/** x, y, z and (since headings) the yaw — older entries have three numbers */
function load(): Record<string, number[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function createCarPlacement(hooks: Hooks): CarPlacement {
  const gizmo = new TransformControls(hooks.camera, hooks.dom)
  gizmo.setMode('translate')
  gizmo.setSpace('world')
  gizmo.size = 0.9
  gizmo.enabled = false
  // turning is about the vertical only (a heading), with a 15° snap to hold straight lines
  gizmo.setRotationSnap(THREE.MathUtils.degToRad(15))
  let mode: 'move' | 'turn' = 'move'
  const helper = gizmo.getHelper()
  helper.traverse((o) => o.layers.set(GIZMO_LAYER))
  helper.userData.overlay = true // the path tracer leaves overlays out
  gizmo.getRaycaster().layers.set(GIZMO_LAYER)
  hooks.camera.layers.enable(GIZMO_LAYER)
  hooks.scene.add(helper)

  let car: { id: string; root: THREE.Object3D; shadow: THREE.Mesh; size: THREE.Vector3 } | null = null
  /** where the shadow lies with the car at its load position, and its full strength */
  const shadowHome = new THREE.Vector3()
  let shadowOpacity = 1
  let active = false
  const saved = load()

  /** keep the car's footprint inside the walls; up and down it goes wherever it's dragged (into the floor too) */
  function keepInRoom(): void {
    if (!car) return
    const { min, max } = hooks.bounds()
    const p = car.root.position
    const half = Math.max(car.size.x, car.size.z) / 2
    const clampAxis = (v: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : THREE.MathUtils.clamp(v, lo, hi))
    p.x = clampAxis(p.x, min.x + half, max.x - half)
    p.z = clampAxis(p.z, min.z + half, max.z - half)
  }

  const shadowTurn = new THREE.Quaternion()
  const shadowRest = new THREE.Quaternion()
  const offset = new THREE.Vector3()
  /** slide (and turn) the contact shadow under the car; it thins out as the car rises off the floor (sunk in, it stays) */
  function followShadow(): void {
    if (!car) return
    const p = car.root.position
    const yaw = car.root.rotation.y
    offset.set(shadowHome.x, 0, shadowHome.z).applyAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)
    car.shadow.position.set(offset.x + p.x, shadowHome.y, offset.z + p.z)
    car.shadow.quaternion.copy(shadowTurn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, yaw)).multiply(shadowRest)
    ;(car.shadow.material as THREE.MeshBasicMaterial).opacity = shadowOpacity * (1 - THREE.MathUtils.smoothstep(p.y, 0, 0.8))
  }

  function store(): void {
    if (!car) return
    const p = car.root.position
    const yaw = car.root.rotation.y
    if (p.lengthSq() < 1e-6 && Math.abs(yaw) < 1e-4) delete saved[car.id]
    else saved[car.id] = [p.x, p.y, p.z, yaw].map((v) => Math.round(v * 1000) / 1000)
    try {
      localStorage.setItem(KEY, JSON.stringify(saved))
    } catch {
      // not remembered — fine
    }
  }

  gizmo.addEventListener('dragging-changed', (e) => {
    hooks.dragging(e.value as boolean)
    if (!e.value) {
      store()
      hooks.moved()
    }
  })
  gizmo.addEventListener('objectChange', () => {
    if (car) {
      // the rotate gizmo can hand back a flipped Euler (x = z = π) near ±90°: keep only the heading
      const yaw = new THREE.Euler().setFromQuaternion(car.root.quaternion, 'YXZ').y
      car.root.rotation.set(0, yaw, 0)
    }
    keepInRoom()
    followShadow()
  })
  gizmo.addEventListener('change', () => hooks.changed())

  function show(): void {
    gizmo.setMode(mode === 'move' ? 'translate' : 'rotate')
    gizmo.setSpace(mode === 'move' ? 'world' : 'local')
    gizmo.showX = mode === 'move'
    gizmo.showZ = mode === 'move'
    if (active && car) {
      gizmo.attach(car.root)
      gizmo.enabled = true
    } else {
      gizmo.detach()
      gizmo.enabled = false
    }
    hooks.changed()
  }

  return {
    get position() {
      return car ? car.root.position : null
    },
    get active() {
      return active
    },
    get heading() {
      return car ? car.root.rotation.y : 0
    },
    get mode() {
      return mode
    },
    setMode(next) {
      mode = next
      show()
    },
    setHeading(radians) {
      if (!car) return
      car.root.rotation.set(0, Math.atan2(Math.sin(radians), Math.cos(radians)), 0)
      keepInRoom()
      followShadow()
      store()
      hooks.moved()
      hooks.changed()
      if (!active) hooks.done()
    },
    helper,
    setActive(on) {
      const was = active
      active = on
      show()
      if (was && !on) hooks.done()
    },
    reset() {
      if (!car) return
      car.root.position.set(0, 0, 0)
      car.root.rotation.set(0, 0, 0)
      followShadow()
      store()
      hooks.moved()
      if (!active) hooks.done() // (while placing, the view waits until the gizmo is put away)
    },
    attach(next) {
      car = next
      if (car) {
        shadowHome.copy(car.shadow.position)
        shadowRest.copy(car.shadow.quaternion)
        shadowOpacity = (car.shadow.material as THREE.MeshBasicMaterial).opacity
        const p = saved[car.id]
        if (p) {
          car.root.position.set(p[0], p[1], p[2])
          car.root.rotation.set(0, p[3] ?? 0, 0)
        }
        keepInRoom()
        followShadow()
      }
      show()
    },
    refit() {
      if (!car) return
      const before = car.root.position.clone()
      keepInRoom()
      followShadow()
      if (!before.equals(car.root.position)) hooks.moved()
    },
  }
}
