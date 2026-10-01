/**
 * ADR-157 D5 — the lift is a declaration, never a default: absent stays absent to
 * the wire, a broken one stops the run with its reason, the vocabulary is the
 * schema's, and the mm → m conversion happens at the one wire boundary.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DECLARED_LIFT_DIRECTIONS, LIFT_STATE, resolveLift, liftDeclarationGaps, wireLiftFor,
} from './targetLift.js'
import { resolveGraspTargets } from './graspTargets.js'
import { wireTargetFor } from './graspWire.js'

const layout = JSON.parse(readFileSync(new URL('../../schema/layout-1.0.schema.json', import.meta.url), 'utf8'))
const request = JSON.parse(readFileSync(
  new URL('../../packages/grasp-contract/schema/grasp-search-request.schema.json', import.meta.url), 'utf8'))

test('向きの語彙は DSL と契約の両方のスキーマとちょうど一致する', () => {
  const dsl = layout.$defs.entity.properties.lift.properties.along.enum
  const wire = request.$defs.graspSearchDeclaration.properties.target.properties.lift.properties.along.enum
  assert.deepEqual([...DECLARED_LIFT_DIRECTIONS].sort(), [...dsl].sort())
  assert.deepEqual([...DECLARED_LIFT_DIRECTIONS].sort(), [...wire].sort())
})

test('未宣言は未宣言のまま — 既定の距離で埋めない', () => {
  const r = resolveLift(undefined)
  assert.equal(r.state, LIFT_STATE.UNDECLARED)
  assert.deepEqual(wireLiftFor({ lift: r }), {})
  assert.deepEqual(liftDeclarationGaps({ lift: r }), [])
})

test('壊れた宣言は理由つきで MALFORMED — 落とさない (落とすと未宣言と見分けがつかない)', () => {
  for (const bad of [{ along: 'sideways', distance: 50 }, { along: 'worldUp', distance: 0 },
    { along: 'worldUp' }, 'up', { along: 'worldUp', distance: Infinity }]) {
    const r = resolveLift(bad)
    assert.equal(r.state, LIFT_STATE.MALFORMED, JSON.stringify(bad))
    assert.ok(liftDeclarationGaps({ lift: r })[0].length > 0)
    assert.deepEqual(wireLiftFor({ lift: r }), {})
  }
})

test('宣言された引き上げは mm → m でワイヤに乗る (境界はここ 1 箇所)', () => {
  const [target] = resolveGraspTargets([{
    type: 'Solid', ref: 'work', position: { x: 0, y: 0, z: 30 }, dimensions: { x: 100, y: 40, z: 60 },
    lift: { along: 'worldUp', distance: 50 },
  }])
  assert.equal(target.lift.state, LIFT_STATE.DECLARED)
  assert.deepEqual(wireTargetFor(target, null).lift, { along: 'worldUp', distance: 0.05 })
})
