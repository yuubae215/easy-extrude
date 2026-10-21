import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { SHAPE_BY_TYPE, lifecycleShapeOf } from './lifecycleShape.js'
import { AnnotatedRegion } from '../domain/AnnotatedRegion.js'
import { AnnotatedPoint } from '../domain/AnnotatedPoint.js'
import { Solid } from '../domain/Solid.js'
import { voxelCells } from '../view/ShapeVoxelMath.js'
import { planLandingEffect } from '../view/LandingEffects.js'

const DOMAIN = new URL('../domain/', import.meta.url)

test('every domain entity that has corners declares its lifecycle shape (原則 #31 — population from the source)', () => {
  // The population is derived, not listed: a class with a `get corners()` reaches
  // `boundsOf` at objectAdded / objectRemoved, so it must have a row.
  const withCorners = readdirSync(DOMAIN)
    .filter(f => f.endsWith('.js') && !f.endsWith('.test.js'))
    .flatMap(f => {
      const src = readFileSync(new URL(f, DOMAIN), 'utf8')
      return /\bget corners\(\)/.test(src) ? [...src.matchAll(/export class (\w+)/g)].map(m => m[1]) : []
    })
  const declared = SHAPE_BY_TYPE.map(([T]) => T.name)
  assert.ok(withCorners.length >= 7, `found ${withCorners}`)
  for (const name of withCorners) assert.ok(declared.includes(name), `${name} has corners but no shape row`)
})

test('an undeclared type throws instead of falling through', () => {
  class Stranger { get corners() { return [] } }
  assert.throws(() => lifecycleShapeOf(new Stranger()), /no shape declared for Stranger/)
})

test('an eight-vertex Zone is a sheet, not a box (the corner-count route drew it as one)', () => {
  const zone = Object.create(AnnotatedRegion.prototype)
  zone.vertices = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2
    return { position: { x: 1000 * Math.cos(a), y: 1000 * Math.sin(a), z: 0 } }
  })
  const shape = lifecycleShapeOf(zone)
  assert.equal(shape.kind, 'surface')
  const plan = planLandingEffect({ center: { x: 0, y: 0, z: 0 }, radius: 1000, shape }, { kind: 'materialize' })
  assert.equal(plan.form, 'shatter')
  assert.ok(voxelCells(shape).cells.every(c => c.p.z > 0))
})

test('a point is declared silent: no cloud is invented around it (#11)', () => {
  const pt = Object.create(AnnotatedPoint.prototype)
  assert.equal(lifecycleShapeOf(pt), null)
  assert.equal(planLandingEffect({ center: { x: 0, y: 0, z: 0 }, radius: 0, shape: null }, { kind: 'dissolve' }), null)
})

test('appear and vanish are one picture run both ways: every shape plans the same cells for both (ADR-166 M5b)', () => {
  // The cuboid's appear used to be a different picture (an outline + 28 sparks
  // that landed on the edges and evaporated) while its vanish broke the box
  // into its own cells — the create never gathered into what the delete broke.
  const box = Object.create(Solid.prototype)
  Object.defineProperty(box, 'corners', { value: [
    { x: 1, y: -1, z: 0 }, { x: 1, y: 1, z: 0 }, { x: -1, y: 1, z: 0 }, { x: -1, y: -1, z: 0 },
    { x: 1, y: -1, z: 2 }, { x: 1, y: 1, z: 2 }, { x: -1, y: 1, z: 2 }, { x: -1, y: -1, z: 2 },
  ] })
  const zone = Object.create(AnnotatedRegion.prototype)
  zone.vertices = [[0, 0], [4, 0], [4, 1], [0, 1]].map(([x, y]) => ({ position: { x, y, z: 0 } }))
  for (const entity of [box, zone]) {
    const anchor = { center: { x: 0, y: 0, z: 1 }, radius: 2, shape: lifecycleShapeOf(entity) }
    const appear = planLandingEffect(anchor, { kind: 'materialize' })
    const vanish = planLandingEffect(anchor, { kind: 'dissolve' })
    assert.equal(appear.form, vanish.form, entity.constructor.name)
    assert.deepEqual(appear.cells, vanish.cells, `${entity.constructor.name}: the same pieces both ways`)
  }
})
