import * as THREE from 'three'
import { receiveFarShadow } from '../far-shadow'
import type { PbrMaps } from '../kit'
import { noRaycast, seeded } from '../landform'
import { foliage } from '../foliage'
import { OUTDOOR_SKY_LIGHT } from '../sky'

/**
 * Palms, the coast's signature. Five archetypes, each generated (no assets):
 *
 *   tall straight (slender) · medium broad (coconut) · tall curved (leaning)
 *   · small young · asymmetric mature
 *
 * and three seeded variants of each (trunk bow and lean, frond count,
 * length and droop, crown lopsidedness), so a row of palms isn't one palm
 * repeated; instances add their own height, turn, a slight squash and tint.
 *
 * A palm is a trunk (a tapered tube along a curve: straight, gently bowed or
 * leaning out toward the light, flared at its foot, photographed palm bark)
 * and a crown of pinnate fronds — each a spine arching out and drooping
 * under its own weight, carrying a folded strip of leaflets (a canvas
 * texture: leaflets feathered along a midrib, alpha-tested), the young ones
 * upright in the centre, the old ones hanging, a skirt of dead brown fronds
 * on the dense ones and a cluster of nuts under the coconuts' crowns.
 *
 * Three levels of detail, all built from the same parameters so a palm keeps
 * its silhouette: LOD 0 (~1–1.5 k triangles: every frond folded, a round
 * trunk), LOD 1 (flat fronds, fewer and wider, a six-sided trunk, ~150), LOD 2
 * (seven fronds of two segments on a four-sided trunk, ~50). Geometry is one
 * unit tall standing on the origin; instances scale, turn and tint it.
 */

export interface PalmSpec {
  /** trunk radius at the foot and under the crown, × height */
  radius: [number, number]
  /** how far the trunk bows (× height) and leans out at its top */
  bow: number
  lean: number
  /** fronds in the crown */
  fronds: number
  /** frond length × height */
  frond: number
  /** how far the old fronds droop (0 stiff … 1 hanging) */
  droop: number
  /** brown dead fronds hanging under the crown */
  skirt: number
  /** coconuts under the crown */
  nuts: number
  /** how lopsided the crown is: fronds longer and thicker on one side, gaps on the other (0 even) */
  asym?: number
  seed: number
}

export const PALMS: Record<'slender' | 'coconut' | 'leaning' | 'young' | 'mature', PalmSpec> = {
  slender: { radius: [0.02, 0.011], bow: 0.03, lean: 0.02, fronds: 20, frond: 0.2, droop: 0.55, skirt: 0, nuts: 0, seed: 1 },
  coconut: { radius: [0.028, 0.016], bow: 0.08, lean: 0.06, fronds: 24, frond: 0.33, droop: 0.75, skirt: 0, nuts: 7, seed: 2 },
  leaning: { radius: [0.03, 0.017], bow: 0.22, lean: 0.3, fronds: 22, frond: 0.32, droop: 0.8, skirt: 0, nuts: 5, seed: 3 },
  young: { radius: [0.07, 0.05], bow: 0.02, lean: 0.03, fronds: 16, frond: 0.62, droop: 0.45, skirt: 0, nuts: 0, seed: 4 },
  mature: { radius: [0.06, 0.05], bow: 0.04, lean: 0.03, fronds: 38, frond: 0.36, droop: 0.6, skirt: 12, nuts: 0, asym: 0.35, seed: 5 },
}
export type PalmKind = keyof typeof PALMS

/** variants of an archetype: the same kind of palm, grown a little differently */
const VARIANTS = 3
function variantSpec(kind: PalmKind, v: number): PalmSpec {
  const base = PALMS[kind]
  if (v === 0) return base
  const rand = seeded(base.seed * 101 + v * 17)
  const vary = (x: number, k: number) => x * (1 - k + 2 * k * rand())
  return {
    ...base,
    bow: vary(base.bow, 0.5) + 0.02 * rand(),
    lean: vary(base.lean, 0.4),
    fronds: Math.round(vary(base.fronds, 0.2)),
    frond: vary(base.frond, 0.12),
    droop: Math.min(1, vary(base.droop, 0.2)),
    skirt: Math.round(vary(base.skirt, 0.5)),
    asym: (base.asym ?? 0.1) * (0.5 + rand()),
    seed: base.seed * 13 + v,
  }
}

