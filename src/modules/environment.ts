import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { SceneContext, SceneModule } from './module'

export interface EnvironmentOptions {
  /** image-based-lighting strength for reflections on metal/glass */
  intensity?: number
}

/** Image-based lighting from a procedural room — drives reflections on metal/glass. */
export function environmentModule(options: EnvironmentOptions = {}): SceneModule {
  let envTexture: THREE.Texture | undefined
  return {
    name: 'environment',
    setup(ctx: SceneContext) {
      const pmrem = new THREE.PMREMGenerator(ctx.renderer)
      envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
      pmrem.dispose()
      ctx.scene.environment = envTexture
      ctx.scene.environmentIntensity = options.intensity ?? 0.55
    },
    dispose(ctx: SceneContext) {
      ctx.scene.environment = null
      envTexture?.dispose()
    },
  }
}
