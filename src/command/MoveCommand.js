import { Solid }   from '../domain/Solid.js'
import { Profile } from '../domain/Profile.js'

/**
 * Factory for a MoveCommand — records a completed Grab operation for undo/redo.
 *
 * Only `Solid` and `Profile` entities are handled in Phase 1.
 * CoordinateFrame / MeasureLine / ImportedMesh are deferred to Phase 4 (ADR-022).
 *
 * @param {string} label  Human-readable label, e.g. "Move" or "Move 3 objects"
 * @param {Map<string, import('three').Vector3[]>} startCornersMap  Corners before the grab
 * @param {Map<string, import('three').Vector3[]>} endCornersMap    Corners after the grab
 * @param {import('../model/SceneModel.js').SceneModel} sceneModel
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createMoveCommand(label, startCornersMap, endCornersMap, sceneModel) {
  function apply(cornersMap) {
    for (const [id, corners] of cornersMap) {
      const obj = sceneModel.getObject(id)
      if (!obj) continue
      if (!(obj instanceof Solid) && !(obj instanceof Profile)) continue
      obj.corners.forEach((c, i) => c.copy(corners[i]))
      obj.meshView.updateGeometry(obj.corners)
      obj.meshView.updateBoxHelper()
    }
  }

  return {
    label,
    execute() { apply(endCornersMap) },
    undo()    { apply(startCornersMap) },
  }
}
