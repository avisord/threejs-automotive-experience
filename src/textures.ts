import * as THREE from 'three'

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  return [canvas, canvas.getContext('2d')!]
}

function toTexture(canvas: HTMLCanvasElement, colorSpace: string = THREE.SRGBColorSpace): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = colorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 8
  return tex
}

/** Speckled grey stone — returns color map and bump map. */
export function pebbleTextures(): { map: THREE.CanvasTexture; bumpMap: THREE.CanvasTexture } {
  const size = 512
  const [colorCanvas, ctx] = makeCanvas(size)
  const [bumpCanvas, bctx] = makeCanvas(size)

  ctx.fillStyle = '#8d8779'
  ctx.fillRect(0, 0, size, size)
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, size, size)

  // large soft blotches for mineral variation
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = 20 + Math.random() * 60
    const shade = 110 + Math.floor(Math.random() * 60)
    const g = ctx.createRadialGradient(x, y, 0, x, y, r)
    g.addColorStop(0, `rgba(${shade},${shade - 6},${shade - 18},0.25)`)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(x - r, y - r, r * 2, r * 2)
  }

  // fine speckles on both maps
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * size
    const y = Math.random() * size
    const r = Math.random() * 1.6
    const v = Math.floor(Math.random() * 255)
    ctx.fillStyle = `rgba(${v},${v},${v},0.16)`
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    bctx.fillStyle = `rgba(${v},${v},${v},0.5)`
    bctx.beginPath()
    bctx.arc(x, y, r, 0, Math.PI * 2)
    bctx.fill()
  }

  return {
    map: toTexture(colorCanvas),
    bumpMap: toTexture(bumpCanvas, THREE.NoColorSpace),
  }
}

/** Classic six-wedge beach ball stripes. */
export function beachBallTexture(): THREE.CanvasTexture {
  const size = 1024
  const [canvas, ctx] = makeCanvas(size)
  const colors = ['#e63946', '#f4f1ea', '#f5a623', '#f4f1ea', '#2a9d8f', '#f4f1ea']
  const stripe = size / colors.length
  colors.forEach((c, i) => {
    ctx.fillStyle = c
    ctx.fillRect(i * stripe, 0, stripe + 1, size)
  })
  return toTexture(canvas)
}

/** Two-tone checkerboard. */
export function checkerTexture(): THREE.CanvasTexture {
  const size = 512
  const cells = 12
  const [canvas, ctx] = makeCanvas(size)
  const cell = size / cells
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#14141b' : '#e8e4d8'
      ctx.fillRect(x * cell, y * cell, cell, cell)
    }
  }
  const tex = toTexture(canvas)
  tex.magFilter = THREE.NearestFilter
  return tex
}

/** Dark basalt crust with branching lava cracks — color map + emissive mask. */
export function magmaTextures(): { map: THREE.CanvasTexture; emissiveMap: THREE.CanvasTexture } {
  const size = 1024
  const [colorCanvas, ctx] = makeCanvas(size)
  const [glowCanvas, gctx] = makeCanvas(size)

  // cooled crust
  ctx.fillStyle = '#170c07'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 6000; i++) {
    const v = 14 + Math.floor(Math.random() * 26)
    ctx.fillStyle = `rgba(${v + 12},${v},${v - 6},0.35)`
    ctx.fillRect(Math.random() * size, Math.random() * size, 2 + Math.random() * 4, 2 + Math.random() * 4)
  }
  // emissive mask starts black — only the cracks glow
  gctx.fillStyle = '#000'
  gctx.fillRect(0, 0, size, size)

  const crack = (x: number, y: number, angle: number, steps: number, width: number): void => {
    for (let s = 0; s < steps; s++) {
      const nx = x + Math.cos(angle) * (10 + Math.random() * 22)
      const ny = y + Math.sin(angle) * (10 + Math.random() * 22)
      // dim heat halo on the color map, hot core on both
      ctx.strokeStyle = 'rgba(140,30,0,0.5)'
      ctx.lineCap = 'round'
      ctx.lineWidth = width * 3
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      ctx.strokeStyle = '#ff7a1a'
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(nx, ny)
      ctx.stroke()
      gctx.strokeStyle = '#ffffff'
      gctx.lineCap = 'round'
      gctx.lineWidth = width
      gctx.beginPath()
      gctx.moveTo(x, y)
      gctx.lineTo(nx, ny)
      gctx.stroke()

      x = nx
      y = ny
      angle += (Math.random() - 0.5) * 1.2
      if (Math.random() < 0.16 && width > 1.5) crack(x, y, angle + (Math.random() < 0.5 ? 1.2 : -1.2), Math.floor(steps / 2), width * 0.6)
    }
  }
  for (let i = 0; i < 14; i++) {
    crack(Math.random() * size, Math.random() * size, Math.random() * Math.PI * 2, 12 + Math.floor(Math.random() * 14), 2.5 + Math.random() * 2.5)
  }

  return {
    map: toTexture(colorCanvas),
    emissiveMap: toTexture(glowCanvas),
  }
}

/** Veined white marble. */
export function marbleTexture(): THREE.CanvasTexture {
  const size = 512
  const [canvas, ctx] = makeCanvas(size)
  ctx.fillStyle = '#e9e7e2'
  ctx.fillRect(0, 0, size, size)
  for (let i = 0; i < 26; i++) {
    ctx.strokeStyle = `rgba(90,95,110,${0.05 + Math.random() * 0.12})`
    ctx.lineWidth = 0.5 + Math.random() * 2
    ctx.beginPath()
    let x = Math.random() * size
    let y = Math.random() * size
    ctx.moveTo(x, y)
    for (let s = 0; s < 14; s++) {
      x += (Math.random() - 0.5) * 90
      y += (Math.random() - 0.5) * 90
      ctx.quadraticCurveTo(
        x + (Math.random() - 0.5) * 40,
        y + (Math.random() - 0.5) * 40,
        x,
        y,
      )
    }
    ctx.stroke()
  }
  return toTexture(canvas)
}
