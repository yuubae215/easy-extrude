/**
 * GraspLadderMath — domain KPIs and the operation-fallback ladder-risk lookup
 * (ADR-081 Decision 3, presentation layer).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29 / ADR-081):
 * - Domain KPIs are DETERMINISTIC pure derivations over the contract-v4
 *   diagnostics facts (visibility rate = 1 − rejectedByVisibility/generated,
 *   etc.). They are derived values, never a second source (kernel §1.1).
 * - The KPI → ladder-risk mapping is a TABLE LOOKUP owned by this one module
 *   (no per-call-site patches — PHILOSOPHY, 真実の源は一つ). It is an
 *   empirical forecast of "how deep operations would have to fall back", NOT
 *   an assurance case (ADR-081 Consequences), and it re-implements no solver
 *   judgment — every input is a wire fact.
 * - The ladder L1..L6 is an ordered cost label set, not a state machine
 *   (ADR-081 Lens notes); executing fallbacks is the runtime program's job and
 *   out of this app's scope. L1/L2 already have homes (topN fallback, the
 *   pick-sequence next-target order), so risks surfaced here start at L3.
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 *
 * @typedef {import('../../server/src/grasp/contract.response').GraspSearchResponse['diagnostics']} GraspDiagnostics
 */
import { isFunnel } from './GraspFunnelMath.js'
import { requestAsksVisibility } from '../domain/visionCamera.js'

/**
 * The operation-fallback ladder (ADR-081 Context). Levels are ordered cost
 * labels: the deeper the level, the more expensive the rework.
 */
export const LADDER = Object.freeze({
  1: Object.freeze({ level: 1, cost: 'seconds', label: 'retry next candidate pose (topN)' }),
  2: Object.freeze({ level: 2, cost: 'seconds–minutes', label: 'move on to the next target' }),
  3: Object.freeze({ level: 3, cost: 'minutes', label: 're-acquire / re-image (vision retry)' }),
  4: Object.freeze({ level: 4, cost: 'hours', label: 're-teach motion parameters' }),
  5: Object.freeze({ level: 5, cost: 'days', label: 'reposition equipment (base / camera / jig / gripper)' }),
  6: Object.freeze({ level: 6, cost: 'weeks', label: 'redesign the layout / cell' }),
})

/**
 * Which gates the request asked (the camera / gripper declarations). A gate
 * nobody asked has no rate: its rejection count is 0 because nothing was
 * judged, not because everything passed. Read from the request, never assumed.
 *
 * @param {object|null|undefined} request  the searched request (`{graspSearch}`)
 * @returns {{vision: boolean, grasp: boolean}|null}  null when the request is unknown
 */
export function askedGates(request) {
  const gs = request?.graspSearch
  if (!gs || typeof gs !== 'object') return null
  return { vision: requestAsksVisibility(gs), grasp: gs.gripper != null }
}

/**
 * Deterministic per-domain KPIs from the v4 diagnostics facts.
 *
 * **A rate is the share of the candidates that REACHED the stage which it let
 * through** (2026-11-11 — it used to be a share of every generated candidate).
 * The stages short-circuit in the order reach → IK → grasp → visibility →
 * interference, so a stage only judges what the earlier ones passed; dividing
 * by everything generated read "6 of 6 unseen after reach dropped 30" as
 * "83 % seen". `entered` is derived from the exclusive counts in that order.
 * The path domain (reach, IK, interference — not adjacent in the order) is the
 * product of its three stages' pass rates.
 *
 * A domain whose gate was not asked (no camera / no gripper declared) is
 * `{asked: false}` with no rate — never a fabricated 100 % (PHILOSOPHY #11 /
 * #31; the same split the motion phases make between judged and not judged).
 * `null` when the input is not a v4 funnel, nothing was generated, or which
 * gates were asked is unknown.
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @param {{vision: boolean, grasp: boolean}|null} asked  from `askedGates(request)`
 * @returns {null | {
 *   generated: number, feasible: number, returned: number, feasibleRate: number,
 *   vision:  { asked: boolean, entered?: number, rejected?: number, rate?: number, nearestMiss?: number|null },
 *   path:    { asked: true, rejected: number, rate: number, nearestMiss: number|null },
 *   grasp:   { asked: boolean, entered?: number, rejected?: number, rate?: number, nearestMiss?: number|null },
 * }}
 */
