import * as THREE from 'three'
import { noRaycast, seeded } from '../landform'
import { colour, merged } from './infra'
import type { Buildings } from './buildings'
import type { Feature } from './facade'
import { CHURCH, FRONT, MAIN, ROAD, SIDES, SIDE_ROAD, Street, streetY } from './site'
import { SHOPS } from './signs'

/**
 * Street life, set where it has a reason to be: a café's tables out on its
 * pavement and a chalkboard by its door, crates of produce in front of the
 * grocers, drums and stacked tyres outside the workshop, a ladder at the
 * hardware shop, bicycles against the walls by doors, scooters at the kerb by
 * the shops, bins at the corners, benches round the church's plaza, a pair of
 * roadworks barriers in a side street, telecom cabinets, and a few old cars
 * parked well away from the car's spot. Each kind is one instanced mesh of a
 * low-poly, vertex-coloured model; the paintwork varies per instance.
 */

const lin = (hex: string) => new THREE.Color(hex)
const WHITE = lin('#ffffff')

// ─── models (local +z is the way it faces / out from the wall; y up; origin on the ground) ─
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.Color) => colour(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c)
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: THREE.Color, seg = 10) => colour(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), c)

function binModel(): THREE.BufferGeometry {
  const post = lin('#2a2a28')
  return merged([cyl(0.03, 0.03, 1.1, 0, 0.55, -0.05, post, 6), cyl(0.21, 0.19, 0.6, 0, 0.7, 0.2, WHITE, 12), cyl(0.225, 0.225, 0.05, 0, 1.0, 0.2, WHITE, 12)])
}

function benchModel(): THREE.BufferGeometry {
  const iron = lin('#222320')
  const wood = lin('#7a5536')
  const parts = [box(0.06, 0.45, 0.5, -0.8, 0.225, 0, iron), box(0.06, 0.45, 0.5, 0.8, 0.225, 0, iron), box(0.06, 0.45, 0.06, -0.8, 0.65, -0.22, iron), box(0.06, 0.45, 0.06, 0.8, 0.65, -0.22, iron)]
  for (const z of [-0.15, 0, 0.15]) parts.push(box(1.8, 0.04, 0.11, 0, 0.46, z, wood))
  for (const y of [0.62, 0.78]) parts.push(box(1.8, 0.1, 0.03, 0, y, -0.24, wood))
  return merged(parts)
}

function crateStack(): THREE.BufferGeometry {
  const wood = lin('#a57a4a')
  const fruit = [lin('#e2701f'), lin('#c42a24'), lin('#6f9a2a'), lin('#e8c23a')]
  const parts: THREE.BufferGeometry[] = []
  const crate = (x: number, y: number, z: number, f: THREE.Color) => {
    parts.push(box(0.52, 0.28, 0.36, x, y + 0.14, z, wood), box(0.46, 0.04, 0.3, x, y + 0.27, z, f))
  }
  crate(0, 0, 0, fruit[0])
  crate(0.55, 0, 0, fruit[1])
  crate(0.27, 0.29, 0.02, fruit[2])
  crate(1.1, 0, -0.02, fruit[3])
  return merged(parts)
}

function bistroSet(): THREE.BufferGeometry {
  const metal = lin('#23332a')
  const parts = [cyl(0.32, 0.32, 0.03, 0, 0.74, 0, lin('#d8d2c4'), 16), cyl(0.025, 0.025, 0.72, 0, 0.37, 0, metal, 6), cyl(0.2, 0.22, 0.03, 0, 0.015, 0, metal, 10)]
  for (const side of [-1, 1]) {
    const x = side * 0.62
    parts.push(box(0.4, 0.03, 0.4, x, 0.46, 0, metal), box(0.03, 0.45, 0.4, x + side * 0.2, 0.7, 0, metal))
    for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) parts.push(box(0.025, 0.46, 0.025, x + dx, 0.23, dz, metal))
  }
  return merged(parts)
}

function aFrame(): THREE.BufferGeometry {
  const wood = lin('#6b4a2e')
  const board = lin('#1f2522')
  const front = merged([box(0.6, 0.95, 0.03, 0, 0.5, 0, wood), box(0.5, 0.75, 0.035, 0, 0.52, 0.004, board)])
  const back = front.clone()
  front.rotateX(-0.2).translate(0, 0, 0.12)
  back.rotateX(0.2).translate(0, 0, -0.12)
  return merged([front, back])
}

