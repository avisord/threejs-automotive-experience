import * as THREE from 'three'
import { matches, type CarProfile } from './cars'

export type LampId = 'head' | 'tail'

export interface LampConfig {
  on: boolean
  color: string
  /** 0–2, scales both the lens glow and the real light */
  intensity: number
  /** headlights only: draw the light cone in the air */
  beam: boolean
}

export type LampSettings = Record<LampId, LampConfig>

export const DEFAULT_LAMPS: LampSettings = {
  // the beam cone is off until it's reworked; a car's own toggle still turns it on
  head: { on: true, color: '#eaf1ff', intensity: 1, beam: false },
  tail: { on: true, color: '#ff2a18', intensity: 1, beam: false },
}

const BLACK = new THREE.Color(0x000000)

interface LampTuning {
  /** HDR strength of the lens glow */
  emissive: number
  candela: number
  range: number
  angle: number
  /** where the spot points, relative to the lamp */
  aim: THREE.Vector3
}

const LAMP_TUNING: Record<LampId, LampTuning> = {
  // Both are spots: a headlight throws down the bay, a tail light washes the
  // ground just behind the car. Point lights would be wrong here — with no
  // shadow maps they spill straight through the bodywork and paint the floor
  // beside the car, where nothing should be lit.
  head: { emissive: 2.2, candela: 90, range: 32, angle: 0.5, aim: new THREE.Vector3(0, -1.1, 14) },
  tail: { emissive: 1.8, candela: 9, range: 3.6, angle: 0.95, aim: new THREE.Vector3(0, -1.4, -2.2) },
}

interface LampGroup {
  /** every lens mesh — they all glow together */
  meshes: THREE.Mesh[]
  /** where the real lights go: one per side */
  positions: THREE.Vector3[]
}

export interface LampSystem {
  readonly settings: LampSettings
  /** lamp groups this car actually has */
  readonly present: LampId[]
  set(id: LampId, patch: Partial<LampConfig>): void
  /**
   * How much daylight is around, 0 (night, a closed room) to 1 (an open-air room at noon). A lamp
   * is a few hundred lux where the sun is ~100 000: in daylight its pool on the ground and its beam
   * in the air are gone, only the lens still glows.
   */
  setDaylight(level: number): void
  dispose(): void
}

