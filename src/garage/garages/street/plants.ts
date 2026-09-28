import * as THREE from 'three'
import { noRaycast, seeded } from '../landform'
import { CellMesh } from './mesh'
import type { Buildings } from './buildings'
import type { Feature } from './facade'

/**
 * Plants on the houses: terracotta and glazed pots along balconies, on sills
 * and ledges and either side of doors, flowers and leaves in them; ivy and
 * bougainvillea hanging off parapets and balconies. How green a house is is
 * the house's own (some bare, most with a few pots, a few smothered), not
 * sprinkled evenly. Leaves are alpha-tested cards from one painted atlas:
 * flat against the wall for climbers (one layer, no overdraw), three crossed
 * cards for a pot's plant — never piles of transparent layers.
 */

/** the leaf atlas's cells: [u0, v0] of a 0.5 × 0.5 cell */
const LEAF = { ivy: [0, 0.5], geranium: [0.5, 0.5], bougainvillea: [0, 0], shrub: [0.5, 0] } as const
type Leaf = keyof typeof LEAF

export function createLeafTexture(): THREE.CanvasTexture {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, size, size)
  const rand = seeded(2718)
  const leaf = (x: number, y: number, r: number, color: string, stretch = 1.5) => {
    g.save()
    g.translate(x, y)
    g.rotate(rand() * Math.PI * 2)
    g.fillStyle = color
    g.beginPath()
    g.ellipse(0, 0, r, r * stretch, 0, 0, Math.PI * 2)
    g.fill()
    g.restore()
  }
  const hsl = (h: number, s: number, l: number) => `hsl(${h},${s}%,${l}%)`
  /** fill a cell with leaves, densest in the middle, ragged at the edge (the card's outline) */
  const cell = (cx: number, cy: number, count: number, draw: (x: number, y: number, r: number) => void) => {
    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2
      const d = Math.sqrt(rand()) * 108
      draw(cx + 128 + Math.cos(a) * d, cy + 128 + Math.sin(a) * d, 1 - d / 128)
    }
  }
  // canvas y is down; three flips it on upload: the atlas's v 0.5–1 is the canvas's top half
  // ivy: small dark glossy leaves, dense
  cell(0, 0, 900, (x, y) => leaf(x, y, 5 + rand() * 4, hsl(95 + rand() * 25, 35 + rand() * 20, 16 + rand() * 16), 1.1))
  // geranium: round mid-green leaves, red flower heads on top
  cell(256, 0, 420, (x, y) => leaf(x, y, 8 + rand() * 5, hsl(100 + rand() * 20, 40, 24 + rand() * 12), 1))
  cell(256, 0, 26, (x, y, c) => {
    const hue = rand() < 0.7 ? 355 : 330
    for (let k = 0; k < 14; k++) leaf(x + (rand() - 0.5) * 18, y + (rand() - 0.5) * 18, 3.5 + rand() * 2, hsl(hue + rand() * 10, 70 + rand() * 20, 42 + rand() * 12 + c * 4), 1)
  })
  // bougainvillea: magenta and purple bracts over dark leaves
  cell(0, 256, 380, (x, y) => leaf(x, y, 6 + rand() * 4, hsl(100 + rand() * 20, 35, 18 + rand() * 10), 1.3))
  cell(0, 256, 520, (x, y) => leaf(x, y, 4 + rand() * 3, hsl(310 + rand() * 25, 60 + rand() * 20, 40 + rand() * 14), 1.1))
  // shrub: small fresh leaves, lighter
  cell(256, 256, 1000, (x, y) => leaf(x, y, 4 + rand() * 3, hsl(85 + rand() * 30, 38 + rand() * 18, 22 + rand() * 18), 1.4))
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

/** uvs of a card in a leaf cell, optionally a sub-window of it */
function cellUV(leaf: Leaf): [number, number][] {
  const [u, v] = LEAF[leaf]
  return [
    [u, v],
    [u + 0.5, v],
    [u + 0.5, v + 0.5],
    [u, v + 0.5],
  ]
}

/** a terracotta pot, 1 m tall at scale 1 (scaled to 0.2–0.5 m), rim and all */
function potGeometry(): THREE.BufferGeometry {
  const profile = [[0, 0], [0.34, 0], [0.36, 0.05], [0.47, 0.82], [0.53, 0.84], [0.53, 1.0], [0.47, 1.0], [0.45, 0.93], [0, 0.93]].map(([r, y]) => new THREE.Vector2(r, y))
  return new THREE.LatheGeometry(profile, 12)
}

