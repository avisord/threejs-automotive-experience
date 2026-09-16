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
  bakeSkinnedMeshes(car)

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

/**
 * Freeze skinned meshes into plain ones. Some exports (the GT3 RS: 179 skins,
 * no animations) rig rigid parts to bones; skinning them every frame costs a
 * bone texture per mesh, and raycasting a skinned mesh re-skins every vertex
 * (~150 ms per pick). The pose never changes, so bake it into the geometry.
 */
function bakeSkinnedMeshes(root: THREE.Object3D): void {
  const skinned: THREE.SkinnedMesh[] = []
  root.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && skinned.push(o as THREE.SkinnedMesh))
  if (skinned.length === 0) return
  root.updateMatrixWorld(true)

  const originals = new Set<THREE.BufferGeometry>()
  const acc = new THREE.Matrix4()
  const skin = new THREE.Matrix4()
  const normalMatrix = new THREE.Matrix3()
  const v = new THREE.Vector3()

  for (const mesh of skinned) {
    const src = mesh.geometry
    originals.add(src)
    const bones = mesh.skeleton.bones.map((bone, i) =>
      new THREE.Matrix4().multiplyMatrices(bone.matrixWorld, mesh.skeleton.boneInverses[i]),
    )
    const { position, normal, tangent, skinIndex, skinWeight } = src.attributes as Record<string, THREE.BufferAttribute>
    const n = position.count
    const P = new Float32Array(n * 3)
    const N = normal ? new Float32Array(n * 3) : null
    const T = tangent ? new Float32Array(n * 4) : null

    for (let i = 0; i < n; i++) {
      // linear-blend skinning matrix, in the mesh's own space
      acc.elements.fill(0)
      for (let k = 0; k < 4; k++) {
        const w = skinWeight.getComponent(i, k)
        if (w === 0) continue
        const b = bones[skinIndex.getComponent(i, k)].elements
        for (let e = 0; e < 16; e++) acc.elements[e] += w * b[e]
      }
      skin.multiplyMatrices(mesh.bindMatrixInverse, acc).multiply(mesh.bindMatrix)
      v.fromBufferAttribute(position, i).applyMatrix4(skin).toArray(P, i * 3)
      if (N || T) normalMatrix.getNormalMatrix(skin)
      if (N) v.fromBufferAttribute(normal, i).applyMatrix3(normalMatrix).normalize().toArray(N, i * 3)
      if (T) {
        v.fromBufferAttribute(tangent, i).transformDirection(skin).toArray(T, i * 4)
        T[i * 4 + 3] = tangent.getW(i)
      }
    }

    const baked = new THREE.BufferGeometry()
    if (src.index) baked.setIndex(src.index)
    for (const [name, attr] of Object.entries(src.attributes)) {
      if (!['position', 'normal', 'tangent', 'skinIndex', 'skinWeight'].includes(name)) baked.setAttribute(name, attr)
    }
    baked.setAttribute('position', new THREE.BufferAttribute(P, 3))
    if (N) baked.setAttribute('normal', new THREE.BufferAttribute(N, 3))
    if (T) baked.setAttribute('tangent', new THREE.BufferAttribute(T, 4))
    for (const g of src.groups) baked.addGroup(g.start, g.count, g.materialIndex)

    const plain = new THREE.Mesh(baked, mesh.material)
    plain.name = mesh.name
    plain.position.copy(mesh.position)
    plain.quaternion.copy(mesh.quaternion)
    plain.scale.copy(mesh.scale)
    plain.renderOrder = mesh.renderOrder
    plain.userData = mesh.userData
    const parent = mesh.parent!
    parent.add(plain)
    // keep the sibling order stable (GLTFLoader's names are what the configurator matches)
    parent.children.splice(parent.children.indexOf(plain), 1)
    parent.children.splice(parent.children.indexOf(mesh), 1, plain)
    mesh.parent = null
  }
  for (const g of originals) g.dispose()
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
