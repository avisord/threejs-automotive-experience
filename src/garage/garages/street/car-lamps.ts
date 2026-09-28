import * as THREE from 'three'

/**
 * The street lamps nearest the car as real lights, for the car alone.
 *
 * The lamps' light is drawn per pixel by the street's own materials (lamplight.ts): no shadows, and
 * nothing for the car, which stood unlit and near black beside a bright pavement. Here the few lamps
 * within reach of the car become real spot lights aimed at it, with a shadow map baked once (the car
 * stands still; re-baked when it moves). They light the car, with the lantern's own falloff and
 * colour (the Street lamps group's `output`). The street's materials skip them in three's light loop
 * (they already draw these lamps' pools) and take only their shadow maps, so the car, the post and
 * anything near it shade the pool they stand in.
 *
 * The lights always exist (off = black): a change in the number of lights recompiles every material.
 */
export interface CarLamps {
  /** added to the room's group (with their targets) */
  group: THREE.Group
  /** spot lights, fixed count; active ones have their lamp in `slots` */
  lights: THREE.SpotLight[]
  /** per light: the lamp's centre (xyz) and 1 while it stands in for that lamp, 0 when idle */
  slots: THREE.Vector4[]
  /** aim at the car (its world box), or put every light out (null) */
  place(car: THREE.Box3 | null): void
  /** re-bake the shadow maps (something near the car changed) */
  shadowsChanged(): void
  /** for the street's materials (lamplight.ts): which lamps are real, and their shadow maps */
  uniforms: {
    uRealLamp: { value: THREE.Vector4[] }
    uRealShadow: { value: THREE.Texture[] }
    uRealShadowMatrix: { value: THREE.Matrix4[] }
    /** bias, normal bias, radius, map size */
    uRealShadowParams: { value: THREE.Vector4[] }
  }
  /** before a frame is drawn: re-bake stale maps, and hand the materials the current ones */
  sync(): void
}

export const CAR_LAMP_COUNT = 3

/** a lantern's roof keeps light off the sky: a little dimmer sideways (lamplight.ts, kind 0) */
const lanternCone = (up: number) => 0.45 + 0.55 * THREE.MathUtils.smoothstep(up, -0.1, 0.8)

const OFF = new THREE.Color(0, 0, 0)

/**
 * Stands in for a map not rendered yet. (three binds its own empty shadow texture for a null in a
 * sampler2DShadow array without setting its compare mode: every draw failed with a sampler mismatch.)
 */
const NO_MAP = new THREE.DepthTexture(1, 1)
NO_MAP.compareFunction = THREE.LessEqualCompare
NO_MAP.needsUpdate = true // (a texture never uploaded binds as nothing)

/**
 * `lamps`: lantern centres (w: strength ≤ 1), `output`: the lamps' colour × level (shared with the
 * pools, so the group's switch and dimmer act on both), `reach`: metres, as the pools'.
 */
