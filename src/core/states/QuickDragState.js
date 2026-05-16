/**
 * Object Mode operation handler for direct mouse-drag on a selected object.
 * Covers both plain translate-drag and Ctrl+drag (in-plane rotation).
 *
 * Lifecycle:
 *   enter()       — pointerdown on object; disables OrbitControls and sets cursor
 *   onPointerMove — pointermove; delegates move/rotate computation to ctx.applyMove
 *   confirm()     — pointerup; re-enables controls and finalises via ctx.finish
 *   cancel()      — mode exit; re-enables controls
 *
 * Called by AppController when _opState is S_QUICK_DRAG.
 * All drag-plane and snapshot state stays on AppController; this class is a thin
 * lifecycle coordinator that enforces the FSM boundary.
 *
 * ctx shape:
 *   controls, uiView, applyMove(e), finish()
 */
export class QuickDragState {
  /** @param {object} ctx */
  enter(ctx) {
    ctx.controls.enabled = false
    ctx.uiView.setCursor('grabbing')
  }

  /** @param {object} ctx  @param {PointerEvent} e */
  onPointerMove(ctx, e) {
    ctx.applyMove(e)
  }

  /** @param {object} ctx */
  confirm(ctx) {
    ctx.controls.enabled = true
    ctx.finish()
  }

  /** @param {object} ctx */
  cancel(ctx) {
    ctx.controls.enabled = true
    ctx.uiView.setCursor('default')
  }
}
