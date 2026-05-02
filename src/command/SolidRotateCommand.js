import { Solid } from '../domain/Solid.js'

/**
 * SolidRotateCommand — records an R-key Solid rotation for undo/redo.
 * (ADR-036, ADR-022)
 *
 * Stores start/end corners and swaps them on execute/undo, identical to the
 * MoveCommand pattern.  The rotation itself is baked into the corner positions.
 *
 * @param {import('../domain/Solid.js').Solid} solidRef
 * @param {import('three').Vector3[]} startCorners  Corner snapshot before rotation
 * @param {import('three').Vector3[]} endCorners    Corner snapshot after rotation
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void} onApplied  Called after each apply (e.g. _updateNPanel)
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createSolidRotateCommand(solidRef, startCorners, endCorners, sceneService, onApplied) {
  function apply(corners) {
    const obj = sceneService.scene.getObject(solidRef.id)
    if (!(obj instanceof Solid)) return
    obj.corners.forEach((c, i) => c.copy(corners[i]))
    obj.meshView.updateGeometry(obj.corners)
    obj.meshView.updateBoxHelper()
    sceneService.syncMountedPosition(solidRef.id)
    onApplied()
  }
  return {
    label: 'Rotate Solid',
    execute() { apply(endCorners) },
    undo()    { apply(startCorners) },
  }
}
