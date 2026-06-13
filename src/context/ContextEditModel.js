/**
 * ContextEditModel — pure edits to a Context DSL object for the bidirectional
 * 3D authoring widget (ADR-049 Phase 3, §5.2).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3) Every function
 * returns a NEW context object and never mutates its input (PHILOSOPHY #6) — so
 * a live drag can re-validate against the edited copy without disturbing the
 * authoritative loaded context, and a cancelled drag simply discards it.
 *
 * The 3D widget is an input device + evidence, never the contract (ADR-049
 * invariant 9): a dragged region/interval is written back as a `stated`
 * admissible (R9 still governs — the KPI backing must still be supplied in the
 * text DSL before lock-in). The controller then re-runs `validateContext` on the
 * returned context to recompute conflicts live.
 *
 * @module context/ContextEditModel
 */

/**
 * Replace one requirement's admissible with a hand-authored (`stated`) one.
 *
 * @param {object} ctx     — Context DSL object
 * @param {string} reqRef  — requirement ref to edit
 * @param {object} admissible — `{ interval: [lo,hi] }` or `{ region: {axis:[lo,hi]} }`
 *   (the `source` is forced to `'stated'`; any `promotedFrom` is dropped)
 * @returns {object} a new context object with that requirement's admissible replaced
 */
export function applyAdmissibleEdit(ctx, reqRef, admissible) {
  const requirements = (ctx.requirements ?? []).map(req => {
    if (req.ref !== reqRef) return req
    const next = { ...req, admissible: { ...admissible, source: 'stated' } }
    delete next.admissible.promotedFrom
    return next
  })
  return { ...ctx, requirements }
}
