import * as THREE from 'three'
import { Pass } from 'postprocessing'

/** which surfaces reflect the frame: none, the car, the car and the room, or everything drawn */
export type SsrScope = 'off' | 'car' | 'room' | 'all'
export type SsrQuality = 'low' | 'medium' | 'high'

/** ray-march steps per quality (binary refinement comes on top) */
const STEPS: Record<SsrQuality, number> = { low: 16, medium: 32, high: 64 }
const MAX_STEPS = 64

/**
 * Meshes in the SSR scope get this layer too: the G-buffer draw looks through a camera on it alone.
 * (1 is the placement gizmo, 3 x-ray's ghosts — which a ghosted mesh's mask drops, and restores.)
 */
export const SURFACE_LAYER = 4

const fullscreenVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`

const common = /* glsl */ `
uniform sampler2D depthBuffer;
uniform sampler2D surfaceBuffer;
uniform sampler2D surfaceDepth;
uniform mat4 projection;
uniform mat4 inverseProjection;

vec3 viewPosition( vec2 uv, float depth ) {
  vec4 p = inverseProjection * vec4( uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0 );
  return p.xyz / p.w;
}

float viewDepth( vec2 uv, float depth ) {
  return -viewPosition( uv, depth ).z;
}

vec3 octDecode( vec2 f ) {
  vec3 n = vec3( f, 1.0 - abs( f.x ) - abs( f.y ) );
  float t = max( -n.z, 0.0 );
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize( n );
}

// the surface under this pixel, if it's one in scope and nothing else was drawn in front of it
// (the G-buffer holds only the scope's meshes: a pillar in front of the car isn't in it)
bool surfaceAt( vec2 uv, out vec4 s, out vec3 p ) {
  s = texture2D( surfaceBuffer, uv );
  float d = texture2D( depthBuffer, uv ).r;
  if ( s.a < 0.01 || d >= 1.0 ) return false;
  p = viewPosition( uv, d );
  float z = viewDepth( uv, texture2D( surfaceDepth, uv ).r );
  return abs( z + p.z ) < 0.02 * -p.z + 0.03;
}
`

const traceFragment = /* glsl */ `
${common}
uniform sampler2D colorBuffer;
uniform vec2 resolution;
uniform float cameraNear;
uniform float maxDistance;
uniform float roughCut;
uniform int steps;
uniform float frame;
varying vec2 vUv;

float ign( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}

