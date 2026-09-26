import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { foliage, leafGain, loaded } from './foliage'
import { OUTDOOR_SKY_LIGHT } from './sky'
import { grow, type PresetJson, type TreeCtor, type Variant } from './trees'

/**
 * Cheap trees for the distance: the real ez-tree trees, rendered once into a
 * texture atlas and drawn as crossed cards — LOD 2 three of them (6 triangles,
 * a fuller silhouette from any side), LOD 3 two (4 triangles). Thousands of
 * leaves in a texture, not in geometry; the real silhouette, not a cone or a ball.
 *
 * The atlas holds albedo only; the scene lights the billboards live through
 * "crown" normals (mostly up, leaning out from the trunk), so they sit in the
 * same light as the real trees. Alpha-tested, so it
 * casts proper dappled shadows into the shadow maps too.
 *
 * The camera stays within a few metres of the pavilion, so billboards are
 * always seen from about the same side — crossed quads never show their edge.
 */

export type ImpostorKind = 'conifer' | 'broadleaf' | 'shrub'

interface Species {
  preset: string
  seed: number
  kind: ImpostorKind
  /** light variant (fewer, bigger leaf cards): reads better small */
  light: boolean
  /** crown fullness (trees.grow) — the same as the near trees', so a tree keeps its mass at every distance */
  fullness: number
}

/** the atlas cells, left to right */
const SPECIES: Species[] = [
  { preset: 'Pine Large', seed: 1101, kind: 'conifer', light: true, fullness: 1.6 },
  { preset: 'Pine Medium', seed: 1202, kind: 'conifer', light: true, fullness: 1.6 },
  { preset: 'Oak Large', seed: 1303, kind: 'broadleaf', light: true, fullness: 2.4 },
  { preset: 'Oak Medium', seed: 1404, kind: 'broadleaf', light: true, fullness: 2.6 },
  { preset: 'Ash Large', seed: 1505, kind: 'broadleaf', light: true, fullness: 2.4 },
  // (the aspen's cards are autumn yellow; only their light and dark are baked — foliage.ts)
  { preset: 'Aspen Large', seed: 1606, kind: 'broadleaf', light: true, fullness: 2.2 },
  { preset: 'Bush 1', seed: 1707, kind: 'shrub', light: false, fullness: 1.4 },
  { preset: 'Bush 3', seed: 1808, kind: 'shrub', light: false, fullness: 1.4 },
]
const CELL = { w: 384, h: 768 } // LOD 2 cards stand ~300 px tall at 80 m through the 36° lens

export interface ImpostorSet {
  /** LOD 3: one geometry per species (2 crossed quads, 1 unit = the tree's height) */
  geometries: THREE.BufferGeometry[]
  /** LOD 2: the same, three crossed quads */
  cards: THREE.BufferGeometry[]
  kinds: ImpostorKind[]
  material: THREE.MeshStandardMaterial
  /** species indices of a kind */
  of(kind: ImpostorKind): number[]
  dispose(): void
}

/**
 * Render the species into an atlas with a throwaway WebGL context (the app's
 * renderer isn't reachable from here), read it back and upload it as a plain
 * texture in the app's context.
 */