export function domainKpis(d, asked) {
  if (!isFunnel(d) || d.candidatesGenerated <= 0 || !asked) return null
  const generated = d.candidatesGenerated
  const miss = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  // Who reached each stage, in the engine's order (exclusive counts — ADR-081).
  const enteredReach = generated
  const enteredIk = enteredReach - d.rejectedByReach
  const enteredGrasp = enteredIk - d.rejectedByIk
  const enteredVisibility = enteredGrasp - d.rejectedByGrasp
  const enteredInterference = enteredVisibility - d.rejectedByVisibility
  const pass = (rejected, entered) => (entered > 0 ? 1 - rejected / entered : null)
  const stage = (isAsked, rejected, entered, nearestMiss) => (isAsked
    ? { asked: true, entered, rejected, rate: pass(rejected, entered), nearestMiss: miss(nearestMiss) }
    : { asked: false })
  const pathRates = [
    pass(d.rejectedByReach, enteredReach),
    pass(d.rejectedByIk, enteredIk),
    pass(d.rejectedByInterference, enteredInterference),
  ]
  return {
    generated,
    feasible: d.feasible,
    returned: d.returned,
    feasibleRate: d.feasible / generated,
    vision: stage(asked.vision, d.rejectedByVisibility, enteredVisibility, d.occlusionNearestMiss),
    path: {
      asked: true,
      rejected: d.rejectedByReach + d.rejectedByIk + d.rejectedByInterference,
      // A stage nobody reached contributes nothing (its pass rate is unknown, not 1).
      rate: pathRates.some(r => r !== null)
        ? pathRates.filter(r => r !== null).reduce((x, y) => x * y, 1)
        : null,
      nearestMiss: miss(d.reachNearestMiss),
    },
    // Contract v5 (ADR-118): the grasp near-miss is kind-discriminated —
    // `opening` for a jaw, `sealPatch` for a cup. The KPI only needs the
    // magnitude; the kind is what the panel labels the meter with.
    grasp: stage(asked.grasp, d.rejectedByGrasp, enteredGrasp, d.graspNearestMiss?.shortfall ?? null),
  }
}

/** The rate as words: a percentage, "not asked", or "nobody reached it". */
export function rateText(domain) {
  if (!domain?.asked) return 'not asked'
  if (domain.rate === null || domain.rate === undefined) return 'not reached'
  return `${(domain.rate * 100).toFixed(0)}%`
}

/**
 * The KPI → ladder-risk lookup table. Each row: which domain KPI, the
 * condition (a pure predicate over that domain's KPIs + the whole set), the
 * forecast ladder level, and the reason wording. Ordered rows; first match
 * per domain wins (total-loss rows before partial-loss rows).
 */
const RISK_RULES = Object.freeze([
  // Vision: some grasp points unseen → runtime lives at L3 (re-image retries
  // eat takt); no candidate seen at all → the camera itself must move (L5).
  { domain: 'vision', level: 5, when: (dom) => dom.rejected > 0 && dom.rate === 0,
    reason: 'no candidate is visible from the declared camera — camera repositioning risk' },
  { domain: 'vision', level: 3, when: (dom) => dom.rejected > 0,
    reason: 'some grasp points are unseen — expect recurring vision retries (takt loss)' },
  // Path: nothing reachable/solvable/collision-free → base or jig must move
  // (L5); partial loss → approach / retreat re-teaching territory (L4).
  { domain: 'path', level: 5, when: (dom) => dom.rejected > 0 && dom.rate === 0,
    reason: 'no candidate is reachable and collision-free — base / fixture repositioning risk' },
  { domain: 'path', level: 4, when: (dom) => dom.rejected > 0,
    reason: 'reach / IK / clearance rejections — motion parameter re-teaching risk' },
  // Grasp: geometry can never close on the target → hardware swap (L5);
  // partial loss → grasp-pose re-teaching (L4).
  { domain: 'grasp', level: 5, when: (dom) => dom.rejected > 0 && dom.rate === 0,
    reason: 'the declared gripper cannot close on any candidate — gripper swap risk' },
  { domain: 'grasp', level: 4, when: (dom) => dom.rejected > 0,
    reason: 'grasp-geometry rejections — grasp pose / opening re-teaching risk' },
])

/**
 * Forecast ladder risks from the domain KPIs (table lookup, deterministic).
 * Returns risks sorted deepest-first; empty array when every domain is clean.
 * Adds the L6 row when the domains cannot hold simultaneously (zero feasible
 * with rejections in 2+ domains — ADR-081's "同時成立が不能" reading).
 *
 * @param {ReturnType<typeof domainKpis>} kpis
 * @returns {{ domain: string, level: number, cost: string, label: string, reason: string }[]}
 */
export function ladderRisks(kpis) {
  if (!kpis) return []
  const risks = []
  for (const domain of ['vision', 'path', 'grasp']) {
    if (!kpis[domain].asked) continue   // a gate nobody asked carries no risk either way
    const rule = RISK_RULES.find((r) => r.domain === domain && r.when(kpis[domain], kpis))
    if (rule) {
      risks.push({ domain, level: rule.level, ...LADDER[rule.level], reason: rule.reason })
    }
  }
  const rejectingDomains = ['vision', 'path', 'grasp'].filter((k) => kpis[k].asked && kpis[k].rejected > 0)
  if (kpis.feasible === 0 && rejectingDomains.length >= 2) {
    risks.push({
      domain: 'all', level: 6, ...LADDER[6],
      reason: `no pose satisfies ${rejectingDomains.join(' + ')} together — layout redesign risk`,
    })
  }
  return risks.sort((a, b) => b.level - a.level)
}
