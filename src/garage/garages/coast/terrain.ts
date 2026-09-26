import * as THREE from 'three'
import { pbrMaps, type PbrMaps } from '../kit'
import { fbm, noRaycast, polarGrid, smoothstep } from '../landform'
import { outdoorMaterial } from '../terrain'
import { COAST, SEA, SURF, SURF_GLSL, beachness, cliffness, onRoad, heightAt, shore, shoreTexture, woodedness } from './site'

/** the coast's photographed surfaces (Poly Haven, CC0): `tile` = metres one copy covers */
export const COAST_SURFACES = {
  /** layered sedimentary rock face — Poly Haven "Cliff Side" */
  cliff: { dir: 'coast-cliff', tile: 6 },
  /** fine wet-and-dry beach sand — Poly Haven "Coast Sand 05" (used for its detail; the colour is ours) */
  sand: { dir: 'coast-sand', tile: 3 },
  /** short grass over soil — Poly Haven "Sparse Grass" */
  grass: { dir: 'sparse-grass', tile: 2 },
  /** a palm trunk's bark — Poly Haven "Palm Tree Bark" */
  palmBark: { dir: 'palm-bark', tile: 1 },
  /** dark stained timber — Poly Haven "Dark Wood" */
  darkWood: { dir: 'dark-wood', tile: 2 },
  /** rough natural stone — Poly Haven "Rock Wall 02" */
  stoneWall: { dir: 'stone-wall', tile: 3 },
} as const

/** mean linear luminances of the photographed maps — their detail is taken relative to it */
const MEAN = { grass: 0.0357, sand: 0.03, cliff: 0.12 }

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)

/** the terrain's grid: fine close in (the slope, the cove), coarser toward 4 km */
export const COAST_GRID = { rings: 380, segments: 1024, spacing: (t: number) => t * t }

/**
 * The shading every coast ground surface shares, per pixel in world metres:
 *  - rock where the ground is steep, or along a rocky shore: the cliff photo
 *    projected from the side (triplanar on x and z, so its strata lie level)
 *  - sand on the beaches: pale and dry up the beach, darker and glossy where
 *    the waves reach; the uprush's thin sheet of water and its lace of foam
 *    run up and drain back in step with the surf (site.SURF_GLSL)
 *  - elsewhere the vertex colours (grass, scrub, soil) with the grass photo's
 *    light and dark as detail, and broad patches so it isn't one flat green
 */
