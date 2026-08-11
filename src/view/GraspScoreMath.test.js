/**
 * GraspScoreMath.test.js — "unevaluated is not zero" at the presentation layer
 * (ADR-120 D3). Run via `pnpm test:context` (bare node --test, THREE-free).
 *
 * The assertions deliberately ask about the ABSENCE of a key rather than the
 * value behind it: compared by value, "could not be evaluated" and "scored 0"
 * are the same number, which is the confusion ADR-120 exists to remove.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { objectiveRows, unevaluatedNote } from './GraspScoreMath.js'

/** What `GraspController` sends by default (core/'s registered names). */
const WEIGHTS = Object.freeze({
  reach_margin: 0.6, approach_clearance: 0.4, grasp_stability: 1.0,
})

// ── The population is what the run REQUESTED ─────────────────────────────────

test('要求した objective は全部行になる — 返ってこなかったものも含めて', () => {
  const summary = objectiveRows(WEIGHTS, { approach_clearance: 0.8, grasp_stability: 0.5 })
  assert.deepEqual(summary.rows.map(r => [r.name, r.evaluated, r.value]), [
    ['reach_margin',       false, null],
    ['approach_clearance', true,  0.8],
    ['grasp_stability',    true,  0.5],
  ])
  assert.equal(summary.evaluated, 2)
  assert.equal(summary.unevaluated, 1)
})

test('未評価は 0 点と別物 — 同じ「0」でも行の状態が違う', () => {
  const unevaluated = objectiveRows(WEIGHTS, { approach_clearance: 0.8, grasp_stability: 0.5 })
  const scoredZero  = objectiveRows(WEIGHTS, { reach_margin: 0, approach_clearance: 0.8, grasp_stability: 0.5 })

  const reachOf = (s) => s.rows.find(r => r.name === 'reach_margin')
  assert.equal(reachOf(unevaluated).evaluated, false)
  assert.equal(reachOf(unevaluated).value, null)
  assert.equal(reachOf(scoredZero).evaluated, true)
  assert.equal(reachOf(scoredZero).value, 0)
  assert.equal(scoredZero.unevaluated, 0)
})

test('行の順序は要求の宣言順 — 評価できたかどうかで並び替わらない', () => {
  const all  = objectiveRows(WEIGHTS, { reach_margin: 0.3, approach_clearance: 0.8, grasp_stability: 0.5 })
  const some = objectiveRows(WEIGHTS, { approach_clearance: 0.8 })
  assert.deepEqual(all.rows.map(r => r.name), some.rows.map(r => r.name))
})

test('重み付けしていない名前が返ってきたら落とさずに載せる (weight null)', () => {
  const summary = objectiveRows({ reach_margin: 1.0 }, { reach_margin: 0.3, com_offset: 0.9 })
  const extra = summary.rows.find(r => r.name === 'com_offset')
  assert.equal(extra.weight, null)
  assert.equal(extra.evaluated, true)
  assert.equal(extra.value, 0.9)
})

// ── Malformed values are not measurements ────────────────────────────────────

test('契約の 0-1 を外れた値は clamp せず未評価として扱う', () => {
  for (const bad of [1.5, -0.2, Number.NaN, Number.POSITIVE_INFINITY, '0.5', null]) {
    const row = objectiveRows({ reach_margin: 1.0 }, { reach_margin: bad }).rows[0]
    assert.equal(row.evaluated, false, `${String(bad)} は測定値ではない`)
    assert.equal(row.value, null)
  }
})

test('重みが数として壊れていても行は残る (weight null、母集団から落とさない)', () => {
  const row = objectiveRows({ reach_margin: 'heavy' }, { reach_margin: 0.4 }).rows[0]
  assert.equal(row.weight, null)
  assert.equal(row.evaluated, true)
})

// ── Degrade, never guess ─────────────────────────────────────────────────────

test('内訳も要求も無ければ null — 何も描かない', () => {
  assert.equal(objectiveRows(null, null), null)
  assert.equal(objectiveRows(undefined, undefined), null)
})

test('要求の記録が無い応答は、返ってきた鍵だけを評価済みとして並べる', () => {
  // 旧い応答 / 記録の無い実行: 何が要求されたか分からないので「測っていない」とは
  // 言えない。言えないことを言わないのが degrade (推測しない)。
  const summary = objectiveRows(null, { reach_margin: 0.3 })
  assert.deepEqual(summary.rows, [{ name: 'reach_margin', weight: null, evaluated: true, value: 0.3 }])
  assert.equal(summary.unevaluated, 0)
})

test('要求はあるが内訳が空 = 1 つも測れなかった (全行が未評価)', () => {
  const summary = objectiveRows(WEIGHTS, {})
  assert.equal(summary.evaluated, 0)
  assert.equal(summary.unevaluated, 3)
})

// ── The note the panel prints ────────────────────────────────────────────────

test('unevaluatedNote は測れなかった名前を名指しする', () => {
  const note = unevaluatedNote(objectiveRows(WEIGHTS, { approach_clearance: 0.8, grasp_stability: 0.5 }))
  assert.match(note, /not measured/)
  assert.match(note, /reach_margin/)
  assert.doesNotMatch(note, /approach_clearance/)
})

test('全部測れていれば注記は出ない (無い事実を語らない)', () => {
  const note = unevaluatedNote(objectiveRows(WEIGHTS, {
    reach_margin: 0.3, approach_clearance: 0.8, grasp_stability: 0.5,
  }))
  assert.equal(note, null)
  assert.equal(unevaluatedNote(null), null)
})
