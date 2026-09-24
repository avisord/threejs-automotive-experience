import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'

/**
 * Still water, as in a reflecting pool: a real planar reflection of whatever
 * is above it, broken up by slow ripples, and a Fresnel falloff — dark and
 * clear looking straight down, a mirror at a glancing angle — with a glint
 * of the sun on the ripples.
 *
 * The ripples move with `update(dt)`: in a video, and while the view is being
 * drawn. With nothing drawn the water simply holds still.
 */
const WaterShader = {
  name: 'WaterShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    /** what the water looks like where it isn't reflecting: the dark basin seen through it */
    uBody: { value: new THREE.Color().setRGB(0.012, 0.022, 0.026) }, // linear: a dark slate basin, faintly teal
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color(1, 0.95, 0.88) },
    /** how far the ripples bend the reflection, in screen uv */
    uDistortion: { value: 0.018 },
    /** ripple slope scale: 0 = glass */
    uChop: { value: 1 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4( position, 1.0 );
      vWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec3 uBody;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform float uDistortion;
    uniform float uChop;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>

    // slope of one travelling wave: direction, wavelength (m), speed (m/s), height (m)
    vec2 wave( vec2 p, vec2 dir, float len, float speed, float height ) {
      float k = 6.2831853 / len;
      float phase = k * ( dot( dir, p ) - speed * uTime );
      return dir * ( k * height * cos( phase ) );
    }

    // gradient noise for the fine, irregular ripples
    vec2 hash2( vec2 p ) {
      p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
      return -1.0 + 2.0 * fract( sin( p ) * 43758.5453 );
    }
    float gnoise( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      vec2 u = f * f * ( 3.0 - 2.0 * f );
      return mix(
        mix( dot( hash2( i ), f ), dot( hash2( i + vec2( 1, 0 ) ), f - vec2( 1, 0 ) ), u.x ),
        mix( dot( hash2( i + vec2( 0, 1 ) ), f - vec2( 0, 1 ) ), dot( hash2( i + vec2( 1, 1 ) ), f - vec2( 1, 1 ) ), u.x ),
        u.y );
    }
    vec2 noiseSlope( vec2 p ) {
      const float e = 0.05;
      return vec2( gnoise( p + vec2( e, 0 ) ) - gnoise( p - vec2( e, 0 ) ),
                   gnoise( p + vec2( 0, e ) ) - gnoise( p - vec2( 0, e ) ) ) / ( 2.0 * e );
    }

    void main() {
      #include <logdepthbuf_fragment>
      vec2 p = vWorld.xz;
      // a breeze from one side: a few long swells and a scatter of short ripples
      vec2 slope = vec2( 0.0 );
      slope += wave( p, normalize( vec2( 0.8, 0.6 ) ), 3.1, 0.35, 0.006 );
      slope += wave( p, normalize( vec2( 0.3, 1.0 ) ), 1.7, 0.28, 0.004 );
      slope += wave( p, normalize( vec2( -0.6, 0.8 ) ), 0.9, 0.22, 0.0022 );
      slope += wave( p, normalize( vec2( 1.0, -0.2 ) ), 0.55, 0.18, 0.0012 );
      vec2 drift = vec2( uTime * 0.05, uTime * 0.03 );
      slope += noiseSlope( p * 2.2 + drift ) * 0.012;
      slope += noiseSlope( p * 6.5 - drift * 1.7 ) * 0.004;
      slope *= uChop;
      vec3 n = normalize( vec3( -slope.x, 1.0, -slope.y ) );

      vec3 toEye = normalize( cameraPosition - vWorld );
      float cosTheta = clamp( dot( n, toEye ), 0.0, 1.0 );
      // Schlick, water's F0 ≈ 0.02
      float fresnel = 0.02 + 0.98 * pow( 1.0 - cosTheta, 5.0 );

      // the reflection, bent by the ripples (less so far away, where they're sub-pixel)
      vec2 uv = vUv.xy / vUv.w;
      uv += n.xz * uDistortion / max( vUv.w * 0.25, 1.0 );
      vec3 reflection = texture2D( tDiffuse, uv ).rgb * color;

      // the sun caught on the ripples
      vec3 r = reflect( -toEye, n );
      float glint = pow( max( dot( r, uSunDir ), 0.0 ), 900.0 ) * 60.0 + pow( max( dot( r, uSunDir ), 0.0 ), 90.0 ) * 1.5;

      vec3 col = mix( uBody, reflection, fresnel ) + uSunColor * glint * fresnel;
      gl_FragColor = vec4( col, 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

export interface WaterSurface {
  mesh: Reflector
  /** advance the ripples */
  update(dt: number): void
  resize(width: number, height: number, pixelRatio: number): void
  /** mirror resolution relative to the canvas; 0 = no mirror (a dark glossy stand-in) */
  setReflectionScale(scale: number): void
  /** where the glint comes from */
  setSunDirection(direction: THREE.Vector3): void
}

export function createWater(
  geometry: THREE.BufferGeometry,
  opts: {
    sunDirection: THREE.Vector3
    /** objects to hide while the water's own mirror renders (other mirrors: rendering one inside another doubles the work) */
    hideWhileReflecting: () => THREE.Object3D[]
  },
): WaterSurface {
  const mesh = new Reflector(geometry, {
    color: 0xffffff,
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.002,
    shader: WaterShader,
  })
  mesh.name = 'water'
  mesh.rotation.x = -Math.PI / 2
  const uniforms = (mesh.material as THREE.ShaderMaterial).uniforms
  uniforms.uSunDir.value.copy(opts.sunDirection).normalize()

  const baseBeforeRender = mesh.onBeforeRender
  mesh.onBeforeRender = (...args) => {
    const hidden = opts.hideWhileReflecting().filter((o) => o.visible)
    for (const o of hidden) o.visible = false
    baseBeforeRender.apply(mesh, args)
    for (const o of hidden) o.visible = true
  }

  // with the mirror off: the same dark water, reflecting only the environment map.
  // The path tracer gets it too — it does the reflection and Fresnel for real.
  const still = new THREE.MeshStandardMaterial({ color: 0x05080d, roughness: 0.03, metalness: 0, envMapIntensity: 1.6 })
  ;(mesh.material as THREE.ShaderMaterial).userData.pathTrace = still
  const standIn = new THREE.Mesh(geometry, still)
  standIn.visible = false
  mesh.add(standIn) // inherits the mirror's orientation

  let scale = 0.5
  const viewport = { width: 1, height: 1, pixelRatio: 1 }
  const size = () => {
    const k = viewport.pixelRatio * Math.max(scale, 0.05)
    mesh.getRenderTarget().setSize(Math.round(viewport.width * k), Math.round(viewport.height * k))
  }

  return {
    mesh,
    update(dt) {
      uniforms.uTime.value += dt
    },
    setSunDirection(direction) {
      uniforms.uSunDir.value.copy(direction).normalize()
    },
    resize(width, height, pixelRatio) {
      Object.assign(viewport, { width, height, pixelRatio })
      size()
    },
    setReflectionScale(s) {
      scale = s
      // the Reflector's own material stays in place; hiding it skips its mirror pass
      ;(mesh.material as THREE.ShaderMaterial).visible = s > 0
      standIn.visible = s === 0
      size()
    },
  }
}
