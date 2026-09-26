import * as THREE from 'three'

/**
 * The valley's farmland layout, the same in GLSL (the terrain's pixels) and in
 * TypeScript (hedgerows and tree lines along the boundaries, greenery.ts):
 *
 *  - districts: a warped Voronoi of ~380 m cells — each its own field
 *    orientation (mostly along the valley's grain, some turned across it),
 *    strip width and crop mix; their edges are the farm roads and ditches
 *  - strips across each district, of jittered width, cut into fields of
 *    different lengths, offset strip to strip (no grid lines run through)
 *  - a crop per field, drawn from its district's mix
 *
 * Integer hashes (PCG) so both sides agree exactly.
 */

/** Voronoi cell of the districts, metres */
export const DISTRICT = 380
/** the valley's grain: fields run along it (the angle of the old parcel strips) */
export const GRAIN = 0.297
/** how far the district pattern is bent, metres, and over what scale */
const WARP = { amount: 38, scale: 520 }

// ─── TypeScript ─────────────────────────────────────────────────────────────

function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0
  const word = Math.imul((state >>> ((state >>> 28) + 4)) ^ state, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
}
/** hash of up to three integers → [0, 1) (24 bits: exact in a float, so never 1) */
export function fHash(a: number, b = 0, c = 0): number {
  return (pcg((a | 0) + pcg((b | 0) + pcg(c | 0))) >>> 8) / 16777216
}
function vnoise(x: number, y: number, salt: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const u = x - xi
  const v = y - yi
  const sx = u * u * (3 - 2 * u)
  const sy = v * v * (3 - 2 * v)
  const a = fHash(xi, yi, salt)
  const b = fHash(xi + 1, yi, salt)
  const c = fHash(xi, yi + 1, salt)
  const d = fHash(xi + 1, yi + 1, salt)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** the district pattern is laid out in warped coordinates */
export function warp(x: number, z: number): [number, number] {
  const s = WARP.scale
  return [x + WARP.amount * (2 * vnoise(x / s, z / s, 11) - 1), z + WARP.amount * (2 * vnoise(x / s, z / s, 12) - 1)]
}

export interface District {
  /** cell */
  i: number
  j: number
  /** seed point, warped metres */
  sx: number
  sz: number
  angle: number
  /** strip width, metres */
  width: number
}

export function district(i: number, j: number): District {
  const turn = fHash(i, j, 3) < 0.22 ? Math.PI / 2 : 0
  return {
    i,
    j,
    sx: (i + 0.15 + 0.7 * fHash(i, j, 1)) * DISTRICT,
    sz: (j + 0.15 + 0.7 * fHash(i, j, 2)) * DISTRICT,
    angle: GRAIN + (fHash(i, j, 4) - 0.5) * 0.9 + turn,
    width: 26 + 52 * fHash(i, j, 5),
  }
}

/** the u of strip k's near boundary */
export function stripEdge(d: District, k: number): number {
  return (k + 0.36 * (fHash(d.i * 977 + k, d.j, 6) - 0.5)) * d.width
}

export interface FieldHit {
  district: District
  /** strip and field along it */
  k: number
  m: number
  /** distances to the strip's long edges, the field's short ends and the district edge, metres */
  edgeU: number
  edgeV: number
  edgeDistrict: number
}

/** which field a ground point lies in */
export function fieldAt(x: number, z: number): FieldHit {
  const [qx, qz] = warp(x, z)
  const ci = Math.floor(qx / DISTRICT)
  const cj = Math.floor(qz / DISTRICT)
  let best = Infinity
  let near = district(ci, cj)
  const cells: District[] = []
  for (let a = -1; a <= 1; a++)
    for (let b = -1; b <= 1; b++) {
      const d = district(ci + a, cj + b)
      cells.push(d)
      const dist = (qx - d.sx) ** 2 + (qz - d.sz) ** 2
      if (dist < best) {
        best = dist
        near = d
      }
    }
  let edgeDistrict = Infinity
  for (const d of cells) {
    if (d === near) continue
    const nx = d.sx - near.sx
    const nz = d.sz - near.sz
    const len = Math.hypot(nx, nz)
    edgeDistrict = Math.min(edgeDistrict, ((d.sx + near.sx) / 2 - qx) * (nx / len) + ((d.sz + near.sz) / 2 - qz) * (nz / len))
  }
  const { u, v } = local(near, qx, qz)
  const { k, u0, u1 } = strip(near, u)
  const { m, v0, v1 } = segment(near, k, v)
  return { district: near, k, m, edgeU: Math.min(u - u0, u1 - u), edgeV: Math.min(v - v0, v1 - v), edgeDistrict }
}

export function local(d: District, qx: number, qz: number): { u: number; v: number } {
  const c = Math.cos(d.angle)
  const s = Math.sin(d.angle)
  const dx = qx - d.sx
  const dz = qz - d.sz
  return { u: dx * c + dz * s, v: -dx * s + dz * c }
}

/** back from a district's (u, v) to the warped plane */
export function unlocal(d: District, u: number, v: number): [number, number] {
  const c = Math.cos(d.angle)
  const s = Math.sin(d.angle)
  return [d.sx + u * c - v * s, d.sz + u * s + v * c]
}

/** the ground point whose warped position is (qx, qz) — the warp is gentle, a few steps converge */
export function unwarp(qx: number, qz: number): [number, number] {
  let x = qx
  let z = qz
  for (let n = 0; n < 4; n++) {
    const [wx, wz] = warp(x, z)
    x += qx - wx
    z += qz - wz
  }
  return [x, z]
}

function strip(d: District, u: number): { k: number; u0: number; u1: number } {
  let k = Math.floor(u / d.width)
  if (u < stripEdge(d, k)) k--
  else if (u >= stripEdge(d, k + 1)) k++
  return { k, u0: stripEdge(d, k), u1: stripEdge(d, k + 1) }
}

/** fields along strip k: their length and offset differ strip to strip */
export function segmentLength(d: District, k: number): number {
  const h = fHash(d.i * 977 + k, d.j, 7)
  return d.width * (h < 0.25 ? 6 : 1.1 + 2.6 * h)
}

function segment(d: District, k: number, v: number): { m: number; v0: number; v1: number } {
  const L = segmentLength(d, k)
  const off = fHash(d.i * 977 + k, d.j, 8) * L
  const m = Math.floor((v - off) / L)
  return { m, v0: off + m * L, v1: off + (m + 1) * L }
}

/** what a strip's long boundary (at stripEdge(d, k)) is: 0 open verge, 1 track, 2 hedgerow, 3 tree line */
export function stripBoundary(d: District, k: number): number {
  const h = fHash(d.i * 977 + k, d.j, 9)
  return h < 0.12 ? 1 : h < 0.34 ? 2 : h < 0.42 ? 3 : 0
}

/** a district edge shared by cells a and b: 0 farm road, 1 ditch with a tree belt */
export function districtBoundary(a: District, b: District): number {
  const lo = a.i * 131 + a.j < b.i * 131 + b.j ? a : b
  const hi = lo === a ? b : a
  return fHash(lo.i * 7919 + hi.i, lo.j * 7919 + hi.j, 10) < 0.3 ? 1 : 0
}

// ─── GLSL ───────────────────────────────────────────────────────────────────

/**
 * `FieldHit fieldAt( vec2 p )` and helpers, the same layout as above. Needs
 * WebGL2 (uint arithmetic).
 */
export const FIELD_GLSL = /* glsl */ `
const float DISTRICT = ${DISTRICT.toFixed(1)};
const float GRAIN = ${GRAIN};
uint fPcg( uint v ) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ( ( state >> ( ( state >> 28u ) + 4u ) ) ^ state ) * 277803737u;
  return ( word >> 22u ) ^ word;
}
float fHash( int a, int b, int c ) {
  return float( fPcg( uint( a ) + fPcg( uint( b ) + fPcg( uint( c ) ) ) ) >> 8u ) / 16777216.0;
}
float fNoise( vec2 p, int salt ) {
  vec2 i = floor( p ); vec2 f = p - i; vec2 s = f * f * ( 3.0 - 2.0 * f );
  int x = int( i.x ); int y = int( i.y );
  float a = fHash( x, y, salt ), b = fHash( x + 1, y, salt ), c = fHash( x, y + 1, salt ), d = fHash( x + 1, y + 1, salt );
  return a + ( b - a ) * s.x + ( c - a ) * s.y + ( a - b - c + d ) * s.x * s.y;
}
struct District { ivec2 cell; vec2 seed; float angle; float width; };
District fDistrict( ivec2 c ) {
  District d;
  d.cell = c;
  d.seed = ( vec2( c ) + 0.15 + 0.7 * vec2( fHash( c.x, c.y, 1 ), fHash( c.x, c.y, 2 ) ) ) * DISTRICT;
  d.angle = GRAIN + ( fHash( c.x, c.y, 4 ) - 0.5 ) * 0.9 + ( fHash( c.x, c.y, 3 ) < 0.22 ? 1.5707963 : 0.0 );
  d.width = 26.0 + 52.0 * fHash( c.x, c.y, 5 );
  return d;
}
float fStripEdge( District d, int k ) {
  return ( float( k ) + 0.36 * ( fHash( d.cell.x * 977 + k, d.cell.y, 6 ) - 0.5 ) ) * d.width;
}
struct FieldHit {
  District district;
  District other;     // the neighbour across the nearest district edge
  int k; int m;
  float edgeU; float edgeV; float edgeDistrict;
  vec2 uv;            // position in the district's field frame, metres
  float stripWidth; float fieldLength;
};
FieldHit fieldAt( vec2 p ) {
  vec2 q = p + ${WARP.amount.toFixed(1)} * ( 2.0 * vec2( fNoise( p / ${WARP.scale.toFixed(1)}, 11 ), fNoise( p / ${WARP.scale.toFixed(1)}, 12 ) ) - 1.0 );
  ivec2 c = ivec2( floor( q / DISTRICT ) );
  FieldHit hit;
  // the nine candidate seeds once (only their positions: the full district just for the nearest)
  vec2 seeds[ 9 ];
  float best = 1e20;
  int near = 0;
  for ( int i = 0; i < 9; i ++ ) {
    ivec2 cc = c + ivec2( i % 3 - 1, i / 3 - 1 );
    seeds[ i ] = ( vec2( cc ) + 0.15 + 0.7 * vec2( fHash( cc.x, cc.y, 1 ), fHash( cc.x, cc.y, 2 ) ) ) * DISTRICT;
    vec2 e = q - seeds[ i ];
    float dist = dot( e, e );
    if ( dist < best ) { best = dist; near = i; }
  }
  ivec2 nearCell = c + ivec2( near % 3 - 1, near / 3 - 1 );
  hit.district = fDistrict( nearCell );
  District n = hit.district;
  hit.edgeDistrict = 1e20;
  ivec2 otherCell = nearCell;
  for ( int i = 0; i < 9; i ++ ) {
    if ( i == near ) continue;
    vec2 dir = normalize( seeds[ i ] - seeds[ near ] );
    float e = dot( ( seeds[ i ] + seeds[ near ] ) * 0.5 - q, dir );
    if ( e < hit.edgeDistrict ) { hit.edgeDistrict = e; otherCell = c + ivec2( i % 3 - 1, i / 3 - 1 ); }
  }
  hit.other = District( otherCell, vec2( 0.0 ), 0.0, 0.0 ); // (only its cell is used)
  float cs = cos( n.angle ), sn = sin( n.angle );
  vec2 e = q - n.seed;
  float u = e.x * cs + e.y * sn;
  float v = -e.x * sn + e.y * cs;
  int k = int( floor( u / n.width ) );
  if ( u < fStripEdge( n, k ) ) k --;
  else if ( u >= fStripEdge( n, k + 1 ) ) k ++;
  float u0 = fStripEdge( n, k ), u1 = fStripEdge( n, k + 1 );
  float hL = fHash( n.cell.x * 977 + k, n.cell.y, 7 );
  float L = n.width * ( hL < 0.25 ? 6.0 : 1.1 + 2.6 * hL );
  float off = fHash( n.cell.x * 977 + k, n.cell.y, 8 ) * L;
  int m = int( floor( ( v - off ) / L ) );
  float v0 = off + float( m ) * L;
  hit.k = k; hit.m = m;
  hit.edgeU = min( u - u0, u1 - u );
  hit.edgeV = min( v - v0, v0 + L - v );
  hit.uv = vec2( u, v );
  hit.stripWidth = u1 - u0;
  hit.fieldLength = L;
  return hit;
}
// which long boundary of the strip is nearer, and what it is: 0 verge, 1 track, 2 hedgerow, 3 tree line
int fStripBoundary( FieldHit h ) {
  int k = h.uv.x - fStripEdge( h.district, h.k ) < fStripEdge( h.district, h.k + 1 ) - h.uv.x ? h.k : h.k + 1;
  float x = fHash( h.district.cell.x * 977 + k, h.district.cell.y, 9 );
  return x < 0.12 ? 1 : x < 0.34 ? 2 : x < 0.42 ? 3 : 0;
}
// the nearest district edge: 0 farm road, 1 ditch with a tree belt
int fDistrictBoundary( FieldHit h ) {
  ivec2 a = h.district.cell, b = h.other.cell;
  bool aFirst = a.x * 131 + a.y < b.x * 131 + b.y;
  ivec2 lo = aFirst ? a : b, hi = aFirst ? b : a;
  return fHash( lo.x * 7919 + hi.x, lo.y * 7919 + hi.y, 10 ) < 0.3 ? 1 : 0;
}
`

/** crop colours (sRGB): what a field can be */
export const CROPS = {
  pasture: 0x6f8a3e,
  youngCrop: 0x93a04a,
  deepGreen: 0x4f6a30,
  hay: 0xa39a62,
  tilled: 0x6e5a40,
  stubble: 0x9d9068,
  greyGreen: 0x7d8760,
  rice: 0x7c9f3c,
}

/** the crop palette as linear colours, in CROPS order */
export function cropPalette(): THREE.Color[] {
  return Object.values(CROPS).map((hex) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace))
}

