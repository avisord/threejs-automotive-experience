import * as THREE from 'three'
import { Reflector } from 'three/examples/jsm/objects/Reflector.js'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { SURFACES, box, boxUV, disposeTree, pbrMaps, type GarageDef, type Room } from './kit'
import { createGlassMaterial, glassPane } from './glass'
import { GROUND } from './coast/site'
import { createCoastWorld } from './coast/world'

/** the terrace the car stands on (x × z), its front edge toward the cove (−z) */
const DECK = { w: 16, front: -7, back: 5.5 }
/** the glass balustrade along the front and sides */
const RAIL = { h: 1.05, bay: 2 }

/**
 * Honed limestone laid in slabs, per pixel: running-bond joints (a fine
 * groove with its arrises catching light, grime settled along it), each slab
 * its own shade, warmth and polish and its own piece of the photographed
 * surface (so the photo doesn't repeat slab to slab), faint weathering
 * blotches and pits, grime along the balustrade's shoe and round the foot of
 * the walls where rain splashes soil up. `deck`: the terrace's top, in metres.
 */
function terraceStone(material: THREE.MeshStandardMaterial, deck: { x0: number; x1: number; z0: number; z1: number }): THREE.MeshStandardMaterial {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStone;\nvarying vec3 vStoneN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvStone = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\nvStoneN = normalize( mat3( modelMatrix ) * objectNormal );')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vStone;
        varying vec3 vStoneN;
        float stHash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
        float stNoise( vec2 p ) {
          vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
          return mix( mix( stHash( i ), stHash( i + vec2( 1, 0 ) ), u.x ), mix( stHash( i + vec2( 0, 1 ) ), stHash( i + 1.0 ), u.x ), u.y );
        }
        // slabs 1.8 × 0.9 m in running bond: the slab's id, and the distance (m) to its nearest joint
        const vec2 SLAB = vec2( 1.8, 0.9 );
        vec3 stSlab( vec2 p ) {
          float row = floor( p.y / SLAB.y );
          vec2 q = vec2( p.x / SLAB.x + 0.5 * mod( row, 2.0 ), p.y / SLAB.y );
          vec2 id = floor( q );
          vec2 f = fract( q ) - 0.5;
          vec2 e = ( 0.5 - abs( f ) ) * SLAB;
          return vec3( id, min( e.x, e.y ) );
        }
        float stTop; vec3 stId; float stGrime; float stJoint;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
        stTop = smoothstep( 0.6, 0.9, vStoneN.y );
        stId = stSlab( vStone.xz );
        // each slab its own piece of the photo, turned and shifted (the top only: the sides keep their uvs)
        float stH = stHash( stId.xy + 3.1 );
        vec2 stUv = vMapUv;
        if ( stTop > 0.5 ) stUv = ( stH > 0.5 ? vMapUv.yx : vMapUv ) + vec2( stHash( stId.xy + 1.7 ), stHash( stId.xy + 9.2 ) ) * 3.0;
        #define vMapUv stUv
        #define vNormalMapUv stUv
        #define vRoughnessMapUv stUv`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 p = vStone;
          float px = max( length( fwidth( p.xz ) ), 1e-4 );
          // the joint: a 4 mm groove, and grime settled a finger's width either side
          // (box-filtered: a groove narrower than the pixel fades to its average instead of breaking into dashes)
          stJoint = ( 1.0 - smoothstep( 0.0, 0.002 + px, stId.z ) ) * min( 1.0, 0.005 / px ) * stTop;
          float margin = ( 1.0 - smoothstep( 0.0, 0.03 + px, stId.z ) ) * stTop;
          // the slab's own shade, warmth and a slow mottle across it
          float h = stHash( stId.xy );
          vec3 tint = mix( vec3( 1.0 ), vec3( 1.03, 1.0, 0.95 ), stHash( stId.xy + 5.3 ) ) * ( 0.95 + 0.07 * h );
          diffuseColor.rgb *= mix( vec3( 1.0 ), tint, stTop );
          diffuseColor.rgb *= 0.94 + 0.12 * stNoise( p.xz * 0.9 + p.y );
          // weathering: faint water stains and a few pits
          float stain = smoothstep( 0.55, 0.8, stNoise( p.xz * 0.35 + 7.0 ) * 0.6 + stNoise( p.xz * 2.3 ) * 0.4 );
          diffuseColor.rgb *= 1.0 - 0.1 * stain;
          float pit = step( 0.985, stHash( floor( p.xz * 40.0 ) ) ) * ( 1.0 - smoothstep( 0.02, 0.05, px ) ) * stTop;
          diffuseColor.rgb *= 1.0 - 0.35 * pit;
          // grime: along the balustrade's shoe (front and sides), and up the terrace's walls from the soil
          float edge = min( min( p.x - ${deck.x0.toFixed(2)}, ${deck.x1.toFixed(2)} - p.x ), p.z - ${deck.z0.toFixed(2)} );
          stGrime = ( 1.0 - smoothstep( 0.12, 0.6, edge ) ) * stTop * ( 0.6 + 0.4 * stNoise( p.xz * 3.0 ) );
          float foot = ( 1.0 - smoothstep( ${GROUND.toFixed(2)}, ${(GROUND + 0.35).toFixed(2)}, p.y ) ) * ( 1.0 - stTop );
          stGrime = max( stGrime, foot * ( 0.7 + 0.3 * stNoise( vec2( p.x + p.z, p.y ) * 6.0 ) ) );
          diffuseColor.rgb *= 1.0 - 0.28 * stGrime - 0.12 * margin;
          diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * 0.35, stJoint );
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // honed, not polished: each slab its own polish, duller in the grime and the joints
        roughnessFactor = clamp( roughnessFactor * ( 0.85 + 0.3 * stHash( stId.xy + 2.2 ) * stTop ) + 0.2 * stGrime + 0.4 * stJoint, 0.05, 1.0 );`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        {
          // the joint's arrises: the surface rolls down into the groove (a lit edge on one side, a dark one on the other)
          vec2 g = vec2( dFdx( stId.z ), dFdy( stId.z ) );
          float lip = ( 1.0 - smoothstep( 0.0, 0.006, stId.z ) ) * stTop * ( 1.0 - smoothstep( 0.002, 0.006, length( fwidth( vStone.xz ) ) ) );
          if ( lip > 0.0 ) {
            vec3 dpx = dFdx( vStone ); vec3 dpy = dFdy( vStone );
            // world direction toward the joint, from the screen-space gradient of the distance to it
            vec3 toward = -normalize( dpx * g.x + dpy * g.y + 1e-6 );
            normal = normalize( mix( normal, normalize( ( viewMatrix * vec4( normalize( vec3( 0.0, 1.0, 0.0 ) + toward * 0.8 ), 0.0 ) ).xyz ), lip * 0.7 ) );
          }
        }`,
      )
  }
  material.customProgramCacheKey = () => 'terrace-stone'
  return material
}

