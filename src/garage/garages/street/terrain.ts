import * as THREE from 'three'
import { fbm, noRaycast, polarGrid, smoothstep } from '../landform'
import { outdoorMaterial } from '../terrain'
import { heightAt, hills, outOfTown } from './site'

/**
 * The ground round the town out to the far mountains, one polar mesh (11 km):
 * rings fine by the streets, coarse on the ranges. Coloured per vertex — town
 * ground and gardens along the valley, scrub and fields on the lower flanks,
 * forest over the hills (the woods and their trees come in a later layer),
 * rock where it's steep and high. The houses hide the ground along the
 * streets; it only has to meet them.
 */

const lin = (hex: string) => new THREE.Color(hex)
const TOWN = lin('#6e6250')
const SCRUB = lin('#6a6a3e')
const FIELD = lin('#7d7a48')
const FOREST = lin('#34482a')
const FOREST_DARK = lin('#26371f')
const ROCK = lin('#7b7466')

export function createStreetTerrain(): THREE.Mesh {
  const c = new THREE.Color()
  const geometry = polarGrid(11000, 520, 1024, (t) => t ** 2.6, (x, z, _t, _a, color) => {
    const y = heightAt(x, z)
    const out = outOfTown(x, z)
    const lift = hills(x, z, out)
    // how wooded: the hills are forest, broken by fields on their lower slopes and clearings
    const wood = smoothstep(lift, 8, 60) * smoothstep(fbm(x / 420 + 11, z / 420 - 3, 4), 0.34, 0.5)
    const field = (1 - wood) * smoothstep(out, 60, 300) * smoothstep(fbm(x / 160, z / 160, 3), 0.45, 0.6)
    c.copy(TOWN).lerp(SCRUB, smoothstep(out, 0, 200)).lerp(FIELD, field).lerp(FOREST, wood)
    c.lerp(FOREST_DARK, wood * smoothstep(fbm(x / 90, z / 90, 3), 0.4, 0.7))
    // the high ranges: bare rock above the tree line
    c.lerp(ROCK, smoothstep(y, 700, 1000))
    color.copy(c).multiplyScalar(0.9 + 0.2 * fbm(x / 30, z / 30, 2))
    return y
  })
  geometry.computeVertexNormals()
  // steep ground shows rock and bare earth
  const normal = geometry.getAttribute('normal')
  const color = geometry.getAttribute('color')
  for (let i = 0; i < normal.count; i++) {
    const steep = 1 - smoothstep(normal.getY(i), 0.7, 0.9)
    if (steep <= 0) continue
    c.setRGB(color.getX(i), color.getY(i), color.getZ(i)).lerp(ROCK, steep * 0.7)
    color.setXYZ(i, c.r, c.g, c.b)
  }
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }))
  const mesh = noRaycast(new THREE.Mesh(geometry, material))
  mesh.name = 'street-terrain'
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.ground = true // walk mode stands on it (it skips raycasts otherwise)
  return mesh
}

