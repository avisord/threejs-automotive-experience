import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import './style.css'

// garage bay dimensions (metres-ish): x = width, y = height, z = depth
const ROOM = { w: 24, h: 7, d: 30 }
const ACCENT = 0x35e0ff

const app = document.querySelector<HTMLDivElement>('#app')!

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
app.appendChild(renderer.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x07080b)

// soft studio reflections so metal and the glossy floor have something to mirror
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.25
pmrem.dispose()

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200)
camera.position.set(9, 3.2, 13)

const controls = new OrbitControls(camera, renderer.domElement)
controls.target.set(0, 1, 0)
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2 - 0.05 // never dip below the floor
controls.minDistance = 4
controls.maxDistance = 22
controls.update()

// ─── room shell ─────────────────────────────────────────────────────────────
RectAreaLightUniformsLib.init()

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(ROOM.w, ROOM.d),
  new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.22, metalness: 0.5 }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// walls + ceiling as the inside of a box (BackSide so we see the interior faces)
const shell = new THREE.Mesh(
  new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d),
  new THREE.MeshStandardMaterial({ color: 0x1c1f26, roughness: 0.85, metalness: 0.1, side: THREE.BackSide }),
)
shell.position.y = ROOM.h / 2
shell.receiveShadow = true
scene.add(shell)

// ceiling LED strips — emissive bar for the look, rect area light for the actual light
const stripMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xffffff, emissiveIntensity: 3 })
for (const x of [-6, 0, 6]) {
  const bar = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, ROOM.d * 0.7), stripMat)
  bar.position.set(x, ROOM.h - 0.04, 0)
  scene.add(bar)

  const light = new THREE.RectAreaLight(0xe8f4ff, 6, 0.25, ROOM.d * 0.7)
  light.position.set(x, ROOM.h - 0.08, 0)
  light.lookAt(x, 0, 0)
  scene.add(light)
}

// ─── display platform (placeholder hero spot) ───────────────────────────────
const platform = new THREE.Group()
scene.add(platform)

const disc = new THREE.Mesh(
  new THREE.CylinderGeometry(4.2, 4.4, 0.18, 96),
  new THREE.MeshStandardMaterial({ color: 0x0e1014, roughness: 0.3, metalness: 0.8 }),
)
disc.position.y = 0.09
disc.receiveShadow = true
disc.castShadow = true
platform.add(disc)

const ring = new THREE.Mesh(
  new THREE.TorusGeometry(4.3, 0.03, 12, 160),
  new THREE.MeshStandardMaterial({ color: 0x000000, emissive: ACCENT, emissiveIntensity: 4 }),
)
ring.rotation.x = Math.PI / 2
ring.position.y = 0.19
platform.add(ring)

// key spot from above so objects on the platform cast a crisp shadow
const spot = new THREE.SpotLight(0xffffff, 120, 20, Math.PI / 7, 0.5, 2)
spot.position.set(0, ROOM.h - 0.3, 0)
spot.target.position.set(0, 0, 0)
spot.castShadow = true
spot.shadow.mapSize.set(1024, 1024)
spot.shadow.bias = -0.0005
scene.add(spot, spot.target)

// ─── post ───────────────────────────────────────────────────────────────────
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
composer.addPass(
  new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.35, // strength
    0.4, // radius
    1.1, // threshold — only emissive strips and accents bloom
  ),
)
composer.addPass(new OutputPass())

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
})

// ─── hud ────────────────────────────────────────────────────────────────────
const hint = document.createElement('div')
hint.className = 'hint'
hint.textContent = 'drag to orbit · scroll to zoom'
app.appendChild(hint)

const fpsEl = document.createElement('div')
fpsEl.className = 'fps'
fpsEl.textContent = '— fps'
app.appendChild(fpsEl)

let frameCount = 0
let fpsWindowStart = performance.now()
function tickFps(): void {
  frameCount++
  const now = performance.now()
  const elapsed = now - fpsWindowStart
  if (elapsed >= 500) {
    fpsEl.textContent = `${Math.round((frameCount * 1000) / elapsed)} fps`
    frameCount = 0
    fpsWindowStart = now
  }
}

const clock = new THREE.Clock()

function animate(): void {
  requestAnimationFrame(animate)
  const dt = Math.min(clock.getDelta(), 0.05)
  platform.rotation.y += dt * 0.15 // slow showroom turntable
  controls.update()
  composer.render()
  tickFps()
}
animate()
