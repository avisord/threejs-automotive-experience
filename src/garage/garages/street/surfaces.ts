import * as THREE from 'three'
import { SURFACES, pbrMaps } from '../kit'
import { outdoorMaterial } from '../terrain'

/**
 * The street's surfaces, drawn per pixel over three's standard material (no
 * UV layouts to author, nothing repeating house to house): the stone-sett
 * carriageway with its courses, fans at the junctions, gutter channel, wheel
 * polish, dirt, oil, repairs and tyre marks; flagstone pavements with cracks
 * and grime; granite kerbs; limewashed render that is mottled, bleached,
 * streaked, dirty at its foot and here and there fallen away; dressed stone;
 * painted and bare wood; clay tile roofs. Detail is box-filtered by the
 * pixel's footprint (a joint thinner than a pixel fades to its average, it
 * doesn't break into dashes) and bumps fade out with distance.
 */

const lin = (hex: string) => new THREE.Color(hex)

const COMMON = /* glsl */ `
varying vec3 vW;
varying vec3 vWN;
float sfH;
float sfRough;
float sfHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float sfNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( sfHash( i ), sfHash( i + vec2( 1, 0 ) ), u.x ), mix( sfHash( i + vec2( 0, 1 ) ), sfHash( i + 1.0 ), u.x ), u.y );
}
float sfFbm( vec2 p ) { float s = 0.0; float a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += a * sfNoise( p ); p = p * 2.03 + 17.1; a *= 0.5; } return s / 0.9375; }
// bump from a height field (m) by screen derivatives (three's perturbNormalArb)
vec3 sfBump( vec3 pos, vec3 n, float h ) {
  vec3 dx = dFdx( pos ); vec3 dy = dFdy( pos );
  vec3 r1 = cross( dy, n ); vec3 r2 = cross( n, dx );
  float det = dot( dx, r1 );
  vec2 dh = vec2( dFdx( h ), dFdy( h ) );
  vec3 g = sign( det ) * ( dh.x * r1 + dh.y * r2 );
  return normalize( abs( det ) * n - g );
}
`

/** the ground under the walls (site.groundTexture): a wall's height above its pavement */
const GROUND = /* glsl */ `
uniform sampler2D uGround;
uniform vec4 uGroundRect;
float sfAboveGround() { return vW.y - texture2D( uGround, ( vW.xz - uGroundRect.xy ) / uGroundRect.zw ).r; }
`

/**
 * Patch a standard material: the world position/normal (and extra varyings) in, a block of
 * GLSL after the colour stage that may set diffuseColor, sfRough (else the material's) and sfH
 * (a bump height, m).
 */
function surface<M extends THREE.MeshStandardMaterial>(
  material: M,
  key: string,
  opts: { head?: string; vertexHead?: string; vertex?: string; colour: string; uniforms?: Record<string, THREE.IUniform>; roughness?: 'replace' | 'scale' },
): M {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    Object.assign(shader.uniforms, opts.uniforms ?? {})
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vW;\nvarying vec3 vWN;\n${opts.vertexHead ?? ''}`)
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\nvWN = normalize( mat3( modelMatrix ) * objectNormal );\n${opts.vertex ?? ''}`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${COMMON}\n${opts.head ?? ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\nsfH = 0.0;\nsfRough = -1.0;\n{\n${opts.colour}\n}`)
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nif ( sfRough >= 0.0 ) roughnessFactor = ${opts.roughness === 'scale' ? 'clamp( sfRough * ( 0.6 + 0.8 * roughnessFactor ), 0.04, 1.0 )' : 'sfRough'};`,
      )
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif ( sfH != 0.0 ) normal = sfBump( - vViewPosition, normal, sfH );')
  }
  material.customProgramCacheKey = () => `street-surface-${key}`
  return material
}

// ─── the carriageway ─────────────────────────────────────────────────────
export interface RoadDetail {
  /** fans of setts round a junction: world x, z, radius */
  fans: THREE.Vector3[]
  /** tyre marks: arcs (centre x, z, radius, strength) and (start angle, end angle, 0, 0); pairs a track apart */
  marks: [THREE.Vector4, THREE.Vector4][]
  /** asphalt repairs: world boxes (centre x, z, half x, half z) */
  patches: THREE.Vector4[]
}

