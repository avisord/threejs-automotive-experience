import * as THREE from 'three'
import { fbm, noRaycast, noise, ridged, smoothstep } from '../landform'
import { outdoorMaterial } from '../terrain'
import { COAST, SEA, heightAt, mapFar, shore } from './site'

/**
 * The land beyond the real-scale coast, all round the horizon: the coastal
 * hills running on, then mountains built from large forms down —
 *
 *   coastal foothills (4–8 km) → middle ridges along the right-hand coast
 *   (8–15 km) → the big mountain mass across the bay (~26 km), with its
 *   shoulders → pale distant ranges behind (30–38 km)
 *
 * Each MASSIF is a main ridge through its summit — along it the crest rises
 * to the summit and falls through saddles, across it an asymmetric profile
 * (a steep face, a long back), sharp or rounded — with spurs running down its
 * flanks and gullies cut between them. They merge with a smooth max over the
 * rolling coastal hills (site.heightAt's own land, which this continues), and
 * all of it stops at the sea (the shore field), so the far coast's headlands
 * rise straight out of the water.
 *
 * Built in real metres and mapped into the far compression (site.mapFar,
 * the Earth's curve included), so every point keeps its angle from the
 * garage; the atmosphere effect hazes each for its real distance — the
 * ranges recede in value and colour, not in a painted fog.
 */

interface Massif {
  /** bearing of the summit from the garage, degrees (0 = straight out through the glass, + right) */
  bearing: number
  /** distance to the summit, metres */
  dist: number
  /** summit above the sea, metres */
  height: number
  /** half-length of the main ridge, metres */
  reach: number
  /** half-width of its flanks at the summit, metres */
  width: number
  /** the ridge's direction relative to the line of sight, degrees (90 = across the view) */
  axis: number
  /** −1…1: the steep side (+ = the face toward the garage) */
  steep: number
  /** 0 rounded … 1 sharp crest */
  sharp: number
  /** where along the ridge the summit stands, −1…1 */
  peakAt: number
  seed: number
}

const MASSIFS: Massif[] = [
  // the big mountain across the bay, its long shoulders running off to both sides
  { bearing: 3, dist: 26000, height: 1780, reach: 9000, width: 5200, axis: 78, steep: 0.35, sharp: 0.55, peakAt: -0.15, seed: 1 },
  { bearing: -9, dist: 30500, height: 1180, reach: 6500, width: 4200, axis: 62, steep: 0.2, sharp: 0.4, peakAt: 0.3, seed: 2 },
  { bearing: 13, dist: 21500, height: 1250, reach: 5500, width: 3500, axis: 110, steep: 0.4, sharp: 0.5, peakAt: 0.2, seed: 3 },
  // the middle ridges above the right-hand coast
  { bearing: 24, dist: 12000, height: 820, reach: 4200, width: 2600, axis: 55, steep: 0.5, sharp: 0.45, peakAt: -0.3, seed: 4 },
  { bearing: 33, dist: 8200, height: 560, reach: 3200, width: 2000, axis: 40, steep: 0.45, sharp: 0.35, peakAt: 0.25, seed: 5 },
  { bearing: 40, dist: 15500, height: 1050, reach: 5200, width: 3000, axis: 70, steep: 0.3, sharp: 0.55, peakAt: 0, seed: 6 },
  // coastal foothills close behind the shore
  { bearing: 48, dist: 5200, height: 380, reach: 2400, width: 1500, axis: 30, steep: 0.3, sharp: 0.25, peakAt: 0.1, seed: 7 },
  { bearing: 70, dist: 6000, height: 460, reach: 2800, width: 1700, axis: 20, steep: 0.2, sharp: 0.3, peakAt: -0.2, seed: 8 },
  // pale distant ranges
  { bearing: 52, dist: 32000, height: 1850, reach: 11000, width: 6000, axis: 85, steep: 0.2, sharp: 0.6, peakAt: 0.2, seed: 9 },
  { bearing: 25, dist: 36000, height: 1650, reach: 9000, width: 5500, axis: 95, steep: 0.1, sharp: 0.55, peakAt: -0.3, seed: 10 },
  { bearing: 80, dist: 24000, height: 1400, reach: 9000, width: 5000, axis: 75, steep: 0.2, sharp: 0.45, peakAt: 0.1, seed: 11 },
  // the far headland across the bay, low on the left horizon
  { bearing: -24, dist: 37000, height: 780, reach: 7000, width: 4000, axis: 70, steep: 0.3, sharp: 0.35, peakAt: 0, seed: 12 },
  // round behind the garage, for the view back through the door
  { bearing: 130, dist: 9000, height: 700, reach: 5000, width: 3000, axis: 80, steep: 0.2, sharp: 0.35, peakAt: 0, seed: 13 },
  { bearing: 175, dist: 12000, height: 900, reach: 6000, width: 3500, axis: 90, steep: 0.2, sharp: 0.4, peakAt: 0.3, seed: 14 },
  { bearing: -150, dist: 10000, height: 600, reach: 5000, width: 3000, axis: 60, steep: 0.2, sharp: 0.3, peakAt: -0.2, seed: 15 },
]

