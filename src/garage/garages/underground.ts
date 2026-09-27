import * as THREE from 'three'
import { createInteriorLights, fixtureMembers } from './interior'
import { assembleRoom, box, concreteTexture, createFloor, glowMaterial, type GarageDef, type Room } from './kit'

const ROOM = { w: 20, h: 5.2, d: 26 }
const MAGENTA = 0xff2bd6
const CYAN = 0x19e6ff
/** pillar rows run along the long walls; the camera box stops short of them */
const PILLAR_X = 7.6
const PILLAR_Z = [-9, -3, 3, 9]
const PILLAR = 0.8

/** "LEVEL -2" wall sign, drawn once to a canvas */
function levelSign(width: number, height: number): THREE.Mesh {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = Math.round((1024 * height) / width)
  const g = canvas.getContext('2d')!
  g.fillStyle = '#000'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.strokeStyle = '#ff2bd6'
  g.lineWidth = 10
  g.strokeRect(14, 14, canvas.width - 28, canvas.height - 28)
  g.fillStyle = '#ff2bd6'
  g.font = '800 190px ui-sans-serif, system-ui, sans-serif'
  g.textBaseline = 'middle'
  g.fillText('P', 70, canvas.height / 2 + 6)
  g.fillStyle = '#ffffff'
  g.font = '700 120px ui-sans-serif, system-ui, sans-serif'
  g.fillText('LEVEL −2', 250, canvas.height / 2 + 4)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, color: new THREE.Color(2.2, 2.2, 2.2) }),
  )
  sign.material.userData.glow = true
  return sign
}

/**
 * Underground car park after hours: low concrete ceiling on heavy beams, a
 * wet floor, and nothing but magenta and cyan neon to see by.
 */
function createUnderground(): Room {
  const { w, h, d } = ROOM
  const group = new THREE.Group()
  group.name = 'underground'

  const concrete = new THREE.MeshStandardMaterial({
    color: 0x5b5e66,
    map: concreteTexture([4, 2]),
    roughness: 0.92,
    metalness: 0,
    side: THREE.BackSide,
  })
  const shell = new THREE.Mesh(new THREE.BoxGeometry(w, h + 0.02, d), concrete)
  shell.position.y = h / 2 - 0.02
  group.add(shell)

  const castConcrete = new THREE.MeshStandardMaterial({ color: 0x4d5057, map: concreteTexture([1, 3]), roughness: 0.85 })
  const stripe = new THREE.MeshStandardMaterial({ color: 0xd8b21f, roughness: 0.6 })
  const magenta = glowMaterial(MAGENTA, 4)
  const cyan = glowMaterial(CYAN, 4)

  // ceiling beams across the room
  for (let z = -d / 2 + 2; z < d / 2 - 1; z += 4) box(group, [w, 0.55, 0.5], castConcrete, [0, h - 0.275, z])

  // pillars with a yellow-black foot and a vertical cyan strip facing the bay
  for (const side of [-1, 1]) {
    for (const z of PILLAR_Z) {
      const x = side * PILLAR_X
      box(group, [PILLAR, h, PILLAR], castConcrete, [x, h / 2, z])
      box(group, [PILLAR + 0.02, 0.5, PILLAR + 0.02], stripe, [x, 0.25, z])
      box(group, [0.04, h - 1.4, 0.06], cyan, [x - side * (PILLAR / 2 + 0.01), (h - 0.55) / 2 + 0.35, z])
    }
  }

  // wall stripe at bumper height
  for (const side of [-1, 1]) {
    box(group, [0.02, 0.28, d], stripe, [side * (w / 2 - 0.01), 0.9, 0])
  }

  // ─── wet asphalt floor with painted bay lines ───────────────────────────
  const floor = createFloor(group, {
    geometry: new THREE.PlaneGeometry(w, d),
    tint: 0x6a6a6a,
    blur: 0.006,
    lod: 1,
    surface: new THREE.MeshStandardMaterial({
      color: 0x1c1d22,
      map: concreteTexture([6, 8], 1.6),
      roughness: 0.35,
      metalness: 0,
      opacity: 0.7,
    }),
  })
  const lines = new THREE.Group()
  const paint = new THREE.MeshStandardMaterial({ color: 0xd9dade, roughness: 0.55 })
  for (const x of [-4.5, -1.5, 1.5, 4.5]) box(lines, [0.1, 0.004, 5.6], paint, [x, 0.005, -0.2])
  box(lines, [9.1, 0.004, 0.1], paint, [0, 0.005, -3])
  group.add(lines)
  floor.floorLayers.push(lines)

  // ─── neon ────────────────────────────────────────────────────────────────
  // two long tubes run the length of the ceiling between the beams, one per colour
  const tubeLen = d - 4
  const tubeLights: THREE.RectAreaLight[] = []
  for (const [x, color, material] of [
    [-2.2, MAGENTA, magenta],
    [2.2, CYAN, cyan],
  ] as const) {
    box(group, [0.07, 0.07, tubeLen], material, [x, h - 0.62, 0])
    const light = new THREE.RectAreaLight(color, 22, 0.2, tubeLen)
    light.position.set(x, h - 0.66, 0)
    light.rotation.x = -Math.PI / 2
    group.add(light)
    tubeLights.push(light)
  }
  // neon cross-bars on the back wall behind the car, washing it magenta
  for (const y of [1.4, 2.2]) box(group, [9, 0.06, 0.06], magenta, [0, y, -d / 2 + 0.05])
  const backWash = new THREE.RectAreaLight(MAGENTA, 6, 9, 1.2)
  backWash.position.set(0, 1.8, -d / 2 + 0.2)
  backWash.lookAt(0, 1.2, 0)
  group.add(backWash)

  const sign = levelSign(3.2, 1.1)
  sign.position.set(-w / 2 + 0.03, 3.1, -4)
  sign.rotation.y = Math.PI / 2
  group.add(sign)

  const ambient = new THREE.HemisphereLight(0x6a5a8a, 0x0a0710, 0.12)
  group.add(ambient)

  // the fittings the user can switch, dim and recolour (Menu › Garage › Interior lights)
  const interior = createInteriorLights([
    {
      id: 'magenta',
      name: 'Magenta neon',
      hint: 'The ceiling tube on the left and the bars on the back wall',
      color: MAGENTA,
      members: [{ glow: magenta }, { light: tubeLights[0] }, { light: backWash }],
    },
    {
      id: 'cyan',
      name: 'Cyan neon',
      hint: 'The ceiling tube on the right and the strips down the pillars',
      color: CYAN,
      members: [{ glow: cyan }, { light: tubeLights[1] }],
    },
    { id: 'ambient', name: 'Ambient fill', hint: 'The faint glow of the car park around the bay', kelvin: 6500, members: fixtureMembers(ambient) },
  ])

  const room = assembleRoom(group, floor, {
    bounds: [
      [-PILLAR_X + PILLAR / 2 + 0.4, 0.3, -d / 2 + 0.6],
      [PILLAR_X - PILLAR / 2 - 0.4, h - 0.75, d / 2 - 0.6],
    ],
    background: 0x050407,
    environmentIntensity: 1,
  })
  return { ...room, interior }
}

export const underground: GarageDef = {
  id: 'underground',
  name: 'Neon Underground',
  tag: 'Low concrete car park, wet floor · magenta and cyan tubes',
  palette: ['#ff2bd6', '#19e6ff', '#5b5e66', '#d8b21f'],
  look: 'cyber',
  exposureKey: -5.7,
  create: createUnderground,
}
