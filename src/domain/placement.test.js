/**
 * placement.test.js — 配置方針の表テスト (ADR-097 §Consequences 検証)
 *
 * ADR-097 が閉じると宣言した検査のうち、純粋関数で閉じられる分:
 *   - 3 方針 × (支持あり / なし) × (Z 成分あり / なし) の全組み合わせ
 *   - 種の列挙に対する方針表の**個数**検査 (在るものを辿らない — 原則 #31)
 *   - ドラッグ平面が方針の関数であること (grounded がカメラを読まない)
 *
 * シーンを要する検査 (不変条件・症状回帰) は `src/PosePolicy.test.js`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PLACEMENT,
  PLACEMENT_KIND,
  PLACEMENT_BY_KIND,
  placementFor,
  placementOf,
  placementKindOf,
  hasGroundInvariant,
  resolvePlacementDelta,
  supportUnder,
  dragPlaneNormalFor,
} from './placement.js'

import { Solid }           from './Solid.js'
import { ImportedMesh }    from './ImportedMesh.js'
import { MeasureLine }     from './MeasureLine.js'
import { Profile }         from './Profile.js'
import { AnnotatedPoint }  from './AnnotatedPoint.js'
import { AnnotatedLine }   from './AnnotatedLine.js'
import { AnnotatedRegion } from './AnnotatedRegion.js'
import { CoordinateFrame } from './CoordinateFrame.js'
import { Vertex }          from '../graph/Vertex.js'
import { ROBOT_ROLE }      from './robotFrames.js'
import { Vector3 }         from 'three'

// ── 宣言表そのもの (原則 #31 — 列挙して個数を検査する) ───────────────────────

test('すべての PLACEMENT_KIND が方針を宣言している (未宣言の種は 0 個)', () => {
  const kinds       = Object.values(PLACEMENT_KIND)
  const undeclared  = kinds.filter(k => !Object.hasOwn(PLACEMENT_BY_KIND, k))
  assert.deepEqual(undeclared, [],
    '方針を宣言していない種がある — 表に行を足すこと (既定値で埋めない)')
  // 逆向き: 表に載っているのに列挙に無い行 (退役した種の残骸) も 0 個。
  const orphaned = Object.keys(PLACEMENT_BY_KIND).filter(k => !kinds.includes(k))
  assert.deepEqual(orphaned, [], 'PLACEMENT_KIND に無い行が表に残っている')
  assert.equal(kinds.length, Object.keys(PLACEMENT_BY_KIND).length)
})

test('宣言されたすべての方針は PLACEMENT の語彙である', () => {
  const vocab = new Set(Object.values(PLACEMENT))
  for (const [kind, policy] of Object.entries(PLACEMENT_BY_KIND)) {
    assert.ok(vocab.has(policy), `${kind} の方針 "${policy}" は語彙外`)
  }
})

test('未宣言の種は throw する — 黙って free に落ちない (原則 #31)', () => {
  assert.throws(() => placementFor('somethingNobodyDeclared'), /no declared placement policy/)
})

// ── 実体 → 種 → 方針 ──────────────────────────────────────────────────────

/** Solid を最小構成で作る (meshView 無し)。 */
function makeSolid(id = 's1', z0 = 0, z1 = 1) {
  const pts = [
    [-1, -1, z0], [1, -1, z0], [1, 1, z0], [-1, 1, z0],
    [-1, -1, z1], [1, -1, z1], [1, 1, z1], [-1, 1, z1],
  ]
  return new Solid(id, 'S', pts.map((p, i) => new Vertex(`${id}v${i}`, new Vector3(...p))), null)
}

test('実体の種別が方針へ写る (種ごとの宣言が実体に届いている)', () => {
  const cases = [
    [new AnnotatedPoint('a1', 'P', [new Vertex('v', new Vector3())], null),  PLACEMENT.SUPPORTED],
    [new AnnotatedLine('a2', 'L', [new Vertex('v', new Vector3())], null),   PLACEMENT.SUPPORTED],
    [new AnnotatedRegion('a3', 'R', [new Vertex('v', new Vector3())], null), PLACEMENT.SUPPORTED],
    [makeSolid(),                                                            PLACEMENT.GROUNDED],
    [new ImportedMesh('im1', 'IM', null),                                    PLACEMENT.GROUNDED],
    [new MeasureLine('ml1', 'ML', [new Vertex('v', new Vector3())], null),   PLACEMENT.FREE],
    [new CoordinateFrame('cf1', 'Origin', 's1', null),                       PLACEMENT.FREE],
  ]
  for (const [entity, expected] of cases) {
    assert.equal(placementOf(entity), expected,
      `${entity.constructor.name} の方針が ${expected} でない`)
  }
})

