import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { DEFAULT_GARAGE, GARAGES, collectGlowMeshes, type GarageDef, type Room } from './garages'
import { disposeCar, loadCar } from './car'
import { CARS, DEFAULT_CAR, NO_CAR, carTitle } from './cars'
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
import { createGroupEditor, type GroupEditor } from './groups'
import { createLampSystem, type LampSystem } from './lights'
import { lightsPage } from './ui/lights-page'
import type { PathTracer } from './pathtrace'
import type { SunPosition } from './garages/sky'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { DEFAULT_CAR_SIZE, type CameraPose } from './camera-moves'
import type { Stage } from './director'
import { videoPage } from './ui/video-page'
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
controls.maxDistance = 10
controls.update()

// ─── keyboard zoom: + / - ───────────────────────────────────────────────────
const KEY_ZOOM_STEP = 0.18 // ln(distance ratio) per press, ≈ 20%
let zoomPending = 0 // zoom still to apply, eased out over a few frames
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return // leave browser page zoom alone
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
const orbitPosition = new THREE.Vector3()
const offset = new THREE.Vector3()
/**
 * If the orbit position is outside the room, render from a point pulled in
 * toward the target and widen the FOV to keep the same framing (a dolly-zoom),
 * so a top view under the ceiling still fits the whole car. The orbit
 * position itself is left untouched — see restoreOrbitCamera().
 */