/** the frond texture: pinnate leaflets along a midrib (alpha), greyscale green — the instance colour tints it */
function frondTexture(): THREE.CanvasTexture {
  const w = 256
  const h = 1024
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')!
  g.clearRect(0, 0, w, h)
  const rand = seeded(77)
  // v runs along the frond (0 at the crown, 1 at the tip); u across it, midrib at 0.5
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 70; k++) {
      const v = 0.04 + (k / 70) * 0.94
      const y = v * h
      // leaflets longest a third of the way out, short at the base and the tip
      const len = Math.sin(Math.PI * Math.min(1, v * 1.05)) ** 0.7 * (w * 0.48) * (0.85 + rand() * 0.3)
      const angle = 0.9 + rand() * 0.25 // swept toward the tip
      const ex = w / 2 + side * Math.sin(angle) * len
      const ey = y + Math.cos(angle) * len * 0.9
      const shade = 150 + Math.floor(rand() * 70)
      g.strokeStyle = `rgb(${shade * 0.85},${shade},${shade * 0.7})`
      g.lineCap = 'round'
      // a leaflet: wide at its base, tapering to a point
      for (let t = 0; t < 1; t += 0.1) {
        g.lineWidth = 10 * (1 - t) + 1.5
        g.beginPath()
        g.moveTo(w / 2 + (ex - w / 2) * t, y + (ey - y) * t)
        g.lineTo(w / 2 + (ex - w / 2) * (t + 0.12), y + (ey - y) * (t + 0.12))
        g.stroke()
      }
    }
  }
  // the midrib
  g.strokeStyle = 'rgb(175,170,120)'
  g.lineWidth = 6
  g.beginPath()
  g.moveTo(w / 2, 0)
  g.lineTo(w / 2, h)
  g.stroke()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false // (v = 0 at the crown, as drawn)
  texture.anisotropy = 8
  return texture
}

interface Parts {
  trunk: THREE.BufferGeometry
  crown: THREE.BufferGeometry
}

/** the trunk's centre line at t (0 foot … 1 crown), unit height */
function spine(spec: PalmSpec, t: number, out: THREE.Vector3): THREE.Vector3 {
  // a bow (sideways curve) plus a lean that grows toward the top — both toward +x
  const x = spec.bow * Math.sin(Math.PI * t) * 0.5 + spec.lean * t * t
  return out.set(x, t * (1 - spec.frond * 0.12), 0)
}