test('robot_base CF は grounded — 同じ CoordinateFrame でもロールで分かれる', () => {
  const base = new CoordinateFrame('cf_b', 'robot_base', null, null)
  base.robotRole = ROBOT_ROLE.BASE
  assert.equal(placementKindOf(base), PLACEMENT_KIND.ROBOT_BASE_FRAME)
  assert.equal(placementOf(base), PLACEMENT.GROUNDED)

  const tcp = new CoordinateFrame('cf_t', 'tcp', null, null)
  tcp.robotRole = ROBOT_ROLE.TCP
  assert.equal(placementOf(tcp), PLACEMENT.FREE, 'tcp は空中に在ってよい (アームの先端)')
})

test('分類できない実体は free — ただし「宣言」であって既定ではない', () => {
  assert.equal(placementKindOf(null), null)
  assert.equal(placementOf(null), PLACEMENT.FREE)
  assert.equal(placementOf({ id: 'link1' }), PLACEMENT.FREE)
})

test('床の不変条件を持つのは supported と grounded だけ', () => {
  assert.equal(hasGroundInvariant(PLACEMENT.SUPPORTED), true)
  assert.equal(hasGroundInvariant(PLACEMENT.GROUNDED),  true)
  assert.equal(hasGroundInvariant(PLACEMENT.FREE),      false)
})

// ── resolvePlacementDelta — 3 方針 × 支持有無 × Z 成分有無 ────────────────────

test('表テスト: 3 方針 × (支持あり/なし) × (Z 成分あり/なし)', () => {
  const startBottomZ = 2   // 実体は床から 2 m 浮いた状態から始まる
  /** @type {[string, boolean, number|null, {x:number,y:number,z:number}, {x:number,y:number,z:number}, string][]} */
  const rows = [
    // placement, intent, supportZ, requested, expected, なぜ
    [PLACEMENT.FREE,      false, 0,    { x: 1, y: 0, z: -5 }, { x: 1, y: 0, z: -5 }, 'free は支持を持たないので素通し'],
    [PLACEMENT.FREE,      false, null, { x: 1, y: 0, z: 0 },  { x: 1, y: 0, z: 0 },  'free は支持面を見ない'],
    [PLACEMENT.FREE,      true,  0,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -9 }, 'free に belowGradeIntent は無関係'],

    [PLACEMENT.SUPPORTED, false, 0,    { x: 1, y: 2, z: 5 },  { x: 1, y: 2, z: -2 }, '支持面 0 へ座る — 上向きの Z 入力も捨てる'],
    [PLACEMENT.SUPPORTED, false, 3,    { x: 1, y: 0, z: 0 },  { x: 1, y: 0, z: 1 },  '屋根 (Z=3) の上へ持ち上げられる (Z 入力なしでも)'],
    [PLACEMENT.SUPPORTED, false, 0,    { x: 0, y: 0, z: -8 }, { x: 0, y: 0, z: -2 }, '下向きの Z 入力も捨てて支持面へ'],
    [PLACEMENT.SUPPORTED, true,  0,    { x: 0, y: 0, z: -8 }, { x: 0, y: 0, z: -2 }, 'supported に belowGradeIntent の逃げ道は無い'],
    [PLACEMENT.SUPPORTED, false, null, { x: 1, y: 1, z: 4 },  { x: 1, y: 1, z: 0 },  '支持面が求まらないなら Z を動かさない (推測で浮かせない)'],

    [PLACEMENT.GROUNDED,  false, 0,    { x: 1, y: 0, z: 5 },  { x: 1, y: 0, z: 5 },  '上へは自由 (床は天井ではない)'],
    [PLACEMENT.GROUNDED,  false, 0,    { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -1 }, '床を割らない範囲の下降はそのまま'],
    [PLACEMENT.GROUNDED,  false, 0,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -2 }, '床を割る分だけ clamp (底面が Z=0 で止まる)'],
    [PLACEMENT.GROUNDED,  true,  0,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -9 }, '宣言された床下は通す (G3 — 基礎・杭)'],
    [PLACEMENT.GROUNDED,  false, 3,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -2 }, 'grounded は屋根へ吸い付かない — 床を割らないだけ'],
  ]
  for (const [placement, belowGradeIntent, supportZ, requested, expected, why] of rows) {
    const got = resolvePlacementDelta({ placement, belowGradeIntent, requested, startBottomZ, supportZ })
    assert.deepEqual(got, expected, `${placement} / intent=${belowGradeIntent} / supportZ=${supportZ}: ${why}`)
  }
})

