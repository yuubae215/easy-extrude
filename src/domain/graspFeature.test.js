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
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  GRASP_FEATURE_KIND, GRASP_FEATURE_STATE, DECLARABLE_FACES,
  resolveGraspFeature, graspFeatureGaps, graspFeatureSummary,
  faceNormalOrThrow, inPlaneAxesOrThrow, facesAreOpposed, FULL_REGION,
} from './graspFeature.js'
import { resolveGraspTargets, surfaceSamplesFor, samplingPlanFor } from './graspTargets.js'
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

test('読めない宣言は derived へ落ちず malformed という第 4 の状態になる', () => {
  for (const broken of [
    { kind: 'somewhere' },                       // 未宣言の kind
    { kind: GRASP_FEATURE_KIND.FACES },          // faces が無い
    { kind: GRASP_FEATURE_KIND.FACES, faces: [] }, // 空 = どこも掴むなという宣言
    { kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+q' }] },
    { kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+z' }, { face: '+z' }] },
  ]) {
    const r = resolveGraspFeature(solid(broken))
    assert.equal(r.state, GRASP_FEATURE_STATE.MALFORMED, JSON.stringify(broken))
    assert.ok(r.errors.length > 0, '理由を持たない malformed は無言の no-op と同じ (原則 #11)')
  }
})

test('malformed は何もサンプルしない — 「解が無い」に化けさせない', () => {
  const t = targetOf(solid({ kind: 'somewhere' }))
  assert.deepEqual(surfaceSamplesFor(t, GRIPPER_KIND.SUCTION), [])
  // ...and it is BLOCKED rather than merely empty: an empty sample set alone
  // would come back as a well-formed `candidatesGenerated: 0` (ADR-117 の再演)。
  assert.ok(graspFeatureGaps(t.feature, GRIPPER_KIND.SUCTION).length > 0)
})

// ── D3: declaration wins, and never merges ───────────────────────────────────

test('宣言された面だけが使われる — 導出面は 1 つも混ざらない (マージの否定)', () => {
  // Suction derives '+z'. Declaring '-z' must produce samples that contain NO
  // '+z' sample — asserting only "the declared face is present" would pass under
  // a merge, which is the defect D3 exists to prevent.
  const t = targetOf(solid({ kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '-z' }] }))
  const samples = surfaceSamplesFor(t, GRIPPER_KIND.SUCTION)
  assert.ok(samples.length > 0)
  for (const s of samples) {
    assert.equal(s.normal[2], -1, '宣言は -z のみ。+z が 1 つでも在れば静かに広げられている')
    assert.ok(s.point[2] < 0)
  }
})

test('宣言の面集合がそのまま計画になる (導出との和集合を取らない)', () => {
  const feature = resolveGraspFeature(solid({
    kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+y' }, { face: '-y' }],
  }))
  const plan = samplingPlanFor(feature, GRIPPER_KIND.PARALLEL_JAW)
  assert.deepEqual(plan.map(p => p.face), ['+y', '-y'])
})

test('領域を宣言するとサンプルはその矩形の中だけに入る', () => {
  const t = targetOf(solid({
    kind: GRASP_FEATURE_KIND.FACES,
    faces: [{ face: '+z', region: { uMin: 0.5, uMax: 1, vMin: 0, vMax: 0.5 } }],
  }))
  const samples = surfaceSamplesFor(t, GRIPPER_KIND.SUCTION)
  assert.equal(samples.length, 9)
  for (const s of samples) {
    // x half-extent 0.15, region covers the +x half → every x > 0.
    assert.ok(s.point[0] > 0, `x=${s.point[0]} は宣言した領域の外`)
    assert.ok(s.point[1] < 0, `y=${s.point[1]} は宣言した領域の外`)
  }
})

test('領域を宣言しない面は宣言前とまったく同じ点を出す (語彙追加が既存の答えを動かさない)', () => {
  const before = surfaceSamplesFor(targetOf(solid(null)), GRIPPER_KIND.SUCTION)
  const after  = surfaceSamplesFor(
    targetOf(solid({ kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+z' }] })),
    GRIPPER_KIND.SUCTION,
  )
  assert.deepEqual(after, before)
})

// ── The ADR-118 defect, re-entered through the declaration's front door ──────

test('平行ジョーに 1 面だけ宣言すると gap になる — 幅がサンプルから測られるため', () => {
  const t = targetOf(solid({ kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+x' }] }))
  const gaps = graspFeatureGaps(t.feature, GRIPPER_KIND.PARALLEL_JAW)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /opposed/)
})

test('対向面の対なら ±x でなくてもよい — 導出集合は既定であって規則ではない', () => {
  const t = targetOf(solid({
    kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+z' }, { face: '-z' }],
  }))
  assert.deepEqual(graspFeatureGaps(t.feature, GRIPPER_KIND.PARALLEL_JAW), [])
})

test('吸引は 1 面で足りる — カップは 1 面に密着するので対を要求しない', () => {
  const t = targetOf(solid({ kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+z' }] }))
  assert.deepEqual(graspFeatureGaps(t.feature, GRIPPER_KIND.SUCTION), [])
})

// ── The vocabulary refuses to guess (原則 #31) ───────────────────────────────

test('未宣言の面名は既定へ倒れず throw する', () => {
  assert.throws(() => faceNormalOrThrow('+q'), /未宣言の面/)
  assert.throws(() => inPlaneAxesOrThrow('top'), /未宣言の面/)
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
  assert.equal(pairs.length, 6, '6 面すべてが相方を持つ = 3 対')
  assert.ok(facesAreOpposed('+x', '-x'))
  assert.ok(!facesAreOpposed('+x', '+y'))
})

test('省略された region は面全体を意味する', () => {
  const r = resolveGraspFeature(solid({ kind: GRASP_FEATURE_KIND.FACES, faces: [{ face: '+z' }] }))
  assert.deepEqual(r.faces[0].region, FULL_REGION)
})

test('空の region (uMin >= uMax) は面全体へ落とさず malformed にする', () => {
  const r = resolveGraspFeature(solid({
    kind: GRASP_FEATURE_KIND.FACES,
    faces: [{ face: '+z', region: { uMin: 0.7, uMax: 0.7 } }],
  }))
  assert.equal(r.state, GRASP_FEATURE_STATE.MALFORMED)
  assert.match(r.errors[0], /uMin < uMax/)
})

test('0..1 の外に出た region は malformed — 面の外を掴めとは言えない', () => {
  const r = resolveGraspFeature(solid({
    kind: GRASP_FEATURE_KIND.FACES,
    faces: [{ face: '+z', region: { uMin: -0.2, uMax: 1.4 } }],
  }))
  assert.equal(r.state, GRASP_FEATURE_STATE.MALFORMED)
})

// ── 基数: 宣言は Solid 1 つにつき 0..1 (原則 #31 の台帳行) ────────────────────

test('宣言は必ず解決される — 対象が在るかぎり feature が undefined になることは無い', () => {
  const targets = resolveGraspTargets([solid(null), { ...solid(null), ref: 's2' }])
  assert.equal(targets.length, 2)
  for (const t of targets) {
    assert.ok(t.feature, '解決済みの宣言が無い対象が在ると、読み手が生の欄を読み始める (§1.1)')
    assert.equal(t.feature.state, GRASP_FEATURE_STATE.DERIVED)
  }
})
