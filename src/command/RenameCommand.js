/**
 * RenameCommand — records an object rename operation for undo/redo.
 * (ADR-022 Phase 4)
 *
 * @param {string} id
 * @param {string} oldName  Name before the rename
 * @param {string} newName  Name after the rename
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createRenameCommand(id, oldName, newName, sceneService) {
  return {
    label: `Rename "${oldName}" → "${newName}"`,
    execute() { sceneService.renameObject(id, newName) },
    undo()    { sceneService.renameObject(id, oldName) },
  }
}