function drum(): THREE.BufferGeometry {
  return merged([cyl(0.29, 0.29, 0.88, 0, 0.44, 0, WHITE, 14), cyl(0.3, 0.3, 0.03, 0, 0.3, 0, WHITE, 14), cyl(0.3, 0.3, 0.03, 0, 0.6, 0, WHITE, 14)])
}

function tyres(): THREE.BufferGeometry {
  const rubber = lin('#1a1a1a')
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 4; i++) parts.push(colour(new THREE.TorusGeometry(0.28, 0.1, 6, 14).rotateX(Math.PI / 2).translate((i % 2) * 0.03, 0.1 + i * 0.2, 0), rubber))
  return merged(parts)
}

function ladder(): THREE.BufferGeometry {
  const alu = lin('#b9bcbc')
  const parts = [box(0.04, 2.6, 0.04, -0.22, 1.3, 0, alu), box(0.04, 2.6, 0.04, 0.22, 1.3, 0, alu)]
  for (let y = 0.3; y < 2.5; y += 0.3) parts.push(box(0.44, 0.03, 0.03, 0, y, 0, alu))
  // leaning back against the wall behind it
  return merged(parts).rotateX(-0.28).translate(0, 0, 0.4)
}

function buckets(): THREE.BufferGeometry {
  const c = [lin('#d8452a'), lin('#2a6fb8'), lin('#e8c23a'), lin('#3f8a3a')]
  return merged([cyl(0.15, 0.12, 0.3, 0, 0.15, 0, c[0]), cyl(0.15, 0.12, 0.3, 0.34, 0.15, 0.05, c[1]), cyl(0.15, 0.12, 0.3, 0.17, 0.44, 0.02, c[2]), cyl(0.12, 0.1, 0.25, -0.3, 0.125, 0.08, c[3])])
}

function cartons(): THREE.BufferGeometry {
  const card = lin('#b08a5a')
  return merged([box(0.5, 0.4, 0.4, 0, 0.2, 0, card), box(0.4, 0.3, 0.35, 0.05, 0.55, 0.02, card.clone().multiplyScalar(0.92)), box(0.35, 0.3, 0.3, 0.5, 0.15, 0.05, card.clone().multiplyScalar(1.05))])
}

function bicycle(): THREE.BufferGeometry {
  const frame = WHITE
  const tyre = lin('#161616')
  const parts: THREE.BufferGeometry[] = []
  for (const x of [-0.52, 0.52]) parts.push(colour(new THREE.TorusGeometry(0.33, 0.022, 5, 20).translate(x, 0.35, 0), tyre))
  const bar = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const g = colour(new THREE.BoxGeometry(len, 0.03, 0.03), frame)
    g.rotateZ(Math.atan2(y1 - y0, x1 - x0)).translate((x0 + x1) / 2, (y0 + y1) / 2, 0)
    parts.push(g)
  }
  bar(-0.52, 0.35, -0.05, 0.35)
  bar(-0.05, 0.35, 0.38, 0.78)
  bar(-0.52, 0.35, -0.12, 0.8)
  bar(-0.12, 0.8, 0.38, 0.78)
  bar(-0.05, 0.35, -0.12, 0.8)
  bar(0.38, 0.78, 0.52, 0.35)
  bar(0.38, 0.78, 0.36, 0.98)
  parts.push(box(0.04, 0.03, 0.5, 0.36, 0.98, 0, tyre), box(0.22, 0.05, 0.1, -0.14, 0.86, 0, tyre))
  // (local x along the bike; leaning its bars on the wall behind: z toward the street)
  return merged(parts).rotateX(0.18)
}

function scooter(): THREE.BufferGeometry {
  const tyre = lin('#161616')
  const dark = lin('#2a2a2a')
  const parts = [
    colour(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 14).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.24, 0.62), tyre),
    colour(new THREE.CylinderGeometry(0.24, 0.24, 0.1, 14).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(0, 0.24, -0.6), tyre),
    box(0.34, 0.3, 0.9, 0, 0.52, -0.2, WHITE),
    box(0.3, 0.1, 0.55, 0, 0.78, -0.28, dark),
    box(0.24, 0.7, 0.14, 0, 0.62, 0.45, WHITE),
    box(0.62, 0.04, 0.04, 0, 1.05, 0.5, dark),
    box(0.2, 0.1, 0.36, 0, 0.3, 0.1, dark),
  ]
  return merged(parts)
}

