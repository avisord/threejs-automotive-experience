import * as THREE from 'three'
import { matches, type CarProfile, type PartMatch } from './cars'
import type { PartId } from './configurator'
import { findWheels } from './uploads'

/**
 * What each mesh of a vehicle is: its body, which bits make a wheel, glass,
 * lamps, interior… (Menu › Car › Part roles). Roles decide what the Car page
 * paints, which meshes are see-through, which glow and carry real lights, and
 * which are left out. Built-in cars have them curated in their `CarProfile`;
 * uploads get them guessed from names, materials and shape, and anyone can
 * override them — saved per car by mesh key.
 */
export type RoleId =
  | 'body'
  | 'aero'
  | 'rims'
  | 'tyres'
  | 'brakes'
  | 'glass'
  | 'headlights'
  | 'taillights'
  | 'interior'
  | 'other'
  | 'hidden'

export interface RoleDef {
  id: RoleId
  label: string
  /** tint in the 3D view while roles are shown */
  color: number
}

export const ROLES: RoleDef[] = [
  { id: 'body', label: 'Body', color: 0xff3fa4 },
  { id: 'aero', label: 'Wing / aero', color: 0x8e5cff },
  { id: 'rims', label: 'Rims', color: 0xffd400 },
  { id: 'tyres', label: 'Tyres', color: 0x6b7280 },
  { id: 'brakes', label: 'Brakes', color: 0xff5a1f },
  { id: 'glass', label: 'Glass', color: 0x35e0ff },
  { id: 'headlights', label: 'Headlights', color: 0xf4f5f7 },
  { id: 'taillights', label: 'Tail lights', color: 0xe0202a },
  { id: 'interior', label: 'Interior', color: 0x2bd67b },
  { id: 'other', label: 'Other parts', color: 0x1e6bff },
  { id: 'hidden', label: 'Hidden', color: 0x000000 },
]

/** mesh key → role; keys are the mesh's order in the file (`#0`, `#1`…), stable across loads */
export type RoleMap = Record<string, RoleId>

/** configurator part each role paints as */
const PART_OF: Partial<Record<RoleId, PartId>> = {
  body: 'body',
  aero: 'wing',
  rims: 'rims',
  tyres: 'tyres',
  brakes: 'calipers',
  glass: 'glass',
  interior: 'interior',
  other: 'trim',
}

export const partKey = (mesh: THREE.Object3D): string | undefined => mesh.userData.partKey

/** number a freshly loaded model's meshes, before anything is dropped */
export function keyMeshes(root: THREE.Object3D): void {
  let i = 0
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.userData.partKey = `#${i++}`
  })
}

const storageKey = (carId: string) => `garage.roles.v1.${carId}`

export function loadRoles(carId: string): RoleMap | null {
  try {
    return JSON.parse(localStorage.getItem(storageKey(carId)) ?? 'null') as RoleMap | null
  } catch {
    return null
  }
}

/** null forgets the override (built-ins go back to their curated setup, uploads to the guess) */
export function saveRoles(carId: string, roles: RoleMap | null): void {
  try {
    if (roles) localStorage.setItem(storageKey(carId), JSON.stringify(roles))
    else localStorage.removeItem(storageKey(carId))
  } catch {
    // not remembered — fine
  }
}

function keysOf(roles: RoleMap, role: RoleId): PartMatch | undefined {
  const keys = new Set(Object.keys(roles).filter((k) => roles[k] === role))
  return keys.size > 0 ? { keys } : undefined
}

/** the profile a car is dressed with once roles decide: paintable parts and lamps by mesh key */
export function profileWithRoles(profile: CarProfile, roles: RoleMap): CarProfile {
  const parts: CarProfile['parts'] = {}
  for (const [role, part] of Object.entries(PART_OF) as [RoleId, PartId][]) {
    const m = keysOf(roles, role)
    if (m) parts[part] = m
  }
  return { ...profile, parts, lamps: { front: keysOf(roles, 'headlights'), rear: keysOf(roles, 'taillights') } }
}

