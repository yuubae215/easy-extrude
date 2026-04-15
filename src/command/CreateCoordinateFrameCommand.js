/**
 * CreateCoordinateFrameCommand — records the explicit creation of a CoordinateFrame
 * for undo/redo. (ADR-033 Phase C-2)
 *
 * CoordinateFrame is created only with explicit user intent (interface contract).
 * This command follows the post-hoc push() pattern (CODE_CONTRACTS §CommandStack push() vs execute()):
 * the service call happens first in the controller; this command is then pushed
 * to the stack so undo/redo can replay it.
 *
 * Usage (AppController):
 *   const frame = this._service.createCoordinateFrame(parentId, name)
 *   this._commandStack.push(createCreateCoordinateFrameCommand(frame, this._service, onUndo, onRedo))
 *
 * undo(): hides the frame view then soft-detaches (CODE_CONTRACTS §Frame View Must Be Hidden Before Detach).
 * execute() (redo): reattaches the frame.
 *
 * @param {import('../domain/CoordinateFrame.js').CoordinateFrame} frameRef
 * @param {import('../service/SceneService.js').SceneService} service
 * @param {() => void} onAfterUndo  Called after undo to update AppController state.
 * @param {(id: string) => void} onAfterRedo  Called with frameRef.id after redo.
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createCreateCoordinateFrameCommand(frameRef, service, onAfterUndo, onAfterRedo) {
  return {
    label: `Add Frame "${frameRef.name}"`,

    execute() {
      service.reattachObject(frameRef)
      onAfterRedo(frameRef.id)
    },

    undo() {
      // Must hide before detach (CODE_CONTRACTS §Frame View Must Be Hidden Before Detach)
      frameRef.meshView.hide()
      frameRef.meshView.hideConnection()
      service.detachObject(frameRef.id)
      onAfterUndo()
    },
  }
}
