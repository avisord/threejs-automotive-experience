import * as THREE from 'three'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'

const fragmentShader = /* glsl */ `
uniform float sharpness;
uniform float aberration;
uniform float grain;
uniform float grainSize;

// the lens's lateral chromatic aberration: red and blue land a little apart, more toward the edges
vec3 lensTap( vec2 uv ) {
  if ( aberration <= 0.0 ) return texture2D( inputBuffer, uv ).rgb;
  vec2 d = ( uv - 0.5 ) * aberration * 0.012;
  return vec3(
    texture2D( inputBuffer, uv - d ).r,
    texture2D( inputBuffer, uv ).g,
    texture2D( inputBuffer, uv + d ).b
  );
}

float grainHash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

// value noise, so the grain can be coarser than a pixel without turning into squares
float grainNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( grainHash( i ), grainHash( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( grainHash( i + vec2( 0.0, 1.0 ) ), grainHash( i + vec2( 1.0, 1.0 ) ), f.x ),
    f.y
  );
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  vec3 e = clamp( lensTap( uv ), 0.0, 1.0 );
  vec3 c = e;

  // AMD's contrast-adaptive sharpening: a cross of taps, weighted less where the neighbourhood
  // already has contrast — edges get crisper without halos, flat areas don't gain noise
  if ( sharpness > 0.0 ) {
    vec3 b = clamp( lensTap( uv + vec2( 0.0, texelSize.y ) ), 0.0, 1.0 );
    vec3 d = clamp( lensTap( uv - vec2( texelSize.x, 0.0 ) ), 0.0, 1.0 );
    vec3 f = clamp( lensTap( uv + vec2( texelSize.x, 0.0 ) ), 0.0, 1.0 );
    vec3 h = clamp( lensTap( uv - vec2( 0.0, texelSize.y ) ), 0.0, 1.0 );
    vec3 mn = min( e, min( min( b, d ), min( f, h ) ) );
    vec3 mx = max( e, max( max( b, d ), max( f, h ) ) );
    vec3 amp = sqrt( clamp( min( mn, 1.0 - mx ) / max( mx, 1e-4 ), 0.0, 1.0 ) );
    vec3 w = amp * ( -1.0 / mix( 8.0, 4.0, sharpness ) );
    c = clamp( ( ( b + d + f + h ) * w + e ) / ( 1.0 + 4.0 * w ), 0.0, 1.0 );
  }

  // film grain: in a gamma-2 encoding, strongest in the mid-tones (film's grain hides in deep
  // shadow and blown highlights); a new pattern each frame
  if ( grain > 0.0 ) {
    vec2 p = uv * resolution / grainSize + fract( time * vec2( 17.13, 29.71 ) ) * 311.0;
    float n = grainNoise( p ) + grainNoise( p * 1.7 + 13.1 ) - 1.0;
    vec3 g = sqrt( c );
    float y = dot( g, vec3( 0.2126, 0.7152, 0.0722 ) );
    g += n * grain * 0.16 * ( 0.35 + 2.6 * y * ( 1.0 - y ) );
    c = max( g, 0.0 );
    c *= c;
  }

  outputColor = vec4( c, inputColor.a );
}
`

/**
 * The last touches, after anti-aliasing (they would read as edges to SMAA): sharpening, the
 * lens's colour fringes and film grain. One convolution effect in its own pass.
 */
export class FilmEffect extends Effect {
  constructor() {
    super('FilmEffect', fragmentShader, {
      blendFunction: BlendFunction.SRC,
      attributes: EffectAttribute.CONVOLUTION,
      uniforms: new Map([
        ['sharpness', new THREE.Uniform(0)],
        ['aberration', new THREE.Uniform(0)],
        ['grain', new THREE.Uniform(0)],
        ['grainSize', new THREE.Uniform(1.5)],
      ]),
    })
  }

  set(p: { sharpness: number; aberration: number; grain: number; grainSize: number }): void {
    const u = this.uniforms
    u.get('sharpness')!.value = p.sharpness
    u.get('aberration')!.value = p.aberration
    u.get('grain')!.value = p.grain
    u.get('grainSize')!.value = p.grainSize
  }
}
