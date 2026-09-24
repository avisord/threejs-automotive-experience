import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { SURFACES, pbrMaps } from './kit'
import { OUTDOOR_SKY_LIGHT } from './sky'

/**
 * Realistic conifers for an open-air garage: real branching structure from
 * ez-tree (procedural, seeded), Poly Haven's Japanese cedar bark (2k PBR),
 * and ez-tree's alpha-cut needle cards.
 *
 * A few tree variants are grown once and instanced many times. Trees near
 * the building are full detail and cast the sun's shadow; the forests on the
 * far slopes use lighter variants, since each is a few pixels tall.
 */

export interface ForestOptions {
  /** ground height at a point */
  heightAt(x: number, z: number): number
  /** true where no tree may stand (the building, its pool, the view to the mountain) */
  keepClear(x: number, z: number): boolean
  seed: number
}

interface Variant {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry
  /** triangles, for the budget */
  triangles: number
}

interface Placement {
  x: number
  z: number
  /** metres */
  height: number
  turn: number
  /** 0–1: slight per-tree colour variation */
  tint: number
}

/** deterministic random numbers (mulberry32) */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type PresetJson = {
  seed: number
  branch: { levels: number; sections: Record<string, number>; segments: Record<string, number> }
  leaves: { count: number; size: number }
}

/** grow one tree, normalised to 1 unit tall standing on the origin */
function grow(TreeCtor: new () => import('@dgreenheck/ez-tree').Tree, preset: PresetJson, seed: number, light: boolean): Variant & { leafMap: THREE.Texture | null } {
  const json = structuredClone(preset)
  json.seed = seed
  if (light) {
    // a far tree is a few pixels tall: rounder trunks and fewer needle cards are invisible savings
    for (const k of Object.keys(json.branch.sections)) json.branch.sections[k] = Math.max(3, Math.round(json.branch.sections[k] * 0.5))
    for (const k of Object.keys(json.branch.segments)) json.branch.segments[k] = Math.max(3, Math.round(json.branch.segments[k] * 0.6))
    // fewer, bigger needle cards: small ones alpha-test away to nothing at a distance and leave bare sticks
    json.leaves.count = Math.max(8, Math.round(json.leaves.count * 0.6))
    json.leaves.size *= 1.5
  }
  const tree = new TreeCtor()
  tree.loadFromJson(json as never)
  const branches = tree.branchesMesh.geometry
  const leaves = tree.leavesMesh.geometry
  const leafMaterial = tree.leavesMesh.material as THREE.MeshPhongMaterial
  const leafMap = leafMaterial.map
  ;(tree.branchesMesh.material as THREE.Material).dispose()
  leafMaterial.dispose()

  const box = new THREE.Box3().setFromBufferAttribute(branches.attributes.position as THREE.BufferAttribute)
  box.union(new THREE.Box3().setFromBufferAttribute(leaves.attributes.position as THREE.BufferAttribute))
  const k = 1 / (box.max.y - Math.min(0, box.min.y))
  for (const g of [branches, leaves]) {
    g.scale(k, k, k)
    g.computeBoundingSphere()
  }
  const triangles = (branches.index!.count + leaves.index!.count) / 3
  return { branches, leaves, leafMap, triangles }
}

/** trees in clumps, `count` clumps between two radii */
function scatter(rand: () => number, opts: ForestOptions, clumps: number, inner: number, outer: number, perClump: [number, number], height: [number, number]): Placement[] {
  const out: Placement[] = []
  let tries = 0
  while (out.length < clumps * perClump[0] && tries++ < clumps * 20) {
    const r = inner + (outer - inner) * Math.sqrt(rand())
    const a = rand() * Math.PI * 2
    const cx = Math.sin(a) * r
    const cz = Math.cos(a) * r
    if (opts.keepClear(cx, cz)) continue
    const n = perClump[0] + Math.floor(rand() * (perClump[1] - perClump[0] + 1))
    const spread = 4 + r * 0.03
    for (let i = 0; i < n; i++) {
      const x = cx + (rand() - 0.5) * spread * 2
      const z = cz + (rand() - 0.5) * spread * 2
      if (opts.keepClear(x, z)) continue
      out.push({ x, z, height: height[0] + rand() * (height[1] - height[0]), turn: rand() * Math.PI * 2, tint: rand() })
    }
  }
  return out
}

