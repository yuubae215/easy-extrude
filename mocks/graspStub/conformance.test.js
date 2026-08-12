/**
 * The stub is a SECOND PRODUCER of the response contract — so it is held to the
 * contract the same way `core/` is (ADR-117).
 *
 * `core/` has `test_contract_conformance.py`; the BFF has `test:contract`. A
 * stub that answers the same endpoint with no such suite is the third producer
 * nobody checks, and it is the most dangerous one: its whole purpose is to be
 * shown to people who cannot run the real stack, so when it drifts, the people
 * least able to notice are the ones looking at it.
 *
 * What is asserted here is deliberately the SHAPE, never the arithmetic. The
 * stub's distances and scores are its own invention and will disagree with
 * `core/` — pinning them would only freeze a fiction. What must hold is what the
 * UI derives its presentation from: schema conformance, the funnel identity, the
 * exclusivity and order of the stages, the vacuous-gate rule, and the version
 * stamp.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { validateAgainst } from './schemaCheck.js'
import { stubSolve } from './solve.js'
import { responseFor, fixedResponse, ERROR_RESPONSES } from './responses.js'
import { STUB_SCENARIO, DECLARED_SCENARIOS, scenarioOrThrow, scenarioFromSearch } from './scenarios.js'
import { CONTRACT_VERSION } from './contractVersion.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CONTRACT_DIR = resolve(HERE, '../../packages/grasp-contract')

const responseSchema = JSON.parse(
  readFileSync(resolve(CONTRACT_DIR, 'schema/grasp-search-response.schema.json'), 'utf8'),
)
const versionFile = JSON.parse(
  readFileSync(resolve(CONTRACT_DIR, 'contract-version.json'), 'utf8'),
)

/** Assert a response body conforms to the real schema file. */
function assertConforms(body, label) {
  const errors = validateAgainst(body, responseSchema)
  assert.deepEqual(errors, [],
    `${label} violates the response contract:\n${errors.map(e => `  ${e}`).join('\n')}`)
}

/** A request in the shape `GraspController` now sends (ADR-117). */
function request({ base = [0, 0, 400], samples, obstacles = [], camera, gripper, plan, topN = 5 } = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    layoutVersion:   'layout/1.0',
    graspSearch: {
      objectiveWeights: { reach_margin: 0.6, approach_clearance: 0.4, grasp_stability: 1.0 },
      topN,
      robot: { base },
      target: { surfaceSamples: samples ?? [
        { point: [600, -75, 350], normal: [0, 0, 1] },
        { point: [600,   0, 350], normal: [0, 0, 1] },
        { point: [600,  75, 350], normal: [0, 0, 1] },
      ] },
      obstacles,
      ...(camera  ? { camera }  : {}),
      ...(gripper ? { gripper } : {}),
      ...(plan    ? { plan }    : {}),
    },
  }
}

/** Same request, different objective weights — the one variable ADR-120 cares about. */
function withWeights(req, weights) {
  return { ...req, graspSearch: { ...req.graspSearch, objectiveWeights: weights } }
}

// ── The validator itself must be able to say "no" ────────────────────────────
//
// Every assertion below this block is worth exactly as much as the validator's
// ability to fail. A checker that returns "valid" for everything turns the whole
// suite into a green light nobody re-examines (ADR-115: a printed number is not
// a check). These are its negative controls.

test('検証器は閉じた層への余計なキーを弾く (additionalProperties:false が効いている)', () => {
  const body = stubSolve(request(), CONTRACT_VERSION)
  body.diagnostics.somethingExtra = 1
  assert.notDeepEqual(validateAgainst(body, responseSchema), [])
})

test('検証器は必須キーの欠落を弾く', () => {
  const body = stubSolve(request(), CONTRACT_VERSION)
  delete body.diagnostics.feasible
  assert.notDeepEqual(validateAgainst(body, responseSchema), [])
})

test('検証器は型違反と範囲違反を弾く', () => {
  const wrongType = stubSolve(request(), CONTRACT_VERSION)
  wrongType.diagnostics.feasible = 'many'
  assert.notDeepEqual(validateAgainst(wrongType, responseSchema), [])

  const negative = stubSolve(request(), CONTRACT_VERSION)
  negative.diagnostics.rejectedByReach = -1
  assert.notDeepEqual(validateAgainst(negative, responseSchema), [])
})

test('検証器は pose の kind 判別 union を弾ける (未宣言の kind は通らない)', () => {
  const body = stubSolve(request(), CONTRACT_VERSION)
  assert.ok(body.candidates.length > 0, '前提: 候補が出ていること')
  body.candidates[0].pose = { kind: 'magicWand', frame: {} }
  assert.notDeepEqual(validateAgainst(body, responseSchema), [])
})

