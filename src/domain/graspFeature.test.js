/**
 * graspFeature — where to grasp, as a declaration (ADR-119 D2/D3, ADR-128).
 *
 * ## What this suite is arguing
 *
 * ADR-119's two open claims were **"unstated and stated-anywhere are
 * distinguishable"** (D2) and **"a declaration is never silently widened"** (D3).
 * Neither can be settled by looking at the samples alone: `derived` and
 * `declared-anywhere` produce the SAME sample set on purpose, so a test that
 * compares point clouds would pass while the distinction was being erased. The
 * evidence has to be about the STATE, which is why half of these assertions are
 * about a name rather than a number.
 *
 * The D3 half is the opposite shape — there the samples ARE the claim, and the
 * assertion that matters is a NEGATIVE one: that no derived face appears in the
 * output. A test written as "the declared face is present" would pass under a
 * merge, which is precisely the bug D3 forbids.
 *
 * ADR-152 (grasp specs + strategy, the D2 face words) adds the rest: the five
 * malformed shapes, the lossless migration of the old face list (SAME samples, not
 * "a similar set"), the default strategy said as a default, and "+x — where is
 * that?" answered for a turned object.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GRASP_FEATURE_KIND, GRASP_FEATURE_STATE, DECLARABLE_FACES, LEGACY_FACE_LIST_KIND,
  DECLARED_FEATURE_KINDS, DEFAULT_STRATEGY,
  resolveGraspFeature, graspFeatureGaps, graspFeatureSummary, strategySummary,
  faceNormalOrThrow, inPlaneAxesOrThrow, facesAreOpposed, FULL_REGION,
  specUsability, usableSpecs, faceWorldWord, contactFacesOf, TILTED_WORD,
  specToDsl, featureToDsl, newSpec,
} from './graspFeature.js'
import {
  resolveGraspTargets, surfaceSamplesFor, samplingPlanFor, graspSpecsFor,
  sendsDerivedSamples, faceRegionSamples, targetBoxFor,
} from './graspTargets.js'
import { GRIPPER_KIND } from '../context/GraspDeclarationCatalog.js'

/** A 0.3 × 0.2 × 0.1 box at the origin, optionally carrying a declaration. */
const solid = (graspFeature) => ({
  ref: 's1', type: 'Solid', name: 'Box',
  position: { x: 0, y: 0, z: 0 },
  dimensions: { x: 0.3, y: 0.2, z: 0.1 },
  ...(graspFeature ? { graspFeature } : {}),
})

const targetOf = (entity) => resolveGraspTargets([entity])[0]

// ── D2: the four states are four states (原則 #31) ───────────────────────────

test('宣言が無いことは derived という「答え」であって欄の欠落ではない', () => {
  const r = resolveGraspFeature(solid(null))
  assert.equal(r.state, GRASP_FEATURE_STATE.DERIVED)
  assert.deepEqual(r.errors, [])
})

test('宣言された「どこでもよい」は derived と別の状態になる — 同じサンプルを返すのに', () => {
  const silent  = resolveGraspFeature(solid(null))
  const spoken  = resolveGraspFeature(solid({ kind: GRASP_FEATURE_KIND.ANYWHERE }))
  assert.notEqual(silent.state, spoken.state)
  assert.equal(spoken.state, GRASP_FEATURE_STATE.DECLARED_ANYWHERE)

  // ...and the samples ARE identical. This is the assertion that makes the one
  // above load-bearing: if the states were collapsed, nothing about the geometry
  // would notice (原則 #31 — the difference has no numeric shadow).
  const a = surfaceSamplesFor(targetOf(solid(null)), GRIPPER_KIND.SUCTION)
  const b = surfaceSamplesFor(targetOf(solid({ kind: GRASP_FEATURE_KIND.ANYWHERE })), GRIPPER_KIND.SUCTION)
  assert.deepEqual(a, b)
})

