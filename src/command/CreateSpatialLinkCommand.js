/**
 * CreateSpatialLinkCommand — records the creation of a SpatialLink for undo/redo.
 * (ADR-030)
 *
 * SpatialLink has no meshView or GPU resources, so undo/redo uses a simple
 * detach/reattach pattern without any visibility manipulation.
 *
 * Usage (AppController):
 *   const link = sceneService.createSpatialLink(sourceId, targetId, linkType)
 *   _commandStack.push(createSpatialLinkCommand(link, sceneService))
 *
 * undo(): detaches the link from the model (emits 'spatialLinkRemoved').
 * execute() (redo): reattaches the link (emits 'spatialLinkAdded').
 *
 * @param {import('../domain/SpatialLink.js').SpatialLink} linkRef
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSpatialLinkCommand(linkRef, sceneService) {
  return {
    label: `Link "${linkRef.linkType}" (${linkRef.sourceId} → ${linkRef.targetId})`,

    execute() {
      sceneService.reattachSpatialLink(linkRef)
    },

    undo() {
      sceneService.detachSpatialLink(linkRef.id)
    },
  }
}
