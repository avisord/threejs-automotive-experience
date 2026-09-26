import * as THREE from 'three'
import { noRaycast, polarGrid } from '../landform'
import { receiveFarShadow } from '../far-shadow'
import { OUTDOOR_SKY_LIGHT } from '../sky'
import { COAST, SEA, SURF, SURF_GLSL, mapFar, shoreTexture } from './site'

/**
 * The sea, from the rocks below the garage out past the horizon.
 *
 * One surface in real metres, mapped into the far compression (site.mapFar,
 * the Earth's curve included), lit by three's physical model: the sun's
 * specular on the waves (a sparkle close in, widening to a glitter path far
 * out where the waves are sub-pixel and their slopes become roughness), the
 * sky's reflection from the outdoor environment map with water's Fresnel —
 * no mirror pass. The waves are normals only (per pixel, in real metres):
 * a few swells rolling in from the open sea, shorter wind waves over them,
 * and fine chop — each faded out once it's smaller than a pixel.
 *
 * Near the coast (the shore field, site.shoreTexture): the water's colour
 * follows its depth — deep blue offshore, blue-green, turquoise over the
 * sand, shallow sandy water — breakers roll in toward the shore, steepen and
 * break into foam lines over the shallows, surf churns round the rocks, and
 * the foam lies in patches rather than a band. The open sea stays calm.
 */

const WAVES_GLSL = /* glsl */ `
  // one travelling wave's slope (dh/dx, dh/dz): direction, wavelength (m), height (m); faded out under a pixel
  vec2 oWave( vec2 p, vec2 dir, float len, float height, float footprint, inout float lost ) {
    float k = 6.2831853 / len;
    float speed = sqrt( 9.81 / k ); // deep-water dispersion
    float phase = k * ( dot( dir, p ) - speed * uSurfTime );
    float keep = 1.0 - smoothstep( 0.35 * len, 1.2 * len, footprint );
    float slope = k * height;
    // a sharper crest than a sine (a touch of Gerstner): steep fronts, broad troughs
    float c = cos( phase );
    float shaped = c * ( 1.0 + 0.35 * sin( phase ) );
    lost += slope * slope * ( 1.0 - keep );
    return dir * ( slope * shaped * keep );
  }
  vec2 oHash2( vec2 p ) {
    p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) );
    return -1.0 + 2.0 * fract( sin( p ) * 43758.5453 );
  }
  float oNoise( vec2 p ) {
    vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( dot( oHash2( i ), f ), dot( oHash2( i + vec2( 1, 0 ) ), f - vec2( 1, 0 ) ), u.x ),
                mix( dot( oHash2( i + vec2( 0, 1 ) ), f - vec2( 0, 1 ) ), dot( oHash2( i + vec2( 1, 1 ) ), f - vec2( 1, 1 ) ), u.x ), u.y );
  }
  vec2 oNoiseSlope( vec2 p ) {
    const float e = 0.07;
    return vec2( oNoise( p + vec2( e, 0 ) ) - oNoise( p - vec2( e, 0 ) ), oNoise( p + vec2( 0, e ) ) - oNoise( p - vec2( 0, e ) ) ) / ( 2.0 * e );
  }
`

/** three's image-based lighting with the reflected ray kept above the horizon (see the patch below) */
const ENV_HOOK = 'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );'
const clampedEnv = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
  ENV_HOOK,
  `${ENV_HOOK}\n\t\t\treflectVec.y = max( reflectVec.y, 0.015 );\n\t\t\treflectVec = normalize( reflectVec );`,
)
if (clampedEnv === THREE.ShaderChunk.envmap_physical_pars_fragment) console.warn('[garage] three env chunk changed: the sea reflects below its horizon')

export interface Ocean {
  mesh: THREE.Mesh
  /** the sun's direction, for the whitecaps' lit side (the lighting itself is three's) */
  setSunDirection(direction: THREE.Vector3): void
}

