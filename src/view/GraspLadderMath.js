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
 * Deterministic per-domain KPIs from the v4 diagnostics facts.
 *
 * Rates are shares of `candidatesGenerated` that the domain did NOT reject —
 * exclusive-stage counts make the three domain rates directly comparable.
 * `null` when the input is not a v4 funnel or nothing was generated (no
 * evidence → no KPI, never a fabricated 100% — PHILOSOPHY #11).
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @returns {null | {
 *   generated: number, feasible: number, returned: number, feasibleRate: number,
 *   vision:  { rejected: number, rate: number, nearestMiss: number|null },
 *   path:    { rejected: number, rate: number, nearestMiss: number|null },
 *   grasp:   { rejected: number, rate: number, nearestMiss: number|null },
 * }}
 */
export function domainKpis(d) {
  if (!isFunnel(d) || d.candidatesGenerated <= 0) return null
  const generated = d.candidatesGenerated
  const pathRejected = d.rejectedByReach + d.rejectedByIk + d.rejectedByInterference
  const miss = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
  return {
    generated,
    feasible: d.feasible,
    returned: d.returned,
    feasibleRate: d.feasible / generated,
    vision: {
      rejected: d.rejectedByVisibility,
      rate: 1 - d.rejectedByVisibility / generated,
      nearestMiss: miss(d.occlusionNearestMiss),
    },
    path: {
      rejected: pathRejected,
      rate: 1 - pathRejected / generated,
      nearestMiss: miss(d.reachNearestMiss),
    },
    grasp: {
      rejected: d.rejectedByGrasp,
      rate: 1 - d.rejectedByGrasp / generated,
      nearestMiss: miss(d.openingNearestMiss),
    },
  }
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
    const rule = RISK_RULES.find((r) => r.domain === domain && r.when(kpis[domain], kpis))
    if (rule) {
      risks.push({ domain, level: rule.level, ...LADDER[rule.level], reason: rule.reason })
    }
  }
  const rejectingDomains = ['vision', 'path', 'grasp'].filter((k) => kpis[k].rejected > 0)
  if (kpis.feasible === 0 && rejectingDomains.length >= 2) {
    risks.push({
      domain: 'all', level: 6, ...LADDER[6],
      reason: `no pose satisfies ${rejectingDomains.join(' + ')} together — layout redesign risk`,
    })
  }
  return risks.sort((a, b) => b.level - a.level)
}
