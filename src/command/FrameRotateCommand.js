import { CoordinateFrame } from '../domain/CoordinateFrame.js'

/**
 * FrameRotateCommand — records a CoordinateFrame R-key rotation for undo/redo.
 * (ADR-022 Phase 4)
 *
 * Stores start/end LOCAL quaternions (parent-frame relative, ROS TF style).
 * apply() sets frame.rotation (local) and lets _updateWorldPoses() recompute
 * the world quaternion for the meshView on the next animation frame.
 * The immediate meshView.updateRotation() call uses the world quaternion
 * derived from the parent's cached world rotation.
 *
 * @param {import('../domain/CoordinateFrame.js').CoordinateFrame} frameRef
 * @param {import('three').Quaternion} startQuat  Local rotation before the operation
 * @param {import('three').Quaternion} endQuat    Local rotation after the operation
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void} onApplied  Called after each apply (e.g. _updateNPanel)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createFrameRotateCommand(frameRef, startQuat, endQuat, sceneService, onApplied) {
  function apply(localQuat) {
    const obj = sceneService.scene.getObject(frameRef.id)
    if (!(obj instanceof CoordinateFrame)) return
    obj.rotation.copy(localQuat)
    // Compute world quaternion for immediate view update
    const parentWorldQuat = sceneService._getParentWorldQuat(obj)
    obj.meshView.updateRotation(parentWorldQuat.clone().multiply(localQuat))
    // Full world-pose pass ensures fastened constraints propagate immediately,
    // matching the SolidRotateCommand pattern (CODE_CONTRACTS §1).
    sceneService._updateWorldPoses()
    onApplied()
  }
  return {
    label: 'Rotate Frame',
    execute() { apply(endQuat) },
    undo()    { apply(startQuat) },
  }
}
