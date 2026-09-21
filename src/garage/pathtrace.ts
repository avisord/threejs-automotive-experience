import * as THREE from 'three'
import { DenoiseMaterial, WebGLPathTracer } from 'three-gpu-pathtracer'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { ParallelMeshBVHWorker } from 'three-mesh-bvh/worker'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type PathTraceStatus = 'building' | 'tracing' | 'done'

/** the vertex attributes the tracer reads */
const TRACED_ATTRIBUTES = ['position', 'normal', 'tangent', 'uv', 'color']

export interface PathTraceOptions {
  bounces: number
  /** stop once this many samples per pixel are in */
  samples: number
  /** traced buffer size relative to the canvas in CSS pixels (not device pixels) */
  resolution: number
  /** smooth early samples with an edge-aware blur that fades out as the image converges */
  denoise: boolean
}

/** samples by which the denoiser has faded out completely */
const DENOISE_END = 192
/** GPU time to hand over per batch — short enough that a camera move never waits long */
const BATCH_MS = 30

export interface PathTracer {
  readonly status: PathTraceStatus
  readonly samples: number
  /** the accumulated image (linear HDR), or null before the first sample */
  readonly texture: THREE.Texture | null
  setOptions(options: PathTraceOptions): void
  /** geometry, lights or materials changed — rebuild before tracing again */
  invalidate(): void
  /** the camera moved — throw away what's been accumulated */
  cameraChanged(): void
  /** do the next unit of work (start a build, or one sample); true while there's more to do */
  step(): boolean
  /** the underlying three-gpu-pathtracer, for tuning from the console */
  readonly engine: WebGLPathTracer
  dispose(): void
}

export interface PathTraceScene {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  /** objects the path tracer must not see: contact shadows, fake effects */
  hidden(): THREE.Object3D[]
  /** see-through surfaces that are only see-through for the raster mirror trick */
  opaque(): THREE.Object3D[]
  /** a build finished (the caller should draw a frame) */
  onReady(): void
}

/**
 * Progressive path tracing (three-gpu-pathtracer) of the same scene the
 * rasteriser draws. The path tracer only understands standard materials, so
 * for each build the scene is shown to it through proxies:
 *
 *  - unlit glow materials (LED strips, softbox panels) become emissive ones,
 *    so they actually light the room
 *  - repainted parts use their main colour — the shader patterns can't run
 *  - instanced meshes are merged (the tracer ignores instancing)
 *  - shader-based fakes (the floor mirror, headlight beams, selection
 *    overlays) are hidden: the path tracer does reflections and light for real
 *
 * Proxies are cached per source, so a material-only change rebuilds cheaply.
 */