/**
 * The Coast House's site with no house: the car stands out in the open on a
 * pale stone viewing terrace on the clifftop lawn, a frameless glass
 * balustrade along its edge, the palms and the garden round it, and the cove,
 * the sea and the mountains beyond — the same world (coast/world.ts), sun and
 * air as the Coast House.
 */
function createCoastOverlook(): Room {
  const group = new THREE.Group()
  group.name = 'coast-overlook'
  const world = createCoastWorld(group, {
    planter: false,
    // the terrace and its steps stand on the lawn: the grass darkens along their feet
    footprints: [
      [-DECK.w / 2, DECK.front, DECK.w / 2, DECK.back],
      [-3, DECK.back, 3, DECK.back + 1.2],
    ],
  })

  // ─── the terrace: honed limestone slabs on a plinth, steps down to the lawn behind ─
  const stoneMaps = pbrMaps(SURFACES.concreteFloor)
  // (the photographed concrete is dark, ~0.085: lifted to a pale sun-bleached stone — a touch less than
  // white, so the sun on it rolls off instead of clipping)
  const stone = terraceStone(
    new THREE.MeshStandardMaterial({ ...stoneMaps.maps, color: new THREE.Color().setRGB(2.45, 2.3, 2.08), roughness: 0.62 }),
    { x0: -DECK.w / 2, x1: DECK.w / 2, z0: DECK.front, z1: DECK.back },
  )
  const steel = new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.4, metalness: 0.8 })
  const d = DECK.back - DECK.front
  const cz = (DECK.back + DECK.front) / 2
  // (every hard edge eased a little: a real stone arris is never razor sharp, and the bevel catches the sun)
  const slab = (size: [number, number, number], at: [number, number, number]) => {
    const mesh = new THREE.Mesh(new RoundedBoxGeometry(...size, 2, 0.018), stone)
    mesh.position.set(...at)
    group.add(mesh)
    boxUV(mesh.geometry, SURFACES.concreteFloor.tile)
    mesh.castShadow = true
    mesh.receiveShadow = true
    return mesh
  }
  // (its top a hair under y = 0, where the car's wheels and contact shadow sit)
  const depth = -GROUND + 0.6
  slab([DECK.w, depth, d], [0, -0.005 - depth / 2, cz])
  // three steps down to the lawn behind, each a quarter of the rise
  for (let i = 0; i < 3; i++) {
    const top = (GROUND * (i + 1)) / 4
    const h = top - GROUND + 0.05
    slab([6, h, 0.4], [0, top - h / 2, DECK.back + 0.2 + i * 0.4])
  }
  // (the slab joints are drawn by the stone's shader: terraceStone)

  // ─── the balustrade: frameless glass panes in a steel shoe, front and sides ─
  const glass = createGlassMaterial({ dirt: 0.3, absorption: 0.05 })
  let seed = 31
  const run = (a: THREE.Vector2, b: THREE.Vector2) => {
    const length = a.distanceTo(b)
    const bays = Math.max(1, Math.round(length / RAIL.bay))
    const turn = Math.atan2(-(b.y - a.y), b.x - a.x)
    for (let i = 0; i < bays; i++) {
      const holder = new THREE.Object3D()
      const t = (i + 0.5) / bays
      holder.position.set(a.x + (b.x - a.x) * t, RAIL.h / 2 + 0.06, a.y + (b.y - a.y) * t)
      holder.rotation.y = turn
      holder.add(glassPane(glass, length / bays - 0.02, RAIL.h, seed++))
      group.add(holder)
    }
    const shoe = box(group, [length, 0.08, 0.1], steel, [(a.x + b.x) / 2, 0.04, (a.y + b.y) / 2])
    shoe.rotation.y = turn
    shoe.castShadow = true
  }
  const e = 0.12
  run(new THREE.Vector2(-DECK.w / 2 + e, DECK.front + e), new THREE.Vector2(DECK.w / 2 - e, DECK.front + e))
  run(new THREE.Vector2(-DECK.w / 2 + e, DECK.front + e), new THREE.Vector2(-DECK.w / 2 + e, DECK.back - e))
  run(new THREE.Vector2(DECK.w / 2 - e, DECK.front + e), new THREE.Vector2(DECK.w / 2 - e, DECK.back - e))

  // no floor mirror out here (a honed stone terrace): a stand-in the app's bookkeeping can hold, never drawn
  const reflector = new Reflector(new THREE.PlaneGeometry(0.01, 0.01), { textureWidth: 1, textureHeight: 1 })
  reflector.visible = false
  group.add(reflector)

  return {
    group,
    reflector,
    floorLayers: [],
    // out in the open: round the car, above the terrace — and out over the drop in front
    bounds: new THREE.Box3(new THREE.Vector3(-24, 0.4, -40), new THREE.Vector3(24, 16, 24)),
    background: new THREE.Color(0x9fb8d6), // only until the sky is in
    environmentIntensity: 1,
    resize: () => {},
    setReflectionScale: () => {},
    update: world.update,
    ready: Promise.all([world.ready, stoneMaps.ready]).then(() => {}),
    dispose: () => {
      disposeTree(group)
      for (const t of world.textures) t.dispose()
    },
    ...world.hooks,
    depthOfField: { bokehScale: 0.7 },
  }
}

export const coastOverlook: GarageDef = {
  id: 'coast-overlook',
  name: 'Coast Overlook',
  tag: 'Out in the open on a clifftop terrace above the tropical cove, no walls between the car and the sunset',
  palette: ['#1d4f7a', '#3fb2b0', '#f2c38b', '#e8dcc8'],
  look: 'golden',
  create: createCoastOverlook,
}