test('検証器は実装していないキーワードに出会ったら throw する (黙って素通ししない)', () => {
  assert.throws(
    () => validateAgainst({ a: 1 }, { type: 'object', patternProperties: { '^a$': { type: 'number' } } }),
    /unsupported keyword "patternProperties"/,
  )
})

// ── Schema conformance, across every declared scenario ───────────────────────

test('宣言されたシナリオを 1 つ残らず走らせ、成功応答はすべて契約に適合する', () => {
  // 母集団は「思いついたシナリオ」ではなく DECLARED_SCENARIOS から導出する
  // (ADR-102 — 表の行ではなく、表が覆えていない個数を数える)。
  let checked = 0
  for (const scenario of DECLARED_SCENARIOS) {
    const { status, body } = responseFor(scenario, request(), CONTRACT_VERSION)
    if (status === 200) {
      assertConforms(body, `scenario "${scenario}"`)
      checked += 1
    } else {
      assert.ok(Array.isArray(body.details) && typeof body.error === 'string',
        `scenario "${scenario}" must use the BFF's { error, details } envelope`)
    }
  }
  assert.ok(checked > 0, 'シナリオを 1 つも検証しなかった — 空の照合は緑に見えるが検査ではない')
})

test('シナリオの総数は宣言と一致する — 表の外に増えたものを見逃さない', () => {
  assert.equal(DECLARED_SCENARIOS.length, Object.keys(STUB_SCENARIO).length)
})

// ── The funnel identity the UI derives every bar from ────────────────────────

/** `candidatesGenerated = Σ rejections + feasible` (contract v4 invariant). */
function assertFunnelIdentity(d, label) {
  const sum = d.rejectedByReach + d.rejectedByVisibility + d.rejectedByIk +
              d.rejectedByInterference + d.rejectedByGrasp + d.feasible
  assert.equal(d.candidatesGenerated, sum,
    `${label}: generated ${d.candidatesGenerated} ≠ stages ${sum}`)
  assert.equal(d.returned, Math.min(d.feasible, 5), `${label}: returned must be min(feasible, topN)`)
}

test('ファネル恒等式はすべての成功シナリオで成り立つ', () => {
  for (const scenario of DECLARED_SCENARIOS) {
    const { status, body } = responseFor(scenario, request(), CONTRACT_VERSION)
    if (status === 200) assertFunnelIdentity(body.diagnostics, scenario)
  }
})

test('恒等式を破る固定応答は組み立て時に throw する (静かに壊れた棒を描かせない)', () => {
  // fixedResponse は funnel() を通す。恒等式違反はここで落ちる。
  assert.throws(() => fixedResponse('notAScenario', CONTRACT_VERSION), /no fixed response/)
})

test('到達不能な候補は 1 つの段にだけ帰属する (段は排他)', () => {
  // 遠すぎて届かず、かつ障害物にも遮られる配置。安い順に短絡するので reach に帰属し、
  // interference には二重計上されない。
  const res = stubSolve(request({
    base:      [0, 0, 0],
    plan:      { reachMin: 0, reachMax: 10 },
    samples:   [{ point: [1000, 0, 0], normal: [0, 0, 1] }],
    obstacles: [{ center: [1000, 0, 50], radius: 40 }],
  }), CONTRACT_VERSION)
  assert.equal(res.diagnostics.rejectedByReach, 1)
  assert.equal(res.diagnostics.rejectedByInterference, 0)
  assertFunnelIdentity(res.diagnostics, 'exclusive stages')
})

// ── The vacuous-gate rule the contract states explicitly ─────────────────────

test('camera 未宣言なら rejectedByVisibility は必ず 0', () => {
  const res = stubSolve(request({ obstacles: [{ center: [300, 0, 350], radius: 200 }] }), CONTRACT_VERSION)
  assert.equal(res.diagnostics.rejectedByVisibility, 0)
})

test('gripper 未宣言なら rejectedByGrasp は必ず 0', () => {
  const res = stubSolve(request(), CONTRACT_VERSION)
  assert.equal(res.diagnostics.rejectedByGrasp, 0)
})

test('camera を宣言すると可視性が実際に効く (宣言が無視されていない証拠)', () => {
  const blocked = stubSolve(request({
    camera:    { position: [600, 0, 2000], viewAxis: [0, 0, -1], fovHalfAngle: 1.2 },
    obstacles: [{ center: [600, 0, 1000], radius: 300 }],
  }), CONTRACT_VERSION)
  assert.ok(blocked.diagnostics.rejectedByVisibility > 0)
  assert.ok(blocked.diagnostics.occlusionNearestMiss > 0, '遮蔽の深さが測れたなら報告する')
})

