import * as THREE from 'three'

/** Fog color that matches the dome's horizon band so floor and sky meet seamlessly. */
export const HORIZON_FOG_COLOR = 0x171a33

/**
 * Night-sky dome: procedural gradient (deep space → blue-purple horizon glow),
 * faint nebula patches and a starfield. Canvas v=0.5 maps to world-horizontal.
 */
export function createBackground(): THREE.Mesh {
  const w = 2048
  const h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0.0, '#010208')
  grad.addColorStop(0.3, '#060b1e')
  grad.addColorStop(0.44, '#121b42')
  grad.addColorStop(0.5, '#2b2258') // glow band right above the horizon
  grad.addColorStop(0.56, '#171a33') // = HORIZON_FOG_COLOR
  grad.addColorStop(1.0, '#0a0c14')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // soft nebula patches high in the sky
  const nebulaColors = ['58,90,255', '160,70,255', '40,200,220']
  for (let i = 0; i < 7; i++) {
    const x = Math.random() * w
    const y = Math.random() * h * 0.4
    const r = 120 + Math.random() * 260
    const c = nebulaColors[i % nebulaColors.length]
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${c},${0.05 + Math.random() * 0.06})`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // starfield, denser toward the zenith
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w
    const y = Math.random() ** 1.6 * h * 0.5
    const alpha = 0.12 + Math.random() * 0.75
    const radius = Math.random() < 0.92 ? 0.4 + Math.random() * 0.8 : 1.2 + Math.random() * 1.1
    ctx.fillStyle = Math.random() < 0.25 ? `rgba(190,210,255,${alpha})` : `rgba(255,255,255,${alpha})`
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
    if (radius > 1.2) {
      // bright stars get a faint halo
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius * 5)
      g.addColorStop(0, `rgba(200,220,255,${alpha * 0.25})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - radius * 5, y - radius * 5, radius * 10, radius * 10)
    }
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(230, 48, 32),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, fog: false }),
  )
  return dome
}
