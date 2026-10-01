/**
 * ADR-157 — the phase rows / analysis are presented from wire facts only, every
 * word table covers the contract's closed vocabulary (population = the SCHEMA),
 * and the analysis's freshness is derived, never stored.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MOTION_PHASES, PHASE_LABEL, UNEVALUATED_REASON_TEXT, PART_LABEL,
  phaseRows, analysisSummary, analysisFreshness, analysisAvailability,
} from './GraspPhaseMath.js'

const schema = JSON.parse(readFileSync(
  new URL('../../packages/grasp-contract/schema/grasp-search-response.schema.json', import.meta.url), 'utf8'))
const [evaluatedBranch, unevaluatedBranch] = schema.$defs.interferencePhase.oneOf
const allPhasesBranch = schema.$defs.interferenceAnalysis.oneOf.find(b => b.properties.kind.const === 'allPhases')

test('語の表は契約の閉じた語彙をちょうど覆う (母集団はスキーマ — 足りなくても余っても落ちる)', () => {
  assert.deepEqual([...MOTION_PHASES], evaluatedBranch.properties.phase.enum)
  assert.deepEqual(Object.keys(PHASE_LABEL).sort(), [...evaluatedBranch.properties.phase.enum].sort())
  assert.deepEqual(Object.keys(UNEVALUATED_REASON_TEXT).sort(), [...unevaluatedBranch.properties.reason.enum].sort())
  const partEnum = allPhasesBranch.properties.phases.items.properties.hits.items.properties.part.enum
  assert.deepEqual(Object.keys(PART_LABEL).sort(), [...partEnum].sort())
})

const rows = [
  { phase: 'transit', kind: 'unevaluated', reason: 'notYetDecided' },
  { phase: 'approach', kind: 'evaluated', rejected: 3 },
  { phase: 'close', kind: 'evaluated', rejected: 0 },
  { phase: 'lift', kind: 'unevaluated', reason: 'liftUndeclared' },
  { phase: 'transport', kind: 'unevaluated', reason: 'notYetDecided' },
  { phase: 'place', kind: 'unevaluated', reason: 'notYetDecided' },
]

test('未評価の相は数を持たず理由の文を持つ — 0 と「見ていない」を同じ顔で並べない', () => {
  const out = phaseRows({ interferencePhases: rows })
  assert.equal(out.length, 6)
  assert.equal(out[1].rejected, 3)
  assert.equal(out[3].rejected, null)
  assert.match(out[3].note, /lift/)
  assert.equal(out[2].note, null)
})

test('v8 より前の応答では行を作らない (6 つの 0 を捏造しない)', () => {
  assert.equal(phaseRows({ rejectedByInterference: 2 }), null)
})

test('未宣言の相・理由・部位は throw する', () => {
  assert.throws(() => phaseRows({ interferencePhases: [{ phase: 'hover', kind: 'evaluated', rejected: 0 }] }), /未宣言/)
  assert.throws(() => phaseRows({ interferencePhases: [{ phase: 'lift', kind: 'unevaluated', reason: 'tooHard' }] }), /未宣言/)
  assert.throws(() => analysisSummary({ kind: 'allPhases', candidatesAnalysed: 1,
    phases: [{ phase: 'lift', collided: 1, hits: [{ part: 'elbow', obstacleIndex: 0, candidates: 1 }] }] }, []), /未宣言/)
})

test('障害物の番号は同じリクエストの障害物の名前へ戻る — 名前が無い番号も捨てない', () => {
  const s = analysisSummary({ kind: 'allPhases', candidatesAnalysed: 4, phases: [
    { phase: 'lift', collided: 2, hits: [
      { part: 'held', obstacleIndex: 1, candidates: 2 },
      { part: 'hand', obstacleIndex: 7, candidates: 1 },
    ] }] }, ['Floor', 'Tray · shell 2/5'])
  assert.equal(s.phases[0].hits[0].obstacle, 'Tray · shell 2/5')
  assert.equal(s.phases[0].hits[0].partLabel, 'held object')
  assert.equal(s.phases[0].hits[1].obstacle, 'obstacle #7')
  assert.equal(analysisSummary({ kind: 'firstCollision' }, []), null)
})

test('分析の鮮度はリクエストの同一性から毎回導出する — 探索をやり直せば stale になる', () => {
  const request = { graspSearch: {} }
  const grasp = { status: 'results', request }
  const analysis = { status: 'done', request }
  assert.equal(analysisFreshness(null, grasp), 'none')
  assert.equal(analysisFreshness(analysis, grasp), 'fresh')
  // 同じ中身でも別の探索 (別のリクエスト) — 同じ答えだとは言えない。
  assert.equal(analysisFreshness(analysis, { status: 'results', request: { graspSearch: {} } }), 'stale')
  assert.equal(analysisFreshness(analysis, { status: 'solving', request }), 'stale')
})

test('分析はバックエンドがあるときだけ — スタブでは理由つきで disabled (固定スロット)', () => {
  const grasp = { status: 'results', request: {} }
  assert.equal(analysisAvailability({ stubLane: true, bffConnected: true, grasp, analysisState: null }).enabled, false)
  assert.equal(analysisAvailability({ stubLane: false, bffConnected: false, grasp, analysisState: null }).enabled, false)
  assert.equal(analysisAvailability({ stubLane: false, bffConnected: true, grasp: null, analysisState: null }).enabled, false)
  assert.equal(analysisAvailability({ stubLane: false, bffConnected: true, grasp, analysisState: { status: 'running' } }).enabled, false)
  const ok = analysisAvailability({ stubLane: false, bffConnected: true, grasp, analysisState: { status: 'done' } })
  assert.deepEqual(ok, { enabled: true, reason: null })
  for (const s of [true, false]) {
    const r = analysisAvailability({ stubLane: s, bffConnected: false, grasp: null, analysisState: null })
    assert.ok(r.reason && r.reason.length > 0, 'a disabled button always says why')
  }
})
