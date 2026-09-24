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
  crater: 0.035,
}

export function createFujiMountain(): THREE.Mesh {
  const { height: H, radius: R, crater } = FUJI
  const snow = new THREE.Color().setHex(0xf2f4f8, THREE.SRGBColorSpace)
  const scoria = new THREE.Color().setHex(0x4a3834, THREE.SRGBColorSpace)
  const ash = new THREE.Color().setHex(0x383234, THREE.SRGBColorSpace)
  const forest = new THREE.Color().setHex(0x243a22, THREE.SRGBColorSpace)
  const plain = new THREE.Color().setHex(0x4d6a34, THREE.SRGBColorSpace)
  const geometry = polarGrid(
    R,
    220,
    640,
    (t) => t ** 1.25, // rings bunch toward the summit, where the detail is
    (x, z, t, a, c) => {
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      // the profile: steep near the top, easing out into broad skirts
      const u = Math.max(0, (t - crater) / (1 - crater))
      let h = t < crater ? H - 80 * (1 - (t / crater) ** 2) + 20 : H * (1 - u) ** 1.6
      // a slight asymmetry — no mountain is a lathe-turned cone
      h *= 1 + 0.035 * Math.sin(a + 0.8) * smoothstep(t, 0.1, 0.6)
      // erosion channels: many radial gullies, deepest mid-slope, finer ones between
      const envelope = Math.sin(Math.PI * Math.min(1, t * 1.5)) ** 1.3
      const gullies = ridged(ca * 11 + t * 3, sa * 11 + t * 3, 3)
      const rills = ridged(ca * 34 + t * 9, sa * 34 + t * 9, 2)
      h += envelope * (95 * (gullies - 0.55) + 30 * (rills - 0.5))
      // lumps and old lava flows on the lower flanks
      h += smoothstep(t, 0.35, 1) * 120 * (fbm(x / 1500, z / 1500) - 0.5)

      // snow above ~1,700 m over the lake, reaching down the gullies
      const snowLine = 1700 - 260 * (gullies - 0.5) - 120 * (noise(ca * 4 + 2, sa * 4) - 0.5)
      const snowy = smoothstep(h, snowLine - 50, snowLine + 30)
      // bare slopes: reddish scoria and grey ash in streaks
      c.copy(scoria).lerp(ash, fbm(ca * 20 + t * 6, sa * 20 + t * 6, 2))
      // the forest belt below ~900 m, farmland at the very foot
      c.lerp(forest, 1 - smoothstep(h, 700, 1000))
      c.lerp(plain, 1 - smoothstep(h, 120, 300))
      c.lerp(snow, snowy)
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
