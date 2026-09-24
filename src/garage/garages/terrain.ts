import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { SURFACES, pbrMaps } from './kit'
import { fbm, noRaycast, noise, polarGrid, smoothstep } from './landform'
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
/** field colours: young rice, deep greens, stubble, bare earth, vegetable rows */
const CROPS = [0x7a9a3c, 0x456d28, 0xb3a45e, 0x7a6146, 0x93a84a, 0x5b7a30, 0xc2b36e, 0x8c7a52].map(srgb)

/** width of a field across the valley's grain, metres */
export const PARCEL = 55

/** how much of a point is farmland, 0–1: the valley floor in patches, away from the pavilion */
export function farmland(x: number, z: number): number {
  const r = Math.hypot(x, z)
  return smoothstep(r, 140, 260) * (1 - smoothstep(r, 2600, 3000)) * smoothstep(fbm(x / 350 - 5, z / 350 + 9, 2), 0.38, 0.5)
}

/** field coordinates: fields run along the valley (v), turned a little, PARCEL wide across it (u) */
export function parcelSpace(x: number, z: number): { u: number; v: number } {
  return { u: x * 0.956 + z * 0.292, v: -x * 0.292 + z * 0.956 }
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
 *  - crop rows in the fields (the `farm` attribute), running along each field
 *    with a pitch and a share of bare soil that differ field to field; they
 *    fade out where a row gets narrower than a pixel
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
        `#include <color_fragment>
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
            c = mix( c, straw, dry * 0.5 );
            c = mix( c, lush, wet * 0.65 );
            // tufts and bare scuffs, and a broad light/dark swell (mown and unmown, thin and thick sward)
            c *= ( 0.68 + 0.64 * fine ) * ( 0.8 + 0.4 * broad );
            // crop rows: along each field (the valley's grain), pitch and bare-soil share per field
            if ( vFarm > 0.01 ) {
              float u = p.x * 0.956 + p.y * 0.292;
              float v = -p.x * 0.292 + p.y * 0.956;
              float strip = floor( u / ${PARCEL.toFixed(1)} );
              float pick = gHash( vec2( strip, floor( v / 47.0 ) ) );
              float pitch = 0.75 + 1.1 * pick;
              float rows = u / pitch;
              float w = max( fwidth( rows ), 1e-5 );
              float row = 0.5 + 0.5 * cos( 6.2831853 * rows );
              row = mix( row, 0.5, smoothstep( 0.12, 0.35, w ) ); // before rows alias into bands
              float bare = step( 0.35, fract( pick * 7.31 ) ) * 0.75;
              vec3 soil = vec3( 0.075, 0.055, 0.038 );
              vec3 crop = c * ( 0.8 + 0.4 * row );
              vec3 field = mix( crop, soil, ( 1.0 - row ) * bare );
              c = mix( c, field, vFarm );
            }
            diffuseColor.rgb = mix( diffuseColor.rgb, c, near );
          }
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
export function createTerrain(): { mesh: THREE.Mesh; ready: Promise<void> } {
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
      // farmland on the valley floor: a patchwork of parcels — rice, vegetables, stubble, bare earth
      const farm = farmland(x, z)
      if (farm > 0) {
        const { u, v } = parcelSpace(x, z)
        const pu = Math.floor(u / PARCEL)
        const pv = Math.floor(v / (30 + 25 * noise(pu * 0.7, 3.1)))
        const pick = noise(pu * 1.37 + 0.5, pv * 2.11 + 0.5)
        const crop = CROPS[Math.min(CROPS.length - 1, Math.floor(pick * CROPS.length * 1.3) % CROPS.length)]
        // hedges and paths between parcels
        const edge = Math.min((u / PARCEL) % 1, 1 - ((u / PARCEL) % 1)) < 0.05 ? 0.6 : 1
        c.lerp(crop, farm * 0.85).multiplyScalar(1 - (1 - edge) * farm * 0.5)
      }
      // darker ground under woodland
      if (r > 60 && r < SITE.realRadius) c.lerp(woodland, smoothstep(forestDensity(x, z), 0.1, 0.6) * 0.7)
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
  return { mesh: noRaycast(terrain), ready: grass.ready }
}

/** the ground level the meadow and bushes stand on near the pavilion */
export { GROUND }
