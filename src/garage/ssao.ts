import * as THREE from 'three'
import { Pass } from 'postprocessing'

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`

const common = /* glsl */ `
uniform sampler2D depthBuffer;
uniform mat4 inverseProjection;
varying vec2 vUv;

vec3 viewPosition( vec2 uv ) {
  float d = texture2D( depthBuffer, uv ).r;
  vec4 p = inverseProjection * vec4( uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0 );
  return p.xyz / p.w;
}
`

const aoFragment = /* glsl */ `
${common}
uniform vec2 texel;       // one full-resolution pixel, in uv
uniform float radius;     // metres
uniform float bias;       // cosine below which an occluder doesn't count (flat-surface self-occlusion)
uniform float projScale;  // uv height per metre at 1 m
uniform float aspect;
uniform int samples;

float ign( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}

void main() {
  gl_FragColor = vec4( 1.0 );
  if ( texture2D( depthBuffer, vUv ).r >= 0.9999999 ) return; // the sky
  vec3 p = viewPosition( vUv );
  // the normal from depth: of the two neighbours on each axis, the one on the same surface
  vec3 r = viewPosition( vUv + vec2( texel.x, 0.0 ) ) - p;
  vec3 l = p - viewPosition( vUv - vec2( texel.x, 0.0 ) );
  vec3 u = viewPosition( vUv + vec2( 0.0, texel.y ) ) - p;
  vec3 d = p - viewPosition( vUv - vec2( 0.0, texel.y ) );
  vec3 n = normalize( cross( abs( r.z ) < abs( l.z ) ? r : l, abs( u.z ) < abs( d.z ) ? u : d ) );

  // the radius on screen; up close it's capped (a huge disc samples too sparsely to mean anything)
  float disc = min( radius * projScale / -p.z, 0.2 );
  if ( disc < 2.0 * texel.y ) return;
  float spin = ign( gl_FragCoord.xy ) * 6.2831853;
  float occlusion = 0.0;
  for ( int i = 0; i < 32; i ++ ) {
    if ( i >= samples ) break;
    // a spiral of taps, denser toward the centre, turned per pixel (the blur evens the pattern out)
    float t = ( float( i ) + 0.5 ) / float( samples );
    float a = spin + t * 43.98;
    vec2 o = vec2( cos( a ) / aspect, sin( a ) ) * disc * t;
    vec3 v = viewPosition( vUv + o ) - p;
    float vv = dot( v, v );
    // Alchemy AO: how far above the surface's tangent plane the occluder sits, fading out by radius
    float fade = max( 1.0 - vv / ( radius * radius ), 0.0 );
    occlusion += fade * max( dot( v, n ) * inversesqrt( vv + 1e-4 ) - bias, 0.0 );
  }
  gl_FragColor = vec4( vec3( 1.0 - 2.0 * occlusion / float( samples ) ), 1.0 );
}
`

const blurFragment = /* glsl */ `
${common}
uniform sampler2D aoBuffer;
uniform vec2 direction; // one half-res texel along the blur axis, in uv

void main() {
  float z = -viewPosition( vUv ).z;
  float sum = 0.0;
  float weight = 0.0;
  for ( int i = -3; i <= 3; i ++ ) {
    vec2 uv = vUv + direction * float( i );
    // (only the same surface: across a silhouette the car's shade would bleed onto the wall behind)
    float w = exp( -float( i * i ) / 5.0 ) * exp( -abs( -viewPosition( uv ).z - z ) / ( 0.03 * z + 0.02 ) );
    sum += texture2D( aoBuffer, uv ).r * w;
    weight += w;
  }
  gl_FragColor = vec4( vec3( sum / weight ), 1.0 );
}
`

const compositeFragment = /* glsl */ `
${common}
uniform sampler2D inputBuffer;
uniform sampler2D aoBuffer;
uniform vec2 aoSize;
uniform float intensity;
uniform bool aoOnly;

