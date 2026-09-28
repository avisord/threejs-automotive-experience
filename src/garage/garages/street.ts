import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { disposeTree, type GarageDef, type Room } from './kit'
import { outdoorMaterial } from './terrain'
import { createBuildings } from './street/buildings'
import { railingTexture } from './street/facade'
import { createInfrastructure, wireMaterial } from './street/infra'
import { createSignTexture } from './street/signs'
import { createInteriorLights } from './interior'
import { receiveFarShadow } from './far-shadow'
import { createPaving } from './street/streets'
import { createStreetTerrain } from './street/terrain'
import { createTown } from './street/town'
import { createStreetWorld } from './street/world'
import { ROAD } from './street/site'

/**
 * Calle Colonial: no garage at all — the car stands in the street of a
 * colourful colonial hillside town, the road leading away up the valley
 * between painted houses toward the church and the forested hill that closes
 * it, the town going on up the slopes and mountains far off. (Phase 1: the
 * layout, the houses as massing, the ground and the hills, the sky and the
 * sun; facades, street furniture, materials and the rest come on top.)
 */
function createStreet(): Room {
  const group = new THREE.Group()
  group.name = 'calle-colonial'
  const world = createStreetWorld(group)

  const paving = createPaving({
    road: outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a524b'), roughness: 0.82 })),
    pavement: outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#948b7e'), roughness: 0.88 })),
    kerb: outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#a49b8c'), roughness: 0.85 })),
  })
  group.add(...paving.road, ...paving.pavement, ...paving.kerb)

  const railings = railingTexture()
  const signAtlas = createSignTexture()
  const signs = outdoorMaterial(new THREE.MeshStandardMaterial({ map: signAtlas, roughness: 0.5, metalness: 0.1 }))
  // (the glass keeps the street's reflection at full strength — a window is a mirror of the street, not
  // lit ground — but takes the town-wide shadows like everything else)
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0 })
  receiveFarShadow(glass)
  const iron = { color: new THREE.Color('#1d1c1b'), roughness: 0.5, metalness: 0.45 }
  const buildings = createBuildings({
    wall: outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 })),
    glass,
    iron: outdoorMaterial(new THREE.MeshStandardMaterial(iron)),
    lace: outdoorMaterial(new THREE.MeshStandardMaterial({ ...iron, map: railings, alphaTest: 0.5, side: THREE.DoubleSide })),
    tank: outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#161616'), roughness: 0.55 })),
    signs,
  })
  group.add(...buildings.meshes, buildings.church)

  // lamps, poles and wires, signs, drains, bollards
  const lampGlass = outdoorMaterial(
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#e6dcc6'), roughness: 0.25, emissive: new THREE.Color('#ffb46a'), emissiveIntensity: 4 }),
  )
  lampGlass.userData.glow = true
  const infra = createInfrastructure(buildings, {
    iron: outdoorMaterial(new THREE.MeshStandardMaterial({ ...iron })),
    lampGlass,
    pole: outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })),
    wire: outdoorMaterial(wireMaterial()),
    signs,
    decals: outdoorMaterial(
      new THREE.MeshStandardMaterial({ map: signAtlas, roughness: 0.6, metalness: 0.3, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    ),
  })
  group.add(infra.group)
  // the street's own lights: off by day (the lanterns' glass pale), switched on for dusk and night
  const interior = createInteriorLights([
    { id: 'street-lamps', name: 'Street lamps', hint: 'The iron lanterns on the posts and the walls', kelvin: 2700, members: [{ emissive: lampGlass }] },
  ])
  interior.set({ master: 1, groups: { 'street-lamps': { on: false, intensity: 1, kelvin: 2700 } } })
  for (const m of new Set(buildings.church.children.map((c) => (c as THREE.Mesh).material as THREE.MeshStandardMaterial))) outdoorMaterial(m)

  // what's lit by the open sky out past the street: the ground, the hills and the town up the slopes
  const outdoor = new THREE.Group()
  outdoor.name = 'street-outdoor'
  outdoor.add(createStreetTerrain(), createTown().group)
  group.add(outdoor)

  // no floor mirror in a street: a stand-in the app's bookkeeping can hold, never drawn
  const reflector = new Reflector(new THREE.PlaneGeometry(0.01, 0.01), { textureWidth: 1, textureHeight: 1 })
  reflector.visible = false
  group.add(reflector)

  const half = ROAD.width / 2 + ROAD.sidewalk - 0.4
  return {
    group,
    reflector,
    floorLayers: [],
    // the street between the house fronts, along the level stretch round the car
    bounds: new THREE.Box3(new THREE.Vector3(-half, 0.3, -40), new THREE.Vector3(half, 18, 40)),
    background: new THREE.Color(0x9fb8d6), // only until the sky is drawn
    environmentIntensity: 1,
    resize: () => {},
    setReflectionScale: () => {},
    dispose: () => {
      disposeTree(group)
      world.dispose()
    },
    ...world.hooks,
    outdoor: {
      root: outdoor,
      probe: new THREE.Vector3(0, 60, 120), // over the rooftops: open sky, the town and hills below
      beforeCapture: () => world.sky.showSunDisc(false),
      afterCapture: () => world.sky.showSunDisc(true),
    },
    // low behind the car, a little to its left, looking up the street
    view: [1.1, 1.25, -7.4],
    depthOfField: { bokehScale: 3 },
    interior,
  }
}

export const calleColonial: GarageDef = {
  id: 'calle-colonial',
  name: 'Calle Colonial',
  tag: 'Out in the street of a colourful hillside colonial town, the road leading up the valley to the church',
  palette: ['#c65a4a', '#e2b441', '#6d9fc4', '#e8e3d6'],
  look: 'daylight',
  exposureKey: -3.8,
  create: createStreet,
}
