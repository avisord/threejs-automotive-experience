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
   * ground-lying maps); 'stored' — the uvs given with the triangles.
   */
  build(material: THREE.Material, name: string, opts: { uv?: 'world' | 'stored'; colors?: boolean } = {}): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = []
    for (const [key, b] of this.cells) {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(b.position, 3))
      if (opts.colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(b.color, 3))
      if (opts.uv === 'stored') geometry.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2))
      else if (opts.uv === 'world') {
        const uv = new Float32Array((b.position.length / 3) * 2)
        for (let i = 0, j = 0; i < b.position.length; i += 3, j += 2) {
          uv[j] = b.position[i]
          uv[j + 1] = b.position[i + 2]
        }
        geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
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

const WHITE = new THREE.Color(1, 1, 1)
const e1 = new THREE.Vector3()
const e2 = new THREE.Vector3()
