import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js'
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js'
import { USDZLoader } from 'three/examples/jsm/loaders/USDZLoader.js'
import { extension, type UploadFile } from './uploads'

// Lazily imported (the loaders are a few hundred kB): only when a model is uploaded or an
// uploaded one is shown. Draco and Basis decoders are served from public/decoders.

let draco: DRACOLoader | null = null
let ktx2: KTX2Loader | null = null

/**
 * Parse an uploaded model from its files. References between them (a .gltf's
 * .bin and textures, an .obj's .mtl, an .fbx's texture paths — often absolute
 * paths on the author's machine) are resolved by path suffix, then by file name.
 * Materials come out as MeshStandardMaterial whatever the format used.
 */
export async function parseModel(
  files: UploadFile[],
  main: string,
  renderer: THREE.WebGLRenderer,
  onProgress?: (fraction: number) => void,
): Promise<THREE.Object3D> {
  const urls = new Map<string, string>()
  const byName = new Map<string, string>()
  for (const f of files) {
    const url = URL.createObjectURL(f.blob)
    urls.set(f.name.toLowerCase(), url)
    byName.set(f.name.split('/').pop()!.toLowerCase(), url)
  }
  const mainUrl = urls.get(main.toLowerCase())!

  const resolve = (url: string): string => {
    if (url === mainUrl || url.startsWith('data:')) return url
    let path = url
    try {
      path = decodeURIComponent(url.replace(/^blob:[^/]*\/\/[^/]+\//, '').replace(/[?#].*$/, ''))
    } catch {
      // keep it as written
    }
    path = path.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase()
    for (const [name, blobUrl] of urls) {
      if (name === path || name.endsWith(`/${path}`) || path.endsWith(`/${name}`)) return blobUrl
    }
    return byName.get(path.split('/').pop()!) ?? url
  }

  // every file the loaders fetch goes through here; the blob URLs live until the last is in
  let pending = 0
  let settle: (() => void) | null = null
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(resolve)
  manager.itemStart = ((start) => (url: string) => (pending++, start(url)))(manager.itemStart.bind(manager))
  manager.itemEnd = ((end) => (url: string) => (end(url), --pending === 0 && settle?.()))(manager.itemEnd.bind(manager))
  manager.itemError = ((error) => (url: string) => (console.warn('[garage] upload: missing', url), error(url)))(manager.itemError.bind(manager))

  const progress = (e: ProgressEvent) => e.lengthComputable && onProgress?.(e.loaded / e.total)
  let model: THREE.Object3D
  try {
    switch (extension(main)) {
      case 'glb':
      case 'gltf': {
        draco ??= new DRACOLoader().setDecoderPath('/decoders/draco/')
        ktx2 ??= new KTX2Loader().setTranscoderPath('/decoders/basis/').detectSupport(renderer)
        const loader = new GLTFLoader(manager).setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder)
        model = (await loader.loadAsync(mainUrl, progress)).scene
        break
      }
      case 'fbx':
        model = await new FBXLoader(manager).loadAsync(mainUrl, progress)
        break
      case 'obj': {
        const loader = new OBJLoader(manager)
        const mtl = files.find((f) => extension(f.name) === 'mtl')
        if (mtl) {
          const materials = await new MTLLoader(manager).loadAsync(urls.get(mtl.name.toLowerCase())!)
          materials.preload()
          loader.setMaterials(materials)
        }
        model = await loader.loadAsync(mainUrl, progress)
        break
      }
      case 'dae':
        model = (await new ColladaLoader(manager).loadAsync(mainUrl, progress))!.scene
        break
      case '3ds':
        model = await new TDSLoader(manager).loadAsync(mainUrl, progress)
        break
      case 'usdz':
        model = await new USDZLoader(manager).loadAsync(mainUrl, progress)
        break
      default:
        throw new Error(`can't read .${extension(main)} files`)
    }
    // textures a loader started on its own (FBX, OBJ) are still arriving
    if (pending > 0) await Promise.race([new Promise<void>((r) => (settle = r)), new Promise((r) => setTimeout(r, 60_000))])
  } finally {
    for (const url of urls.values()) URL.revokeObjectURL(url)
  }

  tidy(model)
  return model
}

/** drop what the bay can't show (lines, points, cameras, lights) and make every material PBR */
function tidy(model: THREE.Object3D): void {
  const drop: THREE.Object3D[] = []
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if ((o as THREE.Light).isLight || (o as THREE.Camera).isCamera || (o as THREE.Line).isLine || (o as THREE.Points).isPoints) {
      drop.push(o)
      return
    }
    if (!mesh.isMesh) return
    if (!mesh.geometry.attributes.normal) mesh.geometry.computeVertexNormals()
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toStandard) : toStandard(mesh.material)
  })
  for (const o of drop) o.removeFromParent()

  // Sketchfab-style baked ground shadows: a flat quad under (or, Z-up, beside) the model
  // covering its footprint. It would be measured as part of the vehicle and drawn over the floor.
  model.updateMatrixWorld(true)
  const whole = new THREE.Box3().setFromObject(model, true)
  const size = whole.getSize(new THREE.Vector3()).toArray()
  const longest = Math.max(...size)
  const b = new THREE.Box3()
  const planes: THREE.Mesh[] = []
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || mesh.geometry.attributes.position.count > 64) return
    const s = b.setFromObject(mesh, true).getSize(new THREE.Vector3()).toArray()
    const flat = s.findIndex((v) => v < 0.005 * longest)
    if (flat < 0) return
    const covers = s.every((v, i) => i === flat || v > 0.6 * size[i])
    const atEnd = Math.min(Math.abs(b.min.getComponent(flat) - whole.min.getComponent(flat)), Math.abs(b.max.getComponent(flat) - whole.max.getComponent(flat)))
    if (covers && atEnd < 0.03 * size[flat]) planes.push(mesh)
  })
  for (const mesh of planes) {
    console.info(`[garage] upload: dropped ground-shadow plane ${mesh.name || '(unnamed)'}`)
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }
}

const converted = new WeakMap<THREE.Material, THREE.MeshStandardMaterial>()

/** Phong / Lambert / Basic (FBX, OBJ, DAE, 3DS) → MeshStandardMaterial with the same maps */
function toStandard(material: THREE.Material): THREE.Material {
  if ((material as THREE.MeshStandardMaterial).isMeshStandardMaterial) return material
  const done = converted.get(material)
  if (done) return done
  const m = material as THREE.MeshPhongMaterial
  const shininess = m.shininess ?? 10
  const out = new THREE.MeshStandardMaterial({
    name: m.name,
    color: m.color ?? 0xffffff,
    map: m.map ?? null,
    normalMap: m.normalMap ?? null,
    bumpMap: m.bumpMap ?? null,
    bumpScale: m.bumpScale ?? 1,
    emissive: m.emissive ?? 0x000000,
    emissiveMap: m.emissiveMap ?? null,
    emissiveIntensity: m.emissiveIntensity ?? 1,
    alphaMap: m.alphaMap ?? null,
    aoMap: m.aoMap ?? null,
    opacity: m.opacity,
    transparent: m.transparent,
    alphaTest: m.alphaTest,
    side: m.side,
    vertexColors: m.vertexColors,
    // Blinn-Phong exponent → GGX roughness, roughly
    roughness: THREE.MathUtils.clamp(Math.sqrt(2 / (shininess + 2)), 0.08, 1),
    metalness: 0,
  })
  if (m.normalScale) out.normalScale.copy(m.normalScale)
  converted.set(material, out)
  material.dispose() // its textures now belong to the new material
  return out
}
