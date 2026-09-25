import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { SURFACES, pbrMaps } from './kit'
import { seeded } from './landform'
import { foliage, leafGain } from './foliage'
import { createImpostors, type ImpostorSet } from './impostors'
import { OUTDOOR_SKY_LIGHT } from './sky'
import { VEGETATION, type Plant, type VegetationLayout } from './vegetation-layout'

/**
 * The valley's woods: mixed conifer and broadleaf trees, as around the Fuji
 * lakes. Where each tree and shrub stands is decided by vegetation-layout.ts
 * (clusters, lone trees, clearings); here each is given a level of detail by
 * its distance from the pavilion:
 *  - LOD 0, near (< VEGETATION.bands.near): full ez-tree trees (procedural, MIT)
 *    with Poly Haven's 2k Japanese cedar bark and ez-tree's leaf/needle cards
 *  - LOD 1, mid (< bands.mid): the same species grown lighter
 *  - LOD 2, beyond: impostors (impostors.ts) — the same trees baked to an atlas
 *    and drawn as two crossed quads, so the far woods keep real silhouettes
 * Each band has a cap; a band that's full passes its trees on to the next.
 * Shrubs: full bushes close by, impostor bushes beyond. Everything is
 * instanced (one mesh per variant per band) and casts into the shadow maps.
 */

export interface ForestOptions {
  heightAt(x: number, z: number): number
  /** where every tree and shrub stands (vegetation-layout.ts) */
  layout: VegetationLayout
  /** where bushes may grow near the building, and how tall they may be there (0 = none) */
  bushRoom(x: number, z: number): number
  /** trees placed by hand near the building: pines framing the view, a few cherries */
  accents: { x: number; z: number; kind: 'pine' | 'sakura'; height: number }[]
  seed: number
}

export interface Forest {
  group: THREE.Group
  near: THREE.Object3D[]
  /** the hand-placed trees by the building (also in `near`) */
  accents: THREE.Object3D[]
  mid: THREE.Object3D[]
  /** LOD 2: impostor trees and shrubs */
  far: THREE.Object3D[]
  bushes: THREE.Object3D[]
  /** the impostor atlas and quads, for other plantings (village gardens, the far ranges) */
  impostors: ImpostorSet
  /** resolves when the bark maps are in */
  ready: Promise<void>
}

export interface Variant {
  branches: THREE.BufferGeometry
  leaves: THREE.BufferGeometry
  leafMap: THREE.Texture | null
  conifer: boolean
  triangles: number
}

export type PresetJson = {
  seed: number
  branch: { levels: number; sections: Record<string, number>; segments: Record<string, number> }
  leaves: { count: number; size: number; start: number }
}
export type TreeCtor = new () => import('@dgreenheck/ez-tree').Tree

/**
 * Grow one tree, normalised to 1 unit tall standing on the origin.
 *
 * `fullness` thickens the crown: the stock presets hang ~10 cards on each twig
 * and leave the inner branches bare — a sparse, see-through tree with its
 * structure on show. Fuller: more cards, a little bigger, and down the twigs
 * toward the branch, so the crown is a mass that hides most of the trunk and
 * limbs and shows them only through its gaps.
 */