test('supported は Z 拘束の有無に関わらず同じ結果を出す (症状 2 の形)', () => {
  // 症状 2 は「軸拘束が補助を降ろす」設計から出ていた。方針は入口が持つので、
  // ハンドラがどんな delta を作ろうと結果は支持面である。
  const base = { placement: PLACEMENT.SUPPORTED, startBottomZ: 0, supportZ: 0 }
  const free = resolvePlacementDelta({ ...base, requested: { x: 1, y: 1, z: -3 } })
  const zAxis = resolvePlacementDelta({ ...base, requested: { x: 0, y: 0, z: -3 } })
  assert.equal(free.z, 0)
  assert.equal(zAxis.z, 0)
})

test('grounded の clamp は冪等 (2 回適用しても同じ pose)', () => {
  // 導出値を入力へ戻す閉路 (原則 #24) を作っていないことの検査。
  const p = { placement: PLACEMENT.GROUNDED, startBottomZ: 0, supportZ: 0 }
  const once  = resolvePlacementDelta({ ...p, requested: { x: 0, y: 0, z: -5 } })
  const twice = resolvePlacementDelta({ ...p, requested: once })
  assert.deepEqual(twice, once)
})

// ── supportUnder — 導出の述語 ──────────────────────────────────────────────

test('支持の導出: 地面 / 実体 / 浮遊 (null) の 3 値', () => {
  assert.deepEqual(supportUnder({ bottomZ: 0, surfaceZ: 0 }), { kind: 'ground' })
  assert.deepEqual(supportUnder({ bottomZ: 3, surfaceZ: 3, surfaceEntityId: 'roof' }),
    { kind: 'entity', id: 'roof' })
  assert.equal(supportUnder({ bottomZ: 5, surfaceZ: 0 }), null, '浮いている → 支持なし')
  assert.equal(supportUnder({ bottomZ: -2, surfaceZ: 0 }), null, 'めり込んでいる → 支持なし')
  assert.equal(supportUnder({ bottomZ: 0, surfaceZ: null }), null, '走査不能 → 推測しない')
})

test('支持の導出は 1 mm 許容の内側では成立する', () => {
  assert.deepEqual(supportUnder({ bottomZ: 0.0005, surfaceZ: 0 }), { kind: 'ground' })
  assert.equal(supportUnder({ bottomZ: 0.002, surfaceZ: 0 }), null)
})

// ── dragPlaneNormalFor — G2 ────────────────────────────────────────────────

test('ドラッグ平面は方針の関数 — 接地した実体はカメラ姿勢を読まない (G2)', () => {
  const cameraNormal = { x: 0.3, y: -0.5, z: -0.81 }
  assert.deepEqual(dragPlaneNormalFor({ placement: PLACEMENT.FREE, cameraNormal }), cameraNormal)
  assert.deepEqual(dragPlaneNormalFor({ placement: PLACEMENT.GROUNDED, cameraNormal }),  { x: 0, y: 0, z: 1 })
  assert.deepEqual(dragPlaneNormalFor({ placement: PLACEMENT.SUPPORTED, cameraNormal }), { x: 0, y: 0, z: 1 })
})

test('mounts ホストがあれば supported はホストの平面に沿う (ADR-032 §6 の一般化)', () => {
  const hostNormal = { x: 0, y: 0.7071, z: 0.7071 }
  assert.deepEqual(
    dragPlaneNormalFor({ placement: PLACEMENT.SUPPORTED, hostNormal, cameraNormal: { x: 1, y: 0, z: 0 } }),
    hostNormal)
  // free はホストがあってもカメラ面 — 方針が先に効く。
  assert.deepEqual(
    dragPlaneNormalFor({ placement: PLACEMENT.FREE, hostNormal, cameraNormal: { x: 1, y: 0, z: 0 } }),
    { x: 1, y: 0, z: 0 })
})

test('カメラ姿勢を変えても grounded の平面は動かない (症状 4 の機構的原因)', () => {
  const a = dragPlaneNormalFor({ placement: PLACEMENT.GROUNDED, cameraNormal: { x: 1, y: 0, z: 0 } })
  const b = dragPlaneNormalFor({ placement: PLACEMENT.GROUNDED, cameraNormal: { x: 0, y: 0, z: -1 } })
  assert.deepEqual(a, b)
})

test('Profile は free と宣言されている (スケッチ平面は床とは限らない)', () => {
  const profile = new Profile('p1', 'P', [new Vertex('v', new Vector3())], null)
  assert.equal(placementOf(profile), PLACEMENT.FREE)
})
