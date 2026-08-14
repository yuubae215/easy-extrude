// @ts-nocheck
/**
 * GraspController — grasp-search verification overlay coordinator (ADR-057).
 *
 * Splits the grasp walkthrough out of ContextController (single responsibility,
 * §1.1) into a dedicated persistent-overlay coordinator parallel to
 * ContextController / PlaceToolController. It is NOT a `setMode()` FSM state
 * (ADR-057 §H / ADR-047 §2.1): orbit / select / grab stay live underneath while
 * the user reads candidates.
 *
 * It consumes a Layout DSL resolved at ONE point (`domain/searchGeometry.js`) and
 * reads / writes ONLY the `context.grasp` uiStore slice. The grasp request is a
 * **query** (geometry is invariant), so it never touches the CommandStack (ADR-054).
 *
 * **Where that DSL comes from changed in ADR-132.** It used to be
 * `ContextService.getCompiled().layoutDsl` and nothing else, on the reading that a
 * scene reverse-compile was out of scope (ADR-054/055). That reading was too wide:
 * ADR-055 BUILT the inverse (`decompileLayout`) and named the non-Context authoring
 * path as its purpose — what it forbids is treating a derived scene as the source of
 * the *document*, not asking the scene where the bodies are. So geometry now comes
 * from the live scene (the same source the robot half always used) and the
 * document's `graspFeature` declarations are joined onto it by `ref`. Two subjects,
 * one source; declarations still owned by the document.
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
import { visionFromViewportCamera, OBJECTIVE } from '../context/GraspDeclarationCatalog.js'
import { resolveRobots, selectRobot, robotCardinality, robotForFrameId } from '../domain/robotFrames.js'
import {
  resolveGraspTargets, selectTarget, targetProjection,
  surfaceSamplesFor, obstaclesExcluding, facesForGripperKind,
} from '../domain/graspTargets.js'
import { graspFeatureGaps, GRASP_FEATURE_STATE } from '../domain/graspFeature.js'
import { resolveSearchLayout } from '../domain/searchGeometry.js'

export class GraspController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   * @param {{ getState: () => any }} store  injected uiStore (useUIStore)
   * @param {{ createGhostView?: () => import('../view/GraspGhostView.js').GraspGhostView,
   *           robotKinematics?: object|null }} [deps]
   *        `createGhostView` — lazy GraspGhostView factory (THREE side; absent in
   *        the THREE-free test lane, where the ghost path degrades to a no-op).
   *        `robotKinematics` — the `robot.kinematics` declaration derived from the
   *        bundled URDF (ADR-127 / DEF-030). INJECTED rather than imported because
   *        its source module reads the URDF through Vite's `?raw`, which the
   *        THREE-free `node --test` lane cannot execute (ADR-088's browser-only
   *        boundary). Absent ⇒ the key is omitted ⇒ ADR-127 D3's naive cone
   *        judgement, exactly as before.
   */
  constructor(ctrl, store, deps = {}) {
    this._ctrl  = ctrl
    this._store = store
    this._createGhostView = deps.createGhostView ?? null
    /** @type {object|null} URDF-derived kinematics declaration (ADR-127 D1) */
    this._robotKinematics = deps.robotKinematics ?? null
    this._createSampleView = deps.createSampleView ?? null
    /** @type {object|null} sole-owned grasp-location overlay (ADR-128) */
    this._sampleView = null
    /** @type {object|null} sole-owned spatial ghost (ADR-059) */
    this._ghost = null
    /** transient hovered rank (never in the grasp FSM slice — ADR-059 §C) */
    this._hoverRank = null
    /**
     * Which robot a grasp is solved for (ADR-090 Decision 3). The user's CHOICE
     * lives here (the scene owns the roster; this owns the pick), and it is only
     * meaningful with N robots — `selectRobot` resolves 0/1 without it, so the
     * panel shows no selector below two robots (原則 #15).
     * @type {string|null}
     */
    this._selectedRobotId = null
    /** last published `context.robots` signature — change detection, not a source */
    this._robotsSignature = null
    /**
     * Which OBJECT this run is about (ADR-117). The twin of `_selectedRobotId`:
     * the SCENE owns the roster of graspable solids (ADR-132 D1), this owns the pick, and
     * it is only meaningful with N targets (`selectTarget` resolves 0/1 without
     * it, so the panel shows no selector below two — 原則 #15).
     * @type {string|null}
     */
    this._selectedTargetRef = null
    /** last published `context.graspTargets` signature — change detection, not a source */
    this._targetsSignature = null

    const { registerCallback } = store.getState().actions
    registerCallback('onOpenGrasp',          ()       => this.openGrasp())
    registerCallback('onRunGraspSearch',      (params) => this.runGraspSearch(params))
    registerCallback('onSelectGraspCandidate', (rank)  => this.selectCandidate(rank))
    registerCallback('onHoverGraspCandidate',  (rank)  => this.hoverCandidate(rank))
    registerCallback('onCaptureViewportCamera', ()     => this.captureViewportCamera())
    registerCallback('onSelectRobot',          (id)    => this.selectRobot(id))
    registerCallback('onSelectGraspTarget',    (ref)   => this.selectGraspTarget(ref))
    registerCallback('onSetGraspFeature',      (ref, feature) => this.setGraspFeature(ref, feature))
    registerCallback('onPreviewGraspSamples',  (kind) => this.previewGraspSamples(kind))
    this.refreshRobots()
  }

  // ── Robot roster + selection (ADR-090) ───────────────────────────────────────

  /**
   * The live roster, resolved through the domain's single resolution point
   * (§1.1 — this controller never asks "is this frame a robot base?" itself).
   * @returns {import('../domain/robotFrames.js').Robot[]}
   */
  _robots() {
    const objects = this._ctrl._scene?.objects
    return objects ? resolveRobots(objects.values()) : []
  }

  /**
   * The robot this run is about, or null when the cardinality forbids an answer
   * (0 robots, or N with no explicit pick). The rule itself is the domain's named
   * predicate — resolved here, decided there (原則 #25).
   * @returns {import('../domain/robotFrames.js').Robot|null}
   */
  _selectedRobot() {
    return selectRobot(this._robots(), this._selectedRobotId)
  }

  /**
   * Publish the roster as a DERIVED projection for the panel
   * (`context.robots` — sole writer, 原則 #4/#5). The scene stays the authority;
   * this is a read-model refreshed from entity lifecycle events (AppController
   * calls it on objectAdded / objectRemoved / objectRenamed), never a second
   * source anything writes back to (§1.1).
   *
   * A selection that no longer resolves (its robot was deleted) is dropped here,
   * so a stale id can never make the gate think a robot is chosen.
   */
  refreshRobots() {
    const robots = this._robots()
    // Drop a dangling selection BEFORE resolving, so the id we keep and the id we
    // publish can never disagree.
    if (this._selectedRobotId && !robots.some(r => r.id === this._selectedRobotId)) {
      this._selectedRobotId = null
    }
    const selected = selectRobot(robots, this._selectedRobotId)
    const projection = {
      list:        robots.map(r => ({ id: r.id, label: r.label, hasTcp: r.hasTcp })),
      selectedId:  selected?.id ?? null,
      cardinality: robotCardinality(robots),
    }
    // Publish only on an actual change: this is called from every entity
    // lifecycle event, and a bulk removal (scene clear / reload) would otherwise
    // re-render the panel once per entity with an identical roster.
    const signature = JSON.stringify(projection)
    if (signature === this._robotsSignature) return
    this._robotsSignature = signature
    this._store.getState().actions.contextSetRobots?.(projection)
  }

  /**
   * Pick the robot a grasp search is solved for (panel selector). Only the choice
   * changes — no request is re-run, since the pick is an input to the NEXT run.
   * @param {string|null} id  base-frame entity id
   */
  selectRobot(id) {
    this._selectedRobotId = id ?? null
    this.refreshRobots()
  }

  // ── Grasp target roster + selection (ADR-117) ────────────────────────────────

  /**
   * The graspable solids of the LOADED LAYOUT, resolved through the domain's
   * single resolution point (§1.1 — this controller never asks "is this entity
   * graspable?" itself).
   *
   * The roster comes from the Layout DSL — which since ADR-132 D1 is derived from
   * the LIVE SCENE, with the document's declarations joined onto it. This closes
   * the asymmetry this comment used to describe and defer:
   *
   * > the DSL is the canonical extraction point … a solid dragged around in the
   * > viewport does not move its target samples until the doc is recompiled — the
   * > same asymmetry `robot.base` does NOT have (it resolves through `worldPoseOf`).
   * > Noted rather than silently split: closing it means deciding which side owns
   * > object geometry, which is an ADR, not a patch.
   *
   * ADR-132 is that ADR, and the answer is *both, on different halves*: bodies are
   * the scene's, `graspFeature` is the document's (`domain/searchGeometry.js`).
   *
   * The DSL is passed in wherever a caller already has one, so a single run
   * resolves the scene exactly ONCE. Re-deriving per call would let the geometry
   * shift underneath a request between its gate and its payload — the same
   * "input read at two different times" shape ADR-101 removed from pose.
   *
   * @param {object|null} [dsl]
   * @returns {import('../domain/graspTargets.js').GraspTarget[]}
   */
  _graspTargets(dsl = this._loadedLayoutDsl()) {
    return resolveGraspTargets(dsl?.entities)
  }

  /**
   * The object this run is about, or null when the cardinality forbids an answer
   * (0 solids, or N with no explicit pick). Resolved here, decided in the domain
   * (原則 #25).
   * @param {import('../domain/graspTargets.js').GraspTarget[]} [targets]
   * @returns {import('../domain/graspTargets.js').GraspTarget|null}
   */
  _selectedTarget(targets = this._graspTargets()) {
    return selectTarget(targets, this._selectedTargetRef)
  }

  /**
   * Publish the target roster as a DERIVED projection for the panel
   * (`context.graspTargets` — sole writer, 原則 #4/#5). The layout DSL stays the
   * authority; nothing writes back here (§1.1). A pick that no longer resolves
   * (its solid left the layout) is dropped BEFORE resolving, so the ref we keep
   * and the ref we publish can never disagree.
   *
   * Takes the already-resolved DSL when the caller has one (a run does), so the
   * projection the panel shows and the payload the run sends come from ONE
   * resolution of the scene rather than two (ADR-132 D1) — two resolutions is how
   * a panel ends up describing geometry the request did not carry, which is the
   * ADR-117 defect in a different costume.
   *
   * @param {object|null} [dsl]
   */
  refreshGraspTargets(dsl = this._loadedLayoutDsl()) {
    const targets = this._graspTargets(dsl)
    if (this._selectedTargetRef && !targets.some(t => t.ref === this._selectedTargetRef)) {
      this._selectedTargetRef = null
    }
    const projection = targetProjection(targets, this._selectedTargetRef)
    const signature  = JSON.stringify(projection)
    if (signature === this._targetsSignature) return
    this._targetsSignature = signature
    this._store.getState().actions.contextSetGraspTargets?.(projection)
  }

  /**
   * Pick the object a grasp search is solved for (panel selector). Only the choice
   * changes — the pick is an input to the NEXT run, never a re-run trigger.
   * @param {string|null} ref  Layout DSL entity ref
   */
  selectGraspTarget(ref) {
    this._selectedTargetRef = ref ?? null
    this.refreshGraspTargets()
  }

  /**
   * Declare (or clear) WHERE the target should be grasped (ADR-119 D2 / ADR-128).
   *
   * The declaration belongs to the DOCUMENT, so this does not keep a copy: it
   * hands the change to `ContextController.setGraspFeature` — the one doc-edit
   * entry point (原則 #1) — and re-derives the roster projection once the
   * recompile has produced a new Layout DSL. Reading the projection back out of
   * the recompiled document rather than optimistically writing what we just sent
   * is what keeps this a projection and not a second source (§1.1): if the edit
   * fails, the panel shows what the document still says, not what we hoped.
   *
   * @param {string} ref  Layout DSL entity ref of the Solid
   * @param {object|null} feature  the declaration, or null to clear it
   */
  setGraspFeature(ref, feature) {
    const ctxCtrl = this._ctrl._ctxCtrl
    if (typeof ctxCtrl?.setGraspFeature !== 'function') return
    return Promise.resolve(ctxCtrl.setGraspFeature(ref, feature))
      .then(() => this.refreshGraspTargets())
  }

  /**
   * Draw the points this run WOULD send, on the object itself (ADR-128).
   *
   * Driven by the panel because the hand kind lives in its form state, not in the
   * document — the same reason `captureViewportCamera` is panel-initiated. The
   * argument is that live kind, so the overlay answers "what would Run send right
   * now", not "what did the last run send".
   *
   * Deliberately draws the SAMPLES rather than a highlight of the declared faces:
   * a picture of the intent could drift from the payload, and a picture that
   * drifts from the payload is how ADR-117 shipped a panel describing geometry
   * the request never carried.
   *
   * @param {string|null} gripperKind  the panel's live hand kind, or null
   */
  previewGraspSamples(gripperKind = null) {
    const target = this._selectedTarget()
    if (!target || !this._createSampleView) { this._sampleView?.clear(); return }

    let samples
    try {
      samples = surfaceSamplesFor(target, gripperKind ?? null)
    } catch {
      // An undeclared hand kind throws by design (ADR-118) — the panel's gap list
      // already says so, and an overlay is not the place to learn it.
      this._sampleView?.clear()
      return
    }
    if (!this._sampleView) this._sampleView = this._createSampleView()
    const d = target.dimensions
    this._sampleView.show(samples, {
      declared: target.feature?.state === GRASP_FEATURE_STATE.DECLARED_FACES,
      extent:   Math.min(d.x, d.y, d.z),
    })
  }

  /** Dispose the sample overlay (panel close / context end — 原則 #9). */
  disposeSampleView() {
    if (this._sampleView) {
      this._sampleView.dispose()
      this._sampleView = null
    }
  }

  // ── Entry: the grasp panel, beside the robot it is about (ADR-105 D5 / ADR-106 D3) ──

  /**
   * Open the grasp panel. Guarded on a renderable layout — a blank /
   * requirements-only doc has none, so we guide the user instead of seeding a
   * panel that can never Run (PHILOSOPHY #11).
   *
   * **No longer opens the floor first (ADR-106 D3).** The panel used to be the
   * `'grasp'` tab of the negotiation overlay, so reaching it meant entering a
   * negotiation — "can this robot pick this up" is a question with ONE owner
   * (the solver answers it) routed through the room built for questions with
   * several. It lives in the N panel now, next to the selected robot, which is
   * what closes the `place → see if it reaches → place again` loop.
   *
   * **No longer auto-loads a starter example (ADR-132 D4).** This method used to
   * treat "no context loaded" as "nothing to lose" and quietly load
   * `cell_robotics`, which goes through `loadContext` — a FULL scene replacement
   * (ADR-131 D3 keeps the full clear there, correctly, because loading a document
   * IS a replacement). The premise was wrong: `loaded` is a fact about the
   * DOCUMENT, and the user's work lives in the SCENE. Anyone who modelled a robot
   * and an object without starting a Context lost all of it by pressing the button
   * that was supposed to search it, and the starter's own entities (「TCP 教示点
   * pick / place」) appeared in its place — a scene swap that read as a crash.
   *
   * The auto-load existed only because the search could not see a scene that no
   * document had produced. D1 removed that constraint, so the branch is gone
   * rather than guarded: a guarded destructive path is still a destructive path
   * one condition away, and the starter loader on `ContextController` is deleted
   * with it so the next entrance cannot reach for it (the ADR-102 move — take the
   * verb out of the vocabulary, name included).
   */
  openGrasp() {
    // The entrance WRITES the subject (ADR-130 D2). Until it did, the gate above
    // the button demanded a robot selection and this method never read one: with
    // N robots the panel then asked "which one?" about a robot the user had just
    // picked in the Outliner. Two sources for one premise, and the one the run
    // consults was not the one the user was told to set (原則 #1 / §1.1).
    //
    // ADR-130 needed this to run before a branch that could replace the scene;
    // ADR-132 D4 removed that branch, so there is only one path now. The order is
    // still deliberate — `_openGraspPanel` publishes the roster projection, and it
    // must publish the subject this line just adopted, not the previous one.
    this._adoptSelectionAsSubject()
    this._openGraspPanel()
  }

  /**
   * Take the selected frame's robot as this search's subject, if the selection
   * names one (ADR-130 D2).
   *
   * A selection that is NOT a robot frame leaves the current subject alone
   * rather than clearing it: the entrance is only reachable from a robot
   * selection or from an already-live search, and clearing on anything else
   * would make "click the object you want to grasp" silently un-pick the robot —
   * the very coupling this ADR removes.
   *
   * Which robot a frame belongs to is the domain's named predicate
   * (`robotForFrameId`); this method only supplies the id (原則 #25).
   */
  _adoptSelectionAsSubject() {
    const selectedId = this._ctrl._activeObj?.id ?? null
    const robot = robotForFrameId(this._robots(), selectedId)
    if (robot) this._selectedRobotId = robot.id
  }

  /**
   * Guard on a renderable layout, then seed the idle FSM slice and surface the N
   * panel that hosts it.
   *
   * "Renderable" now means the LIVE SCENE has bodies (ADR-132 D1), so the guidance
   * below fires only on a genuinely empty scene — not, as before, on every scene
   * that happened to have no Context document behind it.
   */
  _openGraspPanel() {
    const layout = this._layoutMeta()
    if (!layout) {
      this._ctrl._uiView.showToast(
        'Nothing to search — the scene is empty. Add a solid (Shift+A) or load a project first.',
        { type: 'warn' },
      )
      return
    }

    this._clearGhost()   // idle carries no candidate to ghost (ADR-059 §B-5)
    this.refreshRobots() // the panel's selectors read fresh rosters on open
    this.refreshGraspTargets()
    const ui = this._store.getState().actions
    ui.contextSetGrasp({ status: 'idle', layout })
    // The seeded slice IS the panel's availability (NPanel renders it while
    // `context.grasp` is non-null), so the only thing left is to make sure the
    // host panel is on screen — an entrance that lands nowhere visible is a
    // silent no-op (原則 #11).
    ui.setNPanelVisible(true)
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

    // Resolve the search geometry ONCE for this run (ADR-132 D1). Every gate and
    // the payload below read this same snapshot, so the scene cannot shift between
    // "we checked there was a target" and "here is that target's geometry".
    const resolved = this._searchLayout()
    const dsl = resolved.dsl
    if (!dsl) {
      ui.contextSetGrasp({ status: 'no-layout' })
      ctrl._uiView.showToast('Nothing to search — the scene is empty. Add a solid (Shift+A) first.', { type: 'warn' })
      return
    }
    const layout = {
      version:  dsl.version,
      entities: (dsl.entities ?? []).length,
      geometrySource:    resolved.geometrySource,
      declarationSource: resolved.declarationSource,
      unconvertible:     resolved.warnings.length,
    }

    // Guard: a grasp is solved FOR a robot (ADR-090 Decision 4). With no robot in
    // the scene — or N robots and no explicit pick — there is no premise to solve
    // against, and omitting `robot` from the request would let core/ fall back to
    // its default `Robot(base=(0,0,0), reach_max=inf, wrist_cone=π)`: an infinite-
    // reach ghost standing at the origin, whose "candidates" are unexecutable on
    // any real cell (ADR-090 §力学(3)). Stop with the reason instead (#11) — the
    // input is never consumed silently.
    const robotEntity = this._selectedRobot()
    const robot = robotEntity ? this._resolveRobotDeclaration(robotEntity) : {}
    if (!robotEntity || robot.base === undefined) {
      const robots = this._robots()
      const reason = robots.length === 0
        ? 'No robot in the scene — add one (Shift+A → Robot) before searching for a grasp.'
        : !robotEntity
          ? `${robots.length} robots in the scene — pick which one to solve for.`
          : `Robot "${robotEntity.label}" has no resolvable base pose — place it in the scene first.`
      ui.contextSetGrasp({ status: 'no-robot', layout, reason, robotCount: robots.length })
      ctrl._uiView.showToast(reason, { type: 'warn' })
      return
    }

    // Guard: a grasp is solved for a robot AND an object (ADR-117). Sending no
    // `target` is what made every run through the UI dead-but-green: core/'s
    // adapter defaults an absent target to zero surface samples, so
    // `generate_candidates` yields nothing and the answer is always
    // `candidatesGenerated: 0` — a number that looks like a legitimate verdict
    // (原則 #31). Worse, the panel's 0-candidate copy then tells the user to fix
    // the layout's geometry, which the request never carried. Stop with the real
    // reason instead of shipping a search that cannot succeed (#11).
    this.refreshGraspTargets(dsl)
    const targets      = this._graspTargets(dsl)
    const targetEntity = this._selectedTarget(targets)
    if (!targetEntity) {
      const reason = targets.length === 0
        ? 'Nothing to pick up — no solid in the scene has graspable geometry.'
        : `${targets.length} graspable objects in the scene — pick which one to grasp.`
      ui.contextSetGrasp({ status: 'no-target', layout, reason, targetCount: targets.length })
      ctrl._uiView.showToast(reason, { type: 'warn' })
      return
    }

    // Guard: the WHERE-to-grasp declaration must be readable and usable by the
    // declared hand (ADR-119 D2/D3, ADR-128). Two failures live here and both
    // would otherwise come back as a well-formed `candidatesGenerated: 0`:
    //   · an unreadable declaration — degrading it to the derived faces would be
    //     "you declared and we ignored you", the exact lie D3 forbids;
    //   · a single face under a parallel jaw — `core/` measures the opening from
    //     these very samples, so one face reports almost no width and the gate
    //     passes hands that cannot close (the ADR-118 defect, re-entered through
    //     the declaration's front door).
    const featureGaps = graspFeatureGaps(targetEntity.feature, params.gripper?.kind ?? null)
    if (featureGaps.length > 0) {
      const reason = featureGaps[0]
      ui.contextSetGrasp({ status: 'no-target', layout, reason, targetCount: targets.length })
      ctrl._uiView.showToast(reason, { type: 'warn' })
      return
    }

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

    // Default weights use core/'s REGISTERED objective names (ADR-117). The old
    // `{ reach, clearance }` defaults matched nothing in the solver's registry,
    // which drops unknown names without complaint — so every score came back
    // empty and every candidate tied at 0.0.
    const objectiveWeights = params.weights ?? {
      [OBJECTIVE.REACH_MARGIN]:       0.6,
      [OBJECTIVE.APPROACH_CLEARANCE]: 0.4,
      [OBJECTIVE.GRASP_STABILITY]:    1.0,
    }
    const topN = Number.isFinite(params.topN) && params.topN > 0 ? Math.floor(params.topN) : 5
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
        // Robot geometry (ADR-084 §2): the world pose of the SELECTED robot's
        // base / tcp entities (the single geometry source — §1.1). Still exactly
        // the ADR-084 shape — one robot, no id — because identity is a front-side
        // concern (ADR-090 Decision 3): the contract and core/ are untouched by
        // multi-robot support. The gate above guarantees `base` is present, so
        // core/'s ghost-robot default is unreachable from here.
        // The arm's KINEMATIC STRUCTURE (ADR-127 D1, DEF-030). Merged into the
        // resolved geometry rather than sent beside it because `kinematics` is a
        // property of the same robot the base pose describes. Present only when
        // the bundled URDF is UR-shaped; absent keeps ADR-127 D3's naive cone
        // judgement, which is why wiring this changes answers only where a real
        // structure is actually declared.
        robot: this._robotKinematics ? { ...robot, kinematics: this._robotKinematics } : robot,
        // The object being grasped and the bodies around it (ADR-117). Both are
        // DECLARATIONS derived from the same Layout DSL the rest of the request
        // comes from — where the surface is, how big the other bodies are. Every
        // judgement about them (can the gripper close on this sample, does the
        // approach clip that body) stays solved in core/ behind the contract.
        // Which FACES are sampled follows the declared hand (ADR-118): jaws close
        // across opposed sides, a cup seals on the top. Sampling the wrong face is
        // not a fidelity loss — core/ measures the object width from these very
        // samples, so a top-only grid told the jaw gate the box was half as wide.
        target:    { surfaceSamples: surfaceSamplesFor(targetEntity, params.gripper?.kind ?? null) },
        obstacles: obstaclesExcluding(targets, targetEntity.ref),
        // Reach judgement params ride plan{} (ADR-084 §4). The panel now COLLECTS
        // these (ADR-128): until it did, `reach_margin` had no absolute basis and
        // came back permanently unmeasured — which ADR-120 correctly refuses to
        // draw as a zero score, so a weight slider sat on screen controlling an
        // objective nothing could ever evaluate. An undeclared range still omits
        // the key entirely: core/ keeps its own defaults and nothing is invented
        // here (kernel §5), and "not declared" stays visibly different from
        // "declared as zero margin" (原則 #31).
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
   * Resolve ONE robot's declared geometry — its base frame's world position and
   * its tcp child's world quaternion (ADR-084 §2, TF tree ADR-085).
   *
   * Which robot is decided upstream (`_selectedRobot()` → the domain's
   * `selectRobot`); this method only reads the poses of the aggregate it is
   * handed, so the "which one" question has exactly one owner (ADR-090
   * Decision 3). World pose comes from `SceneService.worldPoseOf` — the SAME
   * resolution the service runs each frame (so the tcp's world quaternion is
   * already composed through the base; a rotated base rotates the wrist-cone
   * reference axis), reused rather than re-implemented (§1.1). The composition to
   * world space stays on the front (light deterministic math) while core/ gets
   * only the resolved position / quaternion and never sees the entity — which is
   * exactly why the wire stays SINGULAR and the contract untouched: the id is a
   * front-side concern (原則 #29 / ADR-090 Decision 3).
   *
   * Returns a sparse object: keys are present only when their frame resolves. An
   * absent `base` is what the caller's gate reads as "not solvable" — it never
   * ships a robot-less request for core/ to fill with defaults.
   *
   * `baseOrientation` (ADR-129 D2) rides along whenever the base frame resolves:
   * the frame always HAS an orientation, so sending it is not an invention — it is
   * the same fact `worldPoseOf` already resolves for the TCP. What stays undeclared
   * is the case where the base frame itself does not resolve, and there the whole
   * request is gated off anyway.
   *
   * @param {import('../domain/robotFrames.js').Robot} robot
   * @returns {{ base?: [number,number,number], tcpOrientation?: [number,number,number,number] }}
   */
  _resolveRobotDeclaration(robot) {
    const service = this._ctrl._service
    if (!robot || typeof service?.worldPoseOf !== 'function') return {}

    const basePose = service.worldPoseOf(robot.baseFrame.id)
    const tcpPose  = robot.tcpFrame ? service.worldPoseOf(robot.tcpFrame.id) : null

    /** @type {{ base?: [number,number,number], baseOrientation?: [number,number,number,number],
     *           tcpOrientation?: [number,number,number,number] }} */
    const declaration = {}
    if (basePose) {
      const p = basePose.position
      declaration.base = [p.x, p.y, p.z]
      // 据付姿勢 (ADR-129 D2)。ベースフレームの**世界四元数**をそのまま載せる —
      // これは `worldPoseOf` が毎フレーム解いているのと同じ解決で、ここで別の
      // 合成を書くと第二の源になる (§1.1)。
      const q = basePose.quaternion
      if (q) declaration.baseOrientation = [q.x, q.y, q.z, q.w]
    }
    if (tcpPose) {
      const q = tcpPose.quaternion
      declaration.tcpOrientation = [q.x, q.y, q.z, q.w]
    }
    return declaration
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

  /**
   * WHAT this search is about, resolved through the domain's single resolution
   * point (ADR-132 D1/D2 — `resolveSearchLayout`; this controller supplies the two
   * inputs and decides nothing, 原則 #25).
   *
   * Geometry comes from the LIVE SCENE (ADR-055's φ⁻¹, wired here for the first
   * time), so the request describes what is on the screen — the same source the
   * robot half has always used. Declarations (`graspFeature`) come from the loaded
   * document and are joined on by `ref`, because the scene does not carry them and
   * dropping them would be "you declared and we ignored you" (ADR-119 D3).
   *
   * `_service.decompileToLayoutDsl` is called defensively: the THREE-free unit lane
   * drives this controller with a fake service, and there the document IS the
   * geometry — a named outcome (`SOURCE.DOCUMENT`), not a silent degrade.
   *
   * @returns {import('../domain/searchGeometry.js').SearchLayout}
   */
  _searchLayout() {
    const service = this._ctrl._service
    let sceneDsl = null
    let warnings = []
    if (typeof service?.decompileToLayoutDsl === 'function') {
      try {
        const out = service.decompileToLayoutDsl()
        sceneDsl = out?.dsl ?? null
        warnings = out?.warnings ?? []
      } catch (err) {
        // A scene the decompiler cannot express is a fact, not a crash: fall to
        // the document and say what happened (原則 #11 — never a silent no-op).
        console.warn('[GraspController] scene → Layout DSL failed; using the document', err)
        sceneDsl = null
      }
    }
    return resolveSearchLayout({
      sceneDsl,
      docDsl: this._ctrl._ctxService.getCompiled()?.layoutDsl ?? null,
      warnings,
    })
  }

  /** The Layout DSL this search is built from, or null when nothing is renderable. */
  _loadedLayoutDsl() {
    return this._searchLayout().dsl
  }

  /**
   * Lightweight layout meta for the panel header: version + entity count, plus
   * WHERE each half came from and what could not be expressed.
   *
   * The sources ride the header rather than staying an implementation detail
   * because they are a state (原則 #31): "the document declares no grasp location
   * here" and "no document was consulted" produce identical targets, and only the
   * source distinguishes them. The warnings are the same rule applied to bodies —
   * an ImportedMesh the user can see but the search cannot must be said out loud.
   */
  _layoutMeta() {
    const { dsl, geometrySource, declarationSource, warnings } = this._searchLayout()
    if (!dsl) return null
    return {
      version:  dsl.version,
      entities: (dsl.entities ?? []).length,
      geometrySource,
      declarationSource,
      unconvertible: warnings.length,
    }
  }
}
