import * as THREE from 'three'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PbrMaps } from '../kit'
import { noRaycast, seeded, smoothstep } from '../landform'
import { outdoorMaterial } from '../terrain'
import { ISLANDS, SEA, beachness, cliffness, heightAt, onRoad, shore } from './site'
import { COAST_SURFACES } from './terrain'

/**
 * The coast's rock, as instanced meshes over the terrain's own rock faces:
 *  - sea stacks standing off the points (the small ISLANDS in site.ts — they
 *    are in the shore mask, so the surf breaks round them)
 *  - great slabs along the cliff faces, turned to the sea and sunk into the
 *    slope, breaking the terrain's smooth face into ledges and buttresses
 *  - boulders heaped along the rocky shore, clustered, fewer on the sand
 *  - outcrops on the steeper hillsides inland
 *
 * Six rock archetypes, each a displaced icosphere with facets chipped off it
 * and its layers stepped (the coast is sedimentary: strata, not blobs), at
 * two levels of detail; every instance its own size, squash and turn, so no
 * two read as copies. Shaded with the cliff photo projected from the sides,
 * darker and wet near the water, greened on its tops where soil and moss
 * collect.
 */

// ─── the archetypes ─────────────────────────────────────────────────────────

function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const f = (t: number) => t * t * (3 - 2 * t)
  const u = f(x - xi)
  const v = f(y - yi)
  const w = f(z - zi)
  let sum = 0
  for (let k = 0; k < 8; k++) {
    const dx = k & 1
    const dy = (k >> 1) & 1
    const dz = (k >> 2) & 1
    sum += hash3(xi + dx, yi + dy, zi + dz) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w)
  }
  return sum
}
const fbm3 = (x: number, y: number, z: number) => (noise3(x, y, z) * 0.55 + noise3(x * 2.1 + 5, y * 2.1, z * 2.1) * 0.3 + noise3(x * 4.3, y * 4.3 + 9, z * 4.3) * 0.15)

interface RockShape {
  /** squash: x, y, z of the unit rock */
  scale: [number, number, number]
  /** chipped faces: how many, and how deep they cut (0 = none) */
  chips: number
  cut: number
  /** height of each layer of the strata (unit rock), and how strongly they step */
  layer: number
  steps: number
  seed: number
}

/** a block, a slab, a tall stack, a rounded boulder, a broken wedge, a stepped ledge */
const SHAPES: RockShape[] = [
  { scale: [1, 0.8, 0.9], chips: 7, cut: 0.72, layer: 0.28, steps: 0.6, seed: 11 },
  { scale: [1.4, 0.45, 1], chips: 5, cut: 0.7, layer: 0.18, steps: 0.8, seed: 23 },
  { scale: [0.7, 1.5, 0.75], chips: 8, cut: 0.75, layer: 0.33, steps: 0.7, seed: 37 },
  { scale: [1, 0.75, 1], chips: 3, cut: 0.85, layer: 0.5, steps: 0.2, seed: 41 },
  { scale: [1.2, 0.9, 0.7], chips: 9, cut: 0.62, layer: 0.25, steps: 0.5, seed: 59 },
  { scale: [1.3, 0.6, 1.2], chips: 6, cut: 0.7, layer: 0.15, steps: 1, seed: 67 },
]

