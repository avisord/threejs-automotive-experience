import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { foliage, leafGain, loaded } from './foliage'
import { dilate } from './impostors'
import { seeded } from './landform'
import { OUTDOOR_SKY_LIGHT } from './sky'
import type { Variant } from './trees'

/**
 * LOD 1 trees — the ones most of the view is made of: a simplified trunk and
 * main limbs, and a crown of ~10–16 large, irregular, overlapping foliage
 * masses. Each mass is three crossed cards carrying a *cluster card*: a slab of
 * the real tree's leaves (dozens of them) rendered into a texture once, with a
 * ragged round edge. Texture complexity instead of geometry: a mass is 6
 * triangles that read as a clump of 30–60 leaves.
 *
 *  - where the masses go: k-means over the full tree's leaf positions, so the
 *    crown keeps its species' shape (a pine's tiers, an oak's broad dome)
 *  - how big: each cluster's spread; neighbours overlap, leaving the odd gap
 *  - shading: normals from the crown's centre (a rounded crown, not flat
 *    cards) and vertex colour for the inner and lower masses in the crown's
 *    own shade
 *  - the skeleton: the full tree's branch mesh with every triangle thinner than
 *    a limb dropped (the twigs are inside the masses anyway)
 */

const CELL = 256
/** branch triangles with a shorter ring edge than this (unit tree height) are twigs, hidden in the masses */
const SKELETON_EDGE = 0.0045
/** a cluster card's slab depth and window, relative to the cluster's radius */
const SLAB = 0.55 // thin: gaps between the leaves stay open

export interface MassTree {
  skeleton: THREE.BufferGeometry
  masses: THREE.BufferGeometry
  conifer: boolean
  triangles: number
}

export interface MassSet {
  trees: MassTree[]
  material: THREE.MeshStandardMaterial
  dispose(): void
}

/** deterministic k-means on points (flat xyz array), `k` centres; returns centres and each cluster's rms radius */
function kmeans(points: Float32Array, k: number, seed: number): { centre: THREE.Vector3; radius: number; count: number }[] {
  const n = points.length / 3
  const rand = seeded(seed)
  const centres = Array.from({ length: k }, () => {
    const i = Math.floor(rand() * n) * 3
    return new THREE.Vector3(points[i], points[i + 1], points[i + 2])
  })
  const owner = new Int32Array(n)
  const p = new THREE.Vector3()
  for (let iter = 0; iter < 12; iter++) {
    for (let i = 0; i < n; i++) {
      p.fromArray(points, i * 3)
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = p.distanceToSquared(centres[c])
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      owner[i] = best
    }
    const sum = centres.map(() => new THREE.Vector3())
    const count = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      sum[owner[i]].add(p.fromArray(points, i * 3))
      count[owner[i]]++
    }
    for (let c = 0; c < k; c++) if (count[c]) centres[c].copy(sum[c]).divideScalar(count[c])
  }
  const sq = new Float64Array(k)
  const count = new Int32Array(k)
  for (let i = 0; i < n; i++) {
    sq[owner[i]] += p.fromArray(points, i * 3).distanceToSquared(centres[owner[i]])
    count[owner[i]]++
  }
  return centres.map((centre, c) => ({ centre, radius: Math.sqrt(sq[c] / Math.max(1, count[c])), count: count[c] })).filter((c) => c.count > 3)
}

/** the branch mesh with the twigs dropped: keep triangles whose shortest edge (the ring edge, ~2πr/segments) is a limb's */
function skeletonOf(branches: THREE.BufferGeometry, minEdge: number): THREE.BufferGeometry {
  const pos = branches.attributes.position
  const index = branches.index!
  const kept: number[] = []
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < index.count; t += 3) {
    const i0 = index.getX(t)
    const i1 = index.getX(t + 1)
    const i2 = index.getX(t + 2)
    a.fromBufferAttribute(pos, i0)
    b.fromBufferAttribute(pos, i1)
    c.fromBufferAttribute(pos, i2)
    if (Math.min(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) > minEdge) kept.push(i0, i1, i2)
  }
  const g = new THREE.BufferGeometry()
  for (const name of Object.keys(branches.attributes)) g.setAttribute(name, branches.attributes[name])
  g.setIndex(kept)
  g.computeBoundingSphere()
  return g
}

