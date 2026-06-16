/**
 * ApproveDecisionCommand — records a Context-DSL Decision approval for undo/redo
 * (ADR-050 §3.5, ADR-022).
 *
 * Approval is a real mutation of the canonical document (`decision.status:
 * proposed → agreed`), not a transient set (ADR-050 §3.2) — so it belongs on the
 * single CommandStack history alongside geometry edits. The status flip leaves
 * the compiled layout invariant (`$decision` markers resolve to `nominal`
 * verbatim regardless of status), so neither `execute()` nor `undo()` regenerates
 * the scene — `ContextService.approveDecision` / `unapproveDecision` only
 * re-validate + re-project (the matrix `proposed ◐ → resolved ✓` transition is
 * doc-derived through `approvedRefs`).
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref — the Decision ref to approve
 * @param {object} viewContext — { camera, renderer, container } (unused for a
 *   status flip, but threaded through for parity with the regenerating mutations)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createApproveDecisionCommand(ctxService, ref, viewContext) {
  return {
    label: `Approve decision ${ref}`,
    execute() { ctxService.approveDecision(ref, viewContext) },
    undo()    { ctxService.unapproveDecision(ref, viewContext) },
  }
}