function barrier(): THREE.BufferGeometry {
  const orange = lin('#e0641c')
  const white = lin('#f0eee8')
  const parts = [box(0.05, 1.0, 0.05, -0.6, 0.5, 0, white), box(0.05, 1.0, 0.05, 0.6, 0.5, 0, white), box(0.4, 0.04, 0.35, -0.6, 0.02, 0, orange), box(0.4, 0.04, 0.35, 0.6, 0.02, 0, orange)]
  for (let i = 0; i < 6; i++) parts.push(box(0.2, 0.22, 0.03, -0.5 + i * 0.2, 0.82, 0, i % 2 ? white : orange))
  return merged(parts)
}

function cone(): THREE.BufferGeometry {
  return merged([box(0.36, 0.03, 0.36, 0, 0.015, 0, lin('#1c1c1c')), cyl(0.03, 0.15, 0.62, 0, 0.34, 0, lin('#e2601a'), 10), cyl(0.07, 0.1, 0.1, 0, 0.42, 0, lin('#f0eee8'), 10)])
}

function cabinet(): THREE.BufferGeometry {
  const c = lin('#6f7f6c')
  return merged([box(0.85, 1.25, 0.42, 0, 0.66, 0, c), box(0.9, 0.05, 0.47, 0, 1.3, 0, c.clone().multiplyScalar(0.8)), box(0.4, 0.8, 0.01, -0.2, 0.7, 0.215, c.clone().multiplyScalar(0.9))])
}

/** an old rounded two-door saloon, the sort that still fills a colonial town's streets: a body, a narrower cabin on it */
function carModel(): { body: THREE.BufferGeometry; glass: THREE.BufferGeometry; wheels: THREE.BufferGeometry } {
  const extrude = (shape: THREE.Shape, width: number, bevel: number) => {
    const g = new THREE.ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3, curveSegments: 10 })
    return g.translate(0, 0, -(width - 2 * bevel) / 2).rotateY(-Math.PI / 2)
  }
  // the body: bumpers, round wings over the wheels, the bonnet and boot falling away
  const lower = new THREE.Shape()
  lower.moveTo(-2.0, 0.32)
  lower.lineTo(-2.08, 0.55)
  lower.quadraticCurveTo(-2.05, 0.92, -1.5, 0.98)
  lower.lineTo(1.0, 0.98)
  lower.quadraticCurveTo(1.9, 0.9, 2.07, 0.6)
  lower.lineTo(2.03, 0.32)
  lower.lineTo(-2.0, 0.32)
  // the cabin: a domed roof, raked screens
  const cabin = new THREE.Shape()
  cabin.moveTo(-1.55, 0.94)
  cabin.quadraticCurveTo(-1.3, 1.45, -0.55, 1.5)
  cabin.quadraticCurveTo(0.1, 1.53, 0.35, 1.44)
  cabin.lineTo(0.95, 0.94)
  cabin.lineTo(-1.55, 0.94)
  const pane = new THREE.Shape()
  pane.moveTo(-1.42, 1.0)
  pane.quadraticCurveTo(-1.2, 1.36, -0.6, 1.42)
  pane.quadraticCurveTo(0.05, 1.45, 0.3, 1.38)
  pane.lineTo(0.8, 1.0)
  pane.lineTo(-1.42, 1.0)
  const body = merged([extrude(lower, 1.6, 0.1), extrude(cabin, 1.3, 0.08)].map((g) => strip(g)))
  const glass = strip(extrude(pane, 1.39, 0))
  const wheels: THREE.BufferGeometry[] = []
  for (const z of [-1.3, 1.3]) {
    for (const x of [-0.7, 0.7]) wheels.push(new THREE.CylinderGeometry(0.32, 0.32, 0.2, 16).rotateZ(Math.PI / 2).translate(x, 0.32, z))
  }
  return { body, glass, wheels: merged(wheels) }
}

/** position and normal only (ExtrudeGeometry's groups and uvs aren't needed) */
function strip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g.clone()
  out.clearGroups()
  out.deleteAttribute('uv')
  out.computeVertexNormals()
  g.dispose()
  return out
}

export interface PropMaterials {
  /** vertex-coloured, tinted per instance */
  props: THREE.Material
  paint: THREE.Material
  glass: THREE.Material
  rubber: THREE.Material
}