/**
 * Put roles into effect on a loaded model: hidden meshes leave (geometry and any
 * material nothing else wears are freed), glass that the export made opaque turns
 * see-through. Returns what was hidden, for the page to list.
 */
export function applyRoles(root: THREE.Object3D, roles: RoleMap, label: (m: THREE.Mesh) => string): HiddenPart[] {
  const hidden: THREE.Mesh[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const role = roles[partKey(mesh) ?? '']
    if (role === 'hidden') hidden.push(mesh)
    if (role !== 'glass') return
    const clear = (m: THREE.Material) => {
      if (m.transparent && m.opacity < 0.95) return m // already glass
      const c = m.clone()
      c.transparent = true
      c.depthWrite = false
      c.opacity = 0.3
      c.alphaTest = 0
      return c
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clear) : clear(mesh.material)
    mesh.castShadow = false
  })
  const out = hidden.map((m) => ({ key: partKey(m)!, label: label(m) }))
  const worn = new Set<THREE.Material>()
  for (const m of hidden) m.removeFromParent()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh) for (const m of [mesh.material].flat()) worn.add(m)
  })
  for (const mesh of hidden) {
    mesh.geometry.dispose()
    for (const m of [mesh.material].flat()) {
      if (worn.has(m)) continue
      for (const v of Object.values(m)) if ((v as THREE.Texture)?.isTexture) (v as THREE.Texture).dispose()
      m.dispose()
    }
  }
  return out
}

export interface HiddenPart {
  key: string
  label: string
}

// ─── guessing ────────────────────────────────────────────────────────────────
const NAMES: [RoleId, RegExp][] = [
  ['headlights', /head.?(light|lamp)|front.?(light|lamp)|headlamp|\bdrl\b|(^|[\s_.-])hl[\s_.\d-]|fog.?(light|lamp)/],
  ['taillights', /tail.?(light|lamp)|rear.?(light|lamp)|brake.?(light|lamp)|stop.?(light|lamp)|(^|[\s_.-])tl[\s_.\d-]|reverse.?(light|lamp)/],
  ['glass', /glass|window|windscreen|windshield|vetro|scheibe|visor/],
  ['tyres', /tyre|tire|rubber|reifen/],
  ['brakes', /brake|caliper|calliper|rotor|disc(?!o)/],
  ['rims', /\brim|wheel|spoke|hub\b|felge/],
  ['interior', /interior|seat|dash|steer|cockpit|carpet|pedal|belt|gauge|console|(^|[\s_.-])int[\s_.-]|inside|headliner|door.?card/],
  ['aero', /wing|spoiler|diffuser|splitter|canard|endplate/],
  ['body', /body|paint|carpaint|shell|door|hood|bonnet|fender|bumper|roof|trunk|boot|panel|quarter|fairing|tank/],
]
const LAMPISH = /light|lamp|lens|indicator|blinker/

/**
 * Roles for every mesh of a model in car space (nose +z, on the floor). The
 * profile's own matchers win (built-ins), then names, then materials and
 * shape: meshes inside a found wheel are rims/tyres/brakes, lamps and glowing
 * lenses split by which end they're at, and with no body named, the biggest
 * opaque surface (and whatever wears its material) is the body.
 */
