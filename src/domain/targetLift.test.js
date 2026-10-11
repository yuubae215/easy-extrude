/**
 * ADR-157 D5 — the lift is a declaration, never a default: absent stays absent to
 * the wire, a broken one stops the run with its reason, the vocabulary is the
 * schema's, and the mm → m conversion happens at the one wire boundary.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  DECLARED_LIFT_DIRECTIONS, LIFT_STATE, LIFT_SOURCE, resolveLift, resolveDeclaredLift, liftDeclarationGaps, wireLiftFor,
} from './targetLift.js'
import { resolveGraspTargets } from './graspTargets.js'
import { wireTargetFor } from './graspWire.js'

const layout = JSON.parse(readFileSync(new URL('../../schema/layout-1.0.schema.json', import.meta.url), 'utf8'))
const request = JSON.parse(readFileSync(
  new URL('../../packages/grasp-contract/schema/grasp-search-request.schema.json', import.meta.url), 'utf8'))

test('向きの語彙は DSL と契約の両方のスキーマとちょうど一致する', () => {
  const dsl = layout.$defs.lift.properties.along.enum
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
    graspFeature: { lift: { along: 'worldUp', distance: 50 } },
  }])
  assert.equal(target.lift.state, LIFT_STATE.DECLARED)
  assert.equal(target.lift.source, LIFT_SOURCE.RELATION)
  assert.deepEqual(wireTargetFor(target, null).lift, { along: 'worldUp', distance: 0.05 })
})

// ── 引き上げは把持の関係の欄 — 旧位置は読み替える (ADR-164 D4) ─────────────────

const body = (extra) => ({
  type: 'Solid', ref: 'work', position: { x: 0, y: 0, z: 30 }, dimensions: { x: 100, y: 40, z: 60 }, ...extra,
})

test('旧位置 (Solid の lift) は読み替えられ、出所を言う — 新住所と同じワイヤになる', () => {
  const [legacy] = resolveGraspTargets([body({ lift: { along: 'reverseApproach', distance: 40 } })])
  const [moved]  = resolveGraspTargets([body({ graspFeature: { lift: { along: 'reverseApproach', distance: 40 } } })])
  assert.equal(legacy.lift.source, LIFT_SOURCE.LEGACY)
  assert.equal(moved.lift.source, LIFT_SOURCE.RELATION)
  assert.deepEqual(wireTargetFor(legacy, null).lift, wireTargetFor(moved, null).lift,
    'the old address and the new one put the same value on the wire')
  assert.deepEqual(wireTargetFor(legacy, null).lift, { along: 'reverseApproach', distance: 0.04 })
})

test('2 つの住所が違う値を言えば MALFORMED — どちらかを黙って選ばない', () => {
  const r = resolveDeclaredLift(body({
    lift: { along: 'worldUp', distance: 50 },
    graspFeature: { lift: { along: 'worldUp', distance: 80 } },
  }))
  assert.equal(r.state, LIFT_STATE.MALFORMED)
  assert.match(r.errors[0], /declared twice/)
  assert.deepEqual(wireLiftFor({ lift: r }), {})
})

test('2 つの住所が同じ値なら宣言されている (新住所から読む)', () => {
  const same = { along: 'worldUp', distance: 50 }
  const r = resolveDeclaredLift(body({ lift: same, graspFeature: { kind: 'anywhere', lift: same } }))
  assert.equal(r.state, LIFT_STATE.DECLARED)
  assert.equal(r.source, LIFT_SOURCE.RELATION)
})

test('仕様 0 個でも引き上げは言える — 関係に 1 個 (§俯瞰 D4)', () => {
  const [t] = resolveGraspTargets([body({ graspFeature: { lift: { along: 'worldUp', distance: 30 } } })])
  assert.equal(t.feature.specs.length, 0)
  assert.equal(t.lift.state, LIFT_STATE.DECLARED)
})

test('どちらにも無ければ未宣言 — 出所も無い', () => {
  const r = resolveDeclaredLift(body({ graspFeature: { kind: 'anywhere' } }))
  assert.equal(r.state, LIFT_STATE.UNDECLARED)
  assert.equal(r.source, null)
})
