import { Solid } from '../domain/Solid.js'

/**
 * SolidRotateCommand — records an R-key or TC-gizmo Solid rotation for undo/redo.
 * (ADR-040, ADR-022; supersedes ADR-036 corner-snapshot approach)
 *
 * Stores start/end orientation (Quaternion) and _position (Vector3).
 * World corners are derived via _rebuildWorldCorners() — no corner snapshots needed.
 * Child CoordinateFrames follow automatically via ROS TF forward kinematics
 * when orientation is restored — no CF pose snapshots needed.
 *
 * @param {import('../domain/Solid.js').Solid} solidRef
 * @param {import('three').Quaternion} startOrientation  orientation before rotation
 * @param {import('three').Quaternion} endOrientation    orientation after rotation
 * @param {import('three').Vector3}   startPosition     _position before rotation
 * @param {import('three').Vector3}   endPosition       _position after rotation
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void} onApplied  Called after each apply (e.g. _updateNPanel)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSolidRotateCommand(solidRef, startOrientation, endOrientation, startPosition, endPosition, sceneService, onApplied) {
  function apply(orientation, position) {
    const obj = sceneService.scene.getObject(solidRef.id)
    if (!(obj instanceof Solid)) return
    obj.orientation.copy(orientation)
    obj._position.copy(position)
    obj._rebuildWorldCorners()
    obj.meshView.updateGeometry(obj.corners)
    obj.meshView.updateBoxHelper()
    // Refresh all CF world poses immediately so the viewport is consistent
    sceneService._updateWorldPoses()
    sceneService.syncMountedPosition(solidRef.id)
    onApplied()
  }
  return {
    label: 'Rotate Solid',
    execute() { apply(endOrientation, endPosition) },
    undo()    { apply(startOrientation, startPosition) },
  }
}
