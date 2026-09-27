import * as THREE from 'three'
import type { CarProfile } from './cars'

/**
 * The user's own models, kept in IndexedDB (they're tens of MB — too big for
 * localStorage) with the setup that orients and sizes them. Each becomes a
 * `CarProfile` with an `open` loader, so the bay treats it like a built-in car.
 */

export type VehicleKind = 'car' | 'bike'

export interface UploadSetup {
  kind: VehicleKind
  /** quarter turns about the vertical, applied last (nose → +z) */
  yaw: number
  /** quarter turns about x / z, applied first — stands a Z-up or sideways export upright */
  pitch: number
  roll: number
  /** overall length in metres; null = keep the file's size when it's plausible, else a typical one */
  length: number | null
}

export interface UploadFile {
  /** path inside the upload (a zip's folders kept), '/'-separated */
  name: string
  blob: Blob
}

export interface UploadRecord {
  id: string
  name: string
  created: number
  /** the model file among `files`; the others are what it references (bin, textures, mtl) */
  main: string
  files: UploadFile[]
  setup: UploadSetup
  /** the setup worked out at import, for going back to it */
  guess: UploadSetup
}

export const MODEL_EXTENSIONS = ['glb', 'gltf', 'fbx', 'obj', 'dae', '3ds', 'usdz'] as const
export const ACCEPT = [...MODEL_EXTENSIONS, 'zip', 'bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp', 'ktx2', 'tga', 'bmp']
  .map((e) => `.${e}`)
  .join(',')

/** a length outside this range is a unit mix-up (cm, mm, inches) rather than the vehicle's size */
const PLAUSIBLE: Record<VehicleKind, { min: number; max: number; typical: number }> = {
  car: { min: 2.4, max: 7.5, typical: 4.5 },
  bike: { min: 1.2, max: 3.4, typical: 2.1 },
}

export const extension = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()
export const uploadBytes = (r: UploadRecord) => r.files.reduce((n, f) => n + f.blob.size, 0)
export function formatBytes(n: number): string {
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} kB`
  return n < 1e7 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e6)} MB`
}
export const isUpload = (id: string) => id.startsWith('up-')

// ─── IndexedDB ───────────────────────────────────────────────────────────────
const DB = 'garage-uploads'
const STORE = 'models'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDB()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

/** every upload, oldest first — blobs are handles, reading the list doesn't pull the bytes in */
const records = new Map<string, UploadRecord>()

export async function loadUploads(): Promise<void> {
  try {
    const all = await tx('readonly', (s) => s.getAll() as IDBRequest<UploadRecord[]>)
    records.clear()
    for (const r of all.sort((a, b) => a.created - b.created)) records.set(r.id, r)
  } catch (err) {
    console.warn('[garage] uploads unavailable', err)
  }
}

export const uploads = (): UploadRecord[] => [...records.values()]
export const getUpload = (id: string) => records.get(id)

/** kept in memory first: if the browser refuses the bytes (quota), it still shows this session */
export async function saveUpload(record: UploadRecord): Promise<void> {
  records.set(record.id, record)
  await tx('readwrite', (s) => s.put(record))
}

export async function deleteUpload(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
  records.delete(id)
  // the per-car settings saved under its id go with it
  try {
    for (const key of Object.keys(localStorage)) if (key.endsWith(`.${id}`)) localStorage.removeItem(key)
  } catch {
    // no storage — nothing saved
  }
}

// ─── importing ───────────────────────────────────────────────────────────────
/** unpack zips, keep folders, and pick the model file (glb over gltf over fbx…, then the shallowest) */
export async function collectFiles(input: { file: File; path: string }[]): Promise<{ files: UploadFile[]; main: string }> {
  const files: UploadFile[] = []
  for (const { file, path } of input) {
    if (extension(file.name) !== 'zip') {
      files.push({ name: path, blob: file })
      continue
    }
    const { unzipSync } = await import('three/examples/jsm/libs/fflate.module.js')
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
    for (const [name, data] of Object.entries(entries)) {
      if (name.endsWith('/') || name.startsWith('__MACOSX/') || data.length === 0) continue
      files.push({ name, blob: new Blob([data as Uint8Array<ArrayBuffer>]) })
    }
  }
  const rank = (name: string) => MODEL_EXTENSIONS.indexOf(extension(name) as (typeof MODEL_EXTENSIONS)[number])
  const models = files.filter((f) => rank(f.name) >= 0)
  if (models.length === 0) throw new Error(`no model file — expected one of ${MODEL_EXTENSIONS.map((e) => '.' + e).join(' ')}`)
  models.sort((a, b) => rank(a.name) - rank(b.name) || a.name.split('/').length - b.name.split('/').length)
  return { files, main: models[0].name }
}

