import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import type { AtmosphereParams } from '../atmosphere-effect'
import type { GradeLook } from '../post'
import type { SunPosition } from './sky'
import type { InteriorLights } from './interior'

/**
 * A garage: the room around the car and everything that lights it. Swapping
 * the garage swaps the whole scene — geometry, lights, background and the
 * environment map the car reflects (captured from the room, see main.ts).
 */
export interface GarageDef {
  id: string
  name: string
  /** one-liner on the card */
  tag: string
  /** the light palette, shown as a strip on the card */
  palette: string[]
  /** colour grade look applied when the garage is picked */
  look: GradeLook
  /**
   * The brightness the garage is lit and graded for: the mean log2 luminance of its default view
   * (`garage.post.readMeter()`). Auto exposure brings every view in it toward this — looking up at a
   * bright sky or down into shade — so the garage keeps its own mood (a dark neon bay stays dark).
   */
  exposureKey: number
  create(): Room
}

export interface Room {
  group: THREE.Group
  reflector: Reflector
  /**
   * Things lying on the floor (tile overlay, markings, contact shadow). They
   * are hidden while the mirror renders, otherwise they'd block the reflection.
   */
  floorLayers: THREE.Object3D[]
  /** where the camera may go: the interior minus a margin, clear of walls and pillars */
  bounds: THREE.Box3
  background: THREE.Color
  environmentIntensity: number
  /** match the mirror's render target to the viewport, at the current reflection scale */
  resize(width: number, height: number, pixelRatio: number): void
  /**
   * Floor mirror resolution relative to the canvas (0.5 reads as polished
   * epoxy). 0 switches the mirror off entirely — the car is then drawn once
   * per frame instead of twice — and makes the floor surface opaque.
   */
  setReflectionScale(scale: number): void
  /** free every geometry, material, texture and render target the room made */
  dispose(): void
  /**
   * Resolves once assets the room loads in the background (a sky HDR) are in.
   * The room is usable before; the app re-captures its environment map then.
   */
  ready?: Promise<void>
  /** advance anything that moves on its own (water ripples); called for every frame drawn */
  update?(dt: number): void
  /**
   * Open-air rooms: meshes lit by the open sky. The room's own environment
   * map is captured from inside (under a roof, for a pavilion) — the land
   * outside gets a second one, captured from `probe` out in the open.
   */
  outdoor?: {
    root: THREE.Object3D
    probe: THREE.Vector3
    /** around environment captures: hide what mustn't be in them (a sun disc's spike smears in the prefilter) */
    beforeCapture?(): void
    afterCapture?(): void
  }
  /** a sun the user can move (Menu › Garage); the app re-captures the environment after a move */
  sun?: {
    get(): SunPosition
    set(sun: SunPosition): void
  }
  /** the room's air, for the atmosphere effect (haze, light shafts) */
  atmosphere?: AtmosphereParams
  /** something that casts the sun's shadow changed (a car arrived or left): re-render its shadow map */
  shadowsChanged?(): void
  /** the room's own light fittings, in groups the user can switch, dim and warm (Menu › Garage) */
  interior?: InteriorLights
  /**
   * A photographic location: depth of field on by default here (Settings › Graphics › Depth of
   * field, "Auto"), with this aperture — the blur's scale, in pixels at half resolution, reached
   * right by the lens (the background gets ~a third of it, post.ts `lensCoc`).
   */
  depthOfField?: { bokehScale: number }
}

/**
 * Unlit HDR material — values above 1 light up reflections, and with `bloom`
 * they're picked up by the "lights only" bloom (see collectGlowMeshes).
 * Big soft emitters (softboxes, windows) look better without the bloom.
 */
export function glowMaterial(color: THREE.ColorRepresentation, glow: number, bloom = true): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(glow) })
  material.userData.glow = bloom
  return material
}

/** every mesh drawn with a light-emitting material — what "lights only" bloom blooms */
export function collectGlowMeshes(root: THREE.Object3D): THREE.Object3D[] {
  const found: THREE.Object3D[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    // imported models (fbx, obj) can carry a material array: one per geometry group
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((m) => m?.userData.glow)) found.push(obj)
  })
  return found
}

export function box(
  parent: THREE.Object3D,
  size: [number, number, number],
  material: THREE.Material,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  parent.add(mesh)
  return mesh
}

