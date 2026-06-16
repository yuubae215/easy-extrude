/**
 * EditAdmissibleCommand — records one finished admissible-region edit for undo/redo
 * (ADR-050 §3.5, ADR-049 Phase 3, ADR-022).
 *
 * A region-authoring drag is a live, optimistic interaction (recolour only —
 * PHILOSOPHY #7); the canonical document is mutated **once**, on pointer-up, so
 * the whole drag is a single undoable step (not one command per frame). `before`
 * is the requirement's admissible captured at pointer-down, `after` the admissible
 * at pointer-up. Both paths regenerate the derived scene (the region drives
 * geometry, so geometry changes — unlike an approval status flip), through
 * `ContextService.applyAdmissible`, which yields a new document (input-immutable —
 * PHILOSOPHY #6) and re-projects via `contextChanged`.
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} reqRef — the requirement whose admissible region was edited
 * @param {object} before — the admissible before the drag (`{ region }` | `{ interval }`)
 * @param {object} after  — the admissible after the drag
 * @param {object} viewContext — { camera, renderer, container } for importFromJson
 * @returns {{label: string, execute(): Promise<object>, undo(): Promise<object>}}
 *   execute / undo return the regeneration promise (importFromJson is async); the
 *   CommandStack fires them without awaiting, but returning lets callers/tests await.
 */
export function createEditAdmissibleCommand(ctxService, reqRef, before, after, viewContext) {
  return {
    label: `Edit admissible ${reqRef}`,
    execute() { return ctxService.applyAdmissible(reqRef, after, viewContext) },
    undo()    { return ctxService.applyAdmissible(reqRef, before, viewContext) },
  }
}
