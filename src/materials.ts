import * as THREE from 'three'
import { pebbleTextures, beachBallTexture, checkerTexture, marbleTexture } from './textures'

export interface SurfaceOptions {
  /** override the surface's base color (also drives light color on luminous surfaces) */
  color?: THREE.ColorRepresentation
  /** override roughness where it makes sense */
  roughness?: number
}

export interface SurfaceDef {
  /** physical density — mass = density × radius³ */
  density: number
  /** luminous surfaces emit light: the ball gets an emissive material + a point light */
  luminous?: boolean
  create(options?: SurfaceOptions): THREE.Material
}

const registry = new Map<string, SurfaceDef>()

/** Add (or replace) a surface in the registry. */
export function registerSurface(name: string, def: SurfaceDef): void {
  registry.set(name, def)
}

export function getSurface(name: string): SurfaceDef {
  const def = registry.get(name)
  if (!def) {
    throw new Error(`Unknown surface "${name}". Available: ${listSurfaces().join(', ')}`)
  }
  return def
}

export function listSurfaces(): string[] {
  return [...registry.keys()]
}

// ---------------------------------------------------------------------------
// built-in surfaces
// ---------------------------------------------------------------------------

// procedural textures are shared across every ball that uses them
let pebbleTex: ReturnType<typeof pebbleTextures> | undefined
function pebble() {
  return (pebbleTex ??= pebbleTextures())
}

registerSurface('chrome', {
  density: 3,
  create: (o) =>
    new THREE.MeshStandardMaterial({
      color: o?.color ?? 0xffffff,
      metalness: 1,
      roughness: o?.roughness ?? 0.04,
    }),
})

registerSurface('gold', {
  density: 3.2,
  create: (o) =>
    new THREE.MeshStandardMaterial({
      color: o?.color ?? 0xd4a94e,
      metalness: 1,
      roughness: o?.roughness ?? 0.28,
    }),
})

registerSurface('copper', {
  density: 3.1,
  create: (o) =>
    new THREE.MeshStandardMaterial({
      color: o?.color ?? 0xb0603a,
      metalness: 1,
      roughness: o?.roughness ?? 0.45,
    }),
})

registerSurface('glass', {
  density: 1.4,
  create: (o) =>
    new THREE.MeshPhysicalMaterial({
      color: o?.color ?? 0xffffff,
      metalness: 0,
      roughness: o?.roughness ?? 0.02,
      transmission: 1,
      thickness: 2.4,
      ior: 1.5,
      specularIntensity: 1,
    }),
})

registerSurface('neon', {
  density: 0.8,
  luminous: true,
  create: (o) => {
    const color = new THREE.Color(o?.color ?? 0x35e0ff)
    return new THREE.MeshStandardMaterial({
      color: color.clone().multiplyScalar(0.08),
      emissive: color,
      // keep below tone-mapping clip: higher values wash the surface to white
      emissiveIntensity: 1.2,
      roughness: o?.roughness ?? 0.4,
    })
  },
})

registerSurface('stone', {
  density: 2.4,
  create: (o) =>
    new THREE.MeshStandardMaterial({
      map: pebble().map,
      bumpMap: pebble().bumpMap,
      bumpScale: 0.6,
      roughness: o?.roughness ?? 0.95,
      metalness: 0,
    }),
})

registerSurface('polished-pebble', {
  density: 2.4,
  create: (o) =>
    new THREE.MeshPhysicalMaterial({
      map: pebble().map,
      color: o?.color ?? 0x777066,
      roughness: o?.roughness ?? 0.55,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    }),
})

registerSurface('beach-ball', {
  density: 0.35,
  create: (o) =>
    new THREE.MeshPhysicalMaterial({
      map: beachBallTexture(),
      roughness: o?.roughness ?? 0.32,
      clearcoat: 0.5,
      clearcoatRoughness: 0.25,
    }),
})

registerSurface('checker', {
  density: 1.2,
  create: (o) =>
    new THREE.MeshStandardMaterial({
      map: checkerTexture(),
      roughness: o?.roughness ?? 0.5,
    }),
})

registerSurface('marble', {
  density: 2.6,
  create: (o) =>
    new THREE.MeshPhysicalMaterial({
      map: marbleTexture(),
      roughness: o?.roughness ?? 0.18,
      clearcoat: 1,
      clearcoatRoughness: 0.06,
    }),
})

registerSurface('rubber', {
  density: 1.1,
  create: (o) =>
    new THREE.MeshStandardMaterial({
      color: o?.color ?? 0xb42222,
      roughness: o?.roughness ?? 0.9,
      metalness: 0,
    }),
})

registerSurface('iridescent', {
  density: 0.6,
  create: (o) =>
    new THREE.MeshPhysicalMaterial({
      color: o?.color ?? 0x8899aa,
      metalness: 0.4,
      roughness: o?.roughness ?? 0.12,
      iridescence: 1,
      iridescenceIOR: 1.6,
    }),
})