test('画面に出る文が 2 つの状態を区別する — 沈黙は「宣言していない」と言われる', () => {
  const silent = graspFeatureSummary(resolveGraspFeature(solid(null)), ['+z'])
  const spoken = graspFeatureSummary(resolveGraspFeature(solid({ kind: GRASP_FEATURE_KIND.ANYWHERE })), ['+z'])
  assert.match(silent, /not declared/)
  assert.match(spoken, /declared: anywhere/)
  assert.notEqual(silent, spoken)
})


/** A spec as the panel writes it. */
const spec = (over = {}) => ({
  name: 'top pinch', hand: GRIPPER_KIND.PARALLEL_JAW,
  approach: { from: '+z' }, closing: 'y', depth: 20, ...over,
})
const specs = (list, strategy) => ({ kind: GRASP_FEATURE_KIND.SPECS, specs: list, ...(strategy ? { strategy } : {}) })

// ── ADR-152 D1: the vocabulary ───────────────────────────────────────────────

test('"上から降りて、左右を挟んで、上面から 20 mm 下。ダメなら上面を吸う" が 2 仕様 + 戦略で言える', () => {
  const r = resolveGraspFeature(solid(specs([
    spec(),
    { name: 'top suck', hand: GRIPPER_KIND.SUCTION, approach: { from: '+z', region: { uMin: 0.25, uMax: 0.75, vMin: 0.25, vMax: 0.75 } } },
  ], { order: 'priority', fallback: 'none' })))
  assert.equal(r.state, GRASP_FEATURE_STATE.DECLARED_SPECS)
  assert.deepEqual(r.specs.map(s => s.name), ['top pinch', 'top suck'])
  assert.equal(r.specs[0].closing, 'y')
  assert.equal(r.specs[0].depth, 20)
  assert.equal(r.strategyDeclared, true)
})

test('仕様の不正 5 種はどれも malformed — 黙って無視しない', () => {
  for (const [label, broken] of [
    ['closing が進入軸と同じ',   specs([spec({ closing: 'z' })])],
    ['吸引に closing',          specs([spec({ hand: GRIPPER_KIND.SUCTION, depth: undefined })])],
    ['吸引に depth',            specs([spec({ hand: GRIPPER_KIND.SUCTION, closing: undefined })])],
    ['名前の重複',              specs([spec(), spec({ closing: 'x' })])],
    ['空の specs',              specs([])],
  ]) {
    const r = resolveGraspFeature(solid(broken))
    assert.equal(r.state, GRASP_FEATURE_STATE.MALFORMED, label)
    assert.ok(r.errors.length > 0, `${label}: 理由を持たない malformed は無言の no-op と同じ (原則 #11)`)
  }
})

test('読めない宣言は derived へ落ちず malformed という第 4 の状態になる', () => {
  for (const broken of [
    { kind: 'somewhere' },
    { kind: GRASP_FEATURE_KIND.SPECS },
    specs([spec({ approach: { from: '+q' } })]),
    specs([spec({ approach: { from: '+z', region: { uMin: 0.7, uMax: 0.7 } } })]),
    specs([spec({ depth: -1 })]),
    specs([spec({ hand: 'magnet' })]),
    specs([spec()], { order: 'random', fallback: 'none' }),
    { kind: LEGACY_FACE_LIST_KIND, faces: [] },
    { kind: LEGACY_FACE_LIST_KIND, faces: [{ face: '+z' }, { face: '+z' }] },
  ]) {
    const r = resolveGraspFeature(solid(broken))
    assert.equal(r.state, GRASP_FEATURE_STATE.MALFORMED, JSON.stringify(broken))
    assert.ok(r.errors.length > 0)
  }
})

