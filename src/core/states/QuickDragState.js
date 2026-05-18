/**
 * Object Mode operation handler for direct mouse-drag on a selected object.
 * Covers both plain translate-drag and Ctrl+drag (in-plane rotation).
 *
 * Sub-states during drag (internal, not tracked by the outer FSM):
 *   DRAGGING   — normal drag; no suggestion active
 *   SUGGESTING — a SpatialLink suggestion is live (ghost link + tooltip visible)
 *
 * The sub-state transitions are pure data: _isSuggesting / _currentSuggestion.
 * All side effects (ghost link, tooltip) are delegated to ctx methods so this
 * class stays dependency-free.
 *
 * Lifecycle:
 *   enter()       — pointerdown on object; disables OrbitControls and sets cursor
 *   onPointerMove — pointermove; moves object via ctx.applyMove, runs inference
 *   onKeyDown     — Enter accepts a live suggestion; returns true if key consumed
 *   confirm()     — pointerup; re-enables controls and finalises via ctx.finish
 *   cancel()      — mode exit; re-enables controls
 *
 * Called by AppController when _opState is S_QUICK_DRAG.
 * All drag-plane and snapshot state stays on AppController; this class is a thin
 * lifecycle coordinator that enforces the FSM boundary.
 *
 * ctx shape:
 *   controls, uiView
 *   applyMove(e)
 *   finish()
 *   runInference()                     → Suggestion | null
 *   showDragSuggestion(suggestion)     — create ghost link + tooltip
 *   updateDragSuggestion(suggestion)   — reposition ghost link each frame
 *   hideDragSuggestion()               — dispose ghost link + tooltip
 *   acceptSuggestion(suggestion)       — confirm drag + create SpatialLink
 */
export class QuickDragState {
  /** @param {object} ctx */
  enter(ctx) {
    ctx.controls.enabled = false
    ctx.uiView.setCursor('grabbing')
    this._isSuggesting      = false
    this._currentSuggestion = null
  }

  /** @param {object} ctx  @param {PointerEvent} e */
  onPointerMove(ctx, e) {
    ctx.applyMove(e)

    const suggestion = ctx.runInference()

    if (suggestion) {
      const key     = `${suggestion.semanticType}|${suggestion.targetId}`
      const prevKey = this._currentSuggestion
        ? `${this._currentSuggestion.semanticType}|${this._currentSuggestion.targetId}`
        : null

      if (!this._isSuggesting || key !== prevKey) {
        // 【遷移: DRAGGING → SUGGESTING】新しい推論が見つかった
        this._isSuggesting      = true
        this._currentSuggestion = suggestion
        ctx.showDragSuggestion(suggestion)
      } else {
        // SUGGESTING 継続: ゴーストリンクの位置を毎フレーム更新
        ctx.updateDragSuggestion(suggestion)
      }
    } else if (this._isSuggesting) {
      // 【遷移: SUGGESTING → DRAGGING】条件から外れた
      this._isSuggesting      = false
      this._currentSuggestion = null
      ctx.hideDragSuggestion()
    }
  }

  /**
   * Handles keydown during the drag.
   * @param {object}    ctx
   * @param {KeyboardEvent} e
   * @returns {boolean} true if the key was consumed
   */
  onKeyDown(ctx, e) {
    if (this._isSuggesting && e.key === 'Enter') {
      e.preventDefault()
      const suggestion        = this._currentSuggestion
      this._isSuggesting      = false
      this._currentSuggestion = null
      ctx.hideDragSuggestion()        // ゴースト消去してから確定
      ctx.acceptSuggestion(suggestion)
      return true
    }
    return false
  }

  /** @param {object} ctx */
  confirm(ctx) {
    this._clearSuggestion(ctx)
    ctx.controls.enabled = true
    ctx.finish()
  }

  /** @param {object} ctx */
  cancel(ctx) {
    this._clearSuggestion(ctx)
    ctx.controls.enabled = true
    ctx.uiView.setCursor('default')
  }

  /** Cleans up suggestion state if active. Safe to call when not suggesting. */
  _clearSuggestion(ctx) {
    if (this._isSuggesting) {
      this._isSuggesting      = false
      this._currentSuggestion = null
      ctx.hideDragSuggestion()
    }
  }
}
