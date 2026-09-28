import * as THREE from 'three'

/** one group of a room's own lights, as the user sets it (Menu › Garage › Interior lights) */
export interface InteriorGroupSetting {
  on: boolean
  /** × the room's designed output */
  intensity: number
  /** colour temperature, kelvin (white-light groups) */
  kelvin?: number
  /** colour, '#rrggbb' sRGB (coloured groups: neon, accents) */
  color?: string
}

export interface InteriorSettings {
  /** dims every group together */
  master: number
  groups: Record<string, InteriorGroupSetting>
}

/** what a room exposes: its light groups and their settings */
export interface InteriorLights {
  /** `tint` says how a group's colour is set: a colour temperature, or any colour */
  groups: { id: string; name: string; hint: string; tint: 'kelvin' | 'color' }[]
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
  /** a colour a shader reads as a light's output (street lamps drawn per pixel): scaled by the group's level */
  | { output: THREE.Color }

export type InteriorGroupDef = {
  id: string
  name: string
  hint: string
  members: InteriorMember[]
} & (
  | {
      /** white light: the colour temperature it was designed at, where its members keep their own colours */
      kelvin: number
    }
  | {
      /** coloured light (sRGB hex): picked colours replace it, each member keeping its own brightness */
      color: number
    }
)

export const KELVIN = { min: 2200, max: 10000 }

/** the light and the glowing panel of a kit.softbox */
export function softboxMembers(light: THREE.RectAreaLight): InteriorMember[] {
  return fixtureMembers(light)
}

/** every light and glow material in a fixture (a softbox, the hex ceiling): what a group dims together */
export function fixtureMembers(root: THREE.Object3D): InteriorMember[] {
  const members: InteriorMember[] = []
  const seen = new Set<THREE.Material>()
  root.traverse((obj) => {
    if ((obj as THREE.Light).isLight) members.push({ light: obj as THREE.Light })
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material as THREE.Material
    if ((material as THREE.MeshBasicMaterial).isMeshBasicMaterial && !seen.has(material)) {
      seen.add(material)
      members.push({ glow: material as THREE.MeshBasicMaterial })
    }
  })
  return members
}

const LUMA = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b

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
      if ('output' in m) return { ...m, color: m.output.clone() }
      return { ...m, color: m.emissive.emissive.clone(), level: m.emissive.emissiveIntensity }
    }),
  }))
  const designSetting = (d: InteriorGroupDef): InteriorGroupSetting =>
    'kelvin' in d
      ? { on: true, intensity: 1, kelvin: d.kelvin }
      : { on: true, intensity: 1, color: `#${new THREE.Color().setHex(d.color, THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace)}` }
  const defaults = (): InteriorSettings => ({
    master: 1,
    groups: Object.fromEntries(defs.map((d) => [d.id, designSetting(d)])),
  })
  let current = defaults()
  const tint = new THREE.Color()
  const design = new THREE.Color()
  const picked = new THREE.Color()
  const colour = new THREE.Color()

  function refresh(): void {
    for (const { def, members } of captured) {
      const s = current.groups[def.id] ?? designSetting(def)
      const level = s.on ? s.intensity * current.master : 0
      if ('kelvin' in def) {
        // white light: tint each member by the ratio of the two blackbody colours
        kelvinToRGB(s.kelvin ?? def.kelvin, tint)
        kelvinToRGB(def.kelvin, design)
        tint.setRGB(tint.r / Math.max(design.r, 1e-3), tint.g / Math.max(design.g, 1e-3), tint.b / Math.max(design.b, 1e-3))
      } else {
        // coloured light: the picked colour at the member's own brightness (a ratio would blow up
        // the channels a saturated neon hardly has)
        picked.set(s.color ?? def.color)
        design.setHex(def.color, THREE.SRGBColorSpace)
      }
      const paint = (base: THREE.Color, out: THREE.Color) =>
        'kelvin' in def
          ? out.copy(base).multiply(tint)
          : // (a very dark pick isn't pushed up to full brightness: it would blow out one channel)
            out.copy(picked).multiplyScalar(LUMA(base) / Math.max(LUMA(picked), 0.25 * LUMA(design), 1e-4))
      for (const m of members) {
        if ('light' in m) {
          // (an area light switched off keeps its place in the shaders: intensity 0, never removed,
          // or every material in the scene would recompile)
          m.light.intensity = m.intensity() * level
          paint(m.color, m.light.color)
        } else if ('output' in m) {
          m.output.copy(paint(m.color, colour)).multiplyScalar(level)
        } else if ('glow' in m) {
          m.glow.color.copy(paint(m.color, colour)).multiplyScalar(level)
        } else {
          paint(m.color, m.emissive.emissive)
          m.emissive.emissiveIntensity = m.level * level
        }
      }
    }
  }

  return {
    groups: defs.map((d) => ({ id: d.id, name: d.name, hint: d.hint, tint: 'kelvin' in d ? ('kelvin' as const) : ('color' as const) })),
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
