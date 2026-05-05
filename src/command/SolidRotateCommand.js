import { Solid } from '../domain/Solid.js'

/**
 * SolidRotateCommand — records an R-key Solid rotation for undo/redo.
 * (ADR-036, ADR-022)
 *
 * Stores start/end corners and bodyRotation, swapping them on execute/undo.
 * Child CoordinateFrames express their translation/rotation in the Solid's
 * local frame (ROS TF style), so they follow automatically when bodyRotation
 * is restored — no separate CF pose snapshots needed.
 *
 * @param {import('../domain/Solid.js').Solid} solidRef
 * @param {import('three').Vector3[]} startCorners    Corner snapshot before rotation
 * @param {import('three').Vector3[]} endCorners      Corner snapshot after rotation
 * @param {import('three').Quaternion} startBodyRot   bodyRotation before rotation
 * @param {import('three').Quaternion} endBodyRot     bodyRotation after rotation
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void} onApplied  Called after each apply (e.g. _updateNPanel)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSolidRotateCommand(solidRef, startCorners, endCorners, startBodyRot, endBodyRot, sceneService, onApplied) {
  function apply(corners, bodyRot) {
    const obj = sceneService.scene.getObject(solidRef.id)
    if (!(obj instanceof Solid)) return
    obj.corners.forEach((c, i) => c.copy(corners[i]))
    obj.bodyRotation.copy(bodyRot)
    obj.meshView.updateGeometry(obj.corners)
    obj.meshView.updateBoxHelper()
    // Refresh all CF world poses immediately so the viewport is consistent
    sceneService._updateWorldPoses()
    sceneService.syncMountedPosition(solidRef.id)
    onApplied()
  }
  return {
    label: 'Rotate Solid',
    execute() { apply(endCorners, endBodyRot) },
    undo()    { apply(startCorners, startBodyRot) },
  }
}