const FANS = 4
const MARKS = 10
const PATCHES = 4

/**
 * Stone setts in courses across the street (~34 cm courses, stones 0.2–0.6 m, some split,
 * rounded, of four kinds of stone, each tilted and polished its own way; wandering joints
 * filled with sand or soil), fanned round the junctions with a border course where a fan meets
 * the straight courses, a gutter channel of long stones along each kerb. Street
 * coordinates come in the `street` attribute: (s along, d across, half-width).
 */
export function roadMaterial(detail: RoadDetail): { material: THREE.MeshStandardMaterial; ready: Promise<void> } {
  const grit = pbrMaps(SURFACES.concreteFloor, [1 / 1.6, 1 / 1.6])
  const material = outdoorMaterial(
    new THREE.MeshStandardMaterial({ normalMap: grit.maps.normalMap, roughnessMap: grit.maps.roughnessMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1 }),
  )
  grit.maps.map.dispose()
  const pad = <T>(list: T[], n: number, empty: () => T) => [...list, ...Array.from({ length: Math.max(0, n - list.length) }, empty)].slice(0, n)
  const uniforms = {
    uFan: { value: pad(detail.fans, FANS, () => new THREE.Vector3(0, 0, 0)) },
    uMarkA: { value: pad(detail.marks.map((m) => m[0]), MARKS, () => new THREE.Vector4(0, 0, 0, 0)) },
    uMarkB: { value: pad(detail.marks.map((m) => m[1]), MARKS, () => new THREE.Vector4(0, 0, 0, 0)) },
    uPatch: { value: pad(detail.patches, PATCHES, () => new THREE.Vector4(0, 0, 0, 0)) },
    uStone: { value: lin('#a39a8c') },
    uJoint: { value: lin('#5a5349') },
    uAsphalt: { value: lin('#46433f') },
  }
  surface(material, 'road', {
    uniforms,
    vertexHead: 'attribute vec3 street;\nvarying vec3 vSD;',
    vertex: 'vSD = street;',
    head: `varying vec3 vSD;
      uniform vec3 uFan[ ${FANS} ];
      uniform vec4 uMarkA[ ${MARKS} ];
      uniform vec4 uMarkB[ ${MARKS} ];
      uniform vec4 uPatch[ ${PATCHES} ];
      uniform vec3 uStone;
      uniform vec3 uJoint;
      uniform vec3 uAsphalt;`,
    roughness: 'scale',
    colour: /* glsl */ `
      vec2 sd = vSD.xy;
      float hw = vSD.z;
      float ad = abs( sd.y );
      float px = max( length( fwidth( vW.xz ) ), 1e-4 );
      // the pattern's frame: q.x runs along a course (across the street), q.y across the courses
      vec2 q = vec2( sd.y, sd.x );
      float border = 1e3;
      bool fan = false;
      for ( int k = 0; k < ${FANS}; k ++ ) {
        vec3 f = uFan[ k ];
        if ( f.z <= 0.0 ) continue;
        float r = distance( vW.xz, f.xy );
        if ( r < f.z ) {
          q = vec2( atan( vW.z - f.y, vW.x - f.x ) * r, r );
          border = f.z - r;
          fan = true;
          break;
        }
      }
      // hand-laid setts: the joints wander at two scales, no course or stone runs dead straight
      q += vec2( sfNoise( q * 1.9 ), sfNoise( q.yx * 2.1 + 5.0 ) ) * 0.06 + vec2( sfNoise( q * 4.5 + 2.0 ), sfNoise( q.yx * 4.8 + 3.0 ) ) * 0.009;
      vec2 id;
      float e;
      // the stone's own offset from its centre (m), for its tilt
      vec2 fc = vec2( 0.0 );
      float gutterD = ad - ( hw - 0.36 );
      float P = 0.34;
      float L = 0.48;
      if ( gutterD > 0.0 && ! fan ) {
        // the gutter channel: a single course of long stones along the kerb
        float x = sd.x / 0.8;
        id = vec2( floor( x ), 500.0 + sign( sd.y ) );
        e = min( min( fract( x ), 1.0 - fract( x ) ) * 0.8, min( gutterD, 0.36 - gutterD ) );
        fc = vec2( ( fract( x ) - 0.5 ) * 0.8, gutterD - 0.18 );
        L = 0.8;
        P = 0.36;
      } else if ( fan && border < 0.32 ) {
        // the border course round a fan
        float x = q.x / 0.9;
        id = vec2( floor( x ), 700.0 );
        e = min( min( fract( x ), 1.0 - fract( x ) ) * 0.9, min( border, 0.32 - border ) );
        fc = vec2( ( fract( x ) - 0.5 ) * 0.9, border - 0.16 );
        L = 0.9;
        P = 0.32;
      } else {
        // courses ~34 cm; each course's stones its own length (0.4–0.6 m), some split in two unevenly
        float row = floor( q.y / P );
        float rh = sfHash( vec2( mod( row, 997.0 ), 7.0 ) );
        L = 0.4 + 0.2 * rh;
        float x = q.x / L + sfHash( vec2( mod( row, 991.0 ), 3.0 ) );
        float cell = floor( x );
        float fx = fract( x );
        float sh = sfHash( vec2( mod( cell, 997.0 ), mod( row, 991.0 ) + 0.5 ) );
        float a0 = 0.0;
        float a1 = 1.0;
        if ( sh > 0.55 ) {
          float cut = 0.35 + 0.3 * sfHash( vec2( mod( cell, 997.0 ) + 0.3, mod( row, 991.0 ) ) );
          if ( fx < cut ) a1 = cut; else a0 = cut;
          cell += fx < cut ? 0.0 : 0.5;
        }
        float fy = fract( q.y / P ) * P;
        float ex = min( fx - a0, a1 - fx ) * L;
        float ey = min( fy, P - fy );
        // rounded corners, each stone its own radius, and its edges pulled in unevenly (the joints vary)
        float rr = 0.05 + 0.05 * sh;
        ex -= 0.012 * sfHash( vec2( cell, row ) + 9.1 );
        ey -= 0.012 * sfHash( vec2( cell, row ) + 4.7 );
        e = min( ex, ey );
        if ( ex < rr && ey < rr ) e = rr - length( rr - vec2( ex, ey ) );
        id = vec2( cell * 2.0, row );
        fc = vec2( ( fx - ( a0 + a1 ) * 0.5 ) * L, fy - P * 0.5 );
      }
      vec2 hid = mod( id, 997.0 ) + 0.37;
      float h = sfHash( hid );
      float h2 = sfHash( hid + 5.1 );
      float h3 = sfHash( hid + 8.3 );
      // how much of a stone's own look survives at this distance (a stone under a few pixels fades to the
      // mean, or the frame shimmers)
      float near = 1.0 - smoothstep( 0.04, 0.18, px );
      // four kinds of stone, laid mixed: grey granite, warm limestone, dark basalt, a few pink
      vec3 kind = h2 < 0.52 ? vec3( 1.0 ) : h2 < 0.8 ? vec3( 1.05, 1.0, 0.9 ) : h2 < 0.93 ? vec3( 0.7, 0.68, 0.66 ) : vec3( 1.04, 0.96, 0.93 );
      // (far off, a little of each stone's own shade stays: an even grey there read as poured concrete)
      vec3 stone = uStone * mix( vec3( 0.96 ) * ( 0.93 + 0.14 * h ), kind * ( 0.86 + 0.28 * h ), near );
      // worn: the crown polished paler, the edges grubby; a fine speckle in the grain
      stone *= 1.0 + 0.05 * smoothstep( 0.0, 0.1, e ) * near;
      stone *= 1.0 - 0.1 * ( 1.0 - smoothstep( 0.0, 0.06, e ) ) * near;
      stone *= 1.0 + ( sfNoise( vW.xz * 90.0 ) - 0.5 ) * 0.18 * ( 1.0 - smoothstep( 0.004, 0.012, px ) );
      // mottling at the scale of a few metres (worn tracks, newer and older stone): the texture that
      // survives into the distance
      stone *= 0.86 + 0.28 * sfFbm( vW.xz * 0.12 );
      stone *= 0.9 + 0.2 * sfFbm( vW.xz * 0.6 + 13.0 );
      // relaid patches: a few metres of newer, more even, paler stone where the street was dug up
      vec2 rc = floor( vW.xz / 3.5 );
      float relaid = step( 0.965, sfHash( rc + 0.21 ) ) * step( 0.2, fract( vW.x / 3.5 ) ) * step( 0.25, fract( vW.z / 3.5 ) );
      stone = mix( stone, uStone * vec3( 1.12, 1.1, 1.06 ) * ( 0.95 + 0.1 * h ), relaid );
      // the joints, box-filtered: a joint narrower than the pixel fades to its share of the ground;
      // filled with sand in places, dark soil and grime in others
      float jw = 0.011 + 0.009 * sfNoise( q * 2.5 );
      // (filtered by how fast the distance to the joint changes across this pixel, not by the pixel's
      // footprint: at a grazing angle the footprint is long one way and short the other, and a fixed width
      // broke the joints across the view into dashes)
      float fw = max( fwidth( e ), 1e-5 );
      float joint = 1.0 - smoothstep( jw - fw, jw + fw, e );
      joint = mix( joint, clamp( 2.0 * jw / P + 2.0 * jw / L + 0.08, 0.0, 1.0 ), smoothstep( 0.5, 1.5, fw / jw ) );
      vec3 fill = mix( uJoint, vec3( 0.3, 0.26, 0.2 ), smoothstep( 0.35, 0.7, sfNoise( vW.xz * 1.7 ) ) );
      vec3 col = mix( stone, fill * ( 0.8 + 0.4 * sfNoise( vW.xz * 6.0 ) ), joint * 0.85 );
      // dust blown against the kerbs and in drifts, damp stains
      float dust = smoothstep( 0.55, 0.8, sfFbm( vW.xz * 0.45 + 21.0 ) ) * 0.35 + smoothstep( hw - 1.4, hw - 0.3, ad ) * 0.25;
      col = mix( col, vec3( 0.3, 0.27, 0.22 ), dust * ( 0.5 + 0.5 * sfNoise( vW.xz * 3.0 ) ) );
      col *= 1.0 - 0.12 * smoothstep( 0.66, 0.86, sfFbm( vW.xz * 0.22 + 5.0 ) );
      // wheel paths polished and a shade darker, an oil drip line between them, dirt in the gutters
      // lanes: one each way on a narrow street, two on the broad main street; the wheels run 0.8 m either
      // side of a lane's middle, oil drips down the middle
      float lanes = hw > 5.0 ? 2.0 : 1.0;
      float lane = hw / lanes;
      float inLane = mod( ad, lane ) - lane * 0.5;
      float wheel = exp( - pow( ( abs( inLane ) - 0.8 ) / 0.35, 2.0 ) );
      col *= 1.0 - 0.07 * wheel;
      float drip = exp( - pow( inLane / 0.22, 2.0 ) ) * smoothstep( 0.55, 0.85, sfNoise( vec2( sd.x * 0.8, sd.y * 3.0 ) ) );
      col *= 1.0 - 0.22 * drip;
      float gutter = smoothstep( hw - 1.0, hw - 0.05, ad );
      col = mix( col, col * vec3( 0.78, 0.73, 0.66 ), gutter * ( 0.5 + 0.5 * sfNoise( sd * 1.3 ) ) );
      col *= 1.0 - 0.13 * smoothstep( 0.62, 0.85, sfFbm( vW.xz * 0.35 + 11.0 ) );
      // each stone its own polish (the wheel paths the glossiest), dust and joints matt
      float rough = 0.7 + 0.2 * h3 * near - 0.14 * wheel + 0.15 * joint + 0.08 * gutter + 0.1 * dust;
      // asphalt repairs over a trench or a pothole: flat, dark, a tarred seam round the edge
      for ( int k = 0; k < ${PATCHES}; k ++ ) {
        vec4 pa = uPatch[ k ];
        if ( pa.z <= 0.0 ) continue;
        vec2 dd = abs( vW.xz - pa.xy ) - pa.zw;
        float inside = max( dd.x, dd.y );
        if ( inside < 0.0 ) {
          col = uAsphalt * ( 0.85 + 0.3 * sfNoise( vW.xz * 7.0 ) ) * ( 0.92 + 0.16 * sfFbm( vW.xz ) );
          col *= 1.0 - 0.35 * ( 1.0 - smoothstep( -0.07, -0.03, inside ) ) * smoothstep( -0.12, -0.07, inside );
          joint = 0.0;
          e = 1.0;
          rough = 0.86;
        }
      }
      // tyre marks: rubber laid in arcs (a pair a track apart), streaky and broken, fading at the ends
      float mark = 0.0;
      for ( int k = 0; k < ${MARKS}; k ++ ) {
        vec4 a = uMarkA[ k ];
        if ( a.w <= 0.0 ) continue;
        vec4 b = uMarkB[ k ];
        vec2 v = vW.xz - a.xy;
        float r = length( v );
        float t = mod( atan( v.y, v.x ) - b.x + 12.566371, 6.2831853 );
        float span = mod( b.y - b.x + 12.566371, 6.2831853 );
        if ( t > span ) continue;
        float along = t / span;
        float fade = smoothstep( 0.0, 0.18, along ) * smoothstep( 1.0, 0.7, along );
        for ( int w = 0; w < 2; w ++ ) {
          float R = a.z + float( w ) * 1.6;
          float band = 1.0 - smoothstep( 0.06, 0.11 + px, abs( r - R ) );
          float streak = 0.5 + 0.5 * sfNoise( vec2( t * R * 1.4, ( r - R ) * 45.0 ) );
          mark = max( mark, band * streak * fade * a.w );
        }
      }
      // (rubber greys the stone, it doesn't paint it black)
      col *= 1.0 - 0.55 * mark;
      rough -= 0.12 * mark;
      diffuseColor.rgb = col;
      sfRough = rough;
      // stones crowned a few millimetres, the joints sunk; faded out once the stones are a few pixels
      // each stone crowned, tilted a little its own way, a few sunk
      float tilt = dot( fc, vec2( h - 0.5, h3 - 0.5 ) ) * 0.06;
      float sunk = -0.006 * step( 0.9, sfHash( hid + 2.9 ) );
      // (no step down into the joint and no fine grain in the bump: derivatives come in 2×2 pixel blocks, and
      // a sharp drop there dotted every joint; the crown's roll down to the joint is smooth enough)
      // (tilt and sinking both reach zero at the stone's edge: a height that jumped from one stone to the next
      // across the joint dotted it the same way)
      float body = smoothstep( 0.0, 0.1, e );
      sfH = ( 0.014 + tilt + sunk ) * body * ( 1.0 - smoothstep( 0.01, 0.05, px ) );
    `,
  })
  return { material, ready: grit.ready }
}