type Placed = { m: THREE.Matrix4; tint?: THREE.Color }

export function createProps(buildings: Buildings, materials: PropMaterials): THREE.Group {
  const group = new THREE.Group()
  group.name = 'street-props'
  const rand = seeded(4040)
  const kinds = new Map<string, Placed[]>()
  const put = (kind: string, p: THREE.Vector3, facing: THREE.Vector3, tint?: THREE.Color, scale = 1) => {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(facing.x, facing.z))
    const list = kinds.get(kind) ?? []
    list.push({ m: new THREE.Matrix4().compose(p, q, new THREE.Vector3(scale, scale, scale)), tint })
    kinds.set(kind, list)
  }
  const onGround = (p: THREE.Vector3, lift = ROAD.curb) => p.setY(streetY(p.x, p.z) + lift)
  const at = (street: Street, s: number, d: number, lift = ROAD.curb) => {
    const q = street.at(s, d)
    return onGround(new THREE.Vector3(q.x, 0, q.y), lift)
  }
  const dir = (street: Street, s: number, sign = 1) => {
    const f = street.frame(s)
    return new THREE.Vector3(f.tx * sign, 0, f.tz * sign)
  }
  /** from a main-street pavement on `side` toward the road */
  const toRoad = (s: number, side: number) => new THREE.Vector3(-side * MAIN.frame(s).tz, 0, side * MAIN.frame(s).tx)
  /** keep the street round the car's spot clear: props only well away from it (or at the pavement's back) */
  const clearOfCar = (p: THREE.Vector3) => Math.hypot(p.x, p.z) > 14

  // ─── by the shops and the doors ────────────────────────────────────
  for (const { list } of buildings.features) {
    for (const f of list) {
      if (f.kind === 'shop') shopFront(f)
      else if (f.kind === 'door' && clearOfCar(f.p)) {
        const r = rand()
        const side = rand() < 0.5 ? -1 : 1
        const beside = f.p.clone().addScaledVector(f.along, side * (f.width / 2 + 0.9))
        if (r < 0.07) put('bicycle', onGround(beside.addScaledVector(f.out, 0.25)), f.along.clone().multiplyScalar(side), lin(['#b3312a', '#2c4f86', '#1f1f1f', '#2f6b45'][Math.floor(rand() * 4)]))
        else if (r < 0.1) put('cartons', onGround(beside.addScaledVector(f.out, 0.3)), f.out)
      }
    }
  }
  function shopFront(f: Extract<Feature, { p: THREE.Vector3 }>): void {
    const name = SHOPS[f.shop ?? 0]
    const along = (x: number, out: number) => onGround(f.p.clone().addScaledVector(f.along, x).addScaledVector(f.out, out))
    const half = f.width / 2
    switch (name) {
      case 'CAFÉ':
        put('bistro', along(-half * 0.5, 1.0), f.along)
        put('bistro', along(half * 0.5, 1.0), f.along)
        put('aframe', along(half + 0.8, 0.6), f.out)
        break
      case 'PANADERÍA':
        put('aframe', along(-half - 0.6, 0.6), f.out)
        break
      case 'ABARROTES':
      case 'TORTILLERÍA':
        put('crates', along(-half * 0.6, 0.3), f.out)
        if (half > 1.6) put('crates', along(half * 0.2, 0.3), f.out)
        put('cartons', along(half * 0.8, 0.3), f.out)
        break
      case 'TALLER':
        put('drum', along(-half * 0.7, 0.4), f.out, lin(['#b3312a', '#2c4f86', '#2f6b45'][Math.floor(rand() * 3)]))
        put('drum', along(-half * 0.7 + 0.62, 0.4), f.out, lin('#2c4f86'))
        put('tyres', along(half * 0.6, 0.4), f.out)
        break
      case 'FERRETERÍA':
        put('ladder', along(-half * 0.6, 0.05), f.out)
        put('buckets', along(half * 0.5, 0.35), f.out)
        break
      default:
        if (rand() < 0.5) put('bicycle', along(half + 0.9, 0.25), f.along, lin('#1f1f1f'))
    }
    // a scooter at the kerb by most shops
    if (rand() < 0.45 && clearOfCar(f.p)) {
      const kerb = f.p.clone().addScaledVector(f.out, ROAD.sidewalk + 0.55).addScaledVector(f.along, (rand() - 0.5) * f.width)
      put('scooter', onGround(kerb, 0), f.out.clone().multiplyScalar(-1).addScaledVector(f.along, 0.6).normalize(), lin(['#b3312a', '#e8e2d6', '#2c4f86', '#1f1f1f'][Math.floor(rand() * 4)]))
    }
  }

  // ─── bins at the corners and along the main street ──────────────────
  const binColor = lin('#2f5a3a')
  for (const j of SIDES) {
    for (const which of [-1, 1]) {
      const s = j.at + which * (SIDE_ROAD.width / 2 + 3.6 + 2.5)
      const p = at(MAIN, s, j.side * (ROAD.width / 2 + 0.35))
      if (clearOfCar(p)) put('bin', p, toRoad(s, j.side), binColor)
    }
  }
  for (let s = MAIN.start + 40; s < MAIN.end - 30; s += 64) {
    const side = Math.round(s / 64) % 2 ? 1 : -1
    const p = at(MAIN, s, side * (ROAD.width / 2 + 0.35))
    if (clearOfCar(p)) put('bin', p, toRoad(s, side), binColor)
  }

  // ─── the church's plaza: benches round it ────────────────────────────
  const side = Math.sign(CHURCH.d)
  for (const [ds, dd] of [[-12, 9], [12, 9], [-12, 16], [12, 16]]) {
    const p = at(MAIN, CHURCH.s + ds, side * (FRONT + dd))
    put('bench', p, dir(MAIN, CHURCH.s, ds < 0 ? 1 : -1))
  }

  // ─── roadworks in a side street, telecom cabinets ─────────────────────
  const works = SIDES[1].street
  for (const [s, d, kind] of [[42, -1.3, 'barrier'], [44.5, -2.2, 'barrier'], [40, -2.4, 'cone'], [46.5, -0.9, 'cone'], [43, 0.1, 'cone']] as const) {
    put(kind, at(works, s, d, 0), kind === 'barrier' ? dir(works, s) : new THREE.Vector3(0, 0, 1))
  }
  for (const s of [-84, 136]) put('cabinet', at(MAIN, s, -(FRONT - 0.3)), new THREE.Vector3(MAIN.frame(s).tz, 0, -MAIN.frame(s).tx))

  // ─── a few parked cars, well away from the showcase spot ────────────
  const cars: Placed[] = []
  const parked: [Street, number, number, 1 | -1][] = [
    [MAIN, 148, -(ROAD.width / 2 - 1.0), 1],
    [MAIN, 154, -(ROAD.width / 2 - 1.0), 1],
    [MAIN, -72, ROAD.width / 2 - 1.0, -1],
    [SIDES[0].street, 60, -(SIDE_ROAD.width / 2 - 0.95), 1],
    [SIDES[2].street, 50, SIDE_ROAD.width / 2 - 0.95, -1],
  ]
  const paints = ['#e9e3d3', '#b3312a', '#2c4f86', '#c9b27a', '#3f6b4a'].map(lin)
  parked.forEach(([street, s, d, way], i) => {
    const p = at(street, s, d, 0)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dir(street, s, way).x, dir(street, s, way).z))
    cars.push({ m: new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)), tint: paints[i % paints.length] })
  })

  // ─── build the instanced meshes ──────────────────────────────────────
  const models: Record<string, () => THREE.BufferGeometry> = {
    bin: binModel, bench: benchModel, crates: crateStack, bistro: bistroSet, aframe: aFrame, drum, tyres, ladder, buckets, cartons,
    bicycle, scooter, barrier, cone, cabinet,
  }
  for (const [kind, list] of kinds) {
    group.add(instanced(models[kind](), materials.props, list, kind))
  }
  const car = carModel()
  group.add(instanced(car.body, materials.paint, cars, 'parked cars'), instanced(car.glass, materials.glass, cars.map((c) => ({ m: c.m })), 'parked car glass'), instanced(car.wheels, materials.rubber, cars.map((c) => ({ m: c.m })), 'parked car wheels'))
  return group
}

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, list: Placed[], name: string): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length))
  list.forEach((p, i) => {
    mesh.setMatrixAt(i, p.m)
    mesh.setColorAt(i, p.tint ?? WHITE)
  })
  mesh.count = list.length
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.name = name
  mesh.computeBoundingSphere()
  return noRaycast(mesh)
}
