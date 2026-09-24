import * as THREE from 'three'
import { fbm, noRaycast, ridged, seeded, smoothstep } from './landform'
import type { ImpostorSet } from './impostors'
import { EYE, SITE, farPlacement, farY, mapFar } from './site'
import { plantImpostors } from './trees'
import type { Plant } from './vegetation-layout'
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

/** ranges nearer than this get trees on their crests and wooded slopes (farther, a tree is under a pixel) */
const TREES_WITHIN = 14000
/** trees on the ranges, in real metres (placed and scaled into the compression by createRangeForest) */
const rangeTrees: { x: number; z: number; y: number; h: number; tone: number; pick: number; conifer: boolean }[] = []

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
  if (range.real < TREES_WITHIN) plantRange(range, position, cols, rows)
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

/**
 * Trees for a range (real metres, before the mapping): a dense line along its
 * silhouette — for each column, the point seen highest from the eye, where
 * trees stand against the sky and give the ridge a ragged, wooded edge — and
 * stands on its slopes, clumped by noise, below the rocky crests.
 */
function plantRange(range: Range, position: Float32Array, cols: number, rows: number): void {
  const rand = seeded(90 + range.seed)
  const eyeAboveLake = EYE - SITE.lakeLevel
  const at = (i: number, j: number) => (j * (cols + 1) + i) * 3
  for (let i = 0; i < cols; i++) {
    // the silhouette row of this column: highest elevation angle from the eye
    let best = 0
    let bestAngle = -Infinity
    for (let j = 0; j <= rows; j++) {
      const k = at(i, j)
      const angle = (position[k + 1] - eyeAboveLake) / Math.hypot(position[k], position[k + 2])
      if (angle > bestAngle) {
        bestAngle = angle
        best = j
      }
    }
    // a few trees along the crest, spread across the column (interpolated between its two vertices)
    const a = at(i, best)
    const b = at(i + 1, best)
    const perColumn = 3 + Math.floor(rand() * 3)
    for (let t = 0; t < perColumn; t++) {
      if (rand() < 0.2) continue // gaps
      const f = rand()
      rangeTrees.push({
        x: position[a] + (position[b] - position[a]) * f,
        z: position[a + 2] + (position[b + 2] - position[a + 2]) * f,
        y: position[a + 1] + (position[b + 1] - position[a + 1]) * f - 2,
        h: 16 * Math.exp((rand() - 0.5) * 0.5),
        tone: rand(),
        pick: rand(),
        conifer: rand() < 0.65,
      })
    }
    // stands on the slopes: clumped, not on every vertex, not on the bare crests
    for (let j = 1; j < rows; j++) {
      const k = at(i, j)
      const clump = fbm(i * 0.11 + range.seed * 3, j * 0.35, 3)
      if (clump < 0.5 || rand() > 0.55) continue
      const n = 1 + Math.floor(rand() * 3)
      for (let t = 0; t < n; t++) {
        const k2 = at(i + 1, j)
        const f = rand()
        rangeTrees.push({
          x: position[k] + (position[k2] - position[k]) * f,
          z: position[k + 2] + (position[k2 + 2] - position[k + 2]) * f,
          y: position[k + 1] + (position[k2 + 1] - position[k + 1]) * f - 3,
          h: 15 * Math.exp((rand() - 0.5) * 0.5),
          tone: rand() * 0.6,
          pick: rand(),
          conifer: rand() < 0.6,
        })
      }
    }
  }
}

/** the ranges' trees as impostors (the forest's atlas), mapped into the far distance like the ranges themselves */
export function createRangeForest(impostors: ImpostorSet): THREE.Group {
  const group = new THREE.Group()
  group.name = 'range-forest'
  const plants: Plant[] = []
  const where = new Map<Plant, { y: number; scale: number; real: number }>()
  for (const t of rangeTrees) {
    const real = Math.hypot(t.x, t.z)
    const { distance, scale } = farPlacement(real)
    const plan: Plant = {
      x: (t.x * distance) / real,
      z: (t.z * distance) / real,
      kind: t.conifer ? 'conifer' : 'broadleaf',
      height: t.h * scale,
      width: 0.85 + t.tone * 0.4,
      turn: t.pick * Math.PI * 2,
      leanX: 0,
      leanZ: 0,
      tone: t.tone * 0.5, // distant woods: the darker end
      pick: t.pick,
    }
    plants.push(plan)
    where.set(plan, { y: farY(t.y, scale), scale, real })
  }
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  plantImpostors(
    impostors,
    plants,
    () => 0,
    (spot, h) => {
      const w = h * spot.plan.width
      return m.compose(new THREE.Vector3(spot.plan.x, where.get(spot.plan)!.y, spot.plan.z), q.setFromAxisAngle(up, spot.plan.turn), new THREE.Vector3(w, h, w))
    },
    group,
  )
  // (the far shadow map is laid out for the real-scale land; the compressed ranges keep out of it)
  group.traverse((o) => {
    o.castShadow = false
    o.raycast = () => {}
  })
  console.info(`[garage] range forest: ${plants.length} impostor trees on the ranges`)
  return group
}

export function createRanges(): THREE.Group {
  rangeTrees.length = 0 // a fresh visit to the garage plants afresh
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }))
  const group = new THREE.Group()
  group.name = 'ranges'
  for (const range of RANGES) group.add(noRaycast(new THREE.Mesh(createRange(range), material)))
  return group
}