void main() {
  vec4 s;
  vec3 p;
  gl_FragColor = vec4( 0.0 );
  if ( !surfaceAt( vUv, s, p ) || s.b > roughCut ) return;
  vec3 n = octDecode( s.rg );
  vec3 r = normalize( reflect( normalize( p ), n ) );
  // rays back toward the lens mostly find the backs of things the frame never drew
  float facing = 1.0 - smoothstep( 0.1, 0.55, r.z );
  if ( facing <= 0.0 ) return;

  // the ray as a screen-space segment, perspective-correct in depth (1/w is linear on screen)
  float len = maxDistance;
  if ( p.z + r.z * len > -cameraNear ) len = ( -cameraNear * 1.01 - p.z ) / r.z;
  vec3 q = p + r * len;
  vec4 hp = projection * vec4( p, 1.0 );
  vec4 hq = projection * vec4( q, 1.0 );
  float kp = 1.0 / hp.w;
  float kq = 1.0 / hq.w;
  vec2 sp = hp.xy * kp * 0.5 + 0.5;
  vec2 sq = hq.xy * kq * 0.5 + 0.5;
  vec2 dir = sq - sp;
  // cut at the frame's edge
  float tEnd = 1.0;
  if ( dir.x > 0.0 ) tEnd = min( tEnd, ( 1.0 - sp.x ) / dir.x );
  if ( dir.x < 0.0 ) tEnd = min( tEnd, -sp.x / dir.x );
  if ( dir.y > 0.0 ) tEnd = min( tEnd, ( 1.0 - sp.y ) / dir.y );
  if ( dir.y < 0.0 ) tEnd = min( tEnd, -sp.y / dir.y );
  if ( length( dir * tEnd * resolution ) < 2.0 ) return;

  float jitter = ign( gl_FragCoord.xy + frame * 5.588238 );
  float prev = 0.0;
  float prevBehind = -1.0;
  float hit = -1.0;
  for ( int i = 1; i <= ${MAX_STEPS}; i ++ ) {
    if ( i > steps ) break;
    // steps packed toward the start: contact reflections (a wheel in the sill) need them most
    float x = ( float( i ) - 1.0 + jitter ) / float( steps );
    float t = x * x * tEnd;
    vec2 uv = sp + dir * t;
    float rayDepth = 1.0 / mix( kp, kq, t );
    float sceneDepth = viewDepth( uv, texture2D( depthBuffer, uv ).r );
    float behind = rayDepth - sceneDepth;
    // crossed a surface since the last step: in front of it then, behind it now. Unless it's much
    // farther behind than the ray moved — then it passed behind a nearer object's silhouette.
    float stride = abs( rayDepth - 1.0 / mix( kp, kq, prev ) );
    if ( behind > 0.0 && prevBehind <= 0.0 && behind < max( 0.1, 0.03 * rayDepth ) + 2.0 * stride ) {
      // refine between the last step in front and this one
      float a = prev;
      float b = t;
      for ( int j = 0; j < 5; j ++ ) {
        float m = 0.5 * ( a + b );
        vec2 muv = sp + dir * m;
        float md = 1.0 / mix( kp, kq, m );
        if ( md > viewDepth( muv, texture2D( depthBuffer, muv ).r ) ) b = m; else a = m;
      }
      hit = b;
      break;
    }
    prev = t;
    prevBehind = behind;
  }
  if ( hit < 0.0 ) return;
  vec2 uv = sp + dir * hit;
  if ( texture2D( depthBuffer, uv ).r >= 0.9999999 ) return; // the sky: the env map has it
  vec2 edge = smoothstep( vec2( 0.0 ), vec2( 0.06 ), uv ) * smoothstep( vec2( 0.0 ), vec2( 0.06 ), 1.0 - uv );
  float confidence = edge.x * edge.y * facing * ( 1.0 - smoothstep( 0.75, 1.0, hit ) ); // (and toward the ray's full length)
  // (clamped: the sun's disc overflows a half float, and one hot texel smears in the blur)
  gl_FragColor = vec4( min( texture2D( colorBuffer, uv ).rgb, vec3( 32.0 ) ), confidence );
}
`

const compositeFragment = /* glsl */ `
${common}
uniform sampler2D inputBuffer;
uniform sampler2D traceBuffer;
uniform vec2 traceTexel;
uniform float strength;
uniform float roughCut;
uniform int debugView;
varying vec2 vUv;

