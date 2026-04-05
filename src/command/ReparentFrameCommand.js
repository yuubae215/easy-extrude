/**
 * ReparentFrameCommand — records a CoordinateFrame re-parent operation for undo/redo.
 * (ADR-028)
 *
 * Captures the old parentId AND the old translation at command-creation time so
 * undo() can restore the exact prior state (same parent, same local offset)
 * regardless of any moves that occurred after the re-parent.
 *
 * @param {string} frameId
 * @param {string} newParentId
 * @param {import('../service/SceneService.js').SceneService} service
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createReparentFrameCommand(frameId, newParentId, service) {
  const frame          = service.scene.getObject(frameId)
  const oldParentId    = frame.parentId
  const oldTranslation = frame.translation.clone()
  return {
    label: `Re-parent "${frame.name}"`,
    execute() { service.reparentFrame(frameId, newParentId) },
    undo()    { service.reparentFrame(frameId, oldParentId, oldTranslation) },
  }
}
