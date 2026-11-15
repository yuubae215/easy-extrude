/**
 * GraspLadderMath — domain KPIs and the operation-fallback ladder-risk lookup
 * (ADR-081 Decision 3, presentation layer).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29 / ADR-081 → ADR-172 D8):
 * - Domain KPIs are read from the wire's stage verdicts (contract v13): each
 *   judged stage carries `entered` and `rejected`, a stage nobody asked carries
 *   no counts. They are derived values, never a second source (kernel §1.1).
 * - WHICH fallback risk applies is decided by core/ (`diagnostics.fallbackRisks`
 *   — curated judgement is an idea, ADR-146 axis 1). Until ADR-172 the rule
 *   table lived here; this module now only words the engine's reasons and levels.
 * - The ladder L1..L6 is an ordered cost label set, not a state machine
 *   (ADR-081 Lens notes); executing fallbacks is the runtime program's job and
 *   out of this app's scope. L1/L2 already have homes (topN fallback, the
 *   pick-sequence next-target order), so risks surfaced here start at L3.
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 *
 * @typedef {import('../../server/src/grasp/contract.response').GraspSearchResponse['diagnostics']} GraspDiagnostics
 */
import { isFunnel, stageOf } from './GraspFunnelMath.js'

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

/** The stages each domain is made of (display grouping — the engine decides the risk). */
export const DOMAIN_STAGES = Object.freeze({
  vision: Object.freeze(['visibility']),
  path: Object.freeze(['reach', 'ik', 'interference']),
  grasp: Object.freeze(['grasp']),
})

/**
 * Per-domain KPIs read from the wire's stage verdicts (contract v13, ADR-172).
 *
 * A rate is the share of the candidates that ENTERED a stage which it let
 * through — the engine now puts `entered` on the wire, so nothing is derived
 * from the stage order here. The path domain (reach, IK, interference — not
 * adjacent) is the product of its judged stages' pass rates. A domain whose
 * stages nobody asked is `{asked: false}` — never a fabricated 100 %
 * (PHILOSOPHY #11 / #31). `null` when the input is not a v13 funnel or nothing
 * was generated.
 *
 * @param {GraspDiagnostics|null|undefined} d
 */
export function domainKpis(d) {
  if (!isFunnel(d) || d.candidatesGenerated <= 0) return null
  const domain = (stages) => {
    const judged = stages.map(k => stageOf(d, k)).filter(v => v?.kind === 'judged')
    if (judged.length === 0) return { asked: false }
    const reached = judged.filter(v => v.entered > 0)
    return {
      asked: true,
      entered: judged[0].entered,
      rejected: judged.reduce((n, v) => n + v.rejected, 0),
      rate: reached.length ? reached.reduce((r, v) => r * (1 - v.rejected / v.entered), 1) : null,
    }
  }
  return {
    generated: d.candidatesGenerated,
    feasible: d.feasible,
    returned: d.returned,
    feasibleRate: d.feasible / d.candidatesGenerated,
    vision: domain(DOMAIN_STAGES.vision),
    path: domain(DOMAIN_STAGES.path),
    grasp: domain(DOMAIN_STAGES.grasp),
  }
}

/** The rate as words: a percentage, "not asked", or "nobody reached it". */
export function rateText(domain) {
  if (!domain?.asked) return 'not asked'
  if (domain.rate === null || domain.rate === undefined) return 'not reached'
  return `${(domain.rate * 100).toFixed(0)}%`
}

/**
 * What each engine-decided risk reason says (display words only — WHICH reason
 * applies is decided by core/, ADR-172 D8). Throws on an undeclared reason.
 */
export const RISK_REASON_TEXT = Object.freeze({
  noneSeen:        'no candidate is visible from the declared camera — camera repositioning risk',
  someUnseen:      'some grasp points are unseen — expect recurring vision retries (takt loss)',
  noneReachable:   'no candidate is reachable and collision-free — base / fixture repositioning risk',
  someUnreachable: 'reach / IK / clearance rejections — motion parameter re-teaching risk',
  noneClosable:    'the declared gripper cannot close on any candidate — gripper swap risk',
  someUnclosable:  'grasp-geometry rejections — grasp pose / opening re-teaching risk',
})

/**
 * The engine's fallback risks (`diagnostics.fallbackRisks`, deepest first) as
 * display rows: the level's label and cost from the LADDER table, the reason's
 * words. Nothing is decided here — the rows come in the engine's order.
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @returns {{ domain: string, level: number, cost: string, label: string, reason: string }[]}
 */
export function ladderRisks(d) {
  const risks = Array.isArray(d?.fallbackRisks) ? d.fallbackRisks : []
  return risks.map((r) => {
    const rung = LADDER[r.level]
    if (!rung) throw new Error(`GraspLadderMath: undeclared ladder level ${r.level}`)
    if (r.kind === 'together') {
      return { domain: 'all', level: r.level, ...rung,
        reason: `no pose satisfies ${r.domains.join(' + ')} together — layout redesign risk` }
    }
    if (r.kind !== 'domain') throw new Error(`GraspLadderMath: undeclared risk kind "${r.kind}" (ADR-172 D8)`)
    const reason = RISK_REASON_TEXT[r.reason]
    if (!reason) throw new Error(`GraspLadderMath: undeclared risk reason "${r.reason}" (ADR-172 D8)`)
    return { domain: r.domain, level: r.level, ...rung, reason }
  })
}