// ─── pavements and kerbs ─────────────────────────────────────────────────
/** flagstones in running bond along the street, a few cracked, grimy at the wall and the kerb */
export function pavementMaterial(): THREE.MeshStandardMaterial {
  return surface(outdoorMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85 })), 'pavement', {
    uniforms: { uSlab: { value: lin('#b3aa9c') } },
    vertexHead: 'attribute vec3 street;\nvarying vec3 vSD;',
    vertex: 'vSD = street;',
    head: 'varying vec3 vSD;\nuniform vec3 uSlab;',
    colour: /* glsl */ `
      vec2 sd = vSD.xy;
      float hw = vSD.z;
      float walk = hw > 3.3 ? 2.2 : 1.6;
      float px = max( length( fwidth( vW.xz ) ), 1e-4 );
      // slabs 0.6 m along × 0.45 m across, each course offset half a slab
      float row = floor( sd.y / 0.45 );
      float x = sd.x / 0.6 + 0.5 * mod( row, 2.0 );
      vec2 f = vec2( fract( x ) * 0.6, fract( sd.y / 0.45 ) * 0.45 );
      vec2 id = mod( vec2( floor( x ), row ), 997.0 ) + 0.5;
      float e = min( min( f.x, 0.6 - f.x ), min( f.y, 0.45 - f.y ) );
      float h = sfHash( id );
      vec3 col = uSlab * ( 0.86 + 0.24 * h ) * mix( vec3( 1.0 ), vec3( 1.04, 1.0, 0.94 ), sfHash( id + 3.0 ) );
      col *= 0.9 + 0.2 * sfNoise( sd * 4.0 + h * 30.0 );
      float joint = 1.0 - smoothstep( 0.004 - px * 0.5, 0.004 + px * 0.5, e );
      joint = mix( joint, 0.03, smoothstep( 0.008, 0.03, px ) );
      col = mix( col, col * 0.45, joint );
      // a crack across one slab in a dozen
      if ( sfHash( id + 9.0 ) > 0.92 ) {
        float a = sfHash( id + 11.0 ) * 3.14159;
        float c = abs( dot( f - vec2( 0.3, 0.22 ), vec2( cos( a ), sin( a ) ) ) + ( sfNoise( f * 30.0 ) - 0.5 ) * 0.03 );
        col *= 1.0 - 0.5 * ( 1.0 - smoothstep( 0.0, 0.004 + px, c ) ) * min( 1.0, 0.01 / px );
      }
      // grime along the wall's foot and the kerb, gum spots, stains
      float t = clamp( ( abs( sd.y ) - hw ) / walk, 0.0, 1.0 );
      float grime = smoothstep( 0.7, 1.0, t ) * 0.8 + ( 1.0 - smoothstep( 0.0, 0.15, t ) ) * 0.4;
      col *= 1.0 - 0.28 * grime * ( 0.6 + 0.4 * sfNoise( sd * 3.0 ) );
      vec2 spot = floor( vW.xz / 0.35 );
      float gum = step( 0.985, sfHash( spot + 0.5 ) ) * ( 1.0 - smoothstep( 0.02, 0.035, distance( fract( vW.xz / 0.35 ), vec2( 0.5 ) ) * 0.35 ) );
      col *= 1.0 - 0.45 * gum;
      col *= 1.0 - 0.12 * smoothstep( 0.6, 0.85, sfFbm( vW.xz * 0.5 + 3.0 ) );
      diffuseColor.rgb = col;
      sfRough = 0.8 + 0.1 * h + 0.08 * grime;
      sfH = ( 0.0025 * smoothstep( 0.0, 0.03, e ) + 0.0005 * sfNoise( vW.xz * 35.0 ) ) * ( 1.0 - smoothstep( 0.006, 0.03, px ) );
    `,
  })
}