export function createPathTracer(renderer: THREE.WebGLRenderer, host: PathTraceScene): PathTracer {
  const pt = new WebGLPathTracer(renderer)
  pt.renderToCanvas = false // the composer draws it, through the same grade as raster
  pt.rasterizeScene = false
  pt.synchronizeRenderSize = true
  pt.minSamples = 1
  pt.renderDelay = 0
  pt.fadeDuration = 0
  pt.filterGlossyFactor = 0.5 // tames fireflies from glossy paint seen off diffuse walls
  // small tiles keep each submission short, so a camera move is never stuck
  // behind a long queue of path tracing work (see step())
  pt.tiles.set(3, 3)
  const worker = new ParallelMeshBVHWorker()

  const gl = renderer.getContext() as WebGL2RenderingContext
  /** batches handed to the GPU and not yet finished, oldest first */
  const inFlight: { fence: WebGLSync; tiles: number }[] = []
  /** estimated GPU time per tile, ms (smoothed) */
  let msPerTile = 20
  let lastDrainAt = 0
  let resolution = 0.75
  let denoise = true

  const denoiser = new FullScreenQuad(new DenoiseMaterial({ sigma: 5, threshold: 0.03, kSigma: 1 }))
  const denoised = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false })
  let denoisedAt = -1

  /** retire finished batches, learning from them how long a tile takes */
  function retire(): void {
    while (inFlight.length > 0) {
      const oldest = inFlight[0]
      if (gl.getSyncParameter(oldest.fence, gl.SYNC_STATUS) !== gl.SIGNALED) return
      gl.deleteSync(oldest.fence)
      inFlight.shift()
      const now = performance.now()
      // with a batch always queued behind this one, the time between drains is GPU time
      if (lastDrainAt > 0 && now - lastDrainAt < 1000) {
        msPerTile = THREE.MathUtils.lerp(msPerTile, (now - lastDrainAt) / oldest.tiles, 0.3)
      }
      lastDrainAt = now
    }
  }

  function denoisedTexture(): THREE.Texture {
    const source = pt.target
    const k = Math.min(1, pt.samples / DENOISE_END)
    if (denoisedAt !== pt.samples) {
      if (denoised.width !== source.width || denoised.height !== source.height) denoised.setSize(source.width, source.height)
      const m = denoiser.material as DenoiseMaterial
      m.map = source.texture
      m.sigma = THREE.MathUtils.lerp(5, 1.5, k)
      m.threshold = THREE.MathUtils.lerp(0.18, 0.03, k) // early noise on bright paint is big in HDR
      const previous = renderer.getRenderTarget()
      renderer.setRenderTarget(denoised)
      denoiser.render(renderer)
      renderer.setRenderTarget(previous)
      denoisedAt = pt.samples
    }
    return denoised.texture
  }
  pt.setBVHWorker(worker)

  let status: PathTraceStatus = 'building'
  let dirty = true
  let building = false
  let built = false
  let target = 256

  const materialProxies = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>()
  const instanceProxies = new WeakMap<THREE.InstancedMesh, THREE.Mesh>()
  const mergedGeometries = new Set<THREE.BufferGeometry>()
  const floatGeometries = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()
  const ownedGeometries = new Set<THREE.BufferGeometry>()

  /**
   * The tracer copies vertex data in its source array type, so meshopt's
   * quantized attributes (normalized Int16 positions and the like) come out
   * clamped and then get read back as raw integers — garbage triangles the
   * size of the room. Give it plain float copies instead (cached per geometry).
   */
  function floatGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
    const attrs = Object.entries(g.attributes).filter(([name]) => TRACED_ATTRIBUTES.includes(name))
    const quantized = attrs.some(
      ([, a]) => (a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute || a.normalized || !(a.array instanceof Float32Array),
    )
    if (!quantized) return g
    let f = floatGeometries.get(g)
    if (f) return f
    f = new THREE.BufferGeometry()
    if (g.index) f.setIndex(g.index)
    for (const [name, a] of attrs) {
      const n = a.itemSize
      const out = new Float32Array(a.count * n)
      for (let i = 0; i < a.count; i++) {
        out[i * n] = a.getX(i)
        if (n > 1) out[i * n + 1] = a.getY(i)
        if (n > 2) out[i * n + 2] = a.getZ(i)
        if (n > 3) out[i * n + 3] = a.getW(i)
      }
      f.setAttribute(name, new THREE.BufferAttribute(out, n))
    }
    for (const group of g.groups) f.addGroup(group.start, group.count, group.materialIndex)
    floatGeometries.set(g, f)
    ownedGeometries.add(f)
    return f
  }

  /** the material the path tracer should see, or null to hide the mesh */
  function proxyFor(material: THREE.Material, opaque: boolean): THREE.Material | null {
    if ((material as THREE.ShaderMaterial).isShaderMaterial) return null
    const basic = material as THREE.MeshBasicMaterial
    if (basic.isMeshBasicMaterial) {
      const p = materialProxies.get(material) ?? new THREE.MeshStandardMaterial()
      materialProxies.set(material, p)
      p.color.set(0x000000)
      p.emissive.copy(basic.color) // HDR colour → emitted radiance
      p.emissiveIntensity = 1
      p.emissiveMap = basic.map
      p.roughness = 1
      p.metalness = 0
      p.transparent = basic.transparent
      p.opacity = basic.opacity
      p.side = basic.side
      return p
    }
    const albedo = material.userData.albedo as THREE.Color | null | undefined
    if (!albedo && !opaque) return material
    let p = materialProxies.get(material)
    if (p) p.copy(material as THREE.MeshStandardMaterial)
    else p = (material as THREE.MeshStandardMaterial).clone()
    materialProxies.set(material, p)
    if (albedo) {
      p.color.copy(albedo)
      p.map = null
    }
    if (opaque) {
      p.transparent = false
      p.opacity = 1
    }
    return p
  }

  /** dress the scene for the path tracer; returns the undo */
  function prepare(): () => void {
    const undo: (() => void)[] = []
    const hidden = new Set(host.hidden())
    const opaque = new Set(host.opaque())

    // instanced meshes → one merged mesh each, parked next to the original
    host.scene.traverse((obj) => {
      const im = obj as THREE.InstancedMesh
      if (!im.isInstancedMesh || !im.visible || !im.parent) return
      let merged = instanceProxies.get(im)
      if (!merged) {
        const m = new THREE.Matrix4()
        const parts: THREE.BufferGeometry[] = []
        for (let i = 0; i < im.count; i++) {
          im.getMatrixAt(i, m)
          parts.push(im.geometry.clone().applyMatrix4(m))
        }
        merged = new THREE.Mesh(mergeGeometries(parts) ?? new THREE.BufferGeometry(), im.material)
        for (const g of parts) g.dispose()
        merged.matrixAutoUpdate = false
        instanceProxies.set(im, merged)
        mergedGeometries.add(merged.geometry)
      }
      merged.matrix.copy(im.matrix)
      im.parent.add(merged)
      im.visible = false
      const parent = im.parent
      undo.push(() => {
        parent.remove(merged)
        im.visible = true
      })
    })

    host.scene.traverse((obj) => {
      if (!obj.visible) return
      const mesh = obj as THREE.Mesh
      if (hidden.has(obj) || obj.userData.overlay) {
        obj.visible = false
        undo.push(() => (obj.visible = true))
        return
      }
      if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh) return
      const geometry = mesh.geometry
      const traced = floatGeometry(geometry)
      if (traced !== geometry) {
        mesh.geometry = traced
        undo.push(() => (mesh.geometry = geometry))
      }
      const source = mesh.material
      const materials = Array.isArray(source) ? source : [source]
      const proxies = materials.map((m) => proxyFor(m, opaque.has(mesh)))
      if (proxies.some((p) => p === null)) {
        mesh.visible = false
        undo.push(() => (mesh.visible = true))
        return
      }
      if (proxies.every((p, i) => p === materials[i])) return
      mesh.material = Array.isArray(source) ? (proxies as THREE.Material[]) : proxies[0]!
      undo.push(() => (mesh.material = source))
    })

    return () => {
      for (let i = undo.length - 1; i >= 0; i--) undo[i]()
    }
  }

  async function build(): Promise<void> {
    building = true
    dirty = false
    status = 'building'
    // The tracer reads the environment when the async build finishes, so it's
    // handed a stand-in scene: the real one parented under it (harmless for the
    // rasteriser) with no environment map — the room itself is what the car
    // reflects when rays are traced, and the PMREM capture isn't a format the
    // tracer can sample anyway.
    const stage = new THREE.Scene()
    stage.background = host.scene.background
    stage.environment = null
    stage.add(host.scene)
    const restore = prepare()
    let pending: Promise<unknown>
    try {
      pending = pt.setSceneAsync(stage, host.camera)
    } finally {
      restore() // geometry, materials and lights were read synchronously
    }
    try {
      await pending
      built = true
    } catch (err) {
      console.error('[garage] path tracer build failed', err)
    } finally {
      stage.remove(host.scene)
      building = false
      status = dirty ? 'building' : 'tracing'
      host.onReady()
    }
  }

  return {
    get status() {
      return status
    },
    get samples() {
      return built ? Math.floor(pt.samples) : 0
    },
    engine: pt,
    get texture() {
      if (!built || pt.samples < 1) return null
      return denoise && pt.samples < DENOISE_END ? denoisedTexture() : pt.target.texture
    },
    setOptions(o) {
      pt.bounces = o.bounces
      resolution = o.resolution
      denoise = o.denoise
      target = o.samples
      if (built) pt.reset()
      if (status === 'done') status = 'tracing'
    },
    invalidate() {
      dirty = true
      status = 'building'
    },
    cameraChanged() {
      if (!built) return
      pt.updateCamera() // also resets the accumulation
      if (status === 'done') status = 'tracing'
    },
    step() {
      if (dirty && !building) void build()
      if (building || !built) return false // build() calls onReady when it's done
      if (pt.samples >= target) {
        status = 'done'
        return false
      }
      status = 'tracing'
      // Pace the work to the GPU. WebGL queues whatever it's given, and a
      // backlog of path tracing sits in front of every raster frame — a camera
      // drag would stutter for seconds. Keep at most two ~30 ms batches in
      // flight: one running, one queued so the GPU never idles, and a camera
      // move waits for at most that much.
      retire()
      if (inFlight.length >= 2) return true
      if (inFlight.length === 0) lastDrainAt = 0 // nothing queued: the next gap isn't GPU time
      const tiles = THREE.MathUtils.clamp(Math.round(BATCH_MS / msPerTile), 1, 18)
      // trace at CSS-pixel resolution: on a 2x display, device pixels would be 4x the work for a noisy image
      pt.renderScale = resolution / renderer.getPixelRatio()
      for (let i = 0; i < tiles && pt.samples < target; i++) pt.renderSample()
      inFlight.push({ fence: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!, tiles })
      gl.flush()
      return true
    },
    dispose() {
      for (const f of inFlight) gl.deleteSync(f.fence)
      denoiser.dispose()
      ;(denoiser.material as THREE.Material).dispose()
      denoised.dispose()
      pt.dispose()
      worker.dispose()
      for (const g of mergedGeometries) g.dispose()
      for (const g of ownedGeometries) g.dispose()
    },
  }
}
