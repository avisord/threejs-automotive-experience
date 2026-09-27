import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { DEFAULT_GARAGE, GARAGES, collectGlowMeshes, type GarageDef, type Room } from './garages'
import { disposeCar, loadCar } from './car'
import { CARS, DEFAULT_CAR, NO_CAR, carTitle, type CarProfile } from './cars'
import {
  collectFiles,
  deleteUpload,
  droppedFiles,
  getUpload,
  guessSetup,
  loadUploads,
  nameFromFile,
  newUploadId,
  saveUpload,
  uploadProfile,
  uploads,
  type UploadRecord,
} from './uploads'
import { uploadPage } from './ui/upload-page'
import { createRoleTint, loadRoles, partKey, profileWithRoles, saveRoles, type HiddenPart, type RoleId, type RoleMap } from './roles'
import { rolesPage } from './ui/roles-page'
import { bakeContactShadow, disposeContactShadow } from './contact-shadow'
import { createConfigurator, type CarConfigurator } from './configurator'
import { LOOKS, REFLECTION_SCALE, createPostProcessing, type PostProcessing } from './post'
import { mountPanel, menuList, type Nav, type Page } from './ui/panel'
import { carPage } from './ui/car-page'
import { collectionPage } from './ui/collection-page'
import { garagePage } from './ui/garage-page'
import { graphicsPage } from './ui/graphics-page'
import { displayPage } from './ui/display-page'
import { partsPage } from './ui/parts-page'
import { createGroupEditor, meshLabel, type GroupEditor } from './groups'
import { findOccluders, type MeshCast } from './xray'
import { createLampSystem, type LampSystem } from './lights'
import { lightsPage } from './ui/lights-page'
import type { PathTracer } from './pathtrace'
import type { InteriorSettings } from './garages/interior'
import type { SunPosition } from './garages/sky'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { DEFAULT_CAR_SIZE, type CameraPose } from './camera-moves'
import type { Stage } from './director'
import { videoPage } from './ui/video-page'
import { createCarPlacement, type CarPlacement } from './placement'
import { createFreeCamera, type CameraMode } from './free-camera'
import './style.css'

const app = document.querySelector<HTMLDivElement>('#app')!

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
// only the car's lamps cast shadows, and each bakes its map once (see lights.ts)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
// tone mapping lives in the post chain (Menu › Settings › Graphics), see post.ts
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()

/** the car currently in the bay (see showCar) — declared early, the garage reads it */
let bay: Bay | null = null
/**
 * Set while a video preview or export has the view (see the video section):
 * the frame fills the window, or is rendered at `size`. Declared early, resize() reads it.
 */
let directing: { size: { width: number; height: number } | null } | null = null

// path tracing state (see the path tracing section) — declared early, resize() reads it
/** how long the camera must rest before tracing starts */
const TRACE_DELAY = 350
let tracer: PathTracer | null = null
let tracedShown = false
let tracerCameraStale = true
let lastActivity = 0
let traceTimer = 0

// ─── camera: orbit around the car, never from below ─────────────────────────
// Far enough for open-air garages' landscapes (garages/site.ts draws its far layers within ~6 km).
// A 0.1 m near plane still clears close-up camera moves and keeps depth precision workable at a few km.
const camera = new THREE.PerspectiveCamera(36, window.innerWidth / window.innerHeight, 0.1, 12000)
// front-left, from above — a touch farther back than before, for the longer default lens (Display › Field of view)
camera.position.set(5.0, 2.8, 6.4)
const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 0.6, 0)
controls.enableDamping = true
controls.dampingFactor = 0.06
controls.enablePan = false // keep the car centred
controls.minPolarAngle = 0.02 // straight-down top view is fine
controls.maxPolarAngle = THREE.MathUtils.degToRad(84) // …but never below the floor line
controls.minDistance = 3.4
controls.maxDistance = 100
controls.update()

// ─── walk / fly: the other camera modes (HUD bottom left, V cycles) ─────────
const carBox = new THREE.Box3()
const freeCam = createFreeCamera({
  camera,
  dom: renderer.domElement,
  groundAt,
  obstacles: () => (bay ? [carBox.copy(bay.box).applyMatrix4(bay.root.matrixWorld)] : []), // moved and turned
  canLock: () => !picking && !placement.active, // those need the pointer for clicks and the gizmo
})

/** three-mesh-bvh, fetched the first time the camera leaves the orbit */
let meshBVH: typeof import('three-mesh-bvh') | null = null
let groundCache: { room: Room; meshes: THREE.Mesh[] } | null = null
const groundRay = new THREE.Raycaster()
const groundFrom = new THREE.Vector3()
const groundNormal = new THREE.Vector3()
const DOWN = new THREE.Vector3(0, -1, 0)
/**
 * What the walker can stand on: the room's plain meshes, each
 * with a BVH (a terrain is hundreds of thousands of triangles). Instanced grass and trees,
 * mirrors (a pool, the lake) and meshes with raycasting switched off don't count — except
 * `userData.ground` ones (terrains skip raycasts so the camera's sight test stays cheap).
 */
function groundMeshes(): THREE.Mesh[] {
  if (groundCache?.room === room) return groundCache.meshes
  const bvh = meshBVH!
  const meshes: THREE.Mesh[] = []
  room.group.updateMatrixWorld()
  room.group.traverseVisible((obj) => {
    const mesh = obj as THREE.Mesh & { isReflector?: boolean }
    if (!mesh.isMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || mesh.isReflector) return
    if (mesh.raycast !== THREE.Mesh.prototype.raycast && !mesh.userData.ground) return
    const geometry = mesh.geometry
    // indirect: leaves the geometry's index as it is
    geometry.boundsTree ??= new bvh.MeshBVH(geometry, { indirect: true, maxDepth: 64 })
    meshes.push(mesh)
  })
  groundCache = { room, meshes }
  return meshes
}
const groundHits: THREE.Intersection[] = []
/** height of the first floor-like surface below (x, fromY, z) */
function groundAt(x: number, z: number, fromY: number): number | null {
  if (!meshBVH) return null
  groundRay.set(groundFrom.set(x, fromY, z), DOWN)
  groundRay.far = 1000
  groundHits.length = 0
  // the BVH's raycast called directly: the meshes' own raycast stays as the room set it
  for (const mesh of groundMeshes()) meshBVH.acceleratedRaycast.call(mesh, groundRay, groundHits)
  groundHits.sort((a, b) => a.distance - b.distance)
  for (const hit of groundHits) {
    if (!hit.face) continue
    groundNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
    if (Math.abs(groundNormal.y) > 0.35) return hit.point.y // not a wall's edge
  }
  return null
}

/** fetch three-mesh-bvh once (walking needs it for the ground, picking for fast raycasts) */
let bvhLoading: Promise<void> | null = null
function loadBVH(): Promise<void> {
  bvhLoading ??= import('three-mesh-bvh').then((m) => void (meshBVH = m))
  return bvhLoading
}

/** the orbit camera's place while walking or flying — the orbit comes back to it */
let orbitHome: THREE.Vector3 | null = null
async function setCameraMode(mode: CameraMode): Promise<void> {
  if (mode === freeCam.mode) return
  if (mode !== 'orbit' && !meshBVH) {
    await loadBVH()
    if (mode === freeCam.mode) return
  }
  if (freeCam.mode === 'orbit') orbitHome = camera.position.clone()
  freeCam.setMode(mode)
  if (mode === 'orbit' && orbitHome) {
    camera.position.copy(orbitHome)
    controls.update() // looks at the car again
  }
  controls.enabled = mode === 'orbit'
  syncCameraHud()
  noteActivity()
  invalidate(2)
}

// ─── keyboard zoom: + / - ───────────────────────────────────────────────────
const KEY_ZOOM_STEP = 0.18 // ln(distance ratio) per press, ≈ 20%
let zoomPending = 0 // zoom still to apply, eased out over a few frames
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || freeCam.mode !== 'orbit') return // leave browser page zoom alone
  if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') zoomPending -= KEY_ZOOM_STEP
  else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') zoomPending += KEY_ZOOM_STEP
  else return
  e.preventDefault()
})
/** advance OrbitControls, easing in any pending keyboard zoom; true if the camera moved */
function updateControls(dt: number): boolean {
  if (Math.abs(zoomPending) < 1e-4) return controls.update()
  const step = zoomPending * Math.min(1, dt * 12)
  zoomPending -= step
  // radius *= e^step (clamped to min/max distance); dollyIn() runs update() itself
  controls.dollyIn(Math.exp(step))
  return true
}

