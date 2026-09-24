import * as THREE from 'three'
import { receiveFarShadow } from './far-shadow'
import { fbm, noRaycast, noise, polarGrid, seeded, smoothstep } from './landform'
import { GROUND, SITE, forestDensity, heightAt, lakeShape, onRoad } from './site'
import { OUTDOOR_SKY_LIGHT } from './sky'

/** a landscape material: the sky's fill toned down to a clear day's, far shadows read in */
export function outdoorMaterial<M extends THREE.MeshStandardMaterial>(material: M): M {
  material.envMapIntensity = OUTDOOR_SKY_LIGHT
  receiveFarShadow(material)
  return material
}

/** grey-green noise with little streaks — multiplied over the terrain's colours up close */
function grassDetailTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  const img = g.createImageData(size, size)
  const rand = seeded(7)
  for (let i = 0; i < size * size; i++) {
    const v = 190 + rand() * 65
    img.data.set([v * 0.95, v, v * 0.9, 255], i * 4)
  }
  g.putImageData(img, 0, 0)
  for (let i = 0; i < 1400; i++) {
    const x = rand() * size
    const y = rand() * size
    g.strokeStyle = `rgba(${rand() < 0.5 ? '255,255,230' : '60,70,40'},0.25)`
    g.beginPath()
    g.moveTo(x, y)
    g.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 5)
    g.stroke()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
/** field colours: young rice, deep greens, stubble, bare earth, vegetable rows */
const CROPS = [0x7a9a3c, 0x456d28, 0xb3a45e, 0x7a6146, 0x93a84a, 0x5b7a30, 0xc2b36e, 0x8c7a52].map(srgb)

/**
 * The real-scale land: the pavilion's lawn terrace, the valley falling to the
 * road and the lake, farmland, wooded hillsides and the far shore. 3.3 km
 * across in every direction, finest near the pavilion.
 */
export function createTerrain(): THREE.Mesh {
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
    240,
    720,
    (t) => t ** 1.8, // fine near the pavilion (lawn, road), coarser at the far shore
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
      const farm = smoothstep(r, 140, 260) * (1 - smoothstep(r, 2600, 3000)) * smoothstep(fbm(x / 350 - 5, z / 350 + 9, 2), 0.38, 0.5)
      if (farm > 0) {
        const u = x * 0.956 + z * 0.292 // parcels run along the valley, turned a little
        const v = -x * 0.292 + z * 0.956
        const pu = Math.floor(u / 55)
        const pv = Math.floor(v / (30 + 25 * noise(pu * 0.7, 3.1)))
        const pick = noise(pu * 1.37 + 0.5, pv * 2.11 + 0.5)
        const crop = CROPS[Math.min(CROPS.length - 1, Math.floor(pick * CROPS.length * 1.3) % CROPS.length)]
        // hedges and paths between parcels
        const edge = Math.min((u / 55) % 1, 1 - ((u / 55) % 1)) < 0.05 ? 0.6 : 1
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
    1 / 3, // grass detail repeats every 3 m
  )
  const terrain = new THREE.Mesh(
    geometry,
    outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: grassDetailTexture(), roughness: 1 })),
  )
  terrain.name = 'terrain'
  terrain.castShadow = true // hills shade the ground behind them (far shadow map)
  return noRaycast(terrain)
}

/** the ground level the meadow and bushes stand on near the pavilion */
export { GROUND }
