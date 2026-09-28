import * as THREE from 'three'

/**
 * The street lamps' (and the festive strings') light, drawn per pixel by the street's own materials. Ninety real point lights
 * would recompile every material in the scene when switched and be evaluated on every pixel (and the
 * landscape's materials compile point lights out altogether), so the lanterns are binned into a grid
 * over the town instead — each 16 m cell lists the few lamps within reach — and a material adds the
 * warm pools of those near it: inverse-square falloff windowed to the reach, brighter below a lantern
 * than beside it, Lambert on the surface. No shadows: the lamps stand at the kerb and light the street
 * side of everything. The colour and level come from the Street lamps group (interior.ts `output`).
 */

const CELL = 16
/** lights per cell (a cell under the festive strings holds several strings' points and the lamps) */
const SLOTS = 20

/** one kind of light: where its points are (w: strength ≤ 1), its colour × level, how far it reaches */
export interface LightSet {
  points: THREE.Vector4[]
  color: THREE.Color
  reach: number
}

export interface LampLight {
  patch(material: THREE.MeshStandardMaterial): void
  dispose(): void
}

/** up to two kinds (street lamps, festive strings) */
export function createLampLight(sets: LightSet[], rect: THREE.Vector4): LampLight {
  const gw = Math.ceil(rect.z / CELL)
  const gh = Math.ceil(rect.w / CELL)
  const data = new Float32Array(gw * SLOTS * gh * 4)
  let full = 0
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x0 = rect.x + i * CELL
      const z0 = rect.y + j * CELL
      // every light that reaches the cell's square, nearest first: a crowded cell drops only its farthest
      const cx = x0 + CELL / 2
      const cz = z0 + CELL / 2
      const near: { l: THREE.Vector4; kind: number; d: number }[] = []
      sets.forEach((set, kind) => {
        for (const l of set.points) {
          const dx = Math.max(x0 - l.x, 0, l.x - (x0 + CELL))
          const dz = Math.max(z0 - l.z, 0, l.z - (z0 + CELL))
          if (dx * dx + dz * dz <= set.reach * set.reach) near.push({ l, kind, d: (l.x - cx) ** 2 + (l.z - cz) ** 2 })
        }
      })
      near.sort((a, b) => a.d - b.d)
      if (near.length > SLOTS) full++
      near.slice(0, SLOTS).forEach(({ l, kind }, n) => {
        // (w: the kind in its tens, the strength below)
        data.set([l.x, l.y, l.z, kind * 10 + Math.min(l.w, 1)], ((j * gw + i) * SLOTS + n) * 4)
      })
    }
  }
  if (full) console.info(`[garage] street lights: ${full} crowded cells keep their nearest ${SLOTS}`)
  const grid = new THREE.DataTexture(data, gw * SLOTS, gh, THREE.RGBAFormat, THREE.FloatType)
  grid.needsUpdate = true

  const uniforms = {
    uLampGrid: { value: grid },
    uLampRect: { value: new THREE.Vector4(rect.x, rect.y, gw, gh) },
    uLampColor: { value: [sets[0].color, sets[1]?.color ?? new THREE.Color(0, 0, 0)] },
    uLampReach: { value: new THREE.Vector2(sets[0].reach ** 2, (sets[1]?.reach ?? 1) ** 2) },
  }
  const head = /* glsl */ `
    uniform highp sampler2D uLampGrid;
    uniform vec4 uLampRect;
    uniform vec3 uLampColor[ 2 ];
    uniform vec2 uLampReach;
    varying vec3 vLampPos;
  `
  const apply = /* glsl */ `
    if ( dot( uLampColor[ 0 ] + uLampColor[ 1 ], vec3( 1.0 ) ) > 0.0 ) {
      ivec2 cell = ivec2( floor( ( vLampPos.xz - uLampRect.xy ) / ${CELL}.0 ) );
      if ( cell.x >= 0 && cell.y >= 0 && cell.x < int( uLampRect.z ) && cell.y < int( uLampRect.w ) ) {
        vec3 lN = inverseTransformDirection( normal, viewMatrix );
        vec3 V = normalize( cameraPosition - vLampPos );
        vec3 lamp = vec3( 0.0 );
        vec3 glint = vec3( 0.0 );
        float r = max( material.roughness, 0.25 );
        for ( int k = 0; k < ${SLOTS}; k ++ ) {
          vec4 l = texelFetch( uLampGrid, ivec2( cell.x * ${SLOTS} + k, cell.y ), 0 );
          if ( l.w <= 0.0 ) break;
          int kind = int( l.w / 10.0 );
          float strength = l.w - float( kind ) * 10.0;
          vec3 color = uLampColor[ kind ];
          vec3 L = l.xyz - vLampPos;
          float d2 = dot( L, L );
          float win = clamp( 1.0 - d2 / uLampReach[ kind ], 0.0, 1.0 );
          if ( win <= 0.0 ) continue;
          vec3 Ld = L * inversesqrt( d2 );
          // a lantern's roof keeps light off the sky: a little dimmer sideways, none upward (strings shine all round)
          float cone = kind == 0 ? 0.45 + 0.55 * smoothstep( -0.1, 0.8, Ld.y ) : 1.0;
          float fall = strength * cone * win * win / ( d2 + 1.0 );
          float nl = max( dot( lN, Ld ), 0.0 );
          lamp += color * nl * fall;
          // a soft glint on glossy stone (setts polished by wheels), roughness-widened
          vec3 H = normalize( Ld + V );
          glint += color * pow( max( dot( lN, H ), 0.0 ), 2.0 / ( r * r * r * r ) ) * fall * nl * ( 1.0 - r ) * 0.6;
        }
        reflectedLight.directDiffuse += lamp * BRDF_Lambert( material.diffuseColor );
        reflectedLight.directSpecular += glint;
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