/** framing fov for the current viewport — set in resize(), widened by fitCameraInRoom() */
let baseFov = camera.fov
const offset = new THREE.Vector3()
/**
 * Videos only (the interactive camera goes anywhere): if a move's position is outside
 * the room, render from a point pulled in toward the target and widen the FOV to keep
 * the same framing (a dolly-zoom), so a top view under the ceiling still fits the car.
 */
function fitCameraInRoom(): void {
  offset.subVectors(camera.position, controls.target)
  let k = 1
  for (const axis of ['x', 'y', 'z'] as const) {
    const o = offset[axis]
    const t = controls.target[axis]
    if (o > 0) k = Math.min(k, (room.bounds.max[axis] - t) / o)
    else if (o < 0) k = Math.min(k, (room.bounds.min[axis] - t) / o)
  }
  const fov =
    k < 1 ? Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(baseFov / 2)) / k))) : baseFov
  if (k < 1) camera.position.copy(controls.target).addScaledVector(offset, k)
  if (fov !== camera.fov) {
    camera.fov = fov
    camera.updateProjectionMatrix()
  }
}

// ─── garage: the room and its lighting, swappable (Menu › Garage) ──────────
RectAreaLightUniformsLib.init()
const GARAGE_KEY = 'garage.venue.v1'
const garageById = (id: string | null) => GARAGES.find((g) => g.id === id)
// ?garage=<id> wins, then the last garage used, then the default
let savedGarage: string | null = null
try {
  savedGarage = localStorage.getItem(GARAGE_KEY)
} catch {
  // no storage — default garage
}
let garageDef: GarageDef =
  garageById(new URLSearchParams(location.search).get('garage')) ?? garageById(savedGarage) ?? garageById(DEFAULT_GARAGE)!
let room: Room = garageDef.create()
/** what scene.environment is drawn from — the render target, not just its texture, has to be freed */
let environmentTarget: THREE.WebGLRenderTarget | null = null
/** open-air rooms: the sky-lit environment map their outdoor meshes use (see captureEnvironment) */
let outdoorTarget: THREE.WebGLRenderTarget | null = null
const SUN_KEY = 'garage.sun.v1'
/** sun positions picked per garage */
let savedSuns: Record<string, SunPosition> = {}
try {
  savedSuns = JSON.parse(localStorage.getItem(SUN_KEY) ?? '{}') as Record<string, SunPosition>
} catch {
  // defaults
}
const INTERIOR_KEY = 'garage.interior.v1'
/** interior light settings picked per garage */
let savedInteriors: Record<string, InteriorSettings> = {}
try {
  savedInteriors = JSON.parse(localStorage.getItem(INTERIOR_KEY) ?? '{}') as Record<string, InteriorSettings>
} catch {
  // defaults
}
installRoom()

/** put `room` in the scene and light the car with it */
function installRoom(): void {
  // floors and walls catch the car's shadow from its own head and tail lights
  room.group.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) obj.receiveShadow = true
  })
  scene.add(room.group)
  scene.background = room.background
  scene.environmentIntensity = room.environmentIntensity
  const sun = savedSuns[garageDef.id]
  if (room.sun && sun) room.sun.set(sun)
  applyDaylight()
  const interior = savedInteriors[garageDef.id]
  if (room.interior && interior) room.interior.set(interior)
  captureEnvironment()
  // a sky still loading: capture again once it's in, if this room is still up
  const installed = room
  installed.ready?.then(() => {
    if (room !== installed) return
    captureEnvironment()
    traceSceneChanged()
    invalidate(4)
  })
}

/**
 * Capture the garage without the car into an environment map, so the paint
 * and glass reflect this room's actual lights.
 */
function captureEnvironment(): void {
  const pmrem = new THREE.PMREMGenerator(renderer)
  const hidden = [room.reflector, ...(bay ? [bay.root, bay.shadow] : [])]
  for (const o of hidden) o.visible = false
  room.outdoor?.beforeCapture?.()
  // the room must not reflect the previous garage's map while it's captured
  environmentTarget?.dispose()
  scene.environment = null
  environmentTarget = pmrem.fromScene(scene, 0, 0.1, 12000, {
    size: 512,
    position: new THREE.Vector3(0, 1.2, 0),
  })
  scene.environment = environmentTarget.texture
  // A material's envMapIntensity only counts when it has its own envMap (three uses
  // scene.environmentIntensity for scene.environment): room materials that ask for a weaker or
  // stronger reflection — the Fuji deck's polished floor — get the map handed over explicitly.
  room.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const standard = m as THREE.MeshStandardMaterial
      if (standard.isMeshStandardMaterial && standard.envMapIntensity !== 1 && (!standard.envMap || standard.userData.roomEnv)) {
        standard.envMap = environmentTarget!.texture
        standard.userData.roomEnv = true
      }
    }
  })
  // Open-air rooms: the interior capture sees a roof overhead, so the land
  // outside would be lit by concrete instead of sky. It gets its own map,
  // captured out in the open.
  outdoorTarget?.dispose()
  outdoorTarget = null
  if (room.outdoor) {
    outdoorTarget = pmrem.fromScene(scene, 0, 0.1, 12000, { size: 256, position: room.outdoor.probe })
    const map = outdoorTarget.texture
    room.outdoor.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const standard = m as THREE.MeshStandardMaterial
        if (standard.isMeshStandardMaterial) standard.envMap = map
      }
    })
  }
  room.outdoor?.afterCapture?.()
  for (const o of hidden) o.visible = true
  pmrem.dispose()
}

/** open-air rooms: in daylight the car's lamps light nothing around them, only their lenses glow */
function applyDaylight(): void {
  const sun = room.sun?.get()
  bay?.lamps.setDaylight(sun ? THREE.MathUtils.smoothstep(sun.elevation, -6, 6) : 0)
}

let recaptureTimer = 0
/** move the sun of an open-air room; the environment catches up once the slider rests */
function setSun(sun: SunPosition): void {
  if (!room.sun) return
  room.sun.set(sun)
  applyDaylight()
  savedSuns[garageDef.id] = sun
  try {
    localStorage.setItem(SUN_KEY, JSON.stringify(savedSuns))
  } catch {
    // not remembered — fine
  }
  lightingChanged()
}

/** switch, dim or warm the room's own lights; the car's reflections catch up once the slider rests */
function setInterior(settings: InteriorSettings): void {
  if (!room.interior) return
  room.interior.set(settings)
  savedInteriors[garageDef.id] = room.interior.get()
  try {
    localStorage.setItem(INTERIOR_KEY, JSON.stringify(savedInteriors))
  } catch {
    // not remembered — fine
  }
  lightingChanged()
}

/** the room's light changed: draw now, re-capture the environment (and restart a trace) once it settles */
function lightingChanged(): void {
  invalidate(2)
  clearTimeout(recaptureTimer)
  recaptureTimer = window.setTimeout(() => {
    captureEnvironment()
    traceSceneChanged()
    invalidate(3)
  }, 180)
}

// ─── post: AO, bloom, grade, vignette, AA ───────────────────────────────────
// glowing meshes for lights-only bloom: the room's LEDs plus any car part set to glow
const post = createPostProcessing(renderer, scene, camera, () => [
  ...collectGlowMeshes(room.group),
  ...(bay ? collectGlowMeshes(bay.root) : []),
])
post.setAtmosphere(room.atmosphere ?? null) // later rooms: swapRoom
post.setExposureKey(garageDef.exposureKey)
post.setFocus(controls.target, room.depthOfField ?? null) // the lens focuses on the orbit target: the car

/**
 * Frames still to draw. In on-demand mode (the default) nothing is drawn
 * unless something changed — the camera, the car, a setting, the viewport —
 * so an idle garage costs next to nothing.
 */
