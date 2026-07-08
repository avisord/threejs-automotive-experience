import * as THREE from 'three'
import type { Ball } from './balls'

export function setupDragging(
  dom: HTMLElement,
  camera: THREE.PerspectiveCamera,
  balls: Ball[],
): void {
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  const dragPlane = new THREE.Plane()
  const planeHit = new THREE.Vector3()
  const grabOffset = new THREE.Vector3()
  const camDir = new THREE.Vector3()
  let active: Ball | null = null

  function updatePointer(e: PointerEvent): void {
    pointer.x = (e.clientX / dom.clientWidth) * 2 - 1
    pointer.y = -(e.clientY / dom.clientHeight) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
  }

  dom.addEventListener('pointerdown', (e) => {
    updatePointer(e)
    const meshes = balls.map((b) => b.mesh)
    const hit = raycaster.intersectObjects(meshes, false)[0]
    if (!hit) return

    active = balls.find((b) => b.mesh === hit.object)!
    active.dragged = true
    active.dragTarget.copy(active.mesh.position)
    grabOffset.copy(active.mesh.position).sub(hit.point)

    // drag on a camera-facing plane through the grab point
    camera.getWorldDirection(camDir)
    dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)

    dom.setPointerCapture(e.pointerId)
    dom.style.cursor = 'grabbing'
  })

  dom.addEventListener('pointermove', (e) => {
    if (!active) {
      updatePointer(e)
      const hover = raycaster.intersectObjects(balls.map((b) => b.mesh), false).length > 0
      dom.style.cursor = hover ? 'grab' : 'default'
      return
    }
    updatePointer(e)
    if (raycaster.ray.intersectPlane(dragPlane, planeHit)) {
      active.dragTarget.copy(planeHit).add(grabOffset)
      // never drag a ball into the floor
      active.dragTarget.y = Math.max(active.dragTarget.y, active.radius)
    }
  })

  const release = (e: PointerEvent): void => {
    if (!active) return
    active.dragged = false
    active = null
    dom.releasePointerCapture(e.pointerId)
    dom.style.cursor = 'default'
  }
  dom.addEventListener('pointerup', release)
  dom.addEventListener('pointercancel', release)
}
