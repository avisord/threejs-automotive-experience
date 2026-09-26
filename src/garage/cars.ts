import type * as THREE from 'three'
import type { PartId } from './configurator'

/** Picks meshes by material name and/or node name (the mesh or any ancestor inside the car). */
export interface PartMatch {
  material?: RegExp
  node?: RegExp
}

/** a material the export marks opaque (or fully transparent) that should read as tinted glass */
export interface GlassFix extends PartMatch {
  opacity: number
  color?: THREE.ColorRepresentation
}

/** which meshes are lamps; `auto` is split into front and rear by where they sit on the car */
export interface LampMatchers {
  front?: PartMatch
  rear?: PartMatch
  auto?: PartMatch
}

export interface CarProfile {
  id: string
  make: string
  model: string
  year: number
  /** short descriptor under the name on the card */
  tag: string
  /** file in public/models — optimised with gltf-transform, see car.ts */
  file: string
  /** yaw (radians) that puts the nose on +z */
  yaw?: number
  /** rescale to this overall length in metres; omit to trust the file */
  length?: number
  /** meshes to drop: shadow planes, motion-blur wheel doubles, damage variants */
  hide?: PartMatch[]
  glass?: GlassFix[]
  /** which meshes each configurator part repaints; parts left out don't show in the panel */
  parts: Partial<Record<PartId, PartMatch>>
  /** head and tail light meshes — they glow and carry real lights, see lights.ts */
  lamps?: LampMatchers
  /** body/wing factory style is a livery rather than plain paint */
  livery?: boolean
  credit?: string
}

