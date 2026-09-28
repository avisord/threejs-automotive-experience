import * as THREE from 'three'
import { noRaycast, seeded } from '../landform'
import { Wires, colour, merged, trackPixel } from './infra'
import type { Buildings } from './buildings'
import { FRONT, MAIN, ROAD, SIDES, SIDE_ROAD, streetY } from './site'

/**
 * The season's layer, over the town rather than instead of it (Menu › Garage ›
 * Scene › Festive decorations): strings of small bulbs slung across the main
 * street from house to house, giant striped candy canes and wrapped gifts
 * by a few shop doors and heaped on the pavement by the garden, wreaths on
 * some front doors. The bulbs are the Festive lights group's emissive — a
 * faint glint by day, a canopy of lights at dusk.
 */

const lin = (hex: string) => new THREE.Color(hex)

/** a candy cane 2.4 m tall: a striped shaft and its hook, red spiralling round white */
function candyCane(): THREE.BufferGeometry {
  const red = lin('#c3201f')
  const white = lin('#f4f1ea')
  const stripe = (g: THREE.BufferGeometry, along: (p: THREE.Vector3) => number) => {
    const pos = g.getAttribute('position')
    const c = new Float32Array(pos.count * 3)
    const p = new THREE.Vector3()
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      const col = along(p) % 1 < 0.5 ? red : white
      c.set([col.r, col.g, col.b], i * 3)
    }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3))
    return g
  }
  const shaft = stripe(new THREE.CylinderGeometry(0.1, 0.1, 2.0, 16, 48).translate(0, 1.0, 0), (p) => p.y * 2.2 + Math.atan2(p.z, p.x) / (Math.PI * 2) + 10)
  const hook = stripe(
    new THREE.TorusGeometry(0.3, 0.1, 12, 32, Math.PI).translate(-0.3, 2.0, 0),
    (p) => Math.atan2(p.y - 2.0, p.x + 0.3) * 1.3 + Math.atan2(p.z, Math.hypot(p.x + 0.3, p.y - 2.0) - 0.3) / (Math.PI * 2) + 10,
  )
  return merged([shaft, hook])
}

/** a wrapped box with a ribbon round it both ways and a bow */
function gift(): { box: THREE.BufferGeometry; ribbon: THREE.BufferGeometry } {
  const white = lin('#ffffff')
  const gold = lin('#e9c35a')
  return {
    box: colour(new THREE.BoxGeometry(0.6, 0.45, 0.5).translate(0, 0.225, 0), white),
    ribbon: merged([
      colour(new THREE.BoxGeometry(0.62, 0.46, 0.08).translate(0, 0.225, 0), gold),
      colour(new THREE.BoxGeometry(0.08, 0.46, 0.52).translate(0, 0.225, 0), gold),
      colour(new THREE.TorusGeometry(0.07, 0.025, 6, 12).rotateY(0.6).translate(-0.06, 0.5, 0), gold),
      colour(new THREE.TorusGeometry(0.07, 0.025, 6, 12).rotateY(-0.6).translate(0.06, 0.5, 0), gold),
    ]),
  }
}

/** a wreath for a door, facing +z, with a red bow at its foot */
function wreath(): THREE.BufferGeometry {
  return merged([
    colour(new THREE.TorusGeometry(0.28, 0.08, 8, 20), lin('#2e5a2c')),
    colour(new THREE.BoxGeometry(0.2, 0.1, 0.05).translate(0, -0.3, 0.06), lin('#b3201c')),
    colour(new THREE.BoxGeometry(0.05, 0.16, 0.04).rotateZ(0.3).translate(-0.04, -0.4, 0.06), lin('#b3201c')),
    colour(new THREE.BoxGeometry(0.05, 0.16, 0.04).rotateZ(-0.3).translate(0.04, -0.4, 0.06), lin('#b3201c')),
  ])
}

export interface FestiveMaterials {
  props: THREE.Material
  bulbs: THREE.MeshStandardMaterial
  wire: THREE.Material
}

