import * as THREE from 'three'
import { assembleRoom, concreteTexture, createFloor, floorTileTexture, glowMaterial, type GarageDef, type Room } from './kit'

const ROOM = { w: 16, h: 7, d: 20 }
const WHITE = 0xffffff
/** the light wall stops short of the side walls and ceiling by this much — a shadow gap */
const GAP = 0.12

/**
 * Light wall: the whole back wall is one plane of white light, and the rest
 * of the room is quiet, off-white plaster. A single huge soft source — the
 * car wears the wall as long gradient reflections down its flanks and roof,
 * the room bounces the rest back as fill.
 */
function createLightWall(): Room {
  const { w, h, d } = ROOM
  const group = new THREE.Group()
  group.name = 'light-wall'

  // ─── shell: walls and ceiling seen from inside, light grey plaster ───────
  const plaster = new THREE.MeshStandardMaterial({
    color: 0xd6d8db,
    map: concreteTexture([4, 2], 0.1), // barely-there plaster, not concrete
    roughness: 0.92,
    metalness: 0,
    side: THREE.BackSide,
  })
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.02, d), plaster)
  shell.position.y = h / 2 - 0.02
  group.add(shell)

  // ─── the light wall ──────────────────────────────────────────────────────
  const wallZ = -d / 2
  const panelW = w - GAP * 2
  const panelH = h - GAP
  // visible emitter: pure white, too big for bloom to flatter
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(panelW, panelH), glowMaterial(WHITE, 2.4, false))
  panel.position.set(0, panelH / 2, wallZ + 0.02)
  group.add(panel)
  // the light itself: same footprint, facing into the room
  const light = new THREE.RectAreaLight(WHITE, 4.2, panelW, panelH)
  light.position.set(0, panelH / 2, wallZ + 0.04)
  light.lookAt(0, panelH / 2, 0)
  group.add(light)
  // a thin dark reveal where the wall meets floor, so it reads as a lit plane, not a hole
  const reveal = new THREE.Mesh(
    new THREE.BoxGeometry(panelW, 0.04, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x8e9197, roughness: 0.7 }),
  )
  reveal.position.set(0, 0.02, wallZ + 0.04)
  group.add(reveal)

  // ─── floor: satin light grey, a soft reflection of the wall underneath ───
  const floor = createFloor(group, {
    geometry: new THREE.PlaneGeometry(w, d),
    tint: 0x8a8c90,
    blur: 0.014,
    lod: 1.8,
    surface: new THREE.MeshStandardMaterial({
      color: 0xc9ccd0,
      map: floorTileTexture([w / 4, d / 4], '#a9adb2'),
      roughness: 0.42,
      metalness: 0,
      opacity: 0.8,
    }),
  })

  // the light wall is all the direct light there is; this only lifts the shadows a touch
  group.add(new THREE.HemisphereLight(0xffffff, 0xb9bcc1, 0.35))

  const m = 0.6
  return assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + m, 0.3, -d / 2 + m],
      [w / 2 - m, h - 0.45, d / 2 - m],
    ],
    background: 0xd6d8db,
    environmentIntensity: 1,
  })
}

export const lightWall: GarageDef = {
  id: 'light-wall',
  name: 'Light Wall',
  tag: 'One wall of pure white light · soft grey plaster room',
  palette: ['#ffffff', '#eceef0', '#d6d8db', '#b9bcc1'],
  look: 'natural',
  create: createLightWall,
}