let dirtyFrames = 0
function invalidate(frames = 2): void {
  dirtyFrames = Math.max(dirtyFrames, frames)
}

const MAX_ANISOTROPY = renderer.capabilities.getMaxAnisotropy()
/** apply the texture-filtering setting to every texture under `root` */
function applyAnisotropy(root: THREE.Object3D): void {
  const n = Math.min(post.settings.quality.anisotropy, MAX_ANISOTROPY)
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const value of Object.values(material)) {
        const texture = value as THREE.Texture | null
        // render-target textures (contact shadow) have no image to re-upload
        if (!texture?.isTexture || texture.isRenderTargetTexture || texture.anisotropy === n) continue
        texture.anisotropy = n
        texture.needsUpdate = true
      }
    }
  })
}

// width the configurator panel takes on the right (panel + margins, see style.css)
const PANEL_INSET = 328
// on phones the panel is a bottom sheet; the free area above it is roughly this tall
const SHEET_INSET = 0.45

function resize(): void {
  if (directing) return layoutForVideo(directing.size)
  const w = window.innerWidth
  const h = window.innerHeight
  // Shift the projection centre into the area the panel leaves free, so the
  // car isn't half behind it: left of the side panel on wide screens, above
  // the bottom sheet on phones. The camera renders a window of a larger
  // virtual frame (setViewOffset) — an off-centre lens, not a crop.
  const wide = w > 640
  const insetX = wide ? PANEL_INSET : 0
  const insetY = wide ? 0 : Math.round(h * SHEET_INSET)
  const fullW = w + insetX
  const fullH = h + insetY
  // focal length in px: 42° vertical on wide screens; on narrow portrait
  // screens fit ~44° across the width instead, or the car won't fit
  const half = post.settings.display.fov / 2
  const focal = wide
    ? h / 2 / Math.tan(THREE.MathUtils.degToRad(half))
    : w / 2 / Math.tan(THREE.MathUtils.degToRad(half * (44 / 42)))
  baseFov = THREE.MathUtils.radToDeg(2 * Math.atan(fullH / 2 / focal))
  camera.fov = baseFov
  camera.aspect = fullW / fullH
  if (insetX > 0 || insetY > 0) camera.setViewOffset(fullW, fullH, insetX, insetY, w, h)
  else camera.clearViewOffset()
  camera.updateProjectionMatrix()
  // render scale multiplies the (capped) native pixel ratio: <1 upsamples, >1 supersamples
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * post.settings.quality.renderScale)
  post.setSize(w, h) // also sizes the renderer
  room.resize(w, h, renderer.getPixelRatio())
  tracerCameraStale = true
  invalidate()
}
window.addEventListener('resize', resize)

/** a plain centred lens over the whole frame: the window (preview) or the video size (export) */
function layoutForVideo(size: { width: number; height: number } | null): void {
  const w = size?.width ?? window.innerWidth
  const h = size?.height ?? window.innerHeight
  baseFov = post.settings.display.fov
  camera.fov = baseFov
  camera.aspect = w / h
  camera.clearViewOffset()
  camera.updateProjectionMatrix()
  // an export renders exactly its pixel size, whatever the display's pixel ratio
  renderer.setPixelRatio(size ? 1 : Math.min(window.devicePixelRatio, 2) * post.settings.quality.renderScale)
  post.setSize(w, h)
  room.resize(w, h, renderer.getPixelRatio())
  invalidate()
}

/** resolution, floor mirror and texture filtering — the settings outside the composer */
function applyQuality(): void {
  room.setReflectionScale(REFLECTION_SCALE[post.settings.quality.reflections])
  resize()
  applyAnisotropy(room.group)
  if (bay) applyAnisotropy(bay.root)
}

// ─── hud ────────────────────────────────────────────────────────────────────
const HINTS: Record<CameraMode, string> = {
  orbit: 'drag to orbit · scroll or +/− to zoom',
  walk: 'click to look · wasd walk · shift runs · esc frees the mouse',
  fly: 'click to look · wasd · space up · shift/ctrl down · scroll: speed',
}
const PICK_HINT = 'click to select · click again: next layer in · alt+click lists every layer · h hides · shift+h shows all · esc clears'
const hint = document.createElement('div')
hint.className = 'hint'
hint.textContent = HINTS.orbit
app.appendChild(hint)

const CAMERA_MODES: CameraMode[] = ['orbit', 'walk', 'fly']
const MODE_LABEL: Record<CameraMode, string> = { orbit: 'Orbit', walk: 'Walk', fly: 'Fly' }
const cameraHud = document.createElement('div')
cameraHud.className = 'cam-modes'
for (const mode of CAMERA_MODES) {
  const button = document.createElement('button')
  button.type = 'button'
  button.dataset.mode = mode
  button.textContent = MODE_LABEL[mode]
  button.title = 'V switches camera'
  button.addEventListener('click', () => void setCameraMode(mode))
  cameraHud.append(button)
}
app.appendChild(cameraHud)
cameraHud.querySelector('[data-mode="orbit"]')!.classList.add('is-on') // syncCameraHud reads `picking`, declared below
function syncCameraHud(): void {
  for (const button of cameraHud.querySelectorAll<HTMLButtonElement>('button')) {
    button.classList.toggle('is-on', button.dataset.mode === freeCam.mode)
  }
  hint.textContent = picking ? PICK_HINT : HINTS[freeCam.mode]
}
window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement
  if (e.code !== 'KeyV' || e.repeat || e.ctrlKey || e.metaKey || e.altKey || directing) return
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return
  void setCameraMode(CAMERA_MODES[(CAMERA_MODES.indexOf(freeCam.mode) + 1) % CAMERA_MODES.length])
})

const fpsEl = document.createElement('div')
fpsEl.className = 'fps'
fpsEl.textContent = '— fps'
fpsEl.hidden = !post.settings.display.showFps
app.appendChild(fpsEl)

const loader = document.createElement('div')
loader.className = 'loader'
loader.innerHTML = '<span class="loader-label">loading vehicle</span><span class="loader-bar"><i></i></span>'
app.appendChild(loader)
const loaderFill = loader.querySelector<HTMLElement>('i')!

let framesDrawn = 0
let fpsWindowStart = performance.now()
/** readout of frames actually drawn; "idle" when on-demand has nothing to draw */
function tickFps(now: number): void {
  const elapsed = now - fpsWindowStart
  if (elapsed < 500) return
  const target = post.settings.pathTracing.samples
  if (tracer && tracedShown) {
    fpsEl.textContent = tracer.status === 'done' ? `traced · ${target} spp` : `tracing · ${tracer.samples}/${target} spp`
  } else if (tracer && tracer.status === 'building' && now - lastActivity > TRACE_DELAY) {
    fpsEl.textContent = 'tracing · preparing'
  } else {
    fpsEl.textContent = framesDrawn === 0 ? 'idle' : `${Math.round((framesDrawn * 1000) / elapsed)} fps`
  }
  framesDrawn = 0
  fpsWindowStart = now
}

// ─── car ────────────────────────────────────────────────────────────────────
interface Bay {
  id: string
  root: THREE.Object3D
  shadow: THREE.Mesh
  configurator: CarConfigurator
  groups: GroupEditor
  lamps: LampSystem
  /** width, height, length — what camera moves frame */
  size: THREE.Vector3
  /** its bounds where it was loaded, at the origin (walk/fly keep out of it) */
  box: THREE.Box3
  /** what each mesh is (Menu › Car › Part roles): saved by the user, or guessed */
  roles: { map: RoleMap; saved: boolean; hidden: HiddenPart[] }
}
let loadingId: string | null = null
const CAR_KEY = 'garage.car.v1'

