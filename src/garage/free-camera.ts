import * as THREE from 'three'

/**
 * Camera modes besides the orbit round the car:
 * - walk: a person on the ground — WASD/arrows, mouse look, shift to run, a head bob in step
 *   with the stride, gravity when the floor drops away, a dip on landing;
 * - fly: a drone — the same moves with no bob, space up, shift/ctrl down, wheel sets the speed.
 * Both keep inside the room's bounds and out of the car.
 */
export type CameraMode = 'orbit' | 'walk' | 'fly'

export interface FreeCameraHooks {
  camera: THREE.PerspectiveCamera
  dom: HTMLElement
  bounds(): THREE.Box3
  /** height of the ground under (x, z), searched downward from `fromY`; null = nothing found */
  groundAt(x: number, z: number, fromY: number): number | null
  /** solid boxes the camera must stay out of (the car) */
  obstacles(): THREE.Box3[]
  /** a click on the canvas may capture the mouse (not while picking parts or placing the car) */
  canLock(): boolean
}

export interface FreeCamera {
  readonly mode: CameraMode
  /** switch mode; leaving orbit starts from wherever the camera is now */
  setMode(mode: CameraMode): void
  /** step the walk/fly camera and write its pose to the camera; true if the picture changes */
  update(dt: number): boolean
  /** fly speed, m/s (the wheel changes it) */
  readonly flySpeed: number
}

/** eye height above the feet */
const EYE = 1.64
/** highest step walked up without a jump (a kerb, a plinth) */
const STEP = 0.45
/** how close the camera may come to a wall or the car */
const RADIUS = 0.3
const WALK_SPEED = 1.45
const RUN_SPEED = 4.2
/** one step, m — the bob advances half a cycle per step */
const STRIDE = 0.74
const GRAVITY = 9.81
const LOOK_SPEED = 0.0022 // rad per pixel
const MAX_PITCH = THREE.MathUtils.degToRad(88)

const MOVE_KEYS: Record<string, [forward: number, right: number]> = {
  KeyW: [1, 0],
  ArrowUp: [1, 0],
  KeyS: [-1, 0],
  ArrowDown: [-1, 0],
  KeyA: [0, -1],
  ArrowLeft: [0, -1],
  KeyD: [0, 1],
  ArrowRight: [0, 1],
}
const UP_KEYS = new Set(['Space'])
const DOWN_KEYS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'])
const RUN_KEYS = new Set(['ShiftLeft', 'ShiftRight'])

/** typing in the panel (a number field) must not walk the camera */
function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null
  return !!t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')
}

