import * as THREE from 'three'
import { BlendFunction, Effect } from 'postprocessing'

export type ToneMapper = 'agx' | 'aces' | 'neutral' | 'filmic' | 'reinhard' | 'cineon' | 'linear'

const MODE: Record<ToneMapper, number> = { agx: 0, aces: 1, neutral: 2, filmic: 3, reinhard: 4, cineon: 5, linear: 6 }

/** the operators that take a white point (the HDR level that maps to display white) */
export const WHITE_POINT_MODES: readonly ToneMapper[] = ['filmic', 'reinhard']

const fragmentShader = /* glsl */ `
#include <tonemapping_pars_fragment>
uniform float whitePoint;

// John Hable's Uncharted 2 curve: a film-like toe and shoulder, highlights roll off late
vec3 hableCurve( vec3 x ) {
  const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
  return ( ( x * ( A * x + C * B ) + D * E ) / ( x * ( A * x + B ) + D * F ) ) - E / F;
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 c = max( inputColor.rgb, 0.0 );
  #if TONE_MODE == 0
    c = AgXToneMapping( c );
  #elif TONE_MODE == 1
    c = ACESFilmicToneMapping( c );
  #elif TONE_MODE == 2
    c = NeutralToneMapping( c );
  #elif TONE_MODE == 3
    // (the usual exposure bias of 2: the curve is shaped for a darker input than a lit scene)
    c = clamp( hableCurve( 2.0 * toneMappingExposure * c ) / hableCurve( vec3( whitePoint ) ), 0.0, 1.0 );
  #elif TONE_MODE == 4
    // extended Reinhard on luminance, so hues hold as they compress (per channel desaturates)
    c *= toneMappingExposure;
    float l = max( dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-6 );
    float ld = l * ( 1.0 + l / ( whitePoint * whitePoint ) ) / ( 1.0 + l );
    c = clamp( c * ( ld / l ), 0.0, 1.0 );
  #elif TONE_MODE == 5
    c = CineonToneMapping( c );
  #else
    c = clamp( toneMappingExposure * c, 0.0, 1.0 );
  #endif
  outputColor = vec4( c, inputColor.a );
}
`

/**
 * HDR → display. The pmndrs effect's Reinhard scales colour by the compressed luminance itself
 * (not by its ratio to the input), so it's done here — three's curves for AgX, ACES, Neutral and
 * Cineon, the filmic and Reinhard operators with a white point.
 */
export class ToneMapEffect extends Effect {
  constructor(mode: ToneMapper) {
    super('ToneMapEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      defines: new Map([['TONE_MODE', String(MODE[mode])]]),
      uniforms: new Map([['whitePoint', new THREE.Uniform(4)]]),
    })
  }

  set whitePoint(v: number) {
    this.uniforms.get('whitePoint')!.value = v
  }
}
