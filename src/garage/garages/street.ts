import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { disposeTree, type GarageDef, type Room } from './kit'
import { OUTDOOR_SKY_LIGHT } from './sky'
import { outdoorMaterial } from './terrain'
import { createBuildings } from './street/buildings'
import { railingTexture } from './street/facade'
import { createInfrastructure, wireMaterial } from './street/infra'
import { createSignTexture } from './street/signs'
import { createLeafTexture, createPlants } from './street/plants'
import { createProps } from './street/props'
import { createFestive } from './street/festive'
import { foliage } from './foliage'
import { createInteriorLights } from './interior'
import { receiveFarShadow } from './far-shadow'
import { createPaving } from './street/streets'
import { createStreetTerrain } from './street/terrain'
import { createWoods } from './street/woods'
import { CAPTURE_LAYER, SKY_LAYER, createStreetGI } from './street/gi'
import { createStreetWorld } from './street/world'
import { MAIN, ROAD, SIDES, groundTexture } from './street/site'
import {
  dressedStone,
  kerbMaterial,
  pavementMaterial,
  plasterMaterial,
  roadMaterial,
  rubbleMaterial,
  stoneMaterial,
  tileRoofMaterial,
  woodMaterial,
  type RoadDetail,
} from './street/surfaces'

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

  const ground = groundTexture()
  const road = roadMaterial(roadDetail())
  const paving = createPaving({ road: road.material, pavement: pavementMaterial(), kerb: kerbMaterial() })
  group.add(...paving.road, ...paving.pavement, ...paving.kerb)

  const railings = railingTexture()
  const signAtlas = createSignTexture()
  const signs = outdoorMaterial(new THREE.MeshStandardMaterial({ map: signAtlas, roughness: 0.5, metalness: 0.1 }))
  // (the glass keeps the street's reflection at full strength — a window is a mirror of the street, not
  // lit ground — but takes the town-wide shadows like everything else)
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0 })
  receiveFarShadow(glass)
  const iron = { color: new THREE.Color('#1d1c1b'), roughness: 0.5, metalness: 0.45 }
  const rubble = rubbleMaterial(ground)
  const buildings = createBuildings({
    wall: plasterMaterial(ground),
    stone: stoneMaterial(ground),
    wood: woodMaterial(ground),
    rubble: rubble.material,
    roof: tileRoofMaterial(),
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

  // life on the houses and the pavements: pots and climbers, shop fronts' wares, furniture, bikes, parked cars
  const leaves = foliage(
    outdoorMaterial(new THREE.MeshStandardMaterial({ map: createLeafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 })),
    { crownNormals: true, matte: true, coverage: true },
  )
  group.add(createPlants(buildings, { leaves, pot: outdoorMaterial(new THREE.MeshStandardMaterial({ roughness: 0.85 })) }))
  const props = outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }))
  group.add(
    createProps(buildings, {
      props,
      paint: outdoorMaterial(new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.1 })),
      glass: outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d1012'), roughness: 0.08 })),
      rubber: outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#161616'), roughness: 0.9 })),
    }),
  )

  // the festive layer, off until asked for (Menu › Garage › Scene)
  const bulbs = outdoorMaterial(new THREE.MeshStandardMaterial({ color: new THREE.Color('#fff4dc'), emissive: new THREE.Color('#ffe2b0'), emissiveIntensity: 2.2, roughness: 0.3 }))
  bulbs.userData.glow = true
  const festive = createFestive(buildings, { props, bulbs, wire: outdoorMaterial(wireMaterial()) })
  festive.visible = false
  group.add(festive)

  // the street's own lights: the lamps off by day (the lanterns' glass pale), switched on for dusk and night
  const interior = createInteriorLights([
    { id: 'street-lamps', name: 'Street lamps', hint: 'The iron lanterns on the posts and the walls', kelvin: 2700, members: [{ emissive: lampGlass }] },
    { id: 'festive-lights', name: 'Festive lights', hint: 'The strings of bulbs across the street (with Scene › Festive decorations on)', kelvin: 3200, members: [{ emissive: bulbs }] },
  ])
  interior.set({ master: 1, groups: { 'street-lamps': { on: false, intensity: 1, kelvin: 2700 }, 'festive-lights': { on: true, intensity: 1, kelvin: 3200 } } })
  for (const m of new Set(buildings.church.children.map((c) => (c as THREE.Mesh).material as THREE.MeshStandardMaterial))) {
    outdoorMaterial(m)
    if (m.name === 'church stone') dressedStone(m, ground)
  }

  // what's lit by the open sky out past the street: the ground and the hills (only the streets' own houses are
  // built — the blocks behind them were never seen from the street and only cost draw time)
  const outdoor = new THREE.Group()
  outdoor.name = 'street-outdoor'
  outdoor.add(createStreetTerrain())
  // the trees: garden, plaza, back yards, and the woods on the hills (grown asynchronously)
  const woods = createWoods(buildings.lots)
  outdoor.add(woods.group)
  group.add(outdoor)

  // The street's own surfaces take the sky from an environment captured down in the street (walls and all),
  // so its canyon already dims it: the landscape's OUTDOOR_SKY_LIGHT (calibrated for open ground under a
  // map captured in the open) on top dimmed it twice, and the shade — half the frame — went near black.
  // (That is the older estimate. With the light probes on — Settings › Graphics › Street lighting — the
  // diffuse sky and bounce come from gi.ts instead: measured sky visibility and coloured bounce.)
  const gi = createStreetGI({ footprints: buildings.footprints, ground, showSunDisc: (on) => world.sky.showSunDisc(on) })
  const patched = new Set<THREE.Material>()
  group.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || isUnder(mesh, outdoor)) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = m as THREE.MeshStandardMaterial
      if (!standard.isMeshStandardMaterial || patched.has(standard)) continue
      patched.add(standard)
      if (standard.envMapIntensity === OUTDOOR_SKY_LIGHT) standard.envMapIntensity = STREET_SKY_LIGHT
      gi.patch(standard)
    }
  })
  // What the probes see: the houses, the paving, the church, the ground and the woods (not the car, the
  // props, the plants or the wires — small, and a lot of draw calls six times per probe), and the lights.
  const captured = [...paving.road, ...paving.pavement, ...paving.kerb, ...buildings.meshes, buildings.church, outdoor]
  for (const root of captured) root.traverse((o) => o.layers.enable(CAPTURE_LAYER))
  group.traverse((o) => {
    if ((o as THREE.Light).isLight) o.layers.enable(CAPTURE_LAYER)
  })
  world.sky.mesh.layers.enable(SKY_LAYER)
  world.cumulus.traverse((o) => o.layers.enable(SKY_LAYER))

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
    ready: Promise.all([road.ready, rubble.ready, woods.ready]).then(() => {
      world.shadowsChanged() // (the trees arrived: they cast into both shadow maps)
      woods.group.traverse((o) => o.layers.enable(CAPTURE_LAYER)) // (and the probes see them)
    }),
    gi: {
      set: (on) => {
        gi.set(on)
        world.setWallBounce(!on)
      },
      relight: (renderer, scene, redraw) => gi.relight(renderer, scene, redraw),
    },
    dispose: () => {
      gi.dispose()
      disposeTree(group)
      ground.texture.dispose()
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
    options: [
      {
        id: 'festive',
        name: 'Festive decorations',
        hint: 'Strings of lights across the street, giant candy canes and gifts by the shops, wreaths on doors.',
        default: false,
        get: () => festive.visible,
        set: (on) => {
          festive.visible = on
        },
      },
    ],
  }
}

