import * as THREE from 'three'
import { fbm, seeded, smoothstep } from '../landform'

/**
 * A few big cumulus over the horizon, as impostors: the analytic sky's cloud
 * layer (sky.ts) paints thin fair-weather cloud, but heaped cumulus — a flat
 * base, towers of rounded puffs, a sunlit side and a shaded one, a glowing
 * rim when the sun is behind — need form. Each is a single card far out
 * (just inside the far plane, behind the mountains), baked once into a small
 * atlas as a normal map of its puffs plus a density; the shader lights it for
 * wherever the sun is (sunlit faces warm, shade lit blue by the sky, silver
 * lining against the sun) and veils the low ones in the horizon's haze.
 * They write no depth: the atmosphere effect treats them as sky.
 */

const CELL = { w: 512, h: 256 }
const VARIANTS = 4

/** bake the cumulus atlas: rgb = the puffs' normals (billboard space), a = density */
function cloudAtlas(): THREE.DataTexture {
  const W = CELL.w * VARIANTS
  const H = CELL.h
  const data = new Uint8Array(W * H * 4)
  for (let v = 0; v < VARIANTS; v++) {
    const rand = seeded(40 + v)
    // puffs heaped over a flat base: a broad bank, towers rising from it
    type Puff = { x: number; y: number; r: number; z: number }
    const puffs: Puff[] = []
    // (cell coordinates: x 0–1 across, y 0–0.5 up — every puff must stay inside, or the card shows its edge)
    const base = 0.035
    const towers = 2 + Math.floor(rand() * 3)
    for (let t = 0; t < towers; t++) {
      const cx = 0.22 + rand() * 0.56
      const height = 0.13 + rand() * 0.2
      const width = 0.06 + rand() * 0.07
      for (let k = 0; k < 18; k++) {
        const up = rand() ** 0.8 * height
        const r = width * (1 - up / (height * 1.5)) * (0.6 + rand() * 0.5)
        puffs.push({ x: cx + (rand() - 0.5) * width * 1.8, y: base + up + r * 0.45, r, z: rand() * 0.15 })
      }
    }
    // smaller puffs heaped on the upper side of the big ones: cauliflower, not balloons
    for (const p of [...puffs]) {
      if (p.r < 0.03) continue
      for (let k = 0; k < 4; k++) {
        const a = rand() * Math.PI
        puffs.push({ x: p.x + Math.cos(a) * p.r * 0.75, y: p.y + Math.sin(a) * p.r * 0.75, r: p.r * (0.3 + rand() * 0.2), z: p.z + 0.05 })
      }
    }
    for (let k = 0; k < 30; k++) {
      const r = 0.025 + rand() * 0.045
      const x = 0.1 + rand() * 0.8
      // the bank thins toward the card's ends
      puffs.push({ x, y: base + r * 0.5 + rand() * 0.03, r: r * (1 - 0.5 * Math.abs(x - 0.5) * 2), z: rand() * 0.15 })
    }
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < CELL.w; i++) {
        // cell coords, aspect-corrected (x 0–1 across, y 0–0.5 up)
        const x = i / CELL.w
        const y = (H - 1 - j) / CELL.w
        // the surface normal: the puffs' own, blended by how far each stands out in front (a soft union,
        // not the front-most sphere's — that drew every puff as a separate ball)
        let nx = 0
        let ny = 0
        let nz = 0.05
        let dens = 0
        for (const p of puffs) {
          const dx = (x - p.x) / p.r
          const dy = (y - p.y) / p.r
          const d2 = dx * dx + dy * dy
          if (d2 >= 1) continue
          const h = Math.sqrt(1 - d2)
          dens += (1 - d2) * 0.9
          const w = (1 - d2) ** 2 * (0.4 + p.z + h * p.r * 8)
          nx += dx * w
          ny += dy * w
          nz += h * w
        }
        const nl = Math.hypot(nx, ny, nz) || 1
        nx /= nl
        ny /= nl
        let nz2 = nz / nl
        // billows within the puffs
        const bx = (fbm(x * 40 + v * 3, y * 40, 3) - 0.5) * 0.5
        const by = (fbm(x * 40 + 17, y * 40 + v, 3) - 0.5) * 0.5
        nx += bx
        ny += by
        const nl2 = Math.hypot(nx, ny, nz2)
        nx /= nl2
        ny /= nl2
        nz2 /= nl2
        // a flat base, wispy edges eaten by noise
        const baseCut = smoothstep(y, base - 0.02, base + 0.03)
        const wisp = smoothstep(fbm(x * 26 + v * 7, y * 26, 4), 0.3, 0.65)
        const a = Math.min(1, dens * 1.4) * baseCut * (0.5 + 0.5 * wisp) * smoothstep(dens, 0.02, 0.4)
        const k = (j * W + v * CELL.w + i) * 4
        data[k] = Math.round((nx * 0.5 + 0.5) * 255)
        data[k + 1] = Math.round((ny * 0.5 + 0.5) * 255)
        data[k + 2] = Math.round(nz2 * 255)
        data[k + 3] = Math.round(a * 255)
      }
    }
  }
  const texture = new THREE.DataTexture(data, W, H, THREE.RGBAFormat)
  texture.flipY = true
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