const DEG = Math.PI / 180

/** one massif's height at a real point (0 outside it) */
function massifHeight(m: Massif, x: number, z: number): number {
  const b = m.bearing * DEG
  const sx = Math.sin(b) * m.dist
  const sz = -Math.cos(b) * m.dist
  // the ridge's own frame: `along` its crest, `across` it (+ toward the garage)
  const a = b + (m.axis - 90) * DEG + Math.PI / 2
  const ax = Math.sin(a)
  const az = -Math.cos(a)
  const dx = x - sx
  const dz = z - sz
  let along = (dx * ax + dz * az) / m.reach
  const toGarage = -(dx * Math.sin(b) - dz * Math.cos(b)) // + on the garage's side
  const acrossRaw = dx * -az + dz * ax
  const across = Math.sign(acrossRaw * toGarage || 1) * Math.abs(acrossRaw)
  if (Math.abs(along) > 1.6) return 0
  // the crest meanders: the ridge line bends a little along its length
  const bend = (noise(along * 1.7 + m.seed * 3, m.seed) - 0.5) * 0.35 * m.width
  const v = (across - bend) / m.width
  // the steep side is narrower
  const vs = v > 0 ? v * (1 + m.steep) : v * (1 - m.steep * 0.6)
  if (Math.abs(vs) > 2.2) return 0
  // along the crest: up to the summit (off-centre), down through saddles to the ends
  const u = along - m.peakAt
  const ends = 1 - smoothstep(Math.abs(along), 0.75, 1.5)
  const rise = Math.max(0, 1 - Math.abs(u) / (1 + Math.abs(m.peakAt)) * 0.75)
  const saddles = 0.78 + 0.22 * Math.cos(along * 5.5 + m.seed) + 0.1 * (noise(along * 4 + m.seed, 7) - 0.5)
  const crest = m.height * Math.pow(rise, 1.4) * ends * saddles
  // across: sharp crest (a cone-ish profile) or rounded (a bell), with broad roots
  const sharpProfile = Math.pow(Math.max(0, 1 - Math.abs(vs) / 1.6), 1.7)
  const round = Math.exp(-vs * vs * 1.6)
  let h = crest * THREE.MathUtils.lerp(round, sharpProfile, m.sharp)
  // spurs down the flanks, gullies between them — running across the ridge, bending with it
  const spur = ridged(along * 7 + m.seed * 5 + v * 0.8, v * 1.3 + m.seed, 3)
  const flank = smoothstep(Math.abs(vs), 0.15, 0.6) * (1 - smoothstep(Math.abs(vs), 1.3, 2))
  h *= 1 + flank * (0.5 * (spur - 0.55))
  // secondary ridges and ravines, smaller than the spurs, all over the flanks
  h += crest * 0.14 * (ridged(x / 1300 + m.seed, z / 1300, 4) - 0.55) * smoothstep(Math.abs(vs), 0.1, 0.5)
  // notches along the crest
  h *= 1 - 0.06 * smoothstep(0.7, 0.95, ridged(along * 12 + m.seed, 3.1, 2)) * (1 - smoothstep(Math.abs(vs), 0, 0.3))
  return Math.max(0, h)
}