test('malformed は何もサンプルしない — 「解が無い」に化けさせない', () => {
  const t = targetOf(solid({ kind: 'somewhere' }))
  assert.deepEqual(surfaceSamplesFor(t, GRIPPER_KIND.SUCTION), [])
  assert.deepEqual(graspSpecsFor(t, GRIPPER_KIND.SUCTION), [])
  assert.equal(sendsDerivedSamples(t.feature), false)
  assert.ok(graspFeatureGaps(t.feature, GRIPPER_KIND.SUCTION).length > 0)
})

test('戦略の省略は既定値の押し付けではない — 既定として区別され、画面が「(default)」と言う', () => {
  const omitted  = resolveGraspFeature(solid(specs([spec()])))
  const declared = resolveGraspFeature(solid(specs([spec()], { ...DEFAULT_STRATEGY })))
  assert.deepEqual(omitted.strategy, declared.strategy, '同じ既定の値を持つ')
  assert.equal(omitted.strategyDeclared, false)
  assert.equal(declared.strategyDeclared, true)
  assert.match(strategySummary(omitted), /\(default\)/)
  assert.doesNotMatch(strategySummary(declared), /\(default\)/)
})

test('kind の語彙に faces は無い — 書ける経路を残さない (§1.1)', () => {
  assert.deepEqual([...DECLARED_FEATURE_KINDS].sort(), ['anywhere', 'specs'])
  assert.ok(!DECLARED_FEATURE_KINDS.includes(LEGACY_FACE_LIST_KIND))
})

// ── 旧 faces の移行は無損失 ───────────────────────────────────────────────────

test('旧 faces は読み込み時に仕様へ移行し、件数を数える', () => {
  const r = resolveGraspFeature(solid({
    kind: LEGACY_FACE_LIST_KIND,
    faces: [{ face: '+x', region: { uMin: 0.2, uMax: 0.8 } }, { face: '-x' }],
  }))
  assert.equal(r.state, GRASP_FEATURE_STATE.DECLARED_SPECS)
  assert.equal(r.migratedFaces, 2)
  assert.deepEqual(r.specs.map(s => [s.name, s.approach.from, s.closing, s.depth]), [['+x', '+x', null, 0], ['-x', '-x', null, 0]])
  assert.deepEqual(r.strategy, { order: 'score', fallback: 'none' }, '和集合をスコア順 = 以前と同じ答え')
  // どの手でも使える (面の列は手を持たなかった)。
  assert.equal(usableSpecs(r, GRIPPER_KIND.SUCTION).length, 2)
})

test('移行した仕様が作るサンプルは、移行前の面のサンプルと 1 点も違わない', () => {
  const t = targetOf(solid({
    kind: LEGACY_FACE_LIST_KIND,
    faces: [{ face: '+z', region: { uMin: 0.5, uMax: 1, vMin: 0, vMax: 0.5 } }, { face: '-z' }],
  }))
  const wire = graspSpecsFor(t, GRIPPER_KIND.PARALLEL_JAW)
  assert.deepEqual(wire.map(w => w.id), ['+z', '-z'])
  assert.deepEqual(wire[0].samples, faceRegionSamples(t, '+z', { uMin: 0.5, uMax: 1, vMin: 0, vMax: 0.5 }))
  assert.deepEqual(wire[1].samples, faceRegionSamples(t, '-z', FULL_REGION))
  // 絞る事実は何も足されない (= core/ は以前と同じ候補を同じ順で作る)。
  for (const w of wire) {
    assert.ok(!('closingAxis' in w) && !('depth' in w) && !('tiltTolerance' in w))
  }
})

// ── D3: declaration wins, and never merges ───────────────────────────────────

test('仕様を宣言すると導出サンプルは送らない — 宣言した fallback だけが広げる', () => {
  const narrowed = targetOf(solid(specs([spec()])))
  assert.equal(sendsDerivedSamples(narrowed.feature), false)
  const widened = targetOf(solid(specs([spec()], { order: 'priority', fallback: 'derived' })))
  assert.equal(sendsDerivedSamples(widened.feature), true)
  assert.equal(sendsDerivedSamples(targetOf(solid(null)).feature), true)
})

