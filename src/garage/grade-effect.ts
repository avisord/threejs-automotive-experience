import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'

const fragmentShader = /* glsl */ `
uniform float exposure;
uniform float contrast;
uniform float saturation;
uniform vec3 whiteBalance;
uniform vec3 shadowTint;
uniform vec3 highlightTint;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = max( inputColor.rgb, 0.0 ) * exp2( exposure ) * whiteBalance;

  // contrast pivots on 18% grey in log space, so it works on HDR input
  c = 0.18 * pow( c / 0.18 + 1e-6, vec3( contrast ) );

  // split toning: shadows lean one way, highlights the other
  float stops = log2( max( dot( c, LUMA ), 1e-4 ) / 0.18 );
  c *= mix( shadowTint, highlightTint, smoothstep( -4.0, 3.0, stops ) );

  c = mix( vec3( dot( c, LUMA ) ), c, saturation );
  outputColor = vec4( c, inputColor.a );
}
`

export interface GradeParams {
  /** stops */
  exposure: number
  contrast: number
  saturation: number
  /** -1 cool … +1 warm */
  temperature: number
  /** 0 = off, 1 = full split-tone tint */
  split: number
  shadowTint: THREE.ColorRepresentation
  highlightTint: THREE.ColorRepresentation
}

const LUMA = new THREE.Vector3(0.2126, 0.7152, 0.0722)

/** a tint as a per-channel gain with unit luminance, blended in by `amount` */
function tintGain(color: THREE.ColorRepresentation, amount: number, target: THREE.Vector3): THREE.Vector3 {
  const c = new THREE.Color(color)
  const gain = new THREE.Vector3(c.r, c.g, c.b)
  gain.divideScalar(Math.max(gain.dot(LUMA), 1e-4))
  return target.set(1, 1, 1).lerp(gain, amount)
}

/**
 * Colour grade that runs in linear HDR, *before* tone mapping — exposure,
 * white balance, log-space contrast, split toning and saturation.
 */
export class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['exposure', new THREE.Uniform(0)],
        ['contrast', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['whiteBalance', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['highlightTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    })
  }

  set(p: GradeParams): void {
    const u = this.uniforms
    u.get('exposure')!.value = p.exposure
    u.get('contrast')!.value = p.contrast
    u.get('saturation')!.value = p.saturation
    const t = p.temperature * 0.22
    ;(u.get('whiteBalance')!.value as THREE.Vector3).set(1 + t, 1, 1 - t)
    tintGain(p.shadowTint, p.split, u.get('shadowTint')!.value)
    tintGain(p.highlightTint, p.split, u.get('highlightTint')!.value)
  }
}
