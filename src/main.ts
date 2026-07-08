import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { createBalls } from './balls'
import { stepPhysics, type Bounds } from './physics'
import { setupDragging } from './drag'
import './style.css'

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
scene.background = new THREE.Color(0x0b0d12)
scene.fog = new THREE.Fog(0x0b0d12, 70, 160)

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300)
camera.position.set(0, 9, 34)
camera.lookAt(0, 9, 0)

// image-based lighting for realistic reflections on metal/glass
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55

// key light with soft shadows
const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4)
keyLight.position.set(14, 28, 18)
keyLight.castShadow = true
keyLight.shadow.mapSize.set(2048, 2048)
keyLight.shadow.camera.left = -30
keyLight.shadow.camera.right = 30
keyLight.shadow.camera.top = 30
keyLight.shadow.camera.bottom = -10
keyLight.shadow.camera.far = 80
keyLight.shadow.bias = -0.0005
keyLight.shadow.radius = 6
scene.add(keyLight)

const rimLight = new THREE.DirectionalLight(0x6a8fff, 0.8)
rimLight.position.set(-18, 10, -14)
scene.add(rimLight)

// glossy dark floor
const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(400, 400),
  new THREE.MeshPhysicalMaterial({
    color: 0x101216,
    roughness: 0.85,
    metalness: 0,
    clearcoat: 0,
    envMapIntensity: 0.15, // don't mirror the bright room env
    specularIntensity: 0.2,
  }),
)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// play-area bounds derived from what the camera can actually see at z = 0
const bounds: Bounds = { x: 20, z: 4, ceiling: 24 }
function updateBounds(): void {
  const dist = camera.position.z
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist
  bounds.x = Math.max(6, halfH * camera.aspect - 2)
  bounds.ceiling = camera.position.y + halfH
}
updateBounds()

const balls = createBalls(bounds)
for (const b of balls) scene.add(b.mesh)

setupDragging(renderer.domElement, camera, balls)

// bloom makes the emissive balls actually glow
const composer = new EffectComposer(renderer)
composer.addPass(new RenderPass(scene, camera))
const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.07, // strength — barely-there halo
  0.02, // radius — keep the glow hugging the ball surface
  1.2, // threshold — only the brightest (emissive) surfaces bloom
)
composer.addPass(bloom)
composer.addPass(new OutputPass())

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  updateBounds()
})

const hint = document.createElement('div')
hint.className = 'hint'
hint.textContent = 'drag a ball · throw it · watch it fall'
app.appendChild(hint)

const clock = new THREE.Clock()
const FIXED_DT = 1 / 120

let accumulator = 0
function animate(): void {
  requestAnimationFrame(animate)
  // fixed-step physics so behavior is identical across refresh rates
  accumulator += Math.min(clock.getDelta(), 0.05)
  while (accumulator >= FIXED_DT) {
    stepPhysics(balls, FIXED_DT, bounds)
    accumulator -= FIXED_DT
  }
  composer.render()
}
animate()
