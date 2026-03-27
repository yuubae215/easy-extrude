/**
 * ExtrudeSketchCommand — records a Profile→Solid extrude operation for undo/redo.
 * (ADR-022 Phase 2)
 *
 * The Profile and Solid share the same id, name, and MeshView (ADR-012 entity-swap contract).
 * Undo swaps the Solid back to the Profile in the model and hides the 3D mesh.
 * Redo re-extrudes the Profile to produce a new Solid with the same geometry.
 *
 * @param {import('../domain/Profile.js').Profile}  profileRef  Profile before extrude
 * @param {number}  height   Extrusion height (signed)
 * @param {import('../service/SceneService.js').SceneService} sceneService
 * @param {(id: string) => void} onActivate  Callback to update AppController active state after swap
 * @returns {{label: string, execute(): void, undo(): void}}
 */
export function createExtrudeSketchCommand(profileRef, height, sceneService, onActivate) {
  return {
    label: 'Extrude',

    execute() {
      // Redo: Profile → Solid.
      // Profile must be in the model at this point (restored by a previous undo).
      const solid = sceneService.extrudeProfile(profileRef.id, height)
      if (!solid) return
      solid.meshView.updateGeometry(solid.corners)
      solid.meshView.setVisible(true)
      solid.meshView.clearSketchRect()
      onActivate(profileRef.id)
    },

    undo() {
      // Undo: Solid → Profile.
      // Delete auto-created Origin frame (created by extrudeProfile / execute).
      const children = sceneService.scene.getChildren(profileRef.id)
      const originFrame = children.find(o => o.name === 'Origin')
      if (originFrame) sceneService.deleteObject(originFrame.id)

      // Detach Solid without disposing (MeshView is shared with Profile).
      sceneService.detachObject(profileRef.id)

      // Restore Profile.
      sceneService.reattachObject(profileRef)

      // Hide the 3D mesh — Profile has no volume in Object mode.
      profileRef.meshView.setVisible(false)

      onActivate(profileRef.id)
    },
  }
}
