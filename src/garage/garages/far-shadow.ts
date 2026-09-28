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
 * Light the sunlit ground throws back up onto the landscape (linear irradiance, 0 = none): an
 * open-air room sets it from its sun and ground (coast/world.ts) and clears it when it goes. Only
 * landscape materials take it — the car, the terrace and the rooms see the sunlit ground in their
 * environment map already.
 */
export const GROUND_BOUNCE = { value: new THREE.Color(0, 0, 0) }

/**
 * Light the sunlit walls round a street throw across it (linear irradiance, 0 = none): in a street
 * canyon the shaded road and the shaded facades are lit as much by the sunny facades opposite as by
 * the sky — without it the shade got only blue sky light and went navy. Every face takes it (the
 * ground a little less than a wall: it sees more sky). Set by a street room from its sun, cleared
 * when it goes.
 */
export const WALL_BOUNCE = { value: new THREE.Color(0, 0, 0) }

/**
 * three's light loop with the point, spot and area lights compiled out. Out in
 * the landscape they light nothing — the pavilion's area lights and the car's
 * lamp spots are metres away and aimed inside — yet every landscape pixel paid
 * for them: an area light costs ~1.6 ms a frame at 1080p on an RX 7600, and each
 * lamp spot a shadow-map lookup. Only the sun, the far shadow, the hemisphere
 * and the sky's environment light the land.
 */
const outdoorLightLoop = THREE.ShaderChunk.lights_fragment_begin
  .replace('#if ( NUM_POINT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0')
  .replace('#if ( NUM_SPOT_LIGHTS > 0 ) && defined( RE_Direct )', '#if 0')
  .replace('#if ( NUM_RECT_AREA_LIGHTS > 0 ) && defined( RE_Direct_RectArea )', '#if 0')
if ((outdoorLightLoop.match(/#if 0/g) ?? []).length !== 3) console.warn('[garage] three light loop changed: landscape still evaluates indoor lights')

/**
 * Let a landscape material take its shadow from the far map where the near
 * one doesn't reach. Inside the near map's footprint the near shadow (already
 * applied by three) rules; toward its edge the far one fades in. The material
 * also stops evaluating the indoor lights (see outdoorLightLoop).
 */
export function receiveFarShadow(material: THREE.Material): void {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    shader.uniforms.uGroundBounce = GROUND_BOUNCE
    shader.uniforms.uWallBounce = WALL_BOUNCE
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGroundBounce;\nuniform vec3 uWallBounce;')
      .replace('#include <lights_fragment_begin>', outdoorLightLoop).replace(
      fragmentHook,
      `${fragmentHook}
      {
        // bounce off the sunlit ground: a Lambertian plane below lights a face turned down with its full
        // radiosity, a wall with half, a face turned up not at all — the light under palm crowns, in
        // the shade of a bush, up a cliff's overhang (AO darkens it after, where the ground is enclosed)
        float down = 0.5 - 0.5 * inverseTransformDirection( normal, viewMatrix ).y;
        #ifdef CROWN_NORMALS
          // (a crown's normal is the crown's, up and out; its leaves face every way, a good part of them the ground)
          down = max( down, 0.4 );
        #endif
        reflectedLight.indirectDiffuse += uGroundBounce * down * BRDF_Lambert( material.diffuseColor );
        // the street's sunlit walls, seen from everywhere in it (a face turned up sees the least of them)
        reflectedLight.indirectDiffuse += uWallBounce * ( 1.0 - 0.45 * max( 0.0, 1.0 - 2.0 * down ) ) * BRDF_Lambert( material.diffuseColor );
      }
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