/**
 * A rect area light with a visible emitter panel of the same size, facing
 * `target`. Rect lights emit along their -z; the panel is lit on that side.
 */
export function softbox(
  parent: THREE.Object3D,
  opts: {
    size: [width: number, height: number]
    position: [number, number, number]
    target: [number, number, number]
    color: THREE.ColorRepresentation
    intensity: number
    /** HDR brightness of the visible panel */
    glow: number
    bloom?: boolean
  },
): THREE.RectAreaLight {
  const [width, height] = opts.size
  const light = new THREE.RectAreaLight(opts.color, opts.intensity, width, height)
  light.position.set(...opts.position)
  // aiming straight down would leave the default up vector parallel to the aim
  const [x, y, z] = opts.position
  const [tx, ty, tz] = opts.target
  if (Math.hypot(tx - x, tz - z) < 1e-3 * Math.abs(ty - y)) light.up.set(0, 0, -1)
  light.lookAt(tx, ty, tz)
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glowMaterial(opts.color, opts.glow, opts.bloom ?? false))
  panel.rotation.y = Math.PI // plane faces +z; flip it to face along the light
  panel.position.z = 0.01
  // dark housing a little larger than the panel: reads as a frame, hides the unlit back
  const housing = new THREE.Mesh(
    new THREE.PlaneGeometry(width + 0.14, height + 0.14),
    new THREE.MeshStandardMaterial({ color: 0x101114, roughness: 0.6, side: THREE.DoubleSide }),
  )
  housing.position.z = 0.03
  light.add(panel, housing)
  parent.add(light)
  return light
}

/** Seamless floor tile: bright base (the material colour tints it) with dark seams and a little grain. */
export function floorTileTexture(repeat: [number, number], seam = '#3a3a3a'): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const grain = g.createImageData(size, size)
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = 235 + Math.random() * 20
    grain.data[i] = grain.data[i + 1] = grain.data[i + 2] = v
    grain.data[i + 3] = 255
  }
  g.putImageData(grain, 0, 0)
  g.fillStyle = seam
  g.fillRect(0, 0, size, 3)
  g.fillRect(0, 0, 3, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 8
  return texture
}

/**
 * Photographed PBR surfaces in `public/textures/<name>/`: 2k colour (ambient
 * occlusion baked in), OpenGL normal and roughness maps, from Poly Haven (CC0).
 * `tile` is how many metres one copy of the texture covers.
 */
export const SURFACES = {
  /** polished grey concrete floor — Poly Haven "Concrete Floor Worn 001" */
  concreteFloor: { dir: 'concrete-floor', tile: 3 },
  /** cast concrete panels with seams and pores — Poly Haven "Concrete" */
  concretePanels: { dir: 'concrete-panels', tile: 4 },
  /** fibrous Japanese cedar (sugi) bark, 1 × 2 m — Poly Haven "Japanese Cedar Bark" */
  cedarBark: { dir: 'japanese-cedar-bark', tile: 1 },
  /** short grass over soil, 2 × 2 m — Poly Haven "Sparse Grass" (the terrain uses it for detail, not colour) */
  sparseGrass: { dir: 'sparse-grass', tile: 2 },
  /** dry river pebbles, 2 × 2 m — Poly Haven "Dry River Pebbles" */
  riverPebbles: { dir: 'river-pebbles', tile: 2 },
} as const

export interface PbrMaps {
  /** spread into a MeshStandardMaterial */
  maps: { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }
  /** resolves when all three are in (never rejects — a failed map just stays blank) */
  ready: Promise<void>
}

/**
 * Load a surface's maps, repeated `repeat` times across the geometry's uv 0–1
 * (pass [1, 1] for geometry whose uvs are already in tiles, see boxUV). Each
 * call loads its own textures — a room disposes everything it made.
 */
export function pbrMaps(surface: { dir: string }, repeat: [number, number] = [1, 1]): PbrMaps {
  const loader = new THREE.TextureLoader()
  const pending: Promise<unknown>[] = []
  const load = (file: string, color: boolean) => {
    const url = `/textures/${surface.dir}/${file}.webp`
    let done!: () => void
    pending.push(new Promise<void>((resolve) => (done = resolve)))
    const texture = loader.load(url, () => done(), undefined, (err) => {
      console.error(`[garage] texture failed: ${url}`, err)
      done()
    })
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.repeat.set(...repeat)
    texture.anisotropy = 8
    return texture
  }
  const maps = { map: load('color', true), normalMap: load('normal', false), roughnessMap: load('rough', false) }
  return { maps, ready: Promise.all(pending).then(() => {}) }
}

