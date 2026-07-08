import * as THREE from 'three'
import type { Ball } from './balls'

export interface Bounds {
  x: number // half-width of the play area
  z: number // half-depth
  ceiling: number
}

const GRAVITY = 28
const FLOOR_RESTITUTION = 0.58
const WALL_RESTITUTION = 0.6
const BALL_RESTITUTION = 0.72
const AIR_DRAG = 0.06
const ROLL_FRICTION = 1.4
const DRAG_STIFFNESS = 18
const MAX_SPEED = 90

const n = new THREE.Vector3()
const rollAxis = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

export function stepPhysics(balls: Ball[], dt: number, bounds: Bounds): void {
  // integrate
  for (const b of balls) {
    if (b.dragged) {
      // critically-damped pull toward the pointer; keeps a real velocity so
      // collisions shove other balls and release inherits throw momentum
      b.velocity.copy(b.dragTarget).sub(b.mesh.position).multiplyScalar(DRAG_STIFFNESS)
    } else {
      b.velocity.y -= GRAVITY * dt
      b.velocity.multiplyScalar(Math.max(0, 1 - AIR_DRAG * dt))
    }
    b.velocity.clampLength(0, MAX_SPEED)
    b.mesh.position.addScaledVector(b.velocity, dt)
  }

  // ball <-> ball collisions
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      resolvePair(balls[i], balls[j])
    }
  }

  // bounds + rolling
  for (const b of balls) {
    const p = b.mesh.position
    const r = b.radius

    if (p.y - r < 0) {
      p.y = r
      if (b.velocity.y < 0) {
        b.velocity.y = Math.abs(b.velocity.y) < 1.2 ? 0 : -b.velocity.y * FLOOR_RESTITUTION
      }
      // ground friction on the horizontal component
      const f = Math.max(0, 1 - ROLL_FRICTION * dt)
      b.velocity.x *= f
      b.velocity.z *= f
    }
    if (p.y + r > bounds.ceiling && b.velocity.y > 0) {
      p.y = bounds.ceiling - r
      b.velocity.y *= -WALL_RESTITUTION
    }
    if (Math.abs(p.x) + r > bounds.x) {
      p.x = Math.sign(p.x) * (bounds.x - r)
      b.velocity.x *= -WALL_RESTITUTION
    }
    if (Math.abs(p.z) + r > bounds.z) {
      p.z = Math.sign(p.z) * (bounds.z - r)
      b.velocity.z *= -WALL_RESTITUTION
    }

    // rolling rotation: spin around the axis perpendicular to travel
    const horizontalSpeed = Math.hypot(b.velocity.x, b.velocity.z)
    if (horizontalSpeed > 0.05) {
      rollAxis.set(b.velocity.x, 0, b.velocity.z).normalize()
      rollAxis.crossVectors(UP, rollAxis)
      const groundFactor = p.y - r < 0.05 ? 1 : 0.3 // slower tumble while airborne
      b.mesh.rotateOnWorldAxis(rollAxis, (horizontalSpeed * dt * groundFactor) / r)
    }
  }
}

function resolvePair(a: Ball, b: Ball): void {
  n.subVectors(b.mesh.position, a.mesh.position)
  const dist = n.length()
  const minDist = a.radius + b.radius
  if (dist >= minDist || dist === 0) return
  n.divideScalar(dist)

  // a dragged ball is immovable from the other ball's perspective
  const invMassA = a.dragged ? 0 : 1 / a.mass
  const invMassB = b.dragged ? 0 : 1 / b.mass
  const invSum = invMassA + invMassB
  if (invSum === 0) return

  // positional correction
  const overlap = minDist - dist
  a.mesh.position.addScaledVector(n, (-overlap * invMassA) / invSum)
  b.mesh.position.addScaledVector(n, (overlap * invMassB) / invSum)

  // impulse
  const relVel = (b.velocity.x - a.velocity.x) * n.x
    + (b.velocity.y - a.velocity.y) * n.y
    + (b.velocity.z - a.velocity.z) * n.z
  if (relVel >= 0) return
  const impulse = (-(1 + BALL_RESTITUTION) * relVel) / invSum
  a.velocity.addScaledVector(n, -impulse * invMassA)
  b.velocity.addScaledVector(n, impulse * invMassB)
}
