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
 *
 * On a clear day direct sun on level ground is ~5× the sky's diffuse light —
 * that's what makes shade read as shade. Measured on a white horizontal patch
 * with the sun at 34°: sun 0.78, sky at full strength 0.45. At 0.55 (plus the
 * hemisphere fill) the ratio was 2.6:1 and shadows looked washed out; 0.3
 * brings it to ~5:1.
 */
export const OUTDOOR_SKY_LIGHT = 0.3

/** a fair-weather sky: cumulus banked low over the horizon, open overhead (a room may pass its own) */
export const CLOUDS = { coverage: 0.47, scale: 0.55, density: 0.9 }

/**
 * Replaces the stock Sky's cloud layer, which fades out toward the horizon
 * and is lit flat. Here a cloud deck is projected from a plane (so clouds
 * bunch up and flatten toward the horizon, as real ones do), each cloud is lit
 * by sampling its own density a step toward the sun — bright on the sunward
 * edge, grey-blue in its core — with sunlight coloured by the air it came
 * through (gold at a low sun), plus the sky's own light from above.
 */
const CLOUD_GLSL = /* glsl */ `
			if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {
				// the cloud deck: +0.035 keeps the horizon from running off to infinity
				vec2 p = direction.xz / ( direction.y + 0.035 ) * cloudScale;
				float d = fbm( p * 2.2 ) + 0.5 * fbm( p * 6.0 + 7.3 );
				d /= 1.5;
				// a bank of cloud low over the horizon, the sky above mostly open
				float cover = cloudCoverage * mix( 1.0, 0.72, smoothstep( 0.04, 0.3, direction.y ) );
				float mask = smoothstep( 1.0 - cover, 1.0 - cover + 0.2, d );
				// melt into the haze right at the horizon
				mask *= smoothstep( 0.0, 0.02, direction.y );
				// one step toward the sun: less cloud there = a lit edge
				vec2 toSun = normalize( vSunDirection.xz + vec2( 1e-4 ) ) * 0.06;
				float ds = ( fbm( ( p + toSun ) * 2.2 ) + 0.5 * fbm( ( p + toSun ) * 6.0 + 7.3 ) ) / 1.5;
				float lit = clamp( 0.55 + ( d - ds ) * 5.0, 0.15, 1.0 );
				// sunlight as it arrives: through the air along the sun's own path
				float sunZenith = acos( max( 0.0, dot( up, vSunDirection ) ) );
				float sunPath = 1.0 / ( cos( sunZenith ) + 0.15 * pow( 93.885 - ( ( sunZenith * 180.0 ) / pi ), -1.253 ) );
				vec3 sunColor = exp( -( vBetaR * rayleighZenithLength + vBetaM * mieZenithLength ) * sunPath );
				sunColor /= max( max( sunColor.r, sunColor.g ), sunColor.b );
				// forward scattering: clouds near the sun glow
				float glow = 1.0 + 2.0 * pow( max( cosTheta, 0.0 ), 8.0 );
				// scaled to the sky behind (the model's output is in its own large units): lit edges
				// a couple of times brighter than the blue around them, cores a grey-blue a bit darker
				float skyL = dot( texColor, vec3( 0.2126, 0.7152, 0.0722 ) );
				vec3 cloudColor = sunColor * skyL * 2.2 * lit * glow + mix( texColor, vec3( skyL ), 0.6 ) * 0.45;
				texColor = mix( texColor, cloudColor, mask * cloudDensity );
			}
`

/** analytic daylight scale → our scene's lighting level (the shader is written for ~0.5 exposure) */
const SKY_GAIN = 0.55

/**
 * Physically based sky (three's Preetham model) for any sun position, with
 * fair-weather clouds: deep blue overhead, paler at the horizon, orange at
 * sunset — it lights the car through the environment map like a photographed
 * sky would, but the sun can be put anywhere.
 */
export function createSky(clouds: typeof CLOUDS = CLOUDS): { mesh: Sky; setSun(direction: THREE.Vector3): void; showSunDisc(on: boolean): void } {
  const sky = new Sky()
  sky.name = 'sky'
  sky.scale.setScalar(2500) // drawn at the far plane regardless (the shader pins z)
  const material = sky.material as THREE.ShaderMaterial
  const u = material.uniforms
  u.turbidity.value = 2.2
  u.rayleigh.value = 1.1
  u.mieCoefficient.value = 0.004
  u.mieDirectionalG.value = 0.82
  u.cloudCoverage.value = clouds.coverage
  u.cloudScale.value = clouds.scale
  u.cloudDensity.value = clouds.density
  u.time.value = 0 // clouds hold still: every frame of a video sees the same sky
  // scale the output to the scene: the stock shader has no exposure of its own
  material.uniforms.skyGain = { value: SKY_GAIN }
  const stock = material.fragmentShader
  const cloudsAt = stock.indexOf('// Clouds')
  const outAt = stock.indexOf('gl_FragColor = vec4( texColor, 1.0 );')
  if (cloudsAt < 0 || outAt < cloudsAt) throw new Error('[garage] Sky shader changed: cloud patch no longer applies')
  material.fragmentShader =
    'uniform float skyGain;\n' + stock.slice(0, cloudsAt) + CLOUD_GLSL + '\n\t\t\tgl_FragColor = vec4( texColor * skyGain, 1.0 );' + stock.slice(outAt + 'gl_FragColor = vec4( texColor, 1.0 );'.length)
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
