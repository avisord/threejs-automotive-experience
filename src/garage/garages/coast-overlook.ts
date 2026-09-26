import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { SURFACES, box, boxUV, disposeTree, pbrMaps, type GarageDef, type Room } from './kit'
import { createGlassMaterial, glassPane } from './glass'
import { GROUND } from './coast/site'
import { createCoastWorld } from './coast/world'

/** the terrace the car stands on (x × z), its front edge toward the cove (−z) */
const DECK = { w: 16, front: -7, back: 5.5 }
/** the glass balustrade along the front and sides */
const RAIL = { h: 1.05, bay: 2 }

/**
 * The Coast House's site with no house: the car stands out in the open on a
 * pale stone viewing terrace on the clifftop lawn, a frameless glass
 * balustrade along its edge, the palms and the garden round it, and the cove,
 * the sea and the mountains beyond — the same world (coast/world.ts), sun and
 * air as the Coast House.
 */
function createCoastOverlook(): Room {
  const group = new THREE.Group()
  group.name = 'coast-overlook'
  const world = createCoastWorld(group, { planter: false })

  // ─── the terrace: honed limestone slabs on a plinth, steps down to the lawn behind ─
  const stoneMaps = pbrMaps(SURFACES.concreteFloor)
  // (the photographed concrete is dark, ~0.085: lifted to a pale sun-bleached stone)
  const stone = new THREE.MeshStandardMaterial({ ...stoneMaps.maps, color: new THREE.Color().setRGB(2.7, 2.55, 2.3), roughness: 0.75 })
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.4, metalness: 0.8 })
  const d = DECK.back - DECK.front
  const cz = (DECK.back + DECK.front) / 2
  const slab = (size: [number, number, number], at: [number, number, number]) => {
    const mesh = box(group, size, stone, at)
    boxUV(mesh.geometry, SURFACES.concreteFloor.tile)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
  // (its top a hair under y = 0, where the car's wheels and contact shadow sit)
  const depth = -GROUND + 0.6
  slab([DECK.w, depth, d], [0, -0.005 - depth / 2, cz])
  // three steps down to the lawn behind, each a quarter of the rise
  for (let i = 0; i < 3; i++) {
    const top = (GROUND * (i + 1)) / 4
    const h = top - GROUND + 0.05
    slab([6, h, 0.4], [0, top - h / 2, DECK.back + 0.2 + i * 0.4])
  }
  // slab joints, faint dark lines on the top
  const joints = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
  for (let x = -DECK.w / 2 + 2; x < DECK.w / 2 - 0.1; x += 2) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.01, d), joints)
    line.rotation.x = -Math.PI / 2
    line.position.set(x, 0.002, cz)
    group.add(line)
  }
  for (let z = DECK.front + 2; z < DECK.back - 0.1; z += 2) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(DECK.w, 0.01), joints)
    line.rotation.x = -Math.PI / 2
    line.position.set(0, 0.002, z)
    group.add(line)
  }

  // ─── the balustrade: frameless glass panes in a steel shoe, front and sides ─
  const glass = createGlassMaterial({ dirt: 0.3, absorption: 0.05 })
  let seed = 31
  const run = (a: THREE.Vector2, b: THREE.Vector2) => {
    const length = a.distanceTo(b)
    const bays = Math.max(1, Math.round(length / RAIL.bay))
    const turn = Math.atan2(-(b.y - a.y), b.x - a.x)
    for (let i = 0; i < bays; i++) {
      const holder = new THREE.Object3D()
      const t = (i + 0.5) / bays
      holder.position.set(a.x + (b.x - a.x) * t, RAIL.h / 2 + 0.06, a.y + (b.y - a.y) * t)
      holder.rotation.y = turn
      holder.add(glassPane(glass, length / bays - 0.02, RAIL.h, seed++))
      group.add(holder)
    }
    const shoe = box(group, [length, 0.08, 0.1], steel, [(a.x + b.x) / 2, 0.04, (a.y + b.y) / 2])
    shoe.rotation.y = turn
    shoe.castShadow = true
  }
  const e = 0.12
  run(new THREE.Vector2(-DECK.w / 2 + e, DECK.front + e), new THREE.Vector2(DECK.w / 2 - e, DECK.front + e))
  run(new THREE.Vector2(-DECK.w / 2 + e, DECK.front + e), new THREE.Vector2(-DECK.w / 2 + e, DECK.back - e))
  run(new THREE.Vector2(DECK.w / 2 - e, DECK.front + e), new THREE.Vector2(DECK.w / 2 - e, DECK.back - e))

  // no floor mirror out here (a honed stone terrace): a stand-in the app's bookkeeping can hold, never drawn
  const reflector = new Reflector(new THREE.PlaneGeometry(0.01, 0.01), { textureWidth: 1, textureHeight: 1 })
  reflector.visible = false
  group.add(reflector)

  return {
    group,
    reflector,
    floorLayers: [],
    // out in the open: round the car, above the terrace — and out over the drop in front
    bounds: new THREE.Box3(new THREE.Vector3(-24, 0.4, -40), new THREE.Vector3(24, 16, 24)),
    background: new THREE.Color(0x9fb8d6), // only until the sky is in
    environmentIntensity: 1,
    resize: () => {},
    setReflectionScale: () => {},
    update: world.update,
    ready: Promise.all([world.ready, stoneMaps.ready]).then(() => {}),
    dispose: () => {
      disposeTree(group)
      for (const t of world.textures) t.dispose()
    },
    ...world.hooks,
    depthOfField: { bokehScale: 0.7 },
  }
}

export const coastOverlook: GarageDef = {
  id: 'coast-overlook',
  name: 'Coast Overlook',
  tag: 'Out in the open on a clifftop terrace above the tropical cove, no walls between the car and the sunset',
  palette: ['#1d4f7a', '#3fb2b0', '#f2c38b', '#e8dcc8'],
  look: 'golden',
  create: createCoastOverlook,
}
