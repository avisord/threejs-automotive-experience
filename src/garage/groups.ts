import * as THREE from 'three'
import { createPaintMaterial, type PaintMaterial } from './paint'
import type { PaintControlSettings } from './ui/paint-controls'
import { createHighlighter, type HighlightKind } from './highlight'
import type { CarProfile } from './cars'

export type GroupMaterial = PaintControlSettings

export interface MaterialGroup {
  id: string
  name: string
  members: Set<THREE.Mesh>
  material: GroupMaterial
}

interface SavedGroup {
  id: string
  name: string
  members: string[]
  material: GroupMaterial
}

export const DEFAULT_GROUP_MATERIAL: GroupMaterial = {
  style: 'solid',
  colorA: '#35e0ff',
  colorB: '#15171b',
  hue: 0,
  finish: 'gloss',
}

// mesh names that say nothing — fall back to the material name for these
const ANONYMOUS = /^(Object|mesh|polySurface|Mesh)_?\d+$/i

/** a readable label for a mesh: its node name, or its material's when the node name is noise */
export function meshLabel(mesh: THREE.Mesh): string {
  const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name
    .replace(/(-paint)+$/, '') // configurator / group clones
    .replace(/\.\d+$/, '') // Blender's .001 suffixes
  const parent = mesh.parent?.name ?? ''
  const splitPrimitive = parent !== '' && mesh.name.replace(/_\d+$/, '') === parent // one node, many materials
  let node = ANONYMOUS.test(mesh.name) && parent && !ANONYMOUS.test(parent) ? parent : mesh.name
  if (ANONYMOUS.test(node) || splitPrimitive) node = ''
  return (node || material || mesh.name).replace(/^fast/, '').replace(/_+/g, ' ').trim()
}

/**
 * User-made material groups on the car in the bay: pick meshes, group them,
 * give the group one material. Each member keeps its own clone (so normal
 * maps and alpha cut-outs survive) but every clone follows the group's
 * settings. Ungrouping restores whatever the mesh wore before.
 */
export interface GroupEditor {
  readonly groups: MaterialGroup[]
  readonly selection: ReadonlySet<THREE.Mesh>
  /** replace the selection, or toggle meshes in/out of it */
  select(meshes: THREE.Mesh[], mode?: 'replace' | 'toggle'): void
  /** new group from the current selection; members leave any group they were in */
  groupSelection(): MaterialGroup | null
  addSelectionTo(groupId: string): void
  removeMember(groupId: string, mesh: THREE.Mesh): void
  deleteGroup(groupId: string): void
  rename(groupId: string, name: string): void
  setMaterial(groupId: string, patch: Partial<GroupMaterial>): void
  /** tint hovered / inspected meshes (selection is tinted automatically) */
  highlight(kind: Exclude<HighlightKind, 'selected'>, meshes: Iterable<THREE.Mesh>): void
  setOverlaysVisible(visible: boolean): void
  /** meshes that can be picked (everything visible on the car) */
  readonly pickable: THREE.Mesh[]
  dispose(): void
}

