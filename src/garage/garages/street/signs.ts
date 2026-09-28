import * as THREE from 'three'

/**
 * One texture for every painted or printed thing in the street: shop boards,
 * traffic signs, the blue enamel street plaques, the gutter grates and
 * manhole covers — so they all draw from one material and a sign is just a
 * quad with uvs into its cell. Most of it reads as a shape and a colour from
 * the street (a red octagon, a blue P); only the shop names are words, as a
 * painted board over a shop is.
 */

const SIZE = 1024

/** a cell's uv rectangle: [u0, v0, u1, v1] */
export type Cell = [number, number, number, number]

/** a canvas rectangle (px, y down) → uvs (v up, the canvas flipped as three uploads it) */
const cell = (x: number, y: number, w: number, h: number): Cell => [x / SIZE, 1 - (y + h) / SIZE, (x + w) / SIZE, 1 - y / SIZE]

export const SHOPS = ['CAFÉ', 'FARMACIA', 'PANADERÍA', 'ABARROTES', 'TALLER', 'PAPELERÍA', 'TORTILLERÍA', 'FERRETERÍA'] as const
/** shop boards, 4:1 */
export const SHOP_CELLS: Cell[] = SHOPS.map((_, i) => cell((i % 2) * 512, Math.floor(i / 2) * 128, 512, 128))

const small = (i: number): Cell => cell((i % 8) * 128, 512 + Math.floor(i / 8) * 128, 128, 128)
export const SIGN = {
  stop: small(0),
  yield: small(1),
  parking: small(2),
  noParking: small(3),
  oneWay: small(4),
  speed: small(5),
  crossing: small(6),
  hazard: small(7),
  /** a street name plaque, 2:1 */
  plaque: cell(0, 768, 256, 128),
  plaque2: cell(256, 768, 256, 128),
  grate: small(20),
  manhole: small(21),
  /** a small metal plate (the grey back of any sign) */
  back: small(22),
}

const SHOP_PAINT: [string, string, string][] = [
  // board, lettering, border
  ['#7a1f1c', '#f4ead2', '#d9b25c'],
  ['#1f5a3a', '#f4f0e2', '#f4f0e2'],
  ['#f1e2b8', '#6b2a1a', '#6b2a1a'],
  ['#2a4a7a', '#f6e9c4', '#f6e9c4'],
  ['#2b2b2b', '#e8c14a', '#e8c14a'],
  ['#e9d9a8', '#1f4e6b', '#1f4e6b'],
  ['#b33a2a', '#fff4dc', '#fff4dc'],
  ['#3e5a2a', '#f2e6c0', '#d9b25c'],
]