export const CARS: CarProfile[] = [
  {
    id: 'gt3r-roxy',
    lamps: {
      front: { node: /^Glass-(HeadlightCover|HeadLightGlass|Headlight|HeadLightChrome)_\d+$/ },
      rear: { node: /^Glass-(TailLights|TailLightCover|RedLightBar|RainLight)_\d+$/ },
    },
    make: 'Porsche',
    model: '992 GT3 R',
    year: 2023,
    tag: 'Roxy livery',
    file: 'porsche-992-gt3r.glb',
    livery: true,
    parts: {
      body: { node: /^Body-Body_\d+$/ },
      wing: { node: /^Body-(Wing|EndPlates|GurneyFlap)_\d+$/ },
      rims: { node: /^Wheel-(LF|LR|RF|RR)_\d+$/ },
      calipers: { node: /^Wheel-Caliper-(LF|LR|RF|RR)_\d+$/ },
      cage: { node: /^Interior-RollCage_\d+$/ },
      glass: { node: /^Glass-(Glass|RearWindows)_\d+$/ },
    },
    credit: 'toddeppe · CC-BY-4.0',
  },
  {
    id: 'gt3rs',
    lamps: {
      front: { node: /^(headlight_[lr]|DRL|extralight_[12])(_\d+)?$/ },
      rear: { node: /^(brakelight_[lrm]|taillight_[lr]|DRRDL)(_\d+)?$/ },
    },
    make: 'Porsche',
    model: '992 GT3 RS',
    year: 2023,
    tag: 'Track-bred road car',
    file: 'porsche-992-gt3-rs.glb',
    yaw: Math.PI, // modelled nose-to −z
    // the side glass is exported OPAQUE with its alpha still set
    glass: [{ material: /^glasswindows2\.001$/, opacity: 0.35 }],
    parts: {
      // body and rims were several identical materials; dedup folded each into one
      body: { material: /^Material\.0(42|43|44|46|50)$/ },
      rims: { material: /^Material\.0(40|47|55|58)$/ },
      // the caliper material was deduped into a generic 'white' — go by node
      // (GLTFLoader suffixes repeated node names: hub_lf, hub_lf_1, …)
      calipers: { node: /^hub_(lf|lr|rf|rr)(_\d+)?$/ },
      glass: { material: /^glasswindows2(\.001)?$/ },
    },
  },
  {
    id: '930-turbo',
    lamps: { auto: { material: /^930_lights$/ } },
    make: 'Porsche',
    model: '911 Turbo (930)',
    year: 1975,
    tag: 'Classic widebody',
    file: 'porsche-930-turbo.glb',
    length: 4.29,
    hide: [{ material: /^material_0$/ }], // Sketchfab ground-shadow plane
    parts: {
      body: { material: /^paint$/ },
      rims: { material: /^930_rim$/ },
      glass: { material: /^glass$/ },
    },
    credit: 'Lionsharp Studios · CC-BY-4.0',
  },
  {
    id: 'sls',
    lamps: { front: { material: /^Lights_Front\./ }, rear: { material: /^Lights_Rear\./ } },
    make: 'Mercedes-Benz',
    model: 'SLS AMG',
    year: 2010,
    tag: 'Gullwing',
    file: 'mercedes-sls-amg.glb',
    // blurred-wheel doubles, a damaged-glass variant, and an opaque inner windscreen layer
    hide: [{ material: /^(Rim_Blurred_(Spokes|Solid)|DAMAGE_GLASS|INT_vetro)\./ }],
    glass: [
      { material: /^Glass_Windows\./, opacity: 0.3, color: 0x10141a },
      { material: /^Glass_Clear\./, opacity: 0.2 },
    ],
    parts: {
      body: { material: /^Carpaint\./ },
      rims: { material: /^Rim\.\d+$/ },
      calipers: { material: /^Brake_Caliper\./ },
      glass: { material: /^Glass_Windows\./ },
    },
  },
  {
    id: 'amg-one',
    lamps: { auto: { material: /^amgprojone_(headlight|runninglight|redglass)$/ } },
    make: 'Mercedes-AMG',
    model: 'ONE',
    year: 2022,
    tag: 'F1 hybrid hypercar',
    file: 'mercedes-amg-one.glb',
    length: 4.76,
    parts: {
      body: { material: /^amgprojone_paint$/ },
      // rims share a generic plastic material — pick them by node
      rims: { node: /_amgprojone_wheels_0$/ },
      glass: { material: /^amgprojone_clearglass2$/ },
    },
    credit: 'VTX · CC-BY-4.0',
  },
  {
    id: 'w201',
    lamps: { front: { material: /^HL_/ }, rear: { material: /^TL_/ } },
    make: 'Mercedes-Benz',
    model: '190E (W201)',
    year: 1982,
    tag: 'Baby Benz',
    file: 'mercedes-190e-w201.glb',
    hide: [{ material: /^EXT_Rim(_Emblem)?_Blur$/ }],
    glass: [{ material: /^EXT_Glass$/, opacity: 0.3 }],
    parts: {
      body: { material: /Car_Paint$/ },
      rims: { material: /^EXT_Rim$/ },
      calipers: { material: /^EXT_Calipers$/ },
      glass: { material: /^EXT_Glass$/ },
    },
  },
  {
    id: 'rx7',
    lamps: { front: { material: /LightA_Material|^light_glass$/ }, rear: { material: /^(red_glass|orange_light)$/ } },
    make: 'Mazda',
    model: 'RX-7 (FD)',
    year: 1993,
    tag: 'Versus Motorsport · 2 Fast 2 Furious',
    file: 'mazda-rx7-fd.glb',
    length: 4.3, // FBX came through in centimetres
    livery: true,
    glass: [
      { material: /WindowA_Material/, opacity: 0.3, color: 0x10141a },
      { material: /^light_glass$/, opacity: 0.35 },
      { material: /^(red_glass|orange_light)$/, opacity: 0.7 },
    ],
    parts: {
      body: { material: /PaintA_Material/ },
      rims: { material: /Wheel1A/ },
      calipers: { material: /CalliperA_Zone/ },
      glass: { material: /WindowA_Material/ },
    },
  },
]

export const DEFAULT_CAR = CARS[0].id

/** Collection entry for an empty bay — just the garage, no car */
export const NO_CAR = 'none'

export const carTitle = (c: CarProfile) => `${c.make} ${c.model}`

/** does this mesh fall under `m`? checks the material and the mesh's node chain up to the car root */
export function matches(m: PartMatch, mesh: THREE.Mesh, root: THREE.Object3D): boolean {
  const material = mesh.material as THREE.Material
  if (m.material && m.material.test(material.name)) return true
  if (m.node) {
    for (let o: THREE.Object3D | null = mesh; o && o !== root; o = o.parent) {
      if (m.node.test(o.name)) return true
    }
  }
  return false
}
