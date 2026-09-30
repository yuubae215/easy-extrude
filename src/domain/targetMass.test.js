/**
 * ADR-121 / ADR-156 — the object's mass and centre of mass are DECLARATIONS:
 * absent stays absent all the way to the wire (never the centroid, never a default
 * mass), provenance rides with the value, and the point follows the object's pose.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  resolveMass, resolveCenterOfMass, centerOfMassWorld, wireMassFor, massDeclarationGaps,
  suctionHoldMissing, MASS_DECLARATION_STATE, CENTER_OF_MASS_KIND,
} from './targetMass.js'
import { resolveGraspTargets } from './graspTargets.js'
import { wireTargetFor } from './graspWire.js'
import { resolveSearchLayout, DECLARATION_KEYS } from './searchGeometry.js'
import { resolveHand, wireGripperFromHand, DEFAULT_HAND_BY_KIND } from './robotHand.js'
import { setEntityMassDeclaration } from '../context/DocBuilder.js'

const solid = (extra = {}) => ({
  ref: 'box', type: 'Solid', name: 'Box',
  position: { x: 500, y: 0, z: 30 }, dimensions: { x: 100, y: 40, z: 60 },
  rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 },  // 90° about Z
  ...extra,
})
const targetOf = (extra) => resolveGraspTargets([solid(extra)])[0]

test('未宣言は未宣言のまま — 質量も重心も既定で埋めない (ADR-121 D2)', () => {
  const t = targetOf({})
  assert.equal(t.massProperties.mass.state, MASS_DECLARATION_STATE.UNDECLARED)
  assert.equal(t.massProperties.centerOfMass.state, MASS_DECLARATION_STATE.UNDECLARED)
  assert.equal(centerOfMassWorld(t), null, 'not the centroid')
  const wire = wireTargetFor(t, 'suction')
  assert.ok(!('mass' in wire) && !('centerOfMass' in wire), 'absent keys, not zeros')
})

test('measured は物体座標 (mm) で宣言し、ワイヤへは世界座標 (m) で出る', () => {
  const t = targetOf({ mass: 0.4, centerOfMass: { kind: 'measured', point: [10, 0, -5] } })
  // local +x 10 mm turned 90° about Z → world +y 10 mm.
  const c = centerOfMassWorld(t)
  ;[[c.x, 500], [c.y, 10], [c.z, 25]].forEach(([a, e]) => assert.ok(Math.abs(a - e) < 1e-9, `${a} vs ${e}`))
  const w = wireMassFor(t)
  assert.equal(w.mass, 0.4)
  assert.equal(w.centerOfMass.kind, 'measured')
  w.centerOfMass.point.forEach((v, i) => assert.ok(Math.abs(v - [0.5, 0.01, 0.025][i]) < 1e-12))
})

test('assumedHomogeneous は点を持たず、図心 (箱の中心) を導出して出所ごと送る', () => {
  const t = targetOf({ centerOfMass: { kind: 'assumedHomogeneous' } })
  assert.deepEqual(centerOfMassWorld(t), { x: 500, y: 0, z: 30 })
  assert.equal(wireMassFor(t).centerOfMass.kind, CENTER_OF_MASS_KIND.ASSUMED_HOMOGENEOUS)
})

test('壊れた宣言は MALFORMED で理由を持ち、落とさずに Run を止める (原則 #11)', () => {
  assert.equal(resolveMass(0).state, MASS_DECLARATION_STATE.MALFORMED)
  assert.equal(resolveMass(-1).state, MASS_DECLARATION_STATE.MALFORMED)
  assert.equal(resolveCenterOfMass({ kind: 'estimated', point: [0, 0, 0] }).state, MASS_DECLARATION_STATE.MALFORMED)
  assert.equal(resolveCenterOfMass({ kind: 'measured' }).state, MASS_DECLARATION_STATE.MALFORMED)
  const t = targetOf({ mass: 'heavy' })
  assert.equal(massDeclarationGaps(t).length, 1)
  assert.ok(!('mass' in wireMassFor(t)), 'a malformed value is not sent as if it were undeclared — the gate stops first')
})

test('文書の宣言は ref で live シーンへ join される — 宣言キーの列挙に質量と重心が居る', () => {
  assert.deepEqual([...DECLARATION_KEYS].sort(), ['centerOfMass', 'graspFeature', 'mass'])
  const sceneDsl = { version: 'layout/1.0', entities: [solid()] }
  const docDsl = { version: 'layout/1.0', entities: [solid({ mass: 2, centerOfMass: { kind: 'assumedHomogeneous' } })] }
  const joined = resolveSearchLayout({ sceneDsl, docDsl }).dsl.entities[0]
  assert.equal(joined.mass, 2)
  assert.deepEqual(joined.centerOfMass, { kind: 'assumedHomogeneous' })
  assert.equal(sceneDsl.entities[0].mass, undefined, 'the join does not write through')
})

test('ハンドの保持は束 — force と friction は一緒に宣言し、ワイヤにそのまま乗る (N・無次元)', () => {
  const cup = DEFAULT_HAND_BY_KIND.suction
  assert.equal(cup.hold, undefined, 'the born hand carries no hold — no default capability')
  const ok = resolveHand({ ...cup, hold: { force: 30, friction: 0.5 } })
  assert.deepEqual(wireGripperFromHand(ok.hand).hold, { force: 30, friction: 0.5 })
  assert.equal(resolveHand({ ...cup, hold: { force: 30 } }).state, 'malformed')
  assert.ok(!('hold' in wireGripperFromHand(resolveHand(cup).hand)))
})

test('suction_hold に足りない入力を送った側から導出する (ADR-156 D4 の列挙順)', () => {
  const t = targetOf({})
  const cup = resolveHand(DEFAULT_HAND_BY_KIND.suction).hand
  assert.deepEqual(suctionHoldMissing({ hand: cup, massProperties: t.massProperties }),
    ['the hand’s hold (force, friction)', 'mass', 'centre of mass'])
  const full = targetOf({ mass: 1, centerOfMass: { kind: 'measured', point: [0, 0, 0] } })
  assert.deepEqual(suctionHoldMissing({ hand: { ...cup, hold: { force: 30, friction: 0.5 } }, massProperties: full.massProperties }), [])
  assert.deepEqual(suctionHoldMissing({ hand: null, massProperties: full.massProperties }), ['a suction hand'])
})

test('文書の書き手: null は鍵を消し (未宣言へ)、未知の鍵は throw する', () => {
  const doc = { specification: { layout: { entities: [solid({ mass: 3 })] } } }
  const cleared = setEntityMassDeclaration(doc, 'box', 'mass', null)
  assert.ok(!('mass' in cleared.specification.layout.entities[0]))
  assert.equal(doc.specification.layout.entities[0].mass, 3, 'input-immutable')
  const set = setEntityMassDeclaration(doc, 'box', 'centerOfMass', { kind: 'measured', point: [1, 2, 3] })
  assert.deepEqual(set.specification.layout.entities[0].centerOfMass, { kind: 'measured', point: [1, 2, 3] })
  assert.throws(() => setEntityMassDeclaration(doc, 'box', 'density', 1), /未宣言/)
})
