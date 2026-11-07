/**
 * placement.test.js — 配置方針の表テスト (ADR-097 §Consequences 検証)
 *
 * ADR-097 が閉じると宣言した検査のうち、純粋関数で閉じられる分:
 *   - 3 方針 × (支持あり / なし) × (Z 成分あり / なし) の全組み合わせ
 *   - 種の列挙に対する方針表の**個数**検査 (在るものを辿らない — 原則 #31)
 *   - ドラッグ平面が方針の関数であること (resting がカメラを読まない)
 *
 * ADR-098 が閉じると宣言した分 (同ファイル後半):
 *   - 支持プローブ表の**両向き**個数検査 (欠落 0 / 余り 0) と未宣言の種で throw
 *   - プローブの純粋実行 (最下面 / 原点 / 持たない) と未知の値での throw
 *   - stack assist の適用可否が方針の関数であること (resting が 1 つの意味に戻る)
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
  restsOnSurfaces,
  resolvePlacementDelta,
  resolveFaceExtrudeDistance,
  supportUnder,
  dragPlaneNormalFor,
  // ADR-098 — 支持プローブの宣言
  FOOTPRINT_PROBE,
  BOTTOM_PROBE,
  SUPPORT_PROBE_BY_KIND,
  supportProbeFor,
  SUPPORT_SURFACE_BY_KIND,
  providesSupportSurfaceFor,
  providesSupportSurface,
  supportProbeOf,
  footprintSamplesFor,
  bottomZFor,
  probeNeedsWorldOrigin,
  stackAssistApplies,
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
    [makeSolid(),                                                            PLACEMENT.RESTING],
    [new ImportedMesh('im1', 'IM', null),                                    PLACEMENT.RESTING],
    [new MeasureLine('ml1', 'ML', [new Vertex('v', new Vector3())], null),   PLACEMENT.FREE],
    [new CoordinateFrame('cf1', 'Origin', 's1', null),                       PLACEMENT.FREE],
  ]
  for (const [entity, expected] of cases) {
    assert.equal(placementOf(entity), expected,
      `${entity.constructor.name} の方針が ${expected} でない`)
  }
})

test('robot_base CF は resting — 同じ CoordinateFrame でもロールで分かれる (床は所属から — O1)', () => {
  const base = new CoordinateFrame('cf_b', 'robot_base', null, null)
  base.robotRole = ROBOT_ROLE.BASE
  assert.equal(placementKindOf(base), PLACEMENT_KIND.ROBOT_BASE_FRAME)
  assert.equal(placementOf(base), PLACEMENT.RESTING)

  const tcp = new CoordinateFrame('cf_t', 'tcp', null, null)
  tcp.robotRole = ROBOT_ROLE.TCP
  assert.equal(placementOf(tcp), PLACEMENT.FREE, 'tcp は空中に在ってよい (アームの先端)')
})

test('分類できない実体は free — ただし「宣言」であって既定ではない', () => {
  assert.equal(placementKindOf(null), null)
  assert.equal(placementOf(null), PLACEMENT.FREE)
  assert.equal(placementOf({ id: 'link1' }), PLACEMENT.FREE)
})

test('面に載るのは supported と resting だけ', () => {
  assert.equal(restsOnSurfaces(PLACEMENT.SUPPORTED), true)
  assert.equal(restsOnSurfaces(PLACEMENT.RESTING),   true)
  assert.equal(restsOnSurfaces(PLACEMENT.FREE),      false)
})

test('ADR-170 S2: grounded は退役した — 床を種類で配る方針語はもう無い (DEF-076)', () => {
  // 退役の腐敗は違反を見逃すのではなく緑を出す (原則 #31 / ADR-103) — 消えたこと自体を数える。
  assert.equal(Object.values(PLACEMENT).includes('grounded'), false, '`grounded` が方針の語彙に戻っている')
  assert.equal('GROUNDED' in PLACEMENT, false)
  for (const [kind, placement] of Object.entries(PLACEMENT_BY_KIND)) {
    assert.notEqual(placement, 'grounded', `${kind} が種類で床を持っている`)
  }
  // 消えた語を書いた呼び手は undefined を渡す — それを素通りさせない (語彙の外は throw)
  const ghost = PLACEMENT.GROUNDED
  assert.throws(() => resolvePlacementDelta({ placement: ghost, requested: { x: 0, y: 0, z: 0 }, startBottomZ: 0 }), /not a placement word/)
  assert.throws(() => dragPlaneNormalFor({ placement: ghost, cameraNormal: { x: 0, y: 0, z: 1 } }), /not a placement word/)
  assert.throws(() => resolvePlacementDelta({ placement: 'grounded', requested: { x: 0, y: 0, z: 0 }, startBottomZ: 0 }), /not a placement word/)
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

    // resting は床 Z=0 のゾーンに属している (floorZ = 0) — 床の無い場合は下の S2 の表
    [PLACEMENT.RESTING,   false, 0,    { x: 1, y: 0, z: 5 },  { x: 1, y: 0, z: 5 },  '上へは自由 (床は天井ではない)'],
    [PLACEMENT.RESTING,   false, 0,    { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: -1 }, '床を割らない範囲の下降はそのまま'],
    [PLACEMENT.RESTING,   false, 0,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -2 }, '床を割る分だけ clamp (底面が Z=0 で止まる)'],
    [PLACEMENT.RESTING,   true,  0,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -9 }, '宣言された床下は通す (G3 — 基礎・杭)'],
    [PLACEMENT.RESTING,   false, 3,    { x: 0, y: 0, z: -9 }, { x: 0, y: 0, z: -2 }, 'resting は屋根へ吸い付かない — 床を割らないだけ'],
  ]
  for (const [placement, belowGradeIntent, supportZ, requested, expected, why] of rows) {
    const got = resolvePlacementDelta({ placement, floorZ: 0, belowGradeIntent, requested, startBottomZ, supportZ })
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

test('resting の床 clamp は冪等 (2 回適用しても同じ pose)', () => {
  // 導出値を入力へ戻す閉路 (原則 #24) を作っていないことの検査。
  const p = { placement: PLACEMENT.RESTING, floorZ: 0, startBottomZ: 0, supportZ: 0 }
  const once  = resolvePlacementDelta({ ...p, requested: { x: 0, y: 0, z: -5 } })
  const twice = resolvePlacementDelta({ ...p, requested: once })
  assert.deepEqual(twice, once)
})

// ── ADR-170 S2 — 床は所属から (floorZ は floorOf が導く。ここは純粋な決定だけ) ─────

test('S2: 床の無い resting は床で止まらない — 何も定義していないシーン (D4 / G2)', () => {
  const got = resolvePlacementDelta({
    placement: PLACEMENT.RESTING, floorZ: null, requested: { x: 1, y: 0, z: -900 }, startBottomZ: 0,
  })
  assert.deepEqual(got, { x: 1, y: 0, z: -900 })
})

test('S2: 床はゾーンの高さ — 4000 の床を割らず、地下 −3000 の床まで下りられる', () => {
  const ask = (floorZ, startBottomZ, z, belowGradeIntent = false) => resolvePlacementDelta({
    placement: PLACEMENT.RESTING, floorZ, belowGradeIntent, requested: { x: 0, y: 0, z }, startBottomZ,
  }).z
  assert.equal(ask(4000, 4500, -2000), -500, '2F の床 4000 で止まる')
  assert.equal(ask(4000, 4500, -2000, true), -2000, 'S で宣言すれば床下へ (O3)')
  assert.equal(ask(-3000, 0, -5000), -3000, '地下の床は負の高さ')
})

test('S2 Q3: 床が物の上に後から来ても、跳ねない — 沈めず、引き上げない', () => {
  // 所属を宣言した / ゾーンを上げた: 床 4000、物の底は 0。次の掴みで 4000 へ跳ね上げない。
  const ask = (z) => resolvePlacementDelta({
    placement: PLACEMENT.RESTING, floorZ: 4000, requested: { x: 5, y: 0, z }, startBottomZ: 0,
  })
  assert.deepEqual(ask(0),   { x: 5, y: 0, z: 0 }, '水平に動かしても Z は 0 のまま (跳ねない)')
  assert.deepEqual(ask(-10), { x: 5, y: 0, z: 0 }, 'それ以上は沈めない')
  assert.deepEqual(ask(100), { x: 5, y: 0, z: 100 }, '上へは動ける')
  // 同じ要求を 2 回通しても同じ (1 フレーム古い状態を読む形を隠さない)
  const once = ask(0)
  assert.deepEqual(resolvePlacementDelta({
    placement: PLACEMENT.RESTING, floorZ: 4000, requested: once, startBottomZ: 0,
  }), once)
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
  // 値は world-unit = mm (ADR-136/137)。この fixture は 0.0005 / 0.002 と書かれて
  // おり、`SUPPORT_TOLERANCE` を 0.001 と読む = **1 world-unit = 1 m** を前提に
  // していた — テスト名は「1 mm」と言っているのに、値はメートル読みだった。
  // 名前のほうが意図なので、値を mm へ揃える (0.5 mm は内側、2 mm は外側)。
  assert.deepEqual(supportUnder({ bottomZ: 0.5, surfaceZ: 0 }), { kind: 'ground' })
  assert.equal(supportUnder({ bottomZ: 2, surfaceZ: 0 }), null)
})

// ── dragPlaneNormalFor — G2 ────────────────────────────────────────────────

test('ドラッグ平面は方針の関数 — 接地した実体はカメラ姿勢を読まない (G2)', () => {
  const cameraNormal = { x: 0.3, y: -0.5, z: -0.81 }
  assert.deepEqual(dragPlaneNormalFor({ placement: PLACEMENT.FREE, cameraNormal }), cameraNormal)
  assert.deepEqual(dragPlaneNormalFor({ placement: PLACEMENT.RESTING, cameraNormal }),   { x: 0, y: 0, z: 1 })
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

test('カメラ姿勢を変えても resting の平面は動かない (症状 4 の機構的原因)', () => {
  const a = dragPlaneNormalFor({ placement: PLACEMENT.RESTING, cameraNormal: { x: 1, y: 0, z: 0 } })
  const b = dragPlaneNormalFor({ placement: PLACEMENT.RESTING, cameraNormal: { x: 0, y: 0, z: -1 } })
  assert.deepEqual(a, b)
})

test('Profile は free と宣言されている (スケッチ平面は床とは限らない)', () => {
  const profile = new Profile('p1', 'P', [new Vertex('v', new Vector3())], null)
  assert.equal(placementOf(profile), PLACEMENT.FREE)
})

// ── 支持プローブの宣言表 (ADR-098 §Decision 2 / 原則 #31) ────────────────────
//
// 方針表と**同じ形**の両向き検査であることに意味がある。ADR-098 が消した欠陥は
// 「方針表は未宣言の種で throw するのに、プローブは黙って corners=[] → null を
// 返して『支持なし』に見せる」という非対称そのものだったので、対称にしたことを
// 対称なテストで示す。

test('すべての PLACEMENT_KIND が支持プローブを宣言している (未宣言の種は 0 個)', () => {
  const kinds      = Object.values(PLACEMENT_KIND)
  const undeclared = kinds.filter(k => !Object.hasOwn(SUPPORT_PROBE_BY_KIND, k))
  assert.deepEqual(undeclared, [],
    '支持プローブを宣言していない種がある — 表に行を足すこと。' +
    '未宣言のまま通すと、その種は黙って「支持なし」に見える (原則 #31)')
  // 逆向き: 表に載っているのに列挙に無い行 (退役した種の残骸) も 0 個。
  const orphaned = Object.keys(SUPPORT_PROBE_BY_KIND).filter(k => !kinds.includes(k))
  assert.deepEqual(orphaned, [], 'PLACEMENT_KIND に無い行が支持プローブ表に残っている')
  assert.equal(kinds.length, Object.keys(SUPPORT_PROBE_BY_KIND).length)
})

test('宣言されたすべてのプローブ値は語彙の中にある', () => {
  const fVocab = new Set(Object.values(FOOTPRINT_PROBE))
  const bVocab = new Set(Object.values(BOTTOM_PROBE))
  for (const [kind, probe] of Object.entries(SUPPORT_PROBE_BY_KIND)) {
    assert.ok(fVocab.has(probe.footprint), `${kind} の footprint "${probe.footprint}" は語彙外`)
    assert.ok(bVocab.has(probe.bottom),    `${kind} の bottom "${probe.bottom}" は語彙外`)
  }
})

test('footprint と bottom は対で宣言される — 片方だけ none は表現できない', () => {
  // 「足跡は在るが底は無い」実体は存在しない。片肺の宣言は書き間違いなので、
  // 表を読む側ではなく表そのものに問う。
  for (const [kind, probe] of Object.entries(SUPPORT_PROBE_BY_KIND)) {
    const fNone = probe.footprint === FOOTPRINT_PROBE.NONE
    const bNone = probe.bottom    === BOTTOM_PROBE.NONE
    assert.equal(fNone, bNone, `${kind} のプローブが片肺 (footprint=${probe.footprint} / bottom=${probe.bottom})`)
  }
})

test('未宣言の種は throw する — プローブも方針と同じ形 (原則 #31)', () => {
  assert.throws(() => supportProbeFor('somethingNobodyDeclared'), /no declared support probe/)
})

test('未知のプローブ値は throw する — fall-through で既定に見せない', () => {
  assert.throws(() => footprintSamplesFor({ footprint: 'madeUp' }, {}), /unknown footprint probe/)
  assert.throws(() => bottomZFor({ bottom: 'madeUp' }, {}), /unknown bottom probe/)
})

// ── 支える側の宣言 (ADR-102 §Decision 2) ────────────────────────────────────
//
// 「この種の底はどこか」(載る側) の**鏡像**が「この種は面を差し出すか」(支える側)。
// 鏡像なので検査も鏡像にする — 非対称を残すと、片側だけが未宣言の種で throw し、
// もう片側は黙って落ちる。その非対称こそ ADR-098 が消した欠陥の形だった。

test('すべての PLACEMENT_KIND が支持面の有無を宣言している (未宣言の種は 0 個)', () => {
  const kinds      = Object.values(PLACEMENT_KIND)
  const undeclared = kinds.filter(k => !Object.hasOwn(SUPPORT_SURFACE_BY_KIND, k))
  assert.deepEqual(undeclared, [],
    '支持面の有無を宣言していない種がある — 表に行を足すこと。' +
    '未宣言のまま通すと「その種の上には何も載らない」が誰も決めていないのに決まる (原則 #31)')
  const orphaned = Object.keys(SUPPORT_SURFACE_BY_KIND).filter(k => !kinds.includes(k))
  assert.deepEqual(orphaned, [], 'PLACEMENT_KIND に無い行が支持面表に残っている')
  assert.equal(kinds.length, Object.keys(SUPPORT_SURFACE_BY_KIND).length)
})

test('未宣言の種は throw する — 支える側も載る側と同じ形 (原則 #31)', () => {
  assert.throws(() => providesSupportSurfaceFor('somethingNobodyDeclared'),
    /no declared support surface/)
})

test('支持面の宣言は退役した instanceof の門と同じ答えを出す (振る舞いの保存)', () => {
  // 置換であって変更ではないことを固定する。退役した門は
  // `!(o instanceof MeasureLine)` ただ 1 つで、それ以外の種は素通りしていた。
  assert.equal(providesSupportSurfaceFor(PLACEMENT_KIND.MEASURE_LINE), false)
  assert.equal(providesSupportSurfaceFor(PLACEMENT_KIND.SOLID),        true)
  assert.equal(providesSupportSurfaceFor(PLACEMENT_KIND.ANNOTATION),   true)
  assert.equal(providesSupportSurfaceFor(PLACEMENT_KIND.IMPORTED_MESH), true)
  // フレームは cuboid メッシュを持たないので、旧実装でも実際には支持面に
  // ならなかった。false は挙動の変更ではなく、既にそうだった事実の宣言。
  assert.equal(providesSupportSurfaceFor(PLACEMENT_KIND.COORDINATE_FRAME),  false)
  assert.equal(providesSupportSurfaceFor(PLACEMENT_KIND.ROBOT_BASE_FRAME),  false)
})

test('分類できない実体は支持面を差し出さない (0 個の側を宣言する)', () => {
  // `placementOf` が free を、`supportProbeOf` が NO_PROBE を返すのと同じ扱い。
  assert.equal(providesSupportSurface(null), false)
  assert.equal(providesSupportSurface({ id: 'x' }), false)
})

test('実体の種別がプローブへ写る — CF は原点、幾何実体は最下面', () => {
  const base = new CoordinateFrame('cf_b', 'robot_base', null, null)
  base.robotRole = ROBOT_ROLE.BASE

  const cases = [
    [makeSolid(),                                                            FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, BOTTOM_PROBE.MIN_CORNER_Z],
    [new ImportedMesh('im1', 'IM', null),                                    FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, BOTTOM_PROBE.MIN_CORNER_Z],
    [new AnnotatedRegion('a3', 'R', [new Vertex('v', new Vector3())], null), FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID, BOTTOM_PROBE.MIN_CORNER_Z],
    [base,                                                                   FOOTPRINT_PROBE.ORIGIN_POINT,             BOTTOM_PROBE.ORIGIN_Z],
    [new CoordinateFrame('cf1', 'Origin', 's1', null),                       FOOTPRINT_PROBE.ORIGIN_POINT,             BOTTOM_PROBE.ORIGIN_Z],
    [new MeasureLine('ml1', 'ML', [new Vertex('v', new Vector3())], null),   FOOTPRINT_PROBE.NONE,                     BOTTOM_PROBE.NONE],
    [new Profile('p1', 'P', [new Vertex('v', new Vector3())], null),         FOOTPRINT_PROBE.NONE,                     BOTTOM_PROBE.NONE],
  ]
  for (const [entity, footprint, bottom] of cases) {
    const probe = supportProbeOf(entity)
    assert.equal(probe.footprint, footprint, `${entity.constructor.name} の footprint`)
    assert.equal(probe.bottom,    bottom,    `${entity.constructor.name} の bottom`)
  }
})

test('分類できない実体はプローブを持たない — 宣言であって既定ではない', () => {
  assert.deepEqual(supportProbeOf(null),          { footprint: FOOTPRINT_PROBE.NONE, bottom: BOTTOM_PROBE.NONE })
  assert.deepEqual(supportProbeOf({ id: 'link' }), { footprint: FOOTPRINT_PROBE.NONE, bottom: BOTTOM_PROBE.NONE })
})

// ── プローブの純粋実行 ──────────────────────────────────────────────────────

test('bottomFaceAndCentroid は最下面だけを採る — 傾いた実体の側面輪郭は足跡ではない', () => {
  // 上面が XY 方向へせり出した (傾いた) 箱。旧実装は全 corners を撃っていたので、
  // 天井側の張り出しが屋根に当たると実体が浮いた。足跡 = 接地している面。
  const corners = [
    { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 2, y: 2, z: 0 }, { x: 0, y: 2, z: 0 },
    { x: 9, y: 9, z: 5 }, { x: 11, y: 9, z: 5 }, { x: 11, y: 11, z: 5 }, { x: 9, y: 11, z: 5 },
  ]
  const samples = footprintSamplesFor(
    { footprint: FOOTPRINT_PROBE.BOTTOM_FACE_AND_CENTROID }, { corners })
  assert.equal(samples.length, 5, '最下面 4 点 + 重心')
  assert.ok(samples.every(s => s.x <= 2 && s.y <= 2), '上面の張り出しが足跡に混ざっている')
  assert.deepEqual(samples[4], { x: 1, y: 1 }, '重心は最下面の重心')
})

test('originPoint は world 原点 1 点、原点が無ければ 0 点 (推測で足跡を作らない)', () => {
  const probe = { footprint: FOOTPRINT_PROBE.ORIGIN_POINT }
  assert.deepEqual(footprintSamplesFor(probe, { worldPosition: { x: 3, y: 4, z: 5 } }), [{ x: 3, y: 4 }])
  assert.deepEqual(footprintSamplesFor(probe, { worldPosition: null }), [])
  // corners を渡されても読まない — 宣言が読む幾何を決める。
  assert.deepEqual(footprintSamplesFor(probe, { corners: [{ x: 9, y: 9, z: 0 }] }), [])
})

test('none のプローブは常に空 / null — 「持たない」の宣言が結果に出る', () => {
  const probe = { footprint: FOOTPRINT_PROBE.NONE, bottom: BOTTOM_PROBE.NONE }
  const geo   = { corners: [{ x: 0, y: 0, z: 7 }], worldPosition: { x: 1, y: 1, z: 1 } }
  assert.deepEqual(footprintSamplesFor(probe, geo), [])
  assert.equal(bottomZFor(probe, geo), null)
})

test('bottomZFor: minCornerZ / originZ / 幾何が無いときの null', () => {
  const corners = [{ x: 0, y: 0, z: 3 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 1, z: 5 }]
  assert.equal(bottomZFor({ bottom: BOTTOM_PROBE.MIN_CORNER_Z }, { corners }), 1)
  assert.equal(bottomZFor({ bottom: BOTTOM_PROBE.MIN_CORNER_Z }, { corners: [] }), null)
  assert.equal(bottomZFor({ bottom: BOTTOM_PROBE.ORIGIN_Z }, { worldPosition: { x: 0, y: 0, z: -2 } }), -2)
  assert.equal(bottomZFor({ bottom: BOTTOM_PROBE.ORIGIN_Z }, { worldPosition: null }), null)
})

test('probeNeedsWorldOrigin は原点系の宣言でだけ真 (呼び手が幾何を集める判定)', () => {
  assert.equal(probeNeedsWorldOrigin(supportProbeFor(PLACEMENT_KIND.COORDINATE_FRAME)), true)
  assert.equal(probeNeedsWorldOrigin(supportProbeFor(PLACEMENT_KIND.ROBOT_BASE_FRAME)), true)
  assert.equal(probeNeedsWorldOrigin(supportProbeFor(PLACEMENT_KIND.SOLID)),            false)
  assert.equal(probeNeedsWorldOrigin(supportProbeFor(PLACEMENT_KIND.MEASURE_LINE)),     false)
})

// ── stack assist の適用範囲 (ADR-098 §Decision 1 / G1・G2) ───────────────────

test('stack assist の適用可否は方針が決める — 種ではない', () => {
  assert.equal(stackAssistApplies(PLACEMENT.SUPPORTED), true)
  assert.equal(stackAssistApplies(PLACEMENT.RESTING),   true)
  assert.equal(stackAssistApplies(PLACEMENT.FREE),      false)
})

test('resting は 1 つの意味しか持たない — Solid と robot_base が同じ答えを出す (G2)', () => {
  // 当事者の報告「キューブはスタックするのにロボットはスタックしない」が、
  // 方針の差ではなく実装の差だったことを、方針の側から固定する。
  const base = new CoordinateFrame('cf_b', 'robot_base', null, null)
  base.robotRole = ROBOT_ROLE.BASE
  const cube = makeSolid()

  assert.equal(placementOf(cube), placementOf(base), '同じ resting であること')
  assert.equal(stackAssistApplies(placementOf(cube)), stackAssistApplies(placementOf(base)),
    'resting が種によって 2 つの意味を持っている (ADR-098 が消した欠陥)')

  // 逆向き — 「全部に効かせた」ではなく「方針どおりに効いた」ことを区別する。
  const userCf = new CoordinateFrame('cf1', 'ref', null, null)
  assert.equal(stackAssistApplies(placementOf(userCf)), false, 'free な CF は載らない')
})

test('支持を問える実体は、支持へ座らせられる (G3 — 問いと適用の適用範囲が一致)', () => {
  // ADR-098 の欠陥の形: supportOf() は全種で答えられるのに、座らせる経路だけが
  // 閉じていた。プローブを持つ ⇔ 補助の対象、を表の上で対応させる。
  for (const kind of Object.values(PLACEMENT_KIND)) {
    const probeable = supportProbeFor(kind).bottom !== BOTTOM_PROBE.NONE
    const seatable  = stackAssistApplies(placementFor(kind))
    assert.ok(!seatable || probeable,
      `${kind} は補助の対象なのに支持を問えない — 座らせる先が求まらない`)
  }
})

// ── resolveFaceExtrudeDistance — 形を変える操作にも同じ床 (ADR-169) ─────────────

test('ADR-169: pulling a resting bottom face down stops at the floor (a thing with a floor at 0)', () => {
  // Bottom face of a cube resting on Z=0, outward normal -Z. Pulling it "out"
  // (positive distance along the normal) would push it below grade.
  const got = resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [0, 0, 0, 0], normalZ: -1, requested: 80,
  })
  assert.equal(got, 0)
  // Pushing it inward (up) is free.
  assert.equal(resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [0, 0, 0, 0], normalZ: -1, requested: -30,
  }), -30)
})

test('ADR-169: an elevated bottom face may come down exactly to the floor and no further', () => {
  const got = resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [40, 40, 40, 40], normalZ: -1, requested: 100,
  })
  assert.equal(got, 40)
})

test('ADR-169: the top face pushed down through the body stops at the floor', () => {
  const got = resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [100, 100, 100, 100], normalZ: 1, requested: -150,
  })
  assert.equal(got, -100)
})

test('ADR-169: a tilted face is bounded by its lowest vertex', () => {
  // normal pointing 45° down; vertices at 10 and 50 — the 10 one hits first.
  const nz = -Math.SQRT1_2
  const got = resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [10, 10, 50, 50], normalZ: nz, requested: 1000,
  })
  assert.ok(Math.abs(got - 10 / Math.SQRT1_2) < 1e-9, `got ${got}`)
})

test('ADR-169: free, declared below grade, and vertical faces pass through', () => {
  const req = { faceStartZs: [0, 0, 0, 0], normalZ: -1, requested: 80 }
  assert.equal(resolveFaceExtrudeDistance({ ...req, floorZ: null }), 80, 'no floor (belongs to nothing — ADR-170 S2)')
  assert.equal(resolveFaceExtrudeDistance({ ...req, floorZ: 0, belowGradeIntent: true }), 80)
  assert.equal(resolveFaceExtrudeDistance({ ...req, floorZ: 0, normalZ: 0 }), 80)
})

test('ADR-169: a vertex already below grade (undeclared old data) is not sunk further, nor lifted', () => {
  // Face starts at -20: it may stay there (d = 0) but not go deeper.
  assert.equal(resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [-20, -20, -20, -20], normalZ: -1, requested: 50,
  }), 0)
  assert.equal(resolveFaceExtrudeDistance({
    floorZ: 0, faceStartZs: [-20, -20, -20, -20], normalZ: -1, requested: -10,
  }), -10)
})

test('ADR-170 S2: a sketch-born solid belongs to nothing, so a downward extrusion is not stopped', () => {
  // SceneService.allowedProfileHeight asks exactly this question (floorZ: null).
  const ask = (floorZ, requested) => resolveFaceExtrudeDistance({ floorZ, faceStartZs: [0], normalZ: 1, requested })
  assert.equal(ask(null, 120), 120)
  assert.equal(ask(null, -120), -120, 'no floor — ADR-170 D4 (ADR-169 stopped this at 0 by kind)')
  assert.equal(ask(0, -120), 0, 'the day a sketch is born into a zone at 0, the floor stops it')
})

test('ADR-170 S2: a face is held by the floor its zone gives, and a floor above a face does not lift it', () => {
  assert.equal(resolveFaceExtrudeDistance({ floorZ: 4000, faceStartZs: [4100, 4100], normalZ: -1, requested: 500 }), 100)
  assert.equal(resolveFaceExtrudeDistance({ floorZ: 4000, faceStartZs: [0, 0], normalZ: -1, requested: 50 }), 0,
    'a floor that came above the face later: not sunk further')
  assert.equal(resolveFaceExtrudeDistance({ floorZ: 4000, faceStartZs: [0, 0], normalZ: -1, requested: -50 }), -50,
    'nor lifted')
})

// ── level — ゾーンの板 (ADR-170 S1) ───────────────────────────────────────────

test('ADR-170: a Zone is its own kind and its policy is level; an untyped Region stays supported', () => {
  const zone = new AnnotatedRegion('z1', 'Z', [new Vertex('v', new Vector3())], null)
  zone.placeType = 'Zone'
  assert.equal(placementKindOf(zone), PLACEMENT_KIND.ZONE)
  assert.equal(placementOf(zone), PLACEMENT.LEVEL)
  const note = new AnnotatedRegion('r1', 'R', [new Vertex('v', new Vector3())], null)
  assert.equal(placementOf(note), PLACEMENT.SUPPORTED)
  assert.equal(restsOnSurfaces(PLACEMENT.LEVEL), false, 'a basement is a zone below Z = 0')
})

test('ADR-170: level moves Z only when asked, and a refused height keeps the plate where it is', () => {
  const ask = (requested, elevationRefusal = null) =>
    resolvePlacementDelta({ placement: PLACEMENT.LEVEL, requested, startBottomZ: 0, elevationRefusal })
  assert.deepEqual(ask({ x: 10, y: 20, z: 0 }), { x: 10, y: 20, z: 0 }, 'a horizontal drag')
  assert.deepEqual(ask({ x: 0, y: 0, z: 4000 }), { x: 0, y: 0, z: 4000 }, 'Z typed or Z-constrained')
  assert.deepEqual(ask({ x: 0, y: 0, z: -3000 }), { x: 0, y: 0, z: -3000 }, 'no floor under a zone — a basement')
  assert.deepEqual(ask({ x: 5, y: 0, z: 4000 }, 'two floors'), { x: 5, y: 0, z: 0 })
})

test('ADR-170: a zone is dragged on the horizontal plane, whatever the camera does', () => {
  const n = dragPlaneNormalFor({ placement: PLACEMENT.LEVEL, cameraNormal: { x: 0.3, y: 0.3, z: 0.9 } })
  assert.deepEqual(n, { x: 0, y: 0, z: 1 })
})
