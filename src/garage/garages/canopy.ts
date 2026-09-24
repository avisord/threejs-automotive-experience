import * as THREE from 'three'
import { fbm, noRaycast, noise, polarGrid, seeded, smoothstep } from './landform'
import { SITE, forestDensity, heightAt } from './site'
import { outdoorMaterial } from './terrain'

/**
 * The woods seen from afar, as a mass: a lumpy shell of crowns laid over the
 * terrain wherever the forest is thick, sunk out of sight where it isn't.
 *
 * Past a few hundred metres a tree is a handful of pixels, and even thousands
 * of instanced ones read as a sprinkling on a lawn — a real forest from a
 * distance is a continuous dark canopy with sunlit and shaded crowns and a
 * ragged edge. The instanced trees (trees.ts) still stand in it and break its
 * crest lines; the shell supplies the mass.
 */

/** crown height over the ground, metres */
const CANOPY = { height: 16, inner: 600 }

/** dark crowns with lit tops, in metres-sized blobs — multiplied over the shell's vertex colours */
function crownTexture(): THREE.CanvasTexture {
  const size = 256
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const g = canvas.getContext('2d')!
  g.fillStyle = 'rgb(215,215,215)' // multiplies (sRGB): keep it near white, or the woods turn to soot
  g.fillRect(0, 0, size, size)
  const rand = seeded(17)
  for (let i = 0; i < 900; i++) {
    const x = rand() * size
    const y = rand() * size
    const r = 3 + rand() * 7
    // each crown: a shaded rim and a brighter top, drawn with wrap so the tile repeats
    for (const [dx, dy] of [[0, 0], [size, 0], [-size, 0], [0, size], [0, -size]]) {
      const grad = g.createRadialGradient(x + dx - r * 0.3, y + dy - r * 0.3, 0, x + dx, y + dy, r)
      const lit = 240 + rand() * 15
      grad.addColorStop(0, `rgba(${lit},${lit},${lit},1)`)
      grad.addColorStop(0.7, 'rgba(200,200,200,1)')
      grad.addColorStop(1, 'rgba(150,150,150,0)')
      g.fillStyle = grad
      g.beginPath()
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2)
      g.fill()
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 8
  return texture
}

export function createCanopy(): THREE.Mesh {
  const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
  const cedar = srgb(0x2b4629)
  const pine = srgb(0x385a31)
  const broadleaf = srgb(0x557238)
  const geometry = polarGrid(
    SITE.realRadius,
    170,
    720,
    (t) => t ** 1.25,
    (x, z, _t, _a, c) => {
      const r = Math.hypot(x, z)
      const ground = heightAt(x, z)
      // thick woods only: open stands stay individual trees; the near valley is left to trees.ts
      const cover = smoothstep(forestDensity(x, z), 0.1, 0.5) * smoothstep(r, CANOPY.inner, CANOPY.inner + 300)
      // crowns: uneven heights in patches, and lumps of a few tens of metres
      const lumps = 0.7 + 0.3 * fbm(x / 60, z / 60, 3) + 0.25 * (noise(x / 18, z / 18) - 0.5)
      // (height follows cover, so a wood's edge slopes down over tens of metres instead of standing as a wall)
      const h = cover > 0.02 ? ground + CANOPY.height * lumps * cover - 3 * (1 - cover) : ground - 3
      // mostly dark conifers, fresher broadleaf stands in between
      c.copy(cedar).lerp(pine, fbm(x / 140 + 3, z / 140, 2))
      c.lerp(broadleaf, smoothstep(fbm(x / 300 - 9, z / 300 + 2, 2), 0.55, 0.7) * 0.8)
      return h
    },
    1 / 14, // crown texture tiles every 14 m
  )
  const canopy = new THREE.Mesh(
    geometry,
    outdoorMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: crownTexture(), roughness: 1 })),
  )
  canopy.name = 'canopy'
  canopy.castShadow = true // woods shade the slopes and clearings behind them (far shadow map)
  canopy.receiveShadow = true
  return noRaycast(canopy)
}
