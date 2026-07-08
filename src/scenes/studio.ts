import { backgroundModule } from '../modules/background'
import { environmentModule } from '../modules/environment'
import { lightingModule } from '../modules/lighting'
import { floorModule } from '../modules/floor'
import type { SceneDef } from './scene'

/** Dark studio material showcase — one ball of every surface under a key light. */
export const studio: SceneDef = {
  name: 'studio',
  createModules: () => [
    backgroundModule({ color: 0x0b0d12 }),
    environmentModule({ intensity: 0.55 }),
    lightingModule({ rim: true, key: true }),
    floorModule({ color: 0x101216 }),
  ],
  composition: [
    { surface: 'chrome', radius: 1.7 },
    { surface: 'gold', radius: 1.3 },
    { surface: 'copper', radius: 1.05 },
    { surface: 'glass', radius: 1.45 },
    { surface: 'neon', radius: 1.0, options: { color: 0x35e0ff } },
    { surface: 'neon', radius: 1.2, options: { color: 0xff3fd4 } },
    { surface: 'neon', radius: 0.9, options: { color: 0xffa02e } },
    { surface: 'stone', radius: 1.85 },
    { surface: 'polished-pebble', radius: 1.15 },
    { surface: 'beach-ball', radius: 1.75 },
    { surface: 'checker', radius: 1.2 },
    { surface: 'marble', radius: 1.4 },
    { surface: 'rubber', radius: 1.3 },
    { surface: 'iridescent', radius: 1.15 },
    { surface: 'magma', radius: 1.9 },
    { surface: 'obsidian', radius: 1.5 },
  ],
}
