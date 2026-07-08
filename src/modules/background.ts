import * as THREE from 'three'
import type { SceneContext, SceneModule } from './module'

export interface BackgroundOptions {
  color?: THREE.ColorRepresentation
  fogNear?: number
  fogFar?: number
}

/** Solid background color with matching fog so the floor fades seamlessly into it. */
export function backgroundModule(options: BackgroundOptions = {}): SceneModule & {
  setColor(color: THREE.ColorRepresentation): void
} {
  const color = new THREE.Color(options.color ?? 0x12152b)
  let scene: THREE.Scene | undefined

  const apply = (): void => {
    if (!scene) return
    scene.background = color
    scene.fog = new THREE.Fog(color, options.fogNear ?? 70, options.fogFar ?? 170)
  }

  return {
    name: 'background',
    setup(ctx: SceneContext) {
      scene = ctx.scene
      apply()
    },
    dispose(ctx: SceneContext) {
      ctx.scene.background = null
      ctx.scene.fog = null
    },
    setColor(c: THREE.ColorRepresentation) {
      color.set(c)
      apply()
    },
  }
}
