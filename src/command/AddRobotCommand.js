/**
 * AddRobotCommand — records adding a robot (base frame + tcp child) for undo/redo
 * (ADR-090 Decision 2).
 *
 * A robot is a PAIR of entities, so undo has to take both away and redo has to
 * restore them in TF order (base first — the tcp is its child and cannot be
 * reattached under a parent that is not in the scene yet). One command owns that
 * pairing, rather than two independent frame commands that the undo stack could
 * interleave into a half-robot.
 *
 * Follows the post-hoc push() pattern (CODE_CONTRACTS §CommandStack push() vs
 * execute()): `SceneService.addRobot()` runs first in the controller, then this
 * command is pushed so undo/redo can replay it.
 *
 * undo(): hides each frame's view then soft-detaches (CODE_CONTRACTS §Frame View
 * Must Be Hidden Before Detach). The skeleton view follows the roster on the next
 * frame (AppController._syncRobotStage → RobotStageSet.sync), so nothing here
 * touches THREE.
 *
 * @param {import('../domain/robotFrames.js').Robot} robot
 * @param {import('../service/SceneService.js').SceneService} service
 * @param {() => void} onAfterUndo   Called after undo to update AppController state.
 * @param {(id: string) => void} onAfterRedo  Called with the base frame id after redo.
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createAddRobotCommand(robot, service, onAfterUndo, onAfterRedo) {
  const base = robot.baseFrame
  const tcp  = robot.tcpFrame

  return {
    label: `Add Robot "${robot.label}"`,

    execute() {
      service.reattachObject(base)          // parent first (TF order)
      if (tcp) service.reattachObject(tcp)
      onAfterRedo(base.id)
    },

    undo() {
      // Child first, so the tcp is never left pointing at a detached parent.
      for (const frame of [tcp, base]) {
        if (!frame) continue
        frame.meshView?.hide?.()
        frame.meshView?.hideConnection?.()
        service.detachObject(frame.id)
      }
      onAfterUndo()
    },
  }
}