/** granite kerbstones, a metre long, speckled, their top arris worn and grubby */
export function kerbMaterial(): THREE.MeshStandardMaterial {
  return surface(outdoorMaterial(new THREE.MeshStandardMaterial({ roughness: 0.75 })), 'kerb', {
    uniforms: { uGranite: { value: lin('#b0aaa0') } },
    vertexHead: 'attribute vec3 street;\nvarying vec3 vSD;',
    vertex: 'vSD = street;',
    head: 'varying vec3 vSD;\nuniform vec3 uGranite;',
    colour: /* glsl */ `
      float px = max( length( fwidth( vW ) ), 1e-4 );
      float x = vSD.x / 1.0;
      float h = sfHash( vec2( mod( floor( x ), 997.0 ), 1.0 ) );
      vec3 n = normalize( vWN );
      vec2 w = abs( n.y ) > 0.7 ? vW.xz : vec2( vW.x * n.z - vW.z * n.x, vW.y );
      vec3 col = uGranite * ( 0.85 + 0.25 * h ) * ( 0.85 + 0.3 * sfNoise( w * 55.0 ) );
      float joint = 1.0 - smoothstep( 0.004, 0.004 + px, min( fract( x ), 1.0 - fract( x ) ) );
      col *= 1.0 - 0.5 * joint;
      // the road face dirtier toward the gutter
      col *= mix( 1.0, 0.8, ( 1.0 - abs( n.y ) ) * ( 0.6 + 0.4 * sfNoise( w * 3.0 ) ) );
      diffuseColor.rgb = col;
      sfRough = 0.68 + 0.15 * h;
      sfH = 0.0006 * sfNoise( w * 40.0 ) * ( 1.0 - smoothstep( 0.006, 0.03, px ) );
    `,
  })
}