void main() {
  // depth-aware upsampling: of the four half-res texels around, those on this pixel's surface
  float z = -viewPosition( vUv ).z;
  vec2 hp = vUv * aoSize - 0.5;
  vec2 base = floor( hp );
  vec2 f = hp - base;
  float sum = 0.0;
  float weight = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec2 c = vec2( float( i - ( i / 2 ) * 2 ), float( i / 2 ) );
    vec2 uv = ( base + c + 0.5 ) / aoSize;
    vec2 b = mix( 1.0 - f, f, c );
    float w = b.x * b.y / ( 1e-3 + abs( -viewPosition( uv ).z - z ) / z );
    sum += texture2D( aoBuffer, uv ).r * w;
    weight += w;
  }
  float visibility = pow( clamp( sum / max( weight, 1e-6 ), 0.0, 1.0 ), intensity );
  vec4 base4 = texture2D( inputBuffer, vUv );
  gl_FragColor = aoOnly ? vec4( vec3( visibility ), 1.0 ) : vec4( base4.rgb * visibility, base4.a );
}
`

/**
 * Classic screen-space ambient occlusion (Alchemy/SAO): a spiral of taps round each pixel, in a
 * radius given in metres, counting what rises above the surface's tangent plane. Half resolution,
 * a depth-aware blur and upsample, then multiplied into the frame. Normals come from depth, so it
 * costs no extra scene draw. The other method, N8AO, is softer; this one draws tighter creases.
 */
export class SsaoPass extends Pass {
  radius = 0.6
  bias = 0.05
  intensity = 1.5
  samples = 16
  aoOnly = false

  private readonly view: THREE.PerspectiveCamera
  private readonly aoTarget: THREE.WebGLRenderTarget
  private readonly blurTarget: THREE.WebGLRenderTarget
  private readonly aoMaterial: THREE.ShaderMaterial
  private readonly blurMaterial: THREE.ShaderMaterial
  private readonly compositeMaterial: THREE.ShaderMaterial

  constructor(camera: THREE.PerspectiveCamera) {
    super('SsaoPass')
    this.view = camera
    this.needsDepthTexture = true
    this.enabled = false
    const options = { depthBuffer: false, type: THREE.HalfFloatType }
    this.aoTarget = new THREE.WebGLRenderTarget(1, 1, options)
    this.blurTarget = new THREE.WebGLRenderTarget(1, 1, options)
    this.aoTarget.texture.name = 'SSAO'
    this.blurTarget.texture.name = 'SSAO.Blur'
    const shared = {
      depthBuffer: { value: null as THREE.Texture | null },
      inverseProjection: { value: new THREE.Matrix4() },
    }
    const material = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>) =>
      new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...shared, ...uniforms }, depthTest: false, depthWrite: false })
    this.aoMaterial = material(aoFragment, {
      texel: { value: new THREE.Vector2() },
      radius: { value: 0 },
      bias: { value: 0 },
      projScale: { value: 1 },
      aspect: { value: 1 },
      samples: { value: 16 },
    })
    this.blurMaterial = material(blurFragment, { aoBuffer: { value: null }, direction: { value: new THREE.Vector2() } })
    this.compositeMaterial = material(compositeFragment, {
      inputBuffer: { value: null },
      aoBuffer: { value: this.aoTarget.texture },
      aoSize: { value: new THREE.Vector2() },
      intensity: { value: 1 },
      aoOnly: { value: false },
    })
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.aoMaterial.uniforms.depthBuffer.value = depthTexture
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2))
    const h = Math.max(1, Math.round(height / 2))
    this.aoTarget.setSize(w, h)
    this.blurTarget.setSize(w, h)
    this.aoMaterial.uniforms.texel.value.set(1 / width, 1 / height)
    this.compositeMaterial.uniforms.aoSize.value.set(w, h)
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    if (!inputBuffer) return
    this.aoMaterial.uniforms.inverseProjection.value.copy(this.view.projectionMatrixInverse)
    const a = this.aoMaterial.uniforms
    a.radius.value = this.radius
    a.bias.value = this.bias
    a.samples.value = this.samples
    a.aspect.value = this.aoTarget.width / this.aoTarget.height
    // (uv height covered by 1 m at 1 m: half the projection's y scale)
    a.projScale.value = this.view.projectionMatrix.elements[5] * 0.5
    this.fullscreenMaterial = this.aoMaterial
    renderer.setRenderTarget(this.aoTarget)
    renderer.render(this.scene, this.camera)

    const b = this.blurMaterial.uniforms
    const { width, height } = this.aoTarget
    this.fullscreenMaterial = this.blurMaterial
    b.aoBuffer.value = this.aoTarget.texture
    b.direction.value.set(1 / width, 0)
    renderer.setRenderTarget(this.blurTarget)
    renderer.render(this.scene, this.camera)
    b.aoBuffer.value = this.blurTarget.texture
    b.direction.value.set(0, 1 / height)
    renderer.setRenderTarget(this.aoTarget)
    renderer.render(this.scene, this.camera)

    const c = this.compositeMaterial.uniforms
    c.inputBuffer.value = inputBuffer.texture
    c.intensity.value = this.intensity
    c.aoOnly.value = this.aoOnly
    this.fullscreenMaterial = this.compositeMaterial
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }

  override dispose(): void {
    this.aoTarget.dispose()
    this.blurTarget.dispose()
    this.aoMaterial.dispose()
    this.blurMaterial.dispose()
    this.compositeMaterial.dispose()
    super.dispose()
  }
}
