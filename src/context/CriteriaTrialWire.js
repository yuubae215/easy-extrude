/**
 * CriteriaTrialWire — the criteria line on the wire, and the identity of an
 * answer (ADR-165 D6, contract `criteria-trial` — contractVersion 9).
 *
 * Pure: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 *
 * This module only **re-shapes** the document's line into the request the
 * contract names, and reads the answer back. It computes nothing from the
 * weights: the candidates, the interest per end user × category and what a
 * change gives up are core/'s cost function (an idea — CLAUDE.md §AI 向けガード
 * 軸 1). `src/CriteriaIndicatorCensus.test.js` counts that no file in src/
 * produces those values.
 *
 * ## Who is sent
 *
 * Only end users whose answers are complete. An end user with blanks is not
 * sent and is named back as `omitted` — the solver never guesses a blank, and
 * the screen says whose indicator is missing and why (PHILOSOPHY #11 / #31).
 *
 * ## Which answer is this?
 *
 * A request is async; the line can change while it is in flight.
 * `isAnswerForLine(requested, ctx)` is the one predicate that says whether an
 * answer still describes the document's line (IDENTITY_RULES) — an answer to
 * an older line is dropped, never recorded as what someone saw (optimistic:
 * the screen never blocks while waiting — PHILOSOPHY #7).
 *
 * @module context/CriteriaTrialWire
 */

import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS } from './CriteriaCatalog.js'
import { currentLine, lineFieldOf, MARGIN_KIND } from './CriteriaLine.js'
import { sameClaimValue } from './Proposal.js'

/** True when one end user's slice states every field the wire needs. */
function isCompleteSlice(slice) {
  if (!slice) return false
  if (!CRITERIA_CATEGORIES.every(c => typeof slice.mix?.[c] === 'number')) return false
  return CRITERIA_ELEMENTS.every(e => {
    const a = slice.elements?.[e.key]
    return a && a.criterion && typeof a.criterion.value === 'number' && typeof a.criterion.op === 'string'
      && typeof a.weight === 'number'
  })
}

/**
 * The contract's `line` from a line value (`CriteriaLine.currentLine` shape).
 *
 * @param {Record<string, {mix: object, elements: object}>} line
 * @returns {{line: {endUsers: object[]}|null, omitted: string[]}}
 *          `line` is null when no end user is complete (nothing to send).
 */
export function wireLineOf(line) {
  const endUsers = []
  const omitted = []
  for (const [ref, slice] of Object.entries(line ?? {})) {
    if (!isCompleteSlice(slice)) { omitted.push(ref); continue }
    endUsers.push({
      ref,
      mix: Object.fromEntries(CRITERIA_CATEGORIES.map(c => [c, slice.mix[c]])),
      elements: CRITERIA_ELEMENTS.map(e => {
        const a = slice.elements[e.key]
        return { key: e.key, op: a.criterion.op, value: a.criterion.value, weight: a.weight }
      }),
    })
  }
  return { line: endUsers.length ? { endUsers } : null, omitted }
}

/**
 * **Is this answer still about the document's line?** The one reader of
 * "the line an answer was asked for" against the line now (IDENTITY_RULES).
 *
 * @param {object} requestedLine — the `currentLine` value captured when asking
 * @param {object} ctx
 */
export function isAnswerForLine(requestedLine, ctx) {
  return sameClaimValue(requestedLine, currentLine(ctx))
}

/**
 * The line as a proposal would leave it: the current line with the target's
 * field written. A closed-form rewrite of one field — the assessment of what
 * it gives up is core/'s.
 *
 * @param {object} ctx
 * @param {{kind: string, ref: string}} target — a line field (`lineFieldOf` non-null)
 * @param {any} to
 * @returns {object|null} the line value, or null when the target is not a line field
 */
export function lineWithChange(ctx, target, to) {
  const f = lineFieldOf(ctx, target)
  if (!f) return null
  const line = currentLine(ctx)
  const slice = line[f.actor]
  if (!slice) return null
  const next = f.field === 'mix'
    ? { ...slice, mix: { ...to } }
    : { ...slice, elements: { ...slice.elements, [f.element]: { ...(slice.elements[f.element] ?? {}), [f.field]: to } } }
  return { ...line, [f.actor]: next }
}

/**
 * What a trial records as seen: each candidate exactly as it was shown (id,
 * label, actuals with their basis and range) — a snapshot, so "what did they
 * see when they cut safety?" is readable after core/'s model changes
 * (ADR-165 §PR4 の俯瞰 3). History, not a second source: nothing reads it as
 * the current value of a cell.
 *
 * @param {object[]} candidates — the wire `candidates`
 */
export function seenSnapshotOf(candidates) {
  return (candidates ?? []).map(c => ({
    id: c.id,
    label: c.label,
    actuals: (c.actuals ?? []).map(a => ({ key: a.key, value: a.value, basis: a.basis, ...(a.range ? { range: [...a.range] } : {}) })),
  }))
}

export { MARGIN_KIND }

/**
 * The margin record stored on a proposal from the wire's assessment.
 * Throws on a kind nobody declared (PHILOSOPHY #31 — no fall-through).
 */
export function marginOf(wireProposal) {
  switch (wireProposal?.kind) {
    case MARGIN_KIND.EVALUATED:
      return { kind: MARGIN_KIND.EVALUATED, baseline: wireProposal.baseline, proposed: wireProposal.proposed, offerings: wireProposal.offerings.map(o => ({ ...o })) }
    case MARGIN_KIND.UNSATISFIABLE:
    case MARGIN_KIND.NO_BASELINE:
      return { kind: wireProposal.kind }
    default:
      throw new Error(`[CriteriaTrialWire] no margin declared for proposal kind "${wireProposal?.kind}"`)
  }
}