/**
 * Where the setts fan round the junctions, where cars have left rubber (swinging into the side
 * street behind the car, a doughnut in front of it, braking lines up the street) and where the
 * road has been patched.
 */
function roadDetail(): RoadDetail {
  const w = (s: number, d: number) => {
    const p = MAIN.at(s, d)
    return new THREE.Vector2(p.x, p.y)
  }
  const angle = (c: THREE.Vector2, p: THREE.Vector2) => Math.atan2(p.y - c.y, p.x - c.x)
  /** an arc of a tyre pair round centre c, inner tyre at radius r, from toward a to toward b (counter-clockwise) */
  const arc = (c: THREE.Vector2, r: number, a: THREE.Vector2, b: THREE.Vector2, strength: number): [THREE.Vector4, THREE.Vector4] => {
    let a0 = angle(c, a)
    let a1 = angle(c, b)
    // (the shader sweeps counter-clockwise from the first angle: order them so the short way round is taken)
    if (((a1 - a0 + Math.PI * 4) % (Math.PI * 2)) > Math.PI) [a0, a1] = [a1, a0]
    return [new THREE.Vector4(c.x, c.y, r, strength), new THREE.Vector4(a0, a1, 0, 0)]
  }
  // Courses that bow round toward a junction: rings about a point far down the street and a little to
  // the junction's side, so across the road they run as gentle arcs, and a border course where the fan
  // gives way to the straight courses (just ahead of the car at the showcase junction). Centred on the
  // junction itself the rings ran along the street beside the car, radiating like shards.
  const fans = [SIDES[0], SIDES[3]].map((j) => {
    const c = w(j.at - 36, j.side * 6)
    return new THREE.Vector3(c.x, c.y, 42)
  })
  // (the side street behind-left of the car leaves the main street at s = −3, its mouth past d = 9.4)
  const turnIn = w(-12, 11)
  const older = w(-7, 12)
  const brake = w(40, -300)
  const brake2 = w(206, 300)
  const donut = w(13, 0.4)
  const marks: [THREE.Vector4, THREE.Vector4][] = [
    arc(turnIn, 9.0, w(-12, 2), w(-3, 11), 0.85),
    arc(older, 7.5, w(-7, 4.5), w(0.5, 12), 0.4),
    arc(brake, 298.2, w(30, -1.8), w(52, -1.8), 0.6),
    arc(brake2, 298.2, w(196, 1.8), w(216, 1.8), 0.35),
    [new THREE.Vector4(donut.x, donut.y, 1.4, 0.5), new THREE.Vector4(0, 6.28, 0, 0)],
  ]
  const box = (s: number, d: number, halfAlong: number, halfAcross: number) => {
    const c = w(s, d)
    return new THREE.Vector4(c.x, c.y, halfAcross, halfAlong)
  }
  return { fans, marks, patches: [box(-31, -1.6, 0.4, 1.6), box(36, 1.5, 0.7, 0.5), box(96, 0.6, 0.55, 0.55)] }
}

/** how strongly the street-level env map lights the street's own surfaces (see createStreet) */
const STREET_SKY_LIGHT = 0.75

function isUnder(o: THREE.Object3D, root: THREE.Object3D): boolean {
  for (let p = o.parent; p; p = p.parent) if (p === root) return true
  return false
}

export const calleColonial: GarageDef = {
  id: 'calle-colonial',
  name: 'Calle Colonial',
  tag: 'Out in the street of a colourful hillside colonial town, the road leading up the valley to the church',
  palette: ['#c65a4a', '#e2b441', '#6d9fc4', '#e8e3d6'],
  look: 'afternoon',
  exposureKey: -2.9,
  create: createStreet,
}
