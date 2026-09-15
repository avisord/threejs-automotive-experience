import * as THREE from 'three'

export type HighlightKind = 'hover' | 'selected' | 'focus'

const STYLE: Record<HighlightKind, { color: number; opacity: number; order: number }> = {
  hover: { color: 0xffffff, opacity: 0.22, order: 10 },
  focus: { color: 0xffb020, opacity: 0.38, order: 11 }, // a group being inspected in the panel
  selected: { color: 0x35e0ff, opacity: 0.45, order: 12 },
}

/**
 * Tinted overlays on top of meshes: a see-through copy of each mesh (shared
 * geometry, and the same skeleton for skinned meshes) drawn just in front of
 * it. Overlays ignore raycasts and never touch the mesh's own material, so
 * meshes that share a material can still be highlighted one by one.
 */
export interface Highlighter {
  set(kind: HighlightKind, meshes: Iterable<THREE.Mesh>): void
  setVisible(visible: boolean): void
  dispose(): void
}

export function createHighlighter(): Highlighter {
  const materials = Object.fromEntries(
    (Object.keys(STYLE) as HighlightKind[]).map((kind) => [
      kind,
      new THREE.MeshBasicMaterial({
        color: STYLE[kind].color,
        transparent: true,
        opacity: STYLE[kind].opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        // pull toward the camera so the tint wins the depth test against the mesh itself
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -4,
      }),
    ]),
  ) as Record<HighlightKind, THREE.MeshBasicMaterial>

  const overlays: Record<HighlightKind, Map<THREE.Mesh, THREE.Mesh>> = { hover: new Map(), selected: new Map(), focus: new Map() }
  let visible = true

  function makeOverlay(mesh: THREE.Mesh, kind: HighlightKind): THREE.Mesh {
    let overlay: THREE.Mesh
    const skinned = mesh as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh) {
      const s = new THREE.SkinnedMesh(mesh.geometry, materials[kind])
      s.bind(skinned.skeleton, skinned.bindMatrix) // same bones, same pose
      overlay = s
    } else {
      overlay = new THREE.Mesh(mesh.geometry, materials[kind])
    }
    overlay.name = `${mesh.name}-${kind}`
    overlay.renderOrder = STYLE[kind].order
    overlay.raycast = () => {} // never pickable
    overlay.frustumCulled = mesh.frustumCulled
    overlay.visible = visible
    overlay.userData.overlay = true
    mesh.add(overlay) // identity transform: follows the mesh
    return overlay
  }

  return {
    set(kind, meshes) {
      const want = new Set(meshes)
      const have = overlays[kind]
      for (const [mesh, overlay] of have) {
        if (want.has(mesh)) continue
        overlay.removeFromParent()
        have.delete(mesh)
      }
      for (const mesh of want) if (!have.has(mesh)) have.set(mesh, makeOverlay(mesh, kind))
    },
    setVisible(v) {
      visible = v
      for (const map of Object.values(overlays)) for (const overlay of map.values()) overlay.visible = v
    },
    dispose() {
      for (const map of Object.values(overlays)) {
        for (const overlay of map.values()) overlay.removeFromParent()
        map.clear()
      }
      for (const m of Object.values(materials)) m.dispose()
    },
  }
}