export function newUploadId(): string {
  return `up-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/** a readable name from the model's file name */
export function nameFromFile(path: string): string {
  const base = path.split('/').pop()!.replace(/\.[^.]+$/, '')
  const name = base === 'scene' && path.includes('/') ? path.split('/').slice(-2, -1)[0] : base
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Untitled model'
}

/** the setup's length rule: the file's own size if plausible for the kind, else a typical length */
export function fitLength(setup: UploadSetup, measured: number): number | undefined {
  if (setup.length) return setup.length
  const p = PLAUSIBLE[setup.kind]
  return measured >= p.min && measured <= p.max ? undefined : p.typical
}

export const LENGTH_RANGE: Record<VehicleKind, { min: number; max: number }> = {
  car: { min: 2, max: 8 },
  bike: { min: 1, max: 4 },
}

/** the bay's view of an upload */
export function uploadProfile(record: UploadRecord, open: CarProfile['open']): CarProfile {
  const { setup } = record
  const format = extension(record.main).toUpperCase()
  return {
    id: record.id,
    make: setup.kind === 'bike' ? 'Your bike' : 'Your car',
    model: record.name,
    tag: `${format} · ${formatBytes(uploadBytes(record))}`,
    file: record.main,
    open,
    turn: { yaw: (setup.yaw * Math.PI) / 2, pitch: (setup.pitch * Math.PI) / 2, roll: (setup.roll * Math.PI) / 2 },
    fitLength: (measured) => fitLength(setup, measured),
    parts: {},
  }
}

/** the wrapper a profile's `turn` is applied to — roll and pitch first, then yaw */
export function applyTurn(wrapper: THREE.Object3D, turn: { yaw: number; pitch: number; roll: number }): void {
  wrapper.rotation.set(turn.pitch, turn.yaw, turn.roll, 'YXZ')
}

interface Wheel {
  centre: THREE.Vector3
  diameter: number
  /** the axle's direction: the disc's thin side */
  axle: 0 | 1 | 2
}

/**
 * Wheels, found by shape: a mesh whose box is a disc (two sides equal, the third
 * thinner) of a wheel's share of the model's size. Tyre, rim and hub of one wheel
 * are merged by position; the biggest set of matching discs (≥ 2) wins.
 */
function findWheels(model: THREE.Object3D, box: THREE.Box3): Wheel[] {
  const longest = Math.max(...box.getSize(new THREE.Vector3()).toArray())
  const found: Wheel[] = []
  const b = new THREE.Box3()
  const d = new THREE.Vector3()
  model.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    b.setFromObject(mesh, true).getSize(d)
    const dims = d.toArray()
    const axle = dims.indexOf(Math.min(...dims)) as 0 | 1 | 2
    const [a, c] = dims.filter((_, i) => i !== axle)
    const diameter = Math.max(a, c)
    if (Math.abs(a - c) > 0.12 * diameter || dims[axle] > 0.75 * diameter) return
    if (diameter < 0.08 * longest || diameter > 0.5 * longest) return
    found.push({ centre: b.getCenter(new THREE.Vector3()), diameter, axle })
  })
  // one entry per wheel: its biggest disc (the tyre)
  const wheels: Wheel[] = []
  for (const w of found.sort((p, q) => q.diameter - p.diameter)) {
    if (!wheels.some((u) => u.centre.distanceTo(w.centre) < 0.35 * u.diameter)) wheels.push(w)
  }
  // the largest family of alike wheels
  let best: Wheel[] = []
  for (const w of wheels) {
    const family = wheels.filter((u) => u.axle === w.axle && Math.abs(u.diameter - w.diameter) < 0.2 * w.diameter)
    if (family.length > best.length) best = family
  }
  return best.length >= 2 ? best.slice(0, 6) : []
}

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]

/** quarter turns (pitch, yaw, roll) that take `up` to +y and `side` onto the x axis */
function orientation(up: THREE.Vector3, side: THREE.Vector3): { pitch: number; yaw: number; roll: number } {
  const e = new THREE.Euler()
  const m = new THREE.Matrix4()
  const v = new THREE.Vector3()
  let best = { pitch: 0, yaw: 0, roll: 0 }
  let fewest = Infinity
  for (let pitch = 0; pitch < 4; pitch++)
    for (let roll = 0; roll < 4; roll++)
      for (let yaw = 0; yaw < 4; yaw++) {
        m.makeRotationFromEuler(e.set((pitch * Math.PI) / 2, (yaw * Math.PI) / 2, (roll * Math.PI) / 2, 'YXZ'))
        if (v.copy(up).applyMatrix4(m).y < 0.99 || Math.abs(v.copy(side).applyMatrix4(m).x) < 0.99) continue
        const turns = (pitch ? 1 : 0) + (roll ? 1 : 0) + (yaw ? 1 : 0)
        if (turns < fewest) {
          fewest = turns
          best = { pitch, yaw, roll }
        }
      }
  return best
}

/**
 * First guesses for a fresh import. With wheels found: the axle is the side-to-side
 * axis, the wheels sit at the bottom (which also catches an upside-down export),
 * two in line make a bike. Without: trust the file's up (Z for .3ds), put the long
 * side along z, and call it a bike when it's taller than wide. Then point the nose
 * at +z from where head vs tail lamps are named.
 */
export function guessSetup(model: THREE.Object3D, name: string, format: string): UploadSetup {
  const wrapper = new THREE.Group()
  const parent = model.parent
  wrapper.add(model)
  wrapper.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(wrapper, true)
  const size = new THREE.Vector3()
  const measure = (t: { pitch: number; yaw: number; roll: number }) => {
    applyTurn(wrapper, { pitch: (t.pitch * Math.PI) / 2, yaw: (t.yaw * Math.PI) / 2, roll: (t.roll * Math.PI) / 2 })
    wrapper.updateMatrixWorld(true)
    return box.setFromObject(wrapper, true).getSize(size)
  }

  const bikeName = /bike|moto|motorcycle|scooter|ducati|kawasaki|yamaha|harley|suzuki|ktm|triumph|cbr|gsx|ninja|vespa/i
  const wheels = findWheels(model, box)
  let turn = { pitch: 0, yaw: 0, roll: 0 }
  let kind: VehicleKind
  if (wheels.length >= 2) {
    const axle = wheels[0].axle
    const min = box.min.toArray()
    const ext = box.getSize(new THREE.Vector3()).toArray()
    // the wheels' height in the box, per remaining axis: the up axis is where they sit at an end
    let upAxis = -1
    let upSign = 1
    let lean = -1
    for (let k = 0; k < 3; k++) {
      if (k === axle) continue
      const t = wheels.reduce((sum, w) => sum + (w.centre.getComponent(k) - min[k]) / ext[k], 0) / wheels.length
      if (Math.abs(t - 0.5) > lean) {
        lean = Math.abs(t - 0.5)
        upAxis = k
        upSign = t < 0.5 ? 1 : -1
      }
    }
    turn = orientation(AXES[upAxis].clone().multiplyScalar(upSign), AXES[axle])
    // two wheels one behind the other: a bike (two side by side are one axle of a car)
    const apart = wheels.length === 2 ? wheels[0].centre.clone().sub(wheels[1].centre) : null
    const inLine = apart !== null && Math.abs(apart.getComponent(axle)) < 0.3 * apart.length()
    kind = bikeName.test(name) || inLine ? 'bike' : 'car'
    measure(turn)
  } else {
    // a vehicle is never taller than it's long: the file is Z-up (3ds Max, Blender without conversion)
    let s = measure(turn)
    if (format === '3ds' || s.y > Math.max(s.x, s.z)) turn.pitch = 3 // −90° about x takes +z to +y
    s = measure(turn)
    if (s.x > s.z) turn.yaw = 1
    s = measure(turn)
    kind = bikeName.test(name) || s.y > s.x * 1.05 ? 'bike' : 'car'
  }

  // nose: the end the head lamps (vs the tail lamps) are named on
  const front = /head|front|grill|drl|(^|[\s_.-])(hl|fl|fr)([\s_.\d-]|$)/i
  const rear = /tail|rear|brake|exhaust|(^|[\s_.-])(tl|rl|rr)([\s_.\d-]|$)/i
  const centreZ = box.getCenter(new THREE.Vector3()).z
  const c = new THREE.Vector3()
  const part = new THREE.Box3()
  let score = 0
  wrapper.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    const label = `${mesh.name} ${mesh.parent?.name ?? ''} ${material?.name ?? ''}`
    const f = front.test(label)
    if (f === rear.test(label)) return
    // from the vertices: skinned exports (the GT3 RS) have bind-pose boxes somewhere else entirely
    part.setFromObject(mesh, true).getCenter(c)
    score += (f ? 1 : -1) * Math.sign(c.z - centreZ)
  })
  if (score < 0) turn.yaw = (turn.yaw + 2) % 4

  // hand the model back as it came
  wrapper.remove(model)
  parent?.add(model)
  return { kind, ...turn, length: null }
}

/** files from a drop, folders walked (a glTF with its textures/ folder dragged in whole) */
export async function droppedFiles(dt: DataTransfer): Promise<{ file: File; path: string }[]> {
  // entries must be taken before the first await — the DataTransfer empties after the event
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry()).filter((e): e is FileSystemEntry => !!e)
  if (entries.length === 0) return [...dt.files].map((file) => ({ file, path: file.name }))
  const out: { file: File; path: string }[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej))
      out.push({ file, path: entry.fullPath.replace(/^\//, '') })
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
      if (batch.length === 0) break
      for (const e of batch) await walk(e)
    }
  }
  for (const e of entries) await walk(e)
  return out
}