export function createGroupEditor(
  root: THREE.Object3D,
  profile: CarProfile,
  carSpace: THREE.Matrix4,
  onChange: () => void,
): GroupEditor {
  const byName = new Map<string, THREE.Mesh>()
  const pickable: THREE.Mesh[] = []
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh || mesh.userData.overlay) return
    byName.set(mesh.name, mesh)
    pickable.push(mesh)
  })

  const highlighter = createHighlighter()
  const groups: MaterialGroup[] = []
  const selection = new Set<THREE.Mesh>()
  /** what a grouped mesh wore before joining — restored when it leaves */
  const original = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  /** per group: one paint clone per distinct source material */
  const paints = new Map<string, Map<THREE.Material, PaintMaterial>>()
  let nextId = 1

  const storageKey = `garage.groups.v1.${profile.id}`

  function save(): void {
    const data: SavedGroup[] = groups.map((g) => ({
      id: g.id,
      name: g.name,
      members: [...g.members].map((m) => m.name),
      material: g.material,
    }))
    try {
      localStorage.setItem(storageKey, JSON.stringify(data))
    } catch {
      // not persisted — fine
    }
  }

  function changed(): void {
    save()
    onChange()
  }

  function groupOf(mesh: THREE.Mesh): MaterialGroup | undefined {
    return groups.find((g) => g.members.has(mesh))
  }

  /** dress a member in its group's material (a clone of what it wore, driven by the group) */
  function dress(group: MaterialGroup, mesh: THREE.Mesh): void {
    if (!original.has(mesh)) original.set(mesh, mesh.material)
    const source = original.get(mesh)!
    const base = Array.isArray(source) ? source[0] : source
    const clones = paints.get(group.id) ?? new Map<THREE.Material, PaintMaterial>()
    paints.set(group.id, clones)
    let paint = clones.get(base)
    if (!paint) {
      paint = createPaintMaterial(base, carSpace)
      paint.apply({ ...group.material, opacity: null })
      clones.set(base, paint)
    }
    mesh.material = paint.material
  }

  function undress(mesh: THREE.Mesh): void {
    const source = original.get(mesh)
    if (source) mesh.material = source
    original.delete(mesh)
  }

  function leaveCurrentGroup(mesh: THREE.Mesh): void {
    const g = groupOf(mesh)
    if (!g) return
    g.members.delete(mesh)
    undress(mesh)
  }

  function join(group: MaterialGroup, meshes: Iterable<THREE.Mesh>): void {
    for (const mesh of meshes) {
      if (group.members.has(mesh)) continue
      leaveCurrentGroup(mesh)
      group.members.add(mesh)
      dress(group, mesh)
    }
    // groups emptied by the move go away
    for (const g of [...groups]) if (g !== group && g.members.size === 0) dropGroup(g)
  }

  function dropGroup(group: MaterialGroup): void {
    for (const mesh of group.members) undress(mesh)
    for (const paint of paints.get(group.id)?.values() ?? []) paint.material.dispose()
    paints.delete(group.id)
    groups.splice(groups.indexOf(group), 1)
  }

  function makeGroup(name: string, material: GroupMaterial, id = `g${nextId++}`): MaterialGroup {
    const group: MaterialGroup = { id, name, members: new Set(), material: { ...material } }
    groups.push(group)
    return group
  }

  function syncSelection(): void {
    highlighter.set('selected', selection)
  }

  // restore saved groups; members that no longer exist are skipped
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? '[]') as SavedGroup[]
    for (const s of saved) {
      const meshes = s.members.map((n) => byName.get(n)).filter((m): m is THREE.Mesh => !!m)
      if (meshes.length === 0) continue
      const idNum = Number(s.id.slice(1))
      if (idNum >= nextId) nextId = idNum + 1
      join(makeGroup(s.name, { ...DEFAULT_GROUP_MATERIAL, ...s.material }, s.id), meshes)
    }
  } catch {
    // corrupt or blocked storage — start empty
  }

  const find = (id: string) => groups.find((g) => g.id === id)

  return {
    groups,
    selection,
    pickable,
    select(meshes, mode = 'replace') {
      if (mode === 'replace') selection.clear()
      for (const m of meshes) {
        if (mode === 'toggle' && selection.has(m)) selection.delete(m)
        else selection.add(m)
      }
      syncSelection()
      onChange()
    },
    groupSelection() {
      if (selection.size === 0) return null
      const group = makeGroup(`Group ${nextId}`, DEFAULT_GROUP_MATERIAL)
      join(group, selection)
      selection.clear()
      syncSelection()
      changed()
      return group
    },
    addSelectionTo(groupId) {
      const group = find(groupId)
      if (!group || selection.size === 0) return
      join(group, selection)
      selection.clear()
      syncSelection()
      changed()
    },
    removeMember(groupId, mesh) {
      const group = find(groupId)
      if (!group?.members.has(mesh)) return
      group.members.delete(mesh)
      undress(mesh)
      if (group.members.size === 0) dropGroup(group)
      changed()
    },
    deleteGroup(groupId) {
      const group = find(groupId)
      if (!group) return
      dropGroup(group)
      changed()
    },
    rename(groupId, name) {
      const group = find(groupId)
      if (!group) return
      group.name = name.trim() || group.name
      changed()
    },
    setMaterial(groupId, patch) {
      const group = find(groupId)
      if (!group) return
      Object.assign(group.material, patch)
      for (const paint of paints.get(groupId)?.values() ?? []) paint.apply({ ...group.material, opacity: null })
      changed()
    },
    highlight(kind, meshes) {
      highlighter.set(kind, meshes)
      onChange()
    },
    setOverlaysVisible(visible) {
      highlighter.setVisible(visible)
      onChange()
    },
    dispose() {
      highlighter.dispose()
      for (const g of [...groups]) {
        for (const paint of paints.get(g.id)?.values() ?? []) paint.material.dispose()
      }
    },
  }
}
