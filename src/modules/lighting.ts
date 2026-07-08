import * as THREE from 'three'
import type { SceneContext, SceneModule } from './module'

export interface LightingOptions {
  /** cool directional rim light from behind-left (default on) */
  rim?: boolean
  /** warm key light with soft shadows (default off — neon balls carry the scene) */
  key?: boolean
}

export function lightingModule(options: LightingOptions = {}): SceneModule {
  const lights: THREE.Light[] = []
  return {
    name: 'lighting',
    setup(ctx: SceneContext) {
      if (options.key ?? false) {
        const key = new THREE.DirectionalLight(0xfff2e0, 2.4)
        key.position.set(14, 28, 18)
        key.castShadow = true
        key.shadow.mapSize.set(2048, 2048)
        key.shadow.camera.left = -30
        key.shadow.camera.right = 30
        key.shadow.camera.top = 30
        key.shadow.camera.bottom = -10
        key.shadow.camera.far = 80
        key.shadow.bias = -0.0005
        key.shadow.radius = 6
        lights.push(key)
      }
      if (options.rim ?? true) {
        const rim = new THREE.DirectionalLight(0x6a8fff, 0.8)
        rim.position.set(-18, 10, -14)
        lights.push(rim)
      }
      for (const light of lights) ctx.scene.add(light)
    },
    dispose(ctx: SceneContext) {
      for (const light of lights) {
        ctx.scene.remove(light)
        light.dispose()
      }
      lights.length = 0
    },
  }
}
