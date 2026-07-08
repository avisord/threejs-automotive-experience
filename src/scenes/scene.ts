import type { BallConfig } from '../balls'
import type { SceneModule } from '../modules/module'

/**
 * A complete scene preset: which environment modules to run and which balls
 * to spawn. Switching the active scene swaps the entire world.
 */
export interface SceneDef {
  name: string
  /** fresh module instances for this scene (background, lighting, floor, …) */
  createModules(): SceneModule[]
  /** ball lineup spawned when the scene loads */
  composition: BallConfig[]
}
