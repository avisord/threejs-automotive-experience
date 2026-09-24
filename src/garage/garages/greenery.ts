import * as THREE from 'three'
import { noRaycast, noise, seeded, smoothstep } from './landform'
import { SITE, heightAt, lakeShape, onRoad, roadZ } from './site'
import { PARCEL, farmland, outdoorMaterial } from './terrain'
import type { House } from './town'
import { farTreeGeometry } from './trees'

/**
 * The small green things that make a valley look lived in from a distance:
 * garden trees between the houses, and hedgerows and tree lines along the
 * field boundaries. Each is a few pixels, so they're the far trees' simple
 * crowns (trees.ts), instanced; what matters is that there are thousands
 * and that they follow the town and the fields' grain.
 */
/** closer than this the simple crowns show their facets: trees.ts's real trees stand there */
const NEAREST = 450

export function createGreenery(houses: House[]): THREE.Group {
  const rand = seeded(61)
  type Spot = { x: number; z: number; h: number; w: number; conifer: boolean }
  const spots: Spot[] = []
  const clear = (x: number, z: number) =>
    lakeShape(x, z) > 1.03 && onRoad(x, z) === 0 && Math.abs(z - roadZ(x)) > 9 && Math.hypot(x, z) > NEAREST

  // garden trees: most houses have one or two, a little off the walls
  for (const house of houses) {
    if (house.block) continue
    const n = rand() < 0.6 ? 1 + Math.floor(rand() * 2) : 0
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.max(house.w, house.d) * 0.5 + 3 + rand() * 4
      const x = house.x + Math.cos(a) * d
      const z = house.z + Math.sin(a) * d
      if (clear(x, z)) spots.push({ x, z, h: 6 + rand() * 6, w: 1, conifer: rand() < 0.35 })
    }
  }

  // hedgerows and tree lines on some of the field boundaries (across the grain, every PARCEL metres),
  // in runs with gaps: a shrub every ~5 m, and now and then a taller tree standing out of the line
  const R = SITE.realRadius
  for (let k = Math.floor(-R / PARCEL); k <= R / PARCEL; k++) {
    const u = k * PARCEL
    for (let v = -R; v <= R; v += 4.5 + rand() * 2) {
      if (noise(k * 0.9 + 0.3, v / 90) < 0.52) continue // runs and gaps
      // back to the ground plane (the inverse of terrain.parcelSpace, a rotation)
      const x = u * 0.956 - v * 0.292 + (rand() - 0.5) * 1.5
      const z = u * 0.292 + v * 0.956 + (rand() - 0.5) * 1.5
      const r = Math.hypot(x, z)
      if (r > 2700 || farmland(x, z) < 0.5 || !clear(x, z)) continue
      const tall = rand() < 0.12
      spots.push({ x, z, h: tall ? 9 + rand() * 7 : 3 + rand() * 2.5, w: tall ? 1 : 1.5 + rand(), conifer: tall && rand() < 0.4 })
    }
  }
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
  const group = new THREE.Group()
  group.name = 'greenery'
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const c = new THREE.Color()
  for (const conifer of [false, true]) {
    const mine = spots.filter((s) => s.conifer === conifer)
    const mesh = new THREE.InstancedMesh(farTreeGeometry(conifer), material, mine.length)
    mine.forEach((s, i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2)
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, heightAt(s.x, s.z) - 0.3, s.z), q, new THREE.Vector3(s.h * s.w, s.h, s.h * s.w)))
      // deep summer greens, a few yellower; darker than grass so the lines read against the fields
      const t = rand()
      c.setHSL(conifer ? 0.3 : 0.24 + t * 0.06, 0.3 + t * 0.2, (conifer ? 0.1 : 0.14) + t * 0.07 + smoothstep(t, 0.9, 1) * 0.05, THREE.SRGBColorSpace)
      mesh.setColorAt(i, c)
    })
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    group.add(noRaycast(mesh))
  }
  console.info(`[garage] greenery: ${spots.length} garden trees and hedgerow shrubs`)
  return group
}
