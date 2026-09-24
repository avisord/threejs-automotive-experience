import * as THREE from 'three'

/**
 * Sun shadows for a whole landscape, next to the sharp near-field ones.
 *
 * The sun's own shadow map covers the building and its surroundings finely
 * (±45 m). Past that, nothing shadowed anything: sunlit and shaded ground
 * looked the same. A second, invisible directional light (intensity 0) with
 * a coarse shadow map over the whole landscape fills in — tree shadows on the
 * grass, the shaded side of hills and of the mountain, trees shading their
 * own lower branches. three renders its map (alpha-tested needles included);
 * the landscape's materials read it through the patch below.
 *
 * It must be added to the scene right after the sun, so it's the second
 * shadow-casting directional light (index 1; the sun is 0).
 */
export function createFarShadowLight(): THREE.DirectionalLight {
  const light = new THREE.DirectionalLight(0xffffff, 0) // casts, never lights
  light.name = 'far-shadow'
  light.castShadow = true
  light.shadow.mapSize.set(4096, 4096)
  // the real-scale land reaches 3.3 km out; 6.8 km across 4096 texels ≈ 1.7 m a texel — a tree crown is several
  Object.assign(light.shadow.camera, { left: -3400, right: 3400, top: 3400, bottom: -3400, near: 100, far: 12000 })
  light.shadow.camera.updateProjectionMatrix()
  light.shadow.bias = -0.0004
  light.shadow.normalBias = 1.8 // coarse texels on long gentle slopes: push well clear of acne
  light.shadow.radius = 2
  light.shadow.autoUpdate = false // re-rendered when the sun moves or the trees arrive
  return light
}

/** place the far light for a sun direction (the landscape is centred on the origin) */
export function aimFarShadow(light: THREE.DirectionalLight, sunDirection: THREE.Vector3): void {
  light.position.copy(sunDirection).multiplyScalar(6000)
  light.shadow.needsUpdate = true
}

const fragmentHook = '#include <lights_fragment_end>'

/**
 * Let a landscape material take its shadow from the far map where the near
 * one doesn't reach. Inside the near map's footprint the near shadow (already
 * applied by three) rules; toward its edge the far one fades in.
 */
export function receiveFarShadow(material: THREE.Material): void {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    shader.fragmentShader = shader.fragmentShader.replace(
      fragmentHook,
      `${fragmentHook}
      #if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
      {
        // how far inside the near (sharp) map this point is: 0 at its edge, 1 well inside
        vec3 nearCoord = vDirectionalShadowCoord[ 0 ].xyz / vDirectionalShadowCoord[ 0 ].w;
        vec2 edge = min( nearCoord.xy, 1.0 - nearCoord.xy );
        float inNear = smoothstep( 0.0, 0.06, min( edge.x, edge.y ) );
        DirectionalLightShadow farShadow = directionalLightShadows[ 1 ];
        float farLit = getShadow( directionalShadowMap[ 1 ], farShadow.shadowMapSize, farShadow.shadowIntensity,
          farShadow.shadowBias, farShadow.shadowRadius, vDirectionalShadowCoord[ 1 ] );
        float lit = mix( farLit, 1.0, inNear );
        reflectedLight.directDiffuse *= lit;
        reflectedLight.directSpecular *= lit;
      }
      #endif`,
    )
  }
  // one program for every material patched this way, not one per material instance
  const key = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () => `far-shadow|${key()}`
  material.needsUpdate = true
}
