import * as THREE from 'three'
import { fbm, noRaycast, seeded, smoothstep } from './landform'
import { SITE, forestDensity, heightAt, lakeShape, onRoad, roadZ } from './site'
import { outdoorMaterial } from './terrain'

/**
 * The lakeside towns, as around Kawaguchiko: houses packed along the near
 * shore below the pavilion and strung along the far shore, thinning up the
 * slopes, with a few hotels by the water. At a kilometre or three a house is
 * a few pixels — a pale wall, a dark roof — so they're boxes and hipped roofs,
 * instanced; what sells a town is how many there are and how they cluster.
 */

interface House {
  x: number
  z: number
  w: number
  d: number
  h: number
  turn: number
  /** a hotel or apartment block rather than a house */
  block: boolean
}

/** town centres: [x, z, radius, how many houses to try] — near shore, far shore, the shores to the sides */
const CENTRES: [number, number, number, number][] = [
  [-700, -1000, 520, 520],
  [350, -960, 420, 380],
  [1350, -1180, 380, 220],
  [-1600, -1450, 380, 160],
  [-500, -2950, 700, 420],
  [900, -2900, 520, 300],
  [1900, -2250, 360, 140],
]

/** is this a place a house could stand? */
function buildable(x: number, z: number): boolean {
  const r = Math.hypot(x, z)
  if (r < 300 || r > SITE.realRadius - 60) return false
  const lake = lakeShape(x, z)
  if (lake < 1.04) return false // not in the water
  if (onRoad(x, z) > 0 || Math.abs(z - roadZ(x)) < 14) return false
  if (forestDensity(x, z) > 0.15) return false // clearings: not under the canopy
  // not on steep ground
  const e = 6
  const slope = Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e)
  return slope < 0.3
}

