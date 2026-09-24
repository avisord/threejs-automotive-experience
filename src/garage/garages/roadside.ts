import * as THREE from 'three'
import { noRaycast, seeded } from './landform'
import { SITE, forestDensity, heightAt, lakeShape, onRoad, roadY, roadZ } from './site'
import { outdoorMaterial } from './terrain'

/**
 * The human-scale things in the valley — a winding two-lane road with its
 * markings, utility poles and sagging wires, a guardrail, a couple of signs,
 * a few cars, and houses: a village by the lake and farmhouses along the road.
 * They're small because they're far away; that's their job — a car you can
 * barely make out on a road half a kilometre off tells you how big the
 * mountain behind it must be.
 */

/** asphalt with the lane markings of a Japanese rural road; one tile = 12 m of road */
function roadTexture(): THREE.CanvasTexture {
  const w = 128
  const h = 512
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  const img = g.createImageData(w, h)
  const rand = seeded(31)
  for (let i = 0; i < w * h; i++) {
    const v = 58 + rand() * 26
    img.data.set([v, v, v * 1.02, 255], i * 4)
  }
  g.putImageData(img, 0, 0)
  g.fillStyle = 'rgba(235,235,230,0.92)'
  // solid edge lines, dashed centre line (5 m on, 7 m off)
  g.fillRect(w * 0.05, 0, w * 0.025, h)
  g.fillRect(w * 0.925, 0, w * 0.025, h)
  g.fillRect(w * 0.4875, 0, w * 0.025, h * (5 / 12))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 16 // seen at a glancing angle from far off
  return texture
}

interface RoadPoint {
  p: THREE.Vector3
  /** unit vector across the road, toward +z side */
  side: THREE.Vector3
  along: number
}

function roadPoints(step = 5): RoadPoint[] {
  const pts: RoadPoint[] = []
  let along = 0
  let prev: THREE.Vector3 | null = null
  const { extent } = SITE.road
  for (let x = -extent; x <= extent; x += step) {
    const p = new THREE.Vector3(x, roadY(x) + 0.18, roadZ(x))
    const ahead = new THREE.Vector3(x + 1, roadY(x + 1), roadZ(x + 1)).sub(new THREE.Vector3(x - 1, roadY(x - 1), roadZ(x - 1)))
    const side = new THREE.Vector3(-ahead.z, 0, ahead.x).normalize() // perpendicular in the ground plane
    if (side.z < 0) side.negate()
    if (prev) along += p.distanceTo(prev)
    pts.push({ p, side, along })
    prev = p
  }
  return pts
}