const glslColor = (c: THREE.Color) => `vec3( ${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)} )`
const lin = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)

/**
 * `vec3 fieldShade( vec3 ground, vec2 p, float mask, out float amount )`: the
 * ground colour at p (metres) with the farmland drawn over it where `mask` is
 * up (whole fields drop out as it falls, so farmland ends at a boundary).
 * Detail comes and goes with the pixel's footprint, never as noise:
 *  - near: crop rows, furrows and mowing stripes; verges, tracks, hedgerow
 *    bases, roads and ditches as antialiased lines
 *  - once a field is only a few pixels deep: its crop colour alone
 *  - once that's under a pixel: the district's crop mix
 *  - past that: the valley's mean
 * Include FIELD_GLSL first.
 */
export const FIELD_SHADE_GLSL = /* glsl */ `
const vec3 CROP[8] = vec3[8]( ${cropPalette().map(glslColor).join(', ')} );
const vec3 CROP_MEAN = ${glslColor(cropPalette().reduce((a, c) => a.add(c), new THREE.Color()).multiplyScalar(1 / 8))};
// coverage of a line w metres wide at distance d, for a pixel fp metres across: box-filtered, so a
// line thinner than a pixel fades to its share of it instead of breaking into dashes
float fLine( float d, float w, float fp ) {
  float we = max( w, fp );
  return ( 1.0 - smoothstep( 0.5 * ( we - fp ), 0.5 * ( we + fp ), d ) ) * ( w / we );
}
// a periodic pattern (0…1) faded to its mean once a period is under a few pixels
float fBands( float x, float period, float fp, float sharp ) {
  float s = 0.5 + 0.5 * cos( 6.2831853 * x / period );
  s = mix( s, smoothstep( 0.5 - sharp, 0.5 + sharp, s ), 0.5 );
  return mix( s, 0.5, smoothstep( 0.2, 0.45, fp / period ) );
}
vec3 fieldShade( vec3 ground, vec2 p, float mask, out float amount ) {
  amount = 0.0;
  if ( mask < 0.01 ) return ground;
  float fp = clamp( length( fwidth( p ) ), 1e-3, 1e4 ); // (a mirror pass's grazing pixels can blow up)
  FieldHit h = fieldAt( p );
  ivec2 dc = h.district.cell;
  int fx = dc.x * 977 + h.k, fy = dc.y * 613 + h.m;
  // the district's character: a main crop, a second, and the odd other
  int mainCrop = int( fHash( dc.x, dc.y, 22 ) * 8.0 );
  int second = int( fHash( dc.x, dc.y, 23 ) * 8.0 );
  float pick = fHash( fx, fy, 20 );
  float tint = fHash( fx, fy, 21 );
  int crop = pick < 0.42 ? mainCrop : pick < 0.7 ? second : int( tint * 7.99 );
  // pasture takes the land's own green, so it runs on into the meadows
  vec3 cropCol = crop == 0 ? mix( ground, CROP[0], 0.45 ) : CROP[crop];
  vec3 col = cropCol * ( 0.86 + 0.28 * tint );

  // ─── inside a field (meso): rows, furrows, mowing stripes, a slow swell ───
  float across = h.uv.x, along = h.uv.y;
  bool rowsAlong = fHash( fx, fy, 25 ) < 0.75;
  float rowX = rowsAlong ? across : along;
  float pitch = 0.7 + 1.6 * fHash( fx, fy, 26 );
  if ( crop == 1 || crop == 2 || crop == 7 ) {
    float r = fBands( rowX, pitch, fp, 0.25 );
    col *= 0.8 + 0.4 * r;
    col = mix( col, CROP[4] * 0.7, ( 1.0 - r ) * 0.35 * step( 0.5, fHash( fx, fy, 27 ) ) ); // soil between young rows
  } else if ( crop == 4 ) {
    col *= 0.78 + 0.44 * fBands( rowX, 0.9 + 0.6 * tint, fp, 0.35 ); // furrows
  } else if ( crop == 5 ) {
    col *= 0.9 + 0.2 * fBands( rowX, 3.0 + 3.0 * tint, fp, 0.1 ); // cut rows of stubble
  } else {
    col *= 0.93 + 0.14 * fBands( rowX, 4.0 + 5.0 * tint, fp, 0.45 ); // mowing stripes on grass and hay
  }
  // uneven growth: a slow swell, patches of thinner crop showing soil, a greener or drier margin
  float swell = fNoise( p / 60.0 + float( fx ), 30 );
  float patchy = fNoise( p / 17.0 - float( fy ), 31 );
  float mesoFade = smoothstep( 6.0, 25.0, fp );
  col *= mix( 0.88 + 0.24 * swell, 1.0, mesoFade );
  float thin = smoothstep( 0.62, 0.85, patchy ) * ( crop == 0 || crop == 3 ? 0.25 : 0.45 );
  col = mix( col, mix( CROP[4], ground, 0.3 ), thin * ( 1.0 - smoothstep( 3.0, 12.0, fp ) ) );
  float margin = 1.0 - smoothstep( 1.5, 7.0, min( h.edgeU, h.edgeV ) );
  col = mix( col, mix( ground, col, 0.5 ), margin * 0.5 * ( 1.0 - smoothstep( 2.0, 8.0, fp ) ) );
  // the valley's fields share a light: not flat paint swatches next to each other
  const vec3 LUMA = vec3( 0.2126, 0.7152, 0.0722 );
  col = mix( col, ground * clamp( dot( col, LUMA ) / max( dot( ground, LUMA ), 1e-3 ), 0.5, 2.0 ), 0.2 );

  // ─── boundaries: verges, tracks, hedgerow and tree-line bases, farm roads and ditches ───
  int kind = fStripBoundary( h );
  vec3 verge = ground * vec3( 0.82, 0.95, 0.72 );
  float edge = min( h.edgeU, h.edgeV );
  col = mix( col, verge, fLine( edge, 1.8, fp ) * 0.8 );
  if ( kind == 1 ) col = mix( col, ${glslColor(lin(0x9a8766))}, fLine( h.edgeU, 3.2, fp ) * 0.85 );
  else if ( kind >= 2 ) col = mix( col, ${glslColor(lin(0x33452a))}, fLine( h.edgeU, kind == 3 ? 5.0 : 3.5, fp ) * 0.7 );
  if ( fDistrictBoundary( h ) == 0 ) {
    col = mix( col, verge, fLine( h.edgeDistrict, 8.0, fp ) * 0.6 );
    col = mix( col, ${glslColor(lin(0x8f8a78))}, fLine( h.edgeDistrict, 3.2, fp ) * 0.75 );
  } else {
    col = mix( col, ${glslColor(lin(0x3a4c2c))}, fLine( h.edgeDistrict, 6.0, fp ) * 0.55 );
    col = mix( col, ${glslColor(lin(0x283530))}, fLine( h.edgeDistrict, 1.6, fp ) * 0.7 );
  }

  // ─── far: a field's colour gives way to its district's mix, then to the valley's ───
  vec3 districtCol = CROP[mainCrop] * 0.42 + CROP[second] * 0.28 + CROP_MEAN * 0.3;
  districtCol = mix( districtCol, ground, 0.2 );
  float size = min( h.stripWidth, h.fieldLength );
  col = mix( col, districtCol, smoothstep( 0.45 * size, 1.3 * size, fp ) );
  col = mix( col, mix( CROP_MEAN, ground, 0.4 ), smoothstep( 0.35 * DISTRICT, DISTRICT, fp ) );

  // farmland ends field by field where the mask falls; far off, where fields are sub-pixel, it fades
  float on = step( 0.1 + 0.8 * fHash( fx, fy, 24 ), mask );
  amount = mix( on, mask, smoothstep( 0.45 * size, 1.3 * size, fp ) );
  return mix( ground, col, amount );
}
`