// ─── car placement: drag the whole car around the room (Menu › Car › Position) ───
const placement = createCarPlacement({
  camera,
  dom: renderer.domElement,
  scene,
  bounds: () => room.bounds,
  dragging: (on) => (controls.enabled = !on && freeCam.mode === 'orbit'), // the drag is the gizmo's, not an orbit
  changed: () => invalidate(),
  moved() {
    // the car's lamps bake their shadow maps once — re-bake them where the car now stands
    bay?.root.traverse((o) => {
      const spot = o as THREE.SpotLight
      if (spot.isSpotLight && spot.castShadow) spot.shadow.needsUpdate = true
    })
    room.shadowsChanged?.()
    traceSceneChanged()
    invalidate(2)
    panelNav?.refresh() // the Car page shows where it is
  },
  done: () => centreOnCar(), // placing finished: orbit round the car where it now stands
})
/** the car's centre at orbit height — what the camera turns around */
function carCentre(out = new THREE.Vector3()): THREE.Vector3 {
  out.set(0, 0.6, 0)
  if (bay) out.add(bay.root.position)
  return out
}
/** bring the orbit round to the car, keeping the camera's angle and distance */
function centreOnCar(): void {
  const centre = carCentre()
  // walking or flying: the orbit waits where it was, and follows the car there
  const orbiting = freeCam.mode === 'orbit'
  ;(orbiting ? camera.position : orbitHome)?.add(offset.subVectors(centre, controls.target))
  controls.target.copy(centre)
  if (orbiting) controls.update()
  invalidate()
}

/**
 * Keep the framing from one vehicle to the next: the orbit's distance scales with the
 * length (a bike after a car comes in close). Cars of a size barely move it.
 */
let framedLength = 4.5
function frameLength(length: number): void {
  const ratio = length / framedLength
  framedLength = length
  if (Math.abs(ratio - 1) < 0.15) return
  const home = freeCam.mode === 'orbit' ? camera.position : orbitHome
  if (!home) return
  offset.subVectors(home, controls.target).multiplyScalar(ratio)
  offset.setLength(THREE.MathUtils.clamp(offset.length(), controls.minDistance, controls.maxDistance))
  home.copy(controls.target).add(offset)
}

/** swap the car in the bay; a newer request supersedes one still loading */
/** take the car out of the bay and free it */
function clearBay(): void {
  if (!bay) return
  roleTint.set(null) // overlays on the car's meshes
  roleDraft = null
  placement.attach(null)
  scene.remove(bay.root, bay.shadow)
  room.floorLayers.splice(room.floorLayers.indexOf(bay.shadow), 1)
  bay.lamps.dispose() // put the lenses back before the car is taken apart
  bay.groups.dispose() // overlays first — they share geometry with the car
  disposeCar(bay.root)
  disposeContactShadow(bay.shadow)
  bay = null
  garage.configurator = undefined
  garage.lamps = undefined
}

/** what car-dependent pages show when there's no car to work on */
const bayPlaceholder = () => (loadingId ? 'Loading car…' : 'No car in the bay — pick one in Collection.')

async function showCar(id: string): Promise<void> {
  if (id === NO_CAR) {
    loadingId = null // also abandons a car still loading
    setPicking(false)
    clearBay()
    room.shadowsChanged?.()
    try {
      localStorage.setItem(CAR_KEY, NO_CAR)
    } catch {
      // not remembered — fine
    }
    loader.classList.add('done')
    traceSceneChanged()
    post.refreshGlow()
    invalidate(2)
    panelNav?.refresh()
    console.info('[garage] bay emptied')
    return
  }
  const profile = findProfile(id) ?? CARS[0]
  loadingId = profile.id
  loader.classList.remove('done')
  loader.querySelector('.loader-label')!.textContent = `loading ${carTitle(profile)}`
  loaderFill.style.transform = 'scaleX(0)'
  panelNav?.refresh()
  try {
    const savedRoles = loadRoles(profile.id)
    const loaded = await loadCar(profile, (f) => (loaderFill.style.transform = `scaleX(${f})`), savedRoles, !!profile.open)
    const root = loaded.root
    // roles decide what's painted and what glows once saved — or always, for an upload
    const dressed = savedRoles || profile.open ? profileWithRoles(profile, loaded.roles) : profile
    if (loadingId !== profile.id) {
      disposeCar(root) // the user picked another car meanwhile
      return
    }
    clearBay()
    scene.add(root)
    const box = new THREE.Box3().setFromObject(root)
    const size = box.getSize(new THREE.Vector3())
    const shadow = bakeContactShadow(renderer, root, { width: size.x + 2.4, depth: size.z + 2.4, height: 0.9 }) // room for the blur
    scene.add(shadow)
    room.floorLayers.push(shadow)
    const configurator = createConfigurator(root, dressed, traceSceneChanged)
    applyAnisotropy(root)
    const groups = createGroupEditor(root, profile, configurator.carSpace, (materials) => {
      scheduleGhosts()
      invalidate()
      post.refreshGlow()
      if (materials) traceSceneChanged()
    })
    groups.setOverlaysVisible(false) // the Parts page shows them
    const lamps = createLampSystem(root, dressed, () => {
      invalidate()
      post.refreshGlow()
      traceSceneChanged()
    })
    const roles = { map: loaded.roles, saved: !!savedRoles, hidden: loaded.hidden }
    bay = { id: profile.id, root, shadow, configurator, groups, lamps, size, box, roles }
    applyDaylight()
    placement.attach({ id: profile.id, root, shadow, size }) // its saved place (the shadow was baked at the origin)
    frameLength(Math.max(size.x, size.z))
    centreOnCar()
    room.shadowsChanged?.()
    traceSceneChanged()
    post.refreshGlow()
    invalidate(4) // first frames also compile the new car's shaders
    garage.configurator = configurator
    garage.lamps = lamps
    try {
      localStorage.setItem(CAR_KEY, profile.id)
    } catch {
      // not remembered — fine
    }
    loader.classList.add('done')
    console.info(`[garage] ${profile.id} ready`)
  } catch (err: unknown) {
    console.error(`[garage] failed to load ${profile.id}`, err)
    loader.querySelector('.loader-label')!.textContent = `failed to load ${carTitle(profile)} — see console`
  } finally {
    if (loadingId === profile.id) loadingId = null
    panelNav?.refresh()
  }
}

// ─── switching garages ──────────────────────────────────────────────────────
const fade = document.createElement('div')
fade.className = 'fade'
app.appendChild(fade) // over the canvas and hud, under the panel (mounted later)

const venue = document.createElement('div')
venue.className = 'venue'
venue.innerHTML = '<span class="venue-name"></span><span class="venue-tag"></span>'
app.appendChild(venue)
let venueTimer = 0
/** name the garage for a moment after arriving */
function announceGarage(def: GarageDef): void {
  venue.querySelector('.venue-name')!.textContent = def.name
  venue.querySelector('.venue-tag')!.textContent = def.tag
  venue.classList.add('is-shown')
  clearTimeout(venueTimer)
  venueTimer = window.setTimeout(() => venue.classList.remove('is-shown'), 2600)
}

const FADE_MS = 240
let switchingTo: string | null = null

/** fade to black, swap the whole room — geometry, lights, reflections — and fade back in */
async function showGarage(id: string): Promise<void> {
  const def = garageById(id)
  if (!def || def.id === garageDef.id || switchingTo) return
  switchingTo = def.id
  panelNav.refresh()
  fade.classList.add('is-on')
  await new Promise((resolve) => setTimeout(resolve, FADE_MS))
  await swapRoom(def)
  switchingTo = null
  panelNav.refresh()
  // uncover once the new room has been drawn
  requestAnimationFrame(() => requestAnimationFrame(() => fade.classList.remove('is-on')))
  announceGarage(def)
  console.info(`[garage] now in ${def.id}`)
}

/** replace the room — geometry, lights, reflections, grade look — ready to draw when it resolves */
async function swapRoom(def: GarageDef): Promise<void> {
  scene.remove(room.group)
  room.dispose()
  garageDef = def
  room = def.create()
  if (bay) room.floorLayers.push(bay.shadow)
  installRoom()
  placement.refit() // a smaller room may not fit where the car stood
  post.setAtmosphere(room.atmosphere ?? null)
  post.setExposureKey(def.exposureKey)
  post.setFocus(controls.target, room.depthOfField ?? null)
  applyQuality() // floor mirror size and texture filtering for the new room
  post.refreshGlow()
  traceSceneChanged()
  adoptGarage(def)
  await room.ready // a video must not show the room before its sky is in
  // compile the new room's shaders now (behind the fade), not on the first visible frame
  await renderer.compileAsync(scene, camera).catch(() => {})
  invalidate(4)
}