function rockGeometry(shape: RockShape, detail: number): THREE.BufferGeometry {
  const rand = seeded(shape.seed)
  const planes = Array.from({ length: shape.chips }, () => {
    const n = new THREE.Vector3(rand() - 0.5, (rand() - 0.5) * 1.2, rand() - 0.5).normalize()
    return { n, d: shape.cut + rand() * 0.18 }
  })
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail)
  g.deleteAttribute('normal')
  g.deleteAttribute('uv')
  g = mergeVertices(g)
  const pos = g.attributes.position
  const p = new THREE.Vector3()
  const o = shape.seed * 3.7
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize()
    let r = 1 + (fbm3(p.x * 1.4 + o, p.y * 1.4, p.z * 1.4) - 0.5) * 0.55 + (noise3(p.x * 5 + o, p.y * 5, p.z * 5) - 0.5) * 0.08
    // chipped faces: a flat cut wherever the rock pokes past a plane
    for (const { n, d } of planes) {
      const along = p.dot(n) * r
      if (along > d) r *= d / along
    }
    p.multiplyScalar(r)
    // the strata: heights snapped toward layer boundaries, so the sides step in and out in ledges
    const y = p.y / shape.layer
    const snapped = (Math.floor(y) + smoothstep(y - Math.floor(y), 0.45, 1)) * shape.layer
    const k = shape.steps * (0.5 + 0.5 * noise3(p.x * 2 + o, 0, p.z * 2))
    const inset = 1 - 0.07 * shape.steps * smoothstep(y - Math.floor(y), 0.6, 1)
    p.set(p.x * inset, THREE.MathUtils.lerp(p.y, snapped, k * 0.5), p.z * inset)
    // a flat base, so it sits on the ground
    if (p.y < -0.55) p.y = -0.55 + (p.y + 0.55) * 0.3
    pos.setXYZ(i, p.x * shape.scale[0], p.y * shape.scale[1], p.z * shape.scale[2])
  }
  g.computeVertexNormals()
  g.computeBoundingSphere()
  return g
}

// ─── the material ───────────────────────────────────────────────────────────

