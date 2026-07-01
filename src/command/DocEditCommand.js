/**
 * DocEditCommand — generic undoable document-snapshot command (ADR-058 Phase 2).
 *
 * The before/after snapshot pattern (PHILOSOPHY #6) shared by every doc mutation
 * that goes through `applyContextDoc({regenerate:true})`: add an entry, edit an
 * entry in place, remove an entry, answer a question. `createAddDocEntryCommand`
 * is a thin specialization of this (kept for its call sites); `ContextController`'s
 * in-place edit / remove paths use this directly.
 *
 *   execute(): applyContextDoc(afterDoc,  regenerate:true)
 *   undo():    applyContextDoc(beforeDoc, regenerate:true)
 *
 * `regenerate: true` is always passed — a per-field edit can shift derived
 * geometry (a criterion value promotes a `stated` admissible to `derived`,
 * moving a zone), and on a spec-less doc regeneration is a safe no-op
 * (PHILOSOPHY #11: never silently skip a step that might matter).
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {object} beforeDoc — full doc snapshot BEFORE the mutation
 * @param {object} afterDoc  — full doc snapshot AFTER the mutation
 * @param {string} label     — human-readable label for undo history
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{ label: string, execute(): Promise, undo(): Promise }}
 */
export function createDocEditCommand(ctxService, beforeDoc, afterDoc, label, viewContext) {
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
