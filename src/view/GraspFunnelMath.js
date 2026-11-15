/**
 * GraspFunnelMath — pure presentation derivations over the contract's
 * `diagnostics` rejection funnel (contractVersion 4, ADR-081 domain stages).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29, ADR-060): the wire carries only the
 * solver-decided aggregate facts (contract v13, ADR-172: `candidatesGenerated`,
 * `feasible`, `returned`, the stage verdicts with `entered` / `rejected` /
 * `nearestMiss`, the source rows and the fallback risks).
 * Everything in this module — stage ordering for display, the dominant-stage
 * pick, run-over-run deltas, the near-miss meter curve — is CLIENT-DERIVED
 * presentation. Nothing here re-implements or second-guesses the solver (no
 * reach / IK / visibility / collision / grasp logic); malformed input degrades
 * to `null`, never a fabricated funnel (PHILOSOPHY #11).
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 *
 * The diagnostics type is *derived from the schema* (the BFF's generated
 * `.d.ts`), never restated here:
 * @typedef {import('../../server/src/grasp/contract.response').GraspSearchResponse['diagnostics']} GraspDiagnostics
 */

/**
 * The stages in the order the engine judged them (contract v13 — the wire lists
 * them in that order; this is only the display vocabulary).
 */
export const FUNNEL_STAGES = Object.freeze(['reach', 'ik', 'grasp', 'visibility', 'interference'])

/** True when `d` is a v13 funnel: the counts and every stage once (ADR-172). */
export function isFunnel(d) {
  if (!d || typeof d !== 'object') return false
  const nums = ['candidatesGenerated', 'feasible', 'returned']
  if (!nums.every((k) => typeof d[k] === 'number' && Number.isFinite(d[k]))) return false
  return Array.isArray(d.stages) && d.stages.length === FUNNEL_STAGES.length &&
    d.stages.every((v, i) => v?.stage === FUNNEL_STAGES[i])
}

/** The stage verdict for `key`, or null. */
export function stageOf(d, key) {
  return Array.isArray(d?.stages) ? (d.stages.find(v => v.stage === key) ?? null) : null
}

/**
 * Funnel rows for display, straight from the wire's stage verdicts (ADR-172):
 * a judged stage has `entered` / `rejected` (the engine's own numbers — nothing
 * is re-derived here), a stage nobody asked is `asked: false` with its reason
 * and no counts. `fraction` is the surviving share of `candidatesGenerated` for
 * bar widths; an unasked stage passes everyone through, so its bar is the
 * previous one's.
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @returns {null | { generated: number, feasible: number, returned: number,
 *   stages: ({ key: string, asked: true, entered: number, rejected: number, remaining: number, fraction: number }
 *          | { key: string, asked: false, reason: string, fraction: number })[] }}
 */
export function funnelStages(d) {
  if (!isFunnel(d)) return null
  const generated = d.candidatesGenerated
  let remaining = generated
  const stages = d.stages.map(v => {
    if (v.kind !== 'judged') {
      return { key: v.stage, asked: false, reason: v.reason, fraction: generated > 0 ? remaining / generated : 0 }
    }
    remaining = v.entered - v.rejected
    return {
      key: v.stage, asked: true, entered: v.entered, rejected: v.rejected, remaining,
      fraction: generated > 0 ? remaining / generated : 0,
    }
  })
  return { generated, feasible: d.feasible, returned: d.returned, stages }
}

/**
 * The asked stage that rejected the most candidates — the "what to fix first"
 * signal. Ties resolve to the earlier stage (it filtered first). `null` when
 * nothing was rejected (or input malformed). A stage nobody asked never wins.
 *
 * @param {GraspDiagnostics|null|undefined} d
 * @returns {'reach'|'ik'|'grasp'|'visibility'|'interference'|null}
 */
export function dominantStage(d) {
  if (!isFunnel(d)) return null
  let best = null
  let bestCount = 0
  for (const v of d.stages) {
    if (v.kind === 'judged' && v.rejected > bestCount) { best = v.stage; bestCount = v.rejected }
  }
  return best
}