// ─── walls ───────────────────────────────────────────────────────────────
const WALL_PLANE = /* glsl */ `
  vec3 n = normalize( vWN );
  float vert = 1.0 - smoothstep( 0.5, 0.8, abs( n.y ) );
  float u = vW.x * n.z - vW.z * n.x;
  vec2 w = abs( n.y ) > 0.7 ? vW.xz : vec2( u, vW.y );
  float px = max( length( fwidth( vW ) ), 1e-4 );
  float hg = sfAboveGround();
  // the wall's foot: splashed soil and damp, darker and browner under a ragged line
  float foot = ( 1.0 - smoothstep( 0.05, 0.5 + 0.35 * sfNoise( vec2( u * 2.3, 0.0 ) ), hg ) ) * vert;
`

/**
 * Limewashed render over the vertex paint: mottled, a slow tonal drift, bleached higher up,
 * patches of newer paint, rain streaks, a dirty damp foot, the odd hairline crack, and low
 * down here and there the render fallen away from the stone under it.
 */
export function plasterMaterial(ground: { texture: THREE.Texture; rect: THREE.Vector4 }): THREE.MeshStandardMaterial {
  return surface(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })), 'plaster', {
    uniforms: { uGround: { value: ground.texture }, uGroundRect: { value: ground.rect } },
    head: GROUND,
    colour: /* glsl */ `
      ${WALL_PLANE}
      vec3 col = diffuseColor.rgb;
      float m = sfFbm( w * 0.45 + 3.7 );
      col *= 0.9 + 0.18 * m;
      col *= 0.96 + 0.08 * sfNoise( w * 4.0 );
      float luma = dot( col, vec3( 0.3, 0.59, 0.11 ) );
      col = mix( col, vec3( luma ) * vec3( 1.05, 1.0, 0.93 ) * 1.08, 0.2 * smoothstep( 2.5, 9.0, hg ) * sfNoise( w * 0.2 ) * vert );
      // a patch of newer paint, a shade off
      vec2 cell = floor( w / vec2( 1.7, 1.1 ) );
      if ( sfHash( cell ) > 0.86 ) {
        vec2 fr = fract( w / vec2( 1.7, 1.1 ) );
        float inPatch = step( 0.1, fr.x ) * step( fr.x, 0.92 ) * step( 0.12, fr.y ) * step( fr.y, 0.88 );
        col *= mix( 1.0, 0.94 + 0.12 * sfHash( cell + 3.0 ), inPatch * vert );
      }
      float streak = smoothstep( 0.55, 0.95, sfNoise( vec2( u * 5.0, vW.y * 0.35 ) ) ) * sfNoise( w * 0.3 ) * vert;
      col *= 1.0 - 0.16 * streak;
      col = mix( col, col * vec3( 0.6, 0.55, 0.48 ), foot * 0.8 );
      float bare = smoothstep( 0.7, 0.77, sfFbm( w * 0.9 + 7.0 ) ) * ( 1.0 - smoothstep( 0.3, 1.5, hg ) ) * vert * step( 0.55, sfHash( floor( w / 6.0 ) ) );
      vec3 under = vec3( 0.3, 0.26, 0.21 ) * ( 0.7 + 0.6 * sfNoise( w * 9.0 ) );
      col = mix( col, under, bare );
      // a hairline crack now and then: the noise's mid contour, a pixel or so wide however steep the
      // noise is there (in noise units a fixed width came out as thick snaking bands), gone at a distance
      float cn = sfNoise( w * 1.3 + 9.0 );
      float crack = ( 1.0 - smoothstep( 0.0, 1.5 * fwidth( cn ), abs( cn - 0.5 ) ) ) * smoothstep( 0.8, 0.86, sfNoise( w * 0.25 + 4.0 ) ) * vert * ( 1.0 - smoothstep( 0.002, 0.006, px ) );
      col *= 1.0 - 0.35 * crack;
      diffuseColor.rgb = col;
      sfRough = 0.84 + 0.1 * m + 0.06 * foot;
      sfH = ( 0.0006 * sfNoise( w * 22.0 ) + 0.0015 * sfNoise( w * 3.0 ) - 0.004 * bare * sfNoise( w * 9.0 ) ) * ( 1.0 - smoothstep( 0.004, 0.02, px ) );
    `,
  })
}

