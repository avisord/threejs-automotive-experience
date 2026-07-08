import type * as THREE from 'three'
import type { Bounds } from '../physics'

export interface SceneContext {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  bounds: Bounds
}

/**
 * A self-contained piece of scene setup (background, lighting, floor, …).
 * Modules are added to the host, which drives their lifecycle.
 */
export interface SceneModule {
  name: string
  setup(ctx: SceneContext): void
  /** called every frame with the frame's delta time */
  update?(dt: number, ctx: SceneContext): void
  /** called when the viewport or play-area bounds change */
  resize?(ctx: SceneContext): void
  dispose?(ctx: SceneContext): void
}

export interface ModuleHost {
  /** add and set up a module; replaces (and disposes) any module with the same name */
  add<M extends SceneModule>(module: M): M
  remove(name: string): void
  get(name: string): SceneModule | undefined
  list(): string[]
  update(dt: number): void
  resize(): void
}

export function createModuleHost(ctx: SceneContext): ModuleHost {
  const active = new Map<string, SceneModule>()
  return {
    add(module) {
      active.get(module.name)?.dispose?.(ctx)
      module.setup(ctx)
      active.set(module.name, module)
      return module
    },
    remove(name) {
      const module = active.get(name)
      if (!module) return
      module.dispose?.(ctx)
      active.delete(name)
    },
    get: (name) => active.get(name),
    list: () => [...active.keys()],
    update(dt) {
      for (const m of active.values()) m.update?.(dt, ctx)
    },
    resize() {
      for (const m of active.values()) m.resize?.(ctx)
    },
  }
}
