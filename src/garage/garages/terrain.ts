import * as THREE from 'three'
import { FIELD_GLSL, FIELD_SHADE_GLSL } from './fields'
import { receiveFarShadow } from './far-shadow'
import { SURFACES, pbrMaps } from './kit'
import { fbm, noRaycast, polarGrid, smoothstep } from './landform'
import { GROUND, SITE, forestDensity, heightAt, lakeShape, onRoad } from './site'
import { OUTDOOR_SKY_LIGHT } from './sky'

/** a landscape material: the sky's fill toned down to a clear day's, far shadows read in */
export function outdoorMaterial<M extends THREE.MeshStandardMaterial>(material: M): M {
  material.envMapIntensity = OUTDOOR_SKY_LIGHT
  receiveFarShadow(material)
  return material
}

/** mean linear luminance of the sparse-grass photo (color.webp) — its detail is taken relative to it */
const GRASS_MEAN = 0.0357

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)

/**
 * How much of a point is farmland, 0–1: most of the valley floor past the
 * meadow, with the odd unfarmed tract (the fields themselves are fields.ts,
 * drawn per pixel; steep and wooded ground is taken out per vertex below).
 */
export function farmland(x: number, z: number): number {
  const r = Math.hypot(x, z)
  return smoothstep(r, 110, 200) * (1 - smoothstep(r, 3000, 3250)) * smoothstep(fbm(x / 350 - 5, z / 350 + 9, 2), 0.3, 0.4)
}

/**
 * The narrower farmland the valley's planned trees were laid out on (landscape.ts): the tree
 * layout — near trees included — stays as it was when the fields spread wider.
 */
export function orchardFarmland(x: number, z: number): number {
  const r = Math.hypot(x, z)
  return smoothstep(r, 140, 260) * (1 - smoothstep(r, 2600, 3000)) * smoothstep(fbm(x / 350 - 5, z / 350 + 9, 2), 0.38, 0.5)
}

/** the terrain's grid — shared by anything draped over it (canopy.ts), so their vertices coincide */
export const TERRAIN_GRID = { rings: 240, segments: 720, spacing: (t: number) => t ** 1.8 }

/**
 * Detail on the ground near the pavilion, drawn per pixel in world metres — the
 * vertex colours carry the land's broad colours but can't change within a few
 * metres, so up to ~1 km the lawn and meadows read as one flat green and the
 * fields as flat slabs. Here:
 *  - patches at 25 m, 7 m and 2 m: drier straw-coloured grass, deep clover-green
 *    hollows, fine mottling — faded to their average where they'd shimmer
 *  - the grass texture sampled at a second, larger scale so its 3 m tile doesn't repeat
 *  - the farmland (the `farm` attribute) drawn per pixel at every distance —
 *    fields, crops, rows, boundaries, farm roads (fields.ts), each level of
 *    detail giving way to the next coarser one as it shrinks under a pixel
 */
