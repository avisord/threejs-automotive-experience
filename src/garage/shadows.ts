import * as THREE from 'three'

/**
 * Sun shadow settings (Settings › Graphics › Shadows), applied to whatever room is installed.
 *
 * Each open-air room builds its own sun with a sharp near map (±45 m round the car) and a coarse far
 * one over the whole landscape (far-shadow.ts). The rooms' own bias values were tuned for that near
 * map at 4096² — ~2.2 cm texels. Here the resolution and reach can change, so the normal bias (world
 * metres) is scaled with the texel, and softness is set in world centimetres of penumbra rather than
 * in texels: the same setting looks the same at every resolution.
 */
export interface ShadowSettings {
  /** the near sun map's size, texels a side */
  resolution: ShadowResolution
  /** penumbra width, centimetres (0 = the map's own texel edge) */
  softness: number
  /** half-width of the near map, metres: smaller is sharper, larger reaches farther up the street */
  range: number
  /** × the room's tuned bias: up if surfaces stripe themselves (acne), down if shadows lift off (peter-panning) */
  bias: number
  /** the far map: buildings, hills and trees shading the land past the near map */
  distant: boolean
  /** photos and video exports render the near map at twice the size (up to 8192²) */
  captureBoost: boolean
}

export type ShadowResolution = 1024 | 2048 | 4096 | 8192

export const DEFAULT_SHADOWS: ShadowSettings = {
  resolution: 4096,
  softness: 4,
  range: 45,
  bias: 1,
  distant: true,
  captureBoost: true,
}

/** what the room set up before any settings touched it */
interface Tuned {
  bias: number
  normalBias: number
  /** metres a texel of the tuned map */
  texel: number
}

const MAX_SIZE = 8192

/**
 * Apply `s` to every shadow-casting directional light under `root` (the room's sun and its far map).
 * `boost` doubles the near map for a capture. Maps whose size changed are thrown away and rebuilt.
 */
export function applyShadows(root: THREE.Object3D, s: ShadowSettings, renderer: THREE.WebGLRenderer, boost = false): void {
  const maxSize = Math.min(MAX_SIZE, renderer.capabilities.maxTextureSize)
  root.traverse((o) => {
    const light = o as THREE.DirectionalLight
    if (!light.isDirectionalLight || !light.castShadow) return
    const shadow = light.shadow
    const cam = shadow.camera
    const tuned = (light.userData.shadowTuned ??= {
      bias: shadow.bias,
      normalBias: shadow.normalBias,
      texel: (cam.right - cam.left) / shadow.mapSize.x,
    } satisfies Tuned) as Tuned

    if (light.name === 'far-shadow') {
      // the far map keeps its size and reach (tuned per room); only on or off. Intensity is a
      // uniform — toggling castShadow would renumber the maps and recompile every material.
      shadow.intensity = s.distant ? 1 : 0
      shadow.bias = tuned.bias * s.bias
      shadow.needsUpdate = true
      return
    }

    const size = Math.min(maxSize, s.resolution * (boost ? 2 : 1))
    const half = s.range
    if (cam.right !== half) {
      Object.assign(cam, { left: -half, right: half, top: half, bottom: -half })
      cam.updateProjectionMatrix()
    }
    if (shadow.mapSize.x !== size) {
      shadow.mapSize.set(size, size)
      shadow.map?.dispose() // three only allocates a map when there is none
      shadow.map = null
    }
    const texel = (2 * half) / size
    shadow.bias = tuned.bias * s.bias
    // world-space push along the normal: keep it a fixed number of texels, as tuned
    shadow.normalBias = tuned.normalBias * (texel / tuned.texel) * s.bias
    // PCF radius is in texels
    shadow.radius = Math.max(0.5, s.softness / 100 / texel)
    shadow.needsUpdate = true
  })
}

/**
 * three's PCF filter takes 5 taps on a Vogel disc whatever the radius: fine for a texel or two, but a
 * wide soft edge breaks into dither. Wider radii take more taps (the radius is a uniform, so the branch
 * is the same for every pixel of a light).
 */
function patchPcf(): void {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment
  const start = chunk.indexOf('shadow = (\n\t\t\t\t\ttexture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( 0, 5')
  const end = chunk.indexOf(') * 0.2;', start)
  if (start < 0 || end < 0) {
    console.warn('[garage] three PCF shadow filter changed: soft shadows keep 5 taps')
    return
  }
  const taps = `{
					// (5 taps up to 2 texels, then more: a 5-tap disc a few texels wide breaks into dither)
					int taps = shadowRadius <= 2.0 ? 5 : shadowRadius <= 4.0 ? 12 : 24;
					float sum = 0.0;
					for ( int i = 0; i < 24; i ++ ) {
						if ( i >= taps ) break;
						sum += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, taps, phi ) * radius, shadowCoord.z ) );
					}
					shadow = sum / float( taps );
				}`
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, start) + taps + chunk.slice(end + ') * 0.2;'.length)
}
patchPcf()
