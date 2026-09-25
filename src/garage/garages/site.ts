import type * as THREE from 'three'
import { fbm, lerp, noise, ridged, smoothstep } from './landform'

/**
 * The Fuji Pavilion's site, in metres, pavilion at the origin, Mount Fuji
 * straight behind it (−z). Everything the landscape modules place — terrain,
 * road, lake, trees, villages, the far ranges and the mountain — reads its
 * layout from here, so it all agrees.
 *
 *   pavilion on a lawn terrace
 *   → the land falls away behind it (a steep bank, then a long gentle slope)
 *   → a winding rural road across the valley (~480 m)
 *   → rolling ground, farms and a village, down to
 *   → the lake (~1–2.9 km), then its wooded far shore rising gently to 3.3 km
 *   → foothills (~5 km) and mountain ranges (8–12 km) → Mount Fuji (~17 km),
 *     high ranges off to its sides (21–26 km)
 *
 * The pavilion stands ~50 m above the lake, a few metres from the edge of
 * its terrace, the land below falling away steeply and then gently across the
 * valley: from a building on flat ground a lake two kilometres off is a
 * hairline; from the lip of a terrace it's a band.
 */

/** the lawn around the pavilion */
export const GROUND = -0.6
/** eye height the far landscape is laid out for (a standing view inside the pavilion) */
export const EYE = 1.3

export const SITE = {
  /** z where the lawn behind the pavilion ends and the land falls away toward the lake */
  terraceEdge: -16,
  road: { z: -480, sway: 45, extent: 2500, width: 7 },
  lakeLevel: GROUND - 50,
  lake: { x: 0, z: -1950, rx: 2000, rz: 950 },
  /** real-scale terrain reaches this far; beyond, far layers are distance-compressed */
  realRadius: 3300,
  /**
   * Distance compression for the far layers. A camera near 0.05 m can't also
   * see 20 km with usable depth precision, so beyond `start` things are
   * placed closer and scaled down by the same ratio — their angular size
   * from the pavilion is exact; parallax differs by under a pixel for the
   * few metres a camera moves. The atmosphere effect undoes the mapping to
   * haze them for their real distance.
   */
  compress: { start: 3300, factor: 5.5 },
}

/** where something `real` metres away is drawn, and how much it's scaled */
export function farPlacement(real: number): { distance: number; scale: number } {
  const { start, factor } = SITE.compress
  const distance = real <= start ? real : start + (real - start) / factor
  return { distance, scale: distance / real }
}

/**
 * Height to draw a point of a far object at, for its real height above the
 * lake and its placement scale — anchored on the eye, so elevation angles
 * from the pavilion are exact.
 */
export function farY(realAboveLake: number, scale: number): number {
  const eyeAboveLake = EYE - SITE.lakeLevel
  return EYE + scale * (realAboveLake - eyeAboveLake)
}

/**
 * Map a far object's geometry, built in real metres (x/z around the pavilion,
 * y above the lake), into the compressed placement vertex by vertex. Every
 * point keeps its exact direction from the eye and its place in the depth
 * order, so a mountain's near skirts and a nearer ridge still overlap the
 * right way round. Normals come from the real shape, so it's lit as the real
 * slope would be — compute them before calling this.
 */
export function mapFar(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = geometry.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const real = Math.max(1, Math.hypot(x, z))
    const { distance, scale } = farPlacement(real)
    pos.setXYZ(i, (x * distance) / real, farY(pos.getY(i), scale), (z * distance) / real)
  }
  pos.needsUpdate = true
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

// ─── the valley ─────────────────────────────────────────────────────────────

/**
 * The eye the valley is designed for: the orbit camera a few metres behind
 * the car, looking past it toward the mountain. It sees the land beyond the
 * back glass only above the floor's edge — about 4.5° below the horizon — so
 * the whole view has to fit in that band: the far shore within ~1°, the lake
 * from ~1° to 3°, the near shore's fields, village and road from 3° to 4.8°.
 * Nearer the glass the band widens and the slope below the pavilion (its
 * shrubs and trees) comes into view as well.
 */
