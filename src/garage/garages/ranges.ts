import * as THREE from 'three'
import { fbm, noRaycast, ridged, smoothstep } from './landform'
import { mapFar } from './site'
import { outdoorMaterial } from './terrain'

/**
 * The foothills and ranges between the lake's far shore and Mount Fuji, and
 * around the rest of the horizon — several layers at different distances and
 * heights, overlapping, so the eye reads depth ridge by ridge before it
 * reaches the mountain. Built in real metres and mapped into the site's
 * distance compression; the atmosphere effect hazes each layer for its real
 * distance, so the farther ones come out lighter, bluer and softer.
 */
interface Range {
  /** distance of the ridge line, metres */
  real: number
  /** front-to-back depth of the band, metres */
  depth: number
  /** azimuth span, degrees from straight behind the pavilion (toward Fuji) toward +x */
  span: [number, number]
  /** highest crests above the lake, metres */
  peak: number
  seed: number
}

const RANGES: Range[] = [
  // wooded hills just beyond the lake's far shore
  { real: 4600, depth: 1400, span: [-85, 85], peak: 240, seed: 1 },
  // the first real foothills
  { real: 6800, depth: 2000, span: [-75, 80], peak: 800, seed: 2 },
  // the ranges in front of Fuji's foot, broken where the mountain rises behind
  { real: 9200, depth: 2200, span: [-65, 60], peak: 1350, seed: 3 },
  // higher ridges flanking Fuji, where its skirts don't stand in front of them
  { real: 12500, depth: 2600, span: [-72, -22], peak: 1550, seed: 5 },
  { real: 12500, depth: 2600, span: [20, 70], peak: 1450, seed: 6 },
  // the high ranges far off to either side (the Misaka and Southern Alps side): pale, almost sky
  { real: 26000, depth: 4000, span: [-85, -16], peak: 2300, seed: 7 },
  { real: 27000, depth: 4000, span: [15, 85], peak: 2100, seed: 8 },
  // around the rest of the horizon, so the valley isn't open to nothing behind the pavilion
  { real: 7500, depth: 2500, span: [80, 280], peak: 650, seed: 4 },
]

const forest = new THREE.Color().setHex(0x2d4628, THREE.SRGBColorSpace)
const darkForest = new THREE.Color().setHex(0x1f3320, THREE.SRGBColorSpace)
const rock = new THREE.Color().setHex(0x4c4a44, THREE.SRGBColorSpace)

function createRange(range: Range): THREE.BufferGeometry {
  const deg = THREE.MathUtils.degToRad
  const [a0, a1] = range.span.map(deg)
  const cols = Math.ceil((range.span[1] - range.span[0]) * 4) // a vertex every 0.25°
  const rows = 22
  const position = new Float32Array((cols + 1) * (rows + 1) * 3)
  const color = new Float32Array((cols + 1) * (rows + 1) * 3)
  const c = new THREE.Color()
  let k = 0
  for (let j = 0; j <= rows; j++) {
    const v = j / rows // 0 = near edge, 1 = far edge
    const R = range.real + (v - 0.5) * range.depth
    for (let i = 0; i <= cols; i++) {
      const a = a0 + ((a1 - a0) * i) / cols
      // a ridge band: low at its near and far edges, crests in between, ragged along its length
      const along = a * 9 + range.seed * 13
      const crest = ridged(along, v * 2.2 + range.seed, 4)
      const swell = 0.45 + 0.55 * fbm(a * 3 + range.seed, range.seed * 2.1, 3)
      const band = Math.sin(Math.PI * v) ** 0.8
      // fade the ends of a partial span down into the ground
      const ends = smoothstep(a, a0, a0 + deg(8)) * (1 - smoothstep(a, a1 - deg(8), a1))
      const h = range.peak * band * swell * (0.35 + 0.65 * crest) * (a1 - a0 < Math.PI * 1.5 ? ends : 1) - 60
      const x = Math.sin(a) * R
      const z = -Math.cos(a) * R
      position.set([x, h, z], k * 3)
      c.copy(forest).lerp(darkForest, fbm(a * 20, v * 4 + range.seed, 2))
      c.lerp(rock, smoothstep(crest, 0.85, 0.97) * smoothstep(h, range.peak * 0.6, range.peak) * 0.6)
      color.set([c.r, c.g, c.b], k * 3)
      k++
    }
  }
  const index: number[] = []
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const p = j * (cols + 1) + i
      const q = p + cols + 1
      index.push(p, q, p + 1, p + 1, q, q + 1)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(position, 3))
  g.setAttribute('color', new THREE.BufferAttribute(color, 3))
  g.setIndex(index)
  g.computeVertexNormals() // from the real shape, before the mapping
  // the normals face up-ish; make sure the winding agrees (the band runs clockwise seen from above)
  const n = g.attributes.normal
  if (n.getY(Math.floor(n.count / 2)) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]]
    g.setIndex(index)
    g.computeVertexNormals()
  }
  return mapFar(g)
}

export function createRanges(): THREE.Group {
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
  const group = new THREE.Group()
  group.name = 'ranges'
  for (const range of RANGES) group.add(noRaycast(new THREE.Mesh(createRange(range), material)))
  return group
}