export function suggestRoles(root: THREE.Object3D, profile: CarProfile): RoleMap {
  const roles: RoleMap = {}
  root.updateMatrixWorld(true)
  const meshes: THREE.Mesh[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && !mesh.userData.overlay && partKey(mesh)) meshes.push(mesh)
  })
  const bounds = new THREE.Box3().setFromObject(root, true)
  const wheels = findWheels(root, bounds)
  const box = new THREE.Box3()
  const centre = new THREE.Vector3()
  const size = new THREE.Vector3()

  const fromProfile: [PartMatch | undefined, RoleId][] = [
    [profile.parts.body, 'body'],
    [profile.parts.wing, 'aero'],
    [profile.parts.rims, 'rims'],
    [profile.parts.calipers, 'brakes'],
    [profile.parts.cage, 'interior'],
    [profile.parts.glass, 'glass'],
    [profile.lamps?.front, 'headlights'],
    [profile.lamps?.rear, 'taillights'],
  ]

  for (const mesh of meshes) {
    const key = partKey(mesh)!
    box.setFromObject(mesh, true).getCenter(centre)
    box.getSize(size)
    const material = [mesh.material].flat()[0] as THREE.MeshStandardMaterial
    const endRole = (): RoleId => (centre.z >= 0 ? 'headlights' : 'taillights')

    const curated = fromProfile.find(([m]) => m && matches(m, mesh, root))
    if (curated) {
      roles[key] = curated[1]
      continue
    }
    if (profile.lamps?.auto && matches(profile.lamps.auto, mesh, root)) {
      roles[key] = endRole()
      continue
    }

    const label = `${mesh.name} ${mesh.parent?.name ?? ''} ${material?.name ?? ''}`.toLowerCase()
    let role = NAMES.find(([, re]) => re.test(label))?.[0]
    if (!role && LAMPISH.test(label)) role = endRole()
    // a lens that glows is a lamp, whatever it's called
    if (!role && material?.emissive && material.emissive.r + material.emissive.g + material.emissive.b > 0.6 && Math.max(size.x, size.y, size.z) < 0.6 * bounds.getSize(new THREE.Vector3()).x) role = endRole()
    if (!role && material?.transparent && material.opacity < 0.95) role = 'glass'
    // inside a wheel: dark and matte is the tyre, the rest the rim
    const wheel = wheels.find((w) => w.centre.distanceTo(centre) < 0.45 * w.diameter && Math.max(size.x, size.y, size.z) < 1.15 * w.diameter)
    if (wheel && (!role || role === 'body' || role === 'other')) {
      const c = material?.color
      const dark = c && !material.map && c.r + c.g + c.b < 0.25 && (material.roughness ?? 1) > 0.5
      role = dark ? 'tyres' : 'rims'
    }
    roles[key] = role ?? 'other'
  }

  // no body named: the largest opaque surface, and everything wearing its material
  if (!Object.values(roles).includes('body')) {
    let best: THREE.Mesh | null = null
    let bestArea = 0
    for (const mesh of meshes) {
      if (roles[partKey(mesh)!] !== 'other') continue
      const material = [mesh.material].flat()[0]
      if (material.transparent) continue
      box.setFromObject(mesh, true).getSize(size)
      const area = size.x * size.y + size.y * size.z + size.x * size.z
      if (area > bestArea) {
        bestArea = area
        best = mesh
      }
    }
    if (best) {
      const paint = [best.material].flat()[0]
      for (const mesh of meshes) {
        if (roles[partKey(mesh)!] === 'other' && [mesh.material].flat()[0] === paint) roles[partKey(mesh)!] = 'body'
      }
    }
  }
  return roles
}

// ─── showing roles in the view ───────────────────────────────────────────────
/** role colours over the meshes, drawn like the Parts page's highlights */
export interface RoleTint {
  set(roles: Map<THREE.Mesh, RoleId> | null): void
  dispose(): void
}

export function createRoleTint(): RoleTint {
  const materials = new Map<RoleId, THREE.MeshBasicMaterial>()
  const overlays = new Map<THREE.Mesh, THREE.Mesh>()
  const material = (role: RoleId) => {
    let m = materials.get(role)
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color: ROLES.find((r) => r.id === role)!.color,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      })
      materials.set(role, m)
    }
    return m
  }
  const clear = () => {
    for (const o of overlays.values()) o.removeFromParent()
    overlays.clear()
  }
  return {
    set(roles) {
      clear()
      for (const [mesh, role] of roles ?? []) {
        if (role === 'hidden') continue
        const o = new THREE.Mesh(mesh.geometry, material(role))
        o.name = `${mesh.name}-role`
        o.renderOrder = 8
        o.raycast = () => {}
        o.userData.overlay = true
        mesh.add(o)
        overlays.set(mesh, o)
      }
    },
    dispose() {
      clear()
      for (const m of materials.values()) m.dispose()
    },
  }
}
