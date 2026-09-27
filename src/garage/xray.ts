import * as THREE from 'three'

/**
 * A layer no camera renders: a ghosted mesh moves here so only its see-through
 * copy (a child on the default layer) is drawn. Layers aren't inherited, so the
 * mesh's highlight overlays — also children — still show. Mirrors and env
 * captures render layer 0 only, so they drop the mesh the same way.
 */
const GHOST_LAYER = 3

/** raycasts one mesh into `hits` — the mesh's own raycast, or three-mesh-bvh's accelerated one */
export type MeshCast = (mesh: THREE.Mesh, raycaster: THREE.Raycaster, hits: THREE.Intersection[]) => void

/**
 * Menu › Parts' view aids for reaching parts under others: ghost the parts in
 * front of the one being worked on (faint fresnel shells instead of the real
 * surface), and hide parts outright to peel a car layer by layer. Materials are
 * never touched — the configurator and groups swap those — so this composes
 * with every paint and highlight.
 */
export interface Xray {
  readonly hidden: ReadonlySet<THREE.Mesh>
  readonly ghosts: ReadonlySet<THREE.Mesh>
  hide(meshes: Iterable<THREE.Mesh>): void
  unhideAll(): void
  /** ghost exactly these meshes (others go back to normal) */
  setGhosts(meshes: Iterable<THREE.Mesh>): void
  dispose(): void
}

export function createXray(): Xray {
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xcfe6ff) } },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalMatrix * normal;
        vView = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 color;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // faint face-on, brighter at grazing angles: the shell's outline reads, its faces don't
        float f = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
        gl_FragColor = vec4(color, 0.025 + 0.22 * f * f);
      }`,
    transparent: true,
    depthWrite: false,
  })
  // meshes without normals (rare) get a flat tint
  const flat = new THREE.MeshBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.08, depthWrite: false })

  const hidden = new Set<THREE.Mesh>()
  /** ghosted mesh → its see-through copy and the layers it had */
  const ghosts = new Map<THREE.Mesh, { shell: THREE.Mesh; mask: number }>()

  function ghost(mesh: THREE.Mesh): void {
    const shell = new THREE.Mesh(mesh.geometry, mesh.geometry.attributes.normal ? material : flat)
    shell.name = `${mesh.name}-ghost`
    shell.renderOrder = 9 // under the highlight tints
    shell.raycast = () => {}
    shell.frustumCulled = mesh.frustumCulled
    shell.userData.overlay = true
    mesh.add(shell)
    ghosts.set(mesh, { shell, mask: mesh.layers.mask })
    mesh.layers.set(GHOST_LAYER)
  }

  function unghost(mesh: THREE.Mesh): void {
    const g = ghosts.get(mesh)
    if (!g) return
    g.shell.removeFromParent()
    mesh.layers.mask = g.mask
    ghosts.delete(mesh)
  }

  return {
    hidden,
    get ghosts() {
      return new Set(ghosts.keys())
    },
    hide(meshes) {
      for (const mesh of meshes) {
        unghost(mesh)
        mesh.visible = false
        hidden.add(mesh)
      }
    },
    unhideAll() {
      for (const mesh of hidden) mesh.visible = true
      hidden.clear()
    },
    setGhosts(meshes) {
      const want = new Set(meshes)
      for (const mesh of [...ghosts.keys()]) if (!want.has(mesh)) unghost(mesh)
      for (const mesh of want) if (!ghosts.has(mesh) && !hidden.has(mesh)) ghost(mesh)
    },
    dispose() {
      for (const mesh of [...ghosts.keys()]) unghost(mesh)
      for (const mesh of hidden) mesh.visible = true
      hidden.clear()
      material.dispose()
      flat.dispose()
    },
  }
}

const sampleRay = new THREE.Raycaster()
const dir = new THREE.Vector3()
const sphere = new THREE.Sphere()
const hits: THREE.Intersection[] = []

/**
 * Which `candidates` stand between the eye and any of `targets`: rays from the
 * eye to points spread over each target's vertices (and its centre), each asking
 * every candidate whose bounds it crosses for a hit short of the point. Per mesh,
 * not per pixel — a body shell over a seat ghosts as a whole.
 */
export function findOccluders(
  targets: THREE.Mesh[],
  candidates: THREE.Mesh[],
  eye: THREE.Vector3,
  cast: MeshCast,
  budget = 160,
): Set<THREE.Mesh> {
  const found = new Set<THREE.Mesh>()
  if (targets.length === 0 || candidates.length === 0) return found

  const bounds = candidates.map((mesh) => {
    const geometry = mesh.geometry
    if (!geometry.boundingSphere) geometry.computeBoundingSphere()
    return geometry.boundingSphere!.clone().applyMatrix4(mesh.matrixWorld)
  })

  const points: THREE.Vector3[] = []
  const perTarget = Math.max(6, Math.floor(budget / targets.length))
  for (const mesh of targets) {
    const position = mesh.geometry.attributes.position
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere()
    points.push(mesh.geometry.boundingSphere!.center.clone().applyMatrix4(mesh.matrixWorld))
    const step = Math.max(1, Math.floor(position.count / perTarget))
    for (let i = 0; i < position.count; i += step) {
      points.push(new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))
    }
  }

  ;(sampleRay as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true // three-mesh-bvh: nearest hit only
  for (const p of points) {
    const dist = dir.subVectors(p, eye).length()
    if (dist < 1e-4) continue
    sampleRay.set(eye, dir.divideScalar(dist))
    // stop short of the target's own surface (and whatever is glued flush to it)
    sampleRay.far = dist * 0.998 - 0.002
    for (let c = 0; c < candidates.length; c++) {
      const mesh = candidates[c]
      if (found.has(mesh)) continue
      sphere.copy(bounds[c])
      if (!sampleRay.ray.intersectsSphere(sphere)) continue
      if (sampleRay.ray.origin.distanceTo(sphere.center) - sphere.radius > sampleRay.far) continue
      hits.length = 0
      cast(mesh, sampleRay, hits)
      if (hits.length > 0) found.add(mesh)
    }
  }
  return found
}