/** three crossed cards per mass, textured with the species' cluster card (atlas cell `cell` of `cells`) */
function massGeometry(
  clusters: { centre: THREE.Vector3; radius: number }[],
  crown: THREE.Vector3,
  crownTop: number,
  cell: number,
  cells: number,
  conifer: boolean,
  seed: number,
): THREE.BufferGeometry {
  const rand = seeded(seed)
  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const u0 = cell / cells
  const du = 1 / cells
  const v = new THREE.Vector3()
  const n = new THREE.Vector3()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  // how far out the crown reaches, for the inner/outer shading
  const reach = Math.max(...clusters.map((c) => Math.hypot(c.centre.x - crown.x, c.centre.z - crown.z) + c.radius), 1e-3)
  for (const cl of clusters) {
    const size = cl.radius * (conifer ? 1.75 : 1.6) // cards overlap their neighbours' (a crown, not a bunch of discs)
    const outer = Math.hypot(cl.centre.x - crown.x, cl.centre.z - crown.z) / reach
    const high = cl.centre.y / crownTop
    // the inner and lower masses in the crown's own shade
    const shade = 0.68 + 0.32 * THREE.MathUtils.smoothstep(outer * 0.6 + high * 0.5, 0.25, 0.95)
    const yaw = rand() * Math.PI
    const tilt = (rand() - 0.5) * (conifer ? 0.25 : 0.5)
    for (let k = 0; k < 3; k++) {
      q.setFromEuler(e.set(tilt, yaw + (k * Math.PI) / 3, (rand() - 0.5) * 0.3))
      const flip = rand() < 0.5
      const base = position.length / 3
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ]) {
        // pines' masses are flatter tiers, broadleaves' rounder
        v.set(sx * size, sy * size * (conifer ? 0.5 : 0.9), 0).applyQuaternion(q).add(cl.centre)
        position.push(v.x, v.y, v.z)
        // a rounded crown: the normal points out from the crown's centre, lifted toward the sky
        n.subVectors(v, crown).multiply(new THREE.Vector3(1, 0.7, 1)).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.3).normalize()
        normal.push(n.x, n.y, n.z)
        // the card's lower edge a little darker: the underside of a clump
        const s = shade * (sy < 0 ? 0.88 : 1)
        color.push(s, s, s)
        uv.push(u0 + du * ((flip ? -sx : sx) * 0.5 + 0.5), sy * 0.5 + 0.5)
      }
      index.push(base, base + 1, base + 2, base, base + 2, base + 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

/**
 * Bake one cluster card per tree: a slab of its leaves around a typical
 * cluster, seen side-on, cut to a ragged disc, leaves' light and dark only
 * (normalised, as foliage.lumaLeaves; the instance colour gives the hue),
 * nearer leaves brighter than those deeper in the slab.
 */
async function bakeClusterCards(
  variants: Variant[],
  picks: { centre: THREE.Vector3; radius: number }[],
): Promise<THREE.DataTexture> {
  const width = CELL * variants.length
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  renderer.setSize(width, CELL, false)
  const target = new THREE.WebGLRenderTarget(width, CELL, { samples: 4 })
  const scene = new THREE.Scene()
  const bark = new THREE.MeshBasicMaterial({ color: 0x3c3a36 })
  renderer.setRenderTarget(target)
  renderer.setClearColor(new THREE.Color(0.1, 0.13, 0.07), 0)
  renderer.clear()
  renderer.setScissorTest(true)
  for (const [i, variant] of variants.entries()) {
    await loaded(variant.leafMap)
    const gain = await leafGain(variant.leafMap)
    const { centre, radius } = picks[i]
    const r = radius * SLAB
    const leaves = new THREE.MeshBasicMaterial({ map: variant.leafMap, alphaTest: 0.5, side: THREE.DoubleSide })
    const cut = (mat: THREE.Material, isLeaf: boolean) => {
      mat.onBeforeCompile = (shader) => {
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vAt;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAt = position;')
        shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vAt;').replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          {
            vec3 d = ( vAt - vec3( ${centre.x.toFixed(4)}, ${centre.y.toFixed(4)}, ${centre.z.toFixed(4)} ) ) / ${(radius * 1.05).toFixed(4)};
            // a leafy, broken edge: the clump thins out toward its rim at the scale of single leaves
            // (a smooth outline — or a wavy one — read as a stamped disc)
            vec3 cellId = floor( vAt * ${(12 / 1).toFixed(1)} / ${r.toFixed(4)} );
            float h = fract( sin( dot( cellId, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
            float rr = length( d.xy );
            if ( rr > 0.95 || h < smoothstep( 0.45, 0.95, rr ) ) discard;
            ${
              isLeaf
                ? `float leaf = min( 1.0, dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * ${gain.toFixed(3)} * 0.55 );
            // nearer leaves (toward the bake camera) and the upper side lit; deeper and lower ones a little shaded
            diffuseColor.rgb = vec3( leaf * mix( 0.62, 1.08, smoothstep( -0.8, 0.8, d.z * 0.8 + d.y * 0.4 ) ) );`
                : ''
            }
          }`,
        )
      }
      mat.customProgramCacheKey = () => `cluster-${i}-${isLeaf}`
    }
    cut(leaves, true)
    const barkCut = bark.clone()
    cut(barkCut, false)
    const group = new THREE.Group()
    group.add(new THREE.Mesh(variant.branches, barkCut), new THREE.Mesh(variant.leaves, leaves))
    scene.add(group)
    // looking along −z at the cluster, through a slab ±r deep
    const rw = radius * 1.05 // the window: a little wider than the cluster
    const camera = new THREE.OrthographicCamera(-rw, rw, rw, -rw, rw - r, rw + r)
    camera.position.set(centre.x, centre.y, centre.z + rw)
    camera.lookAt(centre)
    renderer.setViewport(i * CELL, 0, CELL, CELL)
    renderer.setScissor(i * CELL, 0, CELL, CELL)
    renderer.render(scene, camera)
    scene.remove(group)
    leaves.dispose()
    barkCut.dispose()
  }
  const pixels = new Uint8Array(width * CELL * 4)
  renderer.readRenderTargetPixels(target, 0, 0, width, CELL, pixels)
  target.dispose()
  bark.dispose()
  renderer.dispose()
  renderer.forceContextLoss()
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = Math.min(255, pixels[i] * 1.4)
  dilate(pixels, width, CELL, 6)
  const atlas = new THREE.DataTexture(pixels, width, CELL)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.generateMipmaps = true
  atlas.minFilter = THREE.LinearMipmapLinearFilter
  atlas.magFilter = THREE.LinearFilter
  atlas.anisotropy = 8
  atlas.needsUpdate = true
  return atlas
}

/** LOD 1 versions of `variants` (full trees, normalised to 1 unit tall — trees.grow) */
export async function createMasses(variants: Variant[]): Promise<MassSet> {
  const plans = variants.map((v, i) => {
    const pos = v.leaves.attributes.position.array as Float32Array
    // every 4th vertex: a point per leaf card is plenty for the clustering
    const pts = new Float32Array(Math.floor(pos.length / 12) * 3)
    for (let j = 0, k = 0; k < pts.length; j += 12, k += 3) pts.set([pos[j], pos[j + 1], pos[j + 2]], k)
    // (pines: more, smaller masses — few big ones stacked up the trunk read as topiary)
    const clusters = kmeans(pts, v.conifer ? 24 : 20, 900 + i)
    const crown = new THREE.Vector3()
    for (const c of clusters) crown.add(c.centre)
    crown.divideScalar(clusters.length)
    const top = Math.max(...clusters.map((c) => c.centre.y + c.radius))
    // the card's sample: a typical (median-size) cluster
    const pick = [...clusters].sort((a, b) => a.radius - b.radius)[Math.floor(clusters.length / 2)]
    return { clusters, crown, top, pick }
  })
  const atlas = await bakeClusterCards(
    variants,
    plans.map((p) => p.pick),
  )
  const trees = variants.map((v, i) => {
    const skeleton = skeletonOf(v.branches, SKELETON_EDGE)
    const masses = massGeometry(plans[i].clusters, plans[i].crown, plans[i].top, i, variants.length, v.conifer, 70 + i)
    return { skeleton, masses, conifer: v.conifer, triangles: (skeleton.index!.count + masses.index!.count) / 3 }
  })
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    vertexColors: true,
    alphaTest: 0.4,
    alphaToCoverage: true, // with MSAA: the cards' edges resolve softly instead of stair-stepping
    side: THREE.DoubleSide,
    roughness: 0.85,
    envMapIntensity: OUTDOOR_SKY_LIGHT,
  })
  receiveFarShadow(material)
  foliage(material, { wind: 'tree', translucency: 0.35, coverage: true, matte: true, crownNormals: true })
  material.color.setScalar(1 / 0.55) // the bake's headroom (bakeClusterCards)
  console.info(
    `[garage] LOD1 trees: ${trees.map((t, i) => `${Math.round(t.skeleton.index!.count / 3)}/${variants[i].branches.index!.count / 3} limb tris + ${t.masses.index!.count / 6} cards`).join(', ')}`,
  )
  return {
    trees,
    material,
    dispose() {
      for (const t of trees) {
        t.skeleton.dispose()
        t.masses.dispose()
      }
      atlas.dispose()
      material.dispose()
    },
  }
}
