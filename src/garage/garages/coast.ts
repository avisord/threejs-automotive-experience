import * as THREE from 'three'
import { SURFACES, assembleRoom, box, boxUV, createFloor, glowMaterial, pbrMaps, type GarageDef, type Room } from './kit'
import { createInteriorLights } from './interior'
import { createGlassMaterial, glassPane } from './glass'
import { GROUND } from './coast/site'
import { COAST_SURFACES } from './coast/terrain'
import { COAST_SUN, createCoastWorld } from './coast/world'

/** the showroom inside (x × z) and its ceiling */
const ROOM = { w: 20, d: 14, h: 5.4 }
/** the glass wall runs across the front (−z), floor to ceiling, in bays between mullions */
const BAYS = 5
/** how far the roof and its beams reach out past the glass */
const OVERHANG = 3.2
/** beams under the ceiling, running out toward the view, this far apart */
const BEAM_PITCH = 2

/**
 * A glass-fronted showroom on a hillside above the sea. A rough stone wall
 * on the left, dark timber panelling on the right, a concrete back wall with
 * the door; the whole front is floor-to-ceiling glass between slim dark
 * mullions, under a dark ceiling crossed by exposed timber beams that run
 * out through the glass and carry the roof past it. Polished stone floor.
 * Outside, a stone planter along the sill, then the land falls away to the
 * cove (coast/site.ts lays it out).
 */
