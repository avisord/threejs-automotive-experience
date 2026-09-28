import * as THREE from 'three'
import { seeded } from '../landform'
import { createForest, type Forest } from '../trees'
import type { Plant, PlantKind } from '../vegetation-layout'
import type { Lot } from './lots'
import { CHURCH, FRONT, MAIN, STREETS, Street, heightAt, outOfTown, woodedness } from './site'

/**
 * The trees: a pair in the walled garden across from the car, four shading the
 * church's plaza, a scatter in the back yards showing over the rooftops, and
 * the woods on the hills round the valley out to ~3 km. One planned list, grown
 * by the shared forest (trees.ts): full trees close to the car, limb skeletons
 * and foliage masses a little farther, crossed cards, then impostors — so the
 * hillsides read as forest without the cost of thousands of real trees.
 */

const TAU = Math.PI * 2

/** is (x, z) on a street, its pavements or its houses' plots (other than `except`'s) */
function onPlots(x: number, z: number, except?: Street): boolean {
  for (const street of STREETS) {
    if (street === except) continue
    if (!street.near(x, z, 40)) continue
    const n = street.nearest(x, z)
    if (n.s < street.start - 5 || n.s > street.end + 5) continue
    if (Math.abs(n.d) < street.width / 2 + street.sidewalk + 16) return true
  }
  return false
}

export function planTrees(lots: Lot[]): Plant[] {
  const rand = seeded(8080)
  const plants: Plant[] = []
  const add = (x: number, z: number, kind: PlantKind, height: number) =>
    plants.push({ x, z, kind, height, width: 0.8 + rand() * 0.45, turn: rand() * TAU, leanX: (rand() - 0.5) * 0.06, leanZ: (rand() - 0.5) * 0.06, tone: rand(), pick: rand() })

  // the walled gardens: two trees each, well inside the wall
  for (const lot of lots) {
    if (lot.setback <= 0) continue
    const d = lot.street.width / 2 + lot.street.sidewalk + lot.setback * 0.5
    for (const t of [0.3, 0.72]) {
      const p = lot.street.at(lot.s0 + (lot.s1 - lot.s0) * t, lot.side * d)
      add(p.x, p.y, 'broadleaf', 8.5 + rand() * 3)
    }
  }
  // the church's plaza: a tree at each corner
  const side = Math.sign(CHURCH.d)
  for (const ds of [-19, 19]) {
    for (const dd of [4, 13]) {
      const p = MAIN.at(CHURCH.s + ds, side * (FRONT + dd))
      add(p.x, p.y, 'broadleaf', 8 + rand() * 2)
    }
  }
  // back yards: now and then a tree behind a house, tall enough to show over its roof
  for (const lot of lots) {
    if (lot.setback > 0 || rand() > 0.22) continue
    const d = lot.street.width / 2 + lot.street.sidewalk + lot.depth + 3 + rand() * 5
    const p = lot.street.at((lot.s0 + lot.s1) / 2, lot.side * d)
    // (not on another street's houses: a back yard near a corner backs onto the side street's plots)
    if (onPlots(p.x, p.y, lot.street)) continue
    add(p.x, p.y, rand() < 0.2 ? 'conifer' : 'broadleaf', 9 + rand() * 5)
  }
  // the woods on the hills, on a jittered 16 m grid out to 3.2 km, thinning into clearings
  const step = 16
  for (let gx = -3200; gx <= 3200; gx += step) {
    for (let gz = -3200; gz <= 3200; gz += step) {
      const x = gx + (rand() - 0.5) * step
      const z = gz + (rand() - 0.5) * step
      if (x * x + z * z > 3200 * 3200) continue
      const out = outOfTown(x, z)
      if (out < 40) continue
      const w = woodedness(x, z, out)
      if (rand() > w * 0.85) continue
      const conifer = rand() < 0.35 + 0.3 * THREE.MathUtils.smoothstep(heightAt(x, z), 80, 260)
      add(x, z, conifer ? 'conifer' : 'broadleaf', conifer ? 13 + rand() * 9 : 9 + rand() * 6)
    }
  }
  return plants
}

/** grow the planned trees (async: the tree generator and its atlas load lazily) */
export function createWoods(lots: Lot[]): { group: THREE.Group; ready: Promise<Forest | null>; count: number } {
  const group = new THREE.Group()
  group.name = 'street-woods'
  const plants = planTrees(lots)
  const ready = createForest({
    seed: 21,
    flora: 'temperate',
    heightAt,
    layout: { plants, cover: () => 0 },
    // (no bushes scattered round the car: the pots and gardens are the street's planting)
    bushRoom: () => 0,
    accents: [],
  })
    .then(async (forest) => {
      group.add(forest.group)
      await forest.ready
      return forest
    })
    .catch((err: unknown) => {
      console.error('[garage] street woods failed', err)
      return null
    })
  return { group, ready, count: plants.length }
}