export function grow(Tree: TreeCtor, preset: PresetJson, seed: number, light: boolean, conifer: boolean, fullness = 1): Variant {
  const json = structuredClone(preset)
  json.seed = seed
  if (fullness !== 1) {
    json.leaves.count = Math.round(json.leaves.count * fullness)
    json.leaves.size *= 1 + (fullness - 1) * 0.22
    json.leaves.start = Math.min(json.leaves.start, 0.04)
  }
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

export async function createForest(opts: ForestOptions): Promise<Forest> {
  const { Tree, TreePreset } = await import('@dgreenheck/ez-tree')
  const presets = TreePreset as unknown as Record<string, PresetJson>
  const rand = seeded(opts.seed)

  // The species, as archetypes: pines; a broad oak (A); a tall, narrow aspen (B); a rounded oak (C); an
  // irregular ash (D). Far off (E) they're impostors of the same trees (impostors.ts). Each grown full.
  const near: Variant[] = [
    grow(Tree, presets['Pine Medium'], 101, false, true, 1.5),
    grow(Tree, presets['Pine Large'], 202, false, true, 1.5),
    grow(Tree, presets['Oak Large'], 303, false, false, 2.2),
    grow(Tree, presets['Oak Medium'], 404, false, false, 2.4),
    grow(Tree, presets['Ash Large'], 505, false, false, 2.2),
    grow(Tree, presets['Aspen Large'], 606, false, false, 2),
  ]
  const mid: Variant[] = [
    grow(Tree, presets['Pine Medium'], 707, true, true, 1.5),
    grow(Tree, presets['Pine Large'], 808, true, true, 1.5),
    grow(Tree, presets['Oak Large'], 909, true, false, 2.2),
    grow(Tree, presets['Oak Medium'], 1010, true, false, 2.4),
    grow(Tree, presets['Ash Large'], 1111, true, false, 2.2),
    grow(Tree, presets['Aspen Large'], 1212, true, false, 2),
  ]
  const bushes: Variant[] = [
    grow(Tree, presets['Bush 1'], 11, false, false),
    grow(Tree, presets['Bush 2'], 12, false, false),
    grow(Tree, presets['Bush 3'], 13, false, false),
  ]

  const bark = pbrMaps(SURFACES.cedarBark, [2, 1])
  const barkMaterial = new THREE.MeshStandardMaterial({ ...bark.maps, color: 0xffffff, roughness: 1, envMapIntensity: OUTDOOR_SKY_LIGHT })
  receiveFarShadow(barkMaterial)
  foliage(barkMaterial, { wind: 'tree' }) // the trunk and limbs sway with the crown they carry
  // each leaf texture's brightness normalised, so the palette (foliageTint) alone sets a crown's colour
  const gains = new Map<THREE.Texture, number>()
  for (const v of [...near, ...mid, ...bushes]) if (v.leafMap && !gains.has(v.leafMap)) gains.set(v.leafMap, await leafGain(v.leafMap))
  // one leaf material per leaf texture (species) and alpha threshold
  const leafMaterials = new Map<string, THREE.MeshStandardMaterial>()
  const leafMaterial = (map: THREE.Texture | null, alphaTest: number, blossom = false) => {
    const key = `${map?.uuid}|${alphaTest}|${blossom}`
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
      if (!blossom) foliage(material, { wind: 'tree', translucency: 0.4, lumaLeaves: (map && gains.get(map)) || 2.5 })
      if (blossom) {
        // cherry blossom: the leaf cards' texture stripped of its green, so the instance colour (pink) shows
        const base = material.onBeforeCompile
        material.onBeforeCompile = (shader, renderer) => {
          base.call(material, shader, renderer)
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <map_fragment>',
            '#include <map_fragment>\n\tdiffuseColor.rgb = vec3( dot( diffuseColor.rgb, vec3( 0.3, 0.59, 0.11 ) ) ) * 3.2;', // (the instance colour is multiplied in after, by color_fragment)
          )
          // petals are thin: light through them keeps a blossom pale pink even in shade (not lavender)
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance += diffuseColor.rgb * 0.3;',
          )
        }
        material.customProgramCacheKey = () => 'blossom'
        foliage(material, { wind: 'tree', translucency: 0.3 })
      }
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
  const tint = (conifer: boolean, t: number) => foliageTint(conifer ? 'conifer' : 'broadleaf', t, c)

  /** a hand-placed spot, or a planned plant with its own size, shape, lean and tone */
  type Spot = { x: number; z: number; height?: number; plan?: Plant }
  const lean = new THREE.Quaternion()
  const yaw = new THREE.Quaternion()
  const tilt = new THREE.Quaternion()
  const normal = new THREE.Vector3()
  const e = new THREE.Euler()
  /**
   * A plant standing on the terrain: trunk base sunk in by the slope (no
   * gap on the downhill side), leaning a fifth of the way toward the ground's
   * normal plus its own lean, turned, and scaled — width apart from height.
   */
  const grounded = (spot: Spot, h: number): THREE.Matrix4 => {
    const { x, z, plan } = spot
    const hx = opts.heightAt(x + 1, z) - opts.heightAt(x - 1, z)
    const hz = opts.heightAt(x, z + 1) - opts.heightAt(x, z - 1)
    const slope = Math.hypot(hx, hz) / 2
    normal.set(-hx / 2, 1, -hz / 2).normalize()
    tilt.setFromUnitVectors(up, normal)
    tilt.slerp(new THREE.Quaternion(), 0.8) // a fifth of the way toward the slope
    lean.setFromEuler(e.set(plan?.leanX ?? 0, 0, plan?.leanZ ?? 0))
    yaw.setFromAxisAngle(up, plan?.turn ?? rand() * Math.PI * 2)
    q.copy(tilt).multiply(lean).multiply(yaw)
    const w = h * (plan?.width ?? 1)
    // an asymmetric crown: wider one way than the other (stable per tree)
    const asym = plan ? (((plan.pick * 7.31) % 1) - 0.5) * 0.3 : 0
    return m.compose(new THREE.Vector3(x, opts.heightAt(x, z) - 0.15 - slope * 0.8, z), q, new THREE.Vector3(w * (1 + asym), h, w * (1 - asym)))
  }

  const plant = (
    variants: Variant[],
    spots: Spot[],
    height: (v: Variant) => [number, number],
    alphaTest: number,
    blossom = false,
  ) => {
    const planted: THREE.Object3D[] = []
    variants.forEach((variant, vi) => {
      // a planned plant keeps its variant (its `pick`); hand-placed spots take turns
      const mine = spots.filter((spot, i) => (spot.plan ? Math.floor(spot.plan.pick * variants.length) : i % variants.length) === vi)
      if (mine.length === 0) return
      const trunks = new THREE.InstancedMesh(variant.branches, barkMaterial, mine.length)
      const crowns = new THREE.InstancedMesh(variant.leaves, leafMaterial(variant.leafMap, alphaTest, blossom), mine.length)
      const [lo, hi] = height(variant)
      mine.forEach((spot, i) => {
        const h = spot.plan?.height ?? spot.height ?? lo + rand() * (hi - lo)
        grounded(spot, h)
        trunks.setMatrixAt(i, m)
        crowns.setMatrixAt(i, m)
        const tone = spot.plan?.tone ?? rand()
        crowns.setColorAt(i, blossom ? c.setHSL(0.95 + rand() * 0.03, 0.62, 0.84 + rand() * 0.06, THREE.SRGBColorSpace) : tint(variant.conifer, tone))
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

  // ─── the planned vegetation, by level of detail ───────────────────────────
  const { bands, caps } = VEGETATION
  const lod0: { conifer: Spot[]; broadleaf: Spot[] } = { conifer: [], broadleaf: [] }
  const lod1: { conifer: Spot[]; broadleaf: Spot[] } = { conifer: [], broadleaf: [] }
  const shrubs0: Spot[] = []
  const lod2: Plant[] = []
  let n0 = 0
  let n1 = 0
  // nearest first, so a full band passes on its farthest trees
  const byDistance = [...opts.layout.plants].sort((a, b) => a.x * a.x + a.z * a.z - (b.x * b.x + b.z * b.z))
  for (const p of byDistance) {
    const d = Math.hypot(p.x, p.z)
    if (p.kind === 'shrub') {
      if (d < 150 && shrubs0.length < 140) shrubs0.push({ x: p.x, z: p.z, plan: p })
      else lod2.push(p)
    } else if (d < bands.near && n0 < caps.near) {
      lod0[p.kind].push({ x: p.x, z: p.z, plan: p })
      n0++
    } else if (d < bands.mid && n1 < caps.mid) {
      lod1[p.kind].push({ x: p.x, z: p.z, plan: p })
      n1++
    } else lod2.push(p)
  }
  const nearMeshes = [...plant(near.filter((v) => v.conifer), lod0.conifer, treeHeight, 0.35), ...plant(near.filter((v) => !v.conifer), lod0.broadleaf, treeHeight, 0.35)]
  // mid crowns: a lower threshold keeps mipmapped (fainter) leaf alpha from thinning them out
  const midMeshes = [...plant(mid.filter((v) => v.conifer), lod1.conifer, treeHeight, 0.18), ...plant(mid.filter((v) => !v.conifer), lod1.broadleaf, treeHeight, 0.18)]

  // pines framing the view and a few cherries, placed by hand
  const accentPines = opts.accents.filter((a) => a.kind === 'pine')
  // (the lighter pines: seen against the sky at 30–60 m they read the same, at a fraction of the leaf-card overdraw)
  const accentMeshes = [
    ...plant([mid[1], mid[0]], accentPines, treeHeight, 0.25),
    ...plant([near[3]], opts.accents.filter((a) => a.kind === 'sakura'), treeHeight, 0.35, true),
  ]
  for (const o of accentMeshes) o.name = 'accent'
  nearMeshes.push(...accentMeshes)

  // bushes around the lawn and along the edges of the grounds, and low shrubs on the bank below the view,
  // and the near clusters' own shrubs
  const bushSpots: Spot[] = [...shrubs0]
  for (let tries = 0; bushSpots.length < shrubs0.length + 80 && tries < 5000; tries++) {
    const r = 16 + rand() * 110
    const a = rand() * Math.PI * 2
    const x = Math.sin(a) * r
    const z = Math.cos(a) * r
    const room = opts.bushRoom(x, z)
    if (room >= 0.7) bushSpots.push({ x, z, height: Math.min(room, 1.2 + rand() * 1.4) })
  }
  const bushMeshes = plant(bushes, bushSpots, () => [1.2, 2.6], 0.35)
  for (const o of bushMeshes) o.name = 'bush'

  // LOD 2: everything else as impostors
  const impostors = await createImpostors(Tree, presets)
  // (impostors stand straight up — a tilted card shows it's a card — and sink a little deeper, as their
  // crossed quads have no trunk flare to hide the join on a slope)
  const upright = (spot: Spot, h: number) => {
    const { x, z, plan } = spot
    q.setFromAxisAngle(up, plan?.turn ?? 0)
    const w = h * (plan?.width ?? 1)
    return m.compose(new THREE.Vector3(x, opts.heightAt(x, z) - 0.5, z), q, new THREE.Vector3(w, h, w))
  }
  const farMeshes = plantImpostors(impostors, lod2, opts.heightAt, upright, group)

  const tris = (vs: Variant[]) => Math.round(vs.reduce((s, v) => s + v.triangles, 0) / vs.length)
  console.info(
    `[garage] forest: ${opts.layout.plants.length} planned — LOD0 ${n0} (~${tris(near)} tris each), LOD1 ${n1} (~${tris(mid)}), ` +
      `LOD2 ${lod2.length} impostors, ${bushSpots.length} full bushes`,
  )
  return { group, near: nearMeshes, accents: accentMeshes, mid: midMeshes, far: farMeshes, bushes: bushMeshes, impostors, ready: bark.ready }
}

/**
 * The forest's palette — the leaf colour of a tree (sRGB), varied by `tone`:
 * dark cedar and pine greens; fresher, yellower greens for broadleaves. The
 * leaf cards (near) and the impostor atlas (far) keep only their texture's
 * light and dark, so a tree is this colour at every distance.
 */
export function foliageTint(kind: Plant['kind'], tone: number, out = new THREE.Color()): THREE.Color {
  if (kind === 'conifer') return out.setHSL(0.28 + tone * 0.04, 0.24 + tone * 0.12, 0.19 + tone * 0.08, THREE.SRGBColorSpace)
  if (kind === 'shrub') return out.setHSL(0.22 + tone * 0.05, 0.28 + tone * 0.12, 0.22 + tone * 0.07, THREE.SRGBColorSpace)
  // (restrained: summer foliage in late sun is olive-green, not the fresh green of a spring leaf)
  return out.setHSL(0.2 + tone * 0.06, 0.28 + tone * 0.14, 0.24 + tone * 0.1, THREE.SRGBColorSpace)
}
export const impostorTint = foliageTint

/**
 * Plant impostors: one InstancedMesh per species in the atlas, each plant on
 * the variant of its kind its `pick` selects. `place` sets the shared matrix
 * for a plant (grounded on the terrain, or mapped into the far distance).
 */
export function plantImpostors(
  impostors: ImpostorSet,
  plants: Plant[],
  _heightAt: (x: number, z: number) => number,
  place: (spot: { x: number; z: number; plan: Plant }, h: number) => THREE.Matrix4,
  group: THREE.Object3D,
): THREE.Object3D[] {
  const buckets = impostors.geometries.map(() => [] as Plant[])
  for (const p of plants) {
    const options = impostors.of(p.kind)
    buckets[options[Math.min(options.length - 1, Math.floor(p.pick * options.length))]].push(p)
  }
  const c = new THREE.Color()
  const meshes: THREE.Object3D[] = []
  buckets.forEach((list, species) => {
    if (list.length === 0) return
    const mesh = new THREE.InstancedMesh(impostors.geometries[species], impostors.material, list.length)
    mesh.name = 'impostors'
    list.forEach((p, i) => {
      mesh.setMatrixAt(i, place({ x: p.x, z: p.z, plan: p }, p.height))
      mesh.setColorAt(i, impostorTint(p.kind, p.tone, c))
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    mesh.raycast = () => {}
    group.add(mesh)
    meshes.push(mesh)
  })
  return meshes
}
