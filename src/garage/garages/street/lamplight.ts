import * as THREE from 'three'

/**
 * The street lamps' light, drawn per pixel by the street's own materials. Ninety real point lights
 * would recompile every material in the scene when switched and be evaluated on every pixel (and the
 * landscape's materials compile point lights out altogether), so the lanterns are binned into a grid
 * over the town instead — each 16 m cell lists the few lamps within reach — and a material adds the
 * warm pools of those near it: inverse-square falloff windowed to the reach, brighter below a lantern
 * than beside it, Lambert on the surface. No shadows: the lamps stand at the kerb and light the street
 * side of everything. The colour and level come from the Street lamps group (interior.ts `output`).
 */

const CELL = 16
/** lamps per cell */
const SLOTS = 8
/** how far a lamp's light reaches, m */
const REACH = 26

export interface LampLight {
  patch(material: THREE.MeshStandardMaterial): void
  dispose(): void
}

export function createLampLight(lamps: THREE.Vector4[], rect: THREE.Vector4, color: THREE.Color): LampLight {
  const gw = Math.ceil(rect.z / CELL)
  const gh = Math.ceil(rect.w / CELL)
  const data = new Float32Array(gw * SLOTS * gh * 4)
  let full = 0
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x0 = rect.x + i * CELL
      const z0 = rect.y + j * CELL
      let n = 0
      for (const l of lamps) {
        // distance from the lamp to the cell's square
        const dx = Math.max(x0 - l.x, 0, l.x - (x0 + CELL))
        const dz = Math.max(z0 - l.z, 0, l.z - (z0 + CELL))
        if (dx * dx + dz * dz > REACH * REACH) continue
        if (n === SLOTS) {
          full++
          break
        }
        data.set([l.x, l.y, l.z, l.w], ((j * gw + i) * SLOTS + n) * 4)
        n++
      }
    }
  }
  if (full) console.warn(`[garage] street lamps: ${full} cells over ${SLOTS} lamps`)
  const grid = new THREE.DataTexture(data, gw * SLOTS, gh, THREE.RGBAFormat, THREE.FloatType)
  grid.needsUpdate = true

  const uniforms = {
    uLampGrid: { value: grid },
    uLampRect: { value: new THREE.Vector4(rect.x, rect.y, gw, gh) },
    uLampColor: { value: color },
  }
  const head = /* glsl */ `
    uniform highp sampler2D uLampGrid;
    uniform vec4 uLampRect;
    uniform vec3 uLampColor;
    varying vec3 vLampPos;
  `
  const apply = /* glsl */ `
    if ( uLampColor.r + uLampColor.g + uLampColor.b > 0.0 ) {
      ivec2 cell = ivec2( floor( ( vLampPos.xz - uLampRect.xy ) / ${CELL}.0 ) );
      if ( cell.x >= 0 && cell.y >= 0 && cell.x < int( uLampRect.z ) && cell.y < int( uLampRect.w ) ) {
        vec3 lN = inverseTransformDirection( normal, viewMatrix );
        vec3 V = normalize( cameraPosition - vLampPos );
        float lamp = 0.0;
        float glint = 0.0;
        for ( int k = 0; k < ${SLOTS}; k ++ ) {
          vec4 l = texelFetch( uLampGrid, ivec2( cell.x * ${SLOTS} + k, cell.y ), 0 );
          if ( l.w <= 0.0 ) break;
          vec3 L = l.xyz - vLampPos;
          float d2 = dot( L, L );
          float win = clamp( 1.0 - d2 / ${(REACH * REACH).toFixed(1)}, 0.0, 1.0 );
          vec3 Ld = L * inversesqrt( d2 );
          // the lantern's roof keeps light off the sky: a little dimmer sideways, none upward
          float cone = 0.45 + 0.55 * smoothstep( -0.1, 0.8, Ld.y );
          float fall = l.w * cone * win * win / ( d2 + 1.0 );
          lamp += max( dot( lN, Ld ), 0.0 ) * fall;
          // a soft glint on glossy stone (setts polished by wheels), roughness-widened
          vec3 H = normalize( Ld + V );
          float r = max( material.roughness, 0.25 );
          glint += pow( max( dot( lN, H ), 0.0 ), 2.0 / ( r * r * r * r ) ) * fall * max( dot( lN, Ld ), 0.0 ) * ( 1.0 - r ) * 0.6;
        }
        reflectedLight.directDiffuse += uLampColor * lamp * BRDF_Lambert( material.diffuseColor );
        reflectedLight.directSpecular += uLampColor * glint;
      }
    }
  `
  function patch(material: THREE.MeshStandardMaterial): void {
    const previous = material.onBeforeCompile
    const key = material.customProgramCacheKey.bind(material)
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer)
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLampPos;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec4 lw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            lw = instanceMatrix * lw;
          #endif
          vLampPos = ( modelMatrix * lw ).xyz;
        }`,
      )
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${head}`)
        .replace('#include <lights_fragment_end>', `${apply}\n#include <lights_fragment_end>`)
    }
    material.customProgramCacheKey = () => `street-lamps|${key()}`
    material.needsUpdate = true
  }
  return { patch, dispose: () => grid.dispose() }
}
