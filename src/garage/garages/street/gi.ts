import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import type { Footprint } from './buildings'
import { ROAD, STREETS, streetY } from './site'

/**
 * The street's indirect light, measured rather than guessed (Settings › Graphics › Street lighting):
 *
 * - Sky visibility. How much of the sky a point in the street sees, for its own normal and height:
 *   the buildings' ground plans and roof heights (buildings.ts footprints) give, for every 2 m of
 *   the street and 8 directions, the blocker that stands highest over the horizon (its height and
 *   distance); the shader turns that into the cosine-weighted share of the open sky above this
 *   point's horizon. The sky's own light is a spherical-harmonics probe of the open sky.
 * - Bounce. Light probes on an 8 m grid over the streets, 2 m up, capture the scene round them
 *   without the car and without the sky — the sunlit and shaded facades in their own paint, the
 *   paving, the hills — and keep it as L2 spherical harmonics, so a surface facing a red wall gets
 *   red light and one facing a yellow wall yellow. Captured with the probes' own light off (one
 *   bounce), rebaked after every environment capture (a sun move, the lamps).
 *
 * Everything runs on the GPU: each probe renders six 8×8 faces into an atlas, and a pass projects
 * the atlas onto the SH coefficients of every probe at once, into an array texture the materials
 * sample with hardware bilinear filtering (weights in alpha, so cells without a probe drop out).
 */

/** meshes and lights the probes see */
export const CAPTURE_LAYER = 7
/** what the sky probe sees */
export const SKY_LAYER = 8

const CELL = 8 // probe spacing, m
const PROBE_HEIGHT = 2
const HORIZON_CELL = 2 // horizon texture spacing, m
const DIRS = 8
const FACE = 8 // px
const TILE = { w: FACE * 3, h: FACE * 2 }
const ATLAS_COLS = 32
/** probes rendered per task (the page keeps answering while a bake runs) */
const CHUNK = 10

