import { neonPit } from './neon-pit'
import { studio } from './studio'
import type { SceneDef } from './scene'

export type { SceneDef } from './scene'

/**
 * All available scenes. Add a new one:
 *   1. create src/scenes/my-scene.ts exporting a SceneDef
 *   2. list it here
 *   3. set ACTIVE_SCENE = 'my-scene' in main.ts
 */
export const SCENES = {
  'neon-pit': neonPit,
  studio: studio,
} satisfies Record<string, SceneDef>

export type SceneName = keyof typeof SCENES