/** triplanar cliff rock in world metres, wet and dark at the waterline, mossy on its tops */
export function rockMaterial(cliff: PbrMaps): THREE.MeshStandardMaterial {
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }))
  const uniforms = {
    uCliffMap: { value: cliff.maps.map },
    uCliffNormal: { value: cliff.maps.normalMap },
    uCliffRough: { value: cliff.maps.roughnessMap },
    uSea: { value: SEA },
  }
  const tile = COAST_SURFACES.cliff.tile.toFixed(1)
  const base = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockWorld;\nvarying vec3 vRockNormal;')
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vRockWorld = ( modelMatrix * wp ).xyz;
          vec3 on = objectNormal;
          #ifdef USE_INSTANCING
            on = mat3( instanceMatrix ) * on;
          #endif
          vRockNormal = normalize( mat3( modelMatrix ) * on );
        }`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vRockWorld;
        varying vec3 vRockNormal;
        uniform sampler2D uCliffMap;
        uniform sampler2D uCliffNormal;
        uniform sampler2D uCliffRough;
        uniform float uSea;
        vec3 rTri;
        float rHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
        float rNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( rHash( i ), rHash( i + vec2( 1, 0 ) ), u.x ), mix( rHash( i + vec2( 0, 1 ) ), rHash( i + 1.0 ), u.x ), u.y );
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec3 p = vRockWorld;
          vec3 n = normalize( vRockNormal );
          vec3 a = pow( abs( n ), vec3( 4.0 ) );
          rTri = a / ( a.x + a.y + a.z );
          vec3 rock = texture2D( uCliffMap, p.zy / ${tile} ).rgb * rTri.x + texture2D( uCliffMap, p.xy / ${tile} ).rgb * rTri.z + texture2D( uCliffMap, p.xz / ${tile} ).rgb * rTri.y;
          float l = dot( rock, vec3( 0.2126, 0.7152, 0.0722 ) );
          rock = mix( vec3( l ), rock, 0.35 ) * vec3( 1.05, 0.98, 0.9 ) * 2.3;
          rock *= 0.72 + 0.56 * rNoise( vec2( p.x + p.z, p.y * 0.3 ) / 3.0 );
          // the same beds as the land's faces (terrain.ts strata): a ledge is a stratum showing, its shade
          // set by its height, so the rock and the face round it read as one
          {
            float warp = ( rNoise( p.xz / 45.0 ) - 0.5 ) * 5.0 + ( rNoise( p.xz / 11.0 + 7.0 ) - 0.5 ) * 1.2;
            float bed = floor( ( p.y + warp ) / 1.7 );
            float tone = rHash( vec2( bed, 3.7 ) + floor( p.xz / 90.0 ) * 0.013 );
            rock *= mix( 0.9, 0.7 + 0.4 * tone, 0.8 );
          }
          // the tops: soil and moss, and salt-crusted grey on the sea-facing sides
          float top = smoothstep( 0.65, 0.9, n.y ) * smoothstep( 0.4, 0.7, rNoise( p.xz / 1.7 ) );
          rock = mix( rock, vec3( 0.09, 0.11, 0.05 ), top * step( uSea + 3.0, p.y ) * 0.8 );
          // wet and dark near the water, with a pale band of barnacles/salt just above it
          float above = p.y - uSea;
          rock = mix( rock, rock * 0.3, 1.0 - smoothstep( 0.4, 2.8, above ) );
          rock = mix( rock, rock * 1.25, smoothstep( 2.6, 3.4, above ) * ( 1.0 - smoothstep( 3.4, 5.0, above ) ) * 0.6 );
          diffuseColor.rgb = rock;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness;
        {
          vec3 p = vRockWorld;
          roughnessFactor = texture2D( uCliffRough, p.zy / ${tile} ).g * rTri.x + texture2D( uCliffRough, p.xy / ${tile} ).g * rTri.z + texture2D( uCliffRough, p.xz / ${tile} ).g * rTri.y;
          roughnessFactor = mix( roughnessFactor, 0.3, 1.0 - smoothstep( 0.3, 2.4, p.y - uSea ) );
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec3 p = vRockWorld;
          vec3 n = normalize( vRockNormal );
          vec3 nx = texture2D( uCliffNormal, p.zy / ${tile} ).xyz * 2.0 - 1.0;
          vec3 nz = texture2D( uCliffNormal, p.xy / ${tile} ).xyz * 2.0 - 1.0;
          vec3 ny = texture2D( uCliffNormal, p.xz / ${tile} ).xyz * 2.0 - 1.0;
          vec3 wx = vec3( 0.0, nx.y, nx.x ) * sign( n.x );
          vec3 wz = vec3( nz.x, nz.y, 0.0 ) * sign( n.z );
          vec3 wy = vec3( ny.x, 0.0, ny.y );
          float fade = 1.0 - smoothstep( 120.0, 700.0, length( p - cameraPosition ) );
          vec3 wn = normalize( n + ( wx * rTri.x + wz * rTri.z + wy * rTri.y ) * 1.2 * fade );
          normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
        }`,
      )
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `coast-rock|${key()}`
  return material
}

// ─── placement ──────────────────────────────────────────────────────────────

interface Placed {
  x: number
  y: number
  z: number
  size: [number, number, number]
  yaw: number
  tilt: number
  shape: number
}

/** the direction toward the sea at a point (down the shore field) */
function seaward(x: number, z: number): number {
  const e = 6
  const gx = shore(x + e, z) - shore(x - e, z)
  const gz = shore(x, z + e) - shore(x, z - e)
  return Math.atan2(-gx, -gz)
}

