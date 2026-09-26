import * as THREE from 'three'
import type { ImpostorSet } from './impostors'
import { noise, seeded } from './landform'
import { heightAt, lakeShape, onRoad, roadZ } from './site'
import { DISTRICT, type District, district, districtBoundary, fHash, fieldAt, segmentLength, stripBoundary, stripEdge, unlocal, unwarp } from './fields'
import { farmland } from './terrain'
import type { House } from './town'
import { plantImpostors } from './trees'
import type { Plant } from './vegetation-layout'
/**
 * The small green things that make a valley look lived in from a distance:
 * garden trees between the houses, and hedgerows and tree lines along the
 * field boundaries. Each is a few pixels, so they're the far trees' simple
 * crowns (trees.ts), instanced; what matters is that there are thousands
 * and that they follow the town and the fields' grain.
 */
/** closer than this, the valley's own planned trees (trees.ts) stand in the gardens */
const NEAREST = 300

/**
 * Garden trees and shrubs around the village houses, and hedgerows along the
 * field boundaries — as impostors (the forest's atlas): real tree silhouettes,
 * 4 triangles each. Gardens are small clumps, not one tree per house: a tree or
 * three and a shrub or two, of mixed size, crowns touching the eaves.
 */
export function createGreenery(houses: House[], impostors: ImpostorSet): THREE.Group {
  const rand = seeded(61)
  const plants: Plant[] = []
  const clear = (x: number, z: number) =>
    lakeShape(x, z) > 1.03 && onRoad(x, z) === 0 && Math.abs(z - roadZ(x)) > 9 && Math.hypot(x, z) > NEAREST
  const onHouse = (x: number, z: number, near: House[]) => near.some((h) => Math.hypot(h.x - x, h.z - z) < Math.max(h.w, h.d) * 0.55 + 1)
  const add = (x: number, z: number, kind: Plant['kind'], height: number, tone: number, width = 0.8 + rand() * 0.5) =>
    plants.push({
      x,
      z,
      kind,
      height,
      width,
      turn: rand() * Math.PI * 2,
      leanX: (rand() - 0.5) * 0.08,
      leanZ: (rand() - 0.5) * 0.08,
      tone,
      pick: rand(),
    })

  // gardens: most houses have a clump of a few trees and shrubs round the back or side
  houses.forEach((house, i) => {
    const neighbours = houses.slice(Math.max(0, i - 40), i + 40)
    const clump = rand() < 0.8 ? 1 + Math.floor(rand() * 3) : 0
    const side = rand() * Math.PI * 2
    const tone = rand()
    for (let t = 0; t < clump; t++) {
      const a = side + (rand() - 0.5) * 1.6
      const d = Math.max(house.w, house.d) * 0.55 + 2 + rand() * 6
      const x = house.x + Math.cos(a) * d
      const z = house.z + Math.sin(a) * d
      if (!clear(x, z) || onHouse(x, z, neighbours)) continue
      // log-normal-ish: mostly 7–11 m garden trees, the odd tall one
      const h = (house.block ? 9 : 8) * Math.exp((rand() - 0.5) * 0.6) * (rand() < 0.08 ? 1.5 : 1)
      add(x, z, rand() < 0.3 ? 'conifer' : 'broadleaf', h, tone)
    }
    const shrubs = Math.floor(rand() * 3)
    for (let t = 0; t < shrubs; t++) {
      const a = rand() * Math.PI * 2
      const d = Math.max(house.w, house.d) * 0.55 + 1 + rand() * 3
      const x = house.x + Math.cos(a) * d
      const z = house.z + Math.sin(a) * d
      if (clear(x, z) && !onHouse(x, z, neighbours)) add(x, z, 'shrub', 1.4 + rand() * 1.6, tone)
    }
  })

  // The farmland's boundaries (fields.ts — the same layout the terrain draws): hedgerows in runs
  // with gaps, tree lines, tree belts along the ditches between districts, copses in field corners.
  // Trees gather where the land is divided, not scattered evenly over it.
  const farmed = (x: number, z: number) => {
    const r = Math.hypot(x, z)
    return r < 2950 && farmland(x, z) > 0.5 && clear(x, z)
  }
  const same = (a: District, b: District) => a.i === b.i && a.j === b.j
  const reach = DISTRICT * 1.2
  const cells = Math.ceil(3100 / DISTRICT) + 1
  let hedges = 0
  for (let i = -cells; i <= cells; i++) {
    for (let j = -cells; j <= cells; j++) {
      const d = district(i, j)
      if (Math.hypot(d.sx, d.sz) > 3100 + DISTRICT) continue
      // back from the district's frame to the ground, kept only if it's really inside this district
      const ground = (u: number, v: number): [number, number] | null => {
        const [x, z] = unwarp(...unlocal(d, u, v))
        return same(fieldAt(x, z).district, d) && farmed(x, z) ? [x, z] : null
      }
      for (let k = Math.floor(-reach / d.width); k <= Math.ceil(reach / d.width); k++) {
        const kind = stripBoundary(d, k)
        const u = stripEdge(d, k)
        const tone = rand()
        if (kind === 2 || kind === 3) {
          // a hedge is a continuous mass: wide shrubs close together, their crowns merging
          for (let v = -reach; v <= reach; v += kind === 2 ? 2.2 + rand() * 1.6 : 7 + rand() * 6) {
            if (noise(k * 0.9 + i * 3.1, v / 80 + j * 5.3) < (kind === 2 ? 0.42 : 0.36)) continue // runs and gaps
            const at = ground(u + (rand() - 0.5) * 1.2, v)
            if (!at) continue
            const tall = kind === 3 ? rand() < 0.7 : rand() < 0.1
            if (tall) add(at[0], at[1], rand() < 0.3 ? 'conifer' : 'broadleaf', 9 + rand() * 8, tone)
            else add(at[0], at[1], 'shrub', 2.8 + rand() * 1.8, tone, 1.3 + rand() * 0.6)
            hedges++
          }
        }
        // a copse in the odd field corner: a few trees of mixed size, round a bigger one
        const L = segmentLength(d, k)
        for (let v = -reach; v <= reach; v += L) {
          if (fHash(i * 977 + k, j * 613 + Math.round(v / L), 40) > 0.045) continue
          const n = 3 + Math.floor(rand() * 7)
          const ct = rand()
          for (let t = 0; t < n; t++) {
            const a = rand() * Math.PI * 2
            const rr = 14 * Math.sqrt(rand())
            const at = ground(u + 4 + Math.abs(Math.cos(a) * rr), v + Math.sin(a) * rr)
            if (!at) continue
            add(at[0], at[1], rand() < 0.35 ? 'conifer' : rand() < 0.25 ? 'shrub' : 'broadleaf', (t === 0 ? 15 : 8) + rand() * 6, ct)
            hedges++
          }
        }
      }
      // the district's edges: ditches carry a belt of trees and scrub; farm roads the odd tree
      for (let a = -1; a <= 1; a++) {
        for (let b = -1; b <= 1; b++) {
          if (a < 0 || (a === 0 && b <= 0)) continue // each edge once
          const o = district(i + a, j + b)
          const ditch = districtBoundary(d, o) === 1
          const mx = (d.sx + o.sx) / 2
          const mz = (d.sz + o.sz) / 2
          const len = Math.hypot(o.sx - d.sx, o.sz - d.sz)
          const px = -(o.sz - d.sz) / len
          const pz = (o.sx - d.sx) / len
          const tone = rand()
          for (let t = -DISTRICT; t <= DISTRICT; t += ditch ? 4 + rand() * 4 : 30 + rand() * 40) {
            if (ditch && noise(i * 7.1 + a * 3.3 + b, t / 70 + j * 1.7) < 0.3) continue
            const side = (rand() - 0.5) * (ditch ? 8 : 12)
            const [x, z] = unwarp(mx + px * t + (o.sx - d.sx) / len * side, mz + pz * t + (o.sz - d.sz) / len * side)
            const hit = fieldAt(x, z)
            if (hit.edgeDistrict > 7 || !(same(hit.district, d) || same(hit.district, o)) || !farmed(x, z)) continue
            const tall = ditch ? rand() < 0.75 : true
            add(x, z, tall ? (rand() < 0.2 ? 'conifer' : 'broadleaf') : 'shrub', tall ? 10 + rand() * 9 : 3 + rand() * 2, tone)
            hedges++
          }
        }
      }
    }
  }

  const group = new THREE.Group()
  group.name = 'greenery'
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const place = (spot: { x: number; z: number; plan: Plant }, h: number) => {
    const p = spot.plan
    q.setFromEuler(e.set(p.leanX, p.turn, p.leanZ))
    const w = h * p.width
    return m.compose(new THREE.Vector3(p.x, heightAt(p.x, p.z) - 0.3, p.z), q, new THREE.Vector3(w, h, w))
  }
  plantImpostors(impostors, plants, heightAt, place, group)
  console.info(`[garage] greenery: ${plants.length} plants (${hedges} on field boundaries)`)
  return group
}