const VIEW_EYE = { y: 1.5, z: 8 }

/** depression below the design eye's horizon for ground `d` metres behind the pavilion, degrees */
function depression(d: number): number {
  const drop = smoothstep(d, -SITE.terraceEdge, 160) // the steep bank under the pavilion
  const shore = smoothstep(d, 160, LAKE_NEAR) // then gently across the valley to the water
  return lerp(lerp(10, 4.8, drop), 3.0, shore)
}
const THREE_DEG = Math.PI / 180
/** the lake's near shore, straight out */
const LAKE_NEAR = -SITE.lake.z - SITE.lake.rz

/**
 * The fall of the land toward the lake, by distance behind the pavilion.
 *
 * Shaped by what the eye inside must see (VIEW_EYE): every farther point has
 * to appear a little higher in the view than the nearer ones, or a rise hides
 * the land behind it — so the profile is given as a depression angle that
 * eases from 10° under the terrace to 3° at the lake's near shore, and the
 * height follows from it. Past the shore the ground stays just above the
 * water: the far shore's hills are added on top (heightAt). A convex slope
 * — the natural first guess — puts the valley floor above the line of sight
 * to the lake and hides it.
 */
function fall(z: number): number {
  if (z >= SITE.terraceEdge) return 0
  const d = -z
  const sightline = VIEW_EYE.y - (d + VIEW_EYE.z) * Math.tan(depression(Math.min(d, LAKE_NEAR)) * THREE_DEG) - 0.4
  const bank = smoothstep(d, -SITE.terraceEdge, -SITE.terraceEdge + 12) // ease off the terrace
  return Math.min(0, (Math.max(sightline, SITE.lakeLevel + 1.5) - GROUND) * bank)
}

/** the road's centre line, winding across the valley */
export function roadZ(x: number): number {
  const { z, sway } = SITE.road
  return z + sway * Math.sin(x / 520 + 0.6) + sway * 0.35 * Math.sin(x / 190 + 2.1)
}

/** flanking ranges left and right of the valley, 0 in the valley, 1 on the ridges */
const flank = (x: number) => smoothstep(Math.abs(x), 900, 2600)
/** the far shore rising beyond the lake */
const farShore = (z: number) => smoothstep(-z, 2700, 3300)
/** rising ground in front of the pavilion (+z) */
const behind = (z: number) => smoothstep(z, 150, 1400)

/** the road's height at x: it follows the valley, smoothed */
export function roadY(x: number): number {
  const z = roadZ(x)
  return GROUND + fall(z) + flank(x) * 70 + 1.5 * (noise(x / 300, 3.3) - 0.5)
}

/** < 1 inside the lake, 1 on its shore (irregular), > 1 outside */
export function lakeShape(x: number, z: number): number {
  const { lake } = SITE
  const dx = (x - lake.x) / lake.rx
  const dz = (z - lake.z) / lake.rz
  const a = Math.atan2(dz, dx)
  // a periodic wobble around the shore: bays and headlands, not an ellipse
  const wobble =
    0.2 * (noise(Math.cos(a) * 2.3 + 5, Math.sin(a) * 2.3) - 0.5) + 0.12 * (noise(Math.cos(a) * 7 + 1, Math.sin(a) * 7 - 3) - 0.5)
  return Math.hypot(dx, dz) / (1 + wobble)
}

/** 0 … 1: how far a point is into the road's cut */
export function onRoad(x: number, z: number): number {
  if (Math.abs(x) > SITE.road.extent + 60) return 0
  const ends = 1 - smoothstep(Math.abs(x), SITE.road.extent - 40, SITE.road.extent + 60)
  return (1 - smoothstep(Math.abs(z - roadZ(x)), SITE.road.width / 2 + 2, SITE.road.width / 2 + 16)) * ends
}

