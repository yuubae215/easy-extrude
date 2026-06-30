// @ts-nocheck
/**
 * GraspController — grasp-search verification overlay coordinator (ADR-057).
 *
 * Splits the grasp walkthrough out of ContextController (single responsibility,
 * §1.1) into a dedicated persistent-overlay coordinator parallel to
 * ContextController / MapModeController. It is NOT a `setMode()` FSM state
 * (ADR-057 §H / ADR-047 §2.1): orbit / select / grab stay live underneath while
 * the user reads candidates.
 *
 * It consumes the canonical Layout DSL the loaded Context already derives —
 * `ContextService.getCompiled().layoutDsl`, the single extraction point (no scene
 * reverse-compile; scope boundary — ADR-054/ADR-055) — and reads / writes ONLY the
 * `context.grasp` uiStore slice. The grasp request is a **query** (geometry is
 * invariant), so it never touches the CommandStack (ADR-054).
 *
 * The grasp panel lives as the `'grasp'` tab inside the production `ContextLayer`
 * (ADR-057 §B), so the entry is a tab selection — the old top-level
 * `graspPanelOpen` modal flag is gone. `openGrasp()` ensures negotiate mode (the
 * tab's host) then selects the tab.
 *
 * State machine (ADR-057 §State machine — designed before this class): one grasp
 * request's lifecycle is a linear BPMN flow declare→compile→solve→render. The
 * `context.grasp` slice is a discriminated union on `status`
 * (idle / no-layout / compiling / solving / results / error) so illegal states are
 * unrepresentable; this controller is the sole author of every transition
 * (PHILOSOPHY #5). `pose` stays opaque — scoring is built from the contract's
 * `score.objectiveScores` only (ADR-057 §F / §1.3 black box).
 *
 * The uiStore is **injected** (not statically imported) so the FSM transitions
 * unit-test THREE- and dependency-free with a fake store (the `test:context` lane
 * loads with no `node_modules`); AppController passes the real `useUIStore`.
 */