function placeRocks(): Placed[] {
  const rand = seeded(907)
  const out: Placed[] = []
  const logNormal = (mu: number, sigma: number) => Math.exp(Math.log(mu) + sigma * Math.sqrt(-2 * Math.log(rand() + 1e-9)) * Math.cos(2 * Math.PI * rand()))
  const add = (x: number, z: number, w: number, h: number, sink: number, yaw: number, shape = Math.floor(rand() * SHAPES.length)) => {
    const ground = heightAt(x, z)
    const d = w * (0.7 + rand() * 0.6)
    out.push({ x, y: Math.max(ground, SEA - 2) - h * sink, z, size: [w, h, d], yaw, tilt: (rand() - 0.5) * 0.25, shape })
  }

  // sea stacks
  for (const s of ISLANDS) {
    if (s.rx > 40) continue
    // (a block, flat-topped and stepped, not a spire)
    const h = 10 + s.rx * 1.3 + rand() * 6
    add(s.x, s.z, s.rx * 2.3, h, 0.12, rand() * Math.PI * 2, s.seed % 2 ? 0 : 4)
    // their broken skirts
    for (let k = 0; k < 4; k++) {
      const a = rand() * Math.PI * 2
      const r = s.rx * (0.9 + rand() * 0.8)
      add(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, s.rx * (0.3 + rand() * 0.4), 2 + rand() * 4, 0.3, rand() * 6)
    }
  }

  // along the coast: candidates spread by distance (more close in, where they're big on screen)
  for (let i = 0; i < 160000; i++) {
    const r = 140 + 2600 * rand() ** 1.7
    const a = (rand() - 0.5) * Math.PI * 1.2 // the seaward half of the site (the coast lies ahead and to the right)
    const x = Math.sin(a) * r
    const z = -Math.cos(a) * r
    const s = shore(x, z)
    if (s < -25 || s > 60) continue
    const cliff = cliffness(x, z)
    const sand = beachness(x, z)
    if (onRoad(x, z) > 0) continue
    // clusters: heaps under the cliffs, rarely alone
    const cluster = smoothstep(Math.sin(x * 0.043 + Math.sin(z * 0.031) * 2) * Math.cos(z * 0.037 - x * 0.012), -0.2, 0.6)
    if (s >= -25 && s < 10) {
      // the shore: boulders heaped at the cliff foot and out into the water
      if (rand() > (0.1 + 0.6 * cluster) * (cliff * (1 - sand) + 0.06) * (r < 900 ? 1 : 0.5)) continue
      const w = Math.min(9, logNormal(2.4, 0.55) * (1 + 0.3 * cliff))
      add(x, z, w, w * (0.5 + rand() * 0.5), 0.35, seaward(x, z) + (rand() - 0.5) * 1.2)
    } else {
      // the face: great slabs where the ground is steep, turned to the sea
      const h0 = heightAt(x, z)
      const slope = Math.hypot(heightAt(x + 3, z) - h0, heightAt(x, z + 3) - h0) / 3
      if (slope < 0.55 || rand() > 0.25 * cliff) continue
      const w = 6 + logNormal(6, 0.4)
      add(x, z, w, w * (0.6 + rand() * 0.4), 0.4, seaward(x, z) + (rand() - 0.5) * 0.6, [0, 1, 4, 5][Math.floor(rand() * 4)])
    }
  }

  // outcrops on the steeper hillsides: a stratum breaking out along the slope — a row of blocks along
  // the contour, turned with it, sunk into the hill, with a scatter of fallen ones (talus) below it.
  // One by one at random they were a few pebbles on a painted face.
  const inGarage = (x: number, z: number) => Math.abs(x) < 16 && z > -12 && z < 18
  for (let i = 0; i < 14000; i++) {
    const r = 60 + 1800 * rand() ** 1.4
    const a = (rand() - 0.5) * Math.PI * 2
    const x = Math.sin(a) * r
    const z = -Math.cos(a) * r
    const s = shore(x, z)
    if (s < 25 || onRoad(x, z) > 0 || inGarage(x, z)) continue
    const gx = (heightAt(x + 3, z) - heightAt(x - 3, z)) / 6
    const gz = (heightAt(x, z + 3) - heightAt(x, z - 3)) / 6
    const slope = Math.hypot(gx, gz)
    if (slope < 0.5 || rand() > 0.35 * smoothstep(slope, 0.5, 1.1)) continue
    // along the contour, and downhill
    const cx = -gz / slope
    const cz = gx / slope
    const dx = -gx / slope
    const dz = -gz / slope
    const contour = Math.atan2(cx, cz)
    const n = 3 + Math.floor(rand() * 5)
    const w0 = logNormal(5, 0.4) * (r < 400 ? 1 : 1.4)
    let t = -((n - 1) / 2) * w0 * 0.7
    for (let k = 0; k < n; k++) {
      const w = w0 * (0.6 + rand() * 0.7)
      const px = x + cx * t + dx * (rand() - 0.5) * w0 * 0.3
      const pz = z + cz * t + dz * (rand() - 0.5) * w0 * 0.3
      t += w * 0.7 // (overlapping: one broken ledge, not a string of beads)
      if (onRoad(px, pz) > 0 || inGarage(px, pz) || shore(px, pz) < 20) continue
      // (low, flat layered blocks — the slab and ledge shapes — half buried: the stratum's edge showing
      // through the turf; standing proud and rounded they read as boulders dropped on the grass)
      add(px, pz, w, w * (0.32 + rand() * 0.25), 0.5, contour + (rand() - 0.5) * 0.3, [1, 5, 5, 4][Math.floor(rand() * 4)])
    }
    // talus: smaller blocks fallen a few metres down the slope
    const fallen = Math.floor(rand() * 4)
    for (let k = 0; k < fallen; k++) {
      const down = w0 * (1.2 + rand() * 2.5)
      const side = (rand() - 0.5) * w0 * n * 0.8
      const px = x + dx * down + cx * side
      const pz = z + dz * down + cz * side
      if (onRoad(px, pz) > 0 || inGarage(px, pz) || shore(px, pz) < 15) continue
      const w = w0 * (0.25 + rand() * 0.3)
      add(px, pz, w, w * (0.6 + rand() * 0.3), 0.3, rand() * Math.PI * 2)
    }
  }
  return out
}

