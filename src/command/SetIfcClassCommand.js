/**
 * SetIfcClassCommand — records an IFC class assignment for undo/redo.
 * (ADR-022, ADR-025)
 *
 * @param {string}      id
 * @param {string|null} oldClass  IFC class name before the change (null = unclassified)
 * @param {string|null} newClass  IFC class name after the change  (null = clear)
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSetIfcClassCommand(id, oldClass, newClass, sceneService) {
  const oldLabel = oldClass ?? '(none)'
  const newLabel = newClass ?? '(none)'
  return {
    label: `Set IFC class "${oldLabel}" → "${newLabel}"`,
    execute() { sceneService.setIfcClass(id, newClass) },
    undo()    { sceneService.setIfcClass(id, oldClass) },
  }
}
