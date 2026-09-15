import * as THREE from 'three'
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js'
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js'

export interface ContactShadowOptions {
  /** shadow plane size along x */
  width: number
  /** shadow plane size along z */
  depth: number
  /** only geometry below this height darkens the ground — closer = darker */
  height: number
  resolution?: number
  blur?: number
  darkness?: number
  opacity?: number
}

/**
 * Bake a soft ground shadow for a static object: render its depth from below
 * with an ortho camera, blur it, and lay the result on a floor plane. Runs
 * once — re-bake if the object moves.
 */
export function bakeContactShadow(
  renderer: THREE.WebGLRenderer,
  object: THREE.Object3D,
  opts: ContactShadowOptions,
): THREE.Mesh {
  const { width, depth, height, resolution = 1024, blur = 3, darkness = 1.5, opacity = 0.95 } = opts

  const target = new THREE.WebGLRenderTarget(resolution, resolution)
  const scratch = new THREE.WebGLRenderTarget(resolution, resolution)

  const center = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3())
  const cam = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, height)
  cam.rotation.x = Math.PI / 2 // look straight up; image-up ends up along +z
  cam.position.set(center.x, 0, center.z)
  cam.updateMatrixWorld()

  // alpha = how close the surface is to the ground
  const depthMat = new THREE.MeshDepthMaterial()
  depthMat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      'gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );',
      `gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * ${darkness.toFixed(3)} );`,
    )
  }
  depthMat.side = THREE.DoubleSide

  const bakeScene = new THREE.Scene()
  bakeScene.overrideMaterial = depthMat

  const prevTarget = renderer.getRenderTarget()
  const prevClear = renderer.getClearColor(new THREE.Color())
  const prevAlpha = renderer.getClearAlpha()

  // borrow the object into a scene of its own so overrideMaterial applies only to it
  const parent = object.parent
  bakeScene.add(object)
  renderer.setClearColor(0x000000, 0)
  renderer.setRenderTarget(target)
  renderer.clear()
  renderer.render(bakeScene, cam)
  parent?.add(object)

  const hBlur = new THREE.ShaderMaterial({
    ...HorizontalBlurShader,
    uniforms: THREE.UniformsUtils.clone(HorizontalBlurShader.uniforms),
    depthTest: false,
  })
  const vBlur = new THREE.ShaderMaterial({
    ...VerticalBlurShader,
    uniforms: THREE.UniformsUtils.clone(VerticalBlurShader.uniforms),
    depthTest: false,
  })
  const quad = new FullScreenQuad()
  const blurPass = (amount: number) => {
    quad.material = hBlur
    hBlur.uniforms.tDiffuse.value = target.texture
    hBlur.uniforms.h.value = amount / 256
    renderer.setRenderTarget(scratch)
    quad.render(renderer)

    quad.material = vBlur
    vBlur.uniforms.tDiffuse.value = scratch.texture
    vBlur.uniforms.v.value = amount / 256
    renderer.setRenderTarget(target)
    quad.render(renderer)
  }
  blurPass(blur)
  blurPass(blur * 0.4) // second, tighter pass smooths the box-filter banding

  renderer.setRenderTarget(prevTarget)
  renderer.setClearColor(prevClear, prevAlpha)
  quad.dispose()
  hBlur.dispose()
  vBlur.dispose()
  depthMat.dispose()
  scratch.dispose()

  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      map: target.texture,
      color: 0x000000,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  )
  plane.rotation.x = -Math.PI / 2
  plane.scale.y = -1 // the bake camera looks up, so flip to match
  plane.position.set(center.x, 0.004, center.z)
  plane.renderOrder = 1
  plane.userData.renderTarget = target
  return plane
}

export function disposeContactShadow(plane: THREE.Mesh): void {
  ;(plane.userData.renderTarget as THREE.WebGLRenderTarget).dispose()
  plane.geometry.dispose()
  ;(plane.material as THREE.Material).dispose()
}