function createRoad(pts: RoadPoint[]): THREE.Mesh {
  const half = SITE.road.width / 2
  const position: number[] = []
  const uv: number[] = []
  const index: number[] = []
  pts.forEach(({ p, side, along }, i) => {
    for (const s of [-1, 1]) {
      const q = p.clone().addScaledVector(side, s * half)
      position.push(q.x, q.y, q.z)
      uv.push(s < 0 ? 0 : 1, along / 12)
    }
    if (i > 0) {
      const a = (i - 1) * 2
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  g.computeVertexNormals()
  if (g.attributes.normal.getY(0) < 0) {
    for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]]
    g.setIndex(index)
    g.computeVertexNormals()
  }
  const material = outdoorMaterial(
    new THREE.MeshStandardMaterial({
      map: roadTexture(),
      roughness: 0.88,
      // a few hundred metres out, depth resolution is ~10 cm: keep the road on top of its bed
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }),
  )
  const road = new THREE.Mesh(g, material)
  road.name = 'road'
  road.receiveShadow = true
  return noRaycast(road)
}

/** utility poles along the lake side of the road, and three sagging wires between each pair */
function createPoles(pts: RoadPoint[]): THREE.Object3D[] {
  const everyMetres = 50
  const poles: THREE.Vector3[] = []
  const arms: { at: THREE.Vector3; side: THREE.Vector3 }[] = []
  let next = 0
  for (const { p, side, along } of pts) {
    if (along < next) continue
    next = along + everyMetres
    const base = p.clone().addScaledVector(side, -(SITE.road.width / 2 + 2.5))
    base.y = heightAt(base.x, base.z)
    poles.push(base)
    arms.push({ at: base.clone().setY(base.y + 10.2), side })
  }
  const concrete = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0x8c8a84, roughness: 0.8 }))
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.17, 10.8, 8).translate(0, 5.4, 0), concrete, poles.length)
  const arm = new THREE.InstancedMesh(new THREE.BoxGeometry(2.2, 0.12, 0.12), concrete, poles.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  poles.forEach((b, i) => {
    pole.setMatrixAt(i, m.makeTranslation(b.x, b.y, b.z))
    // the cross-arm runs along the road
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(arms[i].side.z, 0, -arms[i].side.x).normalize())
    arm.setMatrixAt(i, m.compose(arms[i].at, q, new THREE.Vector3(1, 1, 1)))
  })
  // wires: three per span from the arm's ends and middle, sagging a little
  const wire: number[] = []
  for (let i = 1; i < arms.length; i++) {
    const a = arms[i - 1]
    const b = arms[i]
    for (const off of [-0.95, 0, 0.95]) {
      const along0 = new THREE.Vector3(a.side.z, 0, -a.side.x).normalize().multiplyScalar(off)
      const along1 = new THREE.Vector3(b.side.z, 0, -b.side.x).normalize().multiplyScalar(off)
      const p0 = a.at.clone().add(along0)
      const p1 = b.at.clone().add(along1)
      const steps = 8
      let last = p0
      for (let s = 1; s <= steps; s++) {
        const t = s / steps
        const p = p0.clone().lerp(p1, t)
        p.y -= 0.9 * 4 * t * (1 - t) // catenary-ish sag
        wire.push(last.x, last.y, last.z, p.x, p.y, p.z)
        last = p
      }
    }
  }
  const wireGeometry = new THREE.BufferGeometry()
  wireGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3))
  // a hairline at any distance, as wires are; faint so they don't read as drawn on
  const wires = new THREE.LineSegments(wireGeometry, new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 }))
  for (const o of [pole, arm]) {
    o.castShadow = true
    o.receiveShadow = true
    o.computeBoundingSphere()
  }
  return [pole, arm, wires].map(noRaycast)
}

/** a guardrail along the stretch where the road runs above the valley's drop */
function createGuardrail(pts: RoadPoint[]): THREE.Object3D[] {
  const span = pts.filter(({ p }) => Math.abs(p.x) < 420)
  const steel = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xb8bcbf, roughness: 0.4, metalness: 0.7 }))
  const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.75, 0.12).translate(0, 0.375, 0), steel, span.length)
  const rail: number[] = []
  const railIndex: number[] = []
  const m = new THREE.Matrix4()
  let n = 0
  span.forEach(({ p, side }, i) => {
    const at = p.clone().addScaledVector(side, -(SITE.road.width / 2 + 1))
    posts.setMatrixAt(n++, m.makeTranslation(at.x, at.y - 0.1, at.z))
    for (const y of [0.45, 0.72]) rail.push(at.x, at.y + y, at.z)
    if (i > 0) {
      const a = (i - 1) * 2
      railIndex.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  })
  posts.count = n
  const railGeometry = new THREE.BufferGeometry()
  railGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rail, 3))
  railGeometry.setIndex(railIndex)
  railGeometry.computeVertexNormals()
  const railMesh = new THREE.Mesh(railGeometry, steel)
  railMesh.material.side = THREE.DoubleSide
  posts.computeBoundingSphere()
  return [posts, railMesh].map(noRaycast)
}

/** a couple of road signs */
function createSigns(pts: RoadPoint[]): THREE.Object3D {
  const group = new THREE.Group()
  const post = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0x9a9da0, roughness: 0.5, metalness: 0.6 }))
  const blue = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0x1d4f9a, roughness: 0.5 }))
  const white = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xf0f0ec, roughness: 0.5 }))
  for (const x of [-520, 310]) {
    const i = pts.findIndex(({ p }) => p.x >= x)
    const { p, side } = pts[i]
    const at = p.clone().addScaledVector(side, SITE.road.width / 2 + 1.5)
    at.y = heightAt(at.x, at.z)
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 6).translate(0, 1.3, 0), post)
    pole.position.copy(at)
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.05), x < 0 ? blue : white)
    plate.position.set(at.x, at.y + 2.4, at.z)
    plate.lookAt(at.x + side.x, at.y + 2.4, at.z + side.z)
    group.add(pole, plate)
  }
  group.traverse((o) => noRaycast(o))
  return group
}