export function createSignTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const g = canvas.getContext('2d')!
  g.fillStyle = '#8a8a86'
  g.fillRect(0, 0, SIZE, SIZE)
  const px = ([u0, v0, u1, v1]: Cell) => ({ x: u0 * SIZE, y: (1 - v1) * SIZE, w: (u1 - u0) * SIZE, h: (v1 - v0) * SIZE })

  // shop boards: a painted panel, a border, the name in tall capitals, a little weathering
  SHOPS.forEach((name, i) => {
    const { x, y, w, h } = px(SHOP_CELLS[i])
    const [board, ink, border] = SHOP_PAINT[i]
    g.fillStyle = board
    g.fillRect(x, y, w, h)
    g.strokeStyle = border
    g.lineWidth = 6
    g.strokeRect(x + 10, y + 10, w - 20, h - 20)
    g.fillStyle = ink
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `bold ${name.length > 9 ? 58 : 70}px Georgia, "Times New Roman", serif`
    g.fillText(name, x + w / 2, y + h / 2 + 4, w - 60)
    weather(g, x, y, w, h, i)
  })

  const disc = (c: Cell, fill: string, ring: string, r = 0.44) => {
    const { x, y, w } = px(c)
    g.fillStyle = '#8a8a86'
    g.fillRect(x, y, w, w)
    g.beginPath()
    g.arc(x + w / 2, y + w / 2, w * r, 0, Math.PI * 2)
    g.fillStyle = ring
    g.fill()
    g.beginPath()
    g.arc(x + w / 2, y + w / 2, w * (r - 0.07), 0, Math.PI * 2)
    g.fillStyle = fill
    g.fill()
  }
  const text = (c: Cell, s: string, color: string, size: number, dy = 0) => {
    const { x, y, w, h } = px(c)
    g.fillStyle = color
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = `bold ${size}px Arial, Helvetica, sans-serif`
    g.fillText(s, x + w / 2, y + h / 2 + dy)
  }
  // stop: a red octagon with a white rim
  {
    const { x, y, w } = px(SIGN.stop)
    const oct = (r: number, fill: string) => {
      g.beginPath()
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k * Math.PI) / 4
        g.lineTo(x + w / 2 + Math.cos(a) * r, y + w / 2 + Math.sin(a) * r)
      }
      g.closePath()
      g.fillStyle = fill
      g.fill()
    }
    oct(w * 0.48, '#f4f4f0')
    oct(w * 0.43, '#b3201c')
    text(SIGN.stop, 'ALTO', '#f4f4f0', 30)
  }
  // yield: a white triangle, red rim, point down
  {
    const { x, y, w } = px(SIGN.yield)
    const tri = (inset: number, fill: string) => {
      g.beginPath()
      g.moveTo(x + inset * 1.2, y + 14 + inset)
      g.lineTo(x + w - inset * 1.2, y + 14 + inset)
      g.lineTo(x + w / 2, y + w - 8 - inset * 1.4)
      g.closePath()
      g.fillStyle = fill
      g.fill()
    }
    tri(0, '#b3201c')
    tri(14, '#f4f4f0')
  }
  // parking: a blue square with a white P
  {
    const { x, y, w } = px(SIGN.parking)
    g.fillStyle = '#f4f4f0'
    g.fillRect(x + 8, y + 8, w - 16, w - 16)
    g.fillStyle = '#1f4f9a'
    g.fillRect(x + 14, y + 14, w - 28, w - 28)
    text(SIGN.parking, 'E', '#f4f4f0', 78, 4)
  }
  // no parking: a white disc, red ring and bar over an E
  disc(SIGN.noParking, '#f4f4f0', '#b3201c')
  text(SIGN.noParking, 'E', '#1c1c1c', 60, 3)
  {
    const { x, y, w } = px(SIGN.noParking)
    g.strokeStyle = '#b3201c'
    g.lineWidth = 10
    g.beginPath()
    g.moveTo(x + w * 0.24, y + w * 0.24)
    g.lineTo(x + w * 0.76, y + w * 0.76)
    g.stroke()
  }
  // one way: a black plate with a white arrow
  {
    const { x, y, w } = px(SIGN.oneWay)
    g.fillStyle = '#f4f4f0'
    g.fillRect(x + 4, y + 34, w - 8, w - 68)
    g.fillStyle = '#1c1c1c'
    g.fillRect(x + 9, y + 39, w - 18, w - 78)
    g.fillStyle = '#f4f4f0'
    g.beginPath()
    g.moveTo(x + 18, y + w / 2 - 6)
    g.lineTo(x + w - 44, y + w / 2 - 6)
    g.lineTo(x + w - 44, y + w / 2 - 16)
    g.lineTo(x + w - 16, y + w / 2)
    g.lineTo(x + w - 44, y + w / 2 + 16)
    g.lineTo(x + w - 44, y + w / 2 + 6)
    g.lineTo(x + 18, y + w / 2 + 6)
    g.closePath()
    g.fill()
  }
  // speed limit: white disc, red ring, 30
  disc(SIGN.speed, '#f4f4f0', '#b3201c')
  text(SIGN.speed, '30', '#1c1c1c', 52, 3)
  // pedestrian crossing / hazard: yellow diamonds with a black figure / bolt
  for (const [c, mark] of [
    [SIGN.crossing, 'walk'],
    [SIGN.hazard, 'bolt'],
  ] as const) {
    const { x, y, w } = px(c)
    g.save()
    g.translate(x + w / 2, y + w / 2)
    g.rotate(Math.PI / 4)
    g.fillStyle = '#1c1c1c'
    g.fillRect(-44, -44, 88, 88)
    g.fillStyle = '#e8c21a'
    g.fillRect(-40, -40, 80, 80)
    g.restore()
    g.fillStyle = '#1c1c1c'
    if (mark === 'walk') {
      g.beginPath()
      g.arc(x + w / 2 + 2, y + 38, 7, 0, Math.PI * 2)
      g.fill()
      g.lineWidth = 7
      g.strokeStyle = '#1c1c1c'
      g.beginPath()
      g.moveTo(x + w / 2, y + 48)
      g.lineTo(x + w / 2 - 4, y + 72)
      g.lineTo(x + w / 2 - 16, y + 92)
      g.moveTo(x + w / 2 - 4, y + 72)
      g.lineTo(x + w / 2 + 12, y + 90)
      g.moveTo(x + w / 2 - 14, y + 60)
      g.lineTo(x + w / 2 + 14, y + 62)
      g.stroke()
    } else {
      g.beginPath()
      g.moveTo(x + w / 2 + 8, y + 30)
      g.lineTo(x + w / 2 - 14, y + 68)
      g.lineTo(x + w / 2, y + 68)
      g.lineTo(x + w / 2 - 8, y + 98)
      g.lineTo(x + w / 2 + 14, y + 58)
      g.lineTo(x + w / 2, y + 58)
      g.closePath()
      g.fill()
    }
  }
  // street plaques: blue enamel, white rim, a name in white capitals
  for (const [c, name] of [
    [SIGN.plaque, 'C. HIDALGO'],
    [SIGN.plaque2, 'C. DEL SOL'],
  ] as const) {
    const { x, y, w, h } = px(c)
    g.fillStyle = '#f2f2ee'
    g.fillRect(x + 4, y + 16, w - 8, h - 32)
    g.fillStyle = '#1d3f86'
    g.fillRect(x + 10, y + 22, w - 20, h - 44)
    g.fillStyle = '#f2f2ee'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.font = 'bold 34px Arial, Helvetica, sans-serif'
    g.fillText(name, x + w / 2, y + h / 2 + 2, w - 40)
  }
  // a gutter grate: cast-iron bars in a frame
  {
    const { x, y, w } = px(SIGN.grate)
    g.fillStyle = '#2a2826'
    g.fillRect(x, y, w, w)
    g.fillStyle = '#0c0c0c'
    for (let k = 0; k < 7; k++) g.fillRect(x + 12 + k * 16, y + 12, 9, w - 24)
    g.strokeStyle = '#4a4744'
    g.lineWidth = 6
    g.strokeRect(x + 4, y + 4, w - 8, w - 8)
  }
  // a manhole cover: a ring, a cross-hatched disc, transparent round it
  {
    const { x, y, w } = px(SIGN.manhole)
    g.clearRect(x, y, w, w)
    g.beginPath()
    g.arc(x + w / 2, y + w / 2, w * 0.48, 0, Math.PI * 2)
    g.fillStyle = '#34312d'
    g.fill()
    g.beginPath()
    g.arc(x + w / 2, y + w / 2, w * 0.4, 0, Math.PI * 2)
    g.fillStyle = '#403c37'
    g.fill()
    g.save()
    g.clip()
    g.strokeStyle = '#2a2723'
    g.lineWidth = 4
    for (let k = -w; k < w; k += 14) {
      g.beginPath()
      g.moveTo(x + k, y)
      g.lineTo(x + k + w, y + w)
      g.moveTo(x + k + w, y)
      g.lineTo(x + k, y + w)
      g.stroke()
    }
    g.restore()
  }
  {
    const { x, y, w } = px(SIGN.back)
    g.fillStyle = '#9a9a96'
    g.fillRect(x, y, w, w)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  return texture
}

/** faded paint and a few scuffs, so a board has been out in the sun */
function weather(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seed: number): void {
  let s = seed * 9301 + 49297
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280)
  g.fillStyle = 'rgba(255,248,235,0.08)'
  g.fillRect(x, y, w, h * 0.4)
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgba(${r() > 0.5 ? '255,250,240' : '30,25,20'},${0.04 + r() * 0.06})`
    g.fillRect(x + r() * w, y + r() * h, 4 + r() * 30, 2 + r() * 6)
  }
}
