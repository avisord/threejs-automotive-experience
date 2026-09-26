import * as THREE from 'three'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'

const fragmentShader = /* glsl */ `
uniform vec3 uSun;        // xy: the sun's screen uv, z: 1 when it's in front of the camera
uniform vec3 uSunColor;
uniform float uIntensity;

// how much of the sun's disc is unobstructed: depth samples on a small disc around it (sky = far plane).
// Off-screen samples count as hidden, so the flare fades out as the sun leaves the frame.
float sunVisibility() {
  vec2 r = texelSize * 7.0;
  float seen = 0.0;
  for ( int i = 0; i < 16; i ++ ) {
    float a = float( i ) * 2.39996323;
    vec2 p = uSun.xy + vec2( cos( a ), sin( a ) ) * r * sqrt( ( float( i ) + 0.5 ) / 16.0 );
    bool inside = all( greaterThan( p, vec2( 0.0 ) ) ) && all( lessThan( p, vec2( 1.0 ) ) );
    seen += inside && readDepth( p ) >= 0.9999999 ? 1.0 : 0.0;
  }
  return seen / 16.0;
}

// a soft-edged disc (a ghost of the aperture)
float ghost( vec2 uv, vec2 at, float radius ) {
  float d = length( ( uv - at ) * vec2( aspect, 1.0 ) );
  return smoothstep( radius, radius * 0.55, d ) * ( 0.6 + 0.4 * smoothstep( radius * 0.4, radius, d ) );
}

void mainImage( const in vec4 inputColor, const in vec2 uv, out vec4 outputColor ) {
  outputColor = inputColor;
  if ( uSun.z < 0.5 || uIntensity <= 0.0 ) return;
  float vis = sunVisibility();
  if ( vis <= 0.0 ) return;
  // the sky around the sun is already several times brighter than lit ground in HDR: the flare has
  // to be as bright to read over it (at ~0.5 it vanished into the sky and only showed over the roof)
  vec3 light = uSunColor * vis * uIntensity * 6.0;

  vec2 d = ( uv - uSun.xy ) * vec2( aspect, 1.0 );
  float len = length( d );
  // glare around the sun: a tight core and a wide veil
  float glow = 0.5 * exp( -len * 16.0 ) + 0.07 * exp( -len * 3.5 );
  // the aperture's starburst: a few long spikes and finer ones between
  float a = atan( d.y, d.x );
  float spikes = pow( abs( cos( a * 3.0 + 0.4 ) ), 90.0 ) + 0.5 * pow( abs( cos( a * 7.0 + 1.3 ) ), 160.0 );
  float star = spikes * exp( -len * 7.0 ) * 0.35;
  // a faint horizontal streak, as from a coated lens
  float streak = exp( -abs( d.y ) * 140.0 ) * exp( -abs( d.x ) * 2.5 ) * 0.08;

  vec3 flare = light * ( glow + star + streak );

  // ghosts: reflections between lens elements, strung along the line from the sun through the
  // centre, each tinted by the coatings — a little chromatic spread between channels
  vec2 axis = uSun.xy - 0.5;
  vec3 ghosts = vec3( 0.0 );
  ghosts += vec3( 0.25, 0.55, 0.35 ) * ghost( uv, 0.5 - axis * 0.35, 0.035 );
  ghosts += vec3( 0.6, 0.35, 0.2 ) * ghost( uv, 0.5 - axis * 0.7, 0.06 );
  ghosts += vec3( 0.2, 0.3, 0.6 ) * ghost( uv, 0.5 - axis * 1.15, 0.11 );
  ghosts += vec3( 0.45, 0.3, 0.55 ) * ghost( uv, 0.5 + axis * 0.45, 0.02 );
  ghosts += vec3( 0.3, 0.45, 0.5 ) * ghost( uv, 0.5 - axis * 1.6, 0.16 ) * 0.5;
  // a halo ring around the frame's centre, brightest on the sun's side
  vec2 c = ( uv - 0.5 ) * vec2( aspect, 1.0 );
  float ring = exp( -abs( length( c ) - 0.48 ) * 70.0 ) * pow( max( dot( normalize( c + 1e-5 ), normalize( axis * vec2( aspect, 1.0 ) + 1e-5 ) ), 0.0 ), 4.0 );
  ghosts += vec3( 0.5, 0.45, 0.35 ) * ring * 0.35;
  // ghosts fade as the sun nears the centre (they collapse onto it) — and they're faint
  flare += light * ghosts * 0.1 * smoothstep( 0.02, 0.2, length( axis ) );

  outputColor = vec4( inputColor.rgb + flare, inputColor.a );
}
`

/**
 * A camera lens looking toward the sun: glare, a starburst, a faint
 * horizontal streak and a string of coloured ghosts through the frame's
 * centre, all scaled by how much of the sun's disc is unobstructed (read from
 * the depth buffer — mullions, trees and the roof put it out). Applied in HDR
 * before grading. The room gives the sun (its atmosphere params); garages
 * without a sun get none.
 */
export class LensFlareEffect extends Effect {
  private camera: THREE.Camera
  private sunDirection: THREE.Vector3 | null = null
  private sunColor: THREE.Color | null = null
  private readonly tmp = new THREE.Vector3()
  private readonly forward = new THREE.Vector3()

  constructor(camera: THREE.Camera) {
    super('LensFlareEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map<string, THREE.Uniform>([
        ['uSun', new THREE.Uniform(new THREE.Vector3())],
        ['uSunColor', new THREE.Uniform(new THREE.Color())],
        ['uIntensity', new THREE.Uniform(1)],
      ]),
    })
    this.camera = camera
  }

  /** the sun to flare (live objects the room updates), or null for none */
  setSun(direction: THREE.Vector3 | null, color: THREE.Color | null): void {
    this.sunDirection = direction
    this.sunColor = color
  }

  set intensity(v: number) {
    this.uniforms.get('uIntensity')!.value = v
  }

  override update(): void {
    const sun = this.uniforms.get('uSun')!.value as THREE.Vector3
    if (!this.sunDirection || !this.sunColor) {
      sun.z = 0
      return
    }
    this.camera.getWorldDirection(this.forward)
    const inFront = this.forward.dot(this.sunDirection) > 0.05
    this.tmp.setFromMatrixPosition(this.camera.matrixWorld).addScaledVector(this.sunDirection, 1000).project(this.camera)
    sun.set(this.tmp.x * 0.5 + 0.5, this.tmp.y * 0.5 + 0.5, inFront ? 1 : 0)
    ;(this.uniforms.get('uSunColor')!.value as THREE.Color).copy(this.sunColor)
  }
}
