import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { matches, type CarProfile, type GlassFix } from './cars'

// Every model in public/models is optimised from its Sketchfab export (meshopt + 2k webp) with:
//   gltf-transform optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 2048 \
//     --join false --flatten false --simplify false --instance false --palette false
// join/flatten/palette stay off so part and material names survive for the configurator
// (palette folds every untextured material into one — body paints and glass included).
// The RX-7 only came as FBX; it went through FBX2glTF (npm `fbx2gltf`) first.

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

/** exports mark all sorts of things BLEND; only these keep real transparency */
const SEE_THROUGH = /glass|window|windscreen|vetro|lens|clear|alpha|trans|refraction|light|lamp|coat/i

/**
 * Load a car, drop the meshes its profile hides, fix up the export's
 * materials, and sit it on the floor centred on the origin, nose toward +z.
 * Returns a clean root the caller can move without touching the car's own offset.
 */
export async function loadCar(profile: CarProfile, onProgress?: (fraction: number) => void): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(`/models/${profile.file}`, (e) => {
    if (e.lengthComputable) onProgress?.(e.loaded / e.total)
  })
  const car = gltf.scene
  car.name = profile.id

  const doomed: THREE.Mesh[] = []
  car.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    if (profile.hide?.some((m) => matches(m, mesh, car))) {
      doomed.push(mesh)
      return
    }
    const fix = profile.glass?.find((m) => matches(m, mesh, car))
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) prepareMaterial(material as THREE.MeshStandardMaterial, fix)
  })
  for (const mesh of doomed) {
    mesh.removeFromParent()
    mesh.geometry.dispose()
  }

  if (profile.yaw) car.rotation.y = profile.yaw
  if (profile.length) {
    const size = new THREE.Box3().setFromObject(car).getSize(new THREE.Vector3())
    car.scale.multiplyScalar(profile.length / Math.max(size.x, size.z))
  }
  car.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(car)
  const center = box.getCenter(new THREE.Vector3())
  car.position.set(car.position.x - center.x, car.position.y - box.min.y, car.position.z - center.z)

  const root = new THREE.Group()
  root.name = `${profile.id}-root`
  root.add(car)
  return root
}

function prepareMaterial(material: THREE.MeshStandardMaterial, fix: GlassFix | undefined): void {
  if (fix) {
    material.transparent = true
    material.depthWrite = false
    material.opacity = fix.opacity
    if (fix.color !== undefined) material.color.set(fix.color)
    return
  }
  if (!material.transparent || SEE_THROUGH.test(material.name)) {
    if (material.transparent) material.depthWrite = false
    return
  }
  // everything else marked BLEND is there because its texture carries alpha (or
  // a converter guessed wrong): render it opaque with a cutout so it sorts and
  // z-buffers properly, and ignore bogus alpha factors (the RX-7's are 0)
  material.transparent = false
  material.depthWrite = true
  material.opacity = 1
  material.alphaTest = 0.5
}

/** free the GPU side of a car that's leaving the scene */
export function disposeCar(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>()
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    // each skeleton owns a bone-matrix texture (the GT3 RS has ~180 of them)
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) (mesh as THREE.SkinnedMesh).skeleton.dispose()
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) if ((value as THREE.Texture)?.isTexture) textures.add(value)
      material.dispose()
    }
  })
  for (const t of textures) t.dispose()
}