/** a few cars on the road — tiny, which is the point */
function createCars(pts: RoadPoint[]): THREE.Object3D[] {
  const cars = [
    { x: -760, lane: 1, color: 0xf2f2f0 },
    { x: -330, lane: -1, color: 0x2a2d33 },
    { x: 140, lane: 1, color: 0xb8bcc2 },
    { x: 520, lane: -1, color: 0x8c1d22 },
    { x: 980, lane: 1, color: 0x2b4f86 },
  ]
  const paint = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.4 }))
  const glass = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.1, metalness: 0.2 }))
  const bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(4.4, 0.75, 1.75).translate(0, 0.62, 0), paint, cars.length)
  const cabins = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 0.62, 1.6).translate(-0.2, 1.3, 0), glass, cars.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  cars.forEach((car, i) => {
    const k = pts.findIndex(({ p }) => p.x >= car.x)
    const { p, side } = pts[k]
    const at = p.clone().addScaledVector(side, car.lane * 1.8)
    q.setFromUnitVectors(new THREE.Vector3(1, 0, 0), new THREE.Vector3(side.z, 0, -side.x).normalize())
    m.compose(at, q, new THREE.Vector3(1, 1, 1))
    bodies.setMatrixAt(i, m)
    cabins.setMatrixAt(i, m)
    bodies.setColorAt(i, new THREE.Color(car.color))
  })
  for (const o of [bodies, cabins]) {
    o.castShadow = true
    o.computeBoundingSphere()
  }
  return [bodies, cabins].map(noRaycast)
}

/** houses: a village by the lake shore and farmhouses along the road */
function createHouses(): THREE.Object3D[] {
  const rand = seeded(47)
  const spots: { x: number; z: number; w: number; d: number; h: number; turn: number }[] = []
  const tryPlace = (x: number, z: number) => {
    if (lakeShape(x, z) < 1.12 || onRoad(x, z) > 0 || Math.abs(z - roadZ(x)) < 18) return
    if (forestDensity(x, z) > 0.5) return
    if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 24)) return
    spots.push({ x, z, w: 8 + rand() * 5, d: 6 + rand() * 4, h: 4.2 + rand() * 1.8, turn: rand() * Math.PI })
  }
  // the village: a loose cluster above the lake's near shore, a little off the line to the mountain
  for (let i = 0; i < 40 && spots.length < 12; i++) tryPlace(-520 + (rand() - 0.5) * 380, -1060 + (rand() - 0.5) * 160)
  // farmhouses along the road, both sides of the valley
  for (let i = 0; i < 30 && spots.length < 20; i++) {
    const x = (rand() < 0.5 ? -1 : 1) * (380 + rand() * 1100)
    tryPlace(x, roadZ(x) - 40 - rand() * 160)
  }
  const walls = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }))
  const tiles = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.1 }))
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), walls, spots.length)
  // a hipped roof: a four-sided pyramid turned square to the walls, overhanging them
  const roof = new THREE.InstancedMesh(new THREE.ConeGeometry(Math.SQRT1_2 * 1.2, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0), tiles, spots.length)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const wallColors = [0xe8e2d6, 0xd9d4ca, 0xf0ede6, 0xc9bca6].map((c) => new THREE.Color().setHex(c, THREE.SRGBColorSpace))
  const roofColors = [0x3a4250, 0x2f3238, 0x4a3b33, 0x444c58].map((c) => new THREE.Color().setHex(c, THREE.SRGBColorSpace))
  spots.forEach((s, i) => {
    const y = heightAt(s.x, s.z) - 0.3
    q.setFromAxisAngle(up, s.turn)
    body.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.w, s.h, s.d)))
    roof.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, y + s.h, s.z), q, new THREE.Vector3(s.w, 2.2 + rand(), s.d)))
    body.setColorAt(i, wallColors[i % wallColors.length])
    roof.setColorAt(i, roofColors[(i * 7) % roofColors.length])
  })
  for (const o of [body, roof]) {
    o.castShadow = true
    o.receiveShadow = true
    o.computeBoundingSphere()
  }
  return [body, roof].map(noRaycast)
}

export function createRoadside(): { group: THREE.Group; ground: THREE.Object3D; details: THREE.Object3D[] } {
  const group = new THREE.Group()
  group.name = 'roadside'
  const pts = roadPoints()
  const road = createRoad(pts)
  const details = [...createPoles(pts), ...createGuardrail(pts), createSigns(pts), ...createCars(pts), ...createHouses()]
  group.add(road, ...details)
  return { group, ground: road, details }
}