/** arriving somewhere new: take on its grade look and remember it */
function adoptGarage(def: GarageDef): void {
  // Settings › Graphics fine-tunes the look from here
  const { contrast, saturation, temperature, split } = LOOKS[def.look]
  post.set('grade', { look: def.look, contrast, saturation, temperature, split })
  try {
    localStorage.setItem(GARAGE_KEY, def.id)
  } catch {
    // not remembered — fine
  }
}
// opened by link somewhere other than last time: as if picked. A reload keeps any grade tweaks.
if (garageDef.id !== savedGarage) adoptGarage(garageDef)

// ─── video: camera moves played back or exported (Menu › Video) ────────────
const fadeQuad = new FullScreenQuad(new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthTest: false }))

const sightRay = new THREE.Raycaster()
const sightBox = new THREE.Box3()
const sightSize = new THREE.Vector3()
/**
 * Room geometry between the car and the camera (a pendant over the car, a
 * pillar) would fill the frame: pull the camera in front of it and widen the
 * lens to keep the framing, the same dolly-zoom fitCameraInRoom() does at the walls.
 */
function clearLineOfSight(target: THREE.Vector3): void {
  offset.subVectors(camera.position, target)
  const distance = offset.length()
  sightRay.set(target, offset.divideScalar(distance))
  sightRay.far = distance
  const skip = new Set<THREE.Object3D>([room.reflector, ...room.floorLayers])
  const hit = sightRay.intersectObject(room.group, true).find((h) => {
    if (skip.has(h.object) || !h.object.visible) return false
    // cords and strips are too thin to hide anything — pulling in for them would just pop the framing
    const g = (h.object as THREE.Mesh).geometry
    if (!g.boundingBox) g.computeBoundingBox()
    sightBox.copy(g.boundingBox!).getSize(sightSize)
    return Math.min(sightSize.x, sightSize.y, sightSize.z) > 0.05 || Math.max(sightSize.x, sightSize.y, sightSize.z) < 0.3
  })
  if (!hit) return
  const pulled = Math.max(0.5, hit.distance - 0.2)
  camera.position.copy(target).addScaledVector(offset, pulled)
  const k = pulled / distance
  camera.fov = Math.min(75, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / k)))
  camera.updateProjectionMatrix()
}

/** what preview and export borrow from the app; they give it back as it was */
const videoStage: Stage = (() => {
  let saved: { position: THREE.Vector3; target: THREE.Vector3; garage: string; grade: typeof post.settings.grade } | null = null
  return {
    canvas: renderer.domElement,
    begin(size) {
      saved = {
        position: camera.position.clone(),
        target: controls.target.clone(),
        garage: garageDef.id,
        grade: { ...post.settings.grade },
      }
      setPicking(false)
      if (document.pointerLockElement) document.exitPointerLock()
      if (tracedShown) hideTraced()
      placement.helper.visible = false // never in a video
      directing = { size }
      app.classList.add('is-directing')
      resize()
    },
    async end() {
      if (saved && saved.garage !== garageDef.id) await swapRoom(garageById(saved.garage)!)
      if (saved) {
        post.set('grade', saved.grade) // the garages visited set their own looks
        camera.position.copy(saved.position)
        controls.target.copy(saved.target)
        controls.update()
      }
      saved = null
      placement.helper.visible = true
      directing = null
      app.classList.remove('is-directing')
      resize()
      noteActivity()
    },
    framing() {
      // not baseFov: draw() sets that to each pose's own lens
      return { size: bay?.size ?? DEFAULT_CAR_SIZE, fov: post.settings.display.fov, aspect: camera.aspect }
    },
    async setGarage(id) {
      const def = garageById(id)
      if (!def || def.id === garageDef.id) return false
      await swapRoom(def)
      return true
    },
    draw(pose: CameraPose, dt, black) {
      baseFov = pose.fov ?? post.settings.display.fov // the room clamps widen from this lens
      // moves are laid out around a car at the origin, nose to +z: carry them to wherever it's been moved and turned
      if (bay) {
        bay.root.updateMatrixWorld()
        pose.position.applyMatrix4(bay.root.matrixWorld)
        pose.target.applyMatrix4(bay.root.matrixWorld)
      }
      camera.position.copy(pose.position)
      controls.target.copy(pose.target)
      camera.lookAt(pose.target)
      if (pose.roll) camera.rotateZ(pose.roll)
      bay?.configurator.update()
      room.update?.(dt)
      fitCameraInRoom() // moves only along the view ray, so the look direction holds
      clearLineOfSight(pose.target)
      post.render(dt)
      if (black > 0.001) {
        ;(fadeQuad.material as THREE.MeshBasicMaterial).opacity = black
        const autoClear = renderer.autoClear
        renderer.autoClear = false
        renderer.setRenderTarget(null)
        fadeQuad.render(renderer)
        renderer.autoClear = autoClear
      }
    },
  }
})()

// ─── part roles (Menu › Car › Part roles) ───────────────────────────────────
/** roles as being edited on the page; applied by reloading the car */
let roleDraft: RoleMap | null = null
let roleTintOn = true
let rolesShowing = false
const roleTint = createRoleTint()
function draftRoles(): RoleMap {
  if (!roleDraft) roleDraft = { ...(bay?.roles.map ?? {}) }
  return roleDraft
}
function rolesDirty(): boolean {
  if (!roleDraft || !bay) return false
  const saved = bay.roles.map
  return Object.keys(roleDraft).some((k) => roleDraft![k] !== saved[k])
}
/** role colours over the car while the page shows them (not on ghosted or hidden parts) */
function syncRoleTint(): void {
  if (!bay || !rolesShowing || !roleTintOn) {
    roleTint.set(null)
    return invalidate()
  }
  const draft = draftRoles()
  const { ghosts, hidden } = bay.groups.xray
  const tints = new Map<THREE.Mesh, RoleId>()
  for (const mesh of bay.groups.pickable) {
    const role = draft[partKey(mesh) ?? '']
    if (role && !ghosts.has(mesh) && !hidden.has(mesh)) tints.set(mesh, role)
  }
  roleTint.set(tints)
  invalidate()
}
function applyRoles(): void {
  if (!bay || !roleDraft) return
  saveRoles(bay.id, roleDraft)
  roleDraft = null
  void showCar(bay.id)
}

// ─── uploads: the user's own models (Menu › Collection › Upload) ─────────────
/** a model just parsed at import — the bay takes it instead of parsing the files again */
let freshModel: { id: string; model: THREE.Object3D } | null = null
let uploadStatus: { text: string; error: boolean } | null = null

/** built-in car or upload by id */
function findProfile(id: string): CarProfile | undefined {
  const car = CARS.find((c) => c.id === id)
  if (car) return car
  const record = getUpload(id)
  return record && uploadProfile(record, (onProgress) => openUpload(record, onProgress))
}

async function openUpload(record: UploadRecord, onProgress?: (f: number) => void): Promise<THREE.Object3D> {
  if (freshModel?.id === record.id) {
    const { model } = freshModel
    freshModel = null
    return model
  }
  const { parseModel } = await import('./model-import')
  return parseModel(record.files, record.main, renderer, onProgress)
}

function setUploadStatus(text: string | null, error = false): void {
  uploadStatus = text ? { text, error } : null
  panelNav?.refresh()
}
const storageFailed = (err: unknown) =>
  setUploadStatus(`Couldn’t keep it in this browser (${(err as Error)?.name ?? err}) — it’s here until you reload.`, true)

async function importUpload(input: { file: File; path: string }[]): Promise<void> {
  try {
    setUploadStatus('Reading files…')
    const { files, main } = await collectFiles(input)
    setUploadStatus(`Loading ${main.split('/').pop()}…`)
    const { parseModel } = await import('./model-import')
    const model = await parseModel(files, main, renderer)
    let meshes = 0
    model.traverse((o) => (o as THREE.Mesh).isMesh && meshes++)
    if (meshes === 0) throw new Error('the file has no meshes')
    const name = nameFromFile(main)
    const setup = guessSetup(model, name, main.slice(main.lastIndexOf('.') + 1).toLowerCase())
    const record: UploadRecord = { id: newUploadId(), name, created: Date.now(), main, files, setup, guess: { ...setup } }
    freshModel = { id: record.id, model }
    setUploadStatus(null)
    await saveUpload(record).catch(storageFailed)
    void navigator.storage?.persist?.() // ask the browser not to evict it under storage pressure
    await showCar(record.id)
    console.info(`[garage] uploaded ${main}: ${meshes} meshes, guessed`, setup)
  } catch (err) {
    console.error('[garage] upload failed', err)
    setUploadStatus(`Couldn’t load that: ${(err as Error)?.message ?? err}`, true)
  }
}