function coastGround<M extends THREE.MeshStandardMaterial>(
  material: M,
  maps: { grass: PbrMaps; sand: PbrMaps; cliff: PbrMaps },
): M {
  const shoreField = shoreTexture()
  const uniforms = {
    uShore: { value: shoreField.texture },
    uShoreRect: { value: shoreField.rect },
    uSurfTime: SURF.time,
    uSea: { value: SEA },
    uGrassMap: { value: maps.grass.maps.map },
    uGrassNormal: { value: maps.grass.maps.normalMap },
    uSandMap: { value: maps.sand.maps.map },
    uSandNormal: { value: maps.sand.maps.normalMap },
    uCliffMap: { value: maps.cliff.maps.map },
    uCliffNormal: { value: maps.cliff.maps.normalMap },
    uCliffRough: { value: maps.cliff.maps.roughnessMap },
  }
  const base = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 coast;\nvarying vec3 vCoast;\nvarying vec3 vGround;\nvarying vec3 vGroundNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvCoast = coast;\nvGround = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\nvGroundNormal = normalize( mat3( modelMatrix ) * objectNormal );',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vCoast; // x: rockiness of the shore, y: woodedness, z: road
        varying vec3 vGround;
        varying vec3 vGroundNormal;
        uniform sampler2D uShore;
        uniform vec4 uShoreRect;
        uniform float uSea;
        uniform sampler2D uGrassMap;
        uniform sampler2D uGrassNormal;
        uniform sampler2D uSandMap;
        uniform sampler2D uSandNormal;
        uniform sampler2D uCliffMap;
        uniform sampler2D uCliffNormal;
        uniform sampler2D uCliffRough;
        ${SURF_GLSL}
        const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
        float gDetail( vec2 p, float scale ) {
          vec2 q = p / scale;
          float px = max( length( fwidth( q ) ), 1e-5 );
          return mix( surfNoise( q ), 0.5, smoothstep( 0.25, 0.6, px ) );
        }
        // how much of each surface, and the wet film of the uprush — shared by colour, normal and roughness
        float gRock; float gSand; float gWet; float gFilm; float gFoam;
        vec3 gTri; // triplanar weights for the rock (x-facing, z-facing, up)
        `,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 p = vGround;
          vec3 n = normalize( vGroundNormal );
          vec2 sh = texture2D( uShore, ( p.xz - uShoreRect.xy ) * uShoreRect.zw ).rg;
          float s = sh.r + ( gDetail( p.xz + 13.0, 6.0 ) - 0.5 ) * 3.0;
          float beach = sh.g;
          float dist = length( p - cameraPosition );
          // rock: steep ground, and the rocky shore's first metres above the water
          // (inland, only the steepest ground is bare rock — steep hillsides are scrub; at the shore the faces are rock)
          float atShore = 1.0 - smoothstep( 25.0, 70.0, s );
          float steep = 1.0 - smoothstep( mix( 0.42, 0.55, atShore ), mix( 0.6, 0.8, atShore ), n.y );
          float shoreRock = vCoast.x * ( 1.0 - smoothstep( 4.0, 22.0, s ) ) * ( 1.0 - beach );
          gRock = clamp( max( steep, shoreRock ) + ( gDetail( p.xz, 9.0 ) - 0.5 ) * 0.5 * steep, 0.0, 1.0 );
          gRock *= 1.0 - vCoast.z; // (not on the road)
          // sand: the beach, fading into the scrub behind it
          gSand = beach * ( 1.0 - smoothstep( 35.0, 75.0, s ) ) * ( 1.0 - gRock );
          // the water's reach: wet sand below the highest uprush, the moving film and its foam
          float reach = uprush( p.xz );
          float above = p.y - uSea;
          gWet = ( 1.0 - smoothstep( 6.5, 9.0, s ) ) * step( -0.5, s );
          gFilm = ( 1.0 - smoothstep( reach - 0.8, reach, s ) ) * step( -0.5, s ) * gSand;
          float lace = smoothstep( 0.45, 0.75, surfNoise( p.xz * 1.3 ) * 0.6 + surfNoise( p.xz * 4.1 ) * 0.4 );
          gFoam = gFilm * ( smoothstep( reach - 1.3, reach - 0.2, s ) * 0.9 + lace * 0.35 );
          // triplanar weights for the rock
          vec3 a = pow( abs( n ), vec3( 4.0 ) );
          gTri = a / ( a.x + a.y + a.z );
          // ─── colour ───
          vec3 c = diffuseColor.rgb;
          #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
            c *= vColor.rgb;
          #endif
          // the grass photo's light and dark (two scales, so its 2 m tile doesn't show)
          vec3 gTex = texture2D( uGrassMap, p.xz / 2.0 ).rgb;
          vec3 gTex2 = texture2D( uGrassMap, p.xz / 8.6 + 0.37 ).rgb;
          float detail = mix( dot( gTex, LUMA ), dot( gTex2, LUMA ), 0.35 ) / ${MEAN.grass};
          c *= mix( 1.0, clamp( detail, 0.0, 2.5 ), 1.0 - smoothstep( 60.0, 400.0, dist ) );
          // broad patches: sun-dried grass on the open ground, deeper green in the hollows
          float near = 1.0 - smoothstep( 600.0, 1500.0, dist );
          float broad = gDetail( p.xz - 71.0, 60.0 );
          float big = gDetail( p.xz + 31.0, 17.0 );
          float lum = dot( c, LUMA );
          c = mix( c, lum * vec3( 1.7, 1.45, 0.8 ), smoothstep( 0.5, 0.7, broad * 0.5 + big * 0.5 ) * 0.45 * near * ( 1.0 - vCoast.y ) );
          c *= mix( 1.0, 0.8 + 0.4 * gDetail( p.xz + 5.0, 3.0 ), near );
          // sand: warm and pale, its photo for grain; darker where wet
          float sandDetail = dot( texture2D( uSandMap, p.xz / 3.0 ).rgb, LUMA ) / ${MEAN.sand};
          vec3 sand = vec3( 0.62, 0.52, 0.36 ) * mix( 1.0, clamp( sandDetail, 0.4, 1.8 ), 0.5 );
          sand *= 0.92 + 0.16 * gDetail( p.xz, 11.0 );
          sand = mix( sand, sand * vec3( 0.45, 0.43, 0.42 ), gWet );
          // rock: the cliff photo from the side (strata level), from above on ledges; warm grey-beige
          vec3 rx = texture2D( uCliffMap, p.zy / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).rgb;
          vec3 rz = texture2D( uCliffMap, p.xy / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).rgb;
          vec3 ry = texture2D( uCliffMap, p.xz / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).rgb;
          vec3 rock = rx * gTri.x + rz * gTri.z + ry * gTri.y;
          float rl = dot( rock, LUMA );
          // (the photo is a rust-orange sandstone: kept a little of its warmth, mostly grey)
          rock = mix( vec3( rl ), rock, 0.35 ) * vec3( 1.05, 0.98, 0.9 ) * 2.3;
          // lichen and dark streaks down the face, wet dark rock at the waterline
          rock *= 0.75 + 0.5 * gDetail( vec2( p.x + p.z, p.y * 0.25 ), 4.0 );
          rock = mix( rock, rock * 0.35, ( 1.0 - smoothstep( 0.5, 3.0, above ) ) );
          c = mix( c, sand, gSand );
          c = mix( c, rock, gRock );
          // the uprush: a thin sheet of water over the sand, foam at its front
          c = mix( c, c * vec3( 0.55, 0.62, 0.62 ), gFilm * 0.7 );
          c = mix( c, vec3( 0.8, 0.82, 0.82 ), gFoam );
          diffuseColor.rgb = max( c, 0.0 );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        '// (vertex colours applied with the rest of the ground, map_fragment)',
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
        {
          vec3 p = vGround;
          float rr = texture2D( uCliffRough, p.zy / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).g * gTri.x + texture2D( uCliffRough, p.xy / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).g * gTri.z + texture2D( uCliffRough, p.xz / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).g * gTri.y;
          roughnessFactor = mix( roughnessFactor, rr, gRock );
          roughnessFactor = mix( roughnessFactor, mix( 0.95, 0.4, gWet ), gSand );
          roughnessFactor = mix( roughnessFactor, 0.08, gFilm * ( 1.0 - gFoam ) );
          roughnessFactor = mix( roughnessFactor, 0.35, gRock * ( 1.0 - smoothstep( 0.3, 2.5, p.y - uSea ) ) );
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          // detail normals in world space, turned into the view's
          vec3 p = vGround;
          vec3 n = normalize( vGroundNormal );
          float dist = length( p - cameraPosition );
          float fade = 1.0 - smoothstep( 40.0, 500.0, dist );
          vec3 gN = texture2D( uGrassNormal, p.xz / 2.0 ).xyz * 2.0 - 1.0;
          vec3 sN = texture2D( uSandNormal, p.xz / 3.0 ).xyz * 2.0 - 1.0;
          vec3 flat_ = normalize( mix( gN, sN, gSand ) * vec3( 0.7, 0.7, 1.0 ) );
          vec3 up = normalize( n + vec3( flat_.x, 0.0, -flat_.y ) * fade * ( 1.0 - gFilm ) );
          // the rock: whiteout-blended triplanar normals
          vec3 nx = texture2D( uCliffNormal, p.zy / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).xyz * 2.0 - 1.0;
          vec3 nz = texture2D( uCliffNormal, p.xy / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).xyz * 2.0 - 1.0;
          vec3 ny = texture2D( uCliffNormal, p.xz / ${COAST_SURFACES.cliff.tile.toFixed(1)} ).xyz * 2.0 - 1.0;
          float rf = 1.0 - smoothstep( 150.0, 900.0, dist );
          vec3 wx = vec3( 0.0, nx.y, nx.x ) * sign( n.x );
          vec3 wz = vec3( nz.x, nz.y, 0.0 ) * sign( n.z );
          vec3 wy = vec3( ny.x, 0.0, ny.y );
          vec3 rockN = normalize( n + ( wx * gTri.x + wz * gTri.z + wy * gTri.y ) * 1.2 * rf );
          vec3 wn = normalize( mix( up, rockN, gRock ) );
          normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
        }`,
      )
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `coast-ground|${key()}`
  return material
}

