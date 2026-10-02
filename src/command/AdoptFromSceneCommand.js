/**
 * AdoptFromSceneCommand — declare something about an object that was only on the
 * screen, as ONE undoable step (ADR-159 D1 / D3).
 *
 *   execute(): adoptFromScene(afterDoc, adoptedIds)  — the object enters the
 *              document (re-created under its compiled id) WITH the declaration
 *   undo():    restoreSnapshot(before)               — the scene the user had,
 *              original ids included, and the document it had (possibly none)
 *
 * Why not `createDocEditCommand`: its undo regenerates `beforeDoc`, and
 * `beforeDoc` never projected the adopted object (or does not exist) — the
 * object would vanish on undo instead of returning. The snapshot is taken by the
 * caller at plan time, the moment the user's press was read.
 *
 * Redo re-runs `execute`: undo is LIFO, so the scene is back at the snapshot and
 * the same adoption applies again under the same deterministic compiled ids.
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {{ beforeDoc: object|null, afterDoc: object, adoptedIds: string[],
 *           sceneJson: object, projectedIds: Set<string> }} plan
 * @param {string} label
 * @param {object} viewContext
 * @returns {{ label: string, execute(): Promise, undo(): Promise }}
 */
export function createAdoptFromSceneCommand(ctxService, plan, label, viewContext) {
  const { beforeDoc, afterDoc, adoptedIds, sceneJson, projectedIds } = plan
  return {
    label,
    execute() {
      return Promise.resolve(ctxService.adoptFromScene(afterDoc, adoptedIds, viewContext))
    },
    undo() {
      return Promise.resolve(ctxService.restoreSnapshot(
        { doc: beforeDoc, sceneJson, projectedIds }, viewContext))
    },
  }
}