function groundDetail<M extends THREE.MeshStandardMaterial>(material: M): M {
  const base = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float farm;\nvarying float vFarm;\nvarying vec3 vGround;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvFarm = farm;\nvGround = ( modelMatrix * vec4( position, 1.0 ) ).xyz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying float vFarm;
        varying vec3 vGround;
        ${FIELD_GLSL}
        ${FIELD_SHADE_GLSL}
        float gHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
        float gNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( gHash( i ), gHash( i + vec2( 1, 0 ) ), u.x ), mix( gHash( i + vec2( 0, 1 ) ), gHash( i + 1.0 ), u.x ), u.y );
        }
        // noise at a scale, faded toward its mean once a cell is under ~2 pixels
        float gDetail( vec2 p, float scale ) {
          vec2 q = p / scale;
          float px = max( length( fwidth( q ) ), 1e-5 );
          return mix( gNoise( q ), 0.5, smoothstep( 0.25, 0.6, px ) );
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          // The photographed grass gives detail, not colour: its brightness relative to its mean
          // (blades, the soil between them), sampled again at 4.3× the size so the 2 m tile never
          // lines up with itself, plus a little of its own hue — the land's colours stay the
          // vertex colours and the patches below.
          const float GRASS_MEAN = ${GRASS_MEAN};
          const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
          vec3 gTex = texture2D( map, vMapUv ).rgb;
          vec3 gTex2 = texture2D( map, vMapUv * 0.23 + 0.37 ).rgb;
          float gLum = dot( gTex, LUMA );
          float detail = mix( gLum, dot( gTex2, LUMA ), 0.35 ) / GRASS_MEAN;
          vec3 hue = gTex / max( gLum, 1e-4 );
          diffuseColor.rgb *= clamp( detail, 0.0, 2.5 ) * mix( vec3( 1.0 ), hue, 0.25 );
        #endif`,
      )
      .replace(
        '#include <color_fragment>',
        `// the land's colours, with the farmland's fields drawn over them (fields.ts)
        float fieldAmount = 0.0;
        #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
          diffuseColor.rgb *= fieldShade( vColor.rgb, vGround.xz, vFarm, fieldAmount );
        #endif
        {
          vec2 p = vGround.xz;
          float near = 1.0 - smoothstep( 500.0, 1100.0, length( vGround - cameraPosition ) );
          if ( near > 0.0 ) {
            vec3 c = diffuseColor.rgb;
            float lum = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
            float broad = gDetail( p - 71.0, 90.0 );
            float big = gDetail( p + 31.0, 25.0 );
            float mid = gDetail( p - 17.0, 7.0 );
            float fine = gDetail( p + 5.0, 2.0 );
            // drier, straw-coloured grass on the rises; deep, lush clover in the hollows
            vec3 straw = lum * vec3( 1.9, 1.55, 0.7 );
            vec3 lush = c * vec3( 0.7, 1.0, 0.62 );
            // (value noise sits near 0.5: the thresholds are set so a third or so of the ground is each)
            float dry = smoothstep( 0.45, 0.66, broad * 0.35 + big * 0.45 + mid * 0.2 );
            float wet = smoothstep( 0.48, 0.66, mid * 0.55 + ( 1.0 - big ) * 0.45 ) * ( 1.0 - dry );
            // (less of it on the fields, which have their own crops, rows and stripes)
            float grassy = 1.0 - 0.7 * fieldAmount;
            c = mix( c, straw, dry * 0.5 * grassy );
            c = mix( c, lush, wet * 0.65 * grassy );
            // tufts and bare scuffs, and a broad light/dark swell (mown and unmown, thin and thick sward)
            c *= ( 0.68 + 0.64 * fine ) * ( 0.8 + 0.4 * broad );
            diffuseColor.rgb = mix( diffuseColor.rgb, c, near );
          }
          // (a negative albedo anywhere — the fields' blends can overshoot on dark ground — turns
          // into a magenta spark in the lake's half-float mirror)
          diffuseColor.rgb = max( diffuseColor.rgb, 0.0 );
        }`,
      )
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `ground-detail|${key()}`
  return material
}

/**
 * The real-scale land: the pavilion's lawn terrace, the valley falling to the
 * road and the lake, farmland, wooded hillsides and the far shore. 3.3 km
 * across in every direction, finest near the pavilion.
 */
