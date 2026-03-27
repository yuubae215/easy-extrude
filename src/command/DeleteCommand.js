import { CoordinateFrame } from '../domain/CoordinateFrame.js'

/**
 * DeleteCommand — records a soft-delete operation for undo/redo.
 * (ADR-022 Phase 3)
 *
 * Entities are NOT disposed on delete. Instead they are detached from the
 * model (hidden, removed from SceneModel) while their meshViews remain alive
 * so that undo can restore them without reconstruction.  The CommandStack's
 * MAX=50 limit bounds the number of retained entities.
 *
 * undo(): re-inserts the entity and all its descendant frames; geometry
 *   objects become visible again, frames stay invisible until parent selected.
 * execute() (redo): soft-detaches entity and descendants again.
 *
 * @param {object}   entityRef     The deleted domain entity (Solid/Profile/MeasureLine/…)
 * @param {object[]} childrenRefs  Descendant frames in topological order (shallow-first)
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {(id: string) => void} onAfterUndo   Called with entityRef.id after undo
 * @param {(id: string) => void} onAfterRedo   Called with entityRef.id after redo (to switch active)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createDeleteCommand(entityRef, childrenRefs, sceneService, onAfterUndo, onAfterRedo) {
  return {
    label: `Delete "${entityRef.name}"`,

    execute() {
      // Redo: soft-delete children (deepest first), then the entity.
      for (let i = childrenRefs.length - 1; i >= 0; i--) {
        sceneService.detachObject(childrenRefs[i].id)
        // Frames are invisible by default — no explicit hide needed.
      }
      sceneService.detachObject(entityRef.id)
      entityRef.meshView.setVisible(false)
      onAfterRedo(entityRef.id)
    },

    undo() {
      // Restore entity first so getChildren() queries work if needed.
      sceneService.reattachObject(entityRef)
      if (!(entityRef instanceof CoordinateFrame)) {
        entityRef.meshView.setVisible(true)
        entityRef.meshView.updateGeometry(entityRef.corners)
        entityRef.meshView.updateBoxHelper()
      }
      // Restore children; frames stay invisible until parent-selection logic fires.
      for (const child of childrenRefs) {
        sceneService.reattachObject(child)
      }
      onAfterUndo(entityRef.id)
    },
  }
}