export function createCarLamps(lamps: THREE.Vector4[], output: THREE.Color, reach: number): CarLamps {
  const group = new THREE.Group()
  group.name = 'car-lamps'
  const lights: THREE.SpotLight[] = []
  const slots: THREE.Vector4[] = []
  for (let i = 0; i < CAR_LAMP_COUNT; i++) {
    const spot = new THREE.SpotLight(OFF, 0, reach, Math.PI / 4, 0.15, 2)
    spot.castShadow = true
    spot.shadow.mapSize.set(1024, 1024)
    // (the lantern's own glass and iron sit round the light: start past them)
    spot.shadow.camera.near = 0.4
    spot.shadow.camera.far = reach
    spot.shadow.bias = -0.0004
    spot.shadow.normalBias = 0.03
    spot.shadow.radius = 2
    spot.shadow.autoUpdate = false
    // (rendered by the first render of all, so the map exists: a shadow-casting light without one is bound
    // as three's empty shadow texture, which in a sampler array has no compare mode — every draw failed)
    spot.shadow.needsUpdate = true
    spot.position.set(0, -1000, 0)
    group.add(spot, spot.target)
    lights.push(spot)
    slots.push(new THREE.Vector4(0, -1000, 0, 0))
  }

  const uniforms = {
    uRealLamp: { value: slots },
    uRealShadow: { value: lights.map((): THREE.Texture => NO_MAP) },
    // (three rewrites each shadow's matrix when it renders the map: the same objects stay current)
    uRealShadowMatrix: { value: lights.map((l) => l.shadow.matrix) },
    uRealShadowParams: {
      value: lights.map((l) => new THREE.Vector4(l.shadow.bias, l.shadow.normalBias, l.shadow.radius, l.shadow.mapSize.x)),
    },
  }

  const centre = new THREE.Vector3()
  // Re-baked only from the frame loop (sync): three renders a shadow map for whichever camera renders
  // next and only with what that camera sees — a light probe's pass (houses and paving, no car) would
  // have baked the car out of it.
  let stale = true
  const to = new THREE.Vector3()
  const axis = new THREE.Vector3()
  const corners = Array.from({ length: 16 }, () => new THREE.Vector3())

  /**
   * Aim a lamp's spot so its shadow map holds the car and the whole shadow it throws: the box's corners
   * and where the lamp casts them on the ground (a map that cut the shadow ended it in a straight edge).
   */
  function aim(spot: THREE.SpotLight, car: THREE.Box3): void {
    const lamp = spot.position
    const floor = car.min.y
    for (let i = 0; i < 8; i++) {
      const c = corners[i].set(i & 1 ? car.max.x : car.min.x, i & 2 ? car.max.y : car.min.y, i & 4 ? car.max.z : car.min.z)
      // along the ray from the lamp through the corner, down to the floor (a corner near the lamp's height: far off, capped)
      const drop = lamp.y - c.y
      const k = drop > 0.05 ? Math.min((lamp.y - floor) / drop, 4) : 4
      corners[i + 8].copy(c).sub(lamp).multiplyScalar(k).add(lamp)
    }
    axis.set(0, 0, 0)
    for (const c of corners) axis.add(to.copy(c).sub(lamp).normalize())
    axis.normalize()
    let widest = 0
    for (const c of corners) widest = Math.max(widest, axis.angleTo(to.copy(c).sub(lamp)))
    spot.target.position.copy(lamp).add(axis)
    spot.target.updateMatrixWorld()
    spot.angle = THREE.MathUtils.clamp(widest + THREE.MathUtils.degToRad(4), THREE.MathUtils.degToRad(15), THREE.MathUtils.degToRad(80))
  }
  return {
    group,
    lights,
    slots,
    place(car) {
      const near: { lamp: THREE.Vector4; d: number }[] = []
      if (car) {
        car.getCenter(centre)
        for (const lamp of lamps) {
          const d = Math.hypot(lamp.x - centre.x, lamp.y - centre.y, lamp.z - centre.z)
          if (d < reach - 1) near.push({ lamp, d })
        }
        near.sort((a, b) => a.d - b.d)
      }
      lights.forEach((spot, i) => {
        const pick = near[i]
        if (!pick || !car) {
          spot.color = OFF
          spot.intensity = 0
          spot.position.set(0, -1000, 0)
          slots[i].set(0, -1000, 0, 0)
        } else {
          const { lamp } = pick
          spot.position.set(lamp.x, lamp.y, lamp.z)
          to.copy(spot.position).sub(centre).normalize()
          spot.color = output // (the same object: the group's switch, level and warmth act at once)
          spot.intensity = lamp.w * lanternCone(to.y)
          aim(spot, car)
          slots[i].set(lamp.x, lamp.y, lamp.z, 1)
        }
      })
      stale = true
    },
    shadowsChanged() {
      stale = true
    },
    uniforms,
    sync() {
      if (stale) for (const l of lights) l.shadow.needsUpdate = true
      stale = false
      lights.forEach((l, i) => (uniforms.uRealShadow.value[i] = l.shadow.map?.depthTexture ?? NO_MAP))
    },
  }
}
