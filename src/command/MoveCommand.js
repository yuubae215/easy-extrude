/**
 * Factory for a MoveCommand — records a completed Grab operation for undo/redo.
 * (ADR-022 Phase 1; extended in Phase 4 to cover all entity types)
 *
 * Handles Solid, Profile, CoordinateFrame, MeasureLine, and ImportedMesh.
 * For CoordinateFrame, sceneService.invalidateWorldPose() is called after each
 * apply so the animation loop recomputes the world-pose cache entry.
 *
 * @param {string} label  Human-readable label, e.g. "Move" or "Move 3 objects"
 * @param {Map<string, import('three').Vector3[]>} startCornersMap  Corners before the grab
 * @param {Map<string, import('three').Vector3[]>} endCornersMap    Corners after the grab
 * @param {import('../model/SceneModel.js').SceneModel} sceneModel
 * @param {import('../service/SceneService.js').SceneService} [sceneService]
 *   Required for CoordinateFrame world-pose cache invalidation; optional otherwise.
 * @returns {{label: string, execute(): void, undo(): void}}
 */
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { Solid }           from '../domain/Solid.js'

export function createMoveCommand(label, startCornersMap, endCornersMap, sceneModel, sceneService = null) {
  function apply(cornersMap) {
    for (const [id, corners] of cornersMap) {
      const obj = sceneModel.getObject(id)
      if (!obj) continue
      if (obj instanceof CoordinateFrame) {
        // CoordinateFrame exposes localOffset (LocalVector3[]); no corners (PHILOSOPHY #21 Phase 3).
        obj.localOffset.forEach((c, i) => c.copy(corners[i]))
        obj.meshView.updateGeometry(obj.localOffset)
      } else if (obj instanceof Solid) {
        // Solid: decompose world-corner snapshot back into _position + localCorners (ADR-040).
        // Keeps the primary triple consistent — direct corner copy would leave _position stale.
        obj.setWorldCorners(corners)
        obj.meshView.updateGeometry(obj.corners)
      } else {
        obj.corners.forEach((c, i) => c.copy(corners[i]))
        obj.meshView.updateGeometry(obj.corners)
      }
      obj.meshView.updateBoxHelper()
      if (sceneService) {
        sceneService.invalidateWorldPose(id)
        // ADR-032: keep _mountLocalPositions consistent after any direct position write
        sceneService.syncMountedPosition(id)
      }
    }
  }

  return {
    label,
    execute() { apply(endCornersMap) },
    undo()    { apply(startCornersMap) },
  }
}
