/**
 * robotConfig.test.js — 描く関節配置を決める純粋核 (ADR-135 D3)
 *
 * `RobotStage.previewSolution` の判断部分。THREE を触らないのでこのレーンで走る
 * (原則 #3 — 判断と描画を分けた見返りがこれ)。
 *
 * ここで焼くのは 3 ケース (ADR-135 の検証節):
 *   null → rest / 値あり → その値 / 値あり → null で **rest に戻りきる**
 *
 * 3 つ目が主役である。`ROBOT_REST_POSE` は曲がっている 4 関節しか列挙しておらず、
 * 残り 2 つは「0 で休む」という**行を持たない 0** (原則 #31)。素直に書くと
 * 「rest へ戻す = ROBOT_REST_POSE を渡す」となり、プレビューで書いた
 * `shoulder_pan` が残ったまま緑になる — 定数を読んでも見えない欠陥なので、
 * 検査は**列挙した関節名の個数**を問う。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ROBOT_REST_POSE,
  jointValuesFor,
  previewAssignments,
  restPoseMap,
} from './robotConfig.js'

/** URDF 由来の順序の代役。実物は `view/robotSkeleton.js: ROBOT_JOINT_NAMES`。 */
const JOINT_NAMES = Object.freeze([
  'shoulder_pan_joint', 'shoulder_lift_joint', 'elbow_joint',
  'wrist_1_joint', 'wrist_2_joint', 'wrist_3_joint',
])

const SOLVED = Object.freeze([0.3, -1.4, 0.9, -0.2, 1.1, 2.0])

test('rest map names EVERY joint, including the ones the constant omits', () => {
  const rest = restPoseMap(JOINT_NAMES)
  assert.deepEqual(Object.keys(rest).sort(), [...JOINT_NAMES].sort())
  // 省略されていた 2 つは「宣言された 0」として現れる。
  assert.equal(rest.shoulder_pan_joint, 0)
  assert.equal(rest.wrist_3_joint, 0)
  // 曲がっている 4 つは定数の値のまま (rest pose を再発明していない)。
  for (const [name, angle] of Object.entries(ROBOT_REST_POSE)) {
    assert.equal(rest[name], angle, `${name} が ROBOT_REST_POSE と違う`)
  }
})

test('null draws the rest pose', () => {
  assert.deepEqual(jointValuesFor(null, JOINT_NAMES), restPoseMap(JOINT_NAMES))
})

test('a six-joint solution draws exactly that configuration', () => {
  const values = jointValuesFor(SOLVED, JOINT_NAMES)
  assert.deepEqual(Object.keys(values), [...JOINT_NAMES])
  JOINT_NAMES.forEach((name, i) => assert.equal(values[name], SOLVED[i]))
})

test('a solution then null returns to rest COMPLETELY — no joint is left behind', () => {
  // ADR-135 の「値あり → null で rest に復帰」。同じ要求を 2 回通す形で書く:
  // 1 回だけ通すテストは、戻し漏れた関節が「たまたま rest と同じ値だった」場合と
  // 区別できない。
  const posed = jointValuesFor(SOLVED, JOINT_NAMES)
  const back = jointValuesFor(null, JOINT_NAMES)

  assert.equal(posed.shoulder_pan_joint, 0.3, '前提: プレビューは pan を動かす')
  assert.equal(back.shoulder_pan_joint, 0,
    'rest へ戻したのに pan がプレビュー値のまま — ROBOT_REST_POSE を' +
    'そのまま渡すと必ずこうなる (省略された関節は書かれない)')
  assert.deepEqual(back, restPoseMap(JOINT_NAMES))
})

test('a vector of the wrong length rests instead of posing a partial arm', () => {
  // 素朴ソルバの占位解 (1 個の角度) が万一ここまで来ても、半端に適用しない。
  for (const bad of [[0.42], [], SOLVED.slice(0, 5), [...SOLVED, 0.1]]) {
    assert.deepEqual(jointValuesFor(bad, JOINT_NAMES), restPoseMap(JOINT_NAMES),
      `長さ ${bad.length} のベクトルが部分適用された`)
  }
})

test('non-array payloads rest rather than throw', () => {
  // `undeclared` 枝には joints という欄自体が無いので undefined が来る経路が在る。
  for (const bad of [undefined, {}, { kind: 'undeclared' }, 0.5]) {
    assert.deepEqual(jointValuesFor(bad, JOINT_NAMES), restPoseMap(JOINT_NAMES))
  }
})

// --- N 台側: どの腕がプレビューを描くか (ADR-135 D3) ---------------------------

test('the subject draws the solution and every other arm rests', () => {
  const got = new Map(previewAssignments(['r1', 'r2', 'r3'], 'r2', SOLVED))
  assert.deepEqual(got.get('r2'), SOLVED)
  assert.equal(got.get('r1'), null)
  assert.equal(got.get('r3'), null)
})

test('switching subject rests the arm that was previewing (N=2, not N=1)', () => {
  // ADR-093 と同型: 1 台の fixture では「主語だけ書く」実装と「主語を書き、他を
  // 休める」実装が**区別できない** (唯一の stage が常に主語だから)。2 台で焼く。
  const ids = ['r1', 'r2']
  const first = new Map(previewAssignments(ids, 'r1', SOLVED))
  assert.deepEqual(first.get('r1'), SOLVED)

  const second = new Map(previewAssignments(ids, 'r2', [...SOLVED].reverse()))
  assert.equal(second.get('r1'), null,
    '主語が移ったのに前の腕が解を持ったまま — 探索が対象にしていないロボットが' +
    '解けたふりをする')
})

test('a null subject rests every arm', () => {
  for (const [, payload] of previewAssignments(['r1', 'r2'], null, SOLVED)) {
    assert.equal(payload, null)
  }
})

test('every stage gets an assignment — none is skipped', () => {
  // 個数で問う: 「書かなかった stage」は行を持たないので、書いた側だけを辿る
  // 検査は定義上それを見ない (原則 #31)。
  const ids = ['r1', 'r2', 'r3', 'r4']
  assert.equal(previewAssignments(ids, 'r1', SOLVED).length, ids.length)
})