function placeHouses(): House[] {
  const rand = seeded(83)
  const houses: House[] = []
  // a coarse grid of what's taken, so spacing checks stay cheap with ~2,000 houses
  const CELL = 20
  const taken = new Map<string, House[]>()
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`
  const crowded = (x: number, z: number, gap: number) => {
    const cx = Math.floor(x / CELL)
    const cz = Math.floor(z / CELL)
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) for (const o of taken.get(`${cx + i},${cz + j}`) ?? []) if (Math.hypot(o.x - x, o.z - z) < gap) return true
    return false
  }
  for (const [cx, cz, radius, tries] of CENTRES) {
    // each town's streets run one way, bent a little across it
    const grain = rand() * Math.PI
    for (let t = 0; t < tries * 3 && tries > 0; t++) {
      // denser toward the centre and toward the water
      const a = rand() * Math.PI * 2
      const r = radius * Math.sqrt(rand()) * (0.6 + 0.4 * rand())
      const x = cx + Math.cos(a) * r
      const z = cz + Math.sin(a) * r * 0.7
      const shore = 1 - smoothstep(lakeShape(x, z), 1.05, 1.5)
      if (rand() > 0.35 + 0.65 * shore * (1 - (r / radius) * 0.6)) continue
      // patchy: fields and gardens between neighbourhoods
      if (fbm(x / 90 + 13, z / 90 - 2, 2) < 0.42) continue
      if (!buildable(x, z)) continue
      const block = shore > 0.75 && rand() < 0.05
      const gap = block ? 30 : 13
      if (crowded(x, z, gap)) continue
      const house: House = {
        x,
        z,
        w: block ? 18 + rand() * 20 : 7 + rand() * 5,
        d: block ? 12 + rand() * 8 : 6 + rand() * 4,
        h: block ? 13 + Math.floor(rand() * 6) * 3 : rand() < 0.55 ? 6.2 : 3.4, // two storeys or one; hotels 4–9 floors
        turn: grain + 0.3 * (fbm(x / 400, z / 400, 2) - 0.5) + (rand() < 0.3 ? Math.PI / 2 : 0),
        block,
      }
      houses.push(house)
      const k = key(x, z)
      taken.set(k, [...(taken.get(k) ?? []), house])
    }
  }
  // farmhouses along the road, both sides of the valley, each with a barn or shed beside it
  for (let i = 0, n = 0; i < 60 && n < 16; i++) {
    const x = (rand() < 0.5 ? -1 : 1) * (380 + rand() * 1100)
    const z = roadZ(x) - 40 - rand() * 160
    if (!buildable(x, z) || crowded(x, z, 40)) continue
    const turn = rand() * Math.PI
    const house: House = { x, z, w: 10 + rand() * 4, d: 7 + rand() * 3, h: 6.2, turn, block: false }
    const bx = x + Math.cos(turn) * 16
    const bz = z - Math.sin(turn) * 16
    houses.push(house)
    if (buildable(bx, bz)) houses.push({ x: bx, z: bz, w: 8 + rand() * 6, d: 6 + rand() * 3, h: 3.4, turn, block: false })
    taken.set(key(x, z), [...(taken.get(key(x, z)) ?? []), house])
    n++
  }
  return houses
}

/**
 * Windows on the walls, drawn by the shader in metres of the building itself
 * (the instance's scale undoes the unit box): a row per 3 m floor, dark glass
 * that mirrors the sky, a few lit warm at dusk. Houses get separate windows,
 * blocks (anything over 10 m) balcony slabs and ribbon glazing. Where a
 * window gets smaller than a couple of pixels the pattern fades to its
 * average, so distant towns don't shimmer.
 */
function facadeMaterial(): { material: THREE.MeshStandardMaterial; evening: { value: number } } {
  const material = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }))
  const evening = { value: 0 }
  const base = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    base.call(material, shader, renderer)
    shader.uniforms.uEvening = evening
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vFacade;
        varying vec3 vFaceNormal;
        varying float vHeight;
        flat varying float vSeed;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec3 bScale = vec3( length( instanceMatrix[ 0 ].xyz ), length( instanceMatrix[ 1 ].xyz ), length( instanceMatrix[ 2 ].xyz ) );
        vFacade = position * bScale;
        vHeight = bScale.y;
        vFaceNormal = normal;
        vSeed = float( gl_InstanceID );`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uEvening;
        varying vec3 vFacade;
        varying vec3 vFaceNormal;
        varying float vHeight;
        flat varying float vSeed;
        float cellHash( vec3 p ) { return fract( sin( dot( p, vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 ); }
        // a box pulse (1 inside [lo, hi] of each period), antialiased over one pixel's footprint
        float pulse( float x, float period, float lo, float hi ) {
          float f = fract( x / period ) * period;
          float w = max( fwidth( x ), 1e-4 );
          return clamp( ( min( f - lo, hi - f ) ) / w + 0.5, 0.0, 1.0 );
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float facadeWin = 0.0;
        float facadeLit = 0.0;
        if ( abs( vFaceNormal.y ) < 0.5 ) {
          float u = abs( vFaceNormal.x ) > 0.5 ? vFacade.z : vFacade.x;
          float y = vFacade.y - 1.2; // the body runs 1.2 m into the ground
          bool block = vHeight > 11.0;
          float floorH = 3.0;
          float level = floor( y / floorH );
          float bay = block ? 4.0 : 3.2;
          // houses: a window 1.3 m wide every 3.2 m, sill 0.9 m, head 2.2 m; blocks: ribbon glazing
          // under a pale balcony slab on every floor
          float across = block ? pulse( u, bay, 0.3, 3.7 ) : pulse( u + 0.4, bay, 0.9, 2.2 );
          float up = block ? pulse( y, floorH, 0.7, 2.6 ) : pulse( y, floorH, 0.9, 2.2 );
          float slab = block ? pulse( y, floorH, 0.0, 0.3 ) * step( floorH, y ) : 0.0;
          float inside = step( 0.0, y ) * step( y, vHeight - 1.2 - ( block ? 1.0 : 0.6 ) );
          facadeWin = across * up * inside;
          // the average a far-off wall fades to, so a town a few km off holds still
          float fade = smoothstep( 0.35, 0.8, max( fwidth( u ), fwidth( y ) ) );
          facadeWin = mix( facadeWin, ( block ? 0.55 : 0.22 ) * inside, fade );
          slab *= 1.0 - fade;
          // a few rooms lit, one hash per window
          float cell = cellHash( vec3( floor( ( u + 0.4 ) / bay ), level, vSeed ) );
          facadeLit = step( 0.8, cell ) * facadeWin;
          diffuseColor.rgb *= 1.0 + 0.25 * slab;
        }
        diffuseColor.rgb *= mix( 1.0, 0.1, facadeWin );`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix( roughnessFactor, 0.12, facadeWin );`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vec3( 1.0, 0.62, 0.3 ) * 0.6 * facadeLit * uEvening;`,
      )
  }
  material.customProgramCacheKey = () => 'town-facade'
  return { material, evening }
}

/** a gable roof, 1 × 1 × 1 on the origin: a ridge along x, eaves overhanging the walls */
function gableRoof(): THREE.BufferGeometry {
  const w = 0.56 // half-width with the overhang
  const d = 0.6
  const shape = new THREE.Shape([new THREE.Vector2(-d, 0), new THREE.Vector2(d, 0), new THREE.Vector2(0, 1)])
  const g = new THREE.ExtrudeGeometry(shape, { depth: 2 * w, bevelEnabled: false })
  g.rotateY(Math.PI / 2)
  g.translate(-w, 0, 0)
  return g
}

export function createTown(): { group: THREE.Group; setEvening(amount: number): void } {
  const houses = placeHouses()
  const facade = facadeMaterial()
  // matte tiles: sun glints on roofs a pixel or two across made the towns sparkle as the camera moved
  const tiles = outdoorMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }))
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), facade.material, houses.length)
  // houses get a gable or a hipped roof (overhanging the walls); blocks a flat roof — the body's own top
  const roofed = houses.filter((h) => !h.block)
  const gables = roofed.filter((_, i) => i % 5 < 3)
  const hips = roofed.filter((_, i) => i % 5 >= 3)
  const gable = new THREE.InstancedMesh(gableRoof(), tiles, gables.length)
  const hip = new THREE.InstancedMesh(
    new THREE.ConeGeometry(Math.SQRT1_2 * 1.15, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0),
    tiles,
    hips.length,
  )
  const srgb = (hex: number) => new THREE.Color().setHex(hex, THREE.SRGBColorSpace)
  const wallColors = [0xece6da, 0xdcd6cc, 0xf3f0ea, 0xcdbfa8, 0xb9b3aa, 0xe2d9c5, 0x9a8f80, 0xd8cbb2].map(srgb)
  const blockColors = [0xe9e6df, 0xd0cbc2, 0xbfc3c6, 0xd9d2c4].map(srgb)
  // kawara grey-black, blue-grey, red-brown and green-painted metal
  const roofColors = [0x2e3136, 0x3a4250, 0x262a30, 0x55463c, 0x6a3f33, 0x3e5a6a, 0x3f5a48].map(srgb)
  const rand = seeded(91)
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const up = new THREE.Vector3(0, 1, 0)
  const top = new Map<House, number>()
  houses.forEach((s, i) => {
    // sunk a little so a house on a slope has no gap under its downhill side
    const y = heightAt(s.x, s.z) - 1.2
    top.set(s, y + s.h + 1.2)
    q.setFromAxisAngle(up, s.turn)
    body.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, y, s.z), q, new THREE.Vector3(s.w, s.h + 1.2, s.d)))
    const colors = s.block ? blockColors : wallColors
    body.setColorAt(i, colors[Math.floor(rand() * colors.length)])
  })
  const roofOn = (mesh: THREE.InstancedMesh, list: House[], pitch: number) =>
    list.forEach((s, i) => {
      q.setFromAxisAngle(up, s.turn)
      // ridge along the longer side
      const long = s.w >= s.d
      if (!long) q.multiply(new THREE.Quaternion().setFromAxisAngle(up, Math.PI / 2))
      const [a, b] = long ? [s.w, s.d] : [s.d, s.w]
      mesh.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, top.get(s)!, s.z), q, new THREE.Vector3(a, b * pitch * (0.8 + 0.4 * rand()), b)))
      mesh.setColorAt(i, roofColors[Math.floor(rand() * roofColors.length)])
    })
  roofOn(gable, gables, 0.45)
  roofOn(hip, hips, 0.38)
  const group = new THREE.Group()
  group.name = 'town'
  for (const o of [body, gable, hip]) {
    o.castShadow = true
    o.receiveShadow = true
    o.computeBoundingSphere()
    group.add(noRaycast(o))
  }
  console.info(`[garage] town: ${houses.length} buildings`)
  return {
    group,
    setEvening(amount) {
      facade.evening.value = amount
    },
  }
}
