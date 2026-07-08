import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { createBalls, disposeBall, type Ball } from './balls'
import type { SurfaceOptions } from './materials'
import { listSurfaces, registerSurface } from './materials'
import { stepPhysics, type Bounds } from './physics'
import { setupDragging } from './drag'
import { createModuleHost, type SceneContext } from './modules/module'
import type { backgroundModule } from './modules/background'
import type { floorModule } from './modules/floor'
import { SCENES, type SceneName } from './scenes'
import './style.css'

// ─── SWITCH SCENE HERE ──────────────────────────────────────────────────────
const ACTIVE_SCENE: SceneName = 'neon-pit'
// ────────────────────────────────────────────────────────────────────────────

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

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 300)
camera.position.set(0, 9, 34)
camera.lookAt(0, 9, 0)

// play-area bounds derived from what the camera can actually see at z = 0
const bounds: Bounds = { x: 20, z: 4, ceiling: 24 }
function updateBounds(): void {
  const dist = camera.position.z
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist
  bounds.x = Math.max(6, halfH * camera.aspect - 2)
  bounds.ceiling = camera.position.y + halfH
}
updateBounds()

const ctx: SceneContext = { scene, camera, renderer, bounds }
const modules = createModuleHost(ctx)
const balls: Ball[] = []

/** Tear down the current world and build the given scene. */
function loadScene(name: SceneName): void {
  const def = SCENES[name]
  while (balls.length > 0) {
    const ball = balls.pop()!
    scene.remove(ball.mesh)
    disposeBall(ball)
  }
  for (const moduleName of modules.list()) modules.remove(moduleName)
  for (const m of def.createModules()) modules.add(m)
  for (const ball of createBalls(def.composition, bounds)) {
    scene.add(ball.mesh)
    balls.push(ball)
  }
  console.info(`[ballpit] scene "${name}" loaded`)
}
loadScene(ACTIVE_SCENE)

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
  /** switch the whole world: ballpit.scene('studio') */
  scene: loadScene,
  scenes: () => Object.keys(SCENES) as SceneName[],
  /** light the scene from the floor: ballpit.groundGlow(0xff2266, 2) · off: ballpit.groundGlow(0, 0) */
  groundGlow(color?: THREE.ColorRepresentation, intensity?: number): void {
    ;(modules.get('floor') as ReturnType<typeof floorModule> | undefined)?.setGlow(color, intensity)
  },
  /** change the background/fog color: ballpit.background(0x1a1420) */
  background(color: THREE.ColorRepresentation): void {
    ;(modules.get('background') as ReturnType<typeof backgroundModule> | undefined)?.setColor(color)
  },
  /** scene module host — ballpit.modules.list(), .add(), .remove('lighting') */
  modules,
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
console.info('[ballpit] registry API ready — try: ballpit.surfaces() · ballpit.add("glass", 2.5) · ballpit.modules.list()')

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
  modules.resize()
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
  modules.update(dt)
  composer.render()
  tickFps()
}
animate()