export function createOcean(): Ocean {
  const shoreField = shoreTexture()
  // real metres out to the far layers' edge; fine where the surf is, coarse past the horizon
  const geometry = polarGrid(COAST.farRadius, 320, 900, (t) => t ** 3.2, () => 0)
  geometry.deleteAttribute('color')
  const pos = geometry.attributes.position
  const real = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    real[i * 2] = pos.getX(i)
    real[i * 2 + 1] = pos.getZ(i)
    pos.setY(i, SEA - SEA) // y above the sea, for mapFar
  }
  geometry.setAttribute('realXZ', new THREE.BufferAttribute(real, 2))
  mapFar(geometry)
  // the sea is level in real space: its normal is straight up everywhere, whatever the mapping did to the mesh
  const normal = geometry.attributes.normal
  for (let i = 0; i < normal.count; i++) normal.setXYZ(i, 0, 1, 0)

  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.06,
    metalness: 0,
    ior: 1.333,
    envMapIntensity: 1,
  })
  const uniforms = {
    uShore: { value: shoreField.texture },
    uShoreRect: { value: shoreField.rect },
    uSurfTime: SURF.time,
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  }
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 realXZ;\nvarying vec2 vReal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvReal = realXZ;')
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vReal;
        uniform sampler2D uShore;
        uniform vec4 uShoreRect;
        uniform vec3 uSunDir;
        ${SURF_GLSL}
        ${WAVES_GLSL}
        float oFoam; float oLost; vec2 oSlope; float oShallow;
        `,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec2 p = vReal;
          // a pixel's footprint on the water, metres (real, however the mesh is mapped)
          float footprint = max( length( fwidth( p ) ), 1e-3 );
          // the shore field (close in only; past it, open sea)
          vec2 uv = ( p - uShoreRect.xy ) * uShoreRect.zw;
          bool inField = all( greaterThan( uv, vec2( 0.0 ) ) ) && all( lessThan( uv, vec2( 1.0 ) ) );
          vec2 sh = inField ? texture2D( uShore, uv ).rg : vec2( -5000.0, 0.0 );
          float off = max( -sh.r, 0.0 ); // metres offshore
          float sand = sh.g;
          // the seabed's depth (as site.naturalHeight): shelving gently off sand, steeply off rock
          float depth = 0.4 + off * mix( 0.22, 0.028, sand ) + 8.0 * smoothstep( 60.0, 600.0, off );
          oShallow = 1.0 - smoothstep( 0.5, 14.0, depth );
          // ─── waves ───
          oLost = 0.0;
          vec2 s = vec2( 0.0 );
          // a spectrum, not a few sines: eleven waves from 70 m to 1.7 m, their directions spread
          // round the swell's (coming in from the open sea past the left of the view) and their phases
          // scattered — equal slope per octave, so no one wave draws regular stripes across the sea
          for ( int i = 0; i < 11; i ++ ) {
            float fi = float( i );
            float len = 70.0 * pow( 0.7, fi );
            float spread = ( fract( sin( fi * 12.9898 ) * 43758.5453 ) - 0.5 ) * 1.3 * ( 0.4 + fi / 11.0 );
            float a = 0.98 + spread; // radians from +x: toward the shore, a little to the right
            vec2 dir = vec2( cos( a ), sin( a ) );
            float slope = mix( 0.022, 0.034, fi / 10.0 );
            // wave groups: each train swells and fades over a few wavelengths, so crests don't run on as stripes
            float group = 0.35 + 0.65 * smoothstep( -0.35, 0.45, oNoise( p / ( len * 5.0 ) + fi * 7.1 + uSurfTime * 0.01 ) );
            vec2 q = p + dir.yx * vec2( -1.0, 1.0 ) * fract( fi * 0.618 ) * len * 3.0; // phase scatter along the crest
            s += oWave( q + fi * 17.0, dir, len, group * slope * len / 6.2831853, footprint, oLost );
          }
          // a second, weaker swell from further round, crossing the first
          for ( int i = 0; i < 4; i ++ ) {
            float fi = float( i );
            float len = 55.0 * pow( 0.62, fi );
            float a = 1.75 + ( fract( sin( fi * 78.233 ) * 43758.5453 ) - 0.5 ) * 0.6;
            vec2 dir = vec2( cos( a ), sin( a ) );
            float group = 0.3 + 0.7 * smoothstep( -0.3, 0.5, oNoise( p / ( len * 4.0 ) - fi * 3.3 ) );
            s += oWave( p - fi * 29.0, dir, len, group * 0.018 * len / 6.2831853, footprint, oLost );
          }
          // chop: irregular short ripples, drifting
          float chopKeep = 1.0 - smoothstep( 0.4, 1.4, footprint );
          vec2 drift = vec2( uSurfTime * 0.35, uSurfTime * 0.6 );
          s += oNoiseSlope( p * 0.9 + drift ) * 0.05 * chopKeep;
          s += oNoiseSlope( p * 2.6 - drift * 1.3 ) * 0.02 * ( 1.0 - smoothstep( 0.15, 0.5, footprint ) );
          oLost += 0.002 * ( 1.0 - chopKeep );
          // near the shore the sea is choppier and the swell steepens (shoaling)
          float nearShore = 1.0 - smoothstep( 0.0, 260.0, off );
          s *= 1.0 + 0.5 * nearShore;
          // ─── breakers: lines rolling in along the shore field's contours ───
          // phase runs with the surf's clock; each line's position is a distance offshore
          float lines = 0.0;
          float crestFoam = 0.0;
          if ( off < 220.0 && inField ) {
            float phase = surfPhase( p );
            for ( int i = 0; i < 3; i ++ ) {
              // three sets in flight: one breaking, one steepening, one rolling in
              float ph = fract( phase + float( i ) / 3.0 );
              float crestAt = ( 1.0 - ph ) * 150.0; // metres offshore, running in to the waterline
              float d = off - crestAt;
              // a steep face on the shore side, a long back
              float face = exp( -d * d / ( d < 0.0 ? 4.0 : 30.0 ) );
              // it breaks where the water's shallow: foam behind the crest, spreading as it runs in
              // (off rock the water deepens fast: it breaks only in the last few metres, against the rocks)
              float breaking = smoothstep( 5.5, 1.2, depth ) * sand + ( 1.0 - sand ) * smoothstep( 4.0, 1.0, depth ) * ( 1.0 - smoothstep( 8.0, 25.0, off ) );
              float trail = d > 0.0 ? exp( -d / ( 4.0 + 18.0 * ph ) ) : 0.0;
              crestFoam += breaking * ( face * 0.8 + trail * 0.6 );
              lines += face * ( 0.4 + 0.6 * ( 1.0 - smoothstep( 1.0, 12.0, depth ) ) );
            }
            // the breaker's face tilts the surface toward the shore (the field's gradient)
            vec2 e = vec2( 2.0, 0.0 );
            float sx = texture2D( uShore, ( p + e.xy - uShoreRect.xy ) * uShoreRect.zw ).r - texture2D( uShore, ( p - e.xy - uShoreRect.xy ) * uShoreRect.zw ).r;
            float sz = texture2D( uShore, ( p + e.yx - uShoreRect.xy ) * uShoreRect.zw ).r - texture2D( uShore, ( p - e.yx - uShoreRect.xy ) * uShoreRect.zw ).r;
            vec2 toShore = normalize( vec2( sx, sz ) + 1e-5 );
            s += toShore * lines * 0.35 * nearShore;
          }
          oSlope = s;
          // ─── foam: breaking lines, surf round the rocks, the waterline, and rare whitecaps offshore ───
          float breakUp = oNoise( p * 0.21 + vec2( uSurfTime * 0.05, 0.0 ) ) * 0.5 + 0.5;
          float fine = oNoise( p * 0.9 + drift * 0.3 ) * 0.5 + 0.5;
          float streaks = oNoise( vec2( p.x * 0.35 + p.y * 0.2, p.y * 0.08 ) ) * 0.5 + 0.5;
          float rockSurf = ( 1.0 - sand ) * ( 1.0 - smoothstep( 0.0, 10.0 + 8.0 * breakUp, off ) ) * ( 0.55 + 0.45 * sin( uSurfTime * 0.7 + fine * 6.0 ) );
          float waterline = 1.0 - smoothstep( 0.0, 2.5, off );
          float surf = clamp( crestFoam, 0.0, 1.5 ) * smoothstep( 0.25, 0.7, breakUp * 0.55 + fine * 0.45 );
          // lingering foam spread over the inner surf zone in patches and streaks
          float residual = sand * ( 1.0 - smoothstep( 10.0, 70.0, off ) ) * smoothstep( 0.6, 0.85, streaks * 0.6 + fine * 0.4 ) * 0.5;
          float caps = smoothstep( 0.93, 0.99, oNoise( p * 0.07 + uSurfTime * 0.02 ) * 0.5 + 0.5 ) * smoothstep( 0.5, 0.9, fine ) * 0.4 * ( 1.0 - smoothstep( 20.0, 120.0, footprint ) );
          oFoam = clamp( surf + rockSurf * smoothstep( 0.3, 0.7, fine ) + waterline * 0.6 * fine + residual + caps, 0.0, 1.0 );
          // foam fades to its average once it's under a pixel (a pale sheen, not sparkle)
          oFoam = mix( oFoam, oFoam * 0.5, smoothstep( 1.0, 8.0, footprint ) );
          // ─── the water's own colour, by depth: what light comes back up out of it ───
          vec3 deep = vec3( 0.004, 0.016, 0.042 );
          vec3 blueGreen = vec3( 0.006, 0.042, 0.06 );
          vec3 turquoise = vec3( 0.02, 0.14, 0.14 );
          vec3 sandy = vec3( 0.11, 0.16, 0.12 );
          vec3 body = mix( deep, blueGreen, 1.0 - smoothstep( 25.0, 60.0, depth ) );
          body = mix( body, turquoise, ( 1.0 - smoothstep( 3.0, 16.0, depth ) ) * mix( 0.35, 1.0, sand ) );
          body = mix( body, sandy, ( 1.0 - smoothstep( 0.4, 2.6, depth ) ) * sand );
          // the swell's crests are thinner: light through them (a greener glow on the back of a wave)
          body *= 1.0 + 0.9 * clamp( lines, 0.0, 1.0 ) * nearShore;
          diffuseColor.rgb = mix( body, vec3( 0.82, 0.85, 0.86 ), oFoam );
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `// sub-pixel waves become roughness: the far sea's sun glitter spreads into a broad path
        float roughnessFactor = clamp( sqrt( roughness * roughness + oLost * 1.5 ), 0.0, 0.45 );
        roughnessFactor = mix( roughnessFactor, 0.85, oFoam );`,
      )
      // a ray reflected down off a wave would hit the next wave, which shows the sky too — not the
      // dark sea the environment map holds below its horizon (that drew black bands across the water)
      .replace(
        '#include <envmap_physical_pars_fragment>',
        clampedEnv,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec3 wn = normalize( vec3( -oSlope.x, 1.0, -oSlope.y ) );
          normal = normalize( ( viewMatrix * vec4( wn, 0.0 ) ).xyz );
        }`,
      )
  }
  material.customProgramCacheKey = () => 'coast-ocean'
  receiveFarShadow(material) // the cliffs' and the hills' shadows lie on the water
  material.envMapIntensity = 1 // the sky's reflection at full strength (not the land's toned-down fill)
  // (the path tracer: plain dark water)
  material.userData.pathTrace = new THREE.MeshPhysicalMaterial({ color: 0x03101a, roughness: 0.05, ior: 1.333, envMapIntensity: OUTDOOR_SKY_LIGHT * 3 })

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'ocean'
  mesh.receiveShadow = true
  mesh.frustumCulled = false // (mapped far: its bounds are huge anyway)
  return {
    mesh: noRaycast(mesh),
    setSunDirection(direction) {
      uniforms.uSunDir.value.copy(direction)
    },
  }
}
