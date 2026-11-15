/**
 * The stub's stage tally — contract v13 (ADR-172), the same shape core/ answers.
 *
 * The stub is a stand-in producer (ADR-117): every number it makes is its own
 * invention, and the panel only needs the SHAPE to be the contract's. So this
 * mirrors `core/easy_extrude_core/engine/stages.py` closely enough that the
 * same request reads the same way in both lanes:
 *
 *  - a stage is `judged {entered, rejected, nearestMiss}` or `notAsked {reason}`
 *    (a camera / a gripper nobody declared) — never a 0 that looks judged;
 *  - each source (a declared spec, or derived) gets its own row, and the whole
 *    is the sum of the rows;
 *  - the fallback risk is the table core/ owns (ADR-172 D8). The stub copies its
 *    rows so the stub lane is not silent about the ladder; core/ is the source
 *    (the front never decides it).
 */

/** Judging order — the engine short-circuits in this order. */
export const JUDGING_ORDER = Object.freeze(['reach', 'ik', 'grasp', 'visibility', 'interference'])

const NO_QUANTITY = new Set(['ik', 'interference'])

export function newTally() {
  const counts = {}
  for (const s of JUDGING_ORDER) counts[s] = { rejected: 0, nearest: null, unmeasurable: new Set() }
  return { generated: 0, feasible: 0, counts }
}

/** One rejection at `stage`: a measured shortfall `[quantity, value]`, or an unmeasurable reason. */
export function reject(tally, stage, { miss = null, unmeasurable = null } = {}) {
  const c = tally.counts[stage]
  c.rejected += 1
  if (miss) {
    if (!c.nearest || miss[1] < c.nearest[1]) c.nearest = miss
  } else if (unmeasurable) {
    c.unmeasurable.add(unmeasurable)
  }
}

/** The whole is the sum of its source rows (never a second source). */
export function merged(tallies) {
  const out = newTally()
  for (const t of tallies) {
    out.generated += t.generated
    out.feasible += t.feasible
    for (const s of JUDGING_ORDER) {
      const src = t.counts[s]
      const dst = out.counts[s]
      dst.rejected += src.rejected
      if (src.nearest && (!dst.nearest || src.nearest[1] < dst.nearest[1])) dst.nearest = src.nearest
      for (const r of src.unmeasurable) dst.unmeasurable.add(r)
    }
  }
  return out
}

function nearestMiss(stage, c) {
  if (NO_QUANTITY.has(stage)) return { kind: 'noQuantity' }
  if (c.rejected === 0) return { kind: 'noRejection' }
  if (c.nearest) return { kind: 'measured', quantity: c.nearest[0], value: c.nearest[1] }
  return { kind: 'unmeasurable', reasons: [...c.unmeasurable].sort() }
}

/**
 * The five stage verdicts in judging order (wire shape).
 * @param {object} tally
 * @param {Record<string,string>} notAsked  stage → reason
 */
export function stageVerdicts(tally, notAsked) {
  let entered = tally.generated
  const out = []
  for (const stage of JUDGING_ORDER) {
    const c = tally.counts[stage]
    if (notAsked[stage]) {
      if (c.rejected) throw new Error(`graspStub: ${stage} was not asked but rejected ${c.rejected}`)
      out.push({ stage, kind: 'notAsked', reason: notAsked[stage] })
      continue
    }
    out.push({ stage, kind: 'judged', entered, rejected: c.rejected, nearestMiss: nearestMiss(stage, c) })
    entered -= c.rejected
  }
  if (entered !== tally.feasible) {
    throw new Error(`graspStub: funnel identity violated — ${entered} survived the stages but feasible is ${tally.feasible}`)
  }
  return out
}

/** Which stages a request did not ask (the same declaration rule as core/). */
export function notAskedOf(gs) {
  const out = {}
  if (!gs?.camera) out.visibility = 'cameraUndeclared'
  if (!gs?.gripper) out.grasp = 'gripperUndeclared'
  return out
}

const DOMAIN_STAGES = Object.freeze({
  vision: ['visibility'],
  path: ['reach', 'ik', 'interference'],
  grasp: ['grasp'],
})
const RISK_TABLE = Object.freeze({
  'vision:true': [5, 'noneSeen'], 'vision:false': [3, 'someUnseen'],
  'path:true': [5, 'noneReachable'], 'path:false': [4, 'someUnreachable'],
  'grasp:true': [5, 'noneClosable'], 'grasp:false': [4, 'someUnclosable'],
})

/** The fallback risks from the stage verdicts, deepest first (copy of core/'s table). */
export function fallbackRisks(stages, feasible) {
  const byStage = Object.fromEntries(stages.map(v => [v.stage, v]))
  const risks = []
  const rejecting = []
  for (const [domain, ss] of Object.entries(DOMAIN_STAGES)) {
    const judged = ss.map(s => byStage[s]).filter(v => v?.kind === 'judged')
    if (!judged.length) continue
    const rejected = judged.reduce((n, v) => n + v.rejected, 0)
    if (rejected === 0) continue
    let rate = 1
    for (const v of judged) if (v.entered > 0) rate *= 1 - v.rejected / v.entered
    const [level, reason] = RISK_TABLE[`${domain}:${rate === 0}`]
    risks.push({ kind: 'domain', domain, level, reason })
    rejecting.push(domain)
  }
  if (feasible === 0 && rejecting.length >= 2) risks.push({ kind: 'together', level: 6, domains: rejecting })
  return risks.sort((a, b) => b.level - a.level)
}

/**
 * The v13 diagnostics core for a set of source tallies, in source order.
 * @param {{source: object, tally: object}[]} rows
 */
export function stageDiagnostics(rows, gs) {
  const notAsked = notAskedOf(gs)
  const whole = merged(rows.map(r => r.tally))
  const stages = stageVerdicts(whole, notAsked)
  return {
    candidatesGenerated: whole.generated,
    feasible: whole.feasible,
    stages,
    bySource: rows.map(({ source, tally }) => ({
      source, candidatesGenerated: tally.generated, feasible: tally.feasible,
      stages: stageVerdicts(tally, notAsked),
    })),
    fallbackRisks: fallbackRisks(stages, whole.feasible),
  }
}