export interface Rocks {
  group: THREE.Group
  /** the far rocks (the garage's floor mirror can skip them) */
  far: THREE.Object3D[]
  /** each rock's foot: where it sits and its footprint (x × z, metres) — the ground darkens round them */
  feet: { x: number; z: number; w: number; d: number }[]
}

/** beyond this, rocks are drawn from their coarse geometry */
const FAR = 450

export function createRocks(cliff: PbrMaps): Rocks {
  const t0 = performance.now()
  const placed = placeRocks()
  const material = rockMaterial(cliff)
  const near = SHAPES.map((s) => rockGeometry(s, 7))
  const coarse = SHAPES.map((s) => rockGeometry(s, 3))
  const group = new THREE.Group()
  group.name = 'rocks'
  const far: THREE.Object3D[] = []
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v = new THREE.Vector3()
  const sc = new THREE.Vector3()
  let tris = 0
  SHAPES.forEach((_, si) => {
    for (const lod of [0, 1]) {
      const list = placed.filter((p) => p.shape === si && (Math.hypot(p.x, p.z) < FAR) === (lod === 0))
      if (list.length === 0) continue
      const geometry = lod === 0 ? near[si] : coarse[si]
      const mesh = new THREE.InstancedMesh(geometry, material, list.length)
      list.forEach((p, i) => {
        q.setFromEuler(e.set(p.tilt, p.yaw, p.tilt * 0.6))
        mesh.setMatrixAt(i, m.compose(v.set(p.x, p.y, p.z), q, sc.set(p.size[0] / 2, p.size[1] / 2, p.size[2] / 2)))
      })
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.computeBoundingSphere()
      mesh.name = `rocks-${si}-lod${lod}`
      tris += (geometry.index!.count / 3) * list.length
      group.add(noRaycast(mesh))
      if (lod === 1) far.push(mesh)
    }
  })
  for (const g of [...near, ...coarse]) if (!group.children.some((c) => (c as THREE.Mesh).geometry === g)) g.dispose()
  console.info(`[garage] coast rocks: ${placed.length} placed, ${(tris / 1e6).toFixed(2)} M triangles, ${Math.round(performance.now() - t0)} ms`)
  return { group, far, feet: placed.map((p) => ({ x: p.x, z: p.z, w: p.size[0], d: p.size[2] })) }
}
