import * as THREE from 'three'

interface Cell {
  position: number[]
  color: number[]
  uv: number[]
}

/**
 * Triangles gathered into square cells of the ground plan (`cell` m), each
 * cell one mesh: a street's ribbons or a row of houses 600 m long split this
 * way are culled cell by cell, and the SSR scope (within 60 m of the car)
 * takes only the cells near it.
 */
export class CellMesh {
  private cells = new Map<string, Cell>()
  private readonly cell: number

  constructor(cell = 80) {
    this.cell = cell
  }

  private bucket(x: number, z: number): Cell {
    const key = `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`
    let b = this.cells.get(key)
    if (!b) this.cells.set(key, (b = { position: [], color: [], uv: [] }))
    return b
  }

  /** one triangle, counter-clockwise seen from its front, in a colour (linear), with optional uvs */
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color = WHITE, uv?: [number, number][]): void {
    const cell = this.bucket((a.x + b.x + c.x) / 3, (a.z + b.z + c.z) / 3)
    cell.position.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z)
    for (let i = 0; i < 3; i++) cell.color.push(color.r, color.g, color.b)
    if (uv) cell.uv.push(uv[0][0], uv[0][1], uv[1][0], uv[1][1], uv[2][0], uv[2][1])
    else cell.uv.push(0, 0, 0, 0, 0, 0)
  }

  /** a quad a → b → c → d, counter-clockwise seen from its front */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color?: THREE.Color, uv?: [number, number][]): void {
    this.tri(a, b, c, color, uv && [uv[0], uv[1], uv[2]])
    this.tri(a, c, d, color, uv && [uv[0], uv[2], uv[3]])
  }

  /** a quad whose winding is picked so it faces `dir` */
  facing(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, dir: THREE.Vector3, color?: THREE.Color, uv?: [number, number][]): void {
    const n = e1.subVectors(b, a).cross(e2.subVectors(c, a))
    if (n.dot(dir) >= 0) this.quad(a, b, c, d, color, uv)
    else this.quad(a, d, c, b, color, uv && [uv[0], uv[3], uv[2], uv[1]])
  }

  /**
   * The meshes, one per cell, in `material`. `uv`: 'world' — metres from the world x/z (for
   * ground-lying maps); 'stored' — the uvs given with the triangles; 'box' — each triangle
   * projected on the world plane its normal faces most (walls and blocks, in metres).
   * `street`: a per-vertex (s, d, half-width) — arc length along, offset from and half the width of
   * a street's carriageway (the paving shaders lay their courses in it).
   */
  build(
    material: THREE.Material,
    name: string,
    opts: { uv?: 'world' | 'stored' | 'box'; colors?: boolean; street?: (x: number, z: number) => [number, number, number] } = {},
  ): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    for (const [key, b] of this.cells) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3))
      if (opts.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.color, 3))
      if (opts.uv === 'stored') geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      else if (opts.uv === 'box') geometry.setAttribute('uv', new THREE.BufferAttribute(boxUV(b.position), 2))
      else if (opts.uv === 'world') {
        const uv = new Float32Array((b.position.length / 3) * 2)
        for (let i = 0, j = 0; i < b.position.length; i += 3, j += 2) {
          uv[j] = b.position[i]
          uv[j + 1] = b.position[i + 2]
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      }
      if (opts.street) {
        const st = new Float32Array(b.position.length)
        for (let i = 0; i < b.position.length; i += 3) st.set(opts.street(b.position[i], b.position[i + 2]), i)
        geometry.setAttribute('street', new THREE.BufferAttribute(st, 3))
      }
      geometry.computeVertexNormals()
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, material)
      mesh.name = `${name} ${key}`
      meshes.push(mesh)
    }
    this.cells.clear()
    return meshes
  }
}

/** per triangle: the two world axes of the plane its normal faces most, in metres */
function boxUV(position: number[]): Float32Array {
  const uv = new Float32Array((position.length / 3) * 2)
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  for (let t = 0; t < position.length; t += 9) {
    a.fromArray(position, t)
    b.fromArray(position, t + 3)
    c.fromArray(position, t + 6)
    const n = b.clone().sub(a).cross(c.clone().sub(a))
    const ax = Math.abs(n.x)
    const ay = Math.abs(n.y)
    const az = Math.abs(n.z)
    for (let k = 0; k < 3; k++) {
      const x = position[t + k * 3]
      const y = position[t + k * 3 + 1]
      const z = position[t + k * 3 + 2]
      const o = (t / 3 + k) * 2
      if (ay >= ax && ay >= az) uv.set([x, z], o)
      else if (ax >= az) uv.set([z, y], o)
      else uv.set([x, y], o)
    }
  }
  return uv
}

const WHITE = new THREE.Color(1, 1, 1)
const e1 = new THREE.Vector3()
const e2 = new THREE.Vector3()
