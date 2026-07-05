/**
 * CheckFeedbackMath — pure presentation derivations over the validator's
 * `checkResults` and the doc's baked acceptance predicates (ADR-062 Phase 4).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29, ADR-062): the *facts* are owned by the
 * proof layer — `validateContext().checkResults` decides pass / fail / blocked
 * (via PredicateEngine over pre-baked measurement operands, ADR-053 §9), and
 * the operands themselves (`targets[].margin`, `contacts[].clearance`) are
 * instrument-baked doc data. This module only re-shapes those facts for
 * display: status-transition detection for the landing flash, and the
 * worst-margin near-miss meter. It never re-implements reach / collision
 * judgment; malformed input degrades to `null`, never a fabricated signal
 * (PHILOSOPHY #11).
 *
 * The meter reuses the ADR-061 near-miss curve (`nearMissCloseness`) so the
 * "so close" feel is ONE curve across the grasp funnel and the checks panel —
 * the raw numbers (geometry length unit) are what the panel prints; the curve
 * only drives the fill.
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 * The previous snapshot behind a transition flash is component-local
 * presentation state (ADR-062 §2 — never a uiStore or wire field).
 */

import { nearMissCloseness } from './GraspFunnelMath.js'

/** Check statuses the validator can emit (ContextValidator R5). */
const VALID_STATUS = ['pass', 'fail', 'blocked']

/**
 * Encode a projected checks list into `"ref:status"` keys — a status-aware
 * snapshot the shared `usePrevOnChange` can watch (its refs signature would
 * miss a status flip on an unchanged ref set). Any entry without a non-empty
 * string `ref` and a valid status degrades the WHOLE list to `null` — no
 * guessed identity (PHILOSOPHY #11).
 *
 * @param {Array<{ref:string, status:string}>|null|undefined} checks
 * @returns {string[]|null}
 */
export function checkStatusKeys(checks) {
  if (!Array.isArray(checks)) return null
  const keys = []
  for (const c of checks) {
    if (!c || typeof c !== 'object') return null
    if (typeof c.ref !== 'string' || c.ref === '') return null
    if (!VALID_STATUS.includes(c.status)) return null
    keys.push(`${c.ref}:${c.status}`)
  }
  return keys
}

/** Decode one `"ref:status"` key; `null` when it is not one. */
function parseKey(key) {
  if (typeof key !== 'string') return null
  const i = key.lastIndexOf(':')
  if (i <= 0 || i === key.length - 1) return null
  const status = key.slice(i + 1)
  if (!VALID_STATUS.includes(status)) return null
  return { ref: key.slice(0, i), status }
}

/**
 * Status transitions between two `checkStatusKeys` snapshots: every ref present
 * in BOTH whose status changed (`blocked→pass` after a measurement bake or an
 * answered question, `pass→fail` after an edit, …). A ref only present on one
 * side is not a transition (nothing changed — it appeared or vanished).
 *
 * @param {string[]|null|undefined} prevKeys
 * @param {string[]|null|undefined} curKeys
 * @returns {Array<{ref:string, from:string, to:string}>|null} `null` without
 *   two decodable snapshots
 */
export function checkTransitions(prevKeys, curKeys) {
  if (!Array.isArray(prevKeys) || !Array.isArray(curKeys)) return null
  const prev = new Map()
  for (const k of prevKeys) {
    const p = parseKey(k)
    if (!p) return null
    prev.set(p.ref, p.status)
  }
  const out = []
  for (const k of curKeys) {
    const c = parseKey(k)
    if (!c) return null
    const from = prev.get(c.ref)
    if (from !== undefined && from !== c.status) out.push({ ref: c.ref, from, to: c.status })
  }
  return out
}

/**
 * How many checks in a `checkStatusKeys` snapshot are not yet passing
 * (fail + blocked) — the "open items" count behind the run-over-run delta
 * chip (fewer is better, same semantics as open questions / live conflicts).
 *
 * @param {string[]|null|undefined} keys
 * @returns {number|null}
 */
export function unsettledCount(keys) {
  if (!Array.isArray(keys)) return null
  let n = 0
  for (const k of keys) {
    const p = parseKey(k)
    if (!p) return null
    if (p.status !== 'pass') n++
  }
  return n
}

/**
 * Worst-operand margin meter for a robotics predicate (ADR-062 Phase 4).
 * Reads only instrument-baked facts:
 *   - `robot_reach`   — worst `targets[].margin` vs the required `marginMin`
 *   - `collision_free`— worst `contacts[].clearance` vs required `clearance`
 *     (contract default 0 = penetration only)
 * `closeness` is the shared ADR-061 curve over the shortfall (1 = requirement
 * met, → 0 as the worst operand falls further below it); `headroom` is the
 * signed raw distance the panel prints next to the meter.
 *
 * Returns `null` when the predicate carries no comparable measurement — a
 * `robot_reach` without `marginMin`, an empty / margin-less operand list, a
 * non-robotics kind. No meter is honest there (PHILOSOPHY #11): an empty
 * `contacts` list is a legitimate pass but has no worst distance to show.
 *
 * @param {string|null|undefined} kind — predicate kind
 * @param {object|null|undefined} predicate — the acceptance check's predicate
 * @returns {{worst:number, required:number, headroom:number, closeness:number}|null}
 */
export function checkMeter(kind, predicate) {
  if (!predicate || typeof predicate !== 'object') return null
  if (kind === 'robot_reach') {
    return meterFrom(predicate.marginMin, (predicate.targets ?? []).map(t => t?.margin))
  }
  if (kind === 'collision_free') {
    return meterFrom(predicate.clearance ?? 0, (predicate.contacts ?? []).map(c => c?.clearance))
  }
  return null
}

/** Build the meter facts from a required threshold and measured operand values. */
function meterFrom(required, values) {
  if (typeof required !== 'number' || !Number.isFinite(required)) return null
  const measured = (Array.isArray(values) ? values : [])
    .filter(v => typeof v === 'number' && Number.isFinite(v))
  if (measured.length === 0) return null
  const worst    = Math.min(...measured)
  const headroom = worst - required
  return { worst, required, headroom, closeness: nearMissCloseness(Math.max(0, -headroom)) }
}
