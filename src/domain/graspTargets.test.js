/**
 * graspTargets — target resolution + surface-sample derivation (ADR-117).
 *
 * The regression this file exists for is NOT "samples are computed correctly".
 * It is that the samples reach the wire AT ALL: before ADR-117 the request
 * carried no `target`, `core/` defaulted it to zero surface samples, and every
 * run through the UI returned `candidatesGenerated: 0`. A count of zero looks
 * like a legitimate answer, so nothing failed — the search was dead and green
 * (原則 #31 / the ADR-116 shape: a dead main path that still reports success).
 * Hence the cardinality cases below are load-bearing, not decoration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  TARGET_CARDINALITY,
  resolveGraspTargets,
  targetCardinality,
  selectTarget,
  surfaceSamplesFor,
  obstaclesExcluding,
  targetProjection,
  rotateVec3,
} from './graspTargets.js'

/** A Layout DSL Solid entity. */
const solid = (ref, name, pos, dim, rotation) => ({
  ref, type: 'Solid', name,
  position:   { x: pos[0], y: pos[1], z: pos[2] },
  dimensions: { x: dim[0], y: dim[1], z: dim[2] },
  ...(rotation ? { rotation } : {}),
})

/** The quick-start cell (`examples/cell_robotics_context.json`), in mm. */
const CELL = [
  solid('robot_pedestal', 'ロボット台座',     [0, 0, 200],   [220, 220, 400]),
  solid('pick_table',     'ピックテーブル',   [600, 0, 175], [300, 300, 350]),
  solid('place_conveyor', 'プレースコンベア', [0, 700, 150], [400, 250, 300]),
  { ref: 'tcp_pick', type: 'AnnotatedPoint', name: 'TCP 教示点', position: { x: 600, y: 0, z: 420 } },
  { ref: 'robot_base', type: 'CoordinateFrame', name: 'robot_base', robotRole: 'base',
    position: { x: 0, y: 0, z: 400 } },
]

// ── Resolution ───────────────────────────────────────────────────────────────

test('Solid だけが対象になる — CoordinateFrame と AnnotatedPoint は掴めない', () => {
  const targets = resolveGraspTargets(CELL)
  assert.deepEqual(targets.map(t => t.ref), ['robot_pedestal', 'pick_table', 'place_conveyor'])
})

test('ロボットの base/tcp フレームは構造上ぜったいに対象へ現れない', () => {
  // 「掴む対象」に自分の手首が出てくる形は、実体の型で最初から排除されている
  // (原則 #2 — 名前でも placeType でもなく型で分岐する)。
  const targets = resolveGraspTargets(CELL)
  assert.equal(targets.some(t => t.ref === 'robot_base'), false)
})

test('寸法 0 の Solid は既定の箱へ修復されず、対象から外れる (原則 #11)', () => {
  // 面の無い物体に面を発明したら、捏造した幾何がワイヤに載る。
  const targets = resolveGraspTargets([solid('flat', 'ぺらぺら', [0, 0, 0], [100, 100, 0])])
  assert.deepEqual(targets, [])
})

test('position / dimensions が欠けた Solid は対象から外れる', () => {
  const broken = [
    { ref: 'a', type: 'Solid', name: 'a', dimensions: { x: 1, y: 1, z: 1 } },        // no position
    { ref: 'b', type: 'Solid', name: 'b', position: { x: 0, y: 0, z: 0 } },          // no dimensions
    { ref: '',  type: 'Solid', name: 'c', position: { x: 0, y: 0, z: 0 }, dimensions: { x: 1, y: 1, z: 1 } },
  ]
  assert.deepEqual(resolveGraspTargets(broken), [])
})

test('NaN 寸法は「小さい寸法」ではない — 対象から外れる', () => {
  const nan = [solid('n', 'n', [0, 0, 0], [Number.NaN, 10, 10])]
  assert.deepEqual(resolveGraspTargets(nan), [])
})