test('平行ジョーの不足量は kind:"opening" として載る (契約 v5 / ADR-118)', () => {
  const res = stubSolve(request({
    gripper: { kind: 'parallelJaw', maxOpening: 0.001, fingerClearance: 0.0005 },
  }), CONTRACT_VERSION)
  assert.ok(res.diagnostics.rejectedByGrasp > 0)
  assert.equal(res.diagnostics.graspNearestMiss.kind, 'opening')
  assert.ok(res.diagnostics.graspNearestMiss.shortfall > 0)
})

test('吸引の不足量は kind:"sealPatch" — 開口として報告しない (ADR-118)', () => {
  // 同じ「あと少し」でも量が違う。opening の欄に入れると、パネルは名前が嘘を
  // ついているメーターを描くことになる。
  const res = stubSolve(request({
    gripper: { kind: 'suction', cupDiameter: 10_000 },
  }), CONTRACT_VERSION)
  assert.ok(res.diagnostics.rejectedByGrasp > 0)
  assert.equal(res.diagnostics.graspNearestMiss.kind, 'sealPatch')
  assert.ok(res.diagnostics.graspNearestMiss.shortfall > 0)
  assertConforms(res, 'suction rejection')
})

// ── Reactivity: the whole reason for a solving stub rather than fixtures ─────

test('ロボットを遠ざけると reach 棄却へ変わる — 置き直しループが実際に回る', () => {
  const near = stubSolve(request({ base: [600, 0, 0], plan: { reachMin: 0, reachMax: 500 } }), CONTRACT_VERSION)
  const far  = stubSolve(request({ base: [0, 0, 0],   plan: { reachMin: 0, reachMax: 500 } }), CONTRACT_VERSION)
  assert.ok(near.diagnostics.feasible > 0, '近ければ届く')
  assert.equal(far.diagnostics.feasible, 0, '遠ざければ届かない')
  assert.ok(far.diagnostics.reachNearestMiss > 0, '「あと何ミリ」が測れる')
})

test('同じ要求は同じ応答を返す (純粋 — レビュアーのスクショが再現する)', () => {
  const a = stubSolve(request(), CONTRACT_VERSION)
  const b = stubSolve(request(), CONTRACT_VERSION)
  assert.deepEqual(a, b)
})

test('rank は 1 始まりの昇順で、スコア降順に並ぶ', () => {
  const res = stubSolve(request({
    plan:      { reachMin: 0, reachMax: 1000 },
    obstacles: [{ center: [600, 200, 350], radius: 60 }],
  }), CONTRACT_VERSION)
  res.candidates.forEach((c, i) => assert.equal(c.rank, i + 1))
  for (let i = 1; i < res.candidates.length; i++) {
    assert.ok(res.candidates[i - 1].score.totalScore >= res.candidates[i].score.totalScore)
  }
})

test('topN を超えて返さない (returned = min(feasible, topN))', () => {
  const res = stubSolve(request({ topN: 2 }), CONTRACT_VERSION)
  assert.ok(res.candidates.length <= 2)
  assert.equal(res.diagnostics.returned, res.candidates.length)
})

test('対象サンプルが 0 件なら generated 0 — フロントの no-target ゲートの向こう側', () => {
  const res = stubSolve(request({ samples: [] }), CONTRACT_VERSION)
  assert.equal(res.diagnostics.candidatesGenerated, 0)
  assert.deepEqual(res.candidates, [])
  assertConforms(res, 'empty target')
})

test('法線が退化したサンプルは generated に数えない (恒等式が壊れる)', () => {
  const res = stubSolve(request({ samples: [
    { point: [600, 0, 350], normal: [0, 0, 0] },
    { point: [600, 50, 350], normal: [0, 0, 1] },
  ] }), CONTRACT_VERSION)
  assert.equal(res.diagnostics.candidatesGenerated, 1)
  assertFunnelIdentity(res.diagnostics, 'degenerate normal')
})

// ── objectiveScores mirrors the request's weights ────────────────────────────

test('重みを付けた objective だけがスコア内訳に現れる (core/ と同じ規律)', () => {
  // リーチ範囲を宣言しているので reach_margin は「評価できた」側に居る。
  const req = request({ plan: { reachMin: 0, reachMax: 1000 } })
  req.graspSearch.objectiveWeights = { reach_margin: 1.0 }
  const res = stubSolve(req, CONTRACT_VERSION)
  assert.ok(res.candidates.length > 0, '前提: 候補が出ていること')
  for (const c of res.candidates) {
    assert.deepEqual(Object.keys(c.score.objectiveScores), ['reach_margin'])
  }
})