/**
 * The real-scale land: the garage's terrace, the planted slope below the
 * glass, the cove and the rocky shore, the hillsides with the coast road,
 * out to 4 km — and the seabed close in, under the sea (the waterline is
 * where the two meet).
 */
export function createCoastTerrain(cliff: PbrMaps, cover: (x: number, z: number) => number = () => 0): { mesh: THREE.Mesh; ready: Promise<void> } {
  const grassC = srgb(0x5d7c32)
  const lush = srgb(0x44692a)
  const dry = srgb(0x8e8c50)
  const soil = srgb(0x7c5c40)
  const scrub = srgb(0x3e4a2a)
  const woods = srgb(0x2e4424)
  const verge = srgb(0x8a8270)
  const seabed = srgb(0x8a7a5a)
  const t0 = performance.now()
  const rocky = new Float32Array(1 + COAST_GRID.rings * COAST_GRID.segments)
  const wooded = new Float32Array(rocky.length)
  const road = new Float32Array(rocky.length)
  let k = 0
  const geometry = polarGrid(COAST.realRadius, COAST_GRID.rings, COAST_GRID.segments, COAST_GRID.spacing, (x, z, _t, _a, c) => {
    const h = heightAt(x, z)
    const s = shore(x, z)
    const r = Math.hypot(x, z)
    if (s < -2) {
      c.copy(seabed)
    } else {
      // grass, sun-dried on the open slopes, lush in the hollows; bare soil in patches
      c.copy(grassC).lerp(dry, smoothstep(fbm(x / 70, z / 70), 0.45, 0.72) * 0.8)
      c.lerp(lush, smoothstep(fbm(x / 40 + 9, z / 40), 0.55, 0.75) * 0.6)
      c.lerp(soil, smoothstep(fbm(x / 22 + 40, z / 22), 0.62, 0.76) * 0.7 * smoothstep(r, 25, 50))
      // the terrace lawn: mown and even
      c.lerp(srgb(0x587a2c), 1 - smoothstep(r, 20, 40))
      // scrub and woods on the hillsides
      const w = woodedness(x, z)
      c.lerp(scrub, smoothstep(w, 0.1, 0.5) * 0.6)
      const shade = cover(x, z)
      if (shade > 0) c.lerp(woods, shade * 0.6).multiplyScalar(1 - 0.25 * shade)
      // a dusty verge along the road
      const rd = onRoad(x, z)
      c.lerp(verge, smoothstep(rd, 0.05, 0.5) * 0.8)
      wooded[k] = w
      road[k] = smoothstep(rd, 0.3, 0.9)
    }
    rocky[k] = s < 60 ? cliffness(x, z) : 0
    k++
    return h
  })
  // steep ground is rock and scrub, not lawn: the colours darken off slopes (the shader draws the rock)
  const normal = geometry.attributes.normal
  const color = geometry.attributes.color
  const c = new THREE.Color()
  for (let i = 0; i < normal.count; i++) {
    const steep = 1 - smoothstep(normal.getY(i), 0.7, 0.9)
    if (steep <= 0) continue
    c.fromBufferAttribute(color, i).lerp(scrub, steep * 0.7)
    color.setXYZ(i, c.r, c.g, c.b)
  }
  const coast = new Float32Array(rocky.length * 3)
  for (let i = 0; i < rocky.length; i++) {
    coast[i * 3] = rocky[i]
    coast[i * 3 + 1] = wooded[i]
    coast[i * 3 + 2] = road[i]
  }
  geometry.setAttribute('coast', new THREE.BufferAttribute(coast, 3))
  const maps = { grass: pbrMaps(COAST_SURFACES.grass), sand: pbrMaps(COAST_SURFACES.sand), cliff }
  maps.grass.maps.roughnessMap.dispose()
  maps.sand.maps.roughnessMap.dispose()
  const material = coastGround(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 })), maps)
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'coast-terrain'
  mesh.castShadow = true
  mesh.receiveShadow = true
  console.info(`[garage] coast terrain: ${normal.count} vertices in ${Math.round(performance.now() - t0)} ms`)
  return { mesh: noRaycast(mesh), ready: Promise.all([maps.grass.ready, maps.sand.ready]).then(() => {}) }
}

export { beachness }
