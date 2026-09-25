import * as THREE from 'three'
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing'

/** what an open-air room tells the atmosphere effect about its air (all live: the room updates them) */
export interface AtmosphereParams {
  /** unit vector toward the sun */
  sunDirection: THREE.Vector3
  /** sunlight colour × strength */
  sunColor: THREE.Color
  /** the colour of the air toward the horizon, away from the sun */
  airColor: THREE.Color
  /** haze extinction at ground level, per metre */
  density: number
  /** how fast the haze thins with height, per metre */
  falloff: number
  /** ground level the haze sits on */
  groundY: number
  /**
   * A second, low layer: mist lying in the valleys (per metre at ground level, thinning per
   * metre of height). Ridge bases sit in it and their crests rise out of it, so ranges stacked
   * one behind another each read as their own layer.
   */
  mist?: { density: number; falloff: number }
  /**
   * A thin, tall layer (the clear air itself, kilometres deep): little over a
   * few kilometres, but it keeps paling ranges 20–30 km off whose crests stand
   * above the haze and mist — without it they held the same contrast as the
   * ranges at 9 km, and the layers didn't recede.
   */
  air?: { density: number; falloff: number }
  /**
   * Far layers drawn closer than they are (a distance-compressed backdrop):
   * past `start` metres, a drawn distance d stands for start + (d − start) × factor.
   */
  compress?: { start: number; factor: number }
  /** a shadow-casting sun: its shadow map carves light shafts out of the near air */
  shaftLight: THREE.DirectionalLight | null
  /** scattering of the open near air that shows the shafts, per metre — keep it faint, it's everywhere */
  shaftDensity: number
  /** how far the shafts are marched, metres */
  shaftRange: number
  /**
   * Dustier air inside a building: sunbeams read strongly under a roof and
   * past columns, while the open air outside stays clear.
   */
  dust?: { box: THREE.Box3; density: number }
}