/** the far land's height above the sea at a real point: the coastal hills run on, the massifs rise over them */
export function farHeight(x: number, z: number): number {
  const s = shore(x, z)
  const r = Math.hypot(x, z)
  // (site.heightAt is the coast's own land: its hills, the shore, the seabed; this continues it)
  const base = heightAt(x, z) - SEA
  // (kept clear of the water level by 0.4 % of the distance: depth precision out here is tens of metres)
  const clearance = 0.004 * r
  if (s < 0) return Math.min(base, -clearance)
  // broad rolling ground between the ranges, rising inland
  // (none at the real-scale land's edge, so the two meshes meet where they overlap)
  const inland = smoothstep(s, 200, 6000) * smoothstep(r, COAST.realRadius, COAST.realRadius + 1500)
  let h = base + inland * (120 * fbm(x / 3500 + 3, z / 3500, 3) + 60 * ridged(x / 1800, z / 1800, 3))
  // the massifs, merged by a smooth max (overlapping ranges join in a saddle, not a crease)
  let top = 0
  for (const m of MASSIFS) {
    const mh = massifHeight(m, x, z)
    if (mh <= 0) continue
    const k = 120
    top = top > 0 ? Math.max(top, mh) + k * Math.log(1 + Math.exp(-Math.abs(top - mh) / k)) * 0.7 : mh
  }
  // (from the real-scale land's edge on; and the far coast's headlands stand straight up out of the water)
  top *= smoothstep(r, COAST.realRadius, COAST.realRadius + 2500) * smoothstep(s, 60, 900)
  h = Math.max(h, h * 0.4 + top)
  // erosion over everything: fine gullies on the steeper ground
  h -= (25 * smoothstep(0.75, 0.97, ridged(x / 700, z / 700, 3)) + 70 * smoothstep(0.72, 0.95, ridged(x / 1900 + 5, z / 1900, 3))) * smoothstep(h, 150, 800) * smoothstep(r, COAST.realRadius, COAST.realRadius + 1500)
  return Math.max(h, clearance * smoothstep(s, 0, 40))
}

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)

/**
 * The far terrain mesh: rings from just inside the real-scale land's edge
 * (it tucks under it) out to the sea's edge, spaced geometrically — about
 * the same number of pixels per ring at every distance.
 */
