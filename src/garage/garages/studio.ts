import * as THREE from 'three'
import { createInteriorLights, fixtureMembers, softboxMembers } from './interior'
import { assembleRoom, createFloor, softbox, type GarageDef, type Room } from './kit'

/** flat floor radius — past this the floor sweeps up into the wall */
const FLOOR_R = 8
/** radius of the floor-to-wall cove */
const COVE_R = 2.6
/** radius of the wall-to-ceiling cove */
const TOP_R = 2
const WALL_R = FLOOR_R + COVE_R
const H = 9

/** the cyc wall's cross-section, from just under the floor edge up and over to the ceiling centre */
function cycProfile(): THREE.Vector2[] {
  const pts = [new THREE.Vector2(FLOOR_R - 0.4, -0.004), new THREE.Vector2(FLOOR_R, 0)]
  const steps = 16
  for (let i = 1; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2)
    pts.push(new THREE.Vector2(FLOOR_R + COVE_R * Math.sin(t), COVE_R - COVE_R * Math.cos(t)))
  }
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * (Math.PI / 2)
    pts.push(new THREE.Vector2(WALL_R - TOP_R + TOP_R * Math.cos(t), H - TOP_R + TOP_R * Math.sin(t)))
  }
  pts.push(new THREE.Vector2(0.01, H))
  return pts
}

/**
 * Photo studio: a seamless round cyclorama — no corners, no horizon — lit by
 * one big overhead softbox and two long strip boxes that draw clean lines
 * down the car's flanks.
 */
function createStudio(): Room {
  const group = new THREE.Group()
  group.name = 'studio'

  const cyc = new THREE.Mesh(
    new THREE.LatheGeometry(cycProfile(), 128),
    new THREE.MeshStandardMaterial({ color: 0x7d8188, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }),
  )
  group.add(cyc)

  // satin floor: mostly the surface, a soft hint of reflection underneath
  const floor = createFloor(group, {
    geometry: new THREE.CircleGeometry(FLOOR_R, 128),
    tint: 0x5a5a5a,
    blur: 0.016,
    lod: 2,
    surface: new THREE.MeshStandardMaterial({ color: 0x73777e, roughness: 0.5, metalness: 0, opacity: 0.8 }),
  })

  // flush turntable seam around the car
  const seam = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.44, 128),
    new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, transparent: true, opacity: 0.8, depthWrite: false }),
  )
  seam.rotation.x = -Math.PI / 2
  seam.position.y = 0.004
  group.add(seam)
  floor.floorLayers.push(seam)

  // ─── lights ──────────────────────────────────────────────────────────────
  const WHITE = 0xfffaf2
  const overhead = softbox(group, { size: [6, 10], position: [0, 7.4, 0], target: [0, 0, 0], color: WHITE, intensity: 5, glow: 1.8 })
  const strips = [-1, 1].map((side) =>
    softbox(group, {
      size: [0.8, 10],
      position: [side * 4.4, 6.2, 0],
      target: [0, 0.4, 0],
      color: WHITE,
      intensity: 14,
      glow: 2.4,
    }),
  )
  // cool rim from behind, so the roofline separates from the cyc
  const rim = softbox(group, { size: [8, 2.4], position: [0, 3.2, -9.4], target: [0, 1, 0], color: 0xdfe8ff, intensity: 3, glow: 1.4 })

  const ambient = new THREE.HemisphereLight(0xffffff, 0x8a8e95, 0.35)
  group.add(ambient)

  // the fittings the user can switch, dim and warm (Menu › Garage › Interior lights)
  const interior = createInteriorLights([
    { id: 'overhead', name: 'Overhead softbox', hint: 'The big diffuser straight above the car: its key light', kelvin: 6200, members: softboxMembers(overhead) },
    { id: 'strips', name: 'Side strips', hint: 'The two tall strip boxes that draw the long highlights down the flanks', kelvin: 6200, members: strips.flatMap(softboxMembers) },
    { id: 'rim', name: 'Rim light', hint: 'The cool box behind, separating the roofline from the cyc', kelvin: 7800, members: softboxMembers(rim) },
    { id: 'ambient', name: 'Ambient fill', hint: 'Soft light from everywhere: lifts the shadows', kelvin: 6500, members: fixtureMembers(ambient) },
  ])

  const r = 6.2 // box corners stay clear of the cove
  const room = assembleRoom(group, floor, {
    bounds: [
      [-r, 0.3, -r],
      [r, H - 0.6, r],
    ],
    background: 0x9ea2a8,
    environmentIntensity: 1,
  })
  return { ...room, interior }
}

export const studio: GarageDef = {
  id: 'studio',
  name: 'White Studio',
  tag: 'Seamless cyclorama, big softboxes · clean and neutral',
  palette: ['#fffaf2', '#c9ccd1', '#9a9ea5', '#dfe8ff'],
  look: 'natural',
  create: createStudio,
}
