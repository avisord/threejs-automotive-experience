import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'

/** one colour wheel: a push toward a hue (x, y in the unit disc; 0° red, 120° green, 240° blue) and a brightness offset */
export interface Wheel {
  x: number
  y: number
  /** -1 … +1 */
  l: number
}

export const NEUTRAL_WHEEL: Wheel = { x: 0, y: 0, l: 0 }

const fragmentShader = /* glsl */ `
uniform vec3 balanceLift;
uniform vec3 balanceGamma;
uniform vec3 balanceGain;

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  // on display-referred values (after tone mapping), in a gamma-2 encoding so the wheels act on
  // tones the way the eye splits them into shadows, mid-tones and highlights
  vec3 c = sqrt( clamp( inputColor.rgb, 0.0, 1.0 ) );
  c = c * balanceGain + balanceLift * ( 1.0 - c );
  c = pow( max( c, 0.0 ), 1.0 / balanceGamma );
  outputColor = vec4( c * c, inputColor.a );
}
`

// the wheel's chroma axes in RGB: each sums to zero, so a hue push leaves brightness about where it was
const AXIS_U = new THREE.Vector3(1, -0.5, -0.5)
const AXIS_V = new THREE.Vector3(0, Math.sqrt(3) / 2, -Math.sqrt(3) / 2)

/** a wheel as a per-channel offset: brightness plus the hue push, each scaled to the control's range */
function offset(w: Wheel, chroma: number, luma: number, out: THREE.Vector3): THREE.Vector3 {
  return out
    .set(0, 0, 0)
    .addScaledVector(AXIS_U, w.x * chroma)
    .addScaledVector(AXIS_V, w.y * chroma)
    .addScalar(w.l * luma)
}

/**
 * Lift / gamma / gain, as a colourist's three wheels: lift moves the shadows (black point), gamma
 * the mid-tones, gain the highlights (white point) — each toward a hue and brighter or darker.
 */
export class ColourBalanceEffect extends Effect {
  constructor() {
    super('ColourBalanceEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      uniforms: new Map([
        ['balanceLift', new THREE.Uniform(new THREE.Vector3())],
        ['balanceGamma', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
        ['balanceGain', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
      ]),
    })
  }

  set(lift: Wheel, gamma: Wheel, gain: Wheel): void {
    const u = this.uniforms
    offset(lift, 0.12, 0.15, u.get('balanceLift')!.value)
    offset(gamma, 0.35, 0.5, u.get('balanceGamma')!.value).addScalar(1)
    offset(gain, 0.35, 0.5, u.get('balanceGain')!.value).addScalar(1)
    ;(u.get('balanceGamma')!.value as THREE.Vector3).max(new THREE.Vector3(0.2, 0.2, 0.2))
  }
}