function buildPalm(spec: PalmSpec, lod: 0 | 1 | 2): Parts {
  const rand = seeded(spec.seed * 31 + 7)
  const radial = [10, 6, 4][lod]
  const rings = [16, 6, 2][lod]
  // ─── trunk ───
  const tp: number[] = []
  const tn: number[] = []
  const tuv: number[] = []
  const ti: number[] = []
  const c = new THREE.Vector3()
  const next = new THREE.Vector3()
  const tangent = new THREE.Vector3()
  const side = new THREE.Vector3()
  const bin = new THREE.Vector3()
  for (let i = 0; i <= rings; i++) {
    const t = i / rings
    spine(spec, t, c)
    spine(spec, Math.min(1, t + 0.01), next)
    tangent.subVectors(next, c).normalize()
    if (i === rings) spine(spec, t - 0.01, next), tangent.subVectors(c, next).normalize()
    side.set(0, 0, 1).cross(tangent).normalize()
    bin.crossVectors(tangent, side).normalize()
    // flared foot, a slight swelling low down, tapering to the crown; ring scars as tiny bulges (LOD 0)
    const flare = 1 + 0.9 * Math.exp(-t * 18)
    const scar = lod === 0 ? 1 + 0.035 * Math.sin(t * 90) : 1
    const r = (spec.radius[0] + (spec.radius[1] - spec.radius[0]) * Math.sqrt(t)) * flare * scar
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2
      const nx = Math.cos(a)
      const nz = Math.sin(a)
      const n = new THREE.Vector3().addScaledVector(side, nx).addScaledVector(bin, nz)
      tp.push(c.x + n.x * r, c.y + n.y * r, c.z + n.z * r)
      tn.push(n.x, n.y, n.z)
      tuv.push(j / radial, t * 8)
    }
  }
  for (let i = 0; i < rings; i++)
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j
      const b = a + radial + 1
      ti.push(a, b, a + 1, a + 1, b, b + 1)
    }
  const trunk = new THREE.BufferGeometry()
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3))
  trunk.setAttribute('normal', new THREE.Float32BufferAttribute(tn, 3))
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(tuv, 2))
  trunk.setIndex(ti)

  // ─── crown ───
  const top = spine(spec, 1, new THREE.Vector3())
  const cp: number[] = []
  const cn: number[] = []
  const cuv: number[] = []
  const cc: number[] = []
  const ci: number[] = []
  // (farther fronds are fewer and wider, so the crown keeps its mass: thin far fronds read as bare sticks)
  const fronds = lod === 0 ? spec.fronds : lod === 1 ? Math.max(10, Math.round(spec.fronds * 0.7)) : 9
  const segs = [10, 5, 3][lod]
  const folded = lod === 0
  const widthScale = [1, 1.6, 2.3][lod]
  const green = new THREE.Color(1, 1, 1)
  const brown = new THREE.Color(0.55, 0.42, 0.28)
  const addFrond = (azimuth: number, rise: number, length: number, droop: number, width: number, tint: THREE.Color) => {
    const dir = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth))
    const across = new THREE.Vector3(-dir.z, 0, dir.x)
    // crown normals: up and out from the crown's centre (a frond is lit as part of the crown's mass)
    const n = dir.clone().multiplyScalar(0.55).setY(0.85).normalize()
    // folded (LOD 0): two halves, each from the midrib out to an edge lifted into a shallow V;
    // flat (LOD 1–2): one strip across, its edges drooping a little
    const halves = folded ? [-1, 1] : [0]
    for (const half of halves) {
      const start = cp.length / 3
      for (let k = 0; k <= segs; k++) {
        const s = k / segs
        // the spine: out and up at `rise`, then arcing down under its own weight
        const p = new THREE.Vector3().copy(top).addScaledVector(dir, length * s * Math.cos(rise * (1 - s * 0.3)))
        p.y += length * (s * Math.sin(rise) - droop * s * s * 0.9)
        const w = width * Math.sin(Math.PI * Math.min(1, s * 1.02 + 0.02)) ** 0.5
        let inner: THREE.Vector3
        let outer: THREE.Vector3
        let uIn: number
        let uOut: number
        if (half !== 0) {
          inner = p
          outer = p.clone().addScaledVector(across, half * w)
          outer.y += w * 0.35
          uIn = 0.5
          uOut = half > 0 ? 1 : 0
        } else {
          inner = p.clone().addScaledVector(across, -w)
          outer = p.clone().addScaledVector(across, w)
          inner.y -= w * 0.12
          outer.y -= w * 0.12
          uIn = 0
          uOut = 1
        }
        for (const [v, u] of [[inner, uIn], [outer, uOut]] as const) {
          cp.push(v.x, v.y, v.z)
          cn.push(n.x, n.y, n.z)
          cuv.push(u, s)
          cc.push(tint.r, tint.g, tint.b)
        }
      }
      for (let k = 0; k < segs; k++) {
        const a = start + k * 2
        ci.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
      }
    }
  }
  const golden = Math.PI * (3 - Math.sqrt(5))
  const asym = spec.asym ?? 0
  const heavy = rand() * Math.PI * 2 // the side the crown favours
  for (let f = 0; f < fronds; f++) {
    // spiralled round the crown; young fronds (the last) upright in the centre, old ones spread and hanging
    const age = 1 - f / fronds
    const azimuth = f * golden * (lod === 2 ? 1.15 : 1) + rand() * 0.2
    const rise = THREE.MathUtils.lerp(1.25, -0.2, age ** 0.8) + (rand() - 0.5) * 0.2
    const length = spec.frond * (0.75 + 0.35 * Math.sin(Math.PI * (0.3 + age * 0.6))) * (0.9 + rand() * 0.2)
    const droop = spec.droop * (0.4 + age * 0.9)
    // a lopsided crown: fronds on the favoured side longer, a broken one missing on the other now and then
    const favour = Math.cos(azimuth - heavy)
    if (lod === 0 && favour < -0.3 && rand() < asym * 0.8) continue
    const tint = green.clone().multiplyScalar(0.85 + rand() * 0.3)
    // an old frond turning yellow here and there
    if (age > 0.85 && rand() < 0.25) tint.lerp(new THREE.Color(1.1, 0.95, 0.55), 0.6)
    const reach = length * (1 + asym * 0.35 * favour)
    addFrond(azimuth, rise, reach, droop, reach * 0.2 * widthScale, tint)
  }
  // dead fronds hanging against the trunk (LOD 0–1)
  if (lod < 2)
    for (let f = 0; f < spec.skirt * (lod === 0 ? 1 : 0.5); f++) {
      addFrond(f * golden * 1.7 + rand(), -1.25 - rand() * 0.2, spec.frond * 0.75, 0.1, spec.frond * 0.12 * widthScale, brown.clone().multiplyScalar(0.8 + rand() * 0.4))
    }
  const crown = new THREE.BufferGeometry()
  crown.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3))
  crown.setAttribute('normal', new THREE.Float32BufferAttribute(cn, 3))
  crown.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2))
  crown.setAttribute('color', new THREE.Float32BufferAttribute(cc, 3))
  crown.setIndex(ci)
  // coconuts: a cluster of small balls tucked under the crown (LOD 0 only), in the trunk's geometry (bark-free: dark)
  if (lod === 0 && spec.nuts > 0) {
    const parts: THREE.BufferGeometry[] = [trunk]
    for (let k = 0; k < spec.nuts; k++) {
      const a = (k / spec.nuts) * Math.PI * 2 + rand()
      const ball = new THREE.IcosahedronGeometry(spec.radius[1] * 1.25, 1)
      ball.deleteAttribute('uv')
      ball.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ball.attributes.position.count * 2), 2))
      ball.translate(top.x + Math.cos(a) * spec.radius[1] * 1.6, top.y - spec.radius[1] * (1.5 + rand() * 1.5), top.z + Math.sin(a) * spec.radius[1] * 1.6)
      parts.push(ball)
    }
    return { trunk: mergeSimple(parts), crown }
  }
  return { trunk, crown }
}

