import * as THREE from 'three'

/**
 * How a part's albedo is produced. `factory` keeps the model's own texture
 * (optionally hue-rotated); everything else is generated in the shader from
 * car-space position, so it needs no UVs and wraps the atlas-mapped body cleanly.
 */
export type PaintStyle = 'factory' | 'solid' | 'stripes' | 'two-tone' | 'carbon' | 'camo'
export type Finish = 'factory' | 'gloss' | 'metallic' | 'satin' | 'matte' | 'chrome'

export interface PaintSettings {
  style: PaintStyle
  /** main colour (css hex) */
  colorA: string
  /** secondary colour — stripes, upper tone, dark camo */
  colorB: string
  /** hue rotation for the factory texture, degrees */
  hue: number
  finish: Finish
  /** override the surface alpha (glass tint); null keeps the texture's */
  opacity: number | null
}

const STYLE_ID: Record<PaintStyle, number> = {
  factory: 0,
  solid: 1,
  stripes: 2,
  'two-tone': 3,
  carbon: 4,
  camo: 5,
}

interface FinishParams {
  roughness: number
  metalness: number
  clearcoat: number
  clearcoatRoughness: number
}

const FINISHES: Record<Exclude<Finish, 'factory'>, FinishParams> = {
  gloss: { roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 },
  metallic: { roughness: 0.32, metalness: 0.8, clearcoat: 1, clearcoatRoughness: 0.05 },
  satin: { roughness: 0.5, metalness: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.4 },
  matte: { roughness: 0.88, metalness: 0, clearcoat: 0, clearcoatRoughness: 0 },
  chrome: { roughness: 0.06, metalness: 1, clearcoat: 0, clearcoatRoughness: 0 },
}

const PAINT_PARS = /* glsl */ `
uniform float uStyle;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uHue;
uniform float uOpacity;
varying vec3 vCarPos;
varying vec3 vCarNormal;

// rotate a colour around the grey axis (Rodrigues) — keeps luminance roughly intact
vec3 hueRotate( vec3 c, float a ) {
  const vec3 k = vec3( 0.57735 );
  float ca = cos( a );
  return c * ca + cross( k, c ) * sin( a ) + k * dot( k, c ) * ( 1.0 - ca );
}

float paintHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}

float paintNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( paintHash( i ), paintHash( i + vec3( 1, 0, 0 ) ), f.x ),
         mix( paintHash( i + vec3( 0, 1, 0 ) ), paintHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( paintHash( i + vec3( 0, 0, 1 ) ), paintHash( i + vec3( 1, 0, 1 ) ), f.x ),
         mix( paintHash( i + vec3( 0, 1, 1 ) ), paintHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ),
    f.z );
}

// anti-aliased 0→1 edge at t
float edge( float t, float x ) {
  float w = fwidth( x );
  return smoothstep( t - w, t + w, x );
}

// 2x2 twill carbon weave, projected along the dominant normal axis
vec3 carbonWeave( vec3 p, vec3 n ) {
  vec3 an = abs( n );
  vec2 uv = an.x > an.y && an.x > an.z ? p.zy : ( an.y > an.z ? p.xz : p.xy );
  uv *= 45.0;
  vec2 cell = floor( uv );
  vec2 f = fract( uv );
  bool warp = mod( floor( ( cell.x + cell.y ) * 0.5 ), 2.0 ) < 1.0;
  float across = warp ? f.y : f.x;
  float tow = sin( across * PI ); // rounded fibre bundle
  float strands = 0.85 + 0.15 * sin( across * PI * 9.0 );
  float shade = mix( 0.22, 1.0, tow * strands ) * ( warp ? 1.0 : 0.72 );
  return uColorA * shade;
}

vec3 paintPattern( vec3 p, vec3 n ) {
  if ( uStyle < 1.5 ) return uColorA;
  // twin racing stripes running nose to tail
  if ( uStyle < 2.5 ) {
    float x = abs( p.x );
    return mix( uColorA, uColorB, edge( 0.035, x ) * ( 1.0 - edge( 0.2, x ) ) );
  }
  // contrasting upper half above the beltline
  if ( uStyle < 3.5 ) return mix( uColorA, uColorB, edge( 0.8, p.y ) );
  if ( uStyle < 4.5 ) return carbonWeave( p, n );
  // three-tone camo blotches
  float v = paintNoise( p * 2.4 ) * 0.6 + paintNoise( p * 6.3 + 11.0 ) * 0.4;
  vec3 c = mix( uColorA, mix( uColorA, uColorB, 0.5 ), edge( 0.42, v ) );
  return mix( c, uColorB, edge( 0.56, v ) );
}
`

