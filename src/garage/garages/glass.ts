import * as THREE from 'three'
import { fbm, noise, seeded } from './landform'

/**
 * Architectural glass that reads as glass rather than a tinted film:
 *
 *  - blended as real glass is seen: what's behind shows through, dimmed by a
 *    few percent of absorption and by the Fresnel reflectance, and the
 *    reflection is added on top (premultiplied alpha) — nearly clear head-on,
 *    a mirror at a glancing angle
 *  - the slight roller waves of float glass (a normal map), so reflections of
 *    straight lines wobble a touch
 *  - a faint film of dust and a few smudges that catch the light and dull the
 *    reflection in patches, thicker toward the bottom of each pane — seen
 *    mostly where the sun or a bright reflection falls on them
 *
 * Panes are laid by `glassPane()`, each tilted a fraction of a degree
 * differently, as installed panes are — reflections break at every mullion.
 */

/** one tile of waviness and dirt, metres */
const TILE = 1.6

/** float glass: faint long waves along the draw direction, and a slower, random warp */
function waveNormalMap(): THREE.DataTexture {
  const size = 256
  const h = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      // periodic so the tile repeats (sin of whole cycles; noise sampled on a torus-ish ring)
      const roller = Math.sin(v * Math.PI * 2 * 5 + 0.6 * Math.sin(u * Math.PI * 2)) * 0.6
      const warp = fbm(Math.cos(u * Math.PI * 2) * 1.2 + 3, Math.sin(v * Math.PI * 2) * 1.2 + Math.sin(u * Math.PI * 2) * 0.8, 3)
      h[y * size + x] = roller + warp * 2
    }
  }
  const data = new Uint8Array(size * size * 4)
  const strength = 0.6
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (i: number, j: number) => h[((j + size) % size) * size + ((i + size) % size)]
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength
      const n = new THREE.Vector3(-dx, -dy, 1).normalize()
      data.set([(n.x * 0.5 + 0.5) * 255, (n.y * 0.5 + 0.5) * 255, (n.z * 0.5 + 0.5) * 255, 255], (y * size + x) * 4)
    }
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.generateMipmaps = true
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

/** dirt on the glass: R = dust and smudge density, tiling every TILE metres (soft blobs only: wipe arcs read as circles) */
function dirtTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = 'rgb(0,0,0)'
  g.fillRect(0, 0, size, size)
  const rand = seeded(29)
  // a fine even film of dust, mottled
  const img = g.getImageData(0, 0, size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      const film = fbm(Math.cos(u * Math.PI * 2) * 3 + 11, Math.sin(v * Math.PI * 2) * 3 + Math.sin(u * Math.PI * 2) * 2, 4)
      const speck = rand() < 0.004 ? 120 + rand() * 120 : 0
      const val = Math.max(0, film - 0.45) * 160 + speck + noise(x * 0.9, y * 0.9) * 10
      img.data[(y * size + x) * 4] = Math.min(255, val)
    }
  }
  g.putImageData(img, 0, 0)
  g.globalCompositeOperation = 'lighter'
  // smudges: soft blobs, and arcs where a cloth wiped
  for (let i = 0; i < 14; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 8 + rand() * 30
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r)
      grad.addColorStop(0, `rgba(${20 + rand() * 30},0,0,1)`)
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      g.fillStyle = grad
      g.beginPath()
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.NoColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

export interface GlassOptions {
  /** fraction of light the glass itself absorbs head-on (a faint grey) */
  absorption?: number
  /** how dirty, 0–1 */
  dirt?: number
}

export function createGlassMaterial(opts: GlassOptions = {}): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.02,
    metalness: 0,
    transparent: true,
    premultipliedAlpha: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    normalMap: waveNormalMap(),
    normalScale: new THREE.Vector2(0.06, 0.06), // a slight wobble in straight reflections, no more
  })
  const dirt = dirtTexture()
  const uniforms = {
    uDirt: { value: dirt },
    uDirtAmount: { value: opts.dirt ?? 1 },
    uAbsorption: { value: opts.absorption ?? 0.07 },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGlassWorld;\nvarying vec3 vGlassNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlassWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
        vGlassNormal = normalize( mat3( modelMatrix ) * normal );`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uDirt;
        uniform float uDirtAmount;
        uniform float uAbsorption;
        varying vec3 vGlassWorld;
        varying vec3 vGlassNormal;
        float glassDirt;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          // dirt in the pane's own plane, in metres: across (x or z, whichever the pane runs along) and up
          vec3 an = abs( vGlassNormal );
          vec2 p = an.y > 0.5 ? vGlassWorld.xz : vec2( an.x > an.z ? vGlassWorld.z : vGlassWorld.x, vGlassWorld.y );
          float film = texture2D( uDirt, p / ${TILE.toFixed(2)} ).r;
          // dust settles toward the bottom of a pane; hands smudge it at 0.8–1.8 m
          float low = an.y > 0.5 ? 0.3 : exp( -max( vGlassWorld.y, 0.0 ) * 1.6 );
          glassDirt = clamp( ( film * 0.3 + low * 0.25 ) * uDirtAmount, 0.0, 1.0 );
          // glass has no body colour of its own; only the dirt on it scatters light back
          diffuseColor.rgb = vec3( 0.3, 0.29, 0.28 ) * glassDirt;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.3, glassDirt );`,
      )
      // premultiplied: the reflection (and lit dust) added in full; what's behind is dimmed by the
      // glass's absorption, its Fresnel reflectance and the dust
      .replace(
        '#include <opaque_fragment>',
        `float glassNdotV = clamp( abs( dot( normal, normalize( vViewPosition ) ) ), 0.0, 1.0 );
        float glassF = 0.04 + 0.96 * pow( 1.0 - glassNdotV, 5.0 );
        gl_FragColor = vec4( outgoingLight, clamp( uAbsorption + glassF * 0.92 + glassDirt * 0.06, 0.0, 1.0 ) );`,
      )
      .replace('#include <premultiplied_alpha_fragment>', '')
  }
  material.customProgramCacheKey = () => 'arch-glass'
  return material
}

/**
 * A pane of glass `width` × `height`, centred on its origin in the XY plane,
 * tilted by a fraction of a degree (seeded) as a real installed pane is, with
 * uvs in TILE-metre units offset per pane so neighbours don't match.
 */
export function glassPane(material: THREE.Material, width: number, height: number, seed: number): THREE.Mesh {
  const rand = seeded(seed)
  const geometry = new THREE.PlaneGeometry(width, height)
  const uv = geometry.attributes.uv
  const ou = rand()
  const ov = rand()
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / TILE + ou, (uv.getY(i) * height) / TILE + ov)
  const pane = new THREE.Mesh(geometry, material)
  const tilt = THREE.MathUtils.degToRad(0.22)
  pane.rotation.set((rand() - 0.5) * tilt, (rand() - 0.5) * tilt, 0)
  pane.raycast = () => {} // the camera's line-of-sight test looks through glass
  return pane
}