/** dressed stone (cantera surrounds, sills, cornices, slabs, piers): fine speckle, soft mottling, grime low down */
export function stoneMaterial(ground: { texture: THREE.Texture; rect: THREE.Vector4 }): THREE.MeshStandardMaterial {
  return dressedStone(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })), ground)
}

/** the same dressing on any standard material (the church) */
export function dressedStone<M extends THREE.MeshStandardMaterial>(material: M, ground: { texture: THREE.Texture; rect: THREE.Vector4 }): M {
  return surface(material, 'stone', {
    uniforms: { uGround: { value: ground.texture }, uGroundRect: { value: ground.rect } },
    head: GROUND,
    colour: /* glsl */ `
      ${WALL_PLANE}
      vec3 col = diffuseColor.rgb;
      col *= 0.9 + 0.2 * sfFbm( w * 1.3 + 2.0 );
      col *= 0.93 + 0.14 * sfNoise( w * 45.0 );
      // horizontal faces (sills, slabs, copings) hold grime; the foot is splashed
      col *= 1.0 - 0.18 * smoothstep( 0.7, 0.95, n.y ) * sfNoise( w * 2.0 );
      col = mix( col, col * vec3( 0.62, 0.57, 0.5 ), foot * 0.7 );
      diffuseColor.rgb = col;
      sfRough = 0.78 + 0.12 * sfNoise( w * 6.0 );
      sfH = 0.0008 * sfNoise( w * 30.0 ) * ( 1.0 - smoothstep( 0.004, 0.02, px ) );
    `,
  })
}

