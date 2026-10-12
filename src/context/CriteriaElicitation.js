/**
 * CriteriaElicitation — how many answers are still missing (ADR-165 力学 1).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 *
 * The census counts **blanks in the fields that must exist**, never the
 * answers that happen to exist (PHILOSOPHY #31). The population is
 *
 *     end users (1..N)  ×  ( mix {D,Q,C,S}  +  every CRITERIA_ELEMENTS row × {expectation, weight} )
 *
 * so an end user who never said a word about safety still owns two safety
 * rows, both blank, and the count cannot reach 0 until someone asks them.
 *
 *     unheard = Σ_u ( |{c ∈ {D,Q,C,S} : mix[c] unanswered}| + |{(e, f) : f ∈ {expectation, weight} unanswered}| )
 *
 * Zero end users is not "nothing to ask" — it is "the hearing has not
 * started" (`started: false`), and it is reported as such rather than as a
 * vacuous 0 (there is no legitimate zero — ADR-165 D1).
 *
 * The census is derived every time it is asked and never stored: a stored
 * count would be a second source the first edit makes stale (§1.1).
 *
 * Agreement (ADR-165 D5) is a separate fact and is not decided here.
 *
 * @module context/CriteriaElicitation
 */

import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS, criteriaElementOf } from './CriteriaCatalog.js'
import { endUsersOf } from './ActorStance.js'

/** The kinds of blank the census can report. */
export const BLANK_FIELD = Object.freeze({
  MIX:         'mix',
  EXPECTATION: 'expectation',
  WEIGHT:      'weight',
})

const isAnsweredNumber = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** An expectation is answered when the requirement states a comparison and a number. */
export function isExpectationAnswered(requirement) {
  const c = requirement?.criterion
  return typeof c?.op === 'string' && c.op !== '' && typeof c.value === 'number' && Number.isFinite(c.value)
}

/** A weight is answered when it is a finite, non-negative number (a declared 0 counts). */
export function isWeightAnswered(requirement) {
  return isAnsweredNumber(requirement?.weight)
}

/**
 * The requirements that answer `element` for `endUser`. The answer belongs to
 * the person who may write it (`owner`), not to whoever typed it (`by`).
 * More than one is ambiguous and is reported, never silently picked.
 */
export function answersOf(ctx, endUserRef, elementKey) {
  return (ctx?.requirements ?? []).filter(r =>
    r.owner === endUserRef && criteriaElementOf(r)?.key === elementKey)
}

/**
 * Count the unheard fields of a Context DSL document.
 *
 * @param {object} ctx
 * @returns {{
 *   started: boolean,
 *   endUsers: string[],
 *   blanks: Array<{actor: string, field: string, category?: string, element?: string}>,
 *   duplicates: Array<{actor: string, element: string, refs: string[]}>,
 *   count: number,
 *   complete: boolean,
 * }}
 */
export function countUnheard(ctx) {
  const endUsers   = endUsersOf(ctx)
  const blanks     = []
  const duplicates = []

  for (const u of endUsers) {
    for (const c of CRITERIA_CATEGORIES) {
      if (!isAnsweredNumber(u.mix?.[c])) {
        blanks.push({ actor: u.ref, field: BLANK_FIELD.MIX, category: c })
      }
    }
    for (const e of CRITERIA_ELEMENTS) {
      const answers = answersOf(ctx, u.ref, e.key)
      if (answers.length > 1) {
        duplicates.push({ actor: u.ref, element: e.key, refs: answers.map(r => r.ref) })
      }
      const r = answers.length === 1 ? answers[0] : null
      if (!r || !isExpectationAnswered(r)) {
        blanks.push({ actor: u.ref, field: BLANK_FIELD.EXPECTATION, element: e.key, category: e.category })
      }
      if (!r || !isWeightAnswered(r)) {
        blanks.push({ actor: u.ref, field: BLANK_FIELD.WEIGHT, element: e.key, category: e.category })
      }
    }
  }

  const started = endUsers.length > 0
  return {
    started,
    endUsers: endUsers.map(u => u.ref),
    blanks,
    duplicates,
    count: blanks.length,
    complete: started && blanks.length === 0 && duplicates.length === 0,
  }
}