/** a pot's plant: three crossed cards over the rim, their normals the crown's (up and out), for a leaf cell */
function crownGeometry(leaf: Leaf): THREE.BufferGeometry {
  const position: number[] = []
  const normal: number[] = []
  const uv: number[] = []
  const index: number[] = []
  const [u, v] = LEAF[leaf]
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI
    const dx = Math.cos(a) * 0.9
    const dz = Math.sin(a) * 0.9
    const base = position.length / 3
    // a card from 0.75 (inside the rim) to 2.3 pot-heights
    const corners: [number, number, number, number, number][] = [
      [-dx, 0.75, -dz, u, v],
      [dx, 0.75, dz, u + 0.5, v],
      [dx, 2.3, dz, u + 0.5, v + 0.5],
      [-dx, 2.3, -dz, u, v + 0.5],
    ]
    for (const [x, y, z, s, t] of corners) {
      position.push(x, y, z)
      const n = new THREE.Vector3(x, (y - 0.9) * 1.2 + 0.6, z).normalize()
      normal.push(n.x, n.y, n.z)
      uv.push(s, t)
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(index)
  return g
}

const POTS = ['#a9573a', '#b8663f', '#9a4a30', '#c07a55', '#2d5d8f', '#e8e2d6'].map((h) => new THREE.Color(h))

export interface PlantMaterials {
  leaves: THREE.Material
  pot: THREE.Material
}

export function createPlants(buildings: Buildings, materials: PlantMaterials): THREE.Group {
  const group = new THREE.Group()
  group.name = 'street-plants'
  const pots: { m: THREE.Matrix4; color: THREE.Color; leaf: Leaf }[] = []
  const cards = new CellMesh(60)
  const up = new THREE.Vector3(0, 1, 0)

  for (const { lot, list } of buildings.features) {
    const rand = seeded(lot.seed + 991)
    // how green this house is: bare, a few pots, or smothered
    const r = rand()
    const level = r < 0.35 ? 0 : r < 0.78 ? 1 : 2
    if (level === 0 && lot.family.id !== 'colonial') continue
    const flowers: Leaf = rand() < 0.6 ? 'geranium' : rand() < 0.5 ? 'bougainvillea' : 'shrub'
    const potColor = POTS[Math.floor(rand() * 4)]
    const pot = (p: THREE.Vector3, scale: number, leaf: Leaf = flowers, color = potColor) => {
      const m = new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(up, rand() * Math.PI * 2), new THREE.Vector3(scale, scale * (0.9 + rand() * 0.25), scale))
      pots.push({ m, color: color.clone().multiplyScalar(0.85 + rand() * 0.3), leaf })
    }
    const row = (f: Extract<Feature, { a: THREE.Vector3 }>, spacing: number, fill: number, scale: number) => {
      const len = f.a.distanceTo(f.b)
      const n = Math.max(1, Math.floor(len / spacing))
      for (let i = 0; i < n; i++) if (rand() < fill) pot(f.a.clone().lerp(f.b, (i + 0.5) / n), scale * (0.85 + rand() * 0.3))
    }
    for (const f of list) {
      switch (f.kind) {
        case 'balcony':
          if (level === 2 || (level === 1 && rand() < 0.35)) row(f, level === 2 ? 0.42 : 0.55, level === 2 ? 0.85 : 0.5, 0.24)
          // flowers spilling over the rail
          if (level === 2 && rand() < 0.5) cascade(cards, f, rand() < 0.5 ? 'bougainvillea' : 'ivy', 0.4 + rand() * 1.1, rand)
          break
        case 'ledge':
          if (level >= 1 && rand() < 0.4) row(f, 0.5, 0.9, 0.2)
          break
        case 'sill':
          if (rand() < (level === 2 ? 0.5 : level === 1 ? 0.12 : 0)) row(f, 0.4, 0.8, 0.18)
          break
        case 'door':
          if (level >= 1 && rand() < 0.35) {
            for (const side of [-1, 1]) {
              const p = f.p.clone().addScaledVector(f.along, side * (f.width / 2 + 0.4)).addScaledVector(f.out, 0.3)
              pot(p, 0.42 + rand() * 0.12, rand() < 0.5 ? 'shrub' : flowers, POTS[Math.floor(rand() * POTS.length)])
            }
          }
          break
        case 'parapet':
          if (rand() < (level === 2 ? 0.6 : level === 1 ? 0.12 : 0)) climber(cards, f, rand)
          break
      }
    }
  }

  // pots: one instanced mesh; their plants, one per leaf kind
  const potMesh = new THREE.InstancedMesh(potGeometry(), materials.pot, Math.max(1, pots.length))
  pots.forEach((p, i) => {
    potMesh.setMatrixAt(i, p.m)
    potMesh.setColorAt(i, p.color)
  })
  potMesh.count = pots.length
  potMesh.name = 'pots'
  group.add(potMesh)
  for (const leaf of Object.keys(LEAF) as Leaf[]) {
    const mine = pots.filter((p) => p.leaf === leaf)
    if (!mine.length) continue
    const mesh = new THREE.InstancedMesh(crownGeometry(leaf), materials.leaves, mine.length)
    mine.forEach((p, i) => mesh.setMatrixAt(i, p.m))
    mesh.name = `pot plants ${leaf}`
    group.add(mesh)
  }
  for (const m of cards.build(materials.leaves, 'climbers', { uv: 'stored' })) group.add(m)
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    ;(mesh as THREE.InstancedMesh).computeBoundingSphere?.()
    noRaycast(mesh)
  })
  return group
}