/** a change to how the upload in the bay is turned or sized — saved, then the model re-read */
function setSetup(patch: Partial<UploadRecord['setup']>): void {
  const record = bay && getUpload(bay.id)
  if (!record) return
  record.setup = { ...record.setup, ...patch }
  void saveUpload(record).catch(storageFailed)
  void showCar(record.id)
}

// a model dropped anywhere on the page is uploaded
app.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  app.classList.add('is-dropping')
})
app.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) app.classList.remove('is-dropping')
})
app.addEventListener('drop', (e) => {
  app.classList.remove('is-dropping')
  if (!e.dataTransfer?.types.includes('Files')) return
  e.preventDefault()
  void droppedFiles(e.dataTransfer).then((files) => void (files.length && importUpload(files)))
})

// ─── side panel: Menu › Garage · Collection · Car · Parts · Settings ───────
/** Menu › Parts: clicks on the car select parts (declared before the panel renders) */
let picking = false
/** Menu › Parts: ghost whatever stands in front of the part being worked on */
let xrayOn = true
const pages: Record<string, Page> = {
  menu: {
    title: 'Menu',
    render: (body, nav) =>
      body.append(menuList(pages, ['garage', 'collection', 'car', 'roles', 'parts', 'lights', 'video', 'settings'], nav)),
  },
  garage: garagePage({
    current: () => garageDef.id,
    switching: () => switchingTo,
    select: (id) => void showGarage(id),
    sun: () => room.sun?.get() ?? null,
    setSun,
    interior: () => (room.interior ? { groups: room.interior.groups, settings: room.interior.get(), defaults: room.interior.defaults() } : null),
    setInterior,
  }),
  collection: collectionPage({
    current: () => bay?.id ?? (loadingId ? null : NO_CAR),
    loading: () => loadingId,
    select: (id) => void showCar(id),
    uploads: () => uploads().map((r) => findProfile(r.id)!),
  }),
  upload: uploadPage({
    current: () => (bay ? getUpload(bay.id) ?? null : null),
    size: () => (bay ? new THREE.Vector3(bay.size.x, bay.size.y, bay.size.z) : null),
    status: () => uploadStatus,
    list: uploads,
    importFiles: (files) => void importUpload(files),
    setSetup,
    rename(name) {
      const record = bay && getUpload(bay.id)
      if (!record || !name.trim()) return
      record.name = name.trim()
      void saveUpload(record).catch(storageFailed)
      panelNav.refresh()
    },
    show: (id) => void showCar(id),
    remove(id) {
      if (bay?.id === id || loadingId === id) void showCar(NO_CAR)
      uploadStatus = null
      void deleteUpload(id).then(() => panelNav.refresh())
    },
  }),
  car: carPage(() => bay?.configurator, bayPlaceholder, placement),
  lights: lightsPage(() => bay?.lamps, bayPlaceholder),
  roles: rolesPage({
    editor: () => bay?.groups,
    roleOf: (mesh) => draftRoles()[partKey(mesh) ?? ''] ?? 'other',
    hiddenAtLoad: () => (bay?.roles.hidden ?? []).filter((h) => draftRoles()[h.key] === 'hidden'), // ↺ takes one off
    curated: () => !!bay && !bay.roles.saved && !bay.configurator.profile.open,
    upload: () => !!bay?.configurator.profile.open,
    dirty: rolesDirty,
    assign(meshes, role) {
      const draft = draftRoles()
      for (const m of meshes) draft[partKey(m) ?? ''] = role
      // a hidden part leaves the view now (for real once applied)
      if (role === 'hidden') bay?.groups.xray.hide(meshes)
      syncRoleTint()
    },
    unhide(key) {
      draftRoles()[key] = 'other'
    },
    apply: applyRoles,
    discard() {
      roleDraft = null
      bay?.groups.xray.unhideAll()
      syncRoleTint()
    },
    reset() {
      if (!bay) return
      saveRoles(bay.id, null)
      roleDraft = null
      void showCar(bay.id)
    },
    picking: () => picking,
    setPicking,
    tint: () => roleTintOn,
    setTint(on) {
      roleTintOn = on
      syncRoleTint()
    },
    showing(on) {
      rolesShowing = on
      syncRoleTint()
    },
    placeholder: bayPlaceholder,
  }),
  parts: partsPage({
    editor: () => bay?.groups,
    picking: () => picking,
    setPicking,
    xray: () => xrayOn,
    setXray(on) {
      xrayOn = on
      scheduleGhosts(0)
    },
    hide: hideParts,
    unhideAll,
    placeholder: bayPlaceholder,
  }),
  settings: {
    title: 'Settings',
    hint: 'Graphics, display',
    render: (body, nav) => body.append(menuList(pages, ['graphics', 'display'], nav)),
  },
  video: videoPage(app, () => videoStage, () => garageDef.id),
  graphics: graphicsPage(post),
  display: displayPage(post),
}
const panelNav: Nav = mountPanel(app, pages, 'menu')

// ?car=<id> wins, then the last car shown, then the default
const requested = new URLSearchParams(location.search).get('car')
let savedCar: string | null = null
try {
  savedCar = localStorage.getItem(CAR_KEY)
} catch {
  // no storage — default car
}
// ─── picking parts in 3D (Menu › Parts) ─────────────────────────────────────
function setPicking(on: boolean): void {
  picking = on
  if (on && document.pointerLockElement) document.exitPointerLock() // the pointer is needed to pick
  if (on) void loadBVH() // a pick over a million-triangle car takes tens of ms without it
  renderer.domElement.style.cursor = on ? 'crosshair' : ''
  syncCameraHud()
  if (!on) {
    bay?.groups.highlight('hover', [])
    closeLayerMenu()
    pickTip.classList.remove('is-shown')
    pickCycle = null
  }
  invalidate()
}

/** one mesh into `hits`: through a BVH (built the first time a ray comes near) once it's loaded */
const castMesh: MeshCast = (mesh, ray, hits) => {
  if (!meshBVH) return mesh.raycast(ray, hits)
  // indirect: leaves the geometry's index as it is (overlays and ghosts share it)
  mesh.geometry.boundsTree ??= new meshBVH.MeshBVH(mesh.geometry, { indirect: true })
  meshBVH.acceleratedRaycast.call(mesh, ray, hits)
}

const raycaster = new THREE.Raycaster()
;(raycaster as THREE.Raycaster & { firstHitOnly?: boolean }).firstHitOnly = true // one hit per mesh is all a pick needs
const ndc = new THREE.Vector2()
const pickHits: THREE.Intersection[] = []
/** every layer under a canvas point, nearest first, one entry per mesh — ghosts included, hidden parts not */
function meshesAt(clientX: number, clientY: number): THREE.Mesh[] {
  if (!bay) return []
  const rect = renderer.domElement.getBoundingClientRect()
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  // camera.matrixWorld is still the pose last drawn, so rays match the picture
  raycaster.setFromCamera(ndc, camera)
  pickHits.length = 0
  const hidden = bay.groups.xray.hidden
  for (const mesh of bay.groups.pickable) if (!hidden.has(mesh)) castMesh(mesh, raycaster, pickHits)
  pickHits.sort((a, b) => a.distance - b.distance)
  const out: THREE.Mesh[] = []
  for (const hit of pickHits) if (!out.includes(hit.object as THREE.Mesh)) out.push(hit.object as THREE.Mesh)
  return out
}

/** where a plain click lands: the first layer that isn't ghosted — what you see is what you pick */
function surfaceIndex(stack: THREE.Mesh[]): number {
  const ghosts = bay?.groups.xray.ghosts
  const i = stack.findIndex((m) => !ghosts?.has(m))
  return i < 0 ? 0 : i
}

