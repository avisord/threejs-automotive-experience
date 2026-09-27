import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'

const fragmentShader = /* glsl */ `
uniform float exposure;
uniform sampler2D meterMap;
uniform float meterLevel;
uniform float autoStrength;
uniform float autoKey;
uniform float autoRange;
uniform float contrast;
uniform float saturation;
uniform vec3 whiteBalance;
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float lift;
uniform vec3 fillTint;

const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  // auto exposure: the metered mean log luminance (exposure-meter.ts) brought toward the key, by
  // autoStrength (1 = all the way: every scene the same brightness; less keeps some of its own)
  float ev = exposure;
  if ( autoStrength > 0.0 ) {
    vec2 m = textureLod( meterMap, vec2( 0.5 ), meterLevel ).rg;
    float mean = m.x / max( m.y, 1e-4 );
    ev += autoStrength * clamp( autoKey - mean, -autoRange, autoRange );
  }
  vec3 c = max( inputColor.rgb, 0.0 ) * exp2( ev ) * whiteBalance;

  // contrast pivots on 18% grey in log space, so it works on HDR input
  c = 0.18 * pow( c / 0.18 + 1e-6, vec3( contrast ) );

  // shadow lift: shade more than ~6 stops under mid grey opened up by lift stops, easing out by half a
  // stop under it — a game's fill light, as a toe in log space (mid-tones and the contrast above keep
  // their bite). Half of it is a gain, half an added fill in the look's shadow colour: a gain alone
  // can't lift a channel that is ~0 (low-sun shade on saturated grass had no blue at all, and stayed
  // black-green); the fill gives the shade the sky's blue. Luminance comes out as the toe says.
  float stops = log2( max( dot( c, LUMA ), 1e-5 ) / 0.18 );
  float y = max( dot( c, LUMA ), 1e-5 );
  float lifted = y * exp2( lift * ( 1.0 - smoothstep( -6.0, -0.5, stops ) ) );
  c = 0.5 * c * ( lifted / y ) + 0.5 * ( c + ( lifted - y ) * fillTint );

  // split toning: shadows lean one way, highlights the other
  stops = log2( max( dot( c, LUMA ), 1e-4 ) / 0.18 );
  c *= mix( shadowTint, highlightTint, smoothstep( -4.0, 3.0, stops ) );

  c = mix( vec3( dot( c, LUMA ) ), c, saturation );
  outputColor = vec4( c, inputColor.a );
}
`

export interface GradeParams {
  /** stops */
  exposure: number
  /** auto exposure, 0 off … 1 full (see `setMeter`) */
  auto: number
  /** the mean log2 luminance auto exposure brings a view toward (the garage's `exposureKey`) */
  key?: number
  contrast: number
  saturation: number
  /** -1 cool … +1 warm */
  temperature: number
  /** 0 = off, 1 = full split-tone tint */
  split: number
  shadowTint: THREE.ColorRepresentation
  highlightTint: THREE.ColorRepresentation
  /** stops the deep shade is opened up by (0 = off) */
  lift?: number
}

const LUMA = new THREE.Vector3(0.2126, 0.7152, 0.0722)

/** the mean log2 luminance auto exposure brings a view toward when no garage says otherwise, and how many stops it may move it */
export const AUTO_KEY = -2.6
export const AUTO_RANGE = 2

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
        ['meterMap', new THREE.Uniform(null)],
        ['meterLevel', new THREE.Uniform(0)],
        ['autoStrength', new THREE.Uniform(0)],
        ['autoKey', new THREE.Uniform(AUTO_KEY)],
        ['autoRange', new THREE.Uniform(AUTO_RANGE)],
        ['contrast', new THREE.Uniform(1)],
        ['saturation', new THREE.Uniform(1)],
        ['whiteBalance', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['shadowTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['highlightTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['lift', new THREE.Uniform(0)],
        ['fillTint', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    })
  }

  /** where the metered luminance is (null: no meter, auto exposure off) */
  setMeter(texture: THREE.Texture | null, topLevel: number): void {
    this.uniforms.get('meterMap')!.value = texture
    this.uniforms.get('meterLevel')!.value = topLevel
  }

  set(p: GradeParams): void {
    const u = this.uniforms
    u.get('exposure')!.value = p.exposure
    u.get('autoStrength')!.value = u.get('meterMap')!.value ? p.auto : 0
    u.get('autoKey')!.value = p.key ?? AUTO_KEY
    u.get('contrast')!.value = p.contrast
    u.get('saturation')!.value = p.saturation
    const t = p.temperature * 0.22
    ;(u.get('whiteBalance')!.value as THREE.Vector3).set(1 + t, 1, 1 - t)
    tintGain(p.shadowTint, p.split, u.get('shadowTint')!.value)
    tintGain(p.highlightTint, p.split, u.get('highlightTint')!.value)
    u.get('lift')!.value = p.lift ?? 0
    tintGain(p.shadowTint, 1, u.get('fillTint')!.value)
  }
}
