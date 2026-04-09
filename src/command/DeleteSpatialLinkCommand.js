/**
 * DeleteSpatialLinkCommand — records the deletion of a SpatialLink for undo/redo.
 * (ADR-030)
 *
 * SpatialLink has no meshView or GPU resources, so undo/redo uses a simple
 * detach/reattach pattern without any visibility manipulation.
 *
 * Usage (AppController):
 *   const link = sceneService.scene.getLink(linkId)
 *   sceneService.detachSpatialLink(linkId)
 *   _commandStack.push(createDeleteSpatialLinkCommand(link, sceneService))
 *
 * undo(): reattaches the link (emits 'spatialLinkAdded').
 * execute() (redo): detaches the link (emits 'spatialLinkRemoved').
 *
 * @param {import('../domain/SpatialLink.js').SpatialLink} linkRef
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createDeleteSpatialLinkCommand(linkRef, sceneService) {
  return {
    label: `Delete link "${linkRef.linkType}" (${linkRef.sourceId} → ${linkRef.targetId})`,

    execute() {
      sceneService.detachSpatialLink(linkRef.id)
    },

    undo() {
      sceneService.reattachSpatialLink(linkRef)
    },
  }
}