test('entities が無い / 配列でない場合も 0 件を返し、例外を投げない', () => {
  assert.deepEqual(resolveGraspTargets(undefined), [])
  assert.deepEqual(resolveGraspTargets(null), [])
  assert.deepEqual(resolveGraspTargets({}), [])
})

test('label は表示名、同一性は ref — 名前が重複しても別の対象として解決する', () => {
  const dup = [
    solid('box_a', '同じ名前', [0, 0, 0], [10, 10, 10]),
    solid('box_b', '同じ名前', [50, 0, 0], [10, 10, 10]),
  ]
  const targets = resolveGraspTargets(dup)
  assert.equal(targets.length, 2)
  assert.deepEqual(targets.map(t => t.ref), ['box_a', 'box_b'])
})

// ── Cardinality (原則 #31) ───────────────────────────────────────────────────

test('基数 0 / 1 / N はすべて名前を持つ状態', () => {
  assert.equal(targetCardinality([]),              TARGET_CARDINALITY.NONE)
  assert.equal(targetCardinality([{ ref: 'a' }]),  TARGET_CARDINALITY.SINGLE)
  assert.equal(targetCardinality([{ ref: 'a' }, { ref: 'b' }]), TARGET_CARDINALITY.MULTI)
})

test('0 個のとき selectTarget は null — 対象を発明しない', () => {
  assert.equal(selectTarget([], null), null)
  assert.equal(selectTarget([], 'anything'), null)
})

test('1 個のときは暗黙に選ばれる (選ばせる意味が無い — 原則 #15)', () => {
  const one = resolveGraspTargets([solid('only', 'ひとつ', [0, 0, 0], [10, 10, 10])])
  assert.equal(selectTarget(one, null).ref, 'only')
})

test('N 個で未選択なら null — 1 つ目へ既定で倒さない (ADR-090 と同じ規律)', () => {
  const targets = resolveGraspTargets(CELL)
  assert.equal(targets.length, 3)
  assert.equal(selectTarget(targets, null), null,
    '既定で先頭を選ぶと、この cell では「ロボット台座を掴む」を誰も選ばずに宣言することになる')
})

test('存在しない ref を選んでいる状態は null に落ちる (消えた対象を掴まない)', () => {
  const targets = resolveGraspTargets(CELL)
  assert.equal(selectTarget(targets, 'deleted_ref'), null)
})

// ── Surface samples ──────────────────────────────────────────────────────────

test('サンプルは 9 点あり、すべて対象の上面の高さに乗る', () => {
  const [, pickTable] = resolveGraspTargets(CELL)
  const samples = surfaceSamplesFor(pickTable)
  assert.equal(samples.length, 9)
  // pick_table: center z=175, height 350 → top face at z = 350
  for (const s of samples) assert.ok(Math.abs(s.point[2] - 350) < 1e-9, `z=${s.point[2]}`)
})

test('サンプルは面の内側に収まる (縁の上に乗らない)', () => {
  const [, pickTable] = resolveGraspTargets(CELL)
  for (const s of surfaceSamplesFor(pickTable)) {
    assert.ok(Math.abs(s.point[0] - 600) < 150, `x within half-extent: ${s.point[0]}`)
    assert.ok(Math.abs(s.point[1] - 0)   < 150, `y within half-extent: ${s.point[1]}`)
  }
})

test('法線は上向きの単位ベクトル (core/ が approach = -normal に使う)', () => {
  const [, pickTable] = resolveGraspTargets(CELL)
  for (const s of surfaceSamplesFor(pickTable)) {
    assert.deepEqual(s.normal, [0, 0, 1])
  }
})

