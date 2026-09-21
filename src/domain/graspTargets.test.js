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

test('障害物は箱で出る — 宣言された寸法と姿勢がそのまま渡る (ADR-133 D5)', () => {
  const targets = resolveGraspTargets(CELL)
  const [pedestal] = obstaclesExcluding(targets, 'pick_table')
  assert.equal(pedestal.kind, 'box')
  assert.deepEqual(pedestal.halfExtents, [110, 110, 200])
  assert.deepEqual(pedestal.orientation, [0, 0, 0, 1])
  // かつてここは外接球で、半径は対角の半分 = 最長辺の半分より大きかった。
  // その「安全側の丸め」が腕を自分の台の内側から生やしていた (ADR-145 の実測)。
  const oldSphereRadius = Math.sqrt(220 * 220 + 220 * 220 + 400 * 400) / 2
  assert.ok(oldSphereRadius > 200, '前提: 旧表現は最長半辺より大きかった')
  assert.ok(Math.max(...pedestal.halfExtents) < oldSphereRadius)
})

test('回した箱は回った姿勢で出る — 軸平行へ丸めない', () => {
  const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }   // z 90°
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    solid('turned', '回った箱', [100, 0, 0], [40, 10, 10], q),
  ])
  const [turned] = obstaclesExcluding(targets, 'a')
  assert.deepEqual(turned.halfExtents, [20, 5, 5])
  assert.deepEqual(turned.orientation, [q.x, q.y, q.z, q.w])
})

// ── 空洞の実体 = 5 枚 (ADR-133 D2) ───────────────────────────────────────────

/** 内寸を宣言した Solid = トレー。 */
const hollow = (ref, pos, outer, inner, rotation) => ({
  ...solid(ref, ref, pos, outer, rotation),
  innerDimensions: { x: inner[0], y: inner[1], z: inner[2] },
})

test('内寸を宣言した実体は 5 枚 (床 + 壁 4) になる', () => {
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    hollow('tray', [0, 0, 100], [200, 100, 60], [180, 80, 50]),
  ])
  const boxes = obstaclesExcluding(targets, 'a')
  assert.equal(boxes.length, 5, 'トレーは 1 つの塊ではなく殻である')
  assert.ok(boxes.every(b => b.kind === 'box'))
})

test('空洞の内側は**空いている** — 腕が中へ入れることが 5 枚に割る理由', () => {
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    hollow('tray', [0, 0, 100], [200, 100, 60], [180, 80, 50]),
  ])
  const boxes = obstaclesExcluding(targets, 'a')
  // 空洞の中心: 床厚 = 60-50 = 10 なので、底面 z=70 から 10 上がって z=80 が空洞の底。
  // 空洞中心は z = 80 + 25 = 105。
  const inside = [0, 0, 105]
  for (const b of boxes) {
    const d = Math.max(
      Math.abs(inside[0] - b.center[0]) - b.halfExtents[0],
      Math.abs(inside[1] - b.center[1]) - b.halfExtents[1],
      Math.abs(inside[2] - b.center[2]) - b.halfExtents[2],
    )
    assert.ok(d > 0, `空洞の中心が箱の内側にある: ${JSON.stringify(b)}`)
  }
})

test('1 つの箱として扱うと中身が詰まる — 5 枚に割る前後の差を対照で焼く', () => {
  // 同じ寸法で内寸を宣言しなければ 1 枚で、その 1 枚は空洞の中心を飲み込む。
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    solid('solidTray', 'solid', [0, 0, 100], [200, 100, 60]),
  ])
  const [one] = obstaclesExcluding(targets, 'a')
  const inside = [0, 0, 105]
  const d = Math.max(
    Math.abs(inside[0] - one.center[0]) - one.halfExtents[0],
    Math.abs(inside[1] - one.center[1]) - one.halfExtents[1],
    Math.abs(inside[2] - one.center[2]) - one.halfExtents[2],
  )
  assert.ok(d < 0, '対照: 内寸を宣言しなければ同じ点は箱の内側 = 取り出せない')
})

test('壁は互いに重ならない — 同じ体積を二度数えない', () => {
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    hollow('tray', [0, 0, 0], [200, 100, 60], [180, 80, 50]),
  ])
  const walls = obstaclesExcluding(targets, 'a').slice(1)   // 床を除く 4 枚
  const overlaps = (p, q) =>
    Math.abs(p.center[0] - q.center[0]) < p.halfExtents[0] + q.halfExtents[0] - 1e-9 &&
    Math.abs(p.center[1] - q.center[1]) < p.halfExtents[1] + q.halfExtents[1] - 1e-9 &&
    Math.abs(p.center[2] - q.center[2]) < p.halfExtents[2] + q.halfExtents[2] - 1e-9
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      assert.ok(!overlaps(walls[i], walls[j]), `壁 ${i} と ${j} が重なっている`)
    }
  }
})

test('内寸が外寸以上なら壁が無い — 0 厚の壁 4 枚で囲われたふりをしない', () => {
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    hollow('bad', [0, 0, 0], [100, 100, 100], [100, 100, 100]),
  ])
  const boxes = obstaclesExcluding(targets, 'a')
  assert.equal(boxes.length, 1, '宣言の誤りを 5 枚の殻として通さない')
})

test('回したトレーは壁も一緒に回る — 局所オフセットを姿勢で回す', () => {
  const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }   // z 90°
  const targets = resolveGraspTargets([
    solid('a', 'A', [0, 0, 0], [10, 10, 10]),
    hollow('tray', [0, 0, 0], [200, 100, 60], [180, 80, 50], q),
  ])
  const boxes = obstaclesExcluding(targets, 'a')
  assert.equal(boxes.length, 5)
  assert.ok(boxes.every(b => b.orientation[2] === q.z && b.orientation[3] === q.w))
  // z 90° 回すと ±X 壁はワールドの ±Y 方向へ移る。回していなければ x=±95 に居た。
  const xWalls = boxes.filter(b => Math.abs(b.halfExtents[0] - 5) < 1e-9)
  assert.equal(xWalls.length, 2)
  for (const w of xWalls) {
    assert.ok(Math.abs(w.center[0]) < 1e-9, '回転後も x に留まっている = 回していない')
    assert.ok(Math.abs(Math.abs(w.center[1]) - 95) < 1e-9)
  }
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

test('対象 0 個の projection は空リストと none を運ぶ (掴む場所も null)', () => {
  const p = targetProjection([], null)
  // `feature: null` は「対象が居ないので宣言も無い」であって、宣言の *不在*
  // (= derived) ではない。0 台のときに derived を運ぶと、掴む対象が無いのに
  // 「上面全体から探します」と読める行が出る (原則 #31 の 0 の顔)。
  assert.deepEqual(p, {
    list: [], selectedRef: null, cardinality: TARGET_CARDINALITY.NONE, feature: null,
  })
})
