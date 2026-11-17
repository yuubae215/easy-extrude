/**
 * Fixed-state grasp responses (ADR-117).
 *
 * The `solve` scenario reacts to the request; these are the states a reviewer
 * must be able to reach on demand because the real solver reaches them only by
 * accident. Every one of them is a legitimate contract response — they are
 * unusual, not malformed — and the conformance suite validates them against the
 * schema alongside the solved ones.
 */
import { stubSolve, envelopeCoveringSamples, interferencePhaseRows } from './solve.js'
import { newTally, reject, stageDiagnostics } from './stages.js'
import { STUB_SCENARIO } from './scenarios.js'

/**
 * The request as `reachDeclared` sees it: the caller's own request with a reach
 * envelope added under `plan{}` (the contract's declared home for judgement
 * parameters — ADR-084 §4, and the key the front does not yet collect).
 *
 * Adding it to `plan{}` rather than special-casing the solver is what makes this
 * a real control: `stubSolve` runs the SAME code path, reads the envelope
 * through the SAME precedence rule, and the only difference between the two
 * scenarios is that one request declares a basis and the other does not.
 *
 * A request with nothing to cover is passed through untouched — an envelope
 * invented from no distances would be a guess, and the whole point is that a
 * missing basis stays missing.
 */
function withDeclaredEnvelope(request) {
  const graspSearch = request?.graspSearch ?? {}
  const envelope = envelopeCoveringSamples(graspSearch)
  if (!envelope) return request
  return {
    ...request,
    graspSearch: { ...graspSearch, plan: { ...(graspSearch.plan ?? {}), ...envelope } },
  }
}

/**
 * A v13 funnel (ADR-172) with the counts filled in, all from the derived source
 * (the fixed scenarios send no grasp spec). Callers pass only the stages they
 * mean. A stage with rejections is a stage that was asked; with none, the fixed
 * scenarios ask everything (they stand for a fully declared cell), so a 0 here is
 * a judged 0 — the scenarios never fake "not asked". The identity is enforced by
 * `stageVerdicts` (it throws), because a hand-written funnel that violates it
 * renders bars wider than their track and nothing would say why.
 *
 * Near misses: a number is a measured shortfall; `null` with rejections is
 * unmeasurable (no contact pair / outside the field of view).
 */
function funnel({
  generated, reach = 0, visibility = 0, ik = 0, interference = 0, grasp = 0,
  feasible = 0, returned = 0,
  reachMiss = null, occlusionMiss = null, openingMiss = null,
}) {
  const tally = newTally()
  tally.generated = generated
  tally.feasible = feasible
  const put = (stage, n, measured, quantity, unmeasurable) => {
    for (let i = 0; i < n; i++) {
      reject(tally, stage, measured != null ? { miss: [quantity, measured] } : { unmeasurable })
    }
  }
  put('reach', reach, reachMiss, 'reachDistance', null)
  put('ik', ik, null, null, null)
  put('grasp', grasp, openingMiss, 'openingShortfall', 'noContactPair')
  put('visibility', visibility, occlusionMiss, 'occlusionDepth', 'outsideFieldOfView')
  put('interference', interference, null, null, null)
  const asked = { camera: {}, gripper: {} }   // a fully declared cell (see above)
  return {
    ...stageDiagnostics([{ source: { kind: 'derived' }, tally }], asked),
    returned,
    // ADR-157 (v8): the fixed scenarios declare no hand and no lift, so only the
    // approach is evaluated and every interference rejection is attributed to it.
    ...interferencePhaseRows({}, interference),
  }
}

/** A plausible ranked candidate for the fixed-state scenarios. */
function candidate(rank, totalScore, scores) {
  return {
    rank,
    graspSpecId: null,
    pose: {
      kind: 'endEffector',
      frame: { position: [600, 0, 480], orientation: [0, 0.7071067811865476, 0, 0.7071067811865476] },
    },
    score: {
      objectiveScores: scores,
      totalScore,
      // ADR-135: このスタブは IK を解かない (運動学を持たない) ので、関節配置は
      // **誰も決めていない**。`undeclared` はその事実の宣言であって「到達不可」では
      // ない。占位の値を `solved` として返すと、フロントは誰も決めていない腕を
      // 描き、しかもそれは本物の解と見分けがつかない (ADR-120 と同じ形の欠陥が
      // 生産者ごとに独立に住む)。
      reachSolution: { kind: 'undeclared' },
    },
  }
}

