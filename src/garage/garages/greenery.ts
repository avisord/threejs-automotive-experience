import * as THREE from 'three'
import type { ImpostorSet } from './impostors'
import { noise, seeded } from './landform'
import { SITE, heightAt, lakeShape, onRoad, roadZ } from './site'
import { PARCEL, farmland } from './terrain'
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
  const add = (x: number, z: number, kind: Plant['kind'], height: number, tone: number) =>
    plants.push({
      x,
      z,
      kind,
      height,
      width: 0.8 + rand() * 0.5,
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

  // hedgerows and tree lines on some of the field boundaries (across the grain, every PARCEL metres),
  // in runs with gaps: a shrub every few metres, now and then a taller tree standing out of the line
  const R = SITE.realRadius
  for (let k = Math.floor(-R / PARCEL); k <= R / PARCEL; k++) {
    const u = k * PARCEL
    const tone = rand()
    for (let v = -R; v <= R; v += 3.5 + rand() * 2.5) {
      if (noise(k * 0.9 + 0.3, v / 90) < 0.52) continue // runs and gaps
      // back to the ground plane (the inverse of terrain.parcelSpace, a rotation)
      const x = u * 0.956 - v * 0.292 + (rand() - 0.5) * 1.5
      const z = u * 0.292 + v * 0.956 + (rand() - 0.5) * 1.5
      if (Math.hypot(x, z) > 2700 || farmland(x, z) < 0.5 || !clear(x, z)) continue
      const tall = rand() < 0.13
      add(x, z, tall ? (rand() < 0.4 ? 'conifer' : 'broadleaf') : 'shrub', tall ? 9 + rand() * 7 : 2.5 + rand() * 2, tone)
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
  console.info(`[garage] greenery: ${plants.length} garden trees, shrubs and hedgerow plants`)
  return group
}