/** painted or bare wood: grain up the boards, the paint scuffed at the foot */
export function woodMaterial(ground: { texture: THREE.Texture; rect: THREE.Vector4 }): THREE.MeshStandardMaterial {
  return surface(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })), 'wood', {
    uniforms: { uGround: { value: ground.texture }, uGroundRect: { value: ground.rect } },
    head: GROUND,
    colour: /* glsl */ `
      ${WALL_PLANE}
      float grain = 0.6 * sfNoise( vec2( u * 55.0, vW.y * 1.6 ) ) + 0.4 * sfNoise( vec2( u * 170.0, vW.y * 5.0 ) );
      vec3 col = diffuseColor.rgb * ( 0.86 + 0.24 * grain );
      col = mix( col, col * vec3( 0.7, 0.65, 0.58 ), foot * 0.6 );
      diffuseColor.rgb = col;
      sfRough = 0.5 + 0.3 * grain;
      sfH = 0.0004 * grain * ( 1.0 - smoothstep( 0.003, 0.012, px ) );
    `,
  })
}

/** the stone houses' rubble walls: photographed masonry in box uvs, grimy at the foot */
export function rubbleMaterial(ground: { texture: THREE.Texture; rect: THREE.Vector4 }): { material: THREE.MeshStandardMaterial; ready: Promise<void> } {
  const maps = pbrMaps({ dir: 'stone-wall' }, [0.45, 0.45])
  const material = surface(outdoorMaterial(new THREE.MeshStandardMaterial({ ...maps.maps, color: new THREE.Color(1.55, 1.45, 1.32) })), 'rubble', {
    uniforms: { uGround: { value: ground.texture }, uGroundRect: { value: ground.rect } },
    head: GROUND,
    colour: /* glsl */ `
      ${WALL_PLANE}
      diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.57, 0.5 ), foot * 0.7 );
    `,
  })
  return { material, ready: maps.ready }
}

