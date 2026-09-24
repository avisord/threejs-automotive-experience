import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { SURFACES, pbrMaps } from './kit'
import { seeded } from './landform'
import { OUTDOOR_SKY_LIGHT } from './sky'

/**
 * The valley's woods: mixed conifer and broadleaf trees, as around the Fuji
 * lakes, in clumps and stands with clearings between — never evenly spaced.
 *
 * Three levels of detail, by distance from the pavilion:
 *  - near (45–240 m): full ez-tree trees (procedural, MIT) with Poly Haven's
 *    2k Japanese cedar bark and ez-tree's alpha-cut leaf and needle cards
 *  - mid (240–1100 m): the same species grown lighter
 *  - far (1.1–3.3 km): a few dozen triangles each — a cone for a conifer, a
 *    rounded crown for a broadleaf. At 1–3 px tall, shape and colour are all
 *    that's left; these are what make the far hills read as forested.
 * Bushes grow around the lawn. Every tree casts into the far shadow map.
 */

export interface ForestOptions {
  heightAt(x: number, z: number): number
  /** how thickly trees grow at a point, 0–1 */
  density(x: number, z: number): number
  /** where bushes may grow near the building */
  bushAllowed(x: number, z: number): boolean
  seed: number
}

export interface Forest {
  group: THREE.Group
  near: THREE.Object3D[]
  mid: THREE.Object3D[]
  far: THREE.Object3D[]
  bushes: THREE.Object3D[]
  /** resolves when the bark maps are in */
  ready: Promise<void>
}

interface Variant {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry
  leafMap: THREE.Texture | null
  conifer: boolean
  triangles: number
}

type PresetJson = {
  seed: number
  branch: { levels: number; sections: Record<string, number>; segments: Record<string, number> }
  leaves: { count: number; size: number }
}
type TreeCtor = new () => import('@dgreenheck/ez-tree').Tree

/** grow one tree, normalised to 1 unit tall standing on the origin */
function grow(Tree: TreeCtor, preset: PresetJson, seed: number, light: boolean, conifer: boolean): Variant {
  const json = structuredClone(preset)
  json.seed = seed
  if (light) {
    // a mid-distance tree is a handful of pixels: rounder trunks and fewer, bigger leaf cards are invisible savings —
    // and small cards alpha-test away to nothing at a distance, leaving bare sticks
    for (const k of Object.keys(json.branch.sections)) json.branch.sections[k] = Math.max(3, Math.round(json.branch.sections[k] * 0.5))
    for (const k of Object.keys(json.branch.segments)) json.branch.segments[k] = Math.max(3, Math.round(json.branch.segments[k] * 0.6))
    json.leaves.count = Math.max(8, Math.round(json.leaves.count * 0.6))
    json.leaves.size *= 1.5
  }
  const tree = new Tree()
  tree.loadFromJson(json as never)
  const branches = tree.branchesMesh.geometry
  const leaves = tree.leavesMesh.geometry
  const stock = tree.leavesMesh.material as THREE.MeshPhongMaterial
  const leafMap = stock.map
  ;(tree.branchesMesh.material as THREE.Material).dispose()
  stock.dispose()
  const box = new THREE.Box3().setFromBufferAttribute(branches.attributes.position as THREE.BufferAttribute)
  box.union(new THREE.Box3().setFromBufferAttribute(leaves.attributes.position as THREE.BufferAttribute))
  const k = 1 / (box.max.y - Math.min(0, box.min.y))
  for (const g of [branches, leaves]) {
    g.scale(k, k, k)
    g.computeBoundingSphere()
  }
  return { branches, leaves, leafMap, conifer, triangles: (branches.index!.count + leaves.index!.count) / 3 }
}

/** pick up to `target` points between two radii, accepted in proportion to the forest density (so clumps stay clumps) */
function sample(rand: () => number, opts: ForestOptions, target: number, inner: number, outer: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (let tries = 0; out.length < target && tries < target * 30; tries++) {
    const r = Math.sqrt(rand() * (outer * outer - inner * inner) + inner * inner)
    const a = rand() * Math.PI * 2
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    if (rand() < opts.density(x, z)) out.push({ x, z })
  }
  return out
}

