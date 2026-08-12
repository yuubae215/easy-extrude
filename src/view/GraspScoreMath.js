/**
 * GraspScoreMath — pure presentation derivations over a candidate's
 * `score.objectiveScores`, read against the objective weights the RUN actually
 * requested (ADR-120 D3).
 *
 * SCOPE / GOVERNANCE (PHILOSOPHY #29): the wire carries the solver's decided
 * facts — which objectives it evaluated, and their normalized values. This
 * module decides nothing about grasping; it only answers "what did the run ask
 * for, and what came back", so the panel can say *not measured* instead of
 * drawing a zero-length bar for something nobody measured.
 *
 * ## Why the population is the REQUEST's weights, not the response's keys
 *
 * An objective that could not be evaluated is carried by the ABSENCE of its key
 * (ADR-120 D2 — a closed score layer gets no "unevaluated names" sibling field,
 * ADR-060). Absence has no node, so enumerating what came back can never surface
 * it: the only way to count it is to enumerate the kinds that were ASKED FOR and
 * check each one off (PHILOSOPHY #31). That population lives in the run's own
 * record — `context.grasp.request.graspSearch.objectiveWeights` — which is a
 * fact of the run, not a second source: the response never echoes it.
 *
 * Reading the panel's live slider values instead would be the same defect wearing
 * different clothes, because the sliders may have moved since the run.
 *
 * Pure and THREE-free: runs in the bare `node --test` lane (test:context).
 */

/**
 * How a single requested objective fared in one candidate.
 *
 * @typedef {object} ObjectiveRow
 * @property {string} name        the objective's registered name
 * @property {number|null} weight the weight the run requested it with (null when
 *                                the response carries a name the run did not
 *                                weight — surfaced, never dropped)
 * @property {boolean} evaluated  whether the solver returned a value for it
 * @property {number|null} value  the normalized 0..1 value, or null when unevaluated
 */

/** True for a finite number in the contract's normalized 0..1 range. */
function isNormalized(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

/** True for a finite, non-negative weight (the DSL's `objectiveWeights` domain). */
function isWeight(v) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0
}

/**
 * Enumerate every objective the run asked for, marking which ones the solver
 * could actually evaluate.
 *
 * Order: the requested objectives in declaration order first (so the rows do not
 * reshuffle between runs as evaluability changes), then any evaluated name the
 * run did not weight. A weighted name whose returned value is out of the
 * contract's 0..1 range is treated as UNEVALUATED rather than clamped — a
 * malformed value is not a measurement, and silently clamping it would put a
 * fabricated bar on screen (PHILOSOPHY #11).
 *
 * @param {Record<string, number>|null|undefined} objectiveWeights  what the run requested
 * @param {Record<string, number>|null|undefined} objectiveScores   what the solver returned
 * @returns {null | { rows: ObjectiveRow[], evaluated: number, unevaluated: number }}
 *   `null` when neither side is a usable object — a legacy solver with no
 *   breakdown and no recorded request says nothing, and nothing is what the
 *   panel should draw.
 */
export function objectiveRows(objectiveWeights, objectiveScores) {
  const weights = objectiveWeights && typeof objectiveWeights === 'object' ? objectiveWeights : null
  const scores  = objectiveScores  && typeof objectiveScores  === 'object' ? objectiveScores  : null
  if (!weights && !scores) return null

  const rows = []
  const seen = new Set()

  for (const [name, w] of Object.entries(weights ?? {})) {
    seen.add(name)
    const value = scores ? scores[name] : undefined
    const evaluated = isNormalized(value)
    rows.push({
      name,
      weight:    isWeight(w) ? w : null,
      evaluated,
      value:     evaluated ? value : null,
    })
  }

  // A returned name the run did not weight cannot be "unevaluated" — it is a
  // fact the response carried anyway. Dropping it would hide a real drift
  // between what the front asked for and what the solver scores.
  for (const [name, value] of Object.entries(scores ?? {})) {
    if (seen.has(name) || !isNormalized(value)) continue
    rows.push({ name, weight: null, evaluated: true, value })
  }

  return {
    rows,
    evaluated:   rows.filter(r => r.evaluated).length,
    unevaluated: rows.filter(r => !r.evaluated).length,
  }
}

/**
 * One line naming what was not measured, or `null` when everything asked for
 * came back.
 *
 * The reason this is a sentence and not just missing bars: an objective that
 * simply vanishes from the list is a silent omission, and the reader cannot tell
 * it apart from one they never weighted (PHILOSOPHY #11).
 *
 * @param {ReturnType<typeof objectiveRows>} summary
 * @returns {string|null}
 */
export function unevaluatedNote(summary) {
  if (!summary || summary.unevaluated === 0) return null
  const names = summary.rows.filter(r => !r.evaluated).map(r => r.name)
  return `not measured: ${names.join(', ')} — weighted, but the solver had nothing to measure it against`
}
