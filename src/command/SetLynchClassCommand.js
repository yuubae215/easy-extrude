/**
 * SetLynchClassCommand — records a Lynch class assignment for undo/redo.
 *
 * Mirrors SetIfcClassCommand (ADR-025) for urban 2D entities.
 * Applies to UrbanPolyline, UrbanPolygon, and UrbanMarker.
 *
 * @see ADR-026, ADR-022
 *
 * @param {string}      id
 * @param {string|null} oldClass  Lynch class name before the change (null = unclassified)
 * @param {string|null} newClass  Lynch class name after the change  (null = clear)
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSetLynchClassCommand(id, oldClass, newClass, sceneService) {
  const oldLabel = oldClass ?? '(none)'
  const newLabel = newClass ?? '(none)'
  return {
    label: `Set Lynch class "${oldLabel}" → "${newLabel}"`,
    execute() { sceneService.setLynchClass(id, newClass) },
    undo()    { sceneService.setLynchClass(id, oldClass) },
  }
}
