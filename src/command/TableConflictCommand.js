/**
 * TableConflictCommand — somebody puts a conflict on the floor (ADR-104 D4).
 *
 * **This is where the record starts.** A conflict itself is re-derived by R6
 * from the requirement graph on every validate, so it is never stored: opening
 * the floor and looking at conflicts leaves no trace, which is right, because
 * nobody has done anything yet. Tabling one cannot be recomputed from the
 * document — it is a human act — so it is stored, and it is undoable.
 *
 * A conflict that re-flares after being settled is tabled as a **new** item
 * carrying `supersedes` (ADR-104 U3), never by reopening the old one: receipts
 * stay an append-only line so "what is the current conclusion" always has
 * exactly one answer, and the Why tab (ADR-052) reconstructs the lineage by
 * walking the references.
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref — the new agenda-item ref (`ag_*`)
 * @param {string} conflictRef — the R6 conflict being tabled (`conflict_*`)
 * @param {string} by — who tabled it
 * @param {{supersedes?: string}} opts — the settled item this one re-opens
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{label: string, execute(): Promise<object>, undo(): Promise<object>}}
 */
export function createTableConflictCommand(ctxService, ref, conflictRef, by, opts, viewContext) {
  return {
    label: `Table ${conflictRef}`,
    execute() { return ctxService.tableConflict(ref, conflictRef, by, opts, viewContext) },
    undo()    { return ctxService.untableConflict(ref, viewContext) },
  }
}