export function createTerrain(cover: (x: number, z: number) => number = () => 0): { mesh: THREE.Mesh; ready: Promise<void> } {
  const lawn = srgb(0x557f2e)
  const lush = srgb(0x5a8330)
  const dry = srgb(0x8a9346)
  const soil = srgb(0x6e5a40)
  const gravel = srgb(0x837d72)
  const woodland = srgb(0x2f4a24)
  const shore = srgb(0x7d735c)
  const lakeBed = srgb(0x2c3a36)
  const geometry = polarGrid(
    SITE.realRadius,
    TERRAIN_GRID.rings,
    TERRAIN_GRID.segments,
    TERRAIN_GRID.spacing, // fine near the pavilion (lawn, road), coarser at the far shore
    (x, z, _t, _a, c) => {
      const h = heightAt(x, z)
      const r = Math.hypot(x, z)
      // grass: lush and dry patches; the lawn by the pavilion mown and even
      c.copy(lush).lerp(dry, smoothstep(fbm(x / 60, z / 60), 0.5, 0.75) * 0.7)
      c.lerp(lawn, 1 - smoothstep(r, 30, 70))
      // bare earth: small patches near the building and in the fields
      c.lerp(soil, smoothstep(fbm(x / 18 + 40, z / 18), 0.66, 0.78) * smoothstep(r, 35, 60) * (1 - smoothstep(r, 900, 1400)) * 0.8)
      // gravel shoulders along the road
      c.lerp(gravel, smoothstep(onRoad(x, z), 0.05, 0.4) * 0.8)
      // (the farmland's fields are drawn per pixel over these colours: fields.ts)
      // darker ground under woodland
      if (r > 60 && r < SITE.realRadius) c.lerp(woodland, smoothstep(forestDensity(x, z), 0.1, 0.6) * 0.7)
      // under the trees themselves: shaded, leaf-littered ground, darkest at the trunks — grounds them
      const shade = cover(x, z)
      if (shade > 0) c.lerp(woodland, shade * 0.55).multiplyScalar(1 - 0.3 * shade)
      // the far shore and the valley's flanks, seen across the lake: wooded hillsides
      const lake = lakeShape(x, z)
      c.lerp(woodland, smoothstep(r, 1800, 2600) * smoothstep(lake, 1.03, 1.12) * (0.55 + 0.4 * fbm(x / 250 + 7, z / 250)))
      // a thin shore and the lake bed
      c.lerp(shore, 1 - smoothstep(lake, 1.0, 1.025))
      c.lerp(lakeBed, 1 - smoothstep(lake, 0.9, 1.0))
      return h
    },
    1 / SURFACES.sparseGrass.tile, // the grass photo repeats every 2 m
  )
  // steep ground is scrub and woods, not fields or lawn: fades the valley-floor colours off slopes
  const normal = geometry.attributes.normal
  const color = geometry.attributes.color
  const scrub = srgb(0x34432a)
  const c = new THREE.Color()
  for (let i = 0; i < normal.count; i++) {
    const steep = 1 - smoothstep(normal.getY(i), 0.78, 0.94)
    if (steep <= 0) continue
    c.fromBufferAttribute(color, i).lerp(scrub, steep * 0.8)
    color.setXYZ(i, c.r, c.g, c.b)
  }
  // how much of each vertex is farmland (the shader draws crop rows there) — and not steep or wooded
  const farm = new Float32Array(normal.count)
  const pos = geometry.attributes.position
  for (let i = 0; i < farm.length; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    farm[i] = farmland(x, z) * smoothstep(normal.getY(i), 0.9, 0.97) * (1 - smoothstep(forestDensity(x, z), 0.1, 0.4))
  }
  geometry.setAttribute('farm', new THREE.BufferAttribute(farm, 1))
  const grass = pbrMaps(SURFACES.sparseGrass)
  const terrain = new THREE.Mesh(
    geometry,
    groundDetail(
      outdoorMaterial(
        new THREE.MeshStandardMaterial({ vertexColors: true, map: grass.maps.map, normalMap: grass.maps.normalMap, roughness: 1 }),
      ),
    ),
  )
  grass.maps.roughnessMap.dispose() // the ground is fully rough; only colour detail and relief are used
  terrain.name = 'terrain'
  terrain.castShadow = true // hills shade the ground behind them (far shadow map)
  terrain.userData.ground = true // what the walking camera stands on, raycasts or not
  return { mesh: noRaycast(terrain), ready: grass.ready }
}

/** the ground level the meadow and bushes stand on near the pavilion */
export { GROUND }