const FACES: { f: THREE.Vector3; u: THREE.Vector3 }[] = [
  { f: new THREE.Vector3(1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
  { f: new THREE.Vector3(-1, 0, 0), u: new THREE.Vector3(0, 1, 0) },
  { f: new THREE.Vector3(0, 1, 0), u: new THREE.Vector3(0, 0, 1) },
  { f: new THREE.Vector3(0, -1, 0), u: new THREE.Vector3(0, 0, -1) },
  { f: new THREE.Vector3(0, 0, 1), u: new THREE.Vector3(0, 1, 0) },
  { f: new THREE.Vector3(0, 0, -1), u: new THREE.Vector3(0, 1, 0) },
]
const faceGLSL = (k: 'f' | 'u') => FACES.map((face) => `vec3( ${face[k].x.toFixed(1)}, ${face[k].y.toFixed(1)}, ${face[k].z.toFixed(1)} )`).join(', ')

/** projects each probe's atlas tile onto one SH coefficient (per draw), for every grid cell */
const projectShader = /* glsl */ `
  precision highp float;
  precision highp sampler2D;
  uniform sampler2D uAtlas;
  uniform sampler2D uCells;
  uniform int uCoef;
  const vec3 FF[ 6 ] = vec3[ 6 ]( ${faceGLSL('f')} );
  const vec3 FU[ 6 ] = vec3[ 6 ]( ${faceGLSL('u')} );
  float basis( vec3 d ) {
    if ( uCoef == 0 ) return 0.282095;
    if ( uCoef == 1 ) return 0.488603 * d.y;
    if ( uCoef == 2 ) return 0.488603 * d.z;
    if ( uCoef == 3 ) return 0.488603 * d.x;
    if ( uCoef == 4 ) return 1.092548 * d.x * d.y;
    if ( uCoef == 5 ) return 1.092548 * d.y * d.z;
    if ( uCoef == 6 ) return 0.315392 * ( 3.0 * d.z * d.z - 1.0 );
    if ( uCoef == 7 ) return 1.092548 * d.x * d.z;
    return 0.546274 * ( d.x * d.x - d.y * d.y );
  }
  void main() {
    float index = texelFetch( uCells, ivec2( gl_FragCoord.xy ), 0 ).r;
    if ( index < 0.0 ) { gl_FragColor = vec4( 0.0 ); return; }
    ivec2 tile = ivec2( int( mod( index, ${ATLAS_COLS}.0 ) ) * ${TILE.w}, int( floor( index / ${ATLAS_COLS}.0 ) ) * ${TILE.h} );
    vec3 sum = vec3( 0.0 );
    float wsum = 0.0;
    for ( int f = 0; f < 6; f ++ ) {
      vec3 F = FF[ f ];
      vec3 U = FU[ f ];
      vec3 R = cross( F, U );
      ivec2 o = tile + ivec2( ( f - ( f / 3 ) * 3 ) * ${FACE}, ( f / 3 ) * ${FACE} );
      for ( int j = 0; j < ${FACE}; j ++ ) {
        for ( int i = 0; i < ${FACE}; i ++ ) {
          vec2 p = ( vec2( i, j ) + 0.5 ) / ${FACE}.0 * 2.0 - 1.0;
          float w = 1.0 / pow( 1.0 + dot( p, p ), 1.5 );
          vec3 d = normalize( F + p.x * R + p.y * U );
          sum += texelFetch( uAtlas, o + ivec2( i, j ), 0 ).rgb * basis( d ) * w;
          wsum += w;
        }
      }
    }
    gl_FragColor = vec4( sum * ( 4.0 * 3.14159265 / wsum ), 1.0 );
  }
`

export interface GIOptions {
  footprints: Footprint[]
  ground: { texture: THREE.Texture; rect: THREE.Vector4 }
  /** hide the sun disc for the sky probe (its spike would dominate a low-order SH) */
  showSunDisc(on: boolean): void
}

export interface StreetGI {
  /** make a street material take its indirect light from the probes when they're on (before its first compile) */
  patch(material: THREE.MeshStandardMaterial): void
  /** the bounce the old approximation added (far-shadow.ts): 1 with the probes off, 0 with them on */
  readonly legacyBounce: { value: number }
  on(): boolean
  set(on: boolean): void
  /** rebake the probes from the scene as it's lit now (async, in chunks); `redraw` once done */
  relight(renderer: THREE.WebGLRenderer, scene: THREE.Scene, redraw: () => void): void
  dispose(): void
}

export function createStreetGI(opts: GIOptions): StreetGI {
  const rect = opts.ground.rect
  const t0 = performance.now()

  // ─── buildings raster (1 m): the highest roof over each metre of ground ─────
  const rw = Math.ceil(rect.z)
  const rh = Math.ceil(rect.w)
  const tops = new Float32Array(rw * rh).fill(-1e9)
  for (const { corners, top } of opts.footprints) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const c of corners) {
      x0 = Math.min(x0, c.x)
      x1 = Math.max(x1, c.x)
      z0 = Math.min(z0, c.y)
      z1 = Math.max(z1, c.y)
    }
    // (the quad's winding either way: inside means on the same side of all four edges)
    const side = (a: THREE.Vector2, b: THREE.Vector2, x: number, z: number) => (b.x - a.x) * (z - a.y) - (b.y - a.y) * (x - a.x)
    for (let j = Math.max(0, Math.floor(z0 - rect.y)); j <= Math.min(rh - 1, Math.ceil(z1 - rect.y)); j++) {
      for (let i = Math.max(0, Math.floor(x0 - rect.x)); i <= Math.min(rw - 1, Math.ceil(x1 - rect.x)); i++) {
        const x = rect.x + i + 0.5
        const z = rect.y + j + 0.5
        let pos = 0
        let neg = 0
        for (let k = 0; k < 4; k++) {
          const s = side(corners[k], corners[(k + 1) % 4], x, z)
          if (s >= 0) pos++
          if (s <= 0) neg++
        }
        if (pos === 4 || neg === 4) tops[j * rw + i] = Math.max(tops[j * rw + i], top)
      }
    }
  }
  const topAt = (x: number, z: number) => {
    const i = Math.floor(x - rect.x)
    const j = Math.floor(z - rect.y)
    return i < 0 || j < 0 || i >= rw || j >= rh ? -1e9 : tops[j * rw + i]
  }

  /** is (x, z) in a street's corridor (carriageway, pavements and a margin) */
  const inStreet = (x: number, z: number, margin: number) => {
    for (const street of STREETS) {
      if (!street.near(x, z, 20)) continue
      const n = street.nearest(x, z)
      if (n.s < street.start - 2 || n.s > street.end + 2) continue
      if (Math.abs(n.d) < street.width / 2 + street.sidewalk + margin) return true
    }
    return false
  }

  // ─── horizons (2 m): per direction, the blocker highest over the horizon — (height, distance) ─
  const hw = Math.ceil(rect.z / HORIZON_CELL)
  const hh = Math.ceil(rect.w / HORIZON_CELL)
  const horizon = new Uint16Array(hw * hh * 4 * (DIRS / 2))
  const half = THREE.DataUtils.toHalfFloat
  const layer = hw * hh * 4
  for (let j = 0; j < hh; j++) {
    for (let i = 0; i < hw; i++) {
      const x = rect.x + (i + 0.5) * HORIZON_CELL
      const z = rect.y + (j + 0.5) * HORIZON_CELL
      const base = (j * hw + i) * 4
      for (let k = 0; k < DIRS; k++) horizon[Math.floor(k / 2) * layer + base + (k % 2) * 2 + 1] = half(1)
      if (!inStreet(x, z, 3)) continue
      const y0 = streetY(x, z) + ROAD.curb
      for (let k = 0; k < DIRS; k++) {
        const a = (k / DIRS) * Math.PI * 2
        const dx = Math.cos(a)
        const dz = Math.sin(a)
        let best = 0
        let H = 0
        let D = 1
        // (from inside a building, look from where it ends: a wall's own texels are half inside it)
        let started = topAt(x, z) < -1e8
        for (let d = 0.5; d < 90; d += d < 30 ? 1 : 2) {
          const t = topAt(x + dx * d, z + dz * d)
          if (!started) {
            if (t < -1e8) started = true
            continue
          }
          if (t < -1e8) continue
          const tan = (t - y0) / d
          if (tan > best) {
            best = tan
            H = t - y0
            D = d
          }
        }
        const o = Math.floor(k / 2) * layer + base + (k % 2) * 2
        horizon[o] = half(H)
        horizon[o + 1] = half(D)
      }
    }
  }
  const horizonTexture = new THREE.DataArrayTexture(horizon, hw, hh, DIRS / 2)
  horizonTexture.format = THREE.RGBAFormat
  horizonTexture.type = THREE.HalfFloatType
  horizonTexture.minFilter = horizonTexture.magFilter = THREE.LinearFilter
  horizonTexture.needsUpdate = true

  // ─── the probes: an 8 m grid over the street corridors ─────────────────
  const gw = Math.ceil(rect.z / CELL)
  const gh = Math.ceil(rect.w / CELL)
  const cells = new Float32Array(gw * gh).fill(-1)
  const probes: THREE.Vector3[] = []
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x = rect.x + (i + 0.5) * CELL
      const z = rect.y + (j + 0.5) * CELL
      if (!inStreet(x, z, -0.3) || topAt(x, z) > -1e8) continue
      cells[j * gw + i] = probes.length
      probes.push(new THREE.Vector3(x, streetY(x, z) + PROBE_HEIGHT, z))
    }
  }
  const cellTexture = new THREE.DataTexture(cells, gw, gh, THREE.RedFormat, THREE.FloatType)
  cellTexture.needsUpdate = true
  const skyCell = new THREE.DataTexture(new Float32Array([0]), 1, 1, THREE.RedFormat, THREE.FloatType)
  skyCell.needsUpdate = true
  console.info(`[garage] street GI: ${probes.length} probes, horizons ${hw}×${hh}, in ${Math.round(performance.now() - t0)} ms`)

  const rtOptions = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }
  const atlas = new THREE.WebGLRenderTarget(ATLAS_COLS * TILE.w, Math.ceil(probes.length / ATLAS_COLS) * TILE.h, rtOptions)
  const skyAtlas = new THREE.WebGLRenderTarget(TILE.w, TILE.h, rtOptions)
  const sh = new THREE.WebGLArrayRenderTarget(gw, gh, 9, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false })
  sh.texture.minFilter = sh.texture.magFilter = THREE.LinearFilter
  const skySH = new THREE.WebGLArrayRenderTarget(1, 1, 9, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false })
  const projectMaterial = new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: null }, uCells: { value: null }, uCoef: { value: 0 } },
    vertexShader: 'void main() { gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
    fragmentShader: projectShader,
    depthTest: false,
    depthWrite: false,
  })
  const quad = new FullScreenQuad(projectMaterial)
  const camera = new THREE.PerspectiveCamera(90, 1, 0.1, 12000)

  // ─── material side ───────────────────────────────────────────────────
  const uniforms = {
    uGiOn: { value: 1 },
    uGiBounce: { value: 1 },
    uGiSkyGain: { value: 0.3 },
    uGiProbes: { value: sh.texture },
    uGiSky: { value: skySH.texture },
    uGiHorizon: { value: horizonTexture },
    uGiGround: { value: opts.ground.texture },
    uGiRect: { value: rect },
    uGiGrid: { value: new THREE.Vector2(gw * CELL, gh * CELL) },
    uGiHorizonSize: { value: new THREE.Vector2(hw * HORIZON_CELL, hh * HORIZON_CELL) },
  }
  const legacyBounce = { value: 0 }
  const fragmentHead = /* glsl */ `
    uniform float uGiOn;
    uniform float uGiBounce;
    uniform float uGiSkyGain;
    uniform highp sampler2DArray uGiProbes;
    uniform highp sampler2DArray uGiSky;
    uniform highp sampler2DArray uGiHorizon;
    uniform sampler2D uGiGround;
    uniform vec4 uGiRect;
    uniform vec2 uGiGrid;
    uniform vec2 uGiHorizonSize;
    varying vec3 vGiPos;
    vec3 giIrradiance( vec3 c[ 9 ], vec3 n ) {
      return c[ 0 ] * 0.886227 + ( c[ 1 ] * n.y + c[ 2 ] * n.z + c[ 3 ] * n.x ) * 1.023328
        + ( c[ 4 ] * n.x * n.y + c[ 5 ] * n.y * n.z + c[ 7 ] * n.x * n.z ) * 0.858086
        + c[ 6 ] * ( 0.743125 * n.z * n.z - 0.247708 ) + c[ 8 ] * 0.429043 * ( n.x * n.x - n.y * n.y );
    }
    // the cosine-weighted share of the open sky this point sees (1 = all of it)
    float giSkyVisibility( vec3 p, vec3 n ) {
      vec2 hn = n.xz;
      vec2 at = p.xz + hn * 1.2; // (a wall looks from just outside itself)
      vec2 uv = ( at - uGiRect.xy ) / uGiHorizonSize;
      if ( any( lessThan( uv, vec2( 0.0 ) ) ) || any( greaterThan( uv, vec2( 1.0 ) ) ) ) return 1.0;
      float h = p.y - texture2D( uGiGround, ( at - uGiRect.xy ) / uGiRect.zw ).r;
      float seen = 0.0;
      float all = 0.0;
      for ( int k = 0; k < ${DIRS / 2}; k ++ ) {
        vec4 t = texture( uGiHorizon, vec3( uv, float( k ) ) );
        for ( int s = 0; s < 2; s ++ ) {
          float a = float( k * 2 + s ) * ${((Math.PI * 2) / DIRS).toFixed(6)};
          vec2 H = s == 0 ? t.xy : t.zw;
          float e = atan( max( 0.0, H.x - h ), max( H.y, 0.3 ) );
          vec2 dir = vec2( cos( a ), sin( a ) );
          for ( int b = 0; b < 4; b ++ ) {
            float th = ( float( b ) + 0.5 ) * 0.392699;
            vec3 w = vec3( dir.x * cos( th ), sin( th ), dir.y * cos( th ) );
            float f = max( 0.0, dot( n, w ) ) * cos( th );
            all += f;
            seen += f * smoothstep( e - 0.12, e + 0.12, th );
          }
        }
      }
      return all > 1e-4 ? seen / all : 1.0;
    }
  `
  const apply = /* glsl */ `
    if ( uGiOn > 0.5 ) {
      vec3 gN = inverseTransformDirection( normal, viewMatrix );
      vec3 c[ 9 ];
      for ( int k = 0; k < 9; k ++ ) c[ k ] = texture( uGiSky, vec3( 0.5, 0.5, float( k ) ) ).rgb;
      vec3 sky = max( giIrradiance( c, gN ), 0.0 ) * uGiSkyGain * giSkyVisibility( vGiPos, gN );
      vec2 guv = ( vGiPos.xz - uGiRect.xy ) / uGiGrid;
      float wsum = texture( uGiProbes, vec3( guv, 0.0 ) ).a;
      vec3 bounce = vec3( 0.0 );
      if ( wsum > 0.01 ) {
        for ( int k = 0; k < 9; k ++ ) c[ k ] = texture( uGiProbes, vec3( guv, float( k ) ) ).rgb / wsum;
        bounce = max( giIrradiance( c, gN ), 0.0 ) * smoothstep( 0.01, 0.3, wsum ) * uGiBounce;
      }
      iblIrradiance = sky + bounce;
    }
  `
  function patch(material: THREE.MeshStandardMaterial): void {
    material.userData.bounceOn = legacyBounce
    const previous = material.onBeforeCompile
    const key = material.customProgramCacheKey.bind(material)
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vGiPos;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 gw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            gw = instanceMatrix * gw;
          #endif
          vGiPos = ( modelMatrix * gw ).xyz;
        }`,
      )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHead}`)
        .replace('#include <lights_fragment_end>', `${apply}\n#include <lights_fragment_end>`)
    }
    material.customProgramCacheKey = () => `street-gi|${key()}`
    material.needsUpdate = true
  }

  // ─── baking ─────────────────────────────────────────────────────────
  let bake = 0
  function renderProbe(renderer: THREE.WebGLRenderer, scene: THREE.Scene, target: THREE.WebGLRenderTarget, index: number, at: THREE.Vector3): void {
    const tx = (index % ATLAS_COLS) * TILE.w
    const ty = Math.floor(index / ATLAS_COLS) * TILE.h
    camera.position.copy(at)
    FACES.forEach((face, f) => {
      camera.up.copy(face.u)
      camera.lookAt(at.x + face.f.x, at.y + face.f.y, at.z + face.f.z)
      camera.updateMatrixWorld()
      target.viewport.set(tx + (f % 3) * FACE, ty + Math.floor(f / 3) * FACE, FACE, FACE)
      target.scissor.copy(target.viewport)
      target.scissorTest = true
      renderer.setRenderTarget(target)
      renderer.clear()
      renderer.render(scene, camera)
    })
  }
  function project(renderer: THREE.WebGLRenderer, source: THREE.WebGLRenderTarget, cellMap: THREE.Texture, target: THREE.WebGLArrayRenderTarget): void {
    projectMaterial.uniforms.uAtlas.value = source.texture
    projectMaterial.uniforms.uCells.value = cellMap
    for (let k = 0; k < 9; k++) {
      projectMaterial.uniforms.uCoef.value = k
      renderer.setRenderTarget(target, k)
      quad.render(renderer)
    }
  }

  return {
    patch,
    legacyBounce,
    on: () => uniforms.uGiOn.value > 0.5,
    set(on) {
      uniforms.uGiOn.value = on ? 1 : 0
      legacyBounce.value = on ? 0 : 1
    },
    relight(renderer, scene, redraw) {
      if (uniforms.uGiOn.value < 0.5) return
      const token = ++bake
      const started = performance.now()
      const save = () => ({ target: renderer.getRenderTarget(), autoClear: renderer.autoClear, background: scene.background, color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha() })
      const restore = (s: ReturnType<typeof save>) => {
        renderer.setRenderTarget(s.target)
        renderer.autoClear = s.autoClear
        scene.background = s.background
        renderer.setClearColor(s.color, s.alpha)
      }
      const prepare = () => {
        renderer.autoClear = false
        scene.background = null
        renderer.setClearColor(0x000000, 0)
      }
      // the open sky first (its own layer: the sky and the clouds, the sun disc hidden)
      {
        const s = save()
        prepare()
        opts.showSunDisc(false)
        camera.layers.set(SKY_LAYER)
        renderProbe(renderer, scene, skyAtlas, 0, new THREE.Vector3(0, 40, 0))
        project(renderer, skyAtlas, skyCell, skySH)
        opts.showSunDisc(true)
        restore(s)
      }
      // then the bounce probes, a chunk per task, with their own light off (one bounce)
      camera.layers.set(CAPTURE_LAYER)
      let next = 0
      const step = () => {
        if (token !== bake) return
        const s = save()
        prepare()
        uniforms.uGiBounce.value = 0
        const end = Math.min(probes.length, next + CHUNK)
        for (; next < end; next++) renderProbe(renderer, scene, atlas, next, probes[next])
        uniforms.uGiBounce.value = 1
        if (next >= probes.length) {
          project(renderer, atlas, cellTexture, sh)
          restore(s)
          console.info(`[garage] street GI baked in ${Math.round(performance.now() - started)} ms`)
          redraw()
          return
        }
        restore(s)
        setTimeout(step, 0)
      }
      step()
    },
    dispose() {
      bake++
      for (const t of [atlas, skyAtlas, sh, skySH]) t.dispose()
      for (const t of [horizonTexture, cellTexture, skyCell]) t.dispose()
      projectMaterial.dispose()
      quad.dispose()
    },
  }
}