test('傾いた Solid は軸平行の嘘をつかず、回した面を報告する', () => {
  // +Y まわりに 90°: ローカル +Z (上面法線) はワールド +X を向く。
  const s = Math.SQRT1_2
  const tilted = resolveGraspTargets([
    solid('t', 'tilted', [0, 0, 0], [100, 100, 100], { x: 0, y: s, z: 0, w: s }),
  ])
  const [sample] = surfaceSamplesFor(tilted[0])
  assert.ok(Math.abs(sample.normal[0] - 1) < 1e-9, `normal.x=${sample.normal[0]}`)
  assert.ok(Math.abs(sample.normal[2] - 0) < 1e-9, `normal.z=${sample.normal[2]}`)
})

test('回転が宣言されていなければ単位回転として扱う (壊れた回転も同様に落ちる)', () => {
  const plain  = resolveGraspTargets([solid('p', 'p', [0, 0, 0], [10, 10, 10])])
  const broken = resolveGraspTargets([
    solid('b', 'b', [0, 0, 0], [10, 10, 10], { x: 'nope', y: 0, z: 0, w: 1 }),
  ])
  assert.deepEqual(surfaceSamplesFor(plain[0])[0].normal, [0, 0, 1])
  assert.deepEqual(surfaceSamplesFor(broken[0])[0].normal, [0, 0, 1])
})

test('対象が無ければサンプルは 0 件 (null 入力で落ちない)', () => {
  assert.deepEqual(surfaceSamplesFor(null), [])
})

test('rotateVec3 は単位四元数で恒等', () => {
  const v = { x: 1, y: 2, z: 3 }
  const r = rotateVec3(v, { x: 0, y: 0, z: 0, w: 1 })
  assert.ok(Math.abs(r.x - 1) < 1e-12 && Math.abs(r.y - 2) < 1e-12 && Math.abs(r.z - 3) < 1e-12)
})

// ── Obstacles ────────────────────────────────────────────────────────────────

test('掴む対象は自分自身の障害物にならない', () => {
  const targets = resolveGraspTargets(CELL)
  const obstacles = obstaclesExcluding(targets, 'pick_table')
  assert.equal(obstacles.length, 2)
  assert.equal(obstacles.some(o => o.center[0] === 600 && o.center[1] === 0), false)
})

test('境界球は箱を覆う (対角の半分) — 甘い側ではなく安全側へ丸める', () => {
  const targets = resolveGraspTargets(CELL)
  const [pedestal] = obstaclesExcluding(targets, 'pick_table')
  const expected = Math.sqrt(220 * 220 + 220 * 220 + 400 * 400) / 2
  assert.ok(Math.abs(pedestal.radius - expected) < 1e-9)
  assert.ok(pedestal.radius > 400 / 2, '最長辺の半分より小さい球は箱を覆えない')
})

test('対象が 1 つだけなら障害物は 0 件 — 宣言された 0 であって欠落ではない', () => {
  const one = resolveGraspTargets([solid('only', 'ひとつ', [0, 0, 0], [10, 10, 10])])
  assert.deepEqual(obstaclesExcluding(one, 'only'), [])
})

// ── Projection ───────────────────────────────────────────────────────────────

test('projection は基数と選択を同じ返り値で運ぶ (ロボット側と同じ形)', () => {
  const targets = resolveGraspTargets(CELL)
  const p = targetProjection(targets, 'pick_table')
  assert.equal(p.cardinality, TARGET_CARDINALITY.MULTI)
  assert.equal(p.selectedRef, 'pick_table')
  assert.deepEqual(p.list.map(t => t.ref), ['robot_pedestal', 'pick_table', 'place_conveyor'])
})

test('消えた対象を指したままの選択は projection で null に落ちる', () => {
  const targets = resolveGraspTargets(CELL)
  assert.equal(targetProjection(targets, 'gone').selectedRef, null)
})

test('対象 0 個の projection は空リストと none を運ぶ', () => {
  const p = targetProjection([], null)
  assert.deepEqual(p, { list: [], selectedRef: null, cardinality: TARGET_CARDINALITY.NONE })
})
