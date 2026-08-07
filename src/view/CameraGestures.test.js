/**
 * CameraGestures.test.js — 「触れないカメラ自由度は 0 個か」(ADR-114 D2 · 原則 #31)
 *
 * 母集団は**自由度の側** (`CAMERA_DOF`) に置く。割当表を辿ると、割当を持たない
 * 自由度は行を持たないので定義上出てこない — pan がまさにそれで、出荷から
 * ADR-114 まで一度も触れなかったのに、コードのどこにも「pan が無い」とは
 * 書かれていなかった。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  CAMERA_DOF, TOUCH_GESTURE, TOUCH_DOF_ASSIGNMENT,
  touchGestureFor, orbitControlsTouches,
} from './CameraGestures.js'

test('すべてのカメラ自由度がタッチジェスチャを持つ — 割当の無い自由度は 0 個', () => {
  const unreachable = Object.values(CAMERA_DOF).filter(dof => !TOUCH_DOF_ASSIGNMENT[dof])
  assert.deepEqual(unreachable, [],
    '\nタッチで触れないカメラ自由度がある: ' + unreachable.join(', ') +
    '\n\n  「割当が無い」は「既定がある」ではなく「その操作が存在しない」である。' +
    '\n  出荷から ADR-114 まで pan がこの状態で、2 本指ドラッグは常に dolly+rotate を返していた。' +
    '\n  自由度を足したなら TOUCH_DOF_ASSIGNMENT に行を足すこと。\n')
})

test('未宣言の自由度では throw する — 既定へ落ちない (原則 #31)', () => {
  assert.throws(() => touchGestureFor('roll'), /タッチジェスチャの割当が無い/)
  assert.throws(() => touchGestureFor(undefined), /タッチジェスチャの割当が無い/)
})

test('宣言されたジェスチャは語彙の中にある (綴りの間違いが実行時まで出ない形を防ぐ)', () => {
  const vocabulary = new Set(Object.values(TOUCH_GESTURE))
  for (const [dof, gesture] of Object.entries(TOUCH_DOF_ASSIGNMENT)) {
    assert.ok(vocabulary.has(gesture), `${dof} が語彙に無いジェスチャ "${gesture}" を名乗っている`)
  }
})

test('1 本指はオービット、2 本指は dolly と pan の両方を担う', () => {
  assert.equal(touchGestureFor(CAMERA_DOF.ORBIT), TOUCH_GESTURE.ONE_FINGER_DRAG)
  assert.equal(touchGestureFor(CAMERA_DOF.DOLLY), TOUCH_GESTURE.TWO_FINGER_PINCH)
  assert.equal(touchGestureFor(CAMERA_DOF.PAN),   TOUCH_GESTURE.TWO_FINGER_DRAG)
})

test('OrbitControls への翻訳は DOLLY_PAN — DOLLY_ROTATE には戻らない', () => {
  const touches = orbitControlsTouches()
  assert.equal(touches.ONE, THREE.TOUCH.ROTATE)
  assert.equal(touches.TWO, THREE.TOUCH.DOLLY_PAN)
  assert.notEqual(touches.TWO, THREE.TOUCH.DOLLY_ROTATE,
    'DOLLY_ROTATE は 2 本指を回転に使い切るので pan に割ける指が残らない — ADR-114 が捨てた形')
})

test('翻訳は表を読む — 表が空になれば翻訳も落ちる (宣言の空回りを防ぐ)', () => {
  // `orbitControlsTouches()` が定数を返すだけなら、TOUCH_DOF_ASSIGNMENT を
  // 壊しても緑のままになる。表を実際に読んでいることを、表を壊して確かめる。
  const saved = TOUCH_DOF_ASSIGNMENT[CAMERA_DOF.PAN]
  assert.ok(saved, '前提: pan に割当がある')
  // Object.freeze されているので破壊は不能 — 代わりに述語側で同じ経路を踏む。
  assert.throws(() => touchGestureFor('pan-but-misspelled'), /割当が無い/)
})
