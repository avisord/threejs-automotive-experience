import * as THREE from 'three'
import { Pass } from 'postprocessing'

/** the meter's raster: small (its top mip is the average), wide like the frame */
const SIZE = { w: 256, h: 144 }

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`

const fragmentShader = /* glsl */ `
uniform sampler2D inputBuffer;
uniform vec2 texel; // one meter texel, in uv
uniform vec2 centre;
varying vec2 vUv;
const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
float lum( vec2 uv ) { return max( dot( texture2D( inputBuffer, uv ).rgb, LUMA ), 1e-4 ); }
void main() {
  // four taps per texel, so a small bright thing isn't caught or missed by where one tap lands
  vec2 q = texel * 0.25;
  float l = log2( lum( vUv + vec2( -q.x, -q.y ) ) ) + log2( lum( vUv + vec2( q.x, -q.y ) ) )
          + log2( lum( vUv + vec2( -q.x, q.y ) ) ) + log2( lum( vUv + vec2( q.x, q.y ) ) );
  // centre-weighted, as a camera meters: the subject counts most, the frame's edges a little
  vec2 d = ( vUv - centre ) * vec2( 1.0, 1.3 );
  float w = exp( -dot( d, d ) * 7.0 ) + 0.12;
  gl_FragColor = vec4( 0.25 * l * w, w, 0.0, 1.0 );
}
`

/**
 * Metering for auto exposure: the frame's centre-weighted mean log2
 * luminance, left on the GPU. Each frame it draws the HDR input (before the
 * grade) into a small half-float raster as (weight × log2 L, weight); its
 * mip chain averages both, and the grade reads the top mip — mean log L =
 * r / g — so exposure follows the scene in the same frame, with no readback
 * (a video export stays deterministic).
 */
export class ExposureMeter extends Pass {
  readonly target: THREE.WebGLRenderTarget
  /** the mip level that is one texel */
  readonly topLevel = Math.floor(Math.log2(Math.max(SIZE.w, SIZE.h)))
  private readonly material: THREE.ShaderMaterial

  constructor() {
    super('ExposureMeter')
    this.needsSwap = false
    this.target = new THREE.WebGLRenderTarget(SIZE.w, SIZE.h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: true,
      depthBuffer: false,
    })
    this.target.texture.name = 'ExposureMeter'
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        inputBuffer: { value: null },
        texel: { value: new THREE.Vector2(1 / SIZE.w, 1 / SIZE.h) },
        // (the car sits left of centre: the panel on the right takes the view offset)
        centre: { value: new THREE.Vector2(0.45, 0.5) },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.fullscreenMaterial = this.material
  }

  override render(renderer: THREE.WebGLRenderer, inputBuffer: THREE.WebGLRenderTarget | null): void {
    this.material.uniforms.inputBuffer.value = inputBuffer?.texture ?? null
    renderer.setRenderTarget(this.target)
    renderer.render(this.scene, this.camera) // (the target's mips are regenerated after the draw)
  }

  /** the last metered mean log2 luminance, read back — for tuning from the console, not per frame */
  read(renderer: THREE.WebGLRenderer): number {
    const data = new Uint16Array(SIZE.w * SIZE.h * 4)
    renderer.readRenderTargetPixels(this.target, 0, 0, SIZE.w, SIZE.h, data)
    let l = 0
    let w = 0
    for (let k = 0; k < data.length; k += 4) {
      l += THREE.DataUtils.fromHalfFloat(data[k])
      w += THREE.DataUtils.fromHalfFloat(data[k + 1])
    }
    return l / w
  }

  override dispose(): void {
    this.target.dispose()
    this.material.dispose()
    super.dispose()
  }
}
