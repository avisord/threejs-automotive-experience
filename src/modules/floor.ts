import * as THREE from 'three'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import type { SceneContext, SceneModule } from './module'

export interface FloorOptions {
  color?: THREE.ColorRepresentation
  /** ground glow applied on setup */
  glow?: { color: THREE.ColorRepresentation; intensity: number }
  /** real upward area light on the floor (off by default — costs a little per fragment) */
  areaLight?: boolean
}

export function floorModule(options: FloorOptions = {}): SceneModule & {
  /** tint the floor as if it emits light; intensity 0 switches it off */
  setGlow(color?: THREE.ColorRepresentation, intensity?: number): void
} {
  const material = new THREE.MeshPhysicalMaterial({
    color: options.color ?? 0x445370,
    roughness: 0.85,
    metalness: 0,
    clearcoat: 0,
    envMapIntensity: 0.15, // don't mirror the bright room env
    specularIntensity: 0.2,
  })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.receiveShadow = true

  let areaLight: THREE.RectAreaLight | undefined

  const setGlow = (color: THREE.ColorRepresentation = 0x3d5aff, intensity = 1.5): void => {
    // faint surface glow so the floor itself looks like the light source
    material.emissive.set(color)
    material.emissiveIntensity = intensity * 0.03
    if (areaLight) {
      areaLight.color.set(color)
      areaLight.intensity = intensity
    }
  }

  return {
    name: 'floor',
    setup(ctx: SceneContext) {
      ctx.scene.add(mesh)
      if (options.areaLight) {
        RectAreaLightUniformsLib.init()
        areaLight = new THREE.RectAreaLight(0x3d5aff, 0, ctx.bounds.x * 2, ctx.bounds.z * 2 + 8)
        areaLight.position.set(0, 0.05, 0)
        areaLight.lookAt(0, 10, 0)
        ctx.scene.add(areaLight)
      }
      if (options.glow) setGlow(options.glow.color, options.glow.intensity)
    },
    resize(ctx: SceneContext) {
      if (areaLight) {
        areaLight.width = ctx.bounds.x * 2
        areaLight.height = ctx.bounds.z * 2 + 8
      }
    },
    dispose(ctx: SceneContext) {
      ctx.scene.remove(mesh)
      mesh.geometry.dispose()
      material.dispose()
      if (areaLight) {
        ctx.scene.remove(areaLight)
        areaLight.dispose()
      }
    },
    setGlow,
  }
}
