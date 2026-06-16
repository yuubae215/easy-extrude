/**
 * AddDocEntryCommand — undoable doc-entry addition command (ADR-051 Phase 1).
 *
 * Follows the same before/after snapshot pattern as AnswerQuestionCommand
 * (PHILOSOPHY #6 — Transformations Return New Instances):
 *   execute(): applyContextDoc(afterDoc, regenerate:true)
 *   undo():    applyContextDoc(beforeDoc, regenerate:true)
 *
 * `regenerate: true` is always passed for consistency — when a blank doc has no
 * specification.layout, scene regeneration is a no-op (PHILOSOPHY #11: never
 * silently skip a step that might matter in future).
 */

/**
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {object} beforeDoc — full doc snapshot BEFORE the addition
 * @param {object} afterDoc  — full doc snapshot AFTER the addition
 * @param {string} label     — human-readable label for undo history (e.g. "Add actor")
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{ label: string, execute(): Promise, undo(): Promise }}
 */
export function createAddDocEntryCommand(ctxService, beforeDoc, afterDoc, label, viewContext) {
  return {
    label,
    execute() {
      return Promise.resolve(ctxService.applyContextDoc(afterDoc, viewContext, { regenerate: true }))
    },
    undo() {
      return Promise.resolve(ctxService.applyContextDoc(beforeDoc, viewContext, { regenerate: true }))
    },
  }
}