/** merge geometries with position/normal/uv, indexed or not */
function mergeSimple(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const flat = parts.map((g) => (g.index ? g.toNonIndexed() : g))
  const out = new THREE.BufferGeometry()
  for (const name of ['position', 'normal', 'uv']) {
    const size = flat[0].attributes[name].itemSize
    const total = flat.reduce((n, g) => n + g.attributes[name].count * size, 0)
    const data = new Float32Array(total)
    let o = 0
    for (const g of flat) {
      data.set(g.attributes[name].array as Float32Array, o)
      o += g.attributes[name].count * size
    }
    out.setAttribute(name, new THREE.BufferAttribute(data, size))
  }
  return out
}

export interface PalmSpot {
  x: number
  y: number
  z: number
  kind: PalmKind
  height: number
  /** yaw: which way the trunk leans */
  turn: number
  /** 0–1 colour variation */
  tone: number
}

export interface Palms {
  group: THREE.Group
  /** LOD 1–2 (the garage's floor mirror can skip them) */
  far: THREE.Object3D[]
  ready: Promise<void>
}

/** metres from the garage where a palm drops to the next level of detail */
const LOD = { near: 70, mid: 320 }

/** the palms' crown colour: olive to muted fresh greens (sRGB) — saturated greens read as plastic in the low sun */
function palmTint(tone: number, out: THREE.Color): THREE.Color {
  return out.setHSL(0.19 + tone * 0.07, 0.24 + tone * 0.12, 0.28 + tone * 0.08, THREE.SRGBColorSpace)
}