/** the cone of light in the air — brightest at the lens, gone by the end of its throw */
function beamMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uStrength: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vView;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vView = normalize( -mv.xyz );
        vDepth = -mv.z;
        vNormal = normalize( normalMatrix * normal );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uStrength;
      varying vec2 vUv;
      varying vec3 vView;
      varying vec3 vNormal;
      varying float vDepth;
      void main() {
        // vUv.y is 1 at the lens; the cone thins out before its far end
        float along = 1.0 - vUv.y;
        float fade = smoothstep( 0.0, 0.1, along ) * ( 1.0 - smoothstep( 0.25, 1.0, along ) );
        // a cone shell only reads as a volume if it brightens toward its silhouette
        float rim = 1.0 - abs( dot( normalize( vNormal ), normalize( vView ) ) );
        // brightest across the body of the cone, softened right at its outline
        float shell = pow( rim, 1.4 ) * ( 1.0 - pow( rim, 8.0 ) );
        // and fade out where the shell passes close to the camera
        float a = fade * shell * smoothstep( 0.4, 2.5, vDepth ) * 0.7 * uStrength;
        gl_FragColor = vec4( uColor * a, a );
      }`,
  })
}

/**
 * Head and tail lights: the lens meshes glow (and join the lights-only bloom)
 * while real lights are placed at them — a spot pair aimed down the bay for
 * the headlights, small point lights for the tails. Everything is parented to
 * the car, restored on dispose.
 */
export function createLampSystem(car: THREE.Object3D, profile: CarProfile, onChange: () => void): LampSystem {
  const lamps = profile.lamps
  const groups: Record<LampId, LampGroup> = { head: { meshes: [], positions: [] }, tail: { meshes: [], positions: [] } }

  if (lamps) {
    const box = new THREE.Box3()
    const centre = new THREE.Vector3()
    car.updateMatrixWorld(true)
    car.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || mesh.userData.overlay) return
      let id: LampId | null = null
      if (lamps.front && matches(lamps.front, mesh, car)) id = 'head'
      else if (lamps.rear && matches(lamps.rear, mesh, car)) id = 'tail'
      else if (lamps.auto && matches(lamps.auto, mesh, car)) {
        // every car faces +z, so the nose end is the headlight end
        box.setFromObject(mesh).getCenter(centre)
        id = centre.z >= 0 ? 'head' : 'tail'
      }
      if (id) groups[id].meshes.push(mesh)
    })

    for (const id of ['head', 'tail'] as LampId[]) {
      const group = groups[id]
      if (group.meshes.length === 0) continue
      const bounds = new THREE.Box3()
      const sided: { x: number; mesh: THREE.Mesh }[] = []
      for (const mesh of group.meshes) {
        box.setFromObject(mesh)
        bounds.union(box)
        const x = box.getCenter(centre).x
        if (Math.abs(x) > 0.1) sided.push({ x, mesh })
      }
      const centreOf = (list: THREE.Mesh[]) => {
        const b = new THREE.Box3()
        for (const m of list) b.union(box.setFromObject(m))
        return b.getCenter(new THREE.Vector3())
      }
      const left = sided.filter((e) => e.x > 0).map((e) => e.mesh)
      const right = sided.filter((e) => e.x < 0).map((e) => e.mesh)
      if (left.length > 0 && right.length > 0) {
        group.positions.push(centreOf(left), centreOf(right))
      } else if (bounds.max.x - bounds.min.x < 0.35) {
        // one lamp on the centre line (a bike's): one light
        group.positions.push(bounds.getCenter(new THREE.Vector3()))
      } else {
        // lamps modelled as one mesh across the car: put a light near each end of it
        const c = bounds.getCenter(new THREE.Vector3())
        const x = Math.max(bounds.max.x, -bounds.min.x) * 0.62
        group.positions.push(new THREE.Vector3(x, c.y, c.z), new THREE.Vector3(-x, c.y, c.z))
      }
      // sit just outside the lens, so what light there is spills away from the
      // car instead of through it
      const z = id === 'head' ? bounds.max.z + 0.04 : bounds.min.z - 0.06
      for (const p of group.positions) p.z = z
    }
  }

  const present = (['head', 'tail'] as LampId[]).filter((id) => groups[id].meshes.length > 0)
  const settings: LampSettings = structuredClone(DEFAULT_LAMPS)
  const original = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  const lensMaterials = new Map<THREE.Mesh, THREE.MeshStandardMaterial>()
  const lights: THREE.Light[] = []
  const beams: THREE.Mesh[] = []
  let daylight = 0
  // (not physically 1 %: a pool that faint is gone anyway, and dusk keeps a trace of it)
  const lightScale = () => 1 - 0.985 * daylight
  const beamScale = () => 1 - daylight

  const storageKey = `garage.lamps.v1.${profile.id}`
  /** the beam was switched by hand on this car: before, every save carried the old default (on) */
  let beamChosen = false
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as (Partial<LampSettings> & { beamChosen?: boolean }) | null
    if (saved) {
      beamChosen = saved.beamChosen === true
      for (const id of present) Object.assign(settings[id], saved[id], beamChosen ? {} : { beam: DEFAULT_LAMPS[id].beam })
    }
  } catch {
    // corrupt or blocked storage — defaults
  }

  /** lens meshes get their own material copy so the glow doesn't leak to parts sharing it */
  function lensMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
    let material = lensMaterials.get(mesh)
    if (!material) {
      original.set(mesh, mesh.material)
      const source = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
      material = source.clone()
      material.name = `${source.name}-lamp`
      lensMaterials.set(mesh, material)
      mesh.material = material
    }
    return material
  }

  function build(id: LampId): void {
    const tuning = LAMP_TUNING[id]
    const color = new THREE.Color(settings[id].color)
    const { on, intensity, beam: showBeam } = settings[id]
    const group = groups[id]

    for (const mesh of group.meshes) {
      mesh.castShadow = false // the lamp can't be in its own way
      const material = lensMaterial(mesh)
      material.emissive.copy(on ? color : BLACK)
      material.emissiveIntensity = on ? tuning.emissive * intensity : 0
      material.emissiveMap = null
      material.userData.glow = on
    }
    if (!on) return

    for (const position of group.positions) {
      const spot = new THREE.SpotLight(color, tuning.candela * intensity * lightScale(), tuning.range, tuning.angle, 0.7, 2)
      spot.userData.candela = tuning.candela * intensity
      spot.position.copy(position)
      spot.target.position.copy(position).add(tuning.aim)
      // the bodywork stops the light: no glow through the bonnet or bumper,
      // and the car's silhouette cut into the pool. Car and lamp don't move,
      // so the map is drawn once when the light is made, not every frame.
      spot.castShadow = true
      spot.shadow.mapSize.set(1024, 1024)
      spot.shadow.camera.near = 0.05
      spot.shadow.camera.far = tuning.range
      spot.shadow.bias = -0.0005
      spot.shadow.normalBias = 0.02
      spot.shadow.autoUpdate = false
      spot.shadow.needsUpdate = true
      car.add(spot, spot.target)
      lights.push(spot)

      if (id === 'head' && showBeam) {
        const length = 10
        const beam = new THREE.Mesh(
          // narrower than the light's own cone: the visible core of the beam
          new THREE.ConeGeometry(Math.tan(tuning.angle * 0.55) * length, length, 28, 1, true),
          beamMaterial(color),
        )
        beam.geometry.translate(0, -length / 2, 0) // tip at the lens
        beam.rotation.x = -Math.PI / 2 // tip at the lens, opening away down +z
        beam.position.copy(position)
        beam.renderOrder = 3
        beam.raycast = () => {}
        beam.userData.strength = intensity
        ;(beam.material as THREE.ShaderMaterial).uniforms.uStrength.value = intensity * beamScale()
        beam.visible = beamScale() > 0
        car.add(beam)
        beams.push(beam)
      }
    }
  }

  function clearLights(): void {
    for (const light of lights) {
      ;(light as THREE.SpotLight).target?.removeFromParent()
      light.removeFromParent()
      light.dispose()
    }
    lights.length = 0
    for (const beam of beams) {
      beam.removeFromParent()
      beam.geometry.dispose()
      ;(beam.material as THREE.Material).dispose()
    }
    beams.length = 0
  }

  function rebuild(): void {
    clearLights()
    for (const id of present) build(id)
    onChange()
  }
  rebuild()

  return {
    settings,
    present,
    set(id, patch) {
      Object.assign(settings[id], patch)
      if ('beam' in patch) beamChosen = true
      rebuild()
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...settings, beamChosen }))
      } catch {
        // not persisted — fine
      }
    },
    setDaylight(level) {
      if (level === daylight) return
      daylight = level
      for (const light of lights) light.intensity = light.userData.candela * lightScale()
      for (const beam of beams) {
        ;(beam.material as THREE.ShaderMaterial).uniforms.uStrength.value = beam.userData.strength * beamScale()
        beam.visible = beamScale() > 0
      }
      onChange()
    },
    dispose() {
      clearLights()
      for (const [mesh, material] of original) mesh.material = material
      for (const material of lensMaterials.values()) material.dispose()
      lensMaterials.clear()
      original.clear()
    },
  }
}
