/**
 * MountAnnotationCommand — records the indivisible operation of mounting an
 * Annotated* entity onto a CoordinateFrame (ADR-032 Phase H-3).
 *
 * Mount = vertex coordinate transform (world → host-local) + SpatialLink creation.
 * These two sub-steps are always executed and undone together; they are never
 * independent. Hence a dedicated command rather than reusing CreateSpatialLinkCommand.
 *
 * Follows the post-hoc push() pattern (CODE_CONTRACTS §CommandStack push() vs execute()):
 * the mount operation happens first in AppController via service.mountAnnotation();
 * this command is then pushed so undo/redo can replay it.
 *
 * execute() (redo): re-applies the mount transform from worldPositionsBefore + current host pose.
 * undo():          restores worldPositionsBefore and removes the SpatialLink.
 *
 * @param {import('../domain/SpatialLink.js').SpatialLink}   link
 * @param {import('three').Vector3[]}                         worldPositionsBefore
 * @param {import('../service/SceneService.js').SceneService} service
 * @param {() => void}                                        onAfterUndo   — UI refresh callback
 * @param {() => void}                                        onAfterRedo   — UI refresh callback
 * @returns {{ label: string, execute(): void, undo(): void }}
 */
export function createMountAnnotationCommand(link, worldPositionsBefore, service, onAfterUndo, onAfterRedo) {
  return {
    label: `Mount on frame`,

    execute() {
      // Redo: re-apply the mount from the restored world positions
      service.remountAnnotation(link, worldPositionsBefore)
      onAfterRedo()
    },

    undo() {
      // Restores vertex world positions + removes the SpatialLink
      service.unmountAnnotation(link, worldPositionsBefore)
      onAfterUndo()
    },
  }
}
