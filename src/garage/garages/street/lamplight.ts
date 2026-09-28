import * as THREE from 'three'
import { CAR_LAMP_COUNT, type CarLamps } from './car-lamps'

/**
 * The street lamps' (and the festive strings') light, drawn per pixel by the street's own materials. Ninety real point lights
 * would recompile every material in the scene when switched and be evaluated on every pixel (and the
 * landscape's materials compile point lights out altogether), so the lanterns are binned into a grid
 * over the town instead — each 16 m cell lists the few lamps within reach — and a material adds the
 * warm pools of those near it: inverse-square falloff windowed to the reach, brighter below a lantern
 * than beside it, Lambert on the surface. No shadows: the lamps stand at the kerb and light the street
 * side of everything. The colour and level come from the Street lamps group (interior.ts `output`).
 */

/** where three's spot loop has a light's direction and colour (lights_fragment_begin) */
const SPOT_INFO = 'getSpotLightInfo( spotLight, geometryPosition, directLight );'

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
  /**
   * `foliage`: a cheaper pool for leaf cards (alpha-tested crowns draw many layers a pixel) — each
   * cell's 4 nearest street lamps, no glint, no shadow from the real lamps
   */
  patch(material: THREE.MeshStandardMaterial, opts?: { foliage?: boolean }): void
  dispose(): void
}

/**
 * up to two kinds (street lamps, festive strings). `real`: the lamps near the car that are also real
 * lights (car-lamps.ts) — skipped in three's light loop here (their pools are drawn below), and their
 * shadow maps darken those lamps' pools.
 */
export function createLampLight(sets: LightSet[], rect: THREE.Vector4, real: CarLamps): LampLight {
  const gw = Math.ceil(rect.z / CELL)
  const gh = Math.ceil(rect.w / CELL)
  const data = new Float32Array(gw * SLOTS * gh * 4)
  let full = 0
  for (let j = 0; j < gh; j++) {
    for (let i = 0; i < gw; i++) {
      const x0 = rect.x + i * CELL
      const z0 = rect.y + j * CELL
      // every light that reaches the cell's square, nearest first: a crowded cell drops only its farthest festive points
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
      // (the street lamps first: leaf cards read only the first few — see patch)
      near.sort((a, b) => a.kind - b.kind || a.d - b.d)
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
    ...real.uniforms,
  }
  const head = /* glsl */ `
    uniform highp sampler2D uLampGrid;
    uniform vec4 uLampRect;
    uniform vec3 uLampColor[ 2 ];
    uniform vec2 uLampReach;
    varying vec3 vLampPos;
    uniform vec4 uRealLamp[ ${CAR_LAMP_COUNT} ];
    /** one of the real lamps (a spot light's view-space position): its light is drawn as a pool instead */
    bool isRealLamp( vec3 viewPos ) {
      for ( int j = 0; j < ${CAR_LAMP_COUNT}; j ++ ) {
        if ( uRealLamp[ j ].w > 0.0 && distance( viewPos, ( viewMatrix * vec4( uRealLamp[ j ].xyz, 1.0 ) ).xyz ) < 0.05 ) return true;
      }
      return false;
    }
  `
  // (after three's shadow functions)
  const shadowHead = /* glsl */ `
    #if defined( USE_SHADOWMAP ) && defined( SHADOWMAP_TYPE_PCF )
      uniform sampler2DShadow uRealShadow[ ${CAR_LAMP_COUNT} ];
      uniform mat4 uRealShadowMatrix[ ${CAR_LAMP_COUNT} ];
      uniform vec4 uRealShadowParams[ ${CAR_LAMP_COUNT} ];
      float realLampShadow( sampler2DShadow map, mat4 m, vec4 params, vec3 p, vec3 n ) {
        vec4 c = m * vec4( p + n * params.y, 1.0 );
        return c.w > 0.0 ? getShadow( map, vec2( params.w ), 1.0, params.x, params.z, c ) : 1.0;
      }
      /** how much of lamp l's light reaches p: its shadow map if it's a real lamp, else all of it */
      float streetLampShadow( vec3 l, vec3 p, vec3 n ) {
        ${Array.from({ length: CAR_LAMP_COUNT }, (_, j) => `if ( uRealLamp[ ${j} ].w > 0.0 && distance( l, uRealLamp[ ${j} ].xyz ) < 0.05 )
          return realLampShadow( uRealShadow[ ${j} ], uRealShadowMatrix[ ${j} ], uRealShadowParams[ ${j} ], p, n );`).join('\n        ')}
        return 1.0;
      }
    #else
      float streetLampShadow( vec3 l, vec3 p, vec3 n ) { return 1.0; }
    #endif
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
        for ( int k = 0; k < LAMP_SLOTS; k ++ ) {
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
          #ifndef LAMP_FOLIAGE
            if ( kind == 0 && nl > 0.0 ) fall *= streetLampShadow( l.xyz, vLampPos, lN );
          #endif
          lamp += color * nl * fall;
          #ifndef LAMP_FOLIAGE
          // a soft glint on glossy stone (setts polished by wheels), roughness-widened
          vec3 H = normalize( Ld + V );
          glint += color * pow( max( dot( lN, H ), 0.0 ), 2.0 / ( r * r * r * r ) ) * fall * nl * ( 1.0 - r ) * 0.6;
          #endif
        }
        reflectedLight.directDiffuse += lamp * BRDF_Lambert( material.diffuseColor );
        reflectedLight.directSpecular += glint;
      }
    }
  `
  function patch(material: THREE.MeshStandardMaterial, opts: { foliage?: boolean } = {}): void {
    const defines = opts.foliage ? '#define LAMP_FOLIAGE\n#define LAMP_SLOTS 4' : `#define LAMP_SLOTS ${SLOTS}`
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
        .replace('#include <common>', `#include <common>\n${defines}\n${head}`)
        .replace('#include <shadowmap_pars_fragment>', `#include <shadowmap_pars_fragment>\n${shadowHead}`)
        .replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin)
        .replace(SPOT_INFO, `${SPOT_INFO}\n\t\tif ( isRealLamp( spotLight.position ) ) { directLight.color = vec3( 0.0 ); directLight.visible = false; }`)
        .replace('#include <lights_fragment_end>', `${apply}\n#include <lights_fragment_end>`)
      if (!shader.fragmentShader.includes('isRealLamp( spotLight')) console.warn('[garage] street lamps: three spot loop changed — the car lamps light the street twice')
    }
    material.customProgramCacheKey = () => `street-lamps${opts.foliage ? '-foliage' : ''}|${key()}`
    material.needsUpdate = true
  }
  return { patch, dispose: () => grid.dispose() }
}