export function createPalms(spots: PalmSpot[], bark: PbrMaps): Palms {
  const t0 = performance.now()
  const frondMap = frondTexture()
  const frondMaterial = new THREE.MeshStandardMaterial({
    map: frondMap,
    vertexColors: true,
    alphaTest: 0.4,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    roughness: 0.7,
    envMapIntensity: OUTDOOR_SKY_LIGHT,
  })
  receiveFarShadow(frondMaterial)
  foliage(frondMaterial, { wind: 'tree', translucency: 0.35, coverage: true, crownNormals: true, matte: true })
  const trunkMaterial = new THREE.MeshStandardMaterial({ ...bark.maps, color: 0xb8ab98, roughness: 1, envMapIntensity: OUTDOOR_SKY_LIGHT })
  receiveFarShadow(trunkMaterial)
  foliage(trunkMaterial, { wind: 'tree' })

  const group = new THREE.Group()
  group.name = 'palms'
  const far: THREE.Object3D[] = []
  const kinds = Object.keys(PALMS) as PalmKind[]
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const col = new THREE.Color()
  let tris = 0
  // (a palm's variant from its position: stable however the list is ordered)
  const variantOf = (p: PalmSpot) => Math.floor((((Math.sin(p.x * 12.9898 + p.z * 78.233) * 43758.5453) % 1) + 1) % 1 * VARIANTS)
  for (const kind of kinds) {
    for (let v = 0; v < VARIANTS; v++) {
      for (const lod of [0, 1, 2] as const) {
        const list = spots.filter((p) => {
          if (p.kind !== kind || variantOf(p) !== v) return false
          const d = Math.hypot(p.x, p.z)
          return lod === 0 ? d < LOD.near : lod === 1 ? d >= LOD.near && d < LOD.mid : d >= LOD.mid
        })
        if (list.length === 0) continue
        const parts = buildPalm(variantSpec(kind, v), lod)
        const trunks = new THREE.InstancedMesh(parts.trunk, trunkMaterial, list.length)
        const crowns = new THREE.InstancedMesh(parts.crown, frondMaterial, list.length)
        list.forEach((p, i) => {
          q.setFromAxisAngle(up, p.turn)
          // (a slight squash per palm: crowns a little wider or narrower)
          const w = p.height * (0.92 + 0.16 * ((p.tone * 5.77) % 1))
          m.compose(new THREE.Vector3(p.x, p.y - 0.1, p.z), q, new THREE.Vector3(w, p.height, w))
          trunks.setMatrixAt(i, m)
          crowns.setMatrixAt(i, m)
          crowns.setColorAt(i, palmTint(p.tone, col))
        })
        for (const mesh of [trunks, crowns]) {
          mesh.castShadow = true
          mesh.receiveShadow = true
          mesh.computeBoundingSphere()
          mesh.name = `palms-${kind}-${v}-lod${lod}`
          group.add(noRaycast(mesh))
          if (lod > 0) far.push(mesh)
        }
        tris += ((parts.trunk.index ? parts.trunk.index.count : parts.trunk.attributes.position.count) / 3 + parts.crown.index!.count / 3) * list.length
      }
    }
  }
  console.info(`[garage] palms: ${spots.length}, ${(tris / 1e6).toFixed(2)} M triangles, ${Math.round(performance.now() - t0)} ms`)
  return { group, far, ready: bark.ready }
}