export function createFreeCamera(hooks: FreeCameraHooks): FreeCamera {
  const { camera, dom } = hooks
  let mode: CameraMode = 'orbit'
  const keys = new Set<string>()

  /** eye position without the bob */
  const eye = new THREE.Vector3()
  const velocity = new THREE.Vector3()
  let yaw = 0
  let pitch = 0
  let lookX = 0 // mouse movement not yet applied, px
  let lookY = 0
  let flySpeed = 5

  // walking
  let feet = 0 // ground height under the eye
  let fallSpeed = 0
  let groundKnown = false
  const lastProbe = new THREE.Vector3(Infinity, 0, 0)
  let probedGround: number | null = null
  let stepPhase = 0 // π per step
  let bobWeight = 0 // 0 standing … 1 in full stride
  let dip = 0 // landing: the knees give, then spring back
  let dipVelocity = 0

  const euler = new THREE.Euler(0, 0, 0, 'YXZ')
  const forward = new THREE.Vector3()
  const right = new THREE.Vector3()
  const wish = new THREE.Vector3()

  function ground(): number | null {
    // a ray per frame is cheap with the room's BVH, but only look again once the eye has moved a little
    if (lastProbe.distanceToSquared(eye) > 0.01) {
      lastProbe.copy(eye)
      const from = mode === 'walk' ? feet + STEP : eye.y
      probedGround = hooks.groundAt(eye.x, eye.z, from)
    }
    return probedGround
  }

  // ─── input ───
  window.addEventListener('keydown', (e) => {
    if (mode === 'orbit' || e.metaKey || e.altKey || typing(e)) return
    const code = e.code
    if (!(code in MOVE_KEYS) && !UP_KEYS.has(code) && !DOWN_KEYS.has(code)) return
    keys.add(code)
    // ctrl+D would bookmark, space would scroll, arrows would move sliders
    e.preventDefault()
  })
  window.addEventListener('keyup', (e) => keys.delete(e.code))
  window.addEventListener('blur', () => keys.clear())

  const locked = () => document.pointerLockElement === dom
  let dragging = false
  dom.addEventListener('pointerdown', (e) => {
    if (mode === 'orbit' || e.button !== 0) return
    if (hooks.canLock()) {
      if (!locked()) void dom.requestPointerLock()?.catch?.(() => {})
    } else dragging = true // picking parts: drag to look, clicks still pick
  })
  window.addEventListener('pointerup', () => (dragging = false))
  dom.addEventListener('pointermove', (e) => {
    if (mode === 'orbit' || !(locked() || dragging)) return
    lookX += e.movementX
    lookY += e.movementY
  })
  dom.addEventListener(
    'wheel',
    (e) => {
      if (mode !== 'fly') return
      e.preventDefault()
      flySpeed = THREE.MathUtils.clamp(flySpeed * Math.pow(1.15, -Math.sign(e.deltaY)), 0.5, 40)
    },
    { passive: false },
  )

  function clampToRoom(): void {
    const b = hooks.bounds()
    eye.x = THREE.MathUtils.clamp(eye.x, b.min.x + RADIUS, b.max.x - RADIUS)
    eye.z = THREE.MathUtils.clamp(eye.z, b.min.z + RADIUS, b.max.z - RADIUS)
    eye.y = Math.min(eye.y, b.max.y - 0.1)
    if (mode === 'fly') eye.y = Math.max(eye.y, b.min.y)
  }

  /** push the eye out of the car: in walk only its footprint counts (it's taller than a step) */
  function avoidObstacles(): void {
    for (const box of hooks.obstacles()) {
      if (box.isEmpty()) continue
      const bottom = mode === 'walk' ? feet : eye.y
      const top = mode === 'walk' ? feet + EYE : eye.y
      if (mode === 'walk' && box.max.y < feet + STEP) continue // low enough to step onto
      if (top < box.min.y - RADIUS || bottom > box.max.y + RADIUS) continue
      const dx0 = eye.x - (box.min.x - RADIUS)
      const dx1 = box.max.x + RADIUS - eye.x
      const dz0 = eye.z - (box.min.z - RADIUS)
      const dz1 = box.max.z + RADIUS - eye.z
      if (dx0 <= 0 || dx1 <= 0 || dz0 <= 0 || dz1 <= 0) continue
      const candidates = [dx0, dx1, dz0, dz1]
      let dy = Infinity // flying: over the roof is a way out too
      if (mode === 'fly') dy = box.max.y + RADIUS - eye.y
      const least = Math.min(...candidates, dy)
      if (least === dx0) eye.x -= dx0
      else if (least === dx1) eye.x += dx1
      else if (least === dz0) eye.z -= dz0
      else if (least === dz1) eye.z += dz1
      else eye.y += dy
    }
  }

  function writePose(): void {
    let y = eye.y
    let roll = 0
    let nod = 0
    let sway = 0
    if (mode === 'walk') {
      // head height dips at each heel strike and peaks mid-step; it sways side to side once a stride
      const w = bobWeight
      const running = THREE.MathUtils.clamp((velocity.length() - WALK_SPEED) / (RUN_SPEED - WALK_SPEED), 0, 1)
      const lift = THREE.MathUtils.lerp(0.022, 0.05, running) * w
      y += -lift * Math.cos(2 * stepPhase) + dip
      sway = THREE.MathUtils.lerp(0.012, 0.022, running) * w * Math.sin(stepPhase)
      roll = THREE.MathUtils.lerp(0.003, 0.007, running) * w * Math.sin(stepPhase)
      nod = 0.004 * w * Math.cos(2 * stepPhase) + dip * 0.12
    }
    euler.set(pitch + nod, yaw, roll)
    camera.quaternion.setFromEuler(euler)
    right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    camera.position.set(eye.x, y, eye.z).addScaledVector(right, sway)
    camera.updateMatrixWorld()
  }

  function update(dt: number): boolean {
    if (mode === 'orbit') return false
    let changed = false
    if (lookX !== 0 || lookY !== 0) {
      yaw -= lookX * LOOK_SPEED
      pitch = THREE.MathUtils.clamp(pitch - lookY * LOOK_SPEED, -MAX_PITCH, MAX_PITCH)
      lookX = lookY = 0
      changed = true
    }

    // where the keys ask to go, on the ground plane of the view
    forward.set(-Math.sin(yaw), 0, -Math.cos(yaw))
    right.set(Math.cos(yaw), 0, -Math.sin(yaw))
    wish.set(0, 0, 0)
    for (const code of keys) {
      const move = MOVE_KEYS[code]
      if (move) wish.addScaledVector(forward, move[0]).addScaledVector(right, move[1])
    }
    if (wish.lengthSq() > 0) wish.normalize()
    const run = mode === 'walk' && [...keys].some((k) => RUN_KEYS.has(k))
    const speed = mode === 'fly' ? flySpeed : run ? RUN_SPEED : WALK_SPEED
    wish.multiplyScalar(speed)
    if (mode === 'fly') {
      let vertical = 0
      for (const code of keys) {
        if (UP_KEYS.has(code)) vertical += 1
        if (DOWN_KEYS.has(code)) vertical -= 1
      }
      wish.y = Math.sign(vertical) * flySpeed * 0.7
    }

    // a person gets going in a few steps and stops in one; a drone glides
    const moving = wish.lengthSq() > 0
    const rate = mode === 'fly' ? (moving ? 3 : 2.2) : moving ? 7 : 10
    const k = 1 - Math.exp(-rate * dt)
    if (mode === 'walk') velocity.y = 0
    velocity.lerp(wish, k)
    if (!moving && velocity.lengthSq() < 1e-4) velocity.set(0, 0, 0)
    if (velocity.lengthSq() > 0) {
      eye.addScaledVector(velocity, dt)
      changed = true
    }

    clampToRoom()
    if (mode === 'walk') {
      const g = ground()
      if (g !== null) {
        groundKnown = true
        if (g > feet) {
          // up a step: the legs lift the body over a few frames
          feet = Math.min(g, feet + Math.max(dt * 3, (g - feet) * (1 - Math.exp(-14 * dt))))
          fallSpeed = 0
          changed = true
        } else if (g < feet - 1e-3) {
          fallSpeed += GRAVITY * dt
          feet = Math.max(g, feet - fallSpeed * dt)
          if (feet === g) {
            // landing: the knees give with the fall's speed
            dipVelocity -= Math.min(fallSpeed, 6) * 0.35
            fallSpeed = 0
          }
          changed = true
        }
      } else if (!groundKnown) feet = 0
      eye.y = feet + EYE
      avoidObstacles()

      const horizontal = Math.hypot(velocity.x, velocity.z)
      stepPhase += ((horizontal * dt) / STRIDE) * Math.PI
      const target = Math.min(1, horizontal / WALK_SPEED)
      bobWeight += (target - bobWeight) * (1 - Math.exp(-6 * dt))
      if (bobWeight < 1e-3 && target === 0) {
        bobWeight = 0
        stepPhase = 0 // the next walk starts from a heel strike, not mid-bob
      } else changed = true
      // landing dip: a damped spring back to standing height
      if (dip !== 0 || dipVelocity !== 0) {
        dipVelocity += (-dip * 90 - dipVelocity * 14) * dt
        dip += dipVelocity * dt
        dip = Math.max(dip, -0.18)
        if (Math.abs(dip) < 1e-4 && Math.abs(dipVelocity) < 1e-3) dip = dipVelocity = 0
        changed = true
      }
    } else {
      // flying: never into the ground
      const g = ground()
      if (g !== null && eye.y < g + 0.3) eye.y = g + 0.3
      avoidObstacles()
    }
    writePose()
    return changed
  }

  function setMode(next: CameraMode): void {
    if (next === mode) return
    const from = mode
    mode = next
    keys.clear()
    velocity.set(0, 0, 0)
    lookX = lookY = 0
    if (next === 'orbit') {
      if (locked()) document.exitPointerLock()
      return
    }
    if (from === 'orbit') {
      // start where the orbit camera is, looking the same way
      eye.copy(camera.position)
      const dir = camera.getWorldDirection(new THREE.Vector3())
      yaw = Math.atan2(-dir.x, -dir.z)
      pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1)), -MAX_PITCH, MAX_PITCH)
    }
    clampToRoom()
    lastProbe.set(Infinity, 0, 0)
    if (next === 'walk') {
      // from the air (or the orbit's height) the walker drops to the ground below
      feet = eye.y - EYE
      groundKnown = false
      fallSpeed = 0
      const g = hooks.groundAt(eye.x, eye.z, eye.y)
      if (g !== null && from === 'orbit') feet = g // arriving from the orbit: just stand there
      else if (g === null) feet = Math.min(feet, 0)
      if (from === 'orbit') pitch *= 0.4 // a person looks ahead more than down at the car
      bobWeight = dip = dipVelocity = 0
      stepPhase = 0
    } // flying takes off from wherever the eye is
    writePose()
  }

  return {
    get mode() {
      return mode
    },
    setMode,
    update,
    get flySpeed() {
      return flySpeed
    },
  }
}
