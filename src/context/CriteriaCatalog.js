/**
 * CriteriaCatalog — the value tree every end user is asked (ADR-165 D2).
 *
 * Pure data: no I/O, no Three.js, no DOM.
 *
 * Upper tier: QCD + S — the end user's ratio between speed, quality, cost and
 * safety (`actor.mix`). Lower tier: the elements below, each answered as the
 * same pair `{expectation, weight}` — expectation = the requirement's existing
 * `criterion` (the threshold = the criterion = what the person expects),
 * weight = `requirement.weight` (how much exceeding it is worth). Safety has
 * the same shape: "do not touch a person" still has a margin to choose.
 *
 * **This table is the population** (PHILOSOPHY #31). Safety is the element no
 * one says out loud on the shop floor, so a hearing that only records what was
 * said never grows a safety row. CriteriaElicitation counts blanks against
 * *this* list, not against the rows that happen to exist.
 *
 * It is curated vocabulary (CLAUDE.md §AI 向けガード — a list of words, not an
 * idea): which solver weight each element maps to, and how weights combine
 * into a score, are core/'s business and are deliberately absent here.
 *
 * The 7 elements were confirmed by the stakeholder on 2026-10-11 (ADR-165
 * §PR1 の俯瞰 — 「落とさない」 = holdMargin and 「止めたら止まる」 =
 * stoppingDistance included). Labels are UI text, so English (ADR-161). A word that turns
 * out not to be how the floor says it is replaced here, in one place.
 *
 * @module context/CriteriaCatalog
 */

/** Upper tier of the value tree — keys of `actor.mix`, in asking order. */
export const CRITERIA_CATEGORIES = Object.freeze(['D', 'Q', 'C', 'S'])

/** Human words for the upper tier (UI text is English — ADR-161). */
export const CRITERIA_CATEGORY_LABELS = Object.freeze({
  D: 'Delivery (speed)',
  Q: 'Quality',
  C: 'Cost',
  S: 'Safety',
})

/**
 * Lower tier. `key` is the identity: a requirement answers this element when
 * its `kpi.name` equals the key (criteriaElementOf below — the one place that
 * reads it). `op` is the direction a sensible expectation points; the form
 * pre-fills it, the census does not enforce it.
 *
 * @type {ReadonlyArray<{key:string, category:'D'|'Q'|'C'|'S', label:string, unit:string, op:string}>}
 */
export const CRITERIA_ELEMENTS = Object.freeze([
  Object.freeze({ key: 'takt',             category: 'D', label: 'Takt time',               unit: 's',   op: '<=' }),
  Object.freeze({ key: 'positionAccuracy', category: 'Q', label: 'Position accuracy',       unit: 'mm',  op: '<=' }),
  Object.freeze({ key: 'holdMargin',       category: 'Q', label: 'Never drop (hold margin)', unit: '×',   op: '>=' }),
  Object.freeze({ key: 'equipmentCost',    category: 'C', label: 'Equipment cost',          unit: 'JPY', op: '<=' }),
  Object.freeze({ key: 'maintainability',  category: 'C', label: 'Maintainability (MTTR)',  unit: 'min', op: '<=' }),
  Object.freeze({ key: 'humanClearance',   category: 'S', label: 'Never touch a person (margin)', unit: 'mm',  op: '>=' }),
  Object.freeze({ key: 'stoppingDistance', category: 'S', label: 'Stops when stopped (stopping distance)', unit: 'mm',  op: '<=' }),
])

const BY_KEY = new Map(CRITERIA_ELEMENTS.map(e => [e.key, e]))

/**
 * Which criteria element a requirement answers, or null when it answers none
 * (an ordinary design requirement). The one reader of "kpi.name as element".
 *
 * @param {object} requirement
 * @returns {object|null}
 */
export function criteriaElementOf(requirement) {
  const name = requirement?.kpi?.name
  return typeof name === 'string' ? (BY_KEY.get(name) ?? null) : null
}

/** Elements of one upper-tier category, in catalog order. */
export function elementsOfCategory(category) {
  return CRITERIA_ELEMENTS.filter(e => e.category === category)
}

/**
 * **Archetypes** — starting points for the QCD + S ratio (ADR-165 D3, flow v4
 * Step 2: "pick a type, then adjust" — the job choice of character creation).
 *
 * Vocabulary, not a decision (stakeholder, 2026-10-12): picking one only fills
 * the person's draft; nothing is written until they press Save, and the saved
 * ratio is their answer, which they adjust freely. No ratio is ever inferred
 * from an archetype, and the census never counts an archetype as an answer.
 * Every archetype states all four categories (safety included — S is never
 * left for the person to forget).
 *
 * @type {ReadonlyArray<{key: string, label: string, mix: Readonly<{D:number,Q:number,C:number,S:number}>}>}
 */
export const MIX_ARCHETYPES = Object.freeze([
  Object.freeze({ key: 'neverStop',  label: 'Never stop the line', mix: Object.freeze({ D: 40, Q: 25, C: 15, S: 20 }) }),
  Object.freeze({ key: 'neverMiss',  label: 'Never miss',          mix: Object.freeze({ D: 20, Q: 45, C: 15, S: 20 }) }),
  Object.freeze({ key: 'cheapFast',  label: 'Cheap and fast',      mix: Object.freeze({ D: 35, Q: 15, C: 35, S: 15 }) }),
  Object.freeze({ key: 'nobodyHurt', label: 'Nobody gets hurt',    mix: Object.freeze({ D: 15, Q: 20, C: 15, S: 50 }) }),
])
