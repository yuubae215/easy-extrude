/**
 * AddAnnotationCommand — records the creation of a map-placed annotated
 * entity (AnnotatedLine / AnnotatedRegion / AnnotatedPoint) for undo/redo
 * (ADR-072 decision 2).
 *
 * Map placement was the ONE entity-add path bypassing the CommandStack; this
 * command closes that asymmetry with the soft-delete pattern (detach + hide,
 * never dispose — PHILOSOPHY #10). Annotated entities have no descendant
 * frames, so no children traversal is needed (unlike AddSolidCommand).
 * `placeType` lives on the entity ref and survives detach/reattach, so one
 * gesture stays one undo step.
 *
 * The label deliberately joins the existing `Add "…"` lifecycle vocabulary
 * (CommandFeedbackMath `/^Add "/`): materialize on push/redo and dissolve on
 * undo fire with ZERO presentation-layer changes — the parity comes from the
 * single label vocabulary, not new code (核 §1.1).
 *
 * @param {object} entityRef  the created annotated domain entity
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {(() => void)|null} [onAfterUndo]  called after undo so the
 *   controller can clear a stale selection of the vanished entity
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createAddAnnotationCommand(entityRef, sceneService, onAfterUndo = null) {
  return {
    label: `Add "${entityRef.name}"`,

    execute() {
      // Redo: re-insert and show. Geometry is unchanged while detached
      // (pose ops are impossible on a detached entity).
      sceneService.reattachObject(entityRef)
      entityRef.meshView.setVisible(true)
    },

    undo() {
      sceneService.detachObject(entityRef.id)
      entityRef.meshView.setVisible(false)
      onAfterUndo?.()
    },
  }
}
