import * as THREE from 'three'
import { fbm, noRaycast, noise, polarGrid, ridged, smoothstep } from './landform'
import { mapFar } from './site'
import { outdoorMaterial } from './terrain'

/**
 * Mount Fuji at its real proportions, as seen from ~17 km: rising ~2,950 m
 * above the lake, its cone ~7 km in radius where it clears the foothills — a
 * steep concave summit cone (~34° under the rim) easing into long skirts, a
 * crater on top, snow on the upper part reaching down the gullies, bare dark
 * volcanic slopes below, then a forest belt. Built in real metres and mapped
 * into the site's distance compression vertex by vertex (site.mapFar), so
 * from the pavilion it subtends exactly the angle the real mountain would.
 */
const FUJI = {
  /** metres from the pavilion to the summit */
  distance: 17000,
  /** summit above the lake */
  height: 2950,
  /** radius of the modelled cone; beyond it the skirts are below the foothills */
  radius: 7000,
  /** the crater's rim, as a fraction of the radius (~800 m across: the top reads flat, not a point) */
  crater: 0.06,
}

export function createFujiMountain(): THREE.Mesh {
  const { height: H, radius: R, crater } = FUJI
  const snow = new THREE.Color().setHex(0xf2f4f8, THREE.SRGBColorSpace)
  const oldSnow = new THREE.Color().setHex(0xd4d8de, THREE.SRGBColorSpace)
  const scoria = new THREE.Color().setHex(0x40302c, THREE.SRGBColorSpace)
  const ash = new THREE.Color().setHex(0x2e2b2d, THREE.SRGBColorSpace)
  const forest = new THREE.Color().setHex(0x223a24, THREE.SRGBColorSpace)
  const plain = new THREE.Color().setHex(0x4a6234, THREE.SRGBColorSpace)
  const geometry = polarGrid(
    R,
    260,
    960,
    (t) => t ** 1.3, // rings bunch toward the summit, where the detail is
    (x, z, t, a, c) => {
      // gullies wander a little as they run down, and aren't evenly spaced: warp the angle
      const w = a + 0.22 * (fbm(Math.cos(a) * 2 + t * 2.5, Math.sin(a) * 2 - t * 1.5, 3) - 0.5) + 0.05 * Math.sin(a * 3 + t * 6)
      const ca = Math.cos(w)
      const sa = Math.sin(w)
      // the profile: a broad, slightly uneven rim, a steep concave upper cone, broad skirts
      const u = Math.max(0, (t - crater) / (1 - crater))
      const rim = H + 25 * (noise(ca * 9 + 3, sa * 9) - 0.5) + 30 * smoothstep(Math.sin(a - 2.2), 0.7, 1) // the highest point on one side
      let h = t < crater ? rim - 110 * (1 - (t / crater) ** 3) : H * (1 - u) ** 1.55 + (rim - H) * (1 - smoothstep(u, 0, 0.04))
      // a slight asymmetry — no mountain is a lathe-turned cone
      h *= 1 + 0.035 * Math.sin(a + 0.8) * smoothstep(t, 0.1, 0.6)
      // erosion at three scales, all as raised spines between broader channels (ridged noise):
      // a few big ravines cut deep, gullies on the mid slopes, and fine ribs right up under the
      // rim — the striped look of the upper cone. Some sectors are cut deeper than others.
      const strength = 0.4 + 0.9 * fbm(ca * 3 + 11, sa * 3 - 4, 2)
      const lower = 1 - smoothstep(t, 0.6, 0.95)
      const ravines = smoothstep(ridged(ca * 4.2 + 5, sa * 4.2 + t * 1.5, 2), 0.7, 1)
      const gullies = ridged(ca * 13 + t * 2, sa * 13 + t * 2, 3)
      const ribs = ridged(ca * 37 + t * 4, sa * 37 + t * 4, 2)
      h -= 150 * ravines * strength * smoothstep(t, 0.08, 0.3) * lower
      h += 70 * strength * (gullies - 0.55) * smoothstep(t, crater, 0.25) * lower
      h += 26 * (ribs - 0.5) * smoothstep(t, crater, crater + 0.04) * (1 - smoothstep(t, 0.45, 0.7))
      // lumps and old lava flows on the lower flanks
      h += smoothstep(t, 0.35, 1) * 120 * (fbm(x / 1500, z / 1500) - 0.5)

      // Snow. The line sits higher on some sides than others; the channels hold it far down in
      // long fingers while the spines between shed it, and it thins out patchily over a few
      // hundred metres instead of stopping at one height. Right up to the rim the sharpest ribs
      // stand dark through it.
      const line = 1450 + 380 * (noise(ca * 2.5 + 4, sa * 2.5) - 0.5) - 600 * ravines + 320 * (gullies - 0.5) + 140 * (ribs - 0.5)
      const patch = fbm(ca * 30 + t * 24, sa * 30 + t * 24, 3)
      let snowy = smoothstep(h - line + 360 * (patch - 0.5), 0, 380)
      const streaks = smoothstep(ribs, 0.86, 0.97) * smoothstep(t, crater + 0.005, crater + 0.05) * (0.5 + 0.5 * strength)
      snowy *= 1 - 0.8 * Math.min(1, streaks)
      // the crater rim's rocks
      snowy *= 1 - 0.55 * smoothstep(t, crater - 0.012, crater) * (1 - smoothstep(t, crater, crater + 0.01)) * noise(ca * 25, sa * 25)
      // bare slopes: dark volcanic rock, reddish scoria and grey ash in streaks
      c.copy(scoria).lerp(ash, fbm(ca * 20 + t * 6, sa * 20 + t * 6, 2))
      // the forest belt below ~900 m, farmland at the very foot
      c.lerp(forest, 1 - smoothstep(h, 700, 1000))
      c.lerp(plain, 1 - smoothstep(h, 120, 300))
      // snow: a greyer, thinner cover near its edge, bright and deep higher up
      const deep = smoothstep(h - line, 300, 900)
      c.lerp(oldSnow.clone().lerp(snow, deep), snowy)
      return h
    },
  )
  // real placement (straight behind the pavilion), real normals, then the compressed mapping
  geometry.translate(0, 0, -FUJI.distance)
  geometry.computeVertexNormals()
  mapFar(geometry)
  const mountain = new THREE.Mesh(geometry, outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })))
  mountain.name = 'fuji'
  return noRaycast(mountain)
}