const vertexShader = /* glsl */ `
  attribute float variant;
  varying vec2 vUv;
  varying vec3 vRight;
  varying vec3 vUp;
  varying vec3 vFacing;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vUv = vec2( ( uv.x + variant ) / ${VARIANTS.toFixed(1)}, uv.y );
    vRight = normalize( mat3( modelMatrix ) * vec3( 1.0, 0.0, 0.0 ) );
    vUp = normalize( mat3( modelMatrix ) * vec3( 0.0, 1.0, 0.0 ) );
    vFacing = normalize( mat3( modelMatrix ) * vec3( 0.0, 0.0, 1.0 ) );
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    #include <logdepthbuf_vertex>
  }
`
const fragmentShader = /* glsl */ `
  uniform sampler2D uAtlas;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyTop;
  uniform vec3 uSkyLow;
  uniform vec3 uHaze;
  uniform float uHazeAmount;
  varying vec2 vUv;
  varying vec3 vRight;
  varying vec3 vUp;
  varying vec3 vFacing;
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec4 t = texture2D( uAtlas, vUv );
    if ( t.a < 0.01 ) discard;
    vec3 n = vec3( t.rg * 2.0 - 1.0, t.b );
    // the sun in the card's own frame (x right, y up, z toward the garage)
    vec3 s = normalize( vec3( dot( uSunDir, vRight ), dot( uSunDir, vUp ), dot( uSunDir, vFacing ) ) );
    // thickness at the scale of the puffs, not of the billows: a blurred mip of the density. Light
    // passing through the cloud toward us goes by this (a noisy per-pixel density made a backlit
    // cloud flicker between glowing and black — pink blotches)
    float thick = textureLod( uAtlas, vUv, 3.5 ).a;
    // with the sun behind, the cores are opaque: its disc is thousands of times the sky, and a few
    // per cent of it through a gap in the billows shone through as a bright disc
    float behind = max( -s.z, 0.0 );
    float density = mix( t.a, max( t.a, smoothstep( 0.3, 0.7, thick ) * step( 0.2, t.a ) ), smoothstep( 0.0, 0.5, behind ) );
    // wrapped diffuse: the sunlit side, the shade side still lit a little through the cloud
    float lit = clamp( dot( n, s ) * 0.55 + 0.45, 0.0, 1.0 );
    // thick cores sit in their own shadow; the base is darker still
    float self = mix( 1.0, 0.55, smoothstep( 0.5, 1.0, t.a ) ) * mix( 0.7, 1.0, clamp( n.y * 0.5 + 0.6, 0.0, 1.0 ) );
    // the sun behind the cloud: forward scattering. What reaches us falls off with the thickness
    // crossed — the thin edges blaze (the silver lining), the body is a dark silhouette lit by the sky
    float forward = pow( behind, 4.0 );
    float through = exp( -9.0 * thick );
    vec3 ambient = mix( uSkyLow, uSkyTop, clamp( n.y * 0.5 + 0.5, 0.0, 1.0 ) );
    // (seen from the shaded side, the sunlit-face term fades out: we're looking at its back, lit by
    // the sky and by the little sunlight that diffuses all the way through)
    vec3 col = ambient * ( 0.6 + 0.4 * lit ) * mix( 1.0, 0.55, forward )
      + uSunColor * ( lit * self * ( 1.0 - 0.9 * forward ) + forward * ( 0.04 + 5.0 * through ) );
    // seen through tens of kilometres of air: the low ones fade into the horizon's haze (less where
    // the cloud stands against the sun: its silhouette is what reads there)
    col = mix( col, uHaze, uHazeAmount * ( 1.0 - 0.5 * forward ) );
    gl_FragColor = vec4( col * density, density );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/** where the cumulus stand: bearing (° from straight out, + right), elevation of the base (°), width and height (°), atlas cell */
const CLOUDS = [
  { bearing: 24, elevation: 1.6, width: 17, height: 8.5, variant: 0 },
  { bearing: 47, elevation: 2.8, width: 24, height: 12, variant: 1 },
  { bearing: 64, elevation: 1.2, width: 15, height: 7.5, variant: 2 },
  { bearing: 6, elevation: 1.0, width: 11, height: 5.5, variant: 3 },
  { bearing: 34, elevation: 7.5, width: 9, height: 4.5, variant: 2 },
  { bearing: -78, elevation: 2.5, width: 16, height: 8, variant: 1 },
  { bearing: 105, elevation: 3, width: 22, height: 11, variant: 0 },
  { bearing: 150, elevation: 2, width: 18, height: 9, variant: 3 },
  { bearing: -130, elevation: 3.5, width: 20, height: 10, variant: 2 },
]

export interface Cumulus {
  group: THREE.Group
  /** the baked atlas (in shader uniforms: the room frees it) */
  atlas: THREE.Texture
  /** light them for a sun: its direction, colour × strength, and the sky's colours */
  setSun(direction: THREE.Vector3, color: THREE.Color, day: number): void
}

/** just inside the far plane (12 km), behind every mountain */
const DISTANCE = 11500

export function createCumulus(): Cumulus {
  const atlas = cloudAtlas()
  const uniforms = {
    uAtlas: { value: atlas },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSkyTop: { value: new THREE.Color() },
    uSkyLow: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uHazeAmount: { value: 0 },
  }
  const group = new THREE.Group()
  group.name = 'cumulus'
  const deg = Math.PI / 180
  for (const c of CLOUDS) {
    const w = 2 * DISTANCE * Math.tan((c.width / 2) * deg)
    const h = 2 * DISTANCE * Math.tan((c.height / 2) * deg)
    const geometry = new THREE.PlaneGeometry(w, h)
    geometry.translate(0, h / 2, 0) // the base on the card's origin
    geometry.setAttribute('variant', new THREE.Float32BufferAttribute(new Array(4).fill(c.variant), 1))
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uHazeAmount: { value: 0.45 - 0.05 * Math.min(c.elevation, 6) } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      premultipliedAlpha: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    })
    // (the shared uniforms are the same objects, so setSun reaches every card)
    for (const k of Object.keys(uniforms) as (keyof typeof uniforms)[]) if (k !== 'uHazeAmount') material.uniforms[k] = uniforms[k]
    const card = new THREE.Mesh(geometry, material)
    const b = c.bearing * deg
    const e = c.elevation * deg
    card.position.set(Math.sin(b) * Math.cos(e), Math.sin(e), -Math.cos(b) * Math.cos(e)).multiplyScalar(DISTANCE)
    card.lookAt(0, card.position.y, 0) // upright, facing the garage
    card.frustumCulled = false
    card.raycast = () => {}
    card.renderOrder = -1 // before other transparent things (glass): they're the farthest
    card.userData.overlay = true // (the path tracer's sky stand-in covers them)
    group.add(card)
  }
  return {
    group,
    atlas,
    setSun(direction, color, day) {
      uniforms.uSunDir.value.copy(direction)
      // (in the sky shader's units: its output is scaled to the scene by skyGain; calibrated by eye against it)
      // sunlit faces: the low sun's gold, paled toward white (the cloud scatters every colour); shade: the blue sky's
      uniforms.uSunColor.value.copy(color).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(1.5 + 1.5 * day)
      uniforms.uSkyTop.value.setRGB(0.26, 0.36, 0.62).multiplyScalar(0.8 + 0.8 * day)
      uniforms.uSkyLow.value.setRGB(0.36, 0.38, 0.48).multiplyScalar(0.8 + 0.8 * day)
      uniforms.uHaze.value.setRGB(0.72, 0.66, 0.66).lerp(new THREE.Color(0.7, 0.78, 0.92), day).multiplyScalar(0.8 + 0.8 * day)
    },
  }
}
