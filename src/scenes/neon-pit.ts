import { backgroundModule } from '../modules/background'
import { environmentModule } from '../modules/environment'
import { lightingModule } from '../modules/lighting'
import { floorModule } from '../modules/floor'
import type { SceneDef } from './scene'

/** Dark indigo world full of glowing spheres — your current setup. */
export const neonPit: SceneDef = {
  name: 'neon-pit',
  createModules: () => [
    backgroundModule({ color: 0x12152b }),
    environmentModule({ intensity: 0.55 }),
    lightingModule({ rim: true, key: false }),
    floorModule({
      color: 0x445370,
      glow: { color: 0x3d5aff, intensity: 1.2 },
      areaLight: false,
    }),
  ],
  composition: [
    { surface: 'neon', radius: 2.4, options: { color: 0x0aa4f7 }, count: 10 },
    { surface: 'neon', radius: 2.4, options: { color: 0x6203fc }, count: 10 },
    { surface: 'marble', radius: 1.8, count: 10 },
    { surface: 'magma', radius: 1.9 },
    { surface: 'obsidian', radius: 1.5 },
  ],
}
