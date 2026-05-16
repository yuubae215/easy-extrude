/**
 * Edit Mode operation handler for 2D sketch rectangle drawing (Profile Edit Mode).
 *
 * Lifecycle matches the three-phase contract from ADR-039:
 *
 *   enter()       — pointerdown on ground plane; records p1/p2 start point
 *   onPointerMove — pointermove; updates p2 and sketch rect preview
 *   confirm()     — pointerup; calls obj.setRect() if rect is large enough,
 *                   leaves p1/p2 intact for _enterExtrudePhase
 *   cancel()      — mode exit / cleanup; clears p1/p2
 *
 * Called by AppController when _editOpState is EO_2D_SKETCH_DRAW.
 *
 * ctx shape (superset of _editCtx):
 *   obj, camera, mouse, raycaster, controls, groundPlane, sketch, meshView, uiView,
 *   onMobileToolbarUpdate
 */
import * as THREE from 'three'

export class SketchDrawState {
  /**
   * @param {object} ctx
   * @returns {boolean} false if the ground plane was not hit (enter should be aborted)
   */
  enter(ctx) {
    const { mouse, raycaster, camera, groundPlane, controls, sketch } = ctx
    raycaster.setFromCamera(mouse, camera)
    const pt = new THREE.Vector3()
    if (!raycaster.ray.intersectPlane(groundPlane, pt)) return false
    sketch.p1      = pt.clone()
    sketch.p2      = pt.clone()
    controls.enabled = false
    return true
  }

  /** @param {object} ctx */
  onPointerMove(ctx) {
    const { mouse, raycaster, camera, groundPlane, sketch, meshView } = ctx
    raycaster.setFromCamera(mouse, camera)
    const pt = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(groundPlane, pt)) {
      sketch.p2 = pt.clone()
      meshView.showSketchRect(sketch.p1, sketch.p2)
    }
  }

  /**
   * Finalises the sketch rect on the domain object if large enough.
   * Leaves sketch.p1 / sketch.p2 populated so _enterExtrudePhase can use them.
   * @param {object} ctx
   */
  confirm(ctx) {
    const { obj, controls, uiView, sketch, onMobileToolbarUpdate } = ctx
    controls.enabled = true
    if (!sketch.p1 || !sketch.p2) return
    const dx = Math.abs(sketch.p2.x - sketch.p1.x)
    const dy = Math.abs(sketch.p2.y - sketch.p1.y)
    if (dx > 0.01 || dy > 0.01) {
      obj.setRect(sketch.p1, sketch.p2)
      uiView.setStatusRich([
        { text: 'Sketch', bold: true, color: '#4fc3f7' },
        { text: 'Press Enter to extrude · Drag to redraw', color: '#888' },
      ])
      onMobileToolbarUpdate()
    }
  }

  /** @param {object} ctx */
  cancel(ctx) {
    const { controls, sketch } = ctx
    controls.enabled = true
    sketch.p1 = null
    sketch.p2 = null
  }
}