export function createCoastRanges(): THREE.Mesh {
  const t0 = performance.now()
  const r0 = COAST.realRadius - 150
  const r1 = COAST.farRadius
  const RINGS = 230
  const SEGMENTS = 1440
  const count = RINGS * SEGMENTS
  const position = new Float32Array(count * 3)
  const color = new Float32Array(count * 3)
  const realXZ = new Float32Array(count * 2)
  const forest = srgb(0x243a1e)
  const lightForest = srgb(0x3d5428)
  const scrub = srgb(0x5d6236)
  const dryGrass = srgb(0x8a8250)
  const rock = srgb(0x7a7064)
  const cliff = srgb(0x6a6052)
  const c = new THREE.Color()
  for (let i = 0; i < RINGS; i++) {
    const r = r0 * (r1 / r0) ** (i / (RINGS - 1))
    for (let j = 0; j < SEGMENTS; j++) {
      const a = (j / SEGMENTS) * Math.PI * 2
      const x = Math.sin(a) * r
      const z = -Math.cos(a) * r
      const h = farHeight(x, z)
      const k = i * SEGMENTS + j
      position.set([x, h, z], k * 3)
      realXZ.set([x, z], k * 2)
      // cover by elevation and moisture: dense forest on the slopes, drier grass and scrub on the
      // low coastal hills and the sunny ridges, bare rock high up
      const wet = fbm(x / 2600 + 7, z / 2600 - 2, 3)
      c.copy(forest).lerp(lightForest, smoothstep(wet, 0.45, 0.7))
      c.lerp(scrub, smoothstep(h, 60, 10) * 0.7 + smoothstep(wet, 0.55, 0.35) * 0.35)
      c.lerp(dryGrass, smoothstep(fbm(x / 1300, z / 1300, 2), 0.6, 0.75) * 0.5 * (1 - smoothstep(h, 400, 900)))
      c.lerp(rock, smoothstep(h, 1250, 1650) * 0.8)
      // sea cliffs where the far coast meets the water
      const s = shore(x, z)
      c.lerp(cliff, (1 - smoothstep(s, 10, 90)) * (s > 0 ? 0.5 : 0))
      color.set([c.r, c.g, c.b], k * 3)
    }
  }
  // the land under the sea needn't be drawn (it's under the water): drop triangles wholly below it
  const index: number[] = []
  const under = (k: number) => position[k * 3 + 1] < -2
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEGMENTS; j++) {
      const a = i * SEGMENTS + j
      const b = i * SEGMENTS + ((j + 1) % SEGMENTS)
      const c2 = a + SEGMENTS
      const d = b + SEGMENTS
      if (!(under(a) && under(b) && under(c2))) index.push(a, c2, b)
      if (!(under(b) && under(c2) && under(d))) index.push(b, c2, d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('color', new THREE.BufferAttribute(color, 3))
  g.setAttribute('realXZ', new THREE.BufferAttribute(realXZ, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  // steep ground is rock and scree: shade the colours by the real slope before the mapping flattens it
  const nrm = g.attributes.normal
  for (let k = 0; k < count; k++) {
    const steep = 1 - smoothstep(nrm.getY(k), 0.62, 0.85)
    if (steep <= 0) continue
    c.fromArray(color, k * 3).lerp(rock, steep * 0.55)
    c.toArray(color, k * 3)
  }
  // y above the sea for the mapping
  for (let k = 0; k < count; k++) position[k * 3 + 1] = Math.max(position[k * 3 + 1], -200)
  mapFar(g)
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
  // per-pixel texture in real metres: tree crowns and clearings on the forested slopes, so they
  // read as forest (a flat colour reads as felt), faded to their mean once under a pixel
  const base = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 realXZ;\nvarying vec2 vRealXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRealXZ = realXZ;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vRealXZ;
        float fHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
        float fNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( fHash( i ), fHash( i + vec2( 1, 0 ) ), u.x ), mix( fHash( i + vec2( 0, 1 ) ), fHash( i + 1.0 ), u.x ), u.y );
        }
        float fDetail( vec2 p, float scale ) {
          vec2 q = p / scale;
          float px = max( length( fwidth( q ) ), 1e-5 );
          return mix( fNoise( q ), 0.5, smoothstep( 0.3, 0.7, px ) );
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec2 p = vRealXZ;
          float crowns = fDetail( p, 14.0 ) * 0.5 + fDetail( p + 31.0, 45.0 ) * 0.3 + fDetail( p - 7.0, 160.0 ) * 0.2;
          float green = smoothstep( 0.02, 0.06, diffuseColor.g - diffuseColor.b ); // (forest and scrub, not rock)
          diffuseColor.rgb *= mix( 1.0, 0.7 + 0.6 * crowns, green );
        }`,
      )
  }
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `coast-ranges|${key()}`
  const mesh = new THREE.Mesh(g, material)
  mesh.name = 'coast-ranges'
  mesh.frustumCulled = false
  mesh.receiveShadow = true
  console.info(`[garage] coast ranges: ${count} vertices, ${index.length / 3} triangles, ${Math.round(performance.now() - t0)} ms`)
  return noRaycast(mesh)
}