/** ground height anywhere in the real-scale zone */
export function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z)
  let h = GROUND + fall(z)
  // the lawn and fields: slight unevenness
  h += smoothstep(r, 45, 220) * 2.5 * (fbm(x / 110, z / 110) - 0.5)
  const lake = lakeShape(x, z)
  const lakeness = 1 - smoothstep(lake, 1.0, 1.7)
  // isolated rolling hills around the valley — not in the line of sight to the lake and the mountain
  const hills = fbm(x / 420 + 3, z / 420 - 7, 4)
  const aside = smoothstep(Math.abs(Math.atan2(x, -z)), 0.4, 0.7) + smoothstep(z, -200, 100)
  h += smoothstep(r, 250, 900) * 38 * smoothstep(hills, 0.45, 0.8) * (1 - lakeness) * Math.min(1, aside)
  // the valley's flanks, the far shore and the rise behind — different heights, ragged crests.
  // They rise from the water over a few hundred metres: where the lake reached into a flank at
  // full height the land stood up as a cliff within one grid cell, its colours smeared into
  // streaks and the canopy poked through it, flickering.
  const rise = smoothstep(lake, 1.0, 1.35)
  h += rise * flank(x) * (80 + 150 * ridged(x / 700, z / 700, 4))
  h += rise * farShore(z) * (25 + 65 * ridged(x / 600 + 2, z / 600, 4)) * (1 - flank(x) * 0.5)
  h += rise * behind(z) * (35 + 55 * fbm(x / 500, z / 500))
  // The lake basin. Depth precision at a kilometre or two is metres, so land
  // near the water keeps clear of its level — above it outside the shore,
  // below it inside — by more the farther it is, or the shoreline flickers.
  const clearance = Math.max(3, 0.004 * r)
  if (lake < 1) h = lerp(SITE.lakeLevel - clearance - 6, SITE.lakeLevel - clearance, smoothstep(lake, 0.85, 1))
  else if (lake < 1.6) h = Math.max(h, SITE.lakeLevel + clearance * (1 + 2 * smoothstep(lake, 1, 1.25)))
  // the road cuts a level bed through whatever is there
  const road = onRoad(x, z)
  if (road > 0) h = lerp(h, roadY(x) - 0.05, road)
  return h
}

/** 0–1: how much the land here is hillside woodland (the flanks, the far shore, the rise behind, high ground) */
export function woodedness(x: number, z: number): number {
  return Math.max(flank(x), farShore(z), behind(z), smoothstep(heightAt(x, z) - SITE.lakeLevel, 70, 140))
}

/** how thickly trees grow at a point, 0–1 — clumps and clearings, never uniform */
export function forestDensity(x: number, z: number): number {
  const r = Math.hypot(x, z)
  if (r < 45 || r > SITE.realRadius) return 0
  if (lakeShape(x, z) < 1.04) return 0
  if (onRoad(x, z) > 0.02 || Math.abs(z - roadZ(x)) < 14) return 0
  // keep the view from the pavilion over the valley to the lake and the mountain open
  const ahead = z < 0 && Math.abs(Math.atan2(x, -z)) < 0.42 && r < 1400 ? 0.12 : 1
  const clumps = smoothstep(fbm(x / 230 + 11, z / 230 - 4, 3), 0.44, 0.6)
  // hillsides are wooded; the valley floor is farmland with stands of trees
  const wooded = 0.35 + 0.65 * woodedness(x, z)
  return clumps * ahead * wooded
}

/** true for the part of the valley straight ahead, which must stay open */
export function inView(x: number, z: number): boolean {
  return z < 0 && Math.abs(Math.atan2(x, -z)) < 0.42
}

/**
 * How tall something standing at (x, z) may grow before it rises into the
 * view of the valley — above the line 3.9° below the design eye's horizon,
 * where the road, the near shore's town and the lake begin. Out of the view
 * there's no limit. Grass and shrubs just past the glass may fill the band
 * below it: a foreground fringe along the window sill.
 */
export function roomBelowView(x: number, z: number): number {
  if (!inView(x, z)) return Infinity
  const d = Math.hypot(x, z - VIEW_EYE.z)
  return VIEW_EYE.y - d * Math.tan(3.9 * THREE_DEG) - heightAt(x, z)
}
