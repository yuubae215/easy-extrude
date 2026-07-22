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
 *
 * Stage-1 spatial ghost (ADR-059): this controller is the **sole owner** of the
 * `GraspGhostView` (PHILOSOPHY #4/#9) — created lazily via the injected
 * `createGhostView` factory (the view imports THREE, so the class itself is never
 * statically imported here, keeping the `test:context` lane THREE-free), updated on
 * candidate hover/select, and disposed on overlay exit / new run. The capability
 * gate (`renderableEndEffectorFrame`) is the pure THREE-free check — a candidate
 * whose pose fails it gets NO ghost and the panel shows an honest caption instead
 * (PHILOSOPHY #11: never fabricate a pose). Hover is a transient view concern kept
 * controller-local — it is deliberately NOT part of the `context.grasp` union
 * (ADR-059 §C: the ghost is a derived projection, not a new FSM).
 */
import { renderableEndEffectorFrame, nearestTargetIndex } from '../view/GraspGhostMath.js'
import { visionFromViewportCamera } from '../context/GraspDeclarationCatalog.js'
import { ROBOT_BASE_FRAME_NAME, TCP_FRAME_NAME } from '../domain/robotFrames.js'

/**
 * TemplateCatalog example id auto-loaded when grasp-search is opened with no
 * context (fast entry). A robot-cell starter (geometry + reach/gripper
 * declarations) so Run is immediately meaningful.
 */
const GRASP_QUICKSTART_TEMPLATE_ID = 'cell_robotics'

export class GraspController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   * @param {{ getState: () => any }} store  injected uiStore (useUIStore)
   * @param {{ createGhostView?: () => import('../view/GraspGhostView.js').GraspGhostView }} [deps]
   *        `createGhostView` — lazy GraspGhostView factory (THREE side; absent in
   *        the THREE-free test lane, where the ghost path degrades to a no-op).
   */
  constructor(ctrl, store, deps = {}) {
    this._ctrl  = ctrl
    this._store = store
    this._createGhostView = deps.createGhostView ?? null
    /** @type {object|null} sole-owned spatial ghost (ADR-059) */
    this._ghost = null
    /** transient hovered rank (never in the grasp FSM slice — ADR-059 §C) */
    this._hoverRank = null

    const { registerCallback } = store.getState().actions
    registerCallback('onOpenGrasp',          ()       => this.openGrasp())
    registerCallback('onRunGraspSearch',      (params) => this.runGraspSearch(params))
    registerCallback('onSelectGraspCandidate', (rank)  => this.selectCandidate(rank))
    registerCallback('onHoverGraspCandidate',  (rank)  => this.hoverCandidate(rank))
    registerCallback('onCaptureViewportCamera', ()     => this.captureViewportCamera())
  }

  // ── Entry: select the grasp tab inside the negotiate overlay (ADR-057 §B) ─────

  /**
   * Open the grasp panel: ensure the negotiate overlay is active (the grasp tab's
   * host) and select the `'grasp'` tab. Guarded on a renderable layout — a blank /
   * requirements-only doc has none, so we guide the user instead of seeding a tab
   * that can never Run (PHILOSOPHY #11).
   *
   * Fast entry (no forms): when NO context is loaded yet, rather than dead-ending
   * with "go build one through New Project", auto-load a robot-cell starter and
   * drop the user straight into grasp-search. The boot scene carries no context
   * work to lose, and the example path needs no wizard forms — it collapses the
   * old multi-form detour into a single click.
   */
  openGrasp() {
    const ctxCtrl = this._ctrl._ctxCtrl
    if (!ctxCtrl.isNegotiation) {
      if (!this._ctrl._ctxService.loaded) {
        this._quickStartIntoGrasp()
        return
      }
      ctxCtrl.enterNegotiation()
      if (!ctxCtrl.isNegotiation) return   // enter was itself guarded out
    }

    this._openGraspTab()
  }

  /**
   * Load the grasp quick-start example, then open the grasp tab once negotiation
   * is live. Kept off the synchronous path (loadContext is async). Falls back to
   * the honest "no context" guidance when the injected ctxCtrl cannot load
   * examples (the THREE-free unit lane passes a minimal stub).
   */
  _quickStartIntoGrasp() {
    const ctxCtrl = this._ctrl._ctxCtrl
    if (typeof ctxCtrl.quickStartExample !== 'function') {
      this._ctrl._uiView.showToast(
        'No context loaded. Start one from New Project or import a .ctx.json first.',
        { type: 'warn' },
      )
      return
    }
    this._ctrl._uiView.showToast('Loading a robot-cell starter for grasp-search…', { type: 'info' })
    Promise.resolve(ctxCtrl.quickStartExample(GRASP_QUICKSTART_TEMPLATE_ID))
      .then(ok => { if (ok) this._openGraspTab() })
  }

  /**
   * Shared tail: guard on a renderable layout, then seed the idle FSM slice and
   * select the grasp tab. Reached both directly (a context already loaded) and
   * after the quick-start example finishes loading.
   */
  _openGraspTab() {
    const layout = this._layoutMeta()
    if (!layout) {
      this._ctrl._uiView.showToast(
        'This project has no renderable layout to search (load one with geometry).',
        { type: 'warn' },
      )
      return
    }

    this._clearGhost()   // idle carries no candidate to ghost (ADR-059 §B-5)
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
   * @param {{ weights?: Record<string,number>, topN?: number,
   *           camera?: object|null, gripper?: object|null }} [params]
   */
  async runGraspSearch(params = {}) {
    const ctrl = this._ctrl
    const ui   = this._store.getState().actions

    // Guard: Run is disabled mid-flight (no overlapping requests — §State machine).
    const cur = this._store.getState().context.grasp
    if (cur?.status === 'compiling' || cur?.status === 'solving') return

    // Keep the outgoing run's funnel so the next results can show the delta
    // ("did my tweak work?") — an explicitly derived carry-over, not a second
    // source: the wire truth for the new run is res.diagnostics below.
    const prevDiagnostics = cur?.status === 'results' ? (cur.diagnostics ?? null) : null

    // A new run invalidates the previous run's ghost (ADR-059 §B-5).
    this._clearGhost()

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
    // Robot geometry (ADR-084 §2): resolved from the scene's robot_base / tcp
    // CoordinateFrame entities (the single geometry source — §1.1), NOT the
    // former uiStore.robotBase raw coords. `base` = resolved world position;
    // `tcpOrientation` = resolved world quaternion that becomes core/'s
    // wrist-cone reference axis (ADR-084 §3). Only present keys ride the wire;
    // reach/IK evaluation against them happens in core/, never here.
    const robot = this._resolveRobotDeclaration()
    // Vision / grasp domain declarations (ADR-081 Decision 5): the panel's
    // domain cards pass parsed camera / gripper declarations, gap-checked by
    // GraspDeclarationCatalog's predicates before Run enables. They ride the
    // request's open payload verbatim (declaration only — visibility / grasp
    // judgment stays in core/); an undeclared card simply omits the key and
    // the corresponding gate passes everything (vacuously-true contract).
    const request = {
      layoutVersion: dsl.version,
      graspSearch: {
        objectiveWeights, topN,
        ...(Object.keys(robot).length ? { robot } : {}),
        // Judgement params ride plan{} (ADR-084 §4) when the caller supplies
        // them; the front collects none today, so plan{} is normally omitted
        // and core/ uses its defaults (no invented values — kernel §5).
        ...(params.plan ? { plan: params.plan } : {}),
        ...(params.camera  ? { camera:  params.camera }  : {}),
        ...(params.gripper ? { gripper: params.gripper } : {}),
      },
    }

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
      // diagnostics is the contract-v3 rejection funnel — passed through as a
      // wire fact (presentation derives from it in GraspFunnelMath / the panel).
      const diagnostics = res.diagnostics ?? null
      ui.contextSetGrasp({
        status: 'results', layout, request, candidates,
        diagnostics, prevDiagnostics,
        compiledObjects, selectedRank: null,
      })
      ctrl._uiView.showToast(`grasp-search: ${candidates.length} candidate(s)`, { type: 'info' })
    } catch (err) {
      return this._graspError(err, 'solve')
    }
  }

  // ── Select / hover: drive the stage-1 spatial ghost (ADR-057 §5 seat, ADR-059) ─

  /**
   * Mark a candidate selected (`selectedRank`) and re-project the spatial ghost —
   * a click plays the committed approach animation when the candidate's pose
   * passes the capability gate. Only meaningful in the `results` state.
   *
   * @param {number} rank
   */
  selectCandidate(rank) {
    const cur = this._store.getState().context.grasp
    if (cur?.status !== 'results') return
    this._store.getState().actions.contextSetGrasp({ ...cur, selectedRank: rank })
    this._syncGhost()
  }

  /**
   * Candidate-row hover preview (ADR-059 §B-3): the hovered candidate's ghost
   * fades in at preview opacity; leaving reverts to the selected candidate (or
   * clears). Hover never touches the `context.grasp` union — it is a derived,
   * transient view input (ADR-059 §C).
   *
   * @param {number|null} rank
   */
  hoverCandidate(rank) {
    if (this._store.getState().context.grasp?.status !== 'results') return
    if (rank === this._hoverRank) return
    this._hoverRank = rank
    this._syncGhost()
  }

  /**
   * Per-frame ghost animation, driven by AppController's loop (same seat as
   * ContextController.tick). `t` arrives in seconds (the loop's animation clock);
   * the view's fade/approach constants are in ms.
   *
   * @param {number} t — elapsed seconds
   */
  tick(t) {
    if (!this._ghost) return
    const sv = this._ctrl._sceneView
    this._ghost.tick(t * 1000, sv?.activeCamera, sv?.renderer)
  }

  /** Fully dispose the ghost (overlay exit / contextEnd — PHILOSOPHY #9). */
  disposeGhost() {
    this._hoverRank = null
    if (this._ghost) {
      this._ghost.dispose()
      this._ghost = null
    }
  }

  /**
   * Project the current (hover ?? selected) candidate into the ghost. The pure
   * capability gate decides renderability — anything that fails it (opaque /
   * jointSpace / malformed) clears the ghost and the panel's caption explains why
   * (PHILOSOPHY #11: no heuristic interpretation of poses).
   */
  _syncGhost() {
    const cur = this._store.getState().context.grasp
    if (cur?.status !== 'results') return this._clearGhost()

    const rank = this._hoverRank ?? cur.selectedRank
    const candidate = rank == null ? null : (cur.candidates ?? []).find(c => c.rank === rank)
    const frame = candidate ? renderableEndEffectorFrame(candidate.pose) : null
    if (!frame) { this._ghost?.clear(); return }

    if (!this._ghost) {
      if (!this._createGhostView) return   // THREE-free lane: ghost path degrades to no-op
      this._ghost = this._createGhostView()
    }

    // Hovering an unselected row previews; everything else is the committed select.
    const mode = (this._hoverRank != null && this._hoverRank !== cur.selectedRank) ? 'hover' : 'select'
    const radius = this._sceneRadius()
    this._ghost.setWorldCap(radius > 0 ? radius * 0.5 : Infinity)
    this._ghost.showCandidate({ frame, score: candidate.score, mode, rank })

    // Grasped-target outline: nearest scene solid to the TCP (display-only
    // proximity — permitted by "Centroid Is Validation-Only" for display).
    const objs = [...(this._ctrl._scene?.objects?.values() ?? [])]
      .filter(o => o.meshView?.cuboid?.geometry && o.corners?.length > 0)
    const centers = objs.map(o => o._position
      ? [o._position.x, o._position.y, o._position.z]
      : this._displayCenter(o.corners))
    const maxDist = radius > 0 ? radius * 0.5 : Infinity
    const idx = nearestTargetIndex(frame.position, centers, maxDist)
    this._ghost.setTargetGeometry(idx != null ? objs[idx].meshView.cuboid.geometry : null)
  }

  /** Hide the ghost and drop the transient hover (state transitions out of results). */
  _clearGhost() {
    this._hoverRank = null
    this._ghost?.clear()
  }

  /** Scene bounding radius (world-cap input — PHILOSOPHY #27 pair rule). */
  _sceneRadius() {
    let r = 0
    for (const o of this._ctrl._scene?.objects?.values() ?? []) {
      for (const c of o.corners ?? []) {
        const d = c.length()
        if (d > r) r = d
      }
    }
    return r
  }

  /** Display-only centre of world corners (never fed back into state — #24). */
  _displayCenter(corners) {
    let x = 0, y = 0, z = 0
    for (const c of corners) { x += c.x; y += c.y; z += c.z }
    const n = corners.length
    return [x / n, y / n, z / n]
  }

  // ── Viewport-camera capture (ADR-081 Decision 5 「今この視点から見えるか」) ────

  /**
   * Snapshot the active viewport camera as a vision declaration for the
   * panel's "use current view" button. This is the side-effect half of the
   * capture: it reads the live camera (position / matrixWorld / perspective
   * fov) and delegates ALL derivation to the pure
   * `visionFromViewportCamera` (GraspDeclarationCatalog) — the same split as
   * the ghost's capability gate. Returns the wire-shaped declaration
   * `{position, viewAxis, fovHalfAngle|null}` or null when no camera is
   * available (THREE-free test lane / detached view) — the panel reports the
   * null instead of writing a guessed declaration (PHILOSOPHY #11).
   *
   * Uses `SceneView.activeCamera` (never a captured perspective-only camera —
   * the "HTML Overlay Active Camera" contract): in Map Mode the ortho camera
   * is captured, whose missing fov degrades to fovHalfAngle null.
   */
  captureViewportCamera() {
    const cam = this._ctrl._sceneView?.activeCamera
    if (!cam) return null
    cam.updateMatrixWorld?.()
    const p = cam.position
    return visionFromViewportCamera({
      position: p ? { x: p.x, y: p.y, z: p.z } : null,
      matrixWorldElements: cam.matrixWorld?.elements ?? null,
      fovDeg: typeof cam.fov === 'number' ? cam.fov : null,
    })
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  /**
   * Resolve the robot's declared geometry from the scene's `robot_base` (world
   * root) and `tcp` (its TF child) CoordinateFrame entities (ADR-084 §2, TF tree
   * ADR-085). 1-robot scope: a plain name lookup — no `refs` field, no selection
   * UI (§4). World pose is read from `SceneService.worldPoseOf` — the SAME
   * resolution the service runs (so tcp's world quaternion is already composed
   * through robot_base; a rotated base rotates the wrist-cone reference axis)
   * each frame, reused rather than re-implemented (§1.1); the composition to
   * world space stays on the front (light deterministic math) while core/ gets
   * only the resolved position / quaternion and never sees the entity.
   *
   * Returns a sparse object: keys are present only when their frame resolves,
   * so an absent frame simply omits its wire key (the ADR-084 §3 core fallback
   * then keeps the prior base→candidate proxy axis for `tcpOrientation`).
   *
   * @returns {{ base?: [number,number,number], tcpOrientation?: [number,number,number,number] }}
   */
  _resolveRobotDeclaration() {
    const scene   = this._ctrl._scene
    const service = this._ctrl._service
    if (!scene?.objects || typeof service?.worldPoseOf !== 'function') return {}

    // robot_base is the world-parented root of the robot TF tree (parentId null).
    const baseFrame = (() => {
      for (const o of scene.objects.values()) {
        if (o.name === ROBOT_BASE_FRAME_NAME && o.parentId === null) return o
      }
      return null
    })()
    // tcp is a CHILD of robot_base (TF tree, ADR-084 §2 revised) — a name lookup,
    // NOT constrained to parentId === null. Its world quaternion (resolved through
    // robot_base by worldPoseOf) is what rides the wire; the parent link is why a
    // rotated base now rotates the wrist-cone reference axis. Prefer the tcp
    // parented under robot_base if several share the name (1-robot scope).
    const tcpFrame = (() => {
      let fallback = null
      for (const o of scene.objects.values()) {
        if (o.name !== TCP_FRAME_NAME) continue
        if (baseFrame && o.parentId === baseFrame.id) return o
        fallback ??= o
      }
      return fallback
    })()
    const basePose  = baseFrame ? service.worldPoseOf(baseFrame.id) : null
    const tcpPose   = tcpFrame  ? service.worldPoseOf(tcpFrame.id)  : null

    /** @type {{ base?: [number,number,number], tcpOrientation?: [number,number,number,number] }} */
    const robot = {}
    if (basePose) {
      const p = basePose.position
      robot.base = [p.x, p.y, p.z]
    }
    if (tcpPose) {
      const q = tcpPose.quaternion
      robot.tcpOrientation = [q.x, q.y, q.z, q.w]
    }
    return robot
  }

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
