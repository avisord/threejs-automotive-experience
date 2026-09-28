import * as THREE from 'three'
import { fbm, noRaycast, seeded, smoothstep } from '../landform'
import { outdoorMaterial } from '../terrain'
import { FAMILIES, UPPER, type FamilyId } from './lots'
import { CHURCH, FRONT, MAIN, SIDES, heightAt, hills, outOfTown, streetY } from './site'

/**
 * The rest of the town, past the streets' own houses: blocks of houses up the
 * valley's flanks and along it, in the same families' paints, some under
 * tiled roofs, laid out in blocks with lanes between (a street grid turned
 * with the valley — attached houses round each block, courtyards inside)
 * and thinning as the ground climbs into the hills. From the
 * street they're rooftops over the rooftops; from above, the town. Instanced:
 * one draw for the walls, one for the tiled roofs.
 */

const lin = (hex: string) => new THREE.Color(hex)
/** the flat roofs' concrete and the tiles' terracotta, varied per house */
const ROOF = lin('#a4968a')
const TILE = lin('#a24e35')

/** a unit box standing on y = 0, its top face flagged (the flat roof takes its own colour) */
function houseGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)
  const normal = g.getAttribute('normal')
  const roof = new Float32Array(normal.count)
  for (let i = 0; i < normal.count; i++) roof[i] = normal.getY(i) > 0.5 ? 1 : 0
  g.setAttribute('roof', new THREE.BufferAttribute(roof, 1))
  // (the bottom never shows)
  return g
}

/** a gabled roof over a unit footprint: ridge along x, height 1 */
function roofGeometry(): THREE.BufferGeometry {
  const e = 0.54 // (eaves over the walls)
  const p = [
    [-e, 0, -e], [e, 0, -e], [e, 1, 0], [-e, 1, 0], // back slope
    [e, 0, e], [-e, 0, e], [-e, 1, 0], [e, 1, 0], // front slope
  ]
  const index = [0, 3, 2, 0, 2, 1, 4, 7, 6, 4, 6, 5, 1, 2, 7, 1, 7, 4, 5, 6, 3, 5, 3, 0]
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(p.flat(), 3))
  g.setIndex(index)
  const flat = g.toNonIndexed()
  flat.computeVertexNormals()
  g.dispose()
  return flat
}

