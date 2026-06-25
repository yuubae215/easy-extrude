/**
 * LayoutDecompiler.test.js — scene⇄DSL round-trip contract (ADR-055).
 *
 * Run with:  node --test src/layout/LayoutDecompiler.test.js
 *
 * Mutual up to a normal form:
 *   • Scene fixpoint (the meaningful law):
 *       compileLayout(decompileLayout(compileLayout(dsl)).dsl) ≡ compileLayout(dsl)
 *   • DSL normal form: decompile emits strategy:'manual' + explicit positions.
 *   • Additive Solid `rotation` lets a rotated Solid survive the round-trip.
 *   • Unconvertible scene entities (MeasureLine/ImportedMesh/Profile) are reported,
 *     never silently dropped (PHILOSOPHY #11).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileLayout } from './LayoutCompiler.js'
import { decompileLayout } from './LayoutDecompiler.js'
import { validateLayoutDsl } from './LayoutValidator.js'

const here = dirname(fileURLToPath(import.meta.url))
const factoryLayout = JSON.parse(
  readFileSync(join(here, '../../examples/factory_layout.json'), 'utf8'),
)

test('scene fixpoint: compileLayout∘decompileLayout∘compileLayout ≡ compileLayout (factory)', () => {
  const scene1 = compileLayout(factoryLayout)
  const { dsl } = decompileLayout(scene1)
  const scene2 = compileLayout(dsl)
  assert.deepEqual(scene2, scene1)
})

test('decompiled DSL passes the Layout validator', () => {
  const scene = compileLayout(factoryLayout)
  const { dsl } = decompileLayout(scene)
  const result = validateLayoutDsl(dsl)
  assert.equal(result.valid, true, result.errors.join('\n'))
})

test('normal form: strategy is manual and every entity has an explicit position-bearing shape', () => {
  const scene = compileLayout(factoryLayout)
  const { dsl } = decompileLayout(scene)
  assert.equal(dsl.strategy, 'manual')
  assert.equal(dsl.version, 'layout/1.0')
  for (const e of dsl.entities) {
    if (e.type === 'Solid' || e.type === 'AnnotatedPoint') {
      assert.ok(e.position, `${e.ref} should carry an explicit position`)
    }
  }
})

test('auto-Origin CFs are folded away; user frames reappear under their Solid', () => {
  const scene = compileLayout(factoryLayout)
  const { dsl } = decompileLayout(scene)

  // No CoordinateFrame entity is emitted for the auto-generated Origins.
  const cfEntities = dsl.entities.filter(e => e.type === 'CoordinateFrame')
  assert.equal(cfEntities.length, 0)

  const workbench = dsl.entities.find(e => e.ref === 'workbench')
  assert.deepEqual(workbench.dimensions, { x: 500, y: 300, z: 800 })
  assert.deepEqual(workbench.position, { x: 2800, y: 0, z: 400 })
  assert.equal(workbench.frames.length, 1)
  assert.equal(workbench.frames[0].ref, 'workbench_top')
  assert.deepEqual(workbench.frames[0].translation, { x: 0, y: 0, z: 400 })
})

test('constraints recover entity / origin / frame ref namespaces', () => {
  const scene = compileLayout(factoryLayout)
  const { dsl } = decompileLayout(scene)
  assert.equal(dsl.constraints.length, 5)

  // entity→origin namespace
  const power = dsl.constraints.find(c => c.source === 'floor_outlet')
  assert.equal(power.target, 'workbench_origin')
  assert.equal(power.semanticType, 'connects')

  // frame→frame namespace (fixed/fastened)
  const bolt = dsl.constraints.find(c => c.source === 'robot_base')
  assert.equal(bolt.target, 'robot_mount')
  assert.equal(bolt.jointType, 'fixed')
  assert.equal(bolt.semanticType, 'fastened')
})

test('additive rotation: a rotated Solid survives the round-trip', () => {
  // 90° about +Z
  const rot = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
  const dsl0 = {
    version: 'layout/1.0',
    strategy: 'manual',
    entities: [
      {
        ref: 'box', type: 'Solid', name: 'Box',
        dimensions: { x: 100, y: 200, z: 300 },
        position: { x: 10, y: 20, z: 30 },
        rotation: rot,
      },
    ],
    constraints: [],
  }
  const scene1 = compileLayout(dsl0)
  assert.deepEqual(scene1.objects[0].orientation, rot)

  const { dsl } = decompileLayout(scene1)
  const box = dsl.entities.find(e => e.ref === 'box')
  assert.deepEqual(box.rotation, rot, 'rotation should be recovered into the DSL')

  const scene2 = compileLayout(dsl)
  assert.deepEqual(scene2, scene1, 'scene fixpoint holds for a rotated Solid')
})

test('identity orientation is normalised away (no rotation field)', () => {
  const scene = compileLayout(factoryLayout)
  const { dsl } = decompileLayout(scene)
  for (const e of dsl.entities.filter(e => e.type === 'Solid')) {
    assert.equal('rotation' in e, false, `${e.ref} should omit identity rotation`)
  }
})

test('unconvertible scene entities are reported, never silently dropped', () => {
  const scene = compileLayout(factoryLayout)
  // Inject entities the Layout DSL cannot express.
  scene.objects.push({ type: 'MeasureLine', id: 'ml_1', name: 'span', p1: { x: 0, y: 0, z: 0 }, p2: { x: 1, y: 0, z: 0 } })
  scene.objects.push({ type: 'ImportedMesh', id: 'im_1', name: 'cad', positions: '', normals: null, indices: null, offset: { x: 0, y: 0, z: 0 } })

  const { dsl, warnings } = decompileLayout(scene)
  assert.equal(warnings.length, 2)
  assert.ok(warnings.some(w => w.id === 'ml_1' && w.type === 'MeasureLine'))
  assert.ok(warnings.some(w => w.id === 'im_1' && w.type === 'ImportedMesh'))
  // The convertible remainder still round-trips.
  assert.equal(dsl.entities.some(e => e.ref === 'workbench'), true)
})

test('decompileLayout throws on a non-object scene', () => {
  assert.throws(() => decompileLayout(null), /non-null object/)
})