void main() {
  vec4 base = texture2D( inputBuffer, vUv );
  gl_FragColor = base;
  if ( debugView == 1 ) {
    vec4 g = texture2D( surfaceBuffer, vUv );
    gl_FragColor = vec4( g.a < 0.01 ? vec3( 0.0 ) : vec3( octDecode( g.rg ) * 0.5 + 0.5 ) * ( 1.0 - g.b ), 1.0 );
    return;
  }
  if ( debugView == 2 ) {
    vec4 t = texture2D( traceBuffer, vUv );
    gl_FragColor = vec4( t.rgb * t.a, 1.0 );
    return;
  }
  vec4 s;
  vec3 p;
  if ( !surfaceAt( vUv, s, p ) || s.b > roughCut ) return;
  vec3 n = octDecode( s.rg );
  float nv = clamp( dot( n, normalize( -p ) ), 0.0, 1.0 );
  float fresnel = s.a + ( 1.0 - s.a ) * pow( 1.0 - nv, 5.0 );
  float gloss = 1.0 - s.b / roughCut;
  gloss *= gloss;

  // rougher surfaces gather from wider (the half-res trace is noisy there anyway); taps on another
  // surface (a depth jump) don't count
  float radius = 1.0 + 5.0 * s.b / roughCut;
  vec3 sum = vec3( 0.0 );
  float weight = 0.0;
  float found = 0.0;
  for ( int i = 0; i < 9; i ++ ) {
    float a = float( i ) * 2.39996323;
    vec2 o = i == 0 ? vec2( 0.0 ) : vec2( cos( a ), sin( a ) ) * radius * sqrt( float( i ) / 8.0 );
    vec2 uv = vUv + o * traceTexel;
    vec4 t = texture2D( traceBuffer, uv );
    float z = viewDepth( uv, texture2D( depthBuffer, uv ).r );
    float w = exp( -abs( z + p.z ) / ( 0.02 * -p.z + 0.02 ) );
    sum += t.rgb * t.a * w;
    weight += t.a * w;
    found += w;
  }
  if ( weight <= 1e-4 ) return;
  vec3 reflection = sum / weight;
  float amount = clamp( fresnel * gloss * strength * weight / max( found, 1e-4 ), 0.0, 1.0 );
  // (the frame already holds the env map's reflection here: the traced one takes its place)
  gl_FragColor = vec4( mix( base.rgb, reflection, amount ), base.a );
}
`

// ─── the G-buffer: normal, roughness and reflectance of the meshes in scope ─────────────────────

interface SurfaceUniforms {
  gbRoughness: THREE.IUniform<number>
  gbMetalness: THREE.IUniform<number>
  gbCoat: THREE.IUniform<number>
  gbCoatRoughness: THREE.IUniform<number>
  gbCutoff: THREE.IUniform<number>
  gbCutMap: THREE.IUniform<THREE.Texture | null>
  gbCutTransform: THREE.IUniform<THREE.Matrix3>
  gbRoughMap: THREE.IUniform<THREE.Texture | null>
  gbRoughTransform: THREE.IUniform<THREE.Matrix3>
  gbMetalMap: THREE.IUniform<THREE.Texture | null>
  gbMetalTransform: THREE.IUniform<THREE.Matrix3>
}

const surfaceFragmentHead = /* glsl */ `
uniform float gbRoughness;
uniform float gbMetalness;
uniform float gbCoat;
uniform float gbCoatRoughness;
#ifdef GB_CUT
  uniform sampler2D gbCutMap;
  uniform mat3 gbCutTransform;
  uniform float gbCutoff;
#endif
#ifdef GB_ROUGH
  uniform sampler2D gbRoughMap;
  uniform mat3 gbRoughTransform;
#endif
#ifdef GB_METAL
  uniform sampler2D gbMetalMap;
  uniform mat3 gbMetalTransform;