export function createFestive(buildings: Buildings, materials: FestiveMaterials): THREE.Group {
  const group = new THREE.Group()
  group.name = 'festive'
  const rand = seeded(1225)
  const up = new THREE.Vector3(0, 1, 0)
  const turned = (p: THREE.Vector3, facing: THREE.Vector3, scale = 1, tilt = 0) => {
    const q = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(facing.x, facing.z))
    if (tilt) q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt))
    return new THREE.Matrix4().compose(p, q, new THREE.Vector3(scale, scale, scale))
  }

  // ─── strings of bulbs across the main street, house to house ────────
  const wires = new Wires()
  const bulbs: THREE.Matrix4[] = []
  const junction = (s: number) => SIDES.some((j) => Math.abs(s - j.at) < SIDE_ROAD.width / 2 + SIDE_ROAD.sidewalk + 1)
  for (let s = -60; s < 330; s += 13 + rand() * 5) {
    // (the far end a few metres on up the street: the strings cross on a slant, some left to right, some back)
    const s1 = s + (rand() - 0.5) * 10
    if (junction(s) || junction(s1)) continue
    const a2 = MAIN.at(s, FRONT - 0.1)
    const b2 = MAIN.at(s1, -(FRONT - 0.1))
    const ya = streetY(a2.x, a2.y) + 6.2 + rand() * 0.6
    const yb = streetY(b2.x, b2.y) + 6.2 + rand() * 0.6
    const a = new THREE.Vector3(a2.x, ya, a2.y)
    const b = new THREE.Vector3(b2.x, yb, b2.y)
    const sag = 0.6 + rand() * 0.5
    wires.span(a, b, sag, 0.006, 20)
    const n = Math.floor(a.distanceTo(b) / 0.32)
    for (let i = 1; i < n; i++) {
      const t = i / n
      const p = a.clone().lerp(b, t)
      p.y = a.y + (b.y - a.y) * t - sag * 4 * t * (1 - t) - 0.05
      bulbs.push(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z))
    }
  }
  const wireMesh = wires.build(materials.wire)
  trackPixel(wireMesh)
  const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.03, 6, 4), materials.bulbs, bulbs.length)
  bulbs.forEach((m, i) => bulbMesh.setMatrixAt(i, m))
  bulbMesh.name = 'festive bulbs'
  bulbMesh.computeBoundingSphere()
  group.add(wireMesh, noRaycast(bulbMesh))

  // ─── candy canes and gifts by shop doors, a heap on the pavement by the garden, wreaths ─
  const canes: THREE.Matrix4[] = []
  const boxes: { m: THREE.Matrix4; c: THREE.Color }[] = []
  const wreaths: THREE.Matrix4[] = []
  const giftColors = ['#2f7a3a', '#b3201c', '#2c4f86', '#2f7a3a'].map(lin)
  const giftAt = (p: THREE.Vector3, facing: THREE.Vector3, scale: number) => {
    boxes.push({ m: turned(p, facing.clone().applyAxisAngle(up, (rand() - 0.5) * 0.8), scale), c: giftColors[Math.floor(rand() * giftColors.length)] })
  }
  const onPavement = (p: THREE.Vector3) => p.setY(streetY(p.x, p.z) + ROAD.curb)
  let shops = 0
  for (const { list } of buildings.features) {
    for (const f of list) {
      if (f.kind === 'shop' && shops++ % 2 === 0) {
        // a cane leaning at the door's side, gifts at its foot
        const p = onPavement(f.p.clone().addScaledVector(f.along, f.width / 2 + 0.35).addScaledVector(f.out, 0.2))
        canes.push(turned(p, f.along, 1, 0.06).scale(new THREE.Vector3(2, 1.1, 2)))
        giftAt(onPavement(p.clone().addScaledVector(f.out, 0.45)), f.out, 0.8)
        giftAt(onPavement(p.clone().addScaledVector(f.out, 0.4).addScaledVector(f.along, 0.6)), f.out, 0.6)
      }
      if (f.kind === 'door' && rand() < 0.3) {
        wreaths.push(turned(f.p.clone().addScaledVector(f.out, 0.1).setY(f.top - 0.55), f.out))
      }
    }
  }
  // a heap on the right-hand pavement by the garden, just up the street from the car: canes lying, gifts
  for (const [s, d, lie] of [[22, -(ROAD.width / 2 + 1.1), 1.47], [25.5, -(ROAD.width / 2 + 1.3), 1.62]] as const) {
    const p = MAIN.at(s, d)
    const at = onPavement(new THREE.Vector3(p.x, 0, p.y)).add(new THREE.Vector3(0, 0.12, 0))
    const f = MAIN.frame(s)
    const q = new THREE.Quaternion().setFromAxisAngle(up, Math.atan2(f.tx, f.tz) + (rand() - 0.5) * 0.3).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lie))
    // (as fat as the reference's: a thigh-thick cane two and a half metres long)
    canes.push(new THREE.Matrix4().compose(at.add(new THREE.Vector3(0, 0.12, 0)), q, new THREE.Vector3(2.4, 1.3, 2.4)))
  }
  const pave = ROAD.width / 2
  for (const [s, d] of [[21, -(pave + 1.4)], [23.2, -(pave + 1.6)], [24.6, -(pave + 1.2)], [27, -(pave + 1.5)]]) {
    const p = MAIN.at(s, d)
    giftAt(onPavement(new THREE.Vector3(p.x, 0, p.y)), new THREE.Vector3(1, 0, 0), 0.8 + rand() * 0.4)
  }

  const caneMesh = new THREE.InstancedMesh(candyCane(), materials.props, canes.length)
  canes.forEach((m, i) => caneMesh.setMatrixAt(i, m))
  const g = gift()
  const boxMesh = new THREE.InstancedMesh(g.box, materials.props, boxes.length)
  const ribbonMesh = new THREE.InstancedMesh(g.ribbon, materials.props, boxes.length)
  boxes.forEach((b, i) => {
    boxMesh.setMatrixAt(i, b.m)
    boxMesh.setColorAt(i, b.c)
    ribbonMesh.setMatrixAt(i, b.m)
    ribbonMesh.setColorAt(i, new THREE.Color(1, 1, 1))
  })
  const wreathMesh = new THREE.InstancedMesh(wreath(), materials.props, Math.max(1, wreaths.length))
  wreaths.forEach((m, i) => wreathMesh.setMatrixAt(i, m))
  wreathMesh.count = wreaths.length
  caneMesh.name = 'candy canes'
  boxMesh.name = 'gifts'
  ribbonMesh.name = 'gift ribbons'
  wreathMesh.name = 'wreaths'
  for (const m of [caneMesh, boxMesh, ribbonMesh, wreathMesh]) {
    m.castShadow = true
    m.receiveShadow = true
    m.computeBoundingSphere()
    if (!m.instanceColor) {
      for (let i = 0; i < m.count; i++) m.setColorAt(i, new THREE.Color(1, 1, 1))
    }
    group.add(noRaycast(m))
  }
  return group
}
