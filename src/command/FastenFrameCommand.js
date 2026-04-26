/**
 * FastenFrameCommand — records the indivisible operation of fastening a
 * CoordinateFrame to another CoordinateFrame (ADR-032 §2, linkType 'fastened').
 *
 * Fasten = relative-transform computation + SpatialLink creation.
 * These two sub-steps are always executed and undone together.
 *
 * Follows the post-hoc push() pattern (CODE_CONTRACTS §CommandStack push() vs execute()):
 * the fasten operation happens first in AppController via service.fastenFrame();
 * this command is then pushed so undo/redo can replay it.
 *
 * execute() (redo): re-applies the constraint with the stored relative transform.
 * undo():          removes the constraint and restores the source CF's pre-bind
 *                  translation and rotation.
 *
 * @param {import('../domain/SpatialLink.js').SpatialLink} link
 * @param {import('three').Vector3}    translationBefore  source CF translation before bind
 * @param {import('three').Quaternion} rotationBefore     source CF rotation before bind
 * @param {import('three').Vector3}    relativeOffset     source offset in target's local frame
 * @param {import('three').Quaternion} relativeQuat       source rotation relative to target
 * @param {import('../service/SceneService.js').SceneService} service
 * @param {() => void} onAfterUndo
 * @param {() => void} onAfterRedo
 * @returns {{ label: string, execute(): void, undo(): void }}
 */
export function createFastenFrameCommand(
  link, translationBefore, rotationBefore, relativeOffset, relativeQuat,
  service, onAfterUndo, onAfterRedo,
) {
  return {
    label: 'Fasten frame',

    execute() {
      service.refastenFrame(link, relativeOffset, relativeQuat)
      onAfterRedo()
    },

    undo() {
      service.unfastenFrame(link, translationBefore, rotationBefore)
      onAfterUndo()
    },
  }
}
