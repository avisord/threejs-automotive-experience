import * as THREE from 'three'
import { pebbleTextures, beachBallTexture, checkerTexture, marbleTexture } from './textures'

export interface Ball {
  mesh: THREE.Mesh
  radius: number
  mass: number
  velocity: THREE.Vector3
  dragged: boolean
  dragTarget: THREE.Vector3
  light?: THREE.PointLight
}

interface BallSpec {
  radius: number
  density: number
  material: THREE.Material
  lightColor?: THREE.ColorRepresentation
}

function specs(): BallSpec[] {
  const pebble = pebbleTextures()
  return [
    // mirror chrome
    {
      radius: 1.7,
      density: 3,
      material: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 }),
    },
    // brushed gold
    {
      radius: 1.3,
      density: 3.2,
      material: new THREE.MeshStandardMaterial({ color: 0xd4a94e, metalness: 1, roughness: 0.28 }),
    },
    // rough copper
    {
      radius: 1.05,
      density: 3.1,
      material: new THREE.MeshStandardMaterial({ color: 0xb0603a, metalness: 1, roughness: 0.45 }),
    },
    // clear glass
    {
      radius: 1.45,
      density: 1.4,
      material: new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        metalness: 0,
        roughness: 0.02,
        transmission: 1,
        thickness: 2.4,
        ior: 1.5,
        specularIntensity: 1,
      }),
    },
    // emissive cyan
    {
      radius: 1.0,
      density: 0.8,
      lightColor: 0x35e0ff,
      material: new THREE.MeshStandardMaterial({
        color: 0x061518,
        emissive: 0x35e0ff,
        emissiveIntensity: 4.5,
        roughness: 0.4,
      }),
    },
    // emissive magenta
    {
      radius: 1.2,
      density: 0.8,
      lightColor: 0xff3fd4,
      material: new THREE.MeshStandardMaterial({
        color: 0x180612,
        emissive: 0xff3fd4,
        emissiveIntensity: 4,
        roughness: 0.4,
      }),
    },
    // emissive amber
    {
      radius: 0.9,
      density: 0.8,
      lightColor: 0xffa02e,
      material: new THREE.MeshStandardMaterial({
        color: 0x181004,
        emissive: 0xffa02e,
        emissiveIntensity: 4.5,
        roughness: 0.4,
      }),
    },
    // speckled stone pebble
    {
      radius: 1.85,
      density: 2.4,
      material: new THREE.MeshStandardMaterial({
        map: pebble.map,
        bumpMap: pebble.bumpMap,
        bumpScale: 0.6,
        roughness: 0.95,
        metalness: 0,
      }),
    },
    // polished pebble (wet-stone look: rough map under a clearcoat)
    {
      radius: 1.15,
      density: 2.4,
      material: new THREE.MeshPhysicalMaterial({
        map: pebble.map,
        color: 0x777066,
        roughness: 0.55,
        clearcoat: 1,
        clearcoatRoughness: 0.12,
      }),
    },
    // beach ball
    {
      radius: 1.75,
      density: 0.35,
      material: new THREE.MeshPhysicalMaterial({
        map: beachBallTexture(),
        roughness: 0.32,
        clearcoat: 0.5,
        clearcoatRoughness: 0.25,
      }),
    },
    // checkered
    {
      radius: 1.2,
      density: 1.2,
      material: new THREE.MeshStandardMaterial({ map: checkerTexture(), roughness: 0.5 }),
    },
    // veined marble with polish
    {
      radius: 1.4,
      density: 2.6,
      material: new THREE.MeshPhysicalMaterial({
        map: marbleTexture(),
        roughness: 0.18,
        clearcoat: 1,
        clearcoatRoughness: 0.06,
      }),
    },
    // matte rubber
    {
      radius: 1.3,
      density: 1.1,
      material: new THREE.MeshStandardMaterial({ color: 0xb42222, roughness: 0.9, metalness: 0 }),
    },
    // iridescent soap-bubble shell
    {
      radius: 1.15,
      density: 0.6,
      material: new THREE.MeshPhysicalMaterial({
        color: 0x8899aa,
        metalness: 0.4,
        roughness: 0.12,
        iridescence: 1,
        iridescenceIOR: 1.6,
      }),
    },
  ]
}

export function createBalls(bounds: { x: number; z: number }): Ball[] {
  const balls: Ball[] = []
  const placed: THREE.Vector3[] = []

  for (const spec of specs()) {
    const geo = new THREE.SphereGeometry(spec.radius, 64, 48)
    const mesh = new THREE.Mesh(geo, spec.material)
    mesh.castShadow = true
    mesh.receiveShadow = true

    // find a spawn spot that doesn't overlap the ones already placed
    const pos = new THREE.Vector3()
    for (let attempt = 0; attempt < 200; attempt++) {
      pos.set(
        (Math.random() * 2 - 1) * (bounds.x - spec.radius - 1),
        spec.radius + 2 + Math.random() * 14,
        (Math.random() * 2 - 1) * (bounds.z - spec.radius),
      )
      if (placed.every((p) => p.distanceTo(pos) > 4.5)) break
    }
    placed.push(pos.clone())
    mesh.position.copy(pos)
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI)

    const ball: Ball = {
      mesh,
      radius: spec.radius,
      mass: spec.density * spec.radius ** 3,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 4, 0, (Math.random() - 0.5) * 2),
      dragged: false,
      dragTarget: new THREE.Vector3(),
    }

    if (spec.lightColor) {
      const light = new THREE.PointLight(spec.lightColor, 60, 28, 2)
      light.castShadow = false
      mesh.add(light)
      ball.light = light
    }

    balls.push(ball)
  }
  return balls
}
