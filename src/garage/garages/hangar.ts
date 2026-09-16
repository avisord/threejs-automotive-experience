import * as THREE from 'three'
import { assembleRoom, box, createFloor, floorTileTexture, glowMaterial, softbox, type GarageDef, type Room } from './kit'

const ROOM = { w: 22, h: 11, d: 28 }
const SUN = 0xffa85a
const TUNGSTEN = 0xffc27a
/** the window on the back wall: width, height, sill height */
const WIN = { w: 16, h: 7.5, sill: 0.8 }
/** the sun's disc in world space, on the window */
const SUN_AT = { x: 2, y: 4.5, r: 0.55 }

/** vertical corrugation, shaded as a sine — tint it with the material colour */
function corrugatedTexture(repeat: [number, number]): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 16
  const g = canvas.getContext('2d')!
  for (let x = 0; x < canvas.width; x++) {
    const v = Math.round(170 + 70 * Math.sin((x / canvas.width) * Math.PI * 2 * 4))
    g.fillStyle = `rgb(${v},${v},${v})`
    g.fillRect(x, 0, 1, canvas.height)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(...repeat)
  texture.anisotropy = 8
  return texture
}

/** sunset over a city skyline, for the window panes */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 1024
  canvas.height = Math.round((1024 * WIN.h) / WIN.w)
  const g = canvas.getContext('2d')!
  const W = canvas.width
  const H = canvas.height
  const sky = g.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#2b1d4a')
  sky.addColorStop(0.35, '#8a3f6e')
  sky.addColorStop(0.62, '#e2745e')
  sky.addColorStop(0.8, '#ffb35c')
  sky.addColorStop(1, '#ffd89a')
  g.fillStyle = sky
  g.fillRect(0, 0, W, H)

  // halo around where the sun disc sits (the disc itself is geometry, so it can bloom)
  const sx = ((SUN_AT.x + WIN.w / 2) / WIN.w) * W
  const sy = ((WIN.sill + WIN.h - SUN_AT.y) / WIN.h) * H
  const halo = g.createRadialGradient(sx, sy, 0, sx, sy, W * 0.3)
  halo.addColorStop(0, 'rgba(255, 226, 170, 0.9)')
  halo.addColorStop(1, 'rgba(255, 180, 110, 0)')
  g.fillStyle = halo
  g.fillRect(0, 0, W, H)

  // skyline
  g.fillStyle = '#2a1a24'
  let x = 0
  while (x < W) {
    const bw = 24 + Math.random() * 70
    const bh = H * (0.08 + Math.random() * 0.22)
    g.fillRect(x, H - bh, bw + 1, bh)
    x += bw
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Old aircraft hangar at golden hour: the sun comes in low through a wall of
 * glass behind the car, tungsten pendants hang over it, and cool sky light
 * fills in from the front.
 */
function createHangar(): Room {
  const { w, h, d } = ROOM
  const group = new THREE.Group()
  group.name = 'hangar'

  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(w, h + 0.02, d),
    new THREE.MeshStandardMaterial({
      color: 0x5a4d42,
      map: corrugatedTexture([d / 0.8, 1]),
      roughness: 0.55,
      metalness: 0.5,
      side: THREE.BackSide,
    }),
  )
  shell.position.y = h / 2 - 0.02
  group.add(shell)

  const steel = new THREE.MeshStandardMaterial({ color: 0x1d1b1a, roughness: 0.5, metalness: 0.7 })

  // ─── polished warm concrete ─────────────────────────────────────────────
  const floor = createFloor(group, {
    geometry: new THREE.PlaneGeometry(w, d),
    tint: 0x7a7a7a,
    blur: 0.014,
    surface: new THREE.MeshStandardMaterial({
      color: 0x524b45,
      map: floorTileTexture([w / 3, d / 3], '#4a4038'),
      roughness: 0.35,
      metalness: 0.05,
      opacity: 0.78,
    }),
  })

  // ─── the window ──────────────────────────────────────────────────────────
  const backZ = -d / 2
  const pane = new THREE.Mesh(
    new THREE.PlaneGeometry(WIN.w, WIN.h),
    new THREE.MeshBasicMaterial({ map: skyTexture(), color: new THREE.Color(1.8, 1.8, 1.8) }),
  )
  pane.position.set(0, WIN.sill + WIN.h / 2, backZ + 0.05)
  group.add(pane)
  const sun = new THREE.Mesh(new THREE.CircleGeometry(SUN_AT.r, 48), glowMaterial(0xffe2b0, 5))
  sun.position.set(SUN_AT.x, SUN_AT.y, backZ + 0.07)
  group.add(sun)
  for (let i = 0; i <= 4; i++) box(group, [0.14, WIN.h, 0.18], steel, [-WIN.w / 2 + (WIN.w / 4) * i, WIN.sill + WIN.h / 2, backZ + 0.1])
  for (let i = 0; i <= 3; i++) box(group, [WIN.w + 0.14, 0.14, 0.18], steel, [0, WIN.sill + (WIN.h / 3) * i, backZ + 0.1])

  // the sunlight itself: the window as one big warm area light, plus a low sun
  const windowLight = new THREE.RectAreaLight(SUN, 3, WIN.w, WIN.h)
  windowLight.position.set(0, WIN.sill + WIN.h / 2, backZ + 0.3)
  windowLight.lookAt(0, 2, 0)
  group.add(windowLight)
  const sunLight = new THREE.DirectionalLight(SUN, 0.5)
  sunLight.position.set(SUN_AT.x, SUN_AT.y, backZ)
  group.add(sunLight) // aims at the origin by default

  // ─── roof trusses ────────────────────────────────────────────────────────
  for (let z = -d / 2 + 3; z < d / 2 - 1; z += 4) {
    box(group, [w, 0.4, 0.22], steel, [0, h - 0.8, z])
    box(group, [w, 0.08, 0.22], steel, [0, h - 1.9, z])
    for (let i = 0; i < w / 2; i++) {
      const brace = box(group, [0.08, 1.35, 0.1], steel, [-w / 2 + 1 + i * 2, h - 1.35, z])
      brace.rotation.z = i % 2 ? -0.6 : 0.6
    }
  }

  // ─── tungsten pendants over the car ─────────────────────────────────────
  const shade = new THREE.MeshStandardMaterial({ color: 0x23201d, roughness: 0.45, metalness: 0.8, side: THREE.DoubleSide })
  const bulb = glowMaterial(TUNGSTEN, 6)
  const dropY = 6.6
  for (const z of [-2.4, 0, 2.4]) {
    const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, h - dropY, 6), steel)
    cord.position.set(0, (h + dropY) / 2, z)
    group.add(cord)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.42, 0.38, 32, 1, true), shade)
    cone.position.set(0, dropY - 0.19, z)
    group.add(cone)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.3, 32), bulb)
    disc.rotation.x = Math.PI / 2 // face down
    disc.position.set(0, dropY - 0.3, z)
    group.add(disc)
    const light = new THREE.PointLight(TUNGSTEN, 160, 0, 2)
    light.position.set(0, dropY - 0.35, z)
    group.add(light)
  }

  // cool sky fill from the front, so the car's face isn't lost against the sunset
  softbox(group, { size: [12, 3], position: [0, 6, d / 2 - 0.3], target: [0, 1, 0], color: 0x9fb8ff, intensity: 1.2, glow: 0.4 })

  // ─── a few things a garage collects ─────────────────────────────────────
  const red = new THREE.MeshStandardMaterial({ color: 0xb3202a, roughness: 0.35, metalness: 0.6 })
  const chrome = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.15, metalness: 1 })
  const chest = new THREE.Group()
  box(chest, [1.6, 1.1, 0.6], red, [0, 0.55, 0])
  for (let i = 0; i < 5; i++) box(chest, [1.2, 0.025, 0.03], chrome, [0, 0.22 + i * 0.18, 0.31])
  chest.position.set(-w / 2 + 0.5, 0, 6)
  chest.rotation.y = Math.PI / 2
  group.add(chest)
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 })
  for (let i = 0; i < 4; i++) {
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.13, 16, 40), rubber)
    tyre.rotation.x = Math.PI / 2
    tyre.position.set(w / 2 - 0.8, 0.13 + i * 0.26, 5)
    group.add(tyre)
  }

  group.add(new THREE.HemisphereLight(0xffd2a8, 0x1a1210, 0.2))

  return assembleRoom(group, floor, {
    bounds: [
      [-w / 2 + 1.8, 0.3, -d / 2 + 0.8],
      [w / 2 - 1.8, h - 2.2, d / 2 - 0.8],
    ],
    background: 0x0d0907,
    environmentIntensity: 1,
  })
}

export const hangar: GarageDef = {
  id: 'hangar',
  name: 'Sunset Hangar',
  tag: 'Golden hour through a glass wall · tungsten pendants',
  palette: ['#ffd89a', '#ffa85a', '#e2745e', '#2b1d4a'],
  look: 'natural',
  create: createHangar,
}
