/**
 * Object Mode operation handler for rubber-band rectangle selection.
 *
 * Lifecycle:
 *   enter()       — pointerdown on empty space; records start pixel position
 *   onPointerMove — pointermove; updates current pixel and refreshes overlay
 *   confirm()     — pointerup; hides overlay and finalises selection
 *   cancel()      — second finger on touch / mode exit; hides overlay and aborts
 *
 * Called by AppController when _opState is S_RECT_SELECT.
 * The rectSel data object and the overlay element remain on AppController;
 * this class drives the lifecycle via ctx callbacks.
 *
 * ctx shape:
 *   controls, rectSel, rectSelEl, updateDisplay(), finalize()
 */
export class RectSelectState {
  /** @param {object} ctx  @param {PointerEvent} e */
  enter(ctx, e) {
    ctx.rectSel.startPx   = { x: e.clientX, y: e.clientY }
    ctx.rectSel.currentPx = { x: e.clientX, y: e.clientY }
  }

  /** @param {object} ctx  @param {PointerEvent} e */
  onPointerMove(ctx, e) {
    ctx.rectSel.currentPx = { x: e.clientX, y: e.clientY }
    ctx.updateDisplay()
  }

  /** @param {object} ctx */
  confirm(ctx) {
    ctx.rectSelEl.style.display = 'none'
    ctx.controls.enabled        = true
    ctx.finalize()
  }

  /** @param {object} ctx */
  cancel(ctx) {
    ctx.rectSelEl.style.display = 'none'
    ctx.controls.enabled        = true
  }
}