const fragmentShader = /* glsl */ `
uniform mat4 uProjectionInverse;
uniform mat4 uCameraWorld;
uniform vec3 uCameraPosition;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAirColor;
uniform float uDensity;
uniform float uFalloff;
uniform float uGroundY;
uniform float uMistDensity;
uniform float uMistFalloff;
uniform float uAirDensity;
uniform float uAirFalloff;
uniform float uCompressStart;
uniform float uCompressFactor;
uniform float uStrength;
uniform float uShaftStrength;
uniform float uShaftDensity;
uniform float uShaftRange;
uniform float uShafts;
uniform mat4 uShadowMatrix;
uniform sampler2DShadow uShadowMap;
uniform float uShadowBias;
uniform vec3 uDustMin;
uniform vec3 uDustMax;
uniform float uDustDensity;


// Henyey–Greenstein: how much light scatters toward the eye at angle cosTheta from the sun
float phaseHG( float cosTheta, float g ) {
  float g2 = g * g;
  return ( 1.0 - g2 ) / ( 12.566371 * pow( 1.0 + g2 - 2.0 * g * cosTheta, 1.5 ) );
}

// optical depth of exponential height fog along a ray: ∫ density·exp(−falloff·(h0 + rd.y·s)) ds, s ∈ [0, dist].
// = dist · (1 − e^−x) / x, x = falloff·rd.y·dist; near x = 0 the series stands in for the division.
// (Switching to plain dist at a fixed |falloff·rd.y| put a step in the haze at one elevation angle —
// ~7° with a 1.2 km scale height — that cut across the mountain as a hard line.)
float fogDepth( float density, float falloff, float h0, float rdy, float dist ) {
  float x = falloff * rdy * dist;
  float shape = abs( x ) > 1e-3 ? ( 1.0 - exp( -x ) ) / x : 1.0 - 0.5 * x + x * x / 6.0;
  return density * exp( -falloff * h0 ) * dist * shape;
}

// interleaved gradient noise: a per-pixel offset that turns banding into fine grain
float ign( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}

float sunVisible( vec3 p ) {
  vec4 s = uShadowMatrix * vec4( p, 1.0 );
  s.xyz /= s.w;
  if ( s.x <= 0.0 || s.x >= 1.0 || s.y <= 0.0 || s.y >= 1.0 || s.z >= 1.0 ) return 1.0; // outside the map: open sky
  return texture( uShadowMap, vec3( s.xy, s.z - uShadowBias ) );
}

void mainImage( const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor ) {
  // the view ray through this pixel, and how far along it the surface is
  vec4 far = uProjectionInverse * vec4( uv * 2.0 - 1.0, 1.0, 1.0 );
  vec3 viewDir = far.xyz / far.w;
  // the sky is pinned to the far plane (depth 1). A looser test (0.99999) took everything drawn past
  // ~5.4 km for sky with a 0.1 m / 12 km camera — the far ranges and Fuji's upper cone went unhazed
  bool sky = depth >= 0.9999999;
  float viewZ = sky ? -1e6 : getViewZ( depth );
  vec3 viewPos = viewDir * ( viewZ / viewDir.z );
  vec3 rd = normalize( ( uCameraWorld * vec4( viewDir, 0.0 ) ).xyz );
  float drawn = sky ? 0.0 : length( viewPos );
  // the backdrop past the compression start stands for land much farther off
  float dist = drawn > uCompressStart ? uCompressStart + ( drawn - uCompressStart ) * uCompressFactor : drawn;

  float mu = dot( rd, uSunDir );
  vec3 color = inputColor.rgb;

  // ─── aerial perspective: exponential height fog, lit by the sky and the sun ───
  // the sky already carries its own atmosphere, so it gets none added
  if ( !sky ) {
    float h0 = max( uCameraPosition.y - uGroundY, 0.0 );
    float opticalDepth =
      ( fogDepth( uDensity, uFalloff, h0, rd.y, dist ) + fogDepth( uMistDensity, uMistFalloff, h0, rd.y, dist ) +
        fogDepth( uAirDensity, uAirFalloff, h0, rd.y, dist ) ) * uStrength;
    float transmittance = exp( -opticalDepth );
    // the air's own glow, brighter toward the sun (forward scattering) — kept modest: at 0.7+ and full
    // strength a sunward view washes out to white within a hundred metres
    vec3 inscatter = uAirColor + uSunColor * phaseHG( mu, 0.6 ) * 0.4;
    color = color * transmittance + inscatter * ( 1.0 - transmittance );
  }

  // ─── light shafts: march the near air, sampling the sun's shadow map ───
  if ( uShafts > 0.5 ) {
    float range = sky ? uShaftRange : min( drawn, uShaftRange );
    float stepLen = range / float( STEPS );
    float t = stepLen * ign( gl_FragCoord.xy );
    float scattered = 0.0;
    for ( int i = 0; i < STEPS; i ++ ) {
      vec3 p = uCameraPosition + rd * t;
      bool indoors = all( greaterThan( p, uDustMin ) ) && all( lessThan( p, uDustMax ) );
      scattered += sunVisible( p ) * ( indoors ? uDustDensity : uShaftDensity );
      t += stepLen;
    }
    // dust scatters less directionally than haze: beams stay visible from the side, not only sunward
    color += uSunColor * phaseHG( mu, 0.35 ) * scattered * stepLen * uShaftStrength;
  }

  outputColor = vec4( color, inputColor.a );
}
`

/**
 * The air of an open-air garage, applied from the depth buffer in linear HDR
 * before grading and tone mapping:
 *
 *  - aerial perspective — distance haze that thins with height, bluish away
 *    from the sun and bright toward it, so far hills, forests and the mountain
 *    sit back in the air instead of looking pasted on
 *  - volumetric light — the near air is ray-marched through the sun's shadow
 *    map, so sunlight falling through the skylight and past the columns
 *    shows as shafts, and shadowed space stays clear
 */
export class AtmosphereEffect extends Effect {
  private params: AtmosphereParams | null = null
  private camera: THREE.Camera

