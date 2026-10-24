/**
 * ArrangementController — puts the declared relations on screen (ADR-168 S1b).
 *
 * Two inputs, one output each way:
 *
 *   document edge (`contextLoaded` / `contextChanged`) → `refresh()` re-reads the
 *       relations against the layout (`ContextService.arrangementReport`)
 *   selection (SelectionManager step 8, via AppController) → `setFocus(refs)`
 *
 *   → the Relations section's model (`context.arrangements` — sole writer)
 *   → the 3D picture (`ArrangementStatusView` — sole owner)
 *
 * Holds no logic of its own: which relations a focus brings, what each word
 * draws and how a status is toned are all `view/ArrangementStatusMath.js`; the
 * statuses themselves are the domain's (原則 #3). The view is built on first
 * use through an injected factory, so this controller runs THREE-free in tests.
 *
 * @module controller/ArrangementController
 */
import { arrangementPanel, arrangementPicture } from '../view/ArrangementStatusMath.js'

export class ArrangementController {
  /**
   * @param {{
   *   ctxService: {arrangementReport: () => object|null, on: Function},
   *   store: {getState: () => any},
   *   createView: () => {show: (pic: object|null) => void, dispose: () => void},
   * }} deps
   */
  constructor({ ctxService, store, createView }) {
    this._ctx = ctxService
    this._store = store
    this._createView = createView
    /** @type {object|null} the last report — null = no document */
    this._result = null
    /** @type {readonly string[]} the selected things' layout refs, sorted ([] = none) */
    this._focus = []
    /** @type {{show: Function, dispose: Function}|null} */
    this._view = null
    /** @type {object|null} the picture last handed to the view (read by `snapshot`) */
    this._picture = null
    ctxService.on('contextLoaded',  () => this.refresh())
    ctxService.on('contextChanged', () => this.refresh())
  }

  /** Re-read the relations from the document (the document edge). */
  refresh() {
    this._result = this._ctx.arrangementReport()
    this._render()
  }

  /**
   * The things the panel and the picture are about, by layout ref — every
   * selected thing the document declares (N selected = the union; [] = none).
   * A ref survives re-projection, so the focus does too.
   * @param {Iterable<string|null>} refs
   */
  setFocus(refs) {
    const next = [...new Set([...(refs ?? [])].filter(r => r != null))].sort()
    if (next.length === this._focus.length && next.every((r, i) => r === this._focus[i])) return
    this._focus = Object.freeze(next)
    this._render()
  }

  _render() {
    this._store.getState().actions.contextSetArrangements(arrangementPanel(this._result, this._focus))
    const pic = arrangementPicture(this._result, this._focus)
    this._picture = pic
    if (!pic && !this._view) return
    this._view ??= this._createView()
    this._view.show(pic)
  }

  /**
   * Read-only: what the section and the viewport are showing — the e2e reads
   * the picture here rather than from pixels (the grasp declaration precedent).
   */
  snapshot() {
    return { focusRefs: this._focus, model: this._store.getState().context?.arrangements ?? null, picture: this._picture }
  }

  dispose() {
    this._view?.dispose()
    this._view = null
  }
}