test('宣言された進入面だけが使われる — 導出面は 1 つも混ざらない (マージの否定)', () => {
  const t = targetOf(solid(specs([{ name: 'under', hand: GRIPPER_KIND.SUCTION, approach: { from: '-z' } }])))
  const [w] = graspSpecsFor(t, GRIPPER_KIND.SUCTION)
  assert.equal(w.samples.length, 9)
  for (const smp of w.samples) {
    assert.equal(smp.normal[2], -1, '宣言は -z のみ。+z が 1 つでも在れば静かに広げられている')
  }
})

test('領域を宣言するとサンプルはその矩形の中だけに入る', () => {
  const t = targetOf(solid(specs([{
    name: 'corner', hand: GRIPPER_KIND.SUCTION,
    approach: { from: '+z', region: { uMin: 0.5, uMax: 1, vMin: 0, vMax: 0.5 } },
  }])))
  const [w] = graspSpecsFor(t, GRIPPER_KIND.SUCTION)
  for (const smp of w.samples) {
    assert.ok(smp.point[0] > 0 && smp.point[1] < 0, `(${smp.point}) は宣言した領域の外`)
  }
})

test('導出のサンプルは語彙の追加で 1 点も動かない', () => {
  assert.deepEqual(samplingPlanFor(targetOf(solid(null)).feature, GRIPPER_KIND.PARALLEL_JAW).map(p => p.face), ['+x', '-x'])
  assert.equal(surfaceSamplesFor(targetOf(solid(null)), GRIPPER_KIND.PARALLEL_JAW).length, 18)
})

// ── 手と仕様の不一致: 不正ではない、理由つきで除外 ────────────────────────────

test('手と一致しない仕様は理由つきで除外され、残りの仕様だけが送られる', () => {
  const t = targetOf(solid(specs([
    spec(),
    { name: 'top suck', hand: GRIPPER_KIND.SUCTION, approach: { from: '+z' } },
  ])))
  assert.deepEqual(graspSpecsFor(t, GRIPPER_KIND.SUCTION).map(w => w.id), ['top suck'])
  const u = specUsability(t.feature.specs[0], GRIPPER_KIND.SUCTION)
  assert.equal(u.usable, false)
  assert.match(u.reason, /top pinch/)
  assert.deepEqual(graspFeatureGaps(t.feature, GRIPPER_KIND.SUCTION), [])
})

test('全仕様が除外されたら探索を止めて理由を出す — fallback へ黙って落ちない', () => {
  const t = targetOf(solid(specs([spec()], { order: 'priority', fallback: 'derived' })))
  const gaps = graspFeatureGaps(t.feature, GRIPPER_KIND.SUCTION)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /no grasp spec can be used/)
})

// ── The ADR-118 defect, re-entered through the declaration's front door ──────

test('閉じ軸の無いジョーの仕様が 1 面からしか来ないと gap — 幅が 1 面の広がりになる', () => {
  const t = targetOf(solid({ kind: LEGACY_FACE_LIST_KIND, faces: [{ face: '+x' }] }))
  const gaps = graspFeatureGaps(t.feature, GRIPPER_KIND.PARALLEL_JAW)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /closing axis/)
})

test('閉じ軸を宣言すれば 1 面からの進入でジョーが使える — 幅は box の厚みで測られる', () => {
  const t = targetOf(solid(specs([spec()])))
  assert.deepEqual(graspFeatureGaps(t.feature, GRIPPER_KIND.PARALLEL_JAW), [])
})

test('対向面の対なら閉じ軸なしでもよい (旧 faces の ±z 対)', () => {
  const t = targetOf(solid({ kind: LEGACY_FACE_LIST_KIND, faces: [{ face: '+z' }, { face: '-z' }] }))
  assert.deepEqual(graspFeatureGaps(t.feature, GRIPPER_KIND.PARALLEL_JAW), [])
})

