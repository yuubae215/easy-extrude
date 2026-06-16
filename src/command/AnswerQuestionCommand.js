/**
 * AnswerQuestionCommand — records a Context-DSL form-question answer for undo/redo
 * (ADR-050 §3.5, ADR-022).
 *
 * Answering a question adds a `given` fact value (R1), assigns an actor to an
 * obligation (R4), sets a KPI/criterion on a requirement (R9), or adds a new
 * requirement (R8). All of these potentially change the validator output, and
 * some change derived geometry (e.g. a new `given` value may promote a `stated`
 * admissible to `derived`, shifting the zone in the layout). Both `execute()` and
 * `undo()` therefore regenerate the scene — unlike `ApproveDecisionCommand`, which
 * is geometry-invariant.
 *
 * The whole doc is snapshotted before/after: Context DSL documents are small JSON
 * objects and the before/after snapshot approach offers clarity over a delta:
 * the before/after pair is the natural undo/redo payload (same pattern as every
 * doc-mutation in this codebase — PHILOSOPHY #6, input-immutable).
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} qRef — the OpenQuestion ref being answered (e.g. "oq_kpi_r_foo")
 * @param {object} beforeDoc — canonical doc snapshot before the answer
 * @param {object} afterDoc  — canonical doc snapshot after the answer applied
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{ label: string, execute(): Promise, undo(): Promise }}
 */
export function createAnswerQuestionCommand(ctxService, qRef, beforeDoc, afterDoc, viewContext) {
  return {
    label: `Answer question ${qRef}`,
    execute() { return ctxService.applyContextDoc(afterDoc,  viewContext, { regenerate: true }) },
    undo()    { return ctxService.applyContextDoc(beforeDoc, viewContext, { regenerate: true }) },
  }
}
