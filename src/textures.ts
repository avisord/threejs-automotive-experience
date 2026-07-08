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
