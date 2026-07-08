import * as THREE from 'three'
import { getSurface, type SurfaceOptions } from './materials'

export interface Ball {
  mesh: THREE.Mesh
  surface: string
  radius: number
  mass: number
  velocity: THREE.Vector3
  dragged: boolean
  dragTarget: THREE.Vector3
  light?: THREE.PointLight
}

export interface BallConfig {
  /** surface name from the registry (see materials.ts / listSurfaces()) */
  surface: string
  /** ball size — also scales mass (density × radius³) */
  radius: number
  /** override the surface's default density */
  density?: number
  /** spawn position; omitted → random spot inside the given bounds */
  position?: [number, number, number]
  /** per-ball surface tweaks, e.g. { color: 0xff0000 } */
  options?: SurfaceOptions
  /** how many balls to spawn from this config (default 1) */
  count?: number
}

export interface SpawnArea {
  x: number
  z: number
}

const spawned: THREE.Vector3[] = []

function spawnPosition(radius: number, area: SpawnArea): THREE.Vector3 {
  const pos = new THREE.Vector3()
  for (let attempt = 0; attempt < 200; attempt++) {
    pos.set(
      (Math.random() * 2 - 1) * Math.max(1, area.x - radius - 1),
      radius + 2 + Math.random() * 14,
      (Math.random() * 2 - 1) * Math.max(0, area.z - radius),
    )
    if (spawned.every((p) => p.distanceTo(pos) > 4.5)) break
  }
  spawned.push(pos.clone())
  return pos
}

export function createBall(config: BallConfig, area: SpawnArea): Ball {
  const def = getSurface(config.surface)
  const material = def.create(config.options)

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(config.radius, 64, 48), material)
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.position.copy(
    config.position ? new THREE.Vector3(...config.position) : spawnPosition(config.radius, area),
  )
  mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)

  const density = config.density ?? def.density
  const ball: Ball = {
    mesh,
    surface: config.surface,
    radius: config.radius,
    mass: density * config.radius ** 3,
    velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 2),
    dragged: false,
    dragTarget: new THREE.Vector3(),
  }

  if (def.luminous) {
    const color = new THREE.Color(config.options?.color ?? 0x35e0ff)
    const standard = material as THREE.MeshStandardMaterial
    if (standard.emissive) color.copy(standard.emissive)
    const light = new THREE.PointLight(color, 60, 28, 2)
    light.castShadow = false
    mesh.add(light)
    ball.light = light
  }

  return ball
}

export function createBalls(configs: BallConfig[], area: SpawnArea): Ball[] {
  return configs.flatMap((c) => {
    const count = Math.max(1, Math.floor(c.count ?? 1))
    return Array.from({ length: count }, (_, i) => {
      // duplicates of a fixed position get a jitter so they don't spawn
      // perfectly coincident (collision resolution can't separate dist === 0)
      const position: [number, number, number] | undefined =
        c.position && i > 0
          ? [
              c.position[0] + (Math.random() - 0.5) * c.radius,
              c.position[1] + i * c.radius * 2.1,
              c.position[2] + (Math.random() - 0.5) * c.radius,
            ]
          : c.position
      return createBall({ ...c, position }, area)
    })
  })
}

/** Free GPU resources when a ball is removed from the scene. */
export function disposeBall(ball: Ball): void {
  ball.mesh.geometry.dispose()
  const material = ball.mesh.material
  for (const m of Array.isArray(material) ? material : [material]) m.dispose()
}