test('未登録の objective 名は無視される — core/ の寛容さを再現する', () => {
  const req = request()
  req.graspSearch.objectiveWeights = { not_an_objective: 1.0 }
  const res = stubSolve(req, CONTRACT_VERSION)
  for (const c of res.candidates) {
    assert.deepEqual(c.score.objectiveScores, {})
    assert.equal(c.score.totalScore, 0)
  }
})

// ── 評価できなかった objective は 0 点ではない (ADR-120) ─────────────────────
//
// 値で比較すると「評価不能」と「0 点」はまさに同じに見える。だから検査は**鍵の不在**を
// 問う — 検査の書き方そのものがこの ADR の主張である。

test('リーチ範囲を宣言していなければ reach_margin は 0 ではなく鍵ごと出ない', () => {
  const withoutEnvelope = stubSolve(request(), CONTRACT_VERSION)
  assert.ok(withoutEnvelope.candidates.length > 0, '前提: 候補が出ていること')
  for (const c of withoutEnvelope.candidates) {
    assert.ok(!('reach_margin' in c.score.objectiveScores),
      '未宣言のリーチ範囲は「余裕ゼロ」ではなく「測っていない」')
  }
  // 宣言すれば同じ鍵が現れる = 不在が欠陥ではなく事実であることの対照。
  const withEnvelope = stubSolve(request({ plan: { reachMin: 0, reachMax: 1000 } }), CONTRACT_VERSION)
  assert.ok(withEnvelope.candidates.every(c => 'reach_margin' in c.score.objectiveScores))
})

test('評価できない objective に重みを付けても totalScore は動かない (分母に入らない)', () => {
  // 同じ候補・同じ評価可能な objective。違いは「評価できない objective の重み」だけ。
  const base = { approach_clearance: 1.0 }
  const withUnevaluable = { ...base, reach_margin: 9.0 }   // リーチ範囲は未宣言のまま

  const a = stubSolve(withWeights(request(), base), CONTRACT_VERSION)
  const b = stubSolve(withWeights(request(), withUnevaluable), CONTRACT_VERSION)

  assert.ok(a.candidates.length > 0 && a.candidates.length === b.candidates.length)
  a.candidates.forEach((c, i) => {
    assert.equal(c.score.totalScore, b.candidates[i].score.totalScore,
      '評価できなかった objective が分母に居座ると、無関係な重み付けでスコアが下がる')
  })
})

test('評価できた objective の加重平均なので 0-1 に収まる (リクエスト間で比較可能)', () => {
  const res = stubSolve(withWeights(
    request({ plan: { reachMin: 0, reachMax: 1000 } }),
    { reach_margin: 0.6, approach_clearance: 0.4, grasp_stability: 1.0 },
  ), CONTRACT_VERSION)
  assert.ok(res.candidates.length > 0)
  for (const c of res.candidates) {
    assert.ok(c.score.totalScore >= 0 && c.score.totalScore <= 1,
      `加重平均なら 0-1: ${c.score.totalScore}`)
  }
  assertConforms(res, 'weighted average')
})

test('1 つも評価できなければ totalScore 0 だが、内訳が空であることが 0 点と区別する', () => {
  const res = stubSolve(withWeights(request(), { reach_margin: 1.0 }), CONTRACT_VERSION)
  assert.ok(res.candidates.length > 0)
  for (const c of res.candidates) {
    assert.deepEqual(c.score.objectiveScores, {}, '空の内訳 = 何も測れなかった')
    assert.equal(c.score.totalScore, 0)
  }
  assertConforms(res, 'nothing evaluable')
})

// ── Version stamp ────────────────────────────────────────────────────────────

test('スタンプする contractVersion は契約パッケージの値そのもの', () => {
  assert.equal(CONTRACT_VERSION, versionFile.contractVersion)
  const res = stubSolve(request(), CONTRACT_VERSION)
  assert.equal(res.contractVersion, versionFile.contractVersion)
})

// ── Scenario selection ───────────────────────────────────────────────────────

test('未宣言のシナリオ名は throw する — 既定へ黙って倒さない (原則 #31)', () => {
  assert.throws(() => scenarioOrThrow('emtpy'), /unknown scenario "emtpy"/)
  assert.throws(() => scenarioFromSearch('?graspStub=nope'), /unknown scenario/)
})

test('シナリオ未指定は solve、空文字も solve', () => {
  assert.equal(scenarioOrThrow(undefined), STUB_SCENARIO.SOLVE)
  assert.equal(scenarioFromSearch(''), STUB_SCENARIO.SOLVE)
  assert.equal(scenarioFromSearch('?graspStub=thin'), STUB_SCENARIO.THIN)
})

test('エラーシナリオは実際に BFF が出しうる status を使う (400/502/503)', () => {
  const statuses = Object.values(ERROR_RESPONSES).map(e => e.status).sort()
  assert.deepEqual(statuses, [400, 502, 503])
})