/**
 * Clicking again on the same spot goes one layer in (paint → glass → seat → floor…),
 * wrapping round at the last. Moving the pointer or the camera starts over.
 */
let pickCycle: { x: number; y: number; stack: THREE.Mesh[]; index: number; added: boolean } | null = null
const sameStack = (a: THREE.Mesh[], b: THREE.Mesh[]) => a.length === b.length && a.every((m, i) => m === b[i])
function cycleAt(x: number, y: number, stack: THREE.Mesh[]): number | null {
  if (!pickCycle || Math.hypot(x - pickCycle.x, y - pickCycle.y) > 4 || !sameStack(pickCycle.stack, stack)) return null
  return (pickCycle.index + 1) % stack.length
}

// a small label by the pointer: the part a click would take, and how deep it is
const pickTip = document.createElement('div')
pickTip.className = 'pick-tip'
app.appendChild(pickTip)
function showPickTip(x: number, y: number, stack: THREE.Mesh[], index: number, picked: boolean): void {
  pickTip.replaceChildren()
  const name = document.createElement('b')
  name.textContent = meshLabel(stack[index])
  const depth = document.createElement('span')
  const n = stack.length
  // once picked, say what the next click on this spot would take
  if (n > 1) depth.textContent = `layer ${index + 1}/${n}${picked ? ` · again: ${meshLabel(stack[(index + 1) % n])}` : ''}`
  pickTip.append(name, depth)
  pickTip.style.transform = `translate(${x + 14}px, ${y + 16}px)`
  pickTip.classList.add('is-shown')
}

// Alt+click: every layer under the pointer as a list — hover one to see it, click to select
const layerMenu = document.createElement('div')
layerMenu.className = 'pick-menu'
app.appendChild(layerMenu)
function closeLayerMenu(): void {
  if (!layerMenu.classList.contains('is-shown')) return
  layerMenu.classList.remove('is-shown')
  layerMenu.replaceChildren()
  bay?.groups.highlight('hover', [])
}
function openLayerMenu(x: number, y: number, stack: THREE.Mesh[]): void {
  const editor = bay?.groups
  if (!editor) return
  layerMenu.replaceChildren()
  const title = document.createElement('div')
  title.className = 'pick-menu-title'
  title.textContent = `${stack.length} layer${stack.length === 1 ? '' : 's'} here · shift adds`
  layerMenu.append(title)
  stack.forEach((mesh, i) => {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = `pick-menu-item${editor.selection.has(mesh) ? ' is-selected' : ''}`
    const n = document.createElement('span')
    n.className = 'pick-menu-n'
    n.textContent = String(i + 1)
    const label = document.createElement('span')
    label.textContent = meshLabel(mesh)
    item.title = mesh.name
    item.append(n, label)
    item.addEventListener('pointerenter', () => editor.highlight('hover', [mesh]))
    item.addEventListener('click', (e) => {
      editor.select([mesh], e.shiftKey || e.ctrlKey || e.metaKey ? 'toggle' : 'replace')
      pickCycle = { x, y, stack, index: i, added: true }
      closeLayerMenu()
      panelNav.refresh()
    })
    layerMenu.append(item)
  })
  layerMenu.addEventListener('pointerleave', () => editor.highlight('hover', []), { once: true })
  // keep it on screen
  layerMenu.classList.add('is-shown')
  const w = layerMenu.offsetWidth
  const h = layerMenu.offsetHeight
  layerMenu.style.left = `${Math.min(x + 8, window.innerWidth - w - 8)}px`
  layerMenu.style.top = `${Math.max(8, Math.min(y + 8, window.innerHeight - h - 8))}px`
  pickTip.classList.remove('is-shown')
}
window.addEventListener('pointerdown', (e) => {
  if (!layerMenu.contains(e.target as Node)) closeLayerMenu()
})

/** H: take the selection (or the hovered part) out of the view to reach what's under it */
function hideParts(): void {
  const editor = bay?.groups
  if (!editor) return
  const doomed = editor.selection.size > 0 ? [...editor.selection] : editor.targets()
  if (doomed.length === 0) return
  editor.xray.hide(doomed)
  editor.highlight('hover', [])
  editor.select([...editor.selection].filter((m) => !editor.xray.hidden.has(m)))
  pickCycle = null
  panelNav.refresh()
}
function unhideAll(): void {
  const editor = bay?.groups
  if (!editor || editor.xray.hidden.size === 0) return
  editor.xray.unhideAll()
  pickCycle = null
  scheduleGhosts(0)
  panelNav.refresh()
}

// ghosts follow the selection, the inspected group and the camera — worked out once things rest
let ghostTimer = 0
function scheduleGhosts(delay = 60): void {
  clearTimeout(ghostTimer)
  ghostTimer = window.setTimeout(updateGhosts, delay)
}
function updateGhosts(): void {
  const editor = bay?.groups
  if (!editor) return
  if (!xrayOn || !editor.overlaysVisible) {
    if (editor.xray.ghosts.size > 0) editor.xray.setGhosts([])
    return invalidate()
  }
  const targets = editor.targets()
  const skip = new Set([...targets, ...editor.xray.hidden])
  const candidates = editor.pickable.filter((m) => !skip.has(m))
  bay!.root.updateMatrixWorld()
  const eye = camera.getWorldPosition(new THREE.Vector3())
  editor.xray.setGhosts(findOccluders(targets, candidates, eye, castMesh))
  if (rolesShowing) syncRoleTint() // tints stay off ghosted parts
  else invalidate()
}
function cameraMovedForPicking(): void {
  pickCycle = null
  if (bay?.groups.overlaysVisible && xrayOn) scheduleGhosts(160)
}

// a click (not a drag — dragging orbits) picks; hover tints what would be picked
let downAt: { x: number; y: number } | null = null
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }))
renderer.domElement.addEventListener('pointerup', (e) => {
  const start = downAt
  downAt = null
  if (!picking || !bay || !start || e.button !== 0) return
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return
  clearTimeout(hoverTimer) // a hover still pending would overwrite the tip
  const editor = bay.groups
  const stack = meshesAt(e.clientX, e.clientY)
  if (e.altKey && stack.length > 0) return openLayerMenu(e.clientX, e.clientY, stack)
  const additive = e.shiftKey || e.ctrlKey || e.metaKey
  if (stack.length === 0) {
    pickCycle = null
    if (!additive) editor.select([])
    return panelNav.refresh()
  }
  const next = cycleAt(e.clientX, e.clientY, stack)
  const index = next ?? surfaceIndex(stack)
  const mesh = stack[index]
  let added = true
  if (additive) {
    // going deeper with shift swaps the layer this spot added last for the next one
    if (next !== null && pickCycle!.added) editor.select([pickCycle!.stack[pickCycle!.index]], 'toggle')
    added = !editor.selection.has(mesh)
    editor.select([mesh], 'toggle')
  } else {
    editor.select([mesh])
  }
  pickCycle = { x: e.clientX, y: e.clientY, stack, index, added }
  showPickTip(e.clientX, e.clientY, stack, index, true)
  panelNav.refresh()
})
// hover picks only once the pointer rests (a raycast is still work on a big car)
let hoverTimer = 0
renderer.domElement.addEventListener('pointermove', (e) => {
  clearTimeout(hoverTimer)
  if (!picking || downAt || layerMenu.classList.contains('is-shown')) return // no hover work while dragging
  hoverTimer = window.setTimeout(() => {
    const stack = meshesAt(e.clientX, e.clientY)
    if (stack.length === 0) {
      pickTip.classList.remove('is-shown')
      return bay?.groups.highlight('hover', [])
    }
    const next = cycleAt(e.clientX, e.clientY, stack)
    const index = next ?? surfaceIndex(stack)
    // a part reached by going in gets its cover ghosted; the surface under the pointer doesn't need it
    bay?.groups.highlight('hover', [stack[index]], { xray: next !== null })
    showPickTip(e.clientX, e.clientY, stack, index, false)
  }, 60)
})
renderer.domElement.addEventListener('pointerleave', () => {
  clearTimeout(hoverTimer)
  pickTip.classList.remove('is-shown')
  bay?.groups.highlight('hover', [])
})
window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
  if (typing || !bay) return
  if (e.key === 'Escape') {
    if (layerMenu.classList.contains('is-shown')) return closeLayerMenu()
    if (bay.groups.selection.size === 0) return
    bay.groups.select([])
    pickCycle = null
    return panelNav.refresh()
  }
  if (e.code === 'KeyH' && bay.groups.overlaysVisible && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (e.shiftKey) unhideAll()
    else hideParts()
  }
})