/**
 * Build the response for a fixed-state scenario.
 *
 * @param {string} scenario  a member of `STUB_SCENARIO` (never `solve`)
 * @param {number} contractVersion
 * @returns {object} a contract-shaped GraspSearchResponse
 */
export function fixedResponse(scenario, contractVersion) {
  switch (scenario) {
    case STUB_SCENARIO.EMPTY:
      // Nothing generated: the branch that guides the INPUT rather than
      // explaining a filter, because no stage ran.
      return {
        contractVersion,
        candidates: [],
        diagnostics: funnel({ generated: 0 }),
      }

    case STUB_SCENARIO.ALL_REJECTED:
      // Every stage contributed, and all three near-misses are measurable — the
      // densest funnel the panel can draw, so layout breakage shows up here first.
      return {
        contractVersion,
        candidates: [],
        diagnostics: funnel({
          generated: 24, reach: 9, ik: 4, grasp: 3, visibility: 5, interference: 3,
          feasible: 0, returned: 0,
          reachMiss: 38.4, occlusionMiss: 12.75, openingMiss: 6.2,
        }),
      }

    case STUB_SCENARIO.THIN:
      // One survivor out of many. The single-item list is the layout most likely
      // to be wrong (a "top 5" rendered with one row, deltas against nothing).
      return {
        contractVersion,
        candidates: [candidate(1, 0.42, {
          reach_margin: 0.21, approach_clearance: 0.55, grasp_stability: 0.31,
        })],
        diagnostics: funnel({
          generated: 18, reach: 7, ik: 4, grasp: 2, visibility: 3, interference: 1,
          feasible: 1, returned: 1,
          reachMiss: 5.1, occlusionMiss: 2.4,
        }),
      }

    default:
      // Undeclared scenarios never reach here (scenarioOrThrow guards the entry),
      // and the error scenarios never produce a body. Throwing keeps "a case
      // nobody considered" from being served as if it were a decision.
      throw new Error(`graspStub: scenario "${scenario}" has no fixed response`)
  }
}

/**
 * The error scenarios, as the `{ error, details }` envelope the BFF produces and
 * `BffClient._postContract` unwraps into the panel's error state.
 *
 * The statuses are the real ones from `server/src/routes/grasp.js`: 503 when the
 * solver is unreachable, 502 when it answers but breaks the contract, 400 when
 * the request is rejected at the boundary. Inventing a status here would train a
 * reviewer on error copy the product cannot actually emit.
 */
export const ERROR_RESPONSES = Object.freeze({
  [STUB_SCENARIO.ERROR_503]: Object.freeze({
    status: 503,
    body: {
      error: 'grasp-search delegation failed',
      details: ['grasp-search service unreachable (stubbed)'],
    },
  }),
  [STUB_SCENARIO.ERROR_502]: Object.freeze({
    status: 502,
    body: {
      error: 'grasp-search response does not conform to contract',
      details: ['/candidates/0/score: must have required property \'totalScore\' (stubbed)'],
    },
  }),
  [STUB_SCENARIO.ERROR_400]: Object.freeze({
    status: 400,
    body: {
      error: 'Request does not conform to grasp-search contract',
      details: ['/graspSearch/topN: must be >= 1 (stubbed)'],
    },
  }),
})

/**
 * Produce the stub's answer for a scenario.
 *
 * @param {string} scenario   a member of `STUB_SCENARIO`
 * @param {object} request    the incoming request (only `solve` reads it)
 * @param {number} contractVersion
 * @returns {{status: number, body: object}}
 */
export function responseFor(scenario, request, contractVersion) {
  const errorCase = ERROR_RESPONSES[scenario]
  if (errorCase) return { status: errorCase.status, body: errorCase.body }
  if (scenario === STUB_SCENARIO.SOLVE) {
    return { status: 200, body: stubSolve(request, contractVersion) }
  }
  if (scenario === STUB_SCENARIO.REACH_DECLARED) {
    return { status: 200, body: stubSolve(withDeclaredEnvelope(request), contractVersion) }
  }
  return { status: 200, body: fixedResponse(scenario, contractVersion) }
}
