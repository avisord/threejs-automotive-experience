import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

/** where the sun is: azimuth in degrees from +z (the car's nose) toward +x (its left), elevation in degrees */
export interface SunPosition {
  azimuth: number
  elevation: number
}

/** the range the sun controls allow — below ~2° the analytic sky turns to night, which the rooms aren't lit for */
export const SUN_LIMITS = { elevation: { min: 2, max: 80 } }

export function sunDirection(sun: SunPosition, out = new THREE.Vector3()): THREE.Vector3 {
  const a = THREE.MathUtils.degToRad(sun.azimuth)
  const e = THREE.MathUtils.degToRad(sun.elevation)
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e))
}

const noon = new THREE.Color(1.0, 0.96, 0.9)
const golden = new THREE.Color(1.0, 0.62, 0.34)
const horizon = new THREE.Color(1.0, 0.42, 0.2)

/**
 * Sunlight colour and strength for an elevation: through more air near the
 * horizon it's redder and weaker — the same falloff the sky itself shows.
 */
export function sunLight(elevation: number): { color: THREE.Color; intensity: number } {
  const color = new THREE.Color()
  if (elevation < 12) color.copy(horizon).lerp(golden, THREE.MathUtils.smoothstep(elevation, 2, 12))
  else color.copy(golden).lerp(noon, THREE.MathUtils.smoothstep(elevation, 12, 40))
  const intensity = 2.6 * THREE.MathUtils.smoothstep(elevation, -1, 18) + 0.15
  return { color, intensity }
}

/**
 * How strongly the open sky (the outdoor environment map) lights the land.
 * On a clear day the sun outshines the sky several times over; at full
 * strength the sky's fill flattened sunlit and shaded ground into one.
 */
export const OUTDOOR_SKY_LIGHT = 0.55

/** analytic daylight scale → our scene's lighting level (the shader is written for ~0.5 exposure) */
const SKY_GAIN = 0.55

/**
 * Physically based clear sky (three's Preetham model) for any sun position:
 * deep blue overhead, paler at the horizon, orange at sunset — it lights the
 * car through the environment map like a photographed sky would, but the sun
 * can be put anywhere.
 */
export function createSky(): { mesh: Sky; setSun(direction: THREE.Vector3): void; showSunDisc(on: boolean): void } {
  const sky = new Sky()
  sky.name = 'sky'
  sky.scale.setScalar(2500) // drawn at the far plane regardless (the shader pins z)
  const material = sky.material as THREE.ShaderMaterial
  const u = material.uniforms
  u.turbidity.value = 2.2
  u.rayleigh.value = 1.1
  u.mieCoefficient.value = 0.004
  u.mieDirectionalG.value = 0.82
  u.cloudCoverage.value = 0 // a clear sky
  // scale the output to the scene: the stock shader has no exposure of its own
  material.uniforms.skyGain = { value: SKY_GAIN }
  material.fragmentShader =
    'uniform float skyGain;\n' + material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyGain, 1.0 );')
  sky.raycast = () => {}
  // the path tracer can't run the sky shader: an even glow of the sky's average colour stands in
  const standIn = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.45, 0.62, 0.95), side: THREE.BackSide })
  material.userData.pathTrace = standIn

  return {
    mesh: sky,
    setSun(direction) {
      u.sunPosition.value.copy(direction)
      const e = Math.asin(THREE.MathUtils.clamp(direction.y, -1, 1))
      // a lower sun sees a warmer, dimmer sky
      standIn.color.setRGB(0.45, 0.62, 0.95).lerp(new THREE.Color(0.9, 0.55, 0.4), 1 - THREE.MathUtils.smoothstep(e, 0.05, 0.4))
    },
    showSunDisc(on) {
      u.showSunDisc.value = on ? 1 : 0
    },
  }
}