test('吸引は 1 面で足りる', () => {
  const t = targetOf(solid({ kind: LEGACY_FACE_LIST_KIND, faces: [{ face: '+z' }] }))
  assert.deepEqual(graspFeatureGaps(t.feature, GRIPPER_KIND.SUCTION), [])
})

// ── ワイヤへの解決: 局所 → 世界 ───────────────────────────────────────────────

test('閉じ軸は物体の回転で世界へ回され、深さは宣言したときだけ載る', () => {
  const turned = { ...solid(specs([spec({ closing: 'x', depth: undefined })])), rotation: { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 } }
  const [w] = graspSpecsFor(targetOf(turned), GRIPPER_KIND.PARALLEL_JAW)
  assert.ok(Math.abs(w.closingAxis[1] - 1) < 1e-12, `局所 x は z まわり 90° で世界 +y (${w.closingAxis})`)
  assert.ok(!('depth' in w), '宣言しない深さを 0 として送らない')
  const [d] = graspSpecsFor(targetOf(solid(specs([spec()]))), GRIPPER_KIND.PARALLEL_JAW)
  assert.equal(d.depth, 20)
})

test('対象の box は kind を持たない (契約の target.box は 1 つの箱)', () => {
  const b = targetBoxFor(targetOf(solid(null)))
  assert.deepEqual(Object.keys(b).sort(), ['center', 'halfExtents', 'orientation'])
  assert.deepEqual(b.halfExtents, [0.15, 0.1, 0.05])
})

// ── D2: 「+x ってどこ?」 ────────────────────────────────────────────────────

test('無回転なら +x は前、+z は上 (ROS: +X 前 / +Y 左 / +Z 上)', () => {
  assert.equal(faceWorldWord('+x', null).label, '+x · front')
  assert.equal(faceWorldWord('-y', null).label, '-y · right')
  assert.equal(faceWorldWord('+z', null).label, '+z · top')
})

test('z まわり 90° 回すと +x は左 — 語は物体に付き、添え字は世界に付く', () => {
  const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
  assert.equal(faceWorldWord('+x', q).word, 'left')
  assert.equal(faceWorldWord('+z', q).word, 'top')
})

test('どの世界軸とも 30° 超ずれていれば「斜め」— 嘘の「上」を付けない', () => {
  const tilt = (deg) => ({ x: Math.sin(deg * Math.PI / 360), y: 0, z: 0, w: Math.cos(deg * Math.PI / 360) })
  assert.equal(faceWorldWord('+z', tilt(25)).word, 'top')
  assert.equal(faceWorldWord('+z', tilt(40)).word, TILTED_WORD)
})

test('接触面は閉じ軸から導出される 2 面 — 進入面とは別物', () => {
  assert.deepEqual(contactFacesOf('y'), ['+y', '-y'])
  assert.throws(() => contactFacesOf('w'), /未宣言の閉じ軸/)
})

test('要約は仕様の数と名前と戦略を言う', () => {
  const r = resolveGraspFeature(solid(specs([spec()])))
  assert.match(graspFeatureSummary(r, ['+z']), /1 grasp spec \(top pinch\).*\(default\)/)
})

// ── The vocabulary refuses to guess (原則 #31) ───────────────────────────────

test('未宣言の面名は既定へ倒れず throw する', () => {
  assert.throws(() => faceNormalOrThrow('+q'), /未宣言の面/)
  assert.throws(() => inPlaneAxesOrThrow('top'), /未宣言の面/)
  assert.throws(() => faceWorldWord('top', null), /未宣言の面/)
})

test('6 面すべてに法線と面内 2 軸が在る — 語彙に穴が無い', () => {
  assert.equal(DECLARABLE_FACES.length, 6)
  for (const face of DECLARABLE_FACES) {
    const n = faceNormalOrThrow(face)
    assert.equal(Math.abs(n.x) + Math.abs(n.y) + Math.abs(n.z), 1)
    const [u, v] = inPlaneAxesOrThrow(face)
    assert.notEqual(u, v)
  }
})

