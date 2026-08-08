/**
 * Fixed-state grasp responses (ADR-117).
 *
 * The `solve` scenario reacts to the request; these are the states a reviewer
 * must be able to reach on demand because the real solver reaches them only by
 * accident. Every one of them is a legitimate contract response — they are
 * unusual, not malformed — and the conformance suite validates them against the
 * schema alongside the solved ones.
 */
import { stubSolve } from './solve.js'
import { STUB_SCENARIO } from './scenarios.js'

/**
 * A funnel with the counts filled in. Callers pass only the stages they mean;
 * the identity `candidatesGenerated = Σ rejections + feasible` is enforced here
 * rather than trusted, because a hand-written funnel that violates it renders
 * bars wider than their track and nothing would say why.
 */
function funnel({
  generated, reach = 0, visibility = 0, ik = 0, interference = 0, grasp = 0,
  feasible = 0, returned = 0,
  reachNearestMiss = null, occlusionNearestMiss = null, openingNearestMiss = null,
}) {
  const sum = reach + visibility + ik + interference + grasp + feasible
  if (sum !== generated) {
    throw new Error(
      `graspStub: funnel identity violated — generated ${generated} but stages sum to ${sum}. ` +
      `The UI derives every bar from this identity; an inconsistent fixture would ` +
      `teach a reviewer to distrust a meter that is actually correct.`,
    )
  }
  return {
    candidatesGenerated:    generated,
    rejectedByReach:        reach,
    rejectedByVisibility:   visibility,
    rejectedByIk:           ik,
    rejectedByInterference: interference,
    rejectedByGrasp:        grasp,
    feasible,
    returned,
    reachNearestMiss,
    occlusionNearestMiss,
    openingNearestMiss,
  }
}

/** A plausible ranked candidate for the fixed-state scenarios. */
function candidate(rank, totalScore, scores) {
  return {
    rank,
    pose: {
      kind: 'endEffector',
      frame: { position: [600, 0, 480], orientation: [0, 0.7071067811865476, 0, 0.7071067811865476] },
    },
    score: {
      withinReach: true, visible: true, ikSolvable: true,
      interferenceFree: true, graspable: true,
      objectiveScores: scores,
      totalScore,
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
          reachNearestMiss: 38.4, occlusionNearestMiss: 12.75, openingNearestMiss: 6.2,
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
          reachNearestMiss: 5.1, occlusionNearestMiss: 2.4, openingNearestMiss: null,
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
  return { status: 200, body: fixedResponse(scenario, contractVersion) }
}
