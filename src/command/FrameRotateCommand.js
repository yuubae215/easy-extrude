import { CoordinateFrame } from '../domain/CoordinateFrame.js'

/**
 * FrameRotateCommand — records a CoordinateFrame R-key rotation for undo/redo.
 * (ADR-022 Phase 4)
 *
 * Both execute() and undo() update frame.rotation and refresh the meshView and
 * N panel via the onApplied callback so the UI stays in sync.
 *
 * @param {import('../domain/CoordinateFrame.js').CoordinateFrame} frameRef
 * @param {import('three').Quaternion} startQuat  Rotation before the operation
 * @param {import('three').Quaternion} endQuat    Rotation after the operation
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void} onApplied  Called after each apply (e.g. _updateNPanel)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createFrameRotateCommand(frameRef, startQuat, endQuat, sceneService, onApplied) {
  function apply(quat) {
    const obj = sceneService.scene.getObject(frameRef.id)
    if (!(obj instanceof CoordinateFrame)) return
    obj.rotation.copy(quat)
    obj.meshView.updateRotation(obj.rotation)
    sceneService.invalidateWorldPose(obj.id)
    onApplied()
  }
  return {
    label: 'Rotate Frame',
    execute() { apply(endQuat) },
    undo()    { apply(startQuat) },
  }
}
