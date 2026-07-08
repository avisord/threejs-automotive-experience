import type { BallConfig } from './balls'

/**
 * The default scene lineup. Edit freely — each entry is a surface from the
 * registry (src/materials.ts) plus a size and optional overrides.
 *
 * Every entry also takes `count` to spawn several of the same ball:
 *   { surface: 'rubber', radius: 0.8, count: 10 }
 *
 * You can also compose at runtime from the browser console:
 *   ballpit.surfaces()                       // list registered surfaces
 *   ballpit.add('glass', 2.5)                // big glass ball
 *   ballpit.add('neon', 1, { color: 0x00ff88 })
 *   ballpit.add('rubber', 0.8, { color: 0x2244ff }, 12)  // a dozen at once
 *   ballpit.fill(20)                         // 20 random balls
 *   ballpit.count()                          // how many are in the scene
 *   ballpit.clear()                          // empty the scene
 */
export const DEFAULT_COMPOSITION: BallConfig[] = [
  //{ surface: 'chrome', radius: 1.7, count: 0 },
  //{ surface: 'gold', radius: 1.3, count: 0 },
  //{ surface: 'copper', radius: 1.05, count: 0 },
  { surface: 'glass', radius: 1.45, count: 30 },
  { surface: 'neon', radius: 1.4, options: { color: 0x0aa4f7 }, count: 10 },
  //{ surface: 'neon', radius: 1.4, options: { color: 0x510af7 }, count: 0 },
  //{ surface: 'neon', radius: 1.2, options: { color: 0xff3fd4 } },
  //{ surface: 'neon', radius: 0.9, options: { color: 0xffa02e } },
  //{ surface: 'stone', radius: 1.85 },
  //{ surface: 'polished-pebble', radius: 1.15, count: 0 },
  //{ surface: 'beach-ball', radius: 1.75 },
  //{ surface: 'checker', radius: 1.2 },
  //{ surface: 'marble', radius: 1.4, count: 0 },
  //{ surface: 'rubber', radius: 1.3 },
  //{ surface: 'iridescent', radius: 1.15, count: 0 },
]
