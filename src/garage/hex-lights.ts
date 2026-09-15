import * as THREE from 'three'

export interface HexLightOptions {
  /** fixture footprint along x */
  width: number
  /** fixture footprint along z */
  depth: number
  /** hexagon edge length */
  cell: number
  /** LED tube thickness */
  tube?: number
  color?: THREE.ColorRepresentation
  /** HDR multiplier on the tube colour — >1 makes them bloom and show up in reflections */
  glow?: number
  /** strength of the rect area light that actually lights the room */
  lightIntensity?: number
}

type Segment = [x0: number, z0: number, x1: number, z1: number]

/** Liang–Barsky: clip a segment to the rectangle |x| ≤ hw, |z| ≤ hd. */
function clipSegment(x0: number, z0: number, x1: number, z1: number, hw: number, hd: number): Segment | null {
  const dx = x1 - x0
  const dz = z1 - z0
  const p = [-dx, dx, -dz, dz]
  const q = [x0 + hw, hw - x0, z0 + hd, hd - z0]
  let t0 = 0
  let t1 = 1
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null
      continue
    }
    const t = q[i] / p[i]
    if (p[i] < 0) {
      if (t > t1) return null
      t0 = Math.max(t0, t)
    } else {
      if (t < t0) return null
      t1 = Math.min(t1, t)
    }
  }
  return [x0 + t0 * dx, z0 + t0 * dz, x0 + t1 * dx, z0 + t1 * dz]
}

/** Every unique edge of a flat-top honeycomb, clipped to the fixture rectangle, plus its border frame. */
function honeycombSegments(width: number, depth: number, cell: number): Segment[] {
  const hw = width / 2
  const hd = depth / 2
  const colStep = cell * 1.5
  const rowStep = cell * Math.sqrt(3)
  const cols = Math.ceil(hw / colStep) + 1
  const rows = Math.ceil(hd / rowStep) + 1
  const seen = new Set<string>()
  const segments: Segment[] = [
    [-hw, -hd, hw, -hd],
    [hw, -hd, hw, hd],
    [hw, hd, -hw, hd],
    [-hw, hd, -hw, -hd],
  ]
  for (let c = -cols; c <= cols; c++) {
    for (let r = -rows; r <= rows; r++) {
      const cx = c * colStep
      const cz = r * rowStep + (c & 1 ? rowStep / 2 : 0)
      for (let k = 0; k < 6; k++) {
        const a0 = (k * Math.PI) / 3
        const a1 = ((k + 1) * Math.PI) / 3
        const x0 = cx + cell * Math.cos(a0)
        const z0 = cz + cell * Math.sin(a0)
        const x1 = cx + cell * Math.cos(a1)
        const z1 = cz + cell * Math.sin(a1)
        // neighbouring cells share edges — key them by midpoint
        const key = `${Math.round((x0 + x1) * 500)},${Math.round((z0 + z1) * 500)}`
        if (seen.has(key)) continue
        seen.add(key)
        const clipped = clipSegment(x0, z0, x1, z1, hw, hd)
        if (clipped && Math.hypot(clipped[2] - clipped[0], clipped[3] - clipped[1]) > cell * 0.08) {
          segments.push(clipped)
        }
      }
    }
  }
  return segments
}

/**
 * Honeycomb LED ceiling fixture, centred on the group origin in the XZ plane,
 * facing down. The tubes are unlit HDR geometry (bloom + reflections); a rect
 * area light of the same footprint does the actual lighting.
 */
export function createHexLights(opts: HexLightOptions): THREE.Group {
  const { width, depth, cell, tube = 0.07, color = 0xf2f6ff, glow = 3.2, lightIntensity = 2.5 } = opts
  const group = new THREE.Group()
  group.name = 'hex-lights'

  const segments = honeycombSegments(width, depth, cell)
  const tubes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, tube * 0.6, tube),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(glow) }),
    segments.length,
  )
  ;(tubes.material as THREE.Material).userData.glow = true // lights-only bloom
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const rot = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)
  segments.forEach(([x0, z0, x1, z1], i) => {
    const dx = x1 - x0
    const dz = z1 - z0
    pos.set((x0 + x1) / 2, 0, (z0 + z1) / 2)
    rot.setFromAxisAngle(up, Math.atan2(-dz, dx))
    // a little overlap so the joints read as one continuous tube
    scale.set(Math.hypot(dx, dz) + tube * 0.6, 1, 1)
    tubes.setMatrixAt(i, m.compose(pos, rot, scale))
  })
  group.add(tubes)

  // dark backing plate so the grid reads against the ceiling
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.5, 0.04, depth + 0.5),
    new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.7, metalness: 0.3 }),
  )
  backing.position.y = tube * 0.3 + 0.02
  group.add(backing)

  const light = new THREE.RectAreaLight(color, lightIntensity, width, depth)
  light.position.y = -0.05
  light.rotation.x = -Math.PI / 2 // rect lights emit along -Z; point that down
  group.add(light)

  return group
}
