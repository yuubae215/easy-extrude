/**
 * GraspFunnelMath — pure presentation derivations over the contract's
 * `diagnostics` rejection funnel (contractVersion 3, ADR-0007 upstream).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29, ADR-060): the wire carries only the
 * solver-decided aggregate facts (`candidatesGenerated`, per-stage rejection
 * counts, `feasible`, `returned`, `reachNearestMiss`). Everything in this
 * module — stage ordering for display, the dominant-stage pick, run-over-run
 * deltas, the near-miss meter curve — is CLIENT-DERIVED presentation. Nothing
 * here re-implements or second-guesses the solver (no reach / IK / collision
 * logic); malformed input degrades to `null`, never a fabricated funnel
 * (PHILOSOPHY #11).
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 *
 * The diagnostics type is *derived from the schema* (the BFF's generated
 * `.d.ts`), never restated here:
 * @typedef {import('../../server/src/grasp/contract.response').GraspSearchResponse['diagnostics']} GraspDiagnostics
 */

/**
 * Display order of the rejection stages — mirrors the contract invariant
 * `candidatesGenerated = rejectedByReach + rejectedByIk + rejectedByInterference
 * + feasible` (stages are exclusive; the filter short-circuits in this order).
 */
export const FUNNEL_STAGES = Object.freeze([
  Object.freeze({ key: 'reach',        field: 'rejectedByReach' }),
  Object.freeze({ key: 'ik',           field: 'rejectedByIk' }),
  Object.freeze({ key: 'interference', field: 'rejectedByInterference' }),
])

/** True when `d` carries every numeric funnel field the contract requires. */
function isFunnel(d) {
  if (!d || typeof d !== 'object') return false
  const nums = ['candidatesGenerated', 'rejectedByReach', 'rejectedByIk', 'rejectedByInterference', 'feasible', 'returned']
  return nums.every((k) => typeof d[k] === 'number' && Number.isFinite(d[k]))
}

/**
 * Sequential funnel rows for display: how many candidates entered each stage,
 * how many that stage rejected, and how many survived it. `fraction` is the
 * surviving share of `candidatesGenerated` (0..1, for bar widths); a zero
 * generation yields fraction 0 rows rather than NaN.
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @returns {null | { generated: number, feasible: number, returned: number,
 *   stages: { key: string, entered: number, rejected: number, remaining: number, fraction: number }[] }}
 */
export function funnelStages(d) {
  if (!isFunnel(d)) return null
  const generated = d.candidatesGenerated
  let entered = generated
  const stages = FUNNEL_STAGES.map(({ key, field }) => {
    const rejected = d[field]
    const remaining = Math.max(0, entered - rejected)
    const row = {
      key,
      entered,
      rejected,
      remaining,
      fraction: generated > 0 ? remaining / generated : 0,
    }
    entered = remaining
    return row
  })
  return { generated, feasible: d.feasible, returned: d.returned, stages }
}

/**
 * The stage that rejected the most candidates — the "what to fix first"
 * signal the funnel makes discoverable. Ties resolve to the earlier stage
 * (it filtered first). `null` when nothing was rejected (or input malformed).
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @returns {'reach'|'ik'|'interference'|null}
 */
export function dominantStage(d) {
  if (!isFunnel(d)) return null
  let best = null
  let bestCount = 0
  for (const { key, field } of FUNNEL_STAGES) {
    if (d[field] > bestCount) { best = key; bestCount = d[field] }
  }
  return best
}

/**
 * Run-over-run funnel delta (current − previous) so an input tweak reads as
 * "it worked / it didn't" at a glance. For rejection stages a NEGATIVE delta
 * is an improvement (fewer rejections); for `feasible`/`returned`/`generated`
 * a POSITIVE delta is. The sign semantics stay with the caller — this only
 * subtracts.
 *
 * @param {GraspDiagnostics|null|undefined} prev
 * @param {GraspDiagnostics|null|undefined} cur
 * @returns {null | { generated: number, reach: number, ik: number, interference: number, feasible: number, returned: number }}
 */
export function funnelDelta(prev, cur) {
  if (!isFunnel(prev) || !isFunnel(cur)) return null
  return {
    generated:    cur.candidatesGenerated    - prev.candidatesGenerated,
    reach:        cur.rejectedByReach        - prev.rejectedByReach,
    ik:           cur.rejectedByIk           - prev.rejectedByIk,
    interference: cur.rejectedByInterference - prev.rejectedByInterference,
    feasible:     cur.feasible               - prev.feasible,
    returned:     cur.returned               - prev.returned,
  }
}

/**
 * Near-miss meter fill (0..1) from `reachNearestMiss`: 1 at miss 0 (touching
 * the reachable shell), monotonically toward 0 as the miss grows. This is a
 * pure display curve `1 / (1 + miss)` over the wire fact — the number itself
 * (in the request's geometry length unit) is what the panel prints; the curve
 * only drives the "so close" feel. Returns `null` for `null`/invalid input
 * (nothing was rejected by reach → no meter).
 *
 * @param {number|null|undefined} miss
 * @returns {number|null}
 */
export function nearMissCloseness(miss) {
  if (typeof miss !== 'number' || !Number.isFinite(miss) || miss < 0) return null
  return 1 / (1 + miss)
}
