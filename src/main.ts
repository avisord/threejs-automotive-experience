import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
//import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { createBalls, disposeBall, type Ball } from './balls'
import type { SurfaceOptions } from './materials'
import { listSurfaces, registerSurface } from './materials'
import { DEFAULT_COMPOSITION } from './composition'
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
const BG_COLOR = 0x12152b // deep indigo — tweak freely, fog follows automatically
scene.background = new THREE.Color(BG_COLOR)
scene.fog = new THREE.Fog(BG_COLOR, 70, 170)

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300)
camera.position.set(0, 9, 34)
camera.lookAt(0, 9, 0)

// image-based lighting for realistic reflections on metal/glass
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55

// key light with soft shadows
//const keyLight = new THREE.DirectionalLight(0xfff2e0, 2.4)
//keyLight.position.set(14, 28, 18)
//keyLight.castShadow = true
//keyLight.shadow.mapSize.set(2048, 2048)
//keyLight.shadow.camera.left = -30
//keyLight.shadow.camera.right = 30
//keyLight.shadow.camera.top = 30
//keyLight.shadow.camera.bottom = -10
//keyLight.shadow.camera.far = 80
//keyLight.shadow.bias = -0.0005
//keyLight.shadow.radius = 6
//scene.add(keyLight)

const rimLight = new THREE.DirectionalLight(0x6a8fff, 0.8)
rimLight.position.set(-18, 10, -14)
scene.add(rimLight)

// glossy dark floor
const floorMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x445370,
  roughness: 0.85,
  metalness: 0,
  clearcoat: 0,
  envMapIntensity: 0.15, // don't mirror the bright room env
  specularIntensity: 0.2,
})
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), floorMaterial)
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)

// ground glow — an area light lying on the floor, shining straight up
//RectAreaLightUniformsLib.init()
//const groundLight = new THREE.RectAreaLight(0x3d5aff, 0, 40, 14)
//groundLight.position.set(0, 0.05, 0)
//groundLight.lookAt(0, 10, 0)
//scene.add(groundLight)

/** Set the ground's light emission; intensity 0 switches it off. */
function setGroundGlow(color: THREE.ColorRepresentation = 0x3d5aff, intensity = 1.5): void {
  //groundLight.color.set(color)
  //groundLight.intensity = intensity
  // faint surface glow so the floor itself looks like the light source
  floorMaterial.emissive.set(color)
  floorMaterial.emissiveIntensity = intensity * 0.03
}

// play-area bounds derived from what the camera can actually see at z = 0
const bounds: Bounds = { x: 20, z: 4, ceiling: 24 }
function updateBounds(): void {
  const dist = camera.position.z
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist
  bounds.x = Math.max(6, halfH * camera.aspect - 2)
  bounds.ceiling = camera.position.y + halfH
  //groundLight.width = bounds.x * 2
  //groundLight.height = bounds.z * 2 + 8
}
updateBounds()
setGroundGlow(0x3d5aff, 1.2)

const balls = createBalls(DEFAULT_COMPOSITION, bounds)
for (const b of balls) scene.add(b.mesh)

setupDragging(renderer.domElement, camera, balls)

// runtime composition API — play with the scene from the browser console
const ballpit = {
  surfaces: listSurfaces,
  register: registerSurface,
  add(surface: string, radius = 1.2, options?: SurfaceOptions, count = 1): Ball[] {
    const added = createBalls([{ surface, radius, options, count }], bounds)
    for (const ball of added) {
      scene.add(ball.mesh)
      balls.push(ball)
    }
    return added
  },
  /** random assortment: n balls drawn from the registered surfaces */
  fill(n: number, minRadius = 0.7, maxRadius = 1.8): Ball[] {
    const names = listSurfaces()
    return Array.from({ length: n }, () => {
      const surface = names[Math.floor(Math.random() * names.length)]
      const radius = minRadius + Math.random() * (maxRadius - minRadius)
      return ballpit.add(surface, radius)[0]
    })
  },
  count: () => balls.length,
  /** light the scene from the floor: ballpit.groundGlow(0xff2266, 2) · off: ballpit.groundGlow(0, 0) */
  groundGlow: setGroundGlow,
  remove(ball: Ball): void {
    const i = balls.indexOf(ball)
    if (i === -1) return
    balls.splice(i, 1)
    scene.remove(ball.mesh)
    disposeBall(ball)
  },
  clear(): void {
    while (balls.length > 0) ballpit.remove(balls[balls.length - 1])
  },
  list: () => [...balls],
}
declare global {
  interface Window {
    ballpit: typeof ballpit
  }
}
window.ballpit = ballpit
console.info('[ballpit] registry API ready — try: ballpit.surfaces() · ballpit.add("glass", 2.5) · ballpit.add("neon", 1, { color: 0x00ff88 })')

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
const MAX_STEP = 1 / 120

function animate(): void {
  requestAnimationFrame(animate)
  // substep so physics advances exactly one frame's worth of time each render —
  // a fixed-step accumulator judders on displays that aren't a multiple of the step rate
  const dt = Math.min(clock.getDelta(), 0.05)
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP))
  const h = dt / steps
  for (let i = 0; i < steps; i++) stepPhysics(balls, h, bounds)
  composer.render()
  tickFps()
}
animate()
