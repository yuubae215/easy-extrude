/**
 * AddSolidCommand — records the creation of a new Solid for undo/redo.
 * (ADR-022 Phase 3)
 *
 * undo(): soft-detaches the Solid and all its descendant frames without disposing.
 * execute() (redo): re-attaches them; Solid mesh is shown, frames stay
 *   invisible until the parent is selected (parent-gated visibility is
 *   managed by AppController._setChildFramesVisible).
 *
 * @param {import('../domain/Solid.js').Solid}  solidRef
 * @param {object[]}  childrenRefs  All descendant entities (CoordinateFrames) in
 *   topological order (shallow-first) as returned by _collectAllDescendantFrames.
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void}          onAfterUndo   Called after undo to update AppController state
 * @param {(id: string) => void} onAfterRedo   Called with solidRef.id after redo
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createAddSolidCommand(solidRef, childrenRefs, sceneService, onAfterUndo, onAfterRedo) {
  return {
    label: `Add "${solidRef.name}"`,

    execute() {
      // Redo: restore Solid and all descendant frames.
      sceneService.reattachObject(solidRef)
      solidRef.meshView.setVisible(true)
      solidRef.meshView.updateGeometry(solidRef.corners)
      solidRef.meshView.updateBoxHelper()
      for (const child of childrenRefs) {
        sceneService.reattachObject(child)
        // CoordinateFrames stay invisible by default;
        // parent-gated visibility is applied when the user selects the Solid.
      }
      onAfterRedo(solidRef.id)
    },

    undo() {
      // Undo: soft-delete children first (deepest last doesn't matter here since
      // frames have no further children in typical scenes, but reverse order is
      // correct for nested frame chains).
      for (let i = childrenRefs.length - 1; i >= 0; i--) {
        // Hide explicitly: the frame may be visible if its parent was selected
        // (showGeometryFrameTree makes it visible). After detachObject the
        // scene model no longer holds the frame, so _hideFrameChain's
        // getObject() check would skip it — we must hide before detaching.
        childrenRefs[i].meshView.hide()
        childrenRefs[i].meshView.hideConnection()
        sceneService.detachObject(childrenRefs[i].id)
      }
      sceneService.detachObject(solidRef.id)
      solidRef.meshView.setVisible(false)
      onAfterUndo()
    },
  }
}