test('対向関係は 3 対ちょうど — ジョーの gap 判定が拠って立つ構造', () => {
  const pairs = DECLARABLE_FACES.filter(a => DECLARABLE_FACES.some(b => facesAreOpposed(a, b)))
  assert.equal(pairs.length, 6)
  assert.ok(facesAreOpposed('+x', '-x'))
  assert.ok(!facesAreOpposed('+x', '+y'))
})

test('省略された region は面全体を意味する', () => {
  const r = resolveGraspFeature(solid(specs([spec()])))
  assert.deepEqual(r.specs[0].approach.region, FULL_REGION)
})

// ── 基数: 宣言は Solid 1 つにつき 0..1、仕様は 1..N (原則 #31 の台帳行) ────────

test('宣言は必ず解決される — 対象が在るかぎり feature が undefined になることは無い', () => {
  const targets = resolveGraspTargets([solid(null), { ...solid(null), ref: 's2' }])
  assert.equal(targets.length, 2)
  for (const t of targets) {
    assert.ok(t.feature)
    assert.equal(t.feature.state, GRASP_FEATURE_STATE.DERIVED)
    assert.deepEqual(t.feature.specs, [])
  }
})

// ── 書き戻し: 読んだものを書くと同じものが読める (書き出しは specs だけ) ─────────

test('解決 → DSL → 解決 が不動点 — 省略は省略のまま書かれる', () => {
  const dsl = specs([
    spec({ approach: { from: '+z', region: { uMin: 0.2, uMax: 0.8, vMin: 0, vMax: 1 }, tiltTolerance: 0.2 } }),
    { name: 'top suck', hand: GRIPPER_KIND.SUCTION, approach: { from: '+z' } },
  ])
  const r1 = resolveGraspFeature(solid(dsl))
  const written = featureToDsl(r1.specs, r1.strategy, r1.strategyDeclared, GRIPPER_KIND.PARALLEL_JAW)
  assert.deepEqual(written, dsl, '戦略を宣言していなければ書かない、面全体の領域も書かない')
  assert.deepEqual(resolveGraspFeature(solid(written)), r1)
})

test('旧 faces を編集して書くと specs になり、faces を書く経路は無い', () => {
  const r = resolveGraspFeature(solid({ kind: LEGACY_FACE_LIST_KIND, faces: [{ face: '+x' }, { face: '-x' }] }))
  const written = featureToDsl(r.specs, r.strategy, r.strategyDeclared, GRIPPER_KIND.SUCTION)
  assert.equal(written.kind, GRASP_FEATURE_KIND.SPECS)
  assert.deepEqual(written.specs.map(s => s.hand), [GRIPPER_KIND.SUCTION, GRIPPER_KIND.SUCTION], '移行した仕様にはいまの手を刻む')
  assert.deepEqual(written.strategy, { order: 'score', fallback: 'none' }, '移行の戦略は以前の意味そのもの')
  const again = resolveGraspFeature(solid(written))
  assert.equal(again.migratedFaces, 0)
  assert.equal(again.state, GRASP_FEATURE_STATE.DECLARED_SPECS)
})

test('仕様が 0 個になったら specs: [] ではなく宣言の消去 (null)', () => {
  assert.equal(featureToDsl([], DEFAULT_STRATEGY, false, null), null)
})

test('新しい仕様は閉じ軸も深さも未宣言で始まり、名前は重ならない', () => {
  const s1 = newSpec([], GRIPPER_KIND.PARALLEL_JAW)
  assert.equal(s1.closing, null)
  assert.equal(s1.depthDeclared, false)
  const s2 = newSpec([s1], null)
  assert.notEqual(s2.name, s1.name)
})