const PAINT_FRAGMENT = /* glsl */ `
#ifdef USE_MAP
  vec4 paintTexel = texture2D( map, vMapUv );
#else
  vec4 paintTexel = vec4( 1.0 );
#endif
// factory keeps the material's own colour × texture (some paints are colour-only); styles replace it
diffuseColor.rgb = uStyle < 0.5
  ? hueRotate( diffuseColor.rgb * paintTexel.rgb, uHue )
  : paintPattern( vCarPos, normalize( vCarNormal ) );
diffuseColor.a *= paintTexel.a;
if ( uOpacity >= 0.0 ) diffuseColor.a = uOpacity;
`

function toPhysical(source: THREE.Material): THREE.MeshPhysicalMaterial {
  if ((source as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
    return (source as THREE.MeshPhysicalMaterial).clone()
  }
  const physical = new THREE.MeshPhysicalMaterial()
  // standard → physical: copy the shared props, keep physical defaults for the rest
  THREE.MeshStandardMaterial.prototype.copy.call(physical, source as THREE.MeshStandardMaterial)
  physical.defines = { STANDARD: '', PHYSICAL: '' }
  return physical
}

export interface PaintMaterial {
  material: THREE.MeshPhysicalMaterial
  apply(settings: PaintSettings): void
}

/**
 * Clone a part's material into a repaintable one. `carSpace` is the inverse
 * of the car root's world matrix — patterns are laid out in car space (x
 * across, y up, z nose-ward) so they stay put if the car moves. `lacquer`
 * gives paint without its own clear coat a factory one.
 */
export function createPaintMaterial(
  source: THREE.Material,
  carSpace: THREE.Matrix4,
  { lacquer = false } = {},
): PaintMaterial {
  const material = toPhysical(source)
  material.name = `${source.name}-paint`
  if (lacquer && material.clearcoat === 0) {
    material.clearcoat = 1
    material.clearcoatRoughness = 0.03
  }

  const factory = {
    roughness: material.roughness,
    metalness: material.metalness,
    roughnessMap: material.roughnessMap,
    metalnessMap: material.metalnessMap,
    clearcoat: material.clearcoat,
    clearcoatRoughness: material.clearcoatRoughness,
  }

  const uniforms = {
    uStyle: { value: 0 },
    uColorA: { value: new THREE.Color() },
    uColorB: { value: new THREE.Color() },
    uHue: { value: 0 },
    uOpacity: { value: -1 },
    uCarInv: { value: carSpace },
  }

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform mat4 uCarInv;\nvarying vec3 vCarPos;\nvarying vec3 vCarNormal;',
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        mat4 carModel = uCarInv * modelMatrix;
        vCarPos = ( carModel * vec4( transformed, 1.0 ) ).xyz;
        vCarNormal = normalize( mat3( carModel ) * objectNormal );`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PAINT_PARS}`)
      .replace('#include <map_fragment>', PAINT_FRAGMENT)
  }

  return {
    material,
    apply(s) {
      uniforms.uStyle.value = STYLE_ID[s.style]
      uniforms.uColorA.value.set(s.colorA)
      uniforms.uColorB.value.set(s.colorB)
      uniforms.uHue.value = THREE.MathUtils.degToRad(s.hue)
      uniforms.uOpacity.value = s.opacity ?? -1

      const params = s.finish === 'factory' ? factory : FINISHES[s.finish]
      // custom finishes drop the factory roughness/metal maps so the numbers mean what they say
      const maps = s.finish === 'factory' ? factory : { roughnessMap: null, metalnessMap: null }
      const needsRecompile = material.roughnessMap !== maps.roughnessMap
      Object.assign(material, {
        roughness: params.roughness,
        metalness: params.metalness,
        clearcoat: params.clearcoat,
        clearcoatRoughness: params.clearcoatRoughness,
        roughnessMap: maps.roughnessMap,
        metalnessMap: maps.metalnessMap,
      })
      if (needsRecompile) material.needsUpdate = true
    },
  }
}