export class GraspController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   * @param {{ getState: () => any }} store  injected uiStore (useUIStore)
   */
  constructor(ctrl, store) {
    this._ctrl  = ctrl
    this._store = store

    const { registerCallback } = store.getState().actions
    registerCallback('onOpenGrasp',          ()       => this.openGrasp())
    registerCallback('onRunGraspSearch',      (params) => this.runGraspSearch(params))
    registerCallback('onSelectGraspCandidate', (rank)  => this.selectCandidate(rank))
  }

  // ── Entry: select the grasp tab inside the negotiate overlay (ADR-057 §B) ─────

  /**
   * Open the grasp panel: ensure the negotiate overlay is active (the grasp tab's
   * host) and select the `'grasp'` tab. Guarded on a renderable layout — a blank /
   * requirements-only doc has none, so we guide the user instead of seeding a tab
   * that can never Run (PHILOSOPHY #11).
   */
  openGrasp() {
    const ctxCtrl = this._ctrl._ctxCtrl
    if (!ctxCtrl.isNegotiation) {
      if (!this._ctrl._ctxService.loaded) {
        this._ctrl._uiView.showToast(
          'No context loaded. Start one from New Project or import a .ctx.json first.',
          { type: 'warn' },
        )
        return
      }
      ctxCtrl.enterNegotiation()
      if (!ctxCtrl.isNegotiation) return   // enter was itself guarded out
    }

    const layout = this._layoutMeta()
    if (!layout) {
      this._ctrl._uiView.showToast(
        'This project has no renderable layout to search (load one with geometry).',
        { type: 'warn' },
      )
      return
    }

    const ui = this._store.getState().actions
    ui.contextSetGrasp({ status: 'idle', layout })
    ui.contextSetTab('grasp')
  }

  // ── Run: declare → compile (round-trip verify) → solve (BFF delegates) ────────

  /**
   * Run the UI → DSL → BFF → grasp-search walkthrough as a linear FSM:
   *   compiling  — BFF reproduces the scene from the same DSL (round-trip verify)
   *   solving    — BFF stamps contractVersion + delegates to the external solver
   *   results    — ranked candidates returned (empty array = no feasible pose, OK)
   *   error      — stage('compile'|'solve'|'bff') with httpStatus + details
   * Not a doc mutation (a query — geometry invariant), so it never touches the
   * CommandStack. Failures surface their *reason* (400/502/503) — never a silent
   * no-op (PHILOSOPHY #11).
   *
   * @param {{ weights?: Record<string,number>, topN?: number }} [params]
   */
  async runGraspSearch(params = {}) {
    const ctrl = this._ctrl
    const ui   = this._store.getState().actions

    // Guard: Run is disabled mid-flight (no overlapping requests — §State machine).
    const cur = this._store.getState().context.grasp
    if (cur?.status === 'compiling' || cur?.status === 'solving') return

    const dsl = this._loadedLayoutDsl()
    if (!dsl) {
      ui.contextSetGrasp({ status: 'no-layout' })
      ctrl._uiView.showToast('Load a project with a layout first (Context ▾ → New Project)', { type: 'warn' })
      return
    }
    const layout = { version: dsl.version, entities: (dsl.entities ?? []).length }

    // Ensure a JWT'd BffClient (the routes are protected). connectBff fetches a dev
    // token and nulls _bff when the BFF itself is unreachable.
    let bff = ctrl._service.bff
    if (!bff) {
      await ctrl._service.connectBff()
      bff = ctrl._service.bff
    }
    if (!bff) {
      ui.contextSetGrasp({ status: 'error', stage: 'bff', httpStatus: null, message: 'BFF unavailable', details: [] })
      ctrl._uiView.showToast('BFF unavailable — start the server on :3001', { type: 'error' })
      return
    }

    const objectiveWeights = params.weights ?? { reach: 0.6, clearance: 0.4 }
    const topN = Number.isFinite(params.topN) && params.topN > 0 ? Math.floor(params.topN) : 5
    const request = { layoutVersion: dsl.version, graspSearch: { objectiveWeights, topN } }

    // Step A — round-trip verify the DSL compiles to a scene on the BFF.
    ui.contextSetGrasp({ status: 'compiling', layout })
    let compiledObjects = 0
    try {
      const scene = await bff.compileLayout(dsl)
      compiledObjects = (scene.objects ?? []).length
    } catch (err) {
      return this._graspError(err, 'compile')
    }

    // Step B — declare the grasp request (UI never sets contractVersion; the BFF
    // stamps the canonical value — ADR-054 §3).
    ui.contextSetGrasp({ status: 'solving', layout, request })
    try {
      const res = await bff.graspSearch(request)
      const candidates = res.candidates ?? []
      ui.contextSetGrasp({ status: 'results', layout, request, candidates, compiledObjects, selectedRank: null })
      ctrl._uiView.showToast(`grasp-search: ${candidates.length} candidate(s)`, { type: 'info' })
    } catch (err) {
      return this._graspError(err, 'solve')
    }
  }

  // ── Select: highlight a candidate (the future ghost hook seat, ADR-057 §5) ────

  /**
   * Mark a candidate selected. In v1 this is a pure highlight (`selectedRank`); it
   * is the connection seat for the deferred spatial ghost (ADR-059) and carries no
   * 3-D side effect here. Only meaningful in the `results` state.
   *
   * @param {number} rank
   */
  selectCandidate(rank) {
    const cur = this._store.getState().context.grasp
    if (cur?.status !== 'results') return
    this._store.getState().actions.contextSetGrasp({ ...cur, selectedRank: rank })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /** Record a walkthrough failure and toast its reason (status-aware). */
  _graspError(err, stage) {
    const ui         = this._store.getState().actions
    const httpStatus = err?.status ?? null
    const details    = (err?.details && err.details.length) ? err.details : (err?.message ? [err.message] : [])
    // A genuine BFF network failure (BffUnavailableError) is stage 'bff' regardless
    // of which step raised it (ADR-057 §State machine: any BFF outage → error{bff}).
    const finalStage = err?.name === 'BffUnavailableError' ? 'bff' : stage
    ui.contextSetGrasp({ status: 'error', stage: finalStage, httpStatus, message: err.message, details })

    const label = finalStage === 'compile' ? 'Layout compile (BFF)'
      : finalStage === 'solve' ? 'grasp-search'
      : 'BFF'
    const hint =
      finalStage === 'bff' ? ' (BFF unreachable)' :
      httpStatus === 503 ? ' (grasp-search service unreachable)' :
      httpStatus === 502 ? ' (upstream contract drift / non-conformance)' :
      httpStatus === 400 ? ' (contract mismatch)' : ''
    this._ctrl._uiView.showToast(`${label} failed: ${err.message}${hint}`, { type: 'error' })
  }

  /** The Layout DSL the loaded Context derives, or null if none is renderable. */
  _loadedLayoutDsl() {
    const dsl = this._ctrl._ctxService.getCompiled()?.layoutDsl
    return dsl && (dsl.entities ?? []).length > 0 ? dsl : null
  }

  /** Lightweight layout meta for the panel header (version + entity count). */
  _layoutMeta() {
    const dsl = this._loadedLayoutDsl()
    return dsl ? { version: dsl.version, entities: (dsl.entities ?? []).length } : null
  }
}