  constructor(camera: THREE.Camera) {
    super('AtmosphereEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      attributes: EffectAttribute.DEPTH,
      defines: new Map([['STEPS', '28']]),
      uniforms: new Map<string, THREE.Uniform>([
        ['uProjectionInverse', new THREE.Uniform(new THREE.Matrix4())],
        ['uCameraWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCameraPosition', new THREE.Uniform(new THREE.Vector3())],
        ['uSunDir', new THREE.Uniform(new THREE.Vector3(0, 1, 0))],
        ['uSunColor', new THREE.Uniform(new THREE.Color())],
        ['uAirColor', new THREE.Uniform(new THREE.Color())],
        ['uDensity', new THREE.Uniform(0)],
        ['uFalloff', new THREE.Uniform(0.01)],
        ['uGroundY', new THREE.Uniform(0)],
        ['uMistDensity', new THREE.Uniform(0)],
        ['uMistFalloff', new THREE.Uniform(0.01)],
        ['uAirDensity', new THREE.Uniform(0)],
        ['uAirFalloff', new THREE.Uniform(0.001)],
        ['uCompressStart', new THREE.Uniform(1e9)],
        ['uCompressFactor', new THREE.Uniform(1)],
        ['uStrength', new THREE.Uniform(1)],
        ['uShaftStrength', new THREE.Uniform(1)],
        ['uShaftDensity', new THREE.Uniform(0)],
        ['uShaftRange', new THREE.Uniform(50)],
        ['uShafts', new THREE.Uniform(0)],
        ['uShadowMatrix', new THREE.Uniform(new THREE.Matrix4())],
        ['uShadowMap', new THREE.Uniform(null)],
        ['uShadowBias', new THREE.Uniform(0.0015)],
        ['uDustMin', new THREE.Uniform(new THREE.Vector3())],
        ['uDustMax', new THREE.Uniform(new THREE.Vector3())],
        ['uDustDensity', new THREE.Uniform(0)],
      ]),
    })
    this.camera = camera
  }

  setParams(params: AtmosphereParams | null): void {
    this.params = params
  }

  /** haze: 0 = clear air, 1 = as the room describes it, more = thicker */
  set strength(v: number) {
    this.uniforms.get('uStrength')!.value = v
  }

  /** light shafts (volumetric light): 0 = off, 1 = as the room describes it */
  set shaftStrength(v: number) {
    this.uniforms.get('uShaftStrength')!.value = v
  }

  /** ray-march steps for the shafts: fewer is cheaper and grainier */
  set shaftSteps(n: number) {
    if (this.defines.get('STEPS') === String(n)) return
    this.defines.set('STEPS', String(n))
    this.setChanged()
  }

  override update(): void {
    const u = this.uniforms
    const p = this.params
    const camera = this.camera
    u.get('uProjectionInverse')!.value.copy(camera.projectionMatrixInverse)
    u.get('uCameraWorld')!.value.copy(camera.matrixWorld)
    u.get('uCameraPosition')!.value.setFromMatrixPosition(camera.matrixWorld)
    if (!p) {
      u.get('uDensity')!.value = 0
      u.get('uMistDensity')!.value = 0
      u.get('uAirDensity')!.value = 0
      u.get('uShafts')!.value = 0
      return
    }
    u.get('uSunDir')!.value.copy(p.sunDirection)
    u.get('uSunColor')!.value.copy(p.sunColor)
    u.get('uAirColor')!.value.copy(p.airColor)
    u.get('uDensity')!.value = p.density
    u.get('uFalloff')!.value = p.falloff
    u.get('uGroundY')!.value = p.groundY
    u.get('uMistDensity')!.value = p.mist?.density ?? 0
    u.get('uMistFalloff')!.value = p.mist?.falloff ?? 0.01
    u.get('uAirDensity')!.value = p.air?.density ?? 0
    u.get('uAirFalloff')!.value = p.air?.falloff ?? 0.001
    u.get('uCompressStart')!.value = p.compress?.start ?? 1e9
    u.get('uCompressFactor')!.value = p.compress?.factor ?? 1
    u.get('uShaftDensity')!.value = p.shaftDensity
    u.get('uShaftRange')!.value = p.shaftRange
    u.get('uDustDensity')!.value = p.dust?.density ?? p.shaftDensity
    if (p.dust) {
      u.get('uDustMin')!.value.copy(p.dust.box.min)
      u.get('uDustMax')!.value.copy(p.dust.box.max)
    }
    const map = p.shaftLight?.shadow.map?.depthTexture ?? null
    u.get('uShafts')!.value = map && u.get('uShaftStrength')!.value > 0 ? 1 : 0
    if (map && p.shaftLight) {
      u.get('uShadowMap')!.value = map
      u.get('uShadowMatrix')!.value.copy(p.shaftLight.shadow.matrix)
    }
  }
}