/**
 * Give a box geometry uvs in world units (one unit = `tile` metres) instead of
 * 0–1 per face, so boxes of any size share one texture scale — a long roof
 * slab and a short rim look like the same concrete.
 */
export function boxUV(geometry: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geometry.attributes.position
  const nrm = geometry.attributes.normal
  const uv = geometry.attributes.uv
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(nrm.getX(i))
    const ay = Math.abs(nrm.getY(i))
    const az = Math.abs(nrm.getZ(i))
    const [u, v] =
      ax >= ay && ax >= az ? [pos.getZ(i), pos.getY(i)] : ay >= az ? [pos.getX(i), pos.getZ(i)] : [pos.getX(i), pos.getY(i)]
    uv.setXY(i, u / tile, v / tile)
  }
  uv.needsUpdate = true
  return geometry
}

/** Tileable blotchy noise for concrete and plaster: white-ish, tint it with the material colour. */
export function concreteTexture(repeat: [number, number], contrast = 1): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = '#d8d8d8'
  g.fillRect(0, 0, size, size)
  // Soft blotches, drawn wrapped so the tile repeats seamlessly. They sit 16 below the base on
  // average at full contrast (raw concrete's darker mottling); `contrast` scales that offset too
  // — scaling only their spread left every blotch 16 darker even at 0.1, and a "barely-there"
  // plaster wall (Light Wall) came out stained. At contrast ≥ 1 it's as before.
  const mean = 216 - 16 * Math.min(1, contrast)
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 8 + Math.random() * 60
    const v = Math.round(mean + (Math.random() - 0.5) * 90 * contrast)
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
        grad.addColorStop(0, `rgba(${v},${v},${v},0.35)`)
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`)
        g.fillStyle = grad
        g.fillRect(x + dx - r, y + dy - r, r * 2, r * 2)
      }
    }
  }
  const grain = g.getImageData(0, 0, size, size)
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28 * contrast
    grain.data[i] += n
    grain.data[i + 1] += n
    grain.data[i + 2] += n
  }
  g.putImageData(grain, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 8
  return texture
}

/**
 * Reflector shader with a soft, glossy look instead of a perfect mirror:
 * a golden-angle disc of taps over a blurred mip level of the reflection.
 */
const BlurredReflectorShader = {
  name: 'BlurredReflectorShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    /** disc radius in screen uv */
    blur: { value: 0.012 },
    /** mip level sampled — each step halves the resolution */
    lod: { value: 1.5 },
    /**
     * Reflectance looking straight down, as a fraction of `color` (1 = no Fresnel). A polished
     * floor reflects a few percent seen from above and most of the light at a grazing angle —
     * without it, a floor seen from a standing height mirrored the whole bright sky past the roof.
     */
    fresnel: { value: 1 },
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
    uniform float blur;
    uniform float lod;
    uniform float fresnel;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec3 sum = vec3( 0.0 );
      const int TAPS = 16;
      for ( int i = 0; i < TAPS; i ++ ) {
        float fi = float( i ) + 0.5;
        float a = fi * 2.39996323; // golden angle spreads taps evenly over the disc
        vec2 offset = vec2( cos( a ), sin( a ) ) * sqrt( fi / float( TAPS ) ) * blur;
        // (clamped: the sun's disc in the mirror overflows half floats — an inf here, spread by the
        // blur and by depth of field, became a blown-out blob on the floor)
        sum += min( textureLod( tDiffuse, uv + offset, lod ).rgb, vec3( 64.0 ) );
      }
      // Schlick, from the reflectance straight down to 1 at grazing (the floor's normal is +y)
      float cosV = clamp( normalize( cameraPosition - vWorld ).y, 0.0, 1.0 );
      float f = fresnel + ( 1.0 - fresnel ) * pow( 1.0 - cosV, 5.0 );
      gl_FragColor = vec4( color * f * sum / float( TAPS ), 1.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

export interface FloorOptions {
  /** floor outline in the XY plane; it's laid flat at y = 0 */
  geometry: THREE.BufferGeometry
  /** reflection tint — darker is a weaker mirror */
  tint: THREE.ColorRepresentation
  /** how soft the reflection is, in screen uv (0.012 = polished epoxy, lower = wet) */
  blur?: number
  lod?: number
  /** reflectance seen straight down, relative to `tint` (default 1: no Fresnel falloff) */
  fresnel?: number
  /** the surface laid over the mirror; its opacity sets how much reflection shows through */
  surface: THREE.MeshStandardMaterial
}

export interface Floor {
  reflector: Reflector
  floorLayers: THREE.Object3D[]
  resize: Room['resize']
  setReflectionScale: Room['setReflectionScale']
}

/** Floor mirror underneath, a semi-opaque surface on top. */
export function createFloor(parent: THREE.Object3D, opts: FloorOptions): Floor {
  const reflector = new Reflector(opts.geometry, {
    color: opts.tint,
    textureWidth: 1024,
    textureHeight: 1024,
    clipBias: 0.003,
    shader: BlurredReflectorShader,
  })
  const uniforms = (reflector.material as THREE.ShaderMaterial).uniforms
  uniforms.blur.value = opts.blur ?? 0.012
  uniforms.lod.value = opts.lod ?? 1.5
  uniforms.fresnel.value = opts.fresnel ?? 1
  reflector.rotation.x = -Math.PI / 2
  // the blur samples a mip level, so the mirror target needs a mip chain
  const mirrorTexture = reflector.getRenderTarget().texture
  mirrorTexture.generateMipmaps = true
  mirrorTexture.minFilter = THREE.LinearMipmapLinearFilter
  parent.add(reflector)

  const surfaceOpacity = opts.surface.opacity
  opts.surface.transparent = true
  opts.surface.depthWrite = false
  const surface = new THREE.Mesh(opts.geometry.clone(), opts.surface)
  surface.rotation.x = -Math.PI / 2
  surface.position.y = 0.002
  parent.add(surface)

  const floorLayers: THREE.Object3D[] = [surface]
  const baseBeforeRender = reflector.onBeforeRender
  reflector.onBeforeRender = (...args) => {
    for (const o of floorLayers) o.visible = false
    baseBeforeRender.apply(reflector, args)
    for (const o of floorLayers) o.visible = true
  }

  let reflectionScale = 0.5
  const viewport = { width: 1, height: 1, pixelRatio: 1 }
  function sizeMirror(): void {
    const k = viewport.pixelRatio * Math.max(reflectionScale, 0.05)
    reflector.getRenderTarget().setSize(Math.round(viewport.width * k), Math.round(viewport.height * k))
  }

  return {
    reflector,
    floorLayers,
    resize(width, height, pixelRatio) {
      Object.assign(viewport, { width, height, pixelRatio })
      sizeMirror()
    },
    setReflectionScale(scale) {
      reflectionScale = scale
      reflector.visible = scale > 0
      opts.surface.opacity = scale > 0 ? surfaceOpacity : 1
      sizeMirror()
    },
  }
}

/** everything a garage needs besides its group and floor */
export interface RoomOptions {
  /** interior box (min/max corners) the camera may occupy */
  bounds: [min: [number, number, number], max: [number, number, number]]
  background: THREE.ColorRepresentation
  environmentIntensity: number
  ready?: Promise<void>
}

export function assembleRoom(group: THREE.Group, floor: Floor, opts: RoomOptions): Room {
  return {
    group,
    reflector: floor.reflector,
    floorLayers: floor.floorLayers,
    bounds: new THREE.Box3(new THREE.Vector3(...opts.bounds[0]), new THREE.Vector3(...opts.bounds[1])),
    background: new THREE.Color(opts.background),
    environmentIntensity: opts.environmentIntensity,
    resize: floor.resize,
    setReflectionScale: floor.setReflectionScale,
    dispose: () => disposeTree(group),
    ready: opts.ready,
  }
}

/** free every geometry, material, texture, light and mirror under `root` */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof Reflector) {
      obj.dispose() // render target and material, not the geometry
      obj.geometry.dispose()
      return
    }
    // a shadow-casting light owns its shadow map's render target (colour + depth textures)
    const light = obj as THREE.Light
    if (light.isLight) {
      light.dispose()
      return
    }
    // meshes, and lines and points too (a landscape's power lines)
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh && !(obj as THREE.Line).isLine && !(obj as THREE.Points).isPoints) return
    mesh.geometry.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose()
      material.dispose()
    }
  })
}
