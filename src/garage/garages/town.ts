import * as THREE from 'three'
import { fbm, noRaycast, seeded, smoothstep } from './landform'
import { SITE, forestDensity, heightAt, lakeShape, onRoad, roadZ } from './site'
import { outdoorMaterial } from './terrain'

/**
 * The lakeside towns, as around Kawaguchiko: houses packed along the near
 * shore below the pavilion and strung along the far shore, thinning up the
 * slopes, with a few hotels by the water. At a kilometre or three a house is
 * a few pixels — a pale wall, a dark roof — so they're boxes and hipped roofs,
 * instanced; what sells a town is how many there are and how they cluster.
 */

interface House {
  x: number
  z: number
  w: number
  d: number
  h: number
  turn: number
  /** a hotel or apartment block rather than a house */
  block: boolean
}

/** town centres: [x, z, radius, how many houses to try] — near shore, far shore, the shores to the sides */
const CENTRES: [number, number, number, number][] = [
  [-700, -1000, 520, 520],
  [350, -960, 420, 380],
  [1350, -1180, 380, 220],
  [-1600, -1450, 380, 160],
  [-500, -2950, 700, 420],
  [900, -2900, 520, 300],
  [1900, -2250, 360, 140],
]

/** is this a place a house could stand? */
function buildable(x: number, z: number): boolean {
  const r = Math.hypot(x, z)
  if (r < 350 || r > SITE.realRadius - 60) return false
  const lake = lakeShape(x, z)
  if (lake < 1.04) return false // not in the water
  if (onRoad(x, z) > 0 || Math.abs(z - roadZ(x)) < 14) return false
  if (forestDensity(x, z) > 0.15) return false // clearings: not under the canopy
  // not on steep ground
  const e = 6
  const slope = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
  return slope < 0.3
}

function placeHouses(): House[] {
  const rand = seeded(83)
  const houses: House[] = []
  // a coarse grid of what's taken, so spacing checks stay cheap with ~2,000 houses
  const CELL = 20
  const taken = new Map<string, House[]>()
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
  const crowded = (x: number, z: number, gap: number) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const o of taken.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < gap) return true
    return false
  }
  for (const [cx, cz, radius, tries] of CENTRES) {
    // each town's streets run one way, bent a little across it
    const grain = rand() * Math.PI
    for (let t = 0; t < tries * 3 && tries > 0; t++) {
      // denser toward the centre and toward the water
      const a = rand() * Math.PI * 2
      const r = radius * Math.sqrt(rand()) * (0.6 + 0.4 * rand())
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r * 0.7
      const shore = 1 - smoothstep(lakeShape(x, z), 1.05, 1.5)
      if (rand() > 0.35 + 0.65 * shore * (1 - (r / radius) * 0.6)) continue
      // patchy: fields and gardens between neighbourhoods
      if (fbm(x / 90 + 13, z / 90 - 2, 2) < 0.42) continue
      if (!buildable(x, z)) continue
      const block = shore > 0.75 && rand() < 0.05
      const gap = block ? 30 : 13
      if (crowded(x, z, gap)) continue
      const house: House = {
        x,
        z,
        w: block ? 18 + rand() * 20 : 7 + rand() * 5,
        d: block ? 12 + rand() * 8 : 6 + rand() * 4,
        h: block ? 12 + rand() * 16 : 4 + rand() * 3,
        turn: grain + 0.3 * (fbm(x / 400, z / 400, 2) - 0.5) + (rand() < 0.3 ? Math.PI / 2 : 0),
        block,
      }
      houses.push(house)
      const k = key(x, z)
      taken.set(k, [...(taken.get(k) ?? []), house])
    }
  }
  return houses
}

export function createTown(): THREE.Group {
  const houses = placeHouses()
  const walls = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }))
  const tiles = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.1 }))
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), walls, houses.length)
  // hipped roofs on the houses (a four-sided pyramid turned square to the walls, overhanging them);
  // blocks get a flat roof — the body's own top
  const roofed = houses.filter((h) => !h.block)
  const roof = new THREE.InstancedMesh(
    new THREE.ConeGeometry(Math.SQRT1_2 * 1.15, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    tiles,
    roofed.length,
  )
  const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
  const wallColors = [0xece6da, 0xdcd6cc, 0xf3f0ea, 0xcdbfa8, 0xb9b3aa, 0xe2d9c5].map(srgb)
  const blockColors = [0xe9e6df, 0xd0cbc2, 0xbfc3c6].map(srgb)
  const roofColors = [0x3a4250, 0x2f3238, 0x55463c, 0x444c58, 0x6a4a3a, 0x3e5a6a].map(srgb)
  const rand = seeded(91)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  let r = 0
  houses.forEach((s, i) => {
    // sunk a little so a house on a slope has no gap under its downhill side
    const y = heightAt(s.x, s.z) - 1.2
    q.setFromAxisAngle(up, s.turn)
    body.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.w, s.h + 1.2, s.d)))
    const colors = s.block ? blockColors : wallColors
    body.setColorAt(i, colors[Math.floor(rand() * colors.length)])
    if (s.block) return
    roof.setMatrixAt(r, m.compose(new THREE.Vector3(s.x, y + s.h + 1.2, s.z), q, new THREE.Vector3(s.w, 1.8 + rand() * 1.2, s.d)))
    roof.setColorAt(r, roofColors[Math.floor(rand() * roofColors.length)])
    r++
  })
  const group = new THREE.Group()
  group.name = 'town'
  for (const o of [body, roof]) {
    o.castShadow = true
    o.receiveShadow = true
    o.computeBoundingSphere()
    group.add(noRaycast(o))
  }
  console.info(`[garage] town: ${houses.length} buildings`)
  return group
}