/** a far tree, 1 unit tall: a cone on a stub of trunk, or a rounded broadleaf crown */
function farTreeGeometry(conifer: boolean): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.025, 0.035, 0.25, 5).translate(0, 0.125, 0)
  const crown = conifer
    ? new THREE.ConeGeometry(0.24, 0.85, 7).translate(0, 0.57, 0)
    : new THREE.IcosahedronGeometry(0.34, 1).scale(1, 0.85, 1).translate(0, 0.6, 0)
  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  for (const [i, g] of [trunk, crown].entries()) {
    const flat = g.index ? g.toNonIndexed() : g
    position.push(...(flat.attributes.position.array as Float32Array))
    normal.push(...(flat.attributes.normal.array as Float32Array))
    const shade = i === 0 ? 0.35 : 1 // a dark trunk under the instance's foliage colour
    for (let v = 0; v < flat.attributes.position.count; v++) color.push(shade, shade, shade)
    g.dispose()
    if (flat !== g) flat.dispose()
  }
  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  merged.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  return merged
}

export async function createForest(opts: ForestOptions): Promise<Forest> {
  const { Tree, TreePreset } = await import('@dgreenheck/ez-tree')
  const presets = TreePreset as unknown as Record<string, PresetJson>
  const rand = seeded(opts.seed)

  const near: Variant[] = [
    grow(Tree, presets['Pine Medium'], 101, false, true),
    grow(Tree, presets['Pine Large'], 202, false, true),
    grow(Tree, presets['Oak Medium'], 303, false, false),
    grow(Tree, presets['Ash Medium'], 404, false, false),
  ]
  const mid: Variant[] = [
    grow(Tree, presets['Pine Medium'], 505, true, true),
    grow(Tree, presets['Pine Large'], 606, true, true),
    grow(Tree, presets['Aspen Medium'], 707, true, false),
    grow(Tree, presets['Oak Medium'], 808, true, false),
  ]
  const bushes: Variant[] = [
    grow(Tree, presets['Bush 1'], 11, false, false),
    grow(Tree, presets['Bush 2'], 12, false, false),
    grow(Tree, presets['Bush 3'], 13, false, false),
  ]

  const bark = pbrMaps(SURFACES.cedarBark, [2, 1])
  const barkMaterial = new THREE.MeshStandardMaterial({ ...bark.maps, color: 0xffffff, roughness: 1, envMapIntensity: OUTDOOR_SKY_LIGHT })
  receiveFarShadow(barkMaterial)
  // one leaf material per leaf texture (species) and alpha threshold
  const leafMaterials = new Map<string, THREE.MeshStandardMaterial>()
  const leafMaterial = (map: THREE.Texture | null, alphaTest: number) => {
    const key = `${map?.uuid}|${alphaTest}`
    let material = leafMaterials.get(key)
    if (!material) {
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace
        map.premultiplyAlpha = false // alpha-tested, not blended: straight alpha keeps leaf edges clean
        map.anisotropy = 8
        map.needsUpdate = true
      }
      material = new THREE.MeshStandardMaterial({
        map,
        alphaTest,
        alphaToCoverage: true, // with MSAA: leaf edges resolve smoothly instead of popping on and off
        side: THREE.DoubleSide,
        roughness: 0.85,
        envMapIntensity: OUTDOOR_SKY_LIGHT,
      })
      receiveFarShadow(material) // crowns shade their own lower branches, and each other
      leafMaterials.set(key, material)
    }
    return material
  }

  const group = new THREE.Group()
  group.name = 'forest'
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  /** foliage tints: dark cedar and pine greens; fresher greens for broadleaves */
  const tint = (conifer: boolean, t: number) =>
    conifer
      ? c.setHSL(0.27 + t * 0.05, 0.3 + t * 0.2, 0.3 + t * 0.1, THREE.SRGBColorSpace)
      : c.setHSL(0.22 + t * 0.06, 0.4 + t * 0.2, 0.36 + t * 0.12, THREE.SRGBColorSpace)

  const plant = (variants: Variant[], spots: { x: number; z: number }[], height: (v: Variant) => [number, number], alphaTest: number) => {
    const planted: THREE.Object3D[] = []
    variants.forEach((variant, vi) => {
      const mine = spots.filter((_, i) => i % variants.length === vi)
      if (mine.length === 0) return
      const trunks = new THREE.InstancedMesh(variant.branches, barkMaterial, mine.length)
      const crowns = new THREE.InstancedMesh(variant.leaves, leafMaterial(variant.leafMap, alphaTest), mine.length)
      const [lo, hi] = height(variant)
      mine.forEach(({ x, z }, i) => {
        const h = lo + rand() * (hi - lo)
        q.setFromAxisAngle(up, rand() * Math.PI * 2)
        m.compose(new THREE.Vector3(x, opts.heightAt(x, z) - 0.2, z), q, new THREE.Vector3(h, h, h))
        trunks.setMatrixAt(i, m)
        crowns.setMatrixAt(i, m)
        crowns.setColorAt(i, tint(variant.conifer, rand()))
      })
      for (const mesh of [trunks, crowns]) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        mesh.raycast = () => {}
        group.add(mesh)
        planted.push(mesh)
      }
    })
    return planted
  }

  const treeHeight = (v: Variant): [number, number] => (v.conifer ? [15, 27] : [10, 17])
  const nearSpots = sample(rand, opts, 40, 45, 240)
  const nearMeshes = plant(near, nearSpots, treeHeight, 0.35)
  // mid crowns: a lower threshold keeps mipmapped (fainter) leaf alpha from thinning them out
  const midSpots = sample(rand, opts, 460, 240, 1100)
  const midMeshes = plant(mid, midSpots, treeHeight, 0.18)

  // bushes around the lawn and along the edges of the grounds
  const bushSpots: { x: number; z: number }[] = []
  for (let tries = 0; bushSpots.length < 70 && tries < 3000; tries++) {
    const r = 16 + rand() * 110
    const a = rand() * Math.PI * 2
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    if (opts.bushAllowed(x, z)) bushSpots.push({ x, z })
  }
  const bushMeshes = plant(bushes, bushSpots, () => [1.2, 2.6], 0.35)

  // the far woods: thousands of simple trees on the hillsides and the far shore
  const farSpots = sample(rand, opts, 9000, 1100, 3300)
  const farMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, envMapIntensity: OUTDOOR_SKY_LIGHT })
  receiveFarShadow(farMaterial)
  const farMeshes: THREE.Object3D[] = []
  for (const conifer of [true, false]) {
    const mine = farSpots.filter((_, i) => i % 10 < 7 === conifer) // seven in ten conifers
    const mesh = new THREE.InstancedMesh(farTreeGeometry(conifer), farMaterial, mine.length)
    mine.forEach(({ x, z }, i) => {
      const h = conifer ? 15 + rand() * 13 : 10 + rand() * 8
      q.setFromAxisAngle(up, rand() * Math.PI * 2)
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(x, opts.heightAt(x, z) - 0.3, z), q, new THREE.Vector3(h, h, h)))
      mesh.setColorAt(i, tint(conifer, rand()))
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    mesh.raycast = () => {}
    group.add(mesh)
    farMeshes.push(mesh)
  }

  const tris = (vs: Variant[]) => Math.round(vs.reduce((s, v) => s + v.triangles, 0) / vs.length)
  console.info(
    `[garage] forest: ${nearSpots.length} near (~${tris(near)} tris each), ${midSpots.length} mid (~${tris(mid)}), ` +
      `${farSpots.length} far, ${bushSpots.length} bushes`,
  )
  return { group, near: nearMeshes, mid: midMeshes, far: farMeshes, bushes: bushMeshes, ready: bark.ready }
}