export async function createForest(
  opts: ForestOptions,
): Promise<{ group: THREE.Group; /** the far forests: a few pixels in a mirror, not worth drawing there */ far: THREE.Object3D[]; ready: Promise<void> }> {
  const { Tree, TreePreset } = await import('@dgreenheck/ez-tree')
  const presets = TreePreset as unknown as Record<string, PresetJson>
  const rand = seeded(opts.seed)

  // three near variants and three light ones, from the pine presets
  const nearVariants = [
    grow(Tree, presets['Pine Medium'], 101, false),
    grow(Tree, presets['Pine Large'], 202, false),
    grow(Tree, presets['Pine Medium'], 303, false),
  ]
  const farVariants = [
    grow(Tree, presets['Pine Medium'], 404, true),
    grow(Tree, presets['Pine Large'], 505, true),
    grow(Tree, presets['Pine Small'], 606, true),
  ]
  const leafMap = nearVariants[0].leafMap
  for (const v of [...nearVariants, ...farVariants]) if (v.leafMap && v.leafMap !== leafMap) v.leafMap.dispose()

  const bark = pbrMaps(SURFACES.cedarBark, [2, 1])
  const barkMaterial = new THREE.MeshStandardMaterial({ ...bark.maps, color: 0xffffff, roughness: 1, envMapIntensity: OUTDOOR_SKY_LIGHT })
  receiveFarShadow(barkMaterial)
  const crown = (alphaTest: number) => {
    const material = new THREE.MeshStandardMaterial({
      map: leafMap,
      alphaTest,
      alphaToCoverage: true, // with MSAA: needle edges resolve smoothly instead of popping on and off
      side: THREE.DoubleSide,
      roughness: 0.85,
      envMapIntensity: OUTDOOR_SKY_LIGHT,
    })
    receiveFarShadow(material) // crowns shade their own lower branches, and each other
    return material
  }
  const leafMaterial = crown(0.35)
  // far crowns: a lower threshold keeps the needles' mipmapped (fainter) alpha from thinning them out
  const farLeafMaterial = crown(0.18)
  if (leafMap) {
    leafMap.colorSpace = THREE.SRGBColorSpace
    leafMap.premultiplyAlpha = false // alpha-tested, not blended: straight alpha keeps the needle edges clean
    leafMap.anisotropy = 8
    leafMap.needsUpdate = true
  }

  const group = new THREE.Group()
  group.name = 'forest'
  const near = scatter(rand, opts, 14, 48, 170, [2, 5], [14, 24])
  const far = scatter(rand, opts, 60, 190, 760, [8, 22], [14, 26])

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  const plant = (variants: Variant[], trees: Placement[], shadows: boolean, leaves: THREE.Material): THREE.Object3D[] => {
    const planted: THREE.Object3D[] = []
    variants.forEach((variant, vi) => {
      const mine = trees.filter((_, i) => i % variants.length === vi)
      if (mine.length === 0) return
      const trunks = new THREE.InstancedMesh(variant.branches, barkMaterial, mine.length)
      const crowns = new THREE.InstancedMesh(variant.leaves, leaves, mine.length)
      mine.forEach((t, i) => {
        q.setFromAxisAngle(up, t.turn)
        m.compose(new THREE.Vector3(t.x, opts.heightAt(t.x, t.z) - 0.2, t.z), q, new THREE.Vector3(t.height, t.height, t.height))
        trunks.setMatrixAt(i, m)
        crowns.setMatrixAt(i, m)
        // the stock needles are a bright yellow-green: tint them toward a dark cedar green
        crowns.setColorAt(i, c.setHSL(0.26 + t.tint * 0.05, 0.3 + t.tint * 0.2, 0.34 + t.tint * 0.1, THREE.SRGBColorSpace))
      })
      for (const mesh of [trunks, crowns]) {
        mesh.castShadow = shadows
        mesh.receiveShadow = true
        mesh.computeBoundingSphere()
        mesh.raycast = () => {} // far from anything the camera clamps against
        group.add(mesh)
        planted.push(mesh)
      }
    })
    return planted
  }
  // every tree casts into the far (landscape) shadow map; its near map only reaches the pavilion's surroundings
  plant(nearVariants, near, true, leafMaterial)
  const farMeshes = plant(farVariants, far, true, farLeafMaterial)

  const budget = (vs: Variant[], n: number) => Math.round((vs.reduce((s, v) => s + v.triangles, 0) / vs.length) * n)
  console.info(
    `[garage] forest: ${near.length} near trees (~${nearVariants[0].triangles} tris each), ${far.length} far (~${farVariants[0].triangles}), ` +
      `~${((budget(nearVariants, near.length) + budget(farVariants, far.length)) / 1e6).toFixed(2)}M triangles`,
  )
  return { group, far: farMeshes, ready: bark.ready }
}
