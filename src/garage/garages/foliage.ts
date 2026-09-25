import * as THREE from 'three'

/**
 * Shared shading for everything leafy — grass, trees near and far:
 *
 *  - wind: one coherent field over the land. Gusts travel downwind as a slow
 *    wave, so neighbouring grass leans together and a patch a few metres on
 *    follows a moment later; each plant adds a little phase of its own. Grass
 *    moves most (and tall grass most of all, by its height squared), trees
 *    barely and slowly. Driven by `WIND.time`, advanced only through the
 *    room's `update(dt)`: idle frames hold still, video exports stay repeatable.
 *    The offset is applied after the instance transform, in the landscape's
 *    own frame (which is only ever translated), so it's in world directions.
 *  - translucency: leaves and blades are thin — the sun behind them shines
 *    through instead of leaving a black silhouette, and even in shade they
 *    keep a little of the sky's light passing through.
 *  - leaf colour from the instance: `lumaLeaves` keeps only the leaf texture's
 *    light and dark (veins, shading, holes), and the instance colour — the
 *    forest's palette, varied per tree — supplies the hue. The stock cards are
 *    all differently coloured (oak green, aspen yellow…); this puts every tree
 *    in one natural palette.
 *
 * Chains any `onBeforeCompile` already set (receiveFarShadow, impostor
 * normals), and keeps the program cache key distinct per combination.
 */

/** the wind, shared by every foliage material */
export const WIND = {
  time: { value: 0 },
  /** unit direction the wind blows toward, in the landscape's frame (x, z) */
  direction: { value: new THREE.Vector2(0.94, 0.34) },
}

export interface FoliageOptions {
  /** how it sways: grass by its blade, a tree as a whole crown */
  wind?: 'grass' | 'tree'
  /** light passed through the sun-facing leaves toward the viewer, 0–1 */
  translucency?: number
  /** take only the leaf texture's brightness (× gain, normalising its mean to ~1); the instance colour gives the hue */
  lumaLeaves?: number
}

export function foliage<M extends THREE.MeshStandardMaterial>(material: M, opts: FoliageOptions): M {
  const previous = material.onBeforeCompile
  const previousKey = material.customProgramCacheKey.bind(material)
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.uniforms.uWindTime = WIND.time
    shader.uniforms.uWindDir = WIND.direction
    if (opts.wind) {
      const grass = opts.wind === 'grass'
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime;\nuniform vec2 uWindDir;')
        .replace(
          '#include <project_vertex>',
          `vec4 mvPosition = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            vec3 plantAt = instanceMatrix[ 3 ].xyz;
            float plantHeight = length( instanceMatrix[ 1 ].xyz );
          #else
            vec3 plantAt = vec3( 0.0 );
            float plantHeight = 1.0;
          #endif
          {
            // how far up the plant this vertex is, 0 at the root (grass geometry is in metres, trees in units of their height)
            float up = clamp( transformed.y, 0.0, 1.0 );
            // gusts travel downwind; a little phase of the plant's own
            float along = dot( plantAt.xz, uWindDir );
            float own = fract( sin( dot( plantAt.xz, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ) * 6.2831853;
            ${
              grass
                ? `float gust = 0.5 + 0.5 * sin( along * 0.22 - uWindTime * 1.3 );
            float sway = gust * ( 0.35 + 0.65 * sin( uWindTime * 2.6 + own + along * 0.9 ) );
            // metres of sway at the tip, by the blade's height (tall grass whips, a short sward barely stirs):
            // ~5 cm for a 30 cm tuft, ~25 cm for a metre of seeding grass
            float bladeH = transformed.y * plantHeight;
            float amount = 0.25 * bladeH * bladeH + 0.08 * bladeH;`
                : `float gust = 0.6 + 0.4 * sin( along * 0.05 - uWindTime * 0.45 );
            float sway = gust * sin( uWindTime * 0.8 + own ) ;
            float amount = 0.006 * up * up * plantHeight;`
            }
            vec2 push = uWindDir * ( sway + 0.35 ) + vec2( -uWindDir.y, uWindDir.x ) * 0.25 * sin( uWindTime * 1.7 + own );
            mvPosition.xz += push * amount;
            mvPosition.y -= 0.35 * amount * abs( sway );
          }
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`,
        )
    }
    if (opts.lumaLeaves) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        diffuseColor.rgb = vec3( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) ) * ${opts.lumaLeaves.toFixed(3)};`,
      )
    }
    if (opts.translucency) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          // the sun (directional light 0) through the leaf: strongest looking into it, a little from any side
          vec3 toLight = directionalLights[ 0 ].direction;
          float back = pow( clamp( dot( -normalize( vViewPosition ), toLight ), 0.0, 1.0 ), 4.0 );
          reflectedLight.directDiffuse += diffuseColor.rgb * directionalLights[ 0 ].color * ${opts.translucency.toFixed(3)} * ( 0.12 + 0.9 * back );
        }
        #endif`,
      )
    }
  }
  const key = `foliage|${opts.wind ?? ''}|${opts.translucency ?? 0}|${opts.lumaLeaves ?? 0}`
  material.customProgramCacheKey = () => `${key}|${previousKey()}`
  material.needsUpdate = true
  return material
}

/**
 * A leaf texture must have loaded before it's read or baked. ez-tree loads its
 * cards asynchronously (`image` is only set once they arrive): wait for that —
 * up to a few seconds — then for the decode.
 */
export async function loaded(texture: THREE.Texture | null): Promise<void> {
  if (!texture) return
  for (let waited = 0; !texture.image && waited < 8000; waited += 50) await new Promise((r) => setTimeout(r, 50))
  const image = texture.image as HTMLImageElement | undefined
  if (!image) console.warn('[garage] foliage: a leaf texture never arrived')
  else if ('decode' in image && !image.complete) await image.decode().catch(() => {})
}

/**
 * The gain that brings a leaf texture's covered pixels to a mean linear
 * luminance of 1 — for `lumaLeaves`, so every species' cards carry the same
 * brightness and the instance colour alone sets how light a crown is.
 */
export async function leafGain(texture: THREE.Texture | null): Promise<number> {
  await loaded(texture)
  const image = texture?.image as CanvasImageSource | undefined
  if (!image) return 2.5
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  g.drawImage(image, 0, 0, size, size)
  const px = g.getImageData(0, 0, size, size).data
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  let sum = 0
  let n = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue
    sum += 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2])
    n++
  }
  return n ? Math.min(12, n / Math.max(sum, 1e-3)) : 2.5
}
