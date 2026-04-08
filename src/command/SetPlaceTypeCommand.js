/**
 * SetPlaceTypeCommand — records a place-type assignment for undo/redo.
 *
 * Mirrors SetIfcClassCommand (ADR-025) for annotated 2D entities.
 * Applies to AnnotatedLine, AnnotatedRegion, and AnnotatedPoint.
 *
 * @see ADR-029, ADR-022
 *
 * @param {string}      id
 * @param {string|null} oldType  place type before the change (null = unclassified)
 * @param {string|null} newType  place type after the change  (null = clear)
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSetPlaceTypeCommand(id, oldType, newType, sceneService) {
  const oldLabel = oldType ?? '(none)'
  const newLabel = newType ?? '(none)'
  return {
    label: `Set place type "${oldLabel}" → "${newLabel}"`,
    execute() { sceneService.setPlaceType(id, newType) },
    undo()    { sceneService.setPlaceType(id, oldType) },
  }
}