/** a leaf card flat to the facade (facing `out`), `w` wide, turned in its plane by `turn` */
function wallCard(cards: CellMesh, centre: THREE.Vector3, out: THREE.Vector3, w: number, h: number, turn: number, leaf: Leaf): void {
  const along = new THREE.Vector3(-out.z, 0, out.x).normalize()
  const up = new THREE.Vector3(0, 1, 0)
  const c = Math.cos(turn)
  const s = Math.sin(turn)
  const corner = (x: number, y: number) =>
    centre
      .clone()
      .addScaledVector(along, (x * c - y * s) * w * 0.5)
      .addScaledVector(up, (x * s + y * c) * h * 0.5)
  cards.facing(corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1), out, undefined, cellUV(leaf))
}

/** ivy (or bougainvillea) hanging down the wall from the parapet in a few strands */
function climber(cards: CellMesh, f: Extract<Feature, { a: THREE.Vector3 }>, rand: () => number): void {
  const leaf: Leaf = rand() < 0.75 ? 'ivy' : 'bougainvillea'
  const len = f.a.distanceTo(f.b)
  const strands = 1 + Math.floor(rand() * Math.min(4, len / 2.5))
  const start = rand() * Math.max(0, len - strands * 1.2)
  for (let k = 0; k < strands; k++) {
    const t = Math.min(1, (start + k * (0.8 + rand() * 0.8)) / len)
    const top = f.a.clone().lerp(f.b, t)
    const length = 1.2 + rand() * rand() * 4.5
    let drift = 0
    // a mat pouring over the parapet first, then the strand hanging from it
    for (let x = -0.9; x <= 0.9; x += 0.45) {
      const p = top.clone().addScaledVector(new THREE.Vector3(-f.out.z, 0, f.out.x), x + (rand() - 0.5) * 0.2).add(new THREE.Vector3(0, -rand() * 0.5, 0)).addScaledVector(f.out, 0.05 + rand() * 0.05)
      wallCard(cards, p, f.out, 0.8, 0.8, rand() * Math.PI * 2, leaf)
    }
    for (let y = 0; y < length; y += 0.26) {
      drift += (rand() - 0.5) * 0.18
      // wide under the mat, narrowing as it hangs
      const w = (1.05 - (y / length) * 0.55) * (0.8 + rand() * 0.4)
      const p = top.clone().addScaledVector(new THREE.Vector3(-f.out.z, 0, f.out.x), drift).add(new THREE.Vector3(0, 0.1 - y, 0)).addScaledVector(f.out, 0.04 + rand() * 0.07)
      wallCard(cards, p, f.out, w, w, rand() * Math.PI * 2, leaf)
    }
  }
}

/** flowers spilling down over a balcony's rail, in front of its slab */
function cascade(cards: CellMesh, f: Extract<Feature, { a: THREE.Vector3 }>, leaf: Leaf, reach: number, rand: () => number): void {
  const len = f.a.distanceTo(f.b)
  const along = f.b.clone().sub(f.a).normalize()
  const from = rand() * len * 0.5
  const span = Math.min(len - from, 0.8 + rand() * 1.8)
  for (let x = from; x < from + span; x += 0.3) {
    for (let y = 0; y < reach * (0.6 + rand() * 0.6); y += 0.26) {
      // (just in front of the rail: the feature line sits on the slab behind it)
      const p = f.a.clone().addScaledVector(along, x).addScaledVector(f.out, 0.5 + rand() * 0.06).add(new THREE.Vector3(0, 0.75 - y, 0))
      wallCard(cards, p, f.out, 0.55, 0.55, rand() * Math.PI * 2, leaf)
    }
  }
}