function fitCameraInRoom(): void {
  orbitPosition.copy(camera.position)
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
/** hand OrbitControls back its unclamped position so zoom distance isn't lost */
function restoreOrbitCamera(): void {
  camera.position.copy(orbitPosition)
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

let recaptureTimer = 0
/** move the sun of an open-air room; the environment catches up once the slider rests */
function setSun(sun: SunPosition): void {
  if (!room.sun) return
  room.sun.set(sun)
  savedSuns[garageDef.id] = sun
  try {
    localStorage.setItem(SUN_KEY, JSON.stringify(savedSuns))
  } catch {
    // not remembered — fine
  }
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
const hint = document.createElement('div')
hint.className = 'hint'
hint.textContent = 'drag to orbit · scroll or +/− to zoom'
app.appendChild(hint)

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
}
let loadingId: string | null = null
const CAR_KEY = 'garage.car.v1'

/** swap the car in the bay; a newer request supersedes one still loading */
/** take the car out of the bay and free it */
function clearBay(): void {
  if (!bay) return
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
  const profile = CARS.find((c) => c.id === id) ?? CARS[0]
  loadingId = profile.id
  loader.classList.remove('done')
  loader.querySelector('.loader-label')!.textContent = `loading ${carTitle(profile)}`
  loaderFill.style.transform = 'scaleX(0)'
  panelNav?.refresh()
  try {
    const root = await loadCar(profile, (f) => (loaderFill.style.transform = `scaleX(${f})`))
    if (loadingId !== profile.id) {
      disposeCar(root) // the user picked another car meanwhile
      return
    }
    clearBay()
    scene.add(root)
    const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3())
    const shadow = bakeContactShadow(renderer, root, { width: size.x + 1.4, depth: size.z + 1.4, height: 0.9 })
    scene.add(shadow)
    room.floorLayers.push(shadow)
    const configurator = createConfigurator(root, profile, traceSceneChanged)
    applyAnisotropy(root)
    const groups = createGroupEditor(root, profile, configurator.carSpace, (materials) => {
      invalidate()
      post.refreshGlow()
      if (materials) traceSceneChanged()
    })
    groups.setOverlaysVisible(false) // the Parts page shows them
    const lamps = createLampSystem(root, profile, () => {
      invalidate()
      post.refreshGlow()
      traceSceneChanged()
    })
    bay = { id: profile.id, root, shadow, configurator, groups, lamps, size }
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
  post.setAtmosphere(room.atmosphere ?? null)
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
      if (tracedShown) hideTraced()
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

// ─── side panel: Menu › Garage · Collection · Car · Parts · Settings ───────
/** Menu › Parts: clicks on the car select parts (declared before the panel renders) */
let picking = false
const pages: Record<string, Page> = {
  menu: {
    title: 'Menu',
    render: (body, nav) =>
      body.append(menuList(pages, ['garage', 'collection', 'car', 'parts', 'lights', 'video', 'settings'], nav)),
  },
  garage: garagePage({
    current: () => garageDef.id,
    switching: () => switchingTo,
    select: (id) => void showGarage(id),
    sun: () => room.sun?.get() ?? null,
    setSun,
  }),
  collection: collectionPage({
    current: () => bay?.id ?? (loadingId ? null : NO_CAR),
    loading: () => loadingId,
    select: (id) => void showCar(id),
  }),
  car: carPage(() => bay?.configurator, bayPlaceholder),
  lights: lightsPage(() => bay?.lamps, bayPlaceholder),
  parts: partsPage({
    editor: () => bay?.groups,
    picking: () => picking,
    setPicking,
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
const HINT = 'drag to orbit · scroll or +/− to zoom'
const PICK_HINT = 'click a part to select · shift+click to add · alt+click picks behind · esc clears'
function setPicking(on: boolean): void {
  picking = on
  renderer.domElement.style.cursor = on ? 'crosshair' : ''
  hint.textContent = on ? PICK_HINT : HINT
  if (!on) bay?.groups.highlight('hover', [])
  invalidate()
}

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
/** meshes under a canvas point, nearest first, one entry per mesh */
function meshesAt(clientX: number, clientY: number): THREE.Mesh[] {
  if (!bay) return []
  const rect = renderer.domElement.getBoundingClientRect()
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  // camera.matrixWorld is still the pose last drawn (fitCameraInRoom), so rays match the picture
  raycaster.setFromCamera(ndc, camera)
  const seen = new Set<THREE.Object3D>()
  const out: THREE.Mesh[] = []
  for (const hit of raycaster.intersectObjects(bay.groups.pickable, false)) {
    if (seen.has(hit.object)) continue
    seen.add(hit.object)
    out.push(hit.object as THREE.Mesh)
  }
  return out
}

// a click (not a drag — dragging orbits) picks; hover tints what would be picked
let downAt: { x: number; y: number } | null = null
renderer.domElement.addEventListener('pointerdown', (e) => (downAt = { x: e.clientX, y: e.clientY }))
renderer.domElement.addEventListener('pointerup', (e) => {
  const start = downAt
  downAt = null
  if (!picking || !bay || !start || e.button !== 0) return
  if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return
  const hits = meshesAt(e.clientX, e.clientY)
  const mesh = e.altKey ? hits[1] ?? hits[0] : hits[0]
  const additive = e.shiftKey || e.ctrlKey || e.metaKey
  if (mesh) bay.groups.select([mesh], additive ? 'toggle' : 'replace')
  else if (!additive) bay.groups.select([])
  panelNav.refresh()
})
// hover picks only once the pointer rests — a raycast over a million-triangle
// car takes tens of ms, too much to repeat on every pointermove
let hoverTimer = 0
renderer.domElement.addEventListener('pointermove', (e) => {
  clearTimeout(hoverTimer)
  if (!picking || downAt) return // no hover work while dragging
  hoverTimer = window.setTimeout(() => {
    const hits = meshesAt(e.clientX, e.clientY)
    const mesh = e.altKey ? hits[1] ?? hits[0] : hits[0]
    bay?.groups.highlight('hover', mesh ? [mesh] : [])
  }, 60)
})
renderer.domElement.addEventListener('pointerleave', () => bay?.groups.highlight('hover', []))
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !bay || bay.groups.selection.size === 0) return
  bay.groups.select([])
  panelNav.refresh()
})

const known = (id: string | null) => (id && (id === NO_CAR || CARS.some((c) => c.id === id)) ? id : null)
void showCar(known(requested) ?? known(savedCar) ?? DEFAULT_CAR)

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
  /** redraw after changing things from the console while rendering on demand */
  invalidate: typeof invalidate
  /** the path tracer while it's switched on (Settings › Graphics) */
  readonly tracer: PathTracer | null
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
  get tracer() {
    return tracer
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
  // the camera is at the pose being drawn now (fitCameraInRoom), which is what the tracer must see
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
  if (updateControls(dt)) {
    invalidate() // includes damping settling after a drag
    noteActivity()
  }
  const tracing = tracerWanted(timestamp)
  if (tracing && tracer!.status === 'tracing') invalidate(1) // keep sampling until it's done
  if (!tracing && tracedShown) hideTraced()
  if (onDemand && dirtyFrames === 0) return
  dirtyFrames = Math.max(0, dirtyFrames - 1)

  bay?.configurator.update()
  room.update?.(dt)
  fitCameraInRoom()
  if (tracing) traceStep()
  post.render(dt)
  restoreOrbitCamera()
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
