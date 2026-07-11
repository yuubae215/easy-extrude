/**
 * AddProfileCommand — records the creation of a new Profile (Sketch) for undo/redo.
 *
 * A Profile is not a Solid (PHILOSOPHY #2 — Type Is the Capability Contract):
 * it has no cuboid mesh until extruded, only the optional sketch-rect outline,
 * so AddSolidCommand's redo path (updateGeometry + updateBoxHelper on 8 corners)
 * does not apply. Profiles also never carry child CoordinateFrames (transient
 * entity, ADR-020) — no childrenRefs parameter.
 *
 * undo(): soft-detaches the Profile without disposing (Soft-Delete Pattern).
 * execute() (redo): re-attaches it; the sketch outline is restored only when
 *   the rectangle was already drawn.
 *
 * @param {import('../domain/Profile.js').Profile} profileRef
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {() => void}           onAfterUndo  Called after undo to update AppController state
 * @param {(id: string) => void} onAfterRedo  Called with profileRef.id after redo
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createAddProfileCommand(profileRef, sceneService, onAfterUndo, onAfterRedo) {
  return {
    label: `Add "${profileRef.name}"`,

    execute() {
      // Redo: restore the Profile. The cuboid mesh stays hidden (no geometry
      // until extrude); only the drawn rect outline is re-shown, if any.
      sceneService.reattachObject(profileRef)
      const rect = profileRef.sketchRect
      if (rect) profileRef.meshView.showSketchRect(rect.p1, rect.p2)
      onAfterRedo(profileRef.id)
    },

    undo() {
      profileRef.meshView.clearSketchRect()
      profileRef.meshView.setVisible(false)
      sceneService.detachObject(profileRef.id)
      onAfterUndo()
    },
  }
}
