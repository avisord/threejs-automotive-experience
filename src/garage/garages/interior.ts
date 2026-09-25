import * as THREE from 'three'

/** one group of a room's own lights, as the user sets it (Menu › Garage › Interior lights) */
export interface InteriorGroupSetting {
  on: boolean
  /** × the room's designed output */
  intensity: number
  /** colour temperature, kelvin */
  kelvin: number
}

export interface InteriorSettings {
  /** dims every group together */
  master: number
  groups: Record<string, InteriorGroupSetting>
}

/** what a room exposes: its light groups and their settings */
export interface InteriorLights {
  groups: { id: string; name: string; hint: string }[]
  defaults(): InteriorSettings
  get(): InteriorSettings
  set(settings: InteriorSettings): void
}

/** something a group drives, with its designed output captured when the group is made */
export type InteriorMember =
  /** a real light; `intensity` is its designed output (it may follow the sun) */
  | { light: THREE.Light; intensity?: () => number }
  /** an unlit glow strip (kit.glowMaterial): its colour carries the output */
  | { glow: THREE.MeshBasicMaterial }
  /** a surface's faint emissive glow */
  | { emissive: THREE.MeshStandardMaterial }

export interface InteriorGroupDef {
  id: string
  name: string
  hint: string
  /** the colour temperature the group was designed at: its members keep their own colours there */
  kelvin: number
  members: InteriorMember[]
}

export const KELVIN = { min: 2200, max: 7500 }

/**
 * Blackbody colour (sRGB, 0–1) for a temperature — Tanner Helland's fit,
 * good from ~1,000 to 40,000 K, which is all a light fitting needs.
 */
export function kelvinToRGB(kelvin: number, out = new THREE.Color()): THREE.Color {
  const t = kelvin / 100
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307
  const c = (v: number) => THREE.MathUtils.clamp(v, 0, 255) / 255
  return out.setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace)
}

/**
 * A room's own lights, grouped so the user can switch, dim and warm them.
 * Each member keeps its designed colour at the group's design temperature;
 * another temperature tints it by the ratio of the two blackbody colours, so
 * the defaults look exactly as the room was built. `refresh()` re-applies
 * everything — call it when a member's designed output changes (the sun).
 */
export function createInteriorLights(defs: InteriorGroupDef[]): InteriorLights & { refresh(): void } {
  const captured = defs.map((def) => ({
    def,
    members: def.members.map((m) => {
      if ('light' in m) {
        const base = m.light.intensity
        return { ...m, color: m.light.color.clone(), intensity: m.intensity ?? (() => base) }
      }
      if ('glow' in m) return { ...m, color: m.glow.color.clone() }
      return { ...m, color: m.emissive.emissive.clone(), level: m.emissive.emissiveIntensity }
    }),
  }))
  const defaults = (): InteriorSettings => ({
    master: 1,
    groups: Object.fromEntries(defs.map((d) => [d.id, { on: true, intensity: 1, kelvin: d.kelvin }])),
  })
  let current = defaults()
  const tint = new THREE.Color()
  const design = new THREE.Color()

  function refresh(): void {
    for (const { def, members } of captured) {
      const s = current.groups[def.id] ?? { on: true, intensity: 1, kelvin: def.kelvin }
      const level = s.on ? s.intensity * current.master : 0
      kelvinToRGB(s.kelvin, tint)
      kelvinToRGB(def.kelvin, design)
      tint.setRGB(tint.r / Math.max(design.r, 1e-3), tint.g / Math.max(design.g, 1e-3), tint.b / Math.max(design.b, 1e-3))
      for (const m of members) {
        if ('light' in m) {
          // (an area light switched off keeps its place in the shaders: intensity 0, never removed,
          // or every material in the scene would recompile)
          m.light.intensity = m.intensity() * level
          m.light.color.copy(m.color).multiply(tint)
        } else if ('glow' in m) {
          m.glow.color.copy(m.color).multiply(tint).multiplyScalar(level)
        } else {
          m.emissive.emissive.copy(m.color).multiply(tint)
          m.emissive.emissiveIntensity = m.level * level
        }
      }
    }
  }

  return {
    groups: defs.map(({ id, name, hint }) => ({ id, name, hint })),
    defaults,
    get: () => structuredClone(current),
    set(settings) {
      // saved settings may predate a group: fill in what's missing
      const base = defaults()
      current = { master: settings.master ?? 1, groups: { ...base.groups } }
      for (const id of Object.keys(base.groups)) if (settings.groups?.[id]) current.groups[id] = { ...base.groups[id], ...settings.groups[id] }
      refresh()
    },
    refresh,
  }
}