async function bakeAtlas(variants: Variant[], frames: { fw: number; fh: number }[]): Promise<THREE.DataTexture> {
  const width = CELL.w * variants.length
  const height = CELL.h
  const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true })
  renderer.setSize(width, height, false)
  const target = new THREE.WebGLRenderTarget(width, height, { samples: 4 })
  target.texture.colorSpace = THREE.SRGBColorSpace
  const scene = new THREE.Scene()
  // albedo only — the live scene lights the billboards (baked light on top of live light washed them out)
  const bark = new THREE.MeshBasicMaterial({ color: 0x3c3a36 }) // (tinted green by the instance colour: a dark grey-brown survives it)
  const pixels = new Uint8Array(width * height * 4)
  renderer.setRenderTarget(target)
  // clear to the leaves' own dark green with alpha 0, so mip levels don't bleed a halo into the edges
  renderer.setClearColor(new THREE.Color(0.1, 0.13, 0.07), 0)
  renderer.clear()
  for (const [i, variant] of variants.entries()) {
    await loaded(variant.leafMap)
    // the leaves' light and dark only, normalised (foliage.leafGain): the instance colour (trees.foliageTint) is the hue
    const gain = await leafGain(variant.leafMap)
    const leaves = new THREE.MeshBasicMaterial({ map: variant.leafMap, alphaTest: 0.5, side: THREE.DoubleSide })
    const { fw: frameW, fh: frameH } = frames[i]
    leaves.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCrown;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCrown = position;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCrown;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
        // (linear luminance × gain, capped: the render target stores sRGB of this)
        float leaf = min( 1.0, dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) * ${gain.toFixed(3)} * 0.55 );
        // Crown depth, baked: leaves deep inside the crown and low in it sit in its own shade; the outer
        // shell and the top catch the light. Without it a billboard is one flat cut-out colour.
        float out_ = clamp( length( vCrown.xz ) / ${(frameW * 0.5).toFixed(4)}, 0.0, 1.0 );
        float high = clamp( vCrown.y / ${(frameH * 0.55).toFixed(4)}, 0.0, 1.0 );
        float front = clamp( 0.5 + vCrown.z / ${(frameW).toFixed(4)}, 0.0, 1.0 ); // facing the bake camera: the side seen
        float lit = smoothstep( 0.25, 1.0, out_ * 0.55 + high * 0.3 + front * 0.45 );
        diffuseColor.rgb = vec3( leaf * mix( 0.22, 1.05, lit ) );`,
        )
    }
    const group = new THREE.Group()
    group.add(new THREE.Mesh(variant.branches, bark), new THREE.Mesh(variant.leaves, leaves))
    scene.add(group)
    const { fw, fh } = frames[i]
    const camera = new THREE.OrthographicCamera(-fw / 2, fw / 2, fh, 0, -10, 10)
    camera.position.set(0, 0, 5)
    renderer.setViewport(i * CELL.w, 0, CELL.w, CELL.h)
    renderer.setScissor(i * CELL.w, 0, CELL.w, CELL.h)
    renderer.setScissorTest(true)
    renderer.render(scene, camera)
    scene.remove(group)
    leaves.dispose()
  }
  renderer.readRenderTargetPixels(target, 0, 0, width, height, pixels)
  target.dispose()
  bark.dispose()
  renderer.dispose()
  renderer.forceContextLoss()

  // Leaves are solid: the resolved MSAA coverage left crowns ~0.6 opaque (ghostly with alpha-to-coverage).
  // Firm it up — only a little: more (×3) turned each leaf card's partly covered square into a solid tile.
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = Math.min(255, pixels[i] * 1.4)
  dilate(pixels, width, height, 6)
  const atlas = new THREE.DataTexture(pixels, width, height)
  atlas.colorSpace = THREE.SRGBColorSpace
  atlas.generateMipmaps = true
  atlas.minFilter = THREE.LinearMipmapLinearFilter
  atlas.magFilter = THREE.LinearFilter
  atlas.anisotropy = 8
  atlas.needsUpdate = true
  return atlas
}

/**
 * Spread the colour of covered texels into the empty ones around them (alpha
 * stays 0) — without it, mip levels and linear filtering blend leaf colour
 * with the clear colour, and distant billboards wear a pale grey fringe.
 */
export function dilate(px: Uint8Array, w: number, h: number, passes: number): void {
  const filled = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) filled[i] = px[i * 4 + 3] > 0 ? 1 : 0
  for (let pass = 0; pass < passes; pass++) {
    const next = filled.slice()
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (filled[i]) continue
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const j = yy * w + xx
          if (!filled[j]) continue
          r += px[j * 4]
          g += px[j * 4 + 1]
          b += px[j * 4 + 2]
          n++
        }
        if (n) {
          px.set([r / n, g / n, b / n], i * 4)
          next[i] = 1
        }
      }
    }
    filled.set(next)
  }
}

/** `planes` crossed quads for atlas cell `cell`, `fw` wide × `fh` tall, standing on the origin */
function crossedQuads(cell: number, count: number, fw: number, fh: number, planes = 2): THREE.BufferGeometry {
  const u0 = cell / count
  const u1 = (cell + 1) / count
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const index: number[] = []
  for (const [k, turn] of Array.from({ length: planes }, (_, i) => (i * Math.PI) / planes).entries()) {
    const ax = Math.cos(turn)
    const az = -Math.sin(turn)
    for (const [cx, cy, u, v] of [
      [-1, 0, u0, 0],
      [1, 0, u1, 0],
      [1, 1, u1, 1],
      [-1, 1, u0, 1],
    ]) {
      const x = ax * cx * (fw / 2)
      const z = az * cx * (fw / 2)
      position.push(x, cy * fh, z)
      // a crown's normal: mostly up, leaning a little out from the trunk — lit like a rounded mass;
      // leaning it far out split each card into a black half and a pale one against a low sun
      const n = new THREE.Vector3(ax * cx * 0.35, 1, az * cx * 0.35).normalize()
      normal.push(n.x, n.y, n.z)
      uv.push(u, v)
    }
    const b = k * 4
    index.push(b, b + 1, b + 2, b, b + 2, b + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeBoundingSphere()
  return g
}

export async function createImpostors(Tree: TreeCtor, presets: Record<string, PresetJson>): Promise<ImpostorSet> {
  const variants = SPECIES.map((s) => grow(Tree, presets[s.preset], s.seed, s.light, s.kind === 'conifer', s.fullness))
  // each cell's frame: wide enough for the crown, and the cell's 1:2 aspect so nothing is stretched
  const frames = variants.map((v) => {
    const box = new THREE.Box3().setFromBufferAttribute(v.leaves.attributes.position as THREE.BufferAttribute)
    box.union(new THREE.Box3().setFromBufferAttribute(v.branches.attributes.position as THREE.BufferAttribute))
    const half = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z)
    const fw = Math.max(2 * half * 1.04, 0.5)
    return { fw, fh: fw * (CELL.h / CELL.w) }
  })
  const atlas = await bakeAtlas(variants, frames)
  for (const v of variants) {
    v.branches.dispose()
    v.leaves.dispose()
  }
  const material = new THREE.MeshStandardMaterial({
    map: atlas,
    alphaTest: 0.4,
    alphaToCoverage: true, // with MSAA: soft, stable edges instead of shimmering stair-steps
    side: THREE.DoubleSide,
    shadowSide: THREE.DoubleSide,
    roughness: 0.9,
    envMapIntensity: OUTDOOR_SKY_LIGHT,
  })
  // A billboard faces the viewer, so light it as the side of a crown the viewer sees: normals toward the
  // camera and up (a tree against a low sun is a dark silhouette, not a lit card), plus a little of the
  // card's own outward lean; and the lower, inner crown in its own shade.
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
        transformedNormal = normalize( vec3( 0.0, 0.0, 1.0 ) * 0.7 + ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz * 0.7 + transformedNormal * 0.3 );`,
      )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      diffuseColor.rgb *= mix( 0.55, 1.0, smoothstep( 0.02, 0.55, vMapUv.y ) );
      // Coverage-preserving alpha test: each mip level averages leaves with the gaps between them, so a
      // crown's alpha sinks below the threshold with distance and far trees vanish. Scale alpha back up
      // by the mip level being sampled (Golus's "alpha to coverage" mip scaling).
      {
        vec2 texel = vMapUv * vec2( textureSize( map, 0 ) );
        float lod = max( 0.0, 0.5 * log2( max( dot( dFdx( texel ), dFdx( texel ) ), dot( dFdy( texel ), dFdy( texel ) ) ) ) );
        diffuseColor.a *= 1.0 + lod * 0.35;
      }`,
    )
  }
  material.customProgramCacheKey = () => 'impostor'
  receiveFarShadow(material)
  foliage(material, { wind: 'tree', translucency: 0.2, matte: true, crownNormals: true })
  // the atlas holds the leaves at 0.55 of their normalised brightness (headroom): undo it here, so a far tree
  // is the same colour as a near one of the same tint
  material.color.setScalar(1 / 0.55)
  const geometries = frames.map((f, i) => crossedQuads(i, SPECIES.length, f.fw, f.fh))
  const cards = frames.map((f, i) => crossedQuads(i, SPECIES.length, f.fw, f.fh, 3))
  const kinds = SPECIES.map((s) => s.kind)
  return {
    geometries,
    cards,
    kinds,
    material,
    of: (kind) => kinds.flatMap((k, i) => (k === kind ? [i] : [])),
    dispose() {
      for (const g of [...geometries, ...cards]) g.dispose()
      atlas.dispose()
      material.dispose()
    },
  }
}