/** flat roofs in their own colour (per house), not the walls' paint */
function withRoofs(material: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRoof = { value: ROOF }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float roof;\nuniform vec3 uRoof;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        {
          float h = fract( sin( float( gl_InstanceID ) * 12.9898 ) * 43758.5453 );
          vColor.rgb = mix( vColor.rgb, uRoof * ( 0.8 + 0.35 * h ), roof );
        }`,
      )
  }
  material.customProgramCacheKey = () => 'street-town-roofs'
  return material
}

/** is (x, z) on one of the streets' own house plots (or its road) */
function onStreetPlots(x: number, z: number): boolean {
  const m = MAIN.nearest(x, z)
  if (m.s > MAIN.start - 10 && m.s < MAIN.end + 10 && Math.abs(m.d) < FRONT + 20) return true
  // the church and its plaza
  if (Math.hypot(m.s - CHURCH.s, m.d - CHURCH.d - 12) < 42) return true
  for (const j of SIDES) {
    if (!j.street.near(x, z, 40)) continue
    const n = j.street.nearest(x, z)
    if (n.s > -5 && n.s < j.houses + 22 && Math.abs(n.d) < j.street.width / 2 + j.street.sidewalk + 17) return true
  }
  return false
}

interface House {
  x: number
  y: number
  z: number
  /** across the valley (local x) × along it (local z) */
  w: number
  d: number
  h: number
  turn: number
  wall: THREE.Color
  tiled: boolean
}

/** the town's blocks: 56 m along the valley × 44 m across, lanes between */
const BLOCK = { along: 56, across: 44, lane: 7 }

export function createTown(): { group: THREE.Group } {
  const group = new THREE.Group()
  group.name = 'street-town'
  const rand = seeded(777)
  const families = Object.values(FAMILIES)
  const houses: House[] = []
  const chalk = lin('#d9d3c7')

  /** one house on a block's edge: `s`, `d` its centre in the valley's frame, `along`/`across` its size */
  const house = (s: number, d: number, along: number, across: number, storeys: number, family: (typeof families)[number]) => {
    const p = MAIN.at(s, d)
    if (onStreetPlots(p.x, p.y)) return
    const f = MAIN.frame(s)
    const ground = heightAt(p.x, p.y)
    const slope = Math.abs(streetY(p.x + 5, p.y) - streetY(p.x - 5, p.y)) + Math.abs(streetY(p.x, p.y + 5) - streetY(p.x, p.y - 5))
    const sink = 1.2 + slope
    houses.push({
      x: p.x,
      y: ground - sink,
      z: p.y,
      w: across,
      d: along,
      h: sink + family.ground + (storeys - 1) * UPPER + 0.7,
      turn: Math.atan2(f.tx, f.tz),
      wall: lin(family.walls[Math.floor(rand() * family.walls.length)]).lerp(chalk, rand() * 0.35),
      tiled: family.roof === 'tiled' || rand() < 0.3,
    })
  }

  /**
   * A block as the colonial grid builds it: houses shoulder to shoulder round its
   * edge, fronts on the lanes, the courtyards and gardens in the middle. `fill`:
   * how much of the edge is built (the fringe blocks up the slopes are gappy).
   */
  const block = (s0: number, d0: number, fill: number) => {
    const depth = () => 9 + rand() * 4
    let previous = 2
    let recent: FamilyId[] = []
    const next = () => {
      const options = families.filter((f) => !recent.includes(f.id))
      const family = options[Math.floor(rand() * options.length)]
      recent = [...recent.slice(-1), family.id]
      const r = rand()
      let storeys = r < 0.3 ? 1 : r < 0.85 ? 2 : 3
      if (Math.abs(storeys - previous) > 1) storeys = previous + Math.sign(storeys - previous)
      previous = storeys
      return { family, storeys }
    }
    // the two long edges (along the valley), their houses the block's full corner depth at the ends
    for (const edge of [0, 1]) {
      const dd = depth()
      const d = edge ? d0 + BLOCK.across - dd / 2 : d0 + dd / 2
      let s = s0
      while (s < s0 + BLOCK.along - 3) {
        const w = Math.min(s0 + BLOCK.along - s, 6 + rand() * 7)
        const { family, storeys } = next()
        if (rand() < fill) house(s + w / 2, d, w, dd, storeys, family)
        s += w
      }
    }
    // the short edges, between the long edges' houses
    for (const edge of [0, 1]) {
      const dd = depth()
      const s = edge ? s0 + BLOCK.along - dd / 2 : s0 + dd / 2
      let d = d0 + 12
      while (d < d0 + BLOCK.across - 12 - 3) {
        const w = Math.min(d0 + BLOCK.across - 12 - d, 6 + rand() * 6)
        const { family, storeys } = next()
        if (rand() < fill) house(s, d + w / 2, dd, w, storeys, family)
        d += w
      }
    }
  }

  const pitchS = BLOCK.along + BLOCK.lane
  const pitchD = BLOCK.across + BLOCK.lane
  for (let i = -12; i < 18; i++) {
    for (let j = -12; j < 12; j++) {
      const s0 = i * pitchS + 20
      // (the first blocks either side start behind the main street's own house plots)
      const d0 = j >= 0 ? FRONT + 19 + j * pitchD : -(FRONT + 19) - (-j) * pitchD + BLOCK.lane
      const c = MAIN.at(s0 + BLOCK.along / 2, d0 + BLOCK.across / 2)
      const out = outOfTown(c.x, c.y)
      const lift = hills(c.x, c.y, out)
      // dense along the valley, thinning up the flanks and out of town, none up in the hills
      const density = (1 - smoothstep(out, 20, 280)) * (1 - smoothstep(lift, 8, 40)) * (0.7 + 0.3 * smoothstep(fbm(c.x / 260, c.y / 260, 3), 0.3, 0.55))
      if (density < 0.08 || rand() > density + 0.25) continue
      block(s0, d0, Math.min(1, 0.3 + density))
    }
  }

  const wallMaterial = outdoorMaterial(withRoofs(new THREE.MeshStandardMaterial({ roughness: 0.92 })))
  const walls = new THREE.InstancedMesh(houseGeometry(), wallMaterial, houses.length)
  const tiled = houses.filter((h) => h.tiled)
  const roofs = new THREE.InstancedMesh(roofGeometry(), outdoorMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85 })), tiled.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const pos = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const tile = new THREE.Color()
  houses.forEach((h, i) => {
    q.setFromAxisAngle(up, h.turn)
    walls.setMatrixAt(i, m.compose(pos.set(h.x, h.y, h.z), q, scale.set(h.w, h.h, h.d)))
    walls.setColorAt(i, h.wall)
  })
  tiled.forEach((h, i) => {
    q.setFromAxisAngle(up, h.turn)
    roofs.setMatrixAt(i, m.compose(pos.set(h.x, h.y + h.h - 0.7, h.z), q, scale.set(h.w, Math.min(h.w, h.d) * 0.2, h.d)))
    roofs.setColorAt(i, tile.copy(TILE).multiplyScalar(0.75 + rand() * 0.45))
  })
  for (const mesh of [walls, roofs]) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.computeBoundingSphere()
    group.add(noRaycast(mesh))
  }
  walls.name = 'town-houses'
  roofs.name = 'town-roofs'
  return { group }
}
