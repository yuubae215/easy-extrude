/**
 * AddDocEntryCommand — undoable doc-entry addition command (ADR-051 Phase 1).
 *
 * A thin specialization of the generic `createDocEditCommand` (ADR-058 Phase 2):
 * both are the same before/after snapshot pattern (PHILOSOPHY #6) over
 * `applyContextDoc({regenerate:true})`. Kept as a named export so its existing
 * call sites (intake add, NL fact batch) read intently; the in-place edit / remove
 * paths call `createDocEditCommand` directly. A single implementation (§1.1) — this
 * delegates rather than duplicating the body.
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {object} beforeDoc — full doc snapshot BEFORE the addition
 * @param {object} afterDoc  — full doc snapshot AFTER the addition
 * @param {string} label     — human-readable label for undo history (e.g. "Add actor")
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{ label: string, execute(): Promise, undo(): Promise }}
 */
import { createDocEditCommand } from './DocEditCommand.js'

export function createAddDocEntryCommand(ctxService, beforeDoc, afterDoc, label, viewContext) {
  return createDocEditCommand(ctxService, beforeDoc, afterDoc, label, viewContext)
}
