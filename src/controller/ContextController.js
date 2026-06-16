// @ts-nocheck
/**
 * ContextController — production Context-first overlay coordinator (ADR-050 §4).
 *
 * Where ContextDemoController drives the hard-coded tutorial story, this
 * controller operates on the **canonical document owned by ContextService** and
 * persists its edits through it. Like MapModeController it is a persistent
 * overlay coordinator, NOT a `setMode()` FSM state (ADR-050 §4.2 / ADR-047 §2.1):
 * orbit / select / grab stay live underneath, and the overlay carries requirement
 * state that would tangle uselessly with geometry-edit sub-states.
 *
 * Phase 2 scope (data-only Negotiation — lowest risk, ADR-050 §6):
 *   - `enterNegotiation()` adopts a context document (Phase 2 bootstraps the
 *     bundled conflict example through `ContextService.loadContext`; real
 *     `.ctx.json` import arrives in Phase 4) and projects the conflict matrix +
 *     resolution order into the persistent `context` uiStore slice.
 *   - `approveDecision(ref)` approves through `createApproveDecisionCommand` so
 *     the doc mutation (`status: proposed → agreed`) is **undoable** on the single
 *     CommandStack (ADR-050 §3.5). It does NOT re-project directly — it listens to
 *     ContextService's `contextChanged` event and re-projects from there, so
 *     undo / redo (which mutate the doc through the service) re-project for free
 *     (PHILOSOPHY #5 — communicate through events, not direct calls).
 *
 * All side effects live here (PHILOSOPHY #3); projection / validation stay in the
 * pure `src/context/*` layer, reached only through ContextService.
 */
import { useUIStore } from '../store/uiStore.js'
import { createApproveDecisionCommand } from '../command/ApproveDecisionCommand.js'
import conflictContext from '../../examples/cell_conflict_context.json'

export class ContextController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl       = ctrl
    this._ctxService = ctrl._ctxService

    /** True while the negotiation overlay is shown. */
    this._negotiation = false

    // Re-project whenever the canonical document changes — covers approval,
    // undo, and redo uniformly (they all mutate the doc through the service).
    this._ctxService.on('contextChanged', () => this._reproject())

    const { registerCallback } = useUIStore.getState().actions
    registerCallback('onContextNegotiate',        ()    => this.enterNegotiation())
    registerCallback('onApproveContextDecision',  (ref) => this.approveDecision(ref))
    registerCallback('onContextExit',             ()    => this.exit())
  }

  /** True while the negotiation overlay is active. */
  get isNegotiation() { return this._negotiation }

  // ── Entry / exit ────────────────────────────────────────────────────────────

  /**
   * Open the negotiation view over the loaded context document. If no document
   * is loaded yet, bootstrap the bundled conflict example (Phase 2 — real file
   * import is Phase 4); loading a context regenerates the derived scene
   * (invariant 9), so confirm before replacing the current scene.
   */
  enterNegotiation() {
    if (this._negotiation) return
    if (this._ctxService.loaded) { this._startNegotiation(); return }
    this._ctrl._uiView.showConfirmDialog(
      'コンテキストを読み込んで交渉設計ビューを開きますか? (現在のシーンは要求から再生成されます)',
      (ok) => { if (ok) this._loadThenNegotiate() },
      { title: '交渉設計 — 衝突マトリックス × 解消順序 (ADR-050)', confirmLabel: '開く' },
    )
  }

  async _loadThenNegotiate() {
    const ctrl = this._ctrl
    const viewContext = { camera: ctrl._camera, renderer: ctrl._sceneView.renderer, container: document.body }
    try {
      // loadContext emits contextLoaded → AppController._onContextLoaded does the
      // scene-side housekeeping (clear undo/selection, frame the camera).
      await this._ctxService.loadContext(conflictContext, viewContext)
    } catch (err) {
      ctrl._uiView.showToast(`Context load failed: ${err.message}`, { type: 'error' })
      console.error('[ContextController]', err)
      return
    }
    this._startNegotiation()
  }

  _startNegotiation() {
    const ctrl   = this._ctrl
    const doc    = this._ctxService.getDoc()
    const result = this._ctxService.getValidatorResult()

    // The negotiation panel is a transient data overlay — clear room for it.
    ctrl._linkNetworkView?.setForceHidden(true)

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.contextStart({
      loaded:              true,
      docMeta:             { name: doc?.meta?.name ?? 'Context', version: doc?.version },
      decisions:           doc?.decisions ?? [],
      conflicts:           result.conflicts,
      negotiationClusters: result.negotiationClusters,
      conflictMatrix:      this._ctxService.projectMatrix(),
      resolutionOrder:     this._ctxService.projectOrder(),
    })
    ui.contextSetTab('matrix')

    this._negotiation = true
  }

  /** Close the negotiation overlay (the regenerated scene stays behind). */
  exit() {
    if (!this._negotiation) return
    this._negotiation = false
    this._ctrl._linkNetworkView?.setForceHidden(false)
    useUIStore.getState().actions.contextEnd()
  }

  // ── Decision approval (undoable doc mutation, ADR-050 §3.5) ──────────────────

  /**
   * Approve a proposed Decision (single or n-ary) through the CommandStack so it
   * is undoable. The matrix transition (`proposed ◐ → resolved ✓`) follows from
   * the doc-derived `approvedRefs` and is repainted by `_reproject()` via the
   * service's `contextChanged` event.
   *
   * @param {string} decisionRef — e.g. d_standoff (single), d_cell_joint (n-ary)
   */
  approveDecision(decisionRef) {
    if (!this._negotiation) return
    const ctrl = this._ctrl
    const viewContext = { camera: ctrl._camera, renderer: ctrl._sceneView.renderer, container: document.body }

    const cmd = createApproveDecisionCommand(this._ctxService, decisionRef, viewContext)
    cmd.execute()                       // mutates the doc → emits contextChanged → _reproject()
    ctrl._commandStack.push(cmd)        // post-hoc record (CODE_CONTRACTS push vs execute)
    ctrl._refreshUndoRedoState()

    // Summarise the nominal(s) the Decision fixes (single: nominal; n-ary: nominals{}).
    const d = (this._ctxService.getDoc()?.decisions ?? []).find(x => x.ref === decisionRef)
    let detail = ''
    if (d?.nominals) {
      detail = Object.entries(d.nominals).map(([v, n]) => `${v.replace(/^v_/, '')}=${n}`).join(', ')
    } else if (d?.nominal != null) {
      detail = `${String(d.resolves).replace(/^conflict_v_/, '')}=${d.nominal}`
    }
    const kind = d?.nominals ? '合同確定' : '確定'
    ctrl._uiView.showToast(`${kind}: ${decisionRef}${detail ? ` — ${detail}` : ''}`, { type: 'info' })
  }

  // ── Re-projection (event-driven — covers approve / undo / redo) ──────────────

  /** Re-project the matrix + resolution order from the current document. */
  _reproject() {
    if (!this._negotiation) return
    const result = this._ctxService.getValidatorResult()
    const ui = useUIStore.getState().actions
    ui.contextSetMatrix(
      this._ctxService.projectMatrix(),
      result.negotiationClusters,
      this._ctxService.projectOrder(),
    )
    ui.contextSetConflicts(result.conflicts)
  }
}