const known = (id: string | null) => (id && (id === NO_CAR || findProfile(id)) ? id : null)
// uploads first: the last car shown may be one of them
void loadUploads().then(() => showCar(known(requested) ?? known(savedCar) ?? DEFAULT_CAR))

// console handle for poking at the scene: garage.camera.position.set(…), garage.scene, …
const garage: {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  renderer: THREE.WebGLRenderer
  /** the current garage's room — replaced on every garage switch */
  readonly room: Room
  /** switch garage from the console: garage.showGarage('studio') */
  showGarage: typeof showGarage
  /** move an open-air garage's sun: garage.setSun({ azimuth: -110, elevation: 8 }) */
  setSun: typeof setSun
  /** graphics from the console: garage.post.set('bloom', { intensity: 2 }) */
  post: PostProcessing
  /** repaint from the console: garage.configurator.set('body', { material: 'chrome' }) */
  configurator?: CarConfigurator
  /** the car's own lights: garage.lamps.set('head', { on: false }) */
  lamps?: LampSystem
  /** move the car: garage.placement.setActive(true) shows the gizmo; garage.placement.position */
  placement: CarPlacement
  /** redraw after changing things from the console while rendering on demand */
  invalidate: typeof invalidate
  /** the path tracer while it's switched on (Settings › Graphics) */
  readonly tracer: PathTracer | null
  /** orbit, walk or fly: garage.setCameraMode('fly') */
  setCameraMode: typeof setCameraMode
  readonly cameraMode: CameraMode
} = {
  scene,
  camera,
  controls,
  renderer,
  get room() {
    return room
  },
  showGarage,
  setSun,
  post,
  invalidate,
  placement,
  get tracer() {
    return tracer
  },
  setCameraMode,
  get cameraMode() {
    return freeCam.mode
  },
}
declare global {
  interface Window {
    garage: typeof garage
  }
}
window.garage = garage

// ─── settings that live outside the composer ────────────────────────────────
post.onChange((sections) => {
  if (sections.includes('quality')) applyQuality()
  if (sections.includes('pathTracing')) syncTracer()
  if (sections.includes('display')) {
    resize() // field of view
    fpsEl.hidden = !post.settings.display.showFps
    syncRunning()
  }
  invalidate(3)
})
// anything done in the panel (pickers, sliders, cards) may change the picture
for (const type of ['input', 'change', 'click']) app.addEventListener(type, () => invalidate())
window.addEventListener('keydown', () => invalidate())
applyQuality()

// ─── path tracing (Settings › Graphics) ──────────────────────────────────────

/** the camera moved (or is about to): back to raster, and trace again once it rests */
function noteActivity(): void {
  lastActivity = performance.now()
  tracerCameraStale = true
  clearTimeout(traceTimer)
  // on-demand drawing would otherwise never wake up to start tracing
  if (tracer) traceTimer = window.setTimeout(() => invalidate(), TRACE_DELAY + 30)
}

/** something the tracer baked changed: drop the stale image and rebuild when resting */
function traceSceneChanged(): void {
  if (!tracer) return
  tracer.invalidate()
  if (tracedShown) hideTraced()
  noteActivity()
}

function hideTraced(): void {
  post.showPathTraced(null, 0)
  tracedShown = false
  invalidate()
}

/** tracing runs while the camera rests — but not while picking parts, which needs the overlays */
function tracerWanted(now: number): boolean {
  return tracer !== null && now - lastActivity > TRACE_DELAY && !picking && !bay?.groups.overlaysVisible && !directing
}

function traceStep(): void {
  const t = tracer!
  // the camera is at the pose being drawn now, which is what the tracer must see
  if (tracerCameraStale) {
    t.cameraChanged()
    tracerCameraStale = false
  }
  t.step()
  const texture = t.texture
  // fade in over the first few samples, the first ones are noise
  post.showPathTraced(texture, Math.min(1, t.samples / 6))
  tracedShown = texture !== null
}

let tracerLoading = false
function syncTracer(): void {
  const s = post.settings.pathTracing
  if (s.enabled && !tracer) {
    // the path tracer is a big download most sessions never need — fetch it on first use
    if (!tracerLoading) {
      tracerLoading = true
      void import('./pathtrace').then(({ createPathTracer }) => {
        tracerLoading = false
        if (!post.settings.pathTracing.enabled || tracer) return
        startTracer(createPathTracer)
        syncTracer()
      })
    }
    return
  } else if (!s.enabled && tracer) {
    tracer.dispose()
    tracer = null
    if (tracedShown) hideTraced()
  }
  tracer?.setOptions(s)
  invalidate()
}

function startTracer(createPathTracer: typeof import('./pathtrace').createPathTracer): void {
  {
    tracer = createPathTracer(renderer, {
      scene,
      camera,
      // the baked contact shadow is a raster stand-in for what tracing does for real
      hidden: () => (bay ? [bay.shadow] : []),
      // the floor surface is see-through only to let the raster mirror show
      opaque: () => room.floorLayers.slice(0, 1),
      onReady: () => {
        tracerCameraStale = true
        invalidate(2)
      },
    })
    noteActivity()
  }
}
renderer.domElement.addEventListener('pointerdown', () => tracer && noteActivity())
renderer.domElement.addEventListener('wheel', () => tracer && noteActivity(), { passive: true })
syncTracer()

// ─── frame loop ─────────────────────────────────────────────────────────────
const timer = new THREE.Timer()
let rafId = 0
let lastFrameAt = 0

function frame(timestamp: number): void {
  rafId = requestAnimationFrame(frame)
  if (directing) return // the director draws its own frames
  tickFps(timestamp)
  const { fpsCap, onDemand } = post.settings.display
  if (fpsCap > 0) {
    const interval = 1000 / fpsCap
    const since = timestamp - lastFrameAt
    if (since < interval - 1) return
    // step the schedule by whole intervals so the cap doesn't drift below target
    lastFrameAt = since < interval * 2 ? lastFrameAt + interval : timestamp
  }

  timer.update(timestamp)
  const dt = Math.min(timer.getDelta(), 0.05)
  const orbiting = freeCam.mode === 'orbit'
  if (orbiting ? updateControls(dt) : freeCam.update(dt)) {
    invalidate() // includes damping settling after a drag
    noteActivity()
    cameraMovedForPicking()
  }
  const tracing = tracerWanted(timestamp)
  if (tracing && tracer!.status === 'tracing') invalidate(1) // keep sampling until it's done
  if (!tracing && tracedShown) hideTraced()
  if (onDemand && dirtyFrames === 0) return
  dirtyFrames = Math.max(0, dirtyFrames - 1)

  bay?.configurator.update()
  room.update?.(dt)
  // no mode is held inside the room (videos still are, see videoStage.draw): the lens as set
  if (camera.fov !== baseFov) {
    camera.fov = baseFov
    camera.updateProjectionMatrix()
  }
  if (tracing) traceStep()
  post.render(dt)
  framesDrawn++
}

/**
 * A hidden tab never draws — the loop is cancelled outright, not just
 * throttled — and optionally neither does an unfocused window.
 */
function syncRunning(): void {
  const run = !document.hidden && !(post.settings.display.pauseUnfocused && !document.hasFocus())
  if (run && !rafId) {
    rafId = requestAnimationFrame(frame)
    invalidate()
  } else if (!run && rafId) {
    cancelAnimationFrame(rafId)
    rafId = 0
    fpsEl.textContent = 'paused'
  }
}
document.addEventListener('visibilitychange', syncRunning)
window.addEventListener('blur', syncRunning)
window.addEventListener('focus', syncRunning)
syncRunning()
