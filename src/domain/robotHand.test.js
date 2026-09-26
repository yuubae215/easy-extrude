/**
 * robotHand — what the robot grasps with, declared once on its tcp (ADR-152 D3).
 *
 * The claims: the three states stay three (an undeclared hand is not filled in);
 * the mount and the shape are separate facts whose CONTRADICTION stops the
 * search; and the wire `gripper` is derived from the same numbers the arm draws
 * (mm → m, shape keys only when declared).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  HAND_STATE, DEFAULT_HAND_BY_KIND, defaultHandFor, resolveHand, hasShape, handTipZ,
  handMountGap, wireGripperFromHand,
} from './robotHand.js'
import { GRIPPER_KIND } from '../context/GraspDeclarationCatalog.js'
import { toolParts, DEFAULT_TOOL_MOUNT, axialToolLengthM } from './robotTool.js'

const JAW = DEFAULT_HAND_BY_KIND[GRIPPER_KIND.PARALLEL_JAW]
const CUP = DEFAULT_HAND_BY_KIND[GRIPPER_KIND.SUCTION]

test('未宣言は undeclared のまま — 既定の手で埋めない (原則 #31)', () => {
  const r = resolveHand(undefined)
  assert.equal(r.state, HAND_STATE.UNDECLARED)
  assert.equal(r.hand, null)
})

test('既定の手はどちらの種別も読めて、形を持ち、既定の取付けと矛盾しない', () => {
  const mm = DEFAULT_TOOL_MOUNT.translation.z
  for (const h of [JAW, CUP]) {
    const r = resolveHand(h)
    assert.equal(r.state, HAND_STATE.DECLARED, JSON.stringify(r.errors))
    assert.ok(hasShape(r.hand))
    assert.equal(handMountGap(r.hand, mm), null)
    assert.equal(handTipZ(r.hand), mm)
  }
  assert.throws(() => defaultHandFor('magnet'), /未宣言のハンド種別/)
})

test('半分だけの形・負の寸法・未知の種別は malformed で理由を持つ', () => {
  for (const broken of [
    { ...JAW, fingers: undefined },
    { ...CUP, cupHeight: undefined },
    { ...JAW, body: { kind: 'cylinder', radius: -1, length: 10 } },
    { ...JAW, body: { kind: 'mesh', url: 'x.stl' } },
    { kind: 'magnet' },
    'jaw',
  ]) {
    const r = resolveHand(broken)
    assert.equal(r.state, HAND_STATE.MALFORMED, JSON.stringify(broken))
    assert.ok(r.errors.length > 0)
  }
})

test('形の無い宣言は読める — 形は任意、ゲートの値は必須', () => {
  const r = resolveHand({ kind: GRIPPER_KIND.PARALLEL_JAW, maxOpening: 60 })
  assert.equal(r.state, HAND_STATE.DECLARED)
  assert.equal(hasShape(r.hand), false)
  assert.equal(handMountGap(r.hand, 150), null, '形が無ければ矛盾は起きない')
})

test('取付けが爪の範囲外 / カップ面とずれると理由つきで止まる — どちらも直さない', () => {
  assert.match(handMountGap(JAW, 200), /off the fingers/)
  assert.match(handMountGap(JAW, 50), /off the fingers/)
  assert.equal(handMountGap(JAW, 100), null, '爪の途中の TCP は正当 (爪で挟む点)')
  assert.match(handMountGap(CUP, 149), /not on the cup face/)
  assert.equal(handMountGap(CUP, 150), null)
})

test('ワイヤの gripper は同じ手から m で導出され、形の鍵は宣言したときだけ載る', () => {
  const w = wireGripperFromHand(JAW)
  assert.deepEqual(w, {
    kind: 'parallelJaw', maxOpening: 0.06, fingerClearance: 0.01,
    body: { kind: 'cylinder', radius: 0.032, length: 0.078 },
    fingers: { length: 0.072, thickness: 0.012, width: 0.021 },
  })
  const bare = wireGripperFromHand({ kind: GRIPPER_KIND.SUCTION, cupDiameter: 40 })
  assert.deepEqual(bare, { kind: 'suction', cupDiameter: 0.04 })
  const cup = wireGripperFromHand(CUP)
  assert.equal(cup.cupHeight, 0.02)
  assert.equal(cup.sealTiltTolerance, 0.35, '角度は単位変換しない')
})

test('描く爪先とワイヤの爪先が同じ点 (m) — 見えている爪が判定されている爪', () => {
  const w = wireGripperFromHand(JAW)
  const wireTip = w.body.length + w.fingers.length
  const drawnTip = Math.max(...toolParts(JAW, axialToolLengthM(DEFAULT_TOOL_MOUNT))
    .map(p => p.center[2] + (p.shape === 'cylinder' ? p.size[1] : p.size[2]) / 2))
  assert.ok(Math.abs(wireTip - drawnTip) < 1e-12)
})