#endif
vec2 octEncode( vec3 n ) {
  vec2 o = n.xy / ( abs( n.x ) + abs( n.y ) + abs( n.z ) );
  if ( n.z < 0.0 ) o = ( 1.0 - abs( o.yx ) ) * vec2( o.x >= 0.0 ? 1.0 : -1.0, o.y >= 0.0 ? 1.0 : -1.0 );
  return o;
}
void main() {`

const surfaceCut = /* glsl */ `#include <clipping_planes_fragment>
  #ifdef GB_CUT
    if ( texture2D( gbCutMap, ( gbCutTransform * vec3( vUv, 1.0 ) ).xy ).a < gbCutoff ) discard;
  #endif`

const surfaceOut = /* glsl */ `
  float rough = gbRoughness;
  float metal = gbMetalness;
  #ifdef GB_ROUGH
    rough *= texture2D( gbRoughMap, ( gbRoughTransform * vec3( vUv, 1.0 ) ).xy ).g;
  #endif
  #ifdef GB_METAL
    metal *= texture2D( gbMetalMap, ( gbMetalTransform * vec3( vUv, 1.0 ) ).xy ).b;
  #endif
  // a clear coat is a smooth dielectric over the base: paint reflects like lacquer
  rough = mix( rough, min( rough, gbCoatRoughness ), gbCoat );
  gl_FragColor = vec4( octEncode( normalize( normal ) ), rough, mix( 0.04, 1.0, metal ) );
  #undef OPAQUE
`

const STOCK_OUT = 'gl_FragColor = vec4( normalize( normal ) * 0.5 + 0.5, diffuseColor.a );'

/** (one function for every surface material, so three shares programs by defines alone) */
function compileSurface(this: THREE.Material, shader: THREE.WebGLProgramParametersWithUniforms): void {
  Object.assign(shader.uniforms, this.userData.gb as SurfaceUniforms)
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', surfaceFragmentHead)
    .replace('#include <clipping_planes_fragment>', surfaceCut)
    .replace(STOCK_OUT, surfaceOut)
}

type Standard = THREE.MeshStandardMaterial & Partial<Pick<THREE.MeshPhysicalMaterial, 'clearcoat' | 'clearcoatRoughness'>>

function isStandard(m: THREE.Material): m is Standard {
  return (m as THREE.MeshStandardMaterial).isMeshStandardMaterial === true
}

/** a normal material standing in for `src` in the G-buffer draw, its maps and cut-outs kept */
function createSurfaceMaterial(src: Standard): THREE.MeshNormalMaterial {
  const cut = src.alphaTest > 0 ? (src.alphaMap ?? src.map) : null
  const m = new THREE.MeshNormalMaterial({
    side: src.side,
    flatShading: src.flatShading,
    normalMap: src.normalMap,
    normalMapType: src.normalMapType,
    normalScale: src.normalScale,
    bumpMap: src.bumpMap,
    bumpScale: src.bumpScale,
    displacementMap: src.displacementMap,
    displacementScale: src.displacementScale,
    displacementBias: src.displacementBias,
  })
  const defines: Record<string, string> = {}
  if (cut || src.roughnessMap || src.metalnessMap) defines.USE_UV = ''
  if (cut) defines.GB_CUT = ''
  if (src.roughnessMap) defines.GB_ROUGH = ''
  if (src.metalnessMap) defines.GB_METAL = ''
  m.defines = defines
  const gb: SurfaceUniforms = {
    gbRoughness: { value: 1 },
    gbMetalness: { value: 0 },
    gbCoat: { value: 0 },
    gbCoatRoughness: { value: 0 },
    gbCutoff: { value: src.alphaTest },
    gbCutMap: { value: cut },
    gbCutTransform: { value: cut?.matrix ?? new THREE.Matrix3() },
    gbRoughMap: { value: src.roughnessMap },
    gbRoughTransform: { value: src.roughnessMap?.matrix ?? new THREE.Matrix3() },
    gbMetalMap: { value: src.metalnessMap },
    gbMetalTransform: { value: src.metalnessMap?.matrix ?? new THREE.Matrix3() },
  }
  m.userData.gb = gb
  m.onBeforeCompile = compileSurface
  return m
}

/** the source's current values (sliders, paint presets change them live) */
function syncSurfaceMaterial(m: THREE.MeshNormalMaterial, src: Standard): void {
  const gb = m.userData.gb as SurfaceUniforms
  gb.gbRoughness.value = src.roughness
  gb.gbMetalness.value = src.metalness
  gb.gbCoat.value = Math.min(1, src.clearcoat ?? 0)
  gb.gbCoatRoughness.value = src.clearcoatRoughness ?? 0
  m.side = src.side
}

/** a mesh reflects if it's lit by the standard model, solid enough to write depth, and not an overlay */
function reflective(mesh: THREE.Mesh): boolean {
  if (mesh.userData.overlay || (mesh as unknown as { isReflector?: boolean }).isReflector) return false
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  return materials.some((m) => isStandard(m) && m.depthWrite && m.visible)
}

const sphere = new THREE.Sphere()

/** a mesh's bounds lie within `r` of the origin (the bay) — instanced forests and terrain don't */
function near(mesh: THREE.Mesh, r: number): boolean {
  const g = mesh.geometry
  if (!g.boundingSphere) g.computeBoundingSphere()
  mesh.updateWorldMatrix(true, false)
  const inst = mesh as THREE.Mesh & { isInstancedMesh?: boolean; boundingSphere?: THREE.Sphere | null; computeBoundingSphere?: () => void }
  if (inst.isInstancedMesh) {
    if (!inst.boundingSphere) inst.computeBoundingSphere!()
    sphere.copy(inst.boundingSphere!)
  } else {
    sphere.copy(g.boundingSphere!)
  }
  sphere.applyMatrix4(mesh.matrixWorld)
  return sphere.center.length() + sphere.radius <= r
}

/**
 * Screen-space reflections for the surfaces in scope: rays from each glossy pixel marched through
 * the frame's depth, the colour where they land blended in over the env map's reflection by
 * Fresnel and gloss. Three steps per frame:
 *   1. G-buffer — the scope's meshes drawn with normal materials into a half-res target: view normal,
 *      roughness, reflectance (only these know which pixels are glossy and how)
 *   2. trace — half res, jittered, from the full frame's depth and colour
 *   3. composite — full res, a depth-aware gather that widens with roughness
 * Anything on screen shows in a reflection; what's off screen or hidden falls back to the env map.
 */
export class SsrPass extends Pass {
  strength = 1
  roughCut = 0.6
  maxDistance = 30
  steps = STEPS.medium
  /** for tuning from the console: 0 the frame, 1 the G-buffer (normals, dimmed by roughness), 2 the raw trace */
  debugView = 0

  private readonly view: THREE.PerspectiveCamera
  private readonly world: THREE.Scene
  private readonly surfaces: THREE.WebGLRenderTarget
  private readonly trace: THREE.WebGLRenderTarget
  private readonly traceMaterial: THREE.ShaderMaterial
  private readonly compositeMaterial: THREE.ShaderMaterial
  private readonly layerCamera = new THREE.PerspectiveCamera()
  private meshes: THREE.Mesh[] = []
  private readonly standIns = new Map<THREE.Material, THREE.MeshNormalMaterial>()
  private frame = 0

  constructor(scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    super('SsrPass')
    this.world = scene
    this.view = camera
    this.needsDepthTexture = true
    this.enabled = false
    const nearest = { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter }
    this.surfaces = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      ...nearest,
      depthTexture: new THREE.DepthTexture(1, 1),
    })
    this.surfaces.texture.name = 'SSR.Surfaces'
    this.trace = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
    this.trace.texture.name = 'SSR.Trace'
    const shared = {
      depthBuffer: { value: null as THREE.Texture | null },
      surfaceBuffer: { value: this.surfaces.texture },
      surfaceDepth: { value: this.surfaces.depthTexture },
      projection: { value: new THREE.Matrix4() },
      inverseProjection: { value: new THREE.Matrix4() },
      roughCut: { value: this.roughCut },
    }
    this.traceMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: traceFragment,
      uniforms: {
        ...shared,
        colorBuffer: { value: null },
        resolution: { value: new THREE.Vector2() },
        cameraNear: { value: 0.1 },
        maxDistance: { value: this.maxDistance },
        steps: { value: this.steps },
        frame: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
    this.compositeMaterial = new THREE.ShaderMaterial({
      vertexShader: fullscreenVertex,
      fragmentShader: compositeFragment,
      // (the same uniform objects: set once, seen by both)
      uniforms: {
        ...shared,
        inputBuffer: { value: null },
        traceBuffer: { value: this.trace.texture },
        traceTexel: { value: new THREE.Vector2() },
        strength: { value: 1 },
        debugView: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    })
  }

  static stepsFor(quality: SsrQuality): number {
    return STEPS[quality]
  }

  /**
   * The meshes under these roots reflect from now on (call again when they change: car, room,
   * materials) — only those within `within` metres of the bay, if given: an open-air room's group
   * holds its whole landscape.
   */
  setRoots(roots: THREE.Object3D[], within = Infinity): void {
    for (const mesh of this.meshes) mesh.layers.disable(SURFACE_LAYER)
    this.meshes = []
    const used = new Set<THREE.Material>()
    for (const root of roots) {
      root.traverse((obj) => {
        const mesh = obj as THREE.Mesh
        if (!mesh.isMesh || !reflective(mesh)) return
        if (within < Infinity && !near(mesh, within)) return
        mesh.layers.enable(SURFACE_LAYER)
        this.meshes.push(mesh)
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) used.add(m)
      })
    }
    // stand-ins for materials no longer drawn
    for (const [src, m] of this.standIns) {
      if (used.has(src)) continue
      m.dispose()
      this.standIns.delete(src)
    }
  }

  get hasSurfaces(): boolean {
    return this.meshes.length > 0
  }

  override setDepthTexture(depthTexture: THREE.Texture): void {
    this.traceMaterial.uniforms.depthBuffer.value = depthTexture
  }

  override setSize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width / 2))
    const h = Math.max(1, Math.round(height / 2))
    this.surfaces.setSize(w, h)
    this.trace.setSize(w, h)
    this.traceMaterial.uniforms.resolution.value.set(w, h)
    this.compositeMaterial.uniforms.traceTexel.value.set(1 / w, 1 / h)
  }

  /** draws nothing: a multi-material mesh's parts that aren't standard stay out of the G-buffer */
  private readonly skip = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })

  private standIn(src: THREE.Material): THREE.Material {
    if (!isStandard(src)) return this.skip
    let m = this.standIns.get(src)
    if (!m) {
      m = createSurfaceMaterial(src)
      this.standIns.set(src, m)
    }
    syncSurfaceMaterial(m, src)
    return m
  }

  private drawSurfaces(renderer: THREE.WebGLRenderer): void {
    const originals: (THREE.Material | THREE.Material[])[] = []
    const hidden: THREE.Mesh[] = []
    for (const mesh of this.meshes) {
      originals.push(mesh.material)
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => this.standIn(m))
      } else if (isStandard(mesh.material)) {
        mesh.material = this.standIn(mesh.material)
      } else {
        // (its material was swapped for an unlit one since the scope was collected)
        hidden.push(mesh)
        mesh.layers.disable(SURFACE_LAYER)
      }
    }
    const cam = this.layerCamera
    cam.copy(this.view, false)
    cam.layers.set(SURFACE_LAYER)
    const background = this.world.background
    const clear = renderer.getClearColor(new THREE.Color())
    const clearAlpha = renderer.getClearAlpha()
    this.world.background = null
    renderer.setClearColor(0x000000, 0)
    renderer.setRenderTarget(this.surfaces)
    renderer.clear()
    renderer.render(this.world, cam)
    renderer.setClearColor(clear, clearAlpha)
    this.world.background = background
    this.meshes.forEach((mesh, i) => (mesh.material = originals[i]))
    for (const mesh of hidden) mesh.layers.enable(SURFACE_LAYER)
  }

  override render(
    renderer: THREE.WebGLRenderer,
    inputBuffer: THREE.WebGLRenderTarget | null,
    outputBuffer: THREE.WebGLRenderTarget | null,
  ): void {
    if (!inputBuffer) return
    this.drawSurfaces(renderer)

    const t = this.traceMaterial.uniforms
    t.projection.value.copy(this.view.projectionMatrix)
    t.inverseProjection.value.copy(this.view.projectionMatrixInverse)
    t.roughCut.value = this.roughCut
    t.colorBuffer.value = inputBuffer.texture
    t.cameraNear.value = this.view.near
    t.maxDistance.value = this.maxDistance
    t.steps.value = this.steps
    t.frame.value = this.frame++ % 64
    this.fullscreenMaterial = this.traceMaterial
    renderer.setRenderTarget(this.trace)
    renderer.render(this.scene, this.camera)

    const c = this.compositeMaterial.uniforms
    c.inputBuffer.value = inputBuffer.texture
    c.strength.value = this.strength
    c.debugView.value = this.debugView
    this.fullscreenMaterial = this.compositeMaterial
    renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer)
    renderer.render(this.scene, this.camera)
  }

  override dispose(): void {
    this.setRoots([])
    this.surfaces.depthTexture?.dispose()
    this.surfaces.dispose()
    this.trace.dispose()
    this.traceMaterial.dispose()
    this.compositeMaterial.dispose()
    this.skip.dispose()
    super.dispose()
  }
}