/** clay barrel tiles in courses down the slope, each tile's crown catching the light, moss and soot in the channels */
export function tileRoofMaterial(): THREE.MeshStandardMaterial {
  return surface(outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })), 'tiles', {
    colour: /* glsl */ `
      vec3 n = normalize( vWN );
      vec2 hz = normalize( n.xz + 1e-5 );
      float u = vW.x * hz.y - vW.z * hz.x;
      float px = max( length( fwidth( vW ) ), 1e-4 );
      float across = u / 0.24;
      float course = vW.y / 0.14;
      float crown = 0.5 + 0.5 * cos( 6.2831853 * across );
      float lap = fract( course + 0.5 * step( 0.5, fract( across * 0.5 ) ) );
      float h = sfHash( vec2( floor( across ), floor( course ) ) );
      vec3 col = diffuseColor.rgb * ( 0.8 + 0.3 * h ) * ( 0.75 + 0.35 * crown );
      col *= 1.0 - 0.25 * smoothstep( 0.8, 1.0, lap );
      col = mix( col, vec3( 0.12, 0.13, 0.08 ), ( 1.0 - crown ) * 0.35 * smoothstep( 0.5, 0.8, sfFbm( vW.xz * 0.7 ) ) );
      diffuseColor.rgb = col;
      sfRough = 0.7 + 0.2 * h;
      sfH = ( 0.02 * crown - 0.01 * smoothstep( 0.8, 1.0, lap ) ) * ( 1.0 - smoothstep( 0.01, 0.05, px ) );
    `,
  })
}