/**
 * Run-over-run funnel delta (current − previous) so an input tweak reads as
 * "it worked / it didn't" at a glance. For rejection stages a NEGATIVE delta
 * is an improvement; for `feasible`/`returned`/`generated` a POSITIVE delta is.
 * A stage asked in only one of the two runs has no delta (`null`) — the two
 * numbers are not the same question.
 *
 * @param {GraspDiagnostics|null|undefined} prev
 * @param {GraspDiagnostics|null|undefined} cur
 */
export function funnelDelta(prev, cur) {
  if (!isFunnel(prev) || !isFunnel(cur)) return null
  const out = {
    generated: cur.candidatesGenerated - prev.candidatesGenerated,
    feasible:  cur.feasible - prev.feasible,
    returned:  cur.returned - prev.returned,
  }
  for (const key of FUNNEL_STAGES) {
    const a = stageOf(prev, key)
    const b = stageOf(cur, key)
    out[key] = a?.kind === 'judged' && b?.kind === 'judged' ? b.rejected - a.rejected : null
  }
  return out
}

/** What each measured shortfall quantity is called on the meter (display words). */
export const MISS_QUANTITY_TEXT = Object.freeze({
  reachDistance:      'missed reach by',
  occlusionDepth:     'occluded by',
  openingShortfall:   'opening short by',
  sealPatchShortfall: 'seal patch short by',
})

/** Why a rejection had no measurable shortfall (display words). */
export const UNMEASURABLE_REASON_TEXT = Object.freeze({
  outsideFieldOfView: 'outside the camera\'s field of view — no depth to measure',
  palmBelowSurface:   'the palm would sink below the face — not a width shortfall',
  noContactPair:      'no contact pair to measure a width on',
})

/**
 * The near-miss meters to draw: one per judged stage whose closest rejection
 * was MEASURED (ADR-172 D3). An unmeasurable one is listed with its reasons
 * (never as an empty meter); noRejection / noQuantity draw nothing.
 *
 * @returns {{ key: string, measured: true, quantity: string, value: number, what: string }[]
 *          | { key: string, measured: false, reasons: string[] }[]}
 */
export function nearMissMeters(d) {
  if (!isFunnel(d)) return []
  const out = []
  for (const v of d.stages) {
    if (v.kind !== 'judged') continue
    const m = v.nearestMiss
    if (m?.kind === 'measured') {
      const what = MISS_QUANTITY_TEXT[m.quantity]
      if (!what) throw new Error(`GraspFunnelMath: undeclared shortfall quantity "${m.quantity}" (ADR-172 D3)`)
      out.push({ key: v.stage, measured: true, quantity: m.quantity, value: m.value, what })
    } else if (m?.kind === 'unmeasurable') {
      out.push({ key: v.stage, measured: false, reasons: m.reasons })
    }
  }
  return out
}

/**
 * Near-miss meter fill (0..1) from a measured shortfall: 1 at miss 0 (touching
 * the pass boundary), monotonically toward 0 as the miss grows. A pure display
 * curve `1 / (1 + miss)` over the wire fact. `null` for invalid input.
 *
 * @param {number|null|undefined} miss
 * @returns {number|null}
 */
export function nearMissCloseness(miss) {
  if (typeof miss !== 'number' || !Number.isFinite(miss) || miss < 0) return null
  return 1 / (1 + miss)
}

/**
 * Per-source results (contract v13, ADR-172 D4): every spec the run sent, in its
 * order, then the derived row when derived candidates were generated — what the
 * solver generated and passed for each, how many of its candidates the strategy
 * returned (DERIVED from `candidates[].graspSpecId`), and its stage verdicts.
 * The rows add up to the whole. `null` when the only source is derived (no spec
 * was sent) — one row equal to the whole adds nothing to the funnel above.
 *
 * @returns {{id:string|null, label:string, generated:number, feasible:number, returned:number, stages:object[]}[]|null}
 */
export function specResultRows(diagnostics, candidates = []) {
  const rows = diagnostics?.bySource
  if (!Array.isArray(rows) || rows.length === 0) return null
  if (rows.every(r => r.source?.kind === 'derived')) return null
  return rows.map(r => {
    const id = r.source?.kind === 'spec' ? r.source.id : null
    return {
      id,
      label: id ?? 'derived faces',
      generated: r.candidatesGenerated,
      feasible: r.feasible,
      returned: candidates.filter(c => (c.graspSpecId ?? null) === id).length,
      stages: r.stages,
    }
  })
}