function createCoastGarage(): Room {
  const { w, d, h } = ROOM
  const group = new THREE.Group()
  group.name = 'coast-garage'
  const front = -d / 2

  let interior: ReturnType<typeof createInteriorLights> | null = null
  const world = createCoastWorld(group, {
    // the showroom's plinth on the land: the ground darkens along its foot
    footprints: [[-w / 2 - 0.6, -d / 2 - 0.3, w / 2 + 0.6, d / 2 + 0.3]],
    dust: new THREE.Box3(new THREE.Vector3(-w / 2, 0, front), new THREE.Vector3(w / 2, h, d / 2)),
    onSun({ elevation, atmosphere }) {
      interior?.refresh()
      // a low sun floods the floor sideways: keep the dust faint then, or it veils the car
      atmosphere.dust!.density = 0.003 + 0.03 * THREE.MathUtils.smoothstep(elevation, 15, 45)
    },
  })

  // ─── materials (photographed, uvs in metres: one set of maps per surface) ─
  const floorMaps = pbrMaps(SURFACES.concreteFloor)
  const panelMaps = pbrMaps(SURFACES.concretePanels)
  const woodMaps = pbrMaps(COAST_SURFACES.darkWood)
  const stoneMaps = pbrMaps(COAST_SURFACES.stoneWall)
  const concrete = new THREE.MeshStandardMaterial({ ...panelMaps.maps, color: 0xd6d2cc, roughness: 1 })
  const ceiling = new THREE.MeshStandardMaterial({ ...panelMaps.maps, color: 0x4a4744, roughness: 1 })
  // the timber: stained near black, its grain still reading in the light
  const timber = new THREE.MeshStandardMaterial({ ...woodMaps.maps, color: 0x6a5c52, roughness: 1, normalScale: new THREE.Vector2(0.6, 0.6) })
  const panelling = timber.clone()
  panelling.color.setHex(0x8a7466)
  const stone = new THREE.MeshStandardMaterial({ ...stoneMaps.maps, color: 0xa8a39c, roughness: 1 })
  const plinth = new THREE.MeshStandardMaterial({ ...floorMaps.maps, color: 0xb4ada2, roughness: 1 })
  const darkSteel = new THREE.MeshStandardMaterial({ color: 0x121315, roughness: 0.45, metalness: 0.7 })
  const tiles = new Map<THREE.Material, number>([
    [concrete, SURFACES.concretePanels.tile],
    [ceiling, SURFACES.concretePanels.tile],
    [timber, COAST_SURFACES.darkWood.tile],
    [panelling, COAST_SURFACES.darkWood.tile],
    [stone, COAST_SURFACES.stoneWall.tile],
    [plinth, SURFACES.concreteFloor.tile],
  ])
  const solid = (size: [number, number, number], material: THREE.MeshStandardMaterial, at: [number, number, number]) => {
    const mesh = box(group, size, material, at)
    const tile = tiles.get(material)
    if (tile) boxUV(mesh.geometry, tile)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }

  // ─── the floor: polished stone over a soft mirror ────────────────────────
  // (the slab goes down to the terrace; its edge shows along the planter. Its top stays a centimetre
  // under the floor: level with the mirror it z-fought in the reflection — fine stripes crawling over
  // the floor as the camera moved)
  solid([w + 1.2, -GROUND, d + 0.6], plinth, [0, GROUND / 2 - 0.01, 0])
  const deck = new THREE.PlaneGeometry(w, d)
  const deckUV = deck.attributes.uv
  for (let k = 0; k < deckUV.count; k++) deckUV.setXY(k, (deckUV.getX(k) * w) / 4.5, (deckUV.getY(k) * d) / 4.5)
  // honed stone, polished: large pale-grey slabs with the photo's broad mottling (a larger scale
  // than the concrete's own, so it reads as stone), a soft broad sheen rather than a mirror
  const floorSurface = new THREE.MeshStandardMaterial({
    ...floorMaps.maps,
    // (the photographed concrete is dark, ~0.085: lifted to a pale honed limestone)
    color: new THREE.Color().setRGB(2.45, 2.25, 2.35), // (a touch toward rose: the photo is faintly green, and the garden and the gold light pushed it olive)
    roughness: 0.5, // × the map: polished, dull patches where it's worn
    normalScale: new THREE.Vector2(0.35, 0.35),
    opacity: 0.5, // the mirror below shows through: the car, the bright glass, the view
    envMapIntensity: 0.06,
  })
  floorSurface.name = 'coast-floor'
  // Imperfect polish: where the stone is worn (the roughness map's rough patches) the surface is
  // more opaque over the mirror — the reflection breaks up into broad soft patches instead of lying
  // evenly over the floor — and a slow mottle at the scale of the slabs, so it reads as stone.
  floorSurface.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        #ifdef USE_MAP
          float mottle = dot( texture2D( map, vMapUv * 0.17 + 0.31 ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
          diffuseColor.rgb *= 0.8 + 3.2 * mottle;
        #endif`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        diffuseColor.a = mix( diffuseColor.a * 0.8, min( 1.0, diffuseColor.a * 1.6 ), smoothstep( 0.35, 0.75, roughnessFactor ) );`,
      )
  }
  floorSurface.customProgramCacheKey = () => 'coast-floor'
  const floor = createFloor(group, { geometry: deck, tint: 0xbdbdbd, fresnel: 0.05, blur: 0.011, lod: 1.6, surface: floorSurface })
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === floorSurface) o.receiveShadow = true
  })
  // slab joints: faint dark lines every 1.5 m (the floor is laid in large slabs)
  const joints = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
  const jointGeometries: THREE.BufferGeometry[] = []
  for (let x = -w / 2 + 1.5; x < w / 2 - 0.1; x += 1.5) jointGeometries.push(new THREE.PlaneGeometry(0.008, d).rotateX(-Math.PI / 2).translate(x, 0.004, 0))
  for (let z = -d / 2 + 3; z < d / 2 - 0.1; z += 3) jointGeometries.push(new THREE.PlaneGeometry(w, 0.008).rotateX(-Math.PI / 2).translate(0, 0.004, z))
  const jointMesh = new THREE.Mesh(mergeGeometries(jointGeometries), joints)
  group.add(jointMesh)
  floor.floorLayers.push(jointMesh)

  // ─── walls ────────────────────────────────────────────────────────────────
  solid([0.7, h + 0.3, d + 0.6], stone, [-w / 2 - 0.35, h / 2 + 0.1, 0])
  // the stone wall turns the corner onto the front as a pier, framing the glass on the left
  solid([1.1, h + 0.3, 0.9], stone, [-w / 2 + 0.2, h / 2 + 0.1, front + 0.1])
  solid([0.3, h, d], panelling, [w / 2 + 0.15, h / 2, 0])
  // vertical battens over the panelling: a rhythm of shadow lines
  for (let z = -d / 2 + 0.4; z < d / 2 - 0.2; z += 0.6) solid([0.05, h - 0.1, 0.08], timber, [w / 2 - 0.02, h / 2, z])
  solid([w, h, 0.4], concrete, [0, h / 2, d / 2 + 0.2])
  // the door: a timber-slatted panel in the back wall
  solid([6.2, 3.6, 0.06], timber, [1.5, 1.8, d / 2 - 0.03])
  for (let y = 0.2; y < 3.6; y += 0.3) solid([6.2, 0.03, 0.04], darkSteel, [1.5, y, d / 2 - 0.07])

  // ─── the ceiling and the exposed beams, running out past the glass ───────
  solid([w + 1.4, 0.35, d + OVERHANG + 0.6], ceiling, [0, h + 0.175, (d / 2 + 0.3 + front - OVERHANG) / 2])
  const beamLength = d + OVERHANG + 0.4
  for (let x = -w / 2 + BEAM_PITCH / 2; x < w / 2; x += BEAM_PITCH) {
    solid([0.24, 0.46, beamLength], timber, [x, h - 0.23, (d / 2 + front - OVERHANG - 0.4) / 2 + 0.2])
  }
  // the header over the glass: a dark steel beam across the whole front
  solid([w + 0.6, 0.4, 0.35], darkSteel, [0, h - 0.2, front])

  // ─── the glass front ──────────────────────────────────────────────────────
  const glass = createGlassMaterial({ dirt: 0.5 })
  const left = -w / 2 + 0.75
  const right = w / 2
  const bay = (right - left) / BAYS
  for (let i = 0; i < BAYS; i++) {
    const holder = new THREE.Object3D()
    holder.position.set(left + (i + 0.5) * bay, (h - 0.4) / 2, front)
    holder.add(glassPane(glass, bay - 0.06, h - 0.42, 11 + i))
    group.add(holder)
  }
  // mullions: slim and deep, dark — the strong vertical rhythm across the view
  for (let i = 0; i <= BAYS; i++) solid([0.09, h - 0.4, 0.28], darkSteel, [left + i * bay, (h - 0.4) / 2, front])
  solid([right - left, 0.06, 0.3], darkSteel, [(left + right) / 2, 0.03, front])

  // ─── outside the glass: a stone planter along the sill ───────────────────
  // (its lip just under the floor: from a camera at car height anything higher hides the cove)
  const planterTop = -0.04
  solid([right - left + 0.3, planterTop - GROUND + 0.4, 0.25], plinth, [(left + right) / 2, (planterTop + GROUND - 0.4) / 2, front - 1.55])
  const soil = new THREE.MeshStandardMaterial({ color: 0x2c2218, roughness: 1 })
  solid([right - left + 0.3, 0.02, 1.2], soil, [(left + right) / 2, planterTop - 0.12, front - 0.85])

  // ─── light fittings: warm downlights between the beams, a wash on the stone ─
  const downGlow = glowMaterial(0xffc98a, 7)
  const discs: THREE.BufferGeometry[] = []
  for (let x = -w / 2 + BEAM_PITCH; x < w / 2 - 0.5; x += BEAM_PITCH)
    for (const z of [-4.2, -0.8, 2.6]) discs.push(new THREE.CircleGeometry(0.07, 20).rotateX(Math.PI / 2).translate(x, h - 0.004, z))
  const downlights = new THREE.Mesh(mergeGeometries(discs), downGlow)
  downlights.name = 'downlights'
  group.add(downlights)
  // their light on the room below: two broad warm panels (area lights stay off the landscape: far-shadow.ts)
  const ceilingLights = [-4.5, 4.5].map((x) => {
    const light = new THREE.RectAreaLight(0xffd2a0, 1.1, 8, d - 3)
    light.position.set(x, h - 0.05, 0)
    light.up.set(0, 0, -1)
    light.lookAt(x, 0, 0)
    group.add(light)
    return light
  })
  // a warm grazing wash up the stone wall from a slot at its foot
  const washGlow = glowMaterial(0xffc890, 3)
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(d - 1.5, 0.05), washGlow)
  slot.rotation.set(-Math.PI / 2, 0, Math.PI / 2)
  slot.position.set(-w / 2 + 0.08, 0.004, 0.4)
  group.add(slot)
  const wash = new THREE.RectAreaLight(0xffc488, 1.6, d - 1.5, 1)
  wash.position.set(-w / 2 + 0.35, 0.25, 0.4)
  wash.lookAt(-w / 2 - 0.3, 2.5, 0.4)
  group.add(wash)
  floor.floorLayers.push(slot)

  interior = createInteriorLights([
    {
      id: 'downlights',
      name: 'Downlights',
      hint: 'Warm recessed lights between the beams, and their glow on the room',
      kelvin: 2900,
      members: [{ glow: downGlow }, ...ceilingLights.map((light) => ({ light }))],
    },
    {
      id: 'wash',
      name: 'Wall wash',
      hint: 'The slot at the foot of the stone wall, grazing light up it',
      kelvin: 3000,
      members: [{ glow: washGlow }, { light: wash }],
    },
  ])

  const room = assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 0.8, 0.3, front + 0.7],
      [w / 2 - 0.6, h - 0.6, d / 2 - 0.6],
    ],
    background: 0x9fb8d6, // only until the sky is in
    environmentIntensity: 1,
    ready: Promise.all([world.ready, floorMaps.ready, panelMaps.ready, woodMaps.ready, stoneMaps.ready]).then(() => {
      floor.floorLayers.push(...world.farDetail)
    }),
  })
  return {
    ...room,
    ...world.hooks,
    interior,
    // shot like an automotive photograph: the car sharp, the coast behind it a touch soft
    depthOfField: { bokehScale: 0.7 },
    update(dt) {
      world.update(dt)
    },
    dispose() {
      room.dispose()
      world.dispose()
    },
  }
}

/** merge plain (non-indexed or indexed, same attributes) geometries into one */
function mergeGeometries(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const merged = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const arrays = flat.map((g) => g.attributes[name].array as Float32Array)
    const out = new Float32Array(arrays.reduce((n, a) => n + a.length, 0))
    let o = 0
    for (const a of arrays) {
      out.set(a, o)
      o += a.length
    }
    merged.setAttribute(name, new THREE.BufferAttribute(out, flat[0].attributes[name].itemSize))
  }
  for (const g of [...parts, ...flat]) g.dispose()
  return merged
}

export const coastGarage: GarageDef = {
  id: 'coast',
  name: 'Coast House',
  tag: 'A glass-fronted showroom above a tropical cove on a clear day',
  palette: ['#1d4f7a', '#3fb2b0', '#f2c38b', '#4e6a2a'],
  look: 'daylight',
  exposureKey: -3.6,
  create: createCoastGarage,
}

export { COAST_SUN }
