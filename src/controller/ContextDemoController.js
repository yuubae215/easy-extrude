// @ts-nocheck
/**
 * ContextDemoController — Context DSL (ADR-046) visual PoC demo (ADR-047).
 *
 * Orchestrates the story-mode walkthrough of the factory-cell example:
 *   ① 顧客発話 → ② Fact化 → ③ OpenQuestions 自動検出 → ④ Decision 承認
 *   → ⑤ コンパイル/シーン出現 → ⑥ Acceptance チェック結果
 *
 * The demo is an *overlay* over a normally loaded scene — not a new FSM mode.
 * `enter()` compiles examples/factory_context.json through the real two-stage
 * chain (compileContext → compileLayout → importFromJson) and stages entity
 * visibility per story step; `exit()` restores all visibility, leaving a fully
 * editable scene behind. All side-effect orchestration lives here (PHILOSOPHY #3);
 * the compile layer stays pure.
 *
 * Owns: UncertaintyGhostView (sole owner — PHILOSOPHY #4/#9), step staging,
 * staggered reveal animation. UI state flows through uiStore's demo slice.
 */
import * as THREE from 'three'
import { useUIStore } from '../store/uiStore.js'
import { compileContext } from '../context/ContextCompiler.js'
import { validateContext } from '../context/ContextValidator.js'
import { applyAdmissibleEdit } from '../context/ContextEditModel.js'
import { projectConflictMatrix, projectResolutionOrder } from '../context/PersonaProjection.js'
import { compileLayout, buildRefMap, linkIdForConstraint } from '../layout/LayoutCompiler.js'
import { UncertaintyGhostView } from '../view/UncertaintyGhostView.js'
import { RegionAuthoringWidget } from '../view/RegionAuthoringWidget.js'
import { RippleEffect } from '../view/RippleEffect.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import factoryContext from '../../examples/factory_context.json'
import regionContext from '../../examples/cell_region_context.json'
import conflictContext from '../../examples/cell_conflict_context.json'

/** Inspector tab shown for each story step (null = inspector closed). */
const TAB_BY_STEP = [null, 'facts', 'openQuestions', 'decisions', 'trace', 'acceptance']

/** Seconds between staggered entity reveals in step ⑤. */
const REVEAL_INTERVAL = 0.15

export const DEMO_STEPS = [
  {
    title: '① 顧客の発話',
    narration: '「セルの1工程を自動化したい。床のコンセントから3m弱のところに作業台があって、その上にロボットを載せたい」— 要件はいつも曖昧なまま始まる。',
  },
  {
    title: '② Fact 化',
    narration: '発話を Fact として記録。「3m弱」は区間 [2700, 3000] mm のまま保持される — 勝手にひとつの数値へ丸めない。未確認の属性は unknown として残る。',
  },
  {
    title: '③ OpenQuestions 自動検出',
    narration: 'バリデータが unknown / 未割当の責任区分を機械的に列挙する。確認漏れを人の注意力に頼らない。',
  },
  {
    title: '④ Decision 承認',
    narration: '区間をひとつの値に確定できるのは Decision だけ（ADR-046 不変条件2）。公称値 2800mm を承認して作業台の位置を確定する。',
  },
  {
    title: '⑤ コンパイル → シーン出現',
    narration: '確定済み仕様 (layout/1.0) からシーンが生成される。すべての配置・拘束は要求にトレースできる。ロボットの fastened 拘束は本物 — ドラッグしてみると分かる。',
  },
  {
    title: '⑥ Acceptance チェック',
    narration: '受入チェックのうち、unknown / assumed な事実に依存するものは自動的に「ブロック」される。何を確認すれば前に進めるかが構造から分かる。',
  },
]

export class ContextDemoController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    this._active     = false
    this._step       = 0
    this._approved   = false
    this._revealDone = false

    /** @type {import('../view/UncertaintyGhostView.js').UncertaintyGhostView|null} */
    this._ghost         = null
    this._ghostTargetId = null
    this._decisionProv  = null

    /** @type {Map<string,string>|null} layout DSL ref → scene entity id */
    this._refToId = null
    /** @type {Map<string,string[]>} trace.from → trace.to[] */
    this._traceByFrom = new Map()
    /** @type {Map<string,string>} "constraint:a→b" → SpatialLink id */
    this._constraintToLinkId = new Map()
    /** @type {string[]} all demo SpatialLink ids */
    this._linkIds = []
    /** @type {{queue: {id:string, pos:THREE.Vector3, radius:number}[], nextAt:number}|null} */
    this._reveal = null
    /** @type {object|null} compiled layout DSL (resolved values) */
    this._layoutDsl = null

    // ── Bidirectional region authoring (ADR-049 Phase 3, §5.2) ──────────────
    this._authoring   = false
    /** @type {{reqRef:string, varRef:string, widget:RegionAuthoringWidget}[]} */
    this._authorWidgets = []
    /** @type {{reqRef:string, varRef:string, widget:RegionAuthoringWidget}|null} */
    this._authorDrag  = null
    /** @type {object|null} mutable (cloned) context the widgets edit + re-validate */
    this._editCtx     = null

    // ── Negotiation visualization (ADR-049 Phase 4) ────────────────────────────
    // Data-only overlay: conflict matrix + cluster resolution order in the
    // Inspector. No scene replacement, no widgets, no ghost.
    this._negotiation = false
    /** @type {object|null} the conflict-scenario context kept for re-projection on approval */
    this._negCtx    = null
    /** @type {object|null} cached validateContext() result (no re-validation on approval) */
    this._negResult = null

    // React components fire these via uiStore.callbacks (same unidirectional
    // pattern as the rest of the UI).
    const { registerCallback } = useUIStore.getState().actions
    registerCallback('onContextDemoClick',   ()    => this.enter())
    registerCallback('onContextAuthorClick', ()    => this.enterAuthoring())
    registerCallback('onContextNegotiationClick', () => this.enterNegotiation())
    registerCallback('onDemoStepChange',     (n)   => this.setStep(n))
    registerCallback('onDemoApproveDecision', ()   => this.approveDecision())
    registerCallback('onApproveNegotiationDecision', (ref) => this.approveNegotiationDecision(ref))
    registerCallback('onDemoItemSelect',     (ref) => this.selectItem(ref))
    registerCallback('onDemoExit',           ()    => this.exit())
  }

  /** True while the demo overlay is active. */
  get isActive() { return this._active }

  /** True while the bidirectional region-authoring sub-mode is active. */
  get isAuthoring() { return this._authoring }

  /** True while the negotiation-visualization sub-mode is active. */
  get isNegotiation() { return this._negotiation }

  // ── Entry / exit ───────────────────────────────────────────────────────────

  /** Compiles the example context and starts the demo (replaces the scene). */
  enter() {
    if (this._active) return

    let compiled, scene
    try {
      compiled = compileContext(factoryContext)
      scene    = compileLayout(compiled.layoutDsl)
    } catch (err) {
      // Never a silent no-op (PHILOSOPHY #11)
      this._ctrl._uiView.showToast(`Context compile failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }

    this._ctrl._uiView.showConfirmDialog(
      '現在のシーンを置き換えて Context DSL デモを開始しますか?',
      (ok) => { if (ok) this._start(compiled, scene) },
      { title: 'Context DSL Demo (ADR-046)', confirmLabel: '開始' },
    )
  }

  async _start(compiled, scene) {
    const ctrl = this._ctrl
    const viewContext = {
      camera:    ctrl._camera,
      renderer:  ctrl._sceneView.renderer,
      container: document.body,
    }

    try {
      await ctrl._service.importFromJson(scene, viewContext, { clear: true })
    } catch (err) {
      ctrl._uiView.showToast(`Demo scene load failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }
    // The demo load is not a user edit — it must not appear in undo history
    // (same contract as the constructor's initial solid).
    ctrl._commandStack.clear()
    ctrl._refreshUndoRedoState()

    // Clear stale selection state from the replaced scene (header would keep
    // showing "<old object> selected" otherwise) — same pattern as empty-tap deselect.
    ctrl._selMgr.clearObjectSelection()
    ctrl._selMgr.setObjectSelected(false)

    const layoutDsl = compiled.layoutDsl
    this._layoutDsl = layoutDsl
    this._refToId   = buildRefMap(layoutDsl.entities)

    this._constraintToLinkId = new Map()
    ;(layoutDsl.constraints ?? []).forEach((c, i) => {
      this._constraintToLinkId.set(`constraint:${c.source}→${c.target}`, linkIdForConstraint(i, c))
    })
    this._linkIds = [...this._constraintToLinkId.values()]

    this._traceByFrom = new Map()
    for (const link of compiled.trace) {
      if (!this._traceByFrom.has(link.from)) this._traceByFrom.set(link.from, [])
      this._traceByFrom.get(link.from).push(link.to)
    }

    // Hide everything; story steps reveal progressively. CoordinateFrames are
    // skipped — they are hidden by default and owned by setParentSelected().
    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(false)
    }
    for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, false)
    // The Link Network panel would spoil the staged step-⑤ reveal (it lists
    // every link from the start) and sits under the StoryBar — hide it for
    // the duration of the demo overlay.
    ctrl._linkNetworkView?.setForceHidden(true)

    // Uncertainty ghost from the decision-marker provenance entry (the demo
    // precondition test guarantees exactly one on a Solid position axis).
    const prov = compiled.provenance.find(p =>
      p.marker === 'decision' && p.path.startsWith('position.') && Array.isArray(p.interval)
    )
    if (prov) {
      const entity = layoutDsl.entities.find(e => e.ref === prov.entityRef)
      const axis   = prov.path.split('.')[1]
      this._decisionProv  = prov
      this._ghostTargetId = this._refToId.get(prov.entityRef)
      this._ghost = new UncertaintyGhostView(ctrl._sceneView.scene, document.body, {
        axis,
        interval:  prov.interval,
        nominal:   prov.nominal,
        dims:      entity.dimensions,
        position:  entity.position,
        labelText: `${prov.interval[0]}–${prov.interval[1]} ${prov.unit ?? ''} · 未確定`,
      })
    }

    // Frame the whole cell (mm-scale scene — never rely on the default camera).
    const { center, radius } = this._computeBounds(layoutDsl)
    ctrl._sceneView.fitCameraToSphere(center, radius)

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.demoStart({
      steps:         DEMO_STEPS,
      facts:         factoryContext.given,
      intents:       factoryContext.intents,
      decisions:     factoryContext.decisions,
      obligations:   factoryContext.obligations,
      acceptance:    factoryContext.acceptance,
      openQuestions: compiled.openQuestions,
      blockedChecks: compiled.blockedChecks,
      trace:         compiled.trace,
    })

    this._active     = true
    this._approved   = false
    this._revealDone = false
    this._reveal     = null
    this.setStep(0)
  }

  /** Ends the demo. The compiled scene stays behind as a normal editable scene. */
  exit() {
    if (!this._active) return
    this._active = false
    this._reveal = null

    // Negotiation mode is a data-only overlay — nothing was hidden/replaced, so
    // teardown is just clearing the projections and restoring the Link Network.
    if (this._negotiation) {
      this._negotiation = false
      this._negCtx      = null
      this._negResult   = null
      this._ctrl._linkNetworkView?.setForceHidden(false)
      const ui = useUIStore.getState().actions
      ui.demoSetMatrix(null, [], [])
      ui.demoSetPersonaFilter(null)
      ui.demoEnd()
      return
    }

    // Tear down region-authoring widgets (PHILOSOPHY #9 — symmetric disposal).
    if (this._authoring) {
      this._ctrl._controls.enabled = true
      for (const w of this._authorWidgets) w.widget.dispose()
      this._authorWidgets = []
      this._authorDrag = null
      this._editCtx = null
      this._authoring = false
    }

    if (this._ghost) {
      this._ghost.dispose()
      this._ghost = null
    }

    const ctrl = this._ctrl
    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(true)
    }
    for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, true)
    ctrl._linkNetworkView?.setForceHidden(false)

    useUIStore.getState().actions.demoEnd()
  }

  // ── Story steps ────────────────────────────────────────────────────────────

  /** Applies the declarative visibility state for step n (0–5). */
  setStep(n) {
    if (!this._active) return
    // Authoring sub-mode has a single narration step and no entity staging.
    if (this._authoring) { useUIStore.getState().actions.demoSetStep(0, 'conflicts'); return }
    // Negotiation sub-mode is data-only — keep whichever tab the user picked.
    if (this._negotiation) { useUIStore.getState().actions.demoSetStep(0, useUIStore.getState().demo.inspectorTab ?? 'matrix'); return }
    const step = Math.max(0, Math.min(DEMO_STEPS.length - 1, n))
    // Step ③→④ is gated on approval — "intervals never collapse silently",
    // expressed structurally. (The StoryBar also disables Next; double guard.)
    if (step >= 4 && !this._approved) {
      this._ctrl._uiView.showToast('Decision を承認するまで先に進めません', { type: 'warn' })
      return
    }

    const stagger = step === 4 && this._step < 4 && !this._revealDone
    this._step = step
    useUIStore.getState().actions.demoSetStep(step, TAB_BY_STEP[step])
    this._applyVisibility(stagger)
  }

  _applyVisibility(stagger) {
    const ctrl = this._ctrl
    const show = (ref, visible) => {
      const obj = ctrl._scene.getObject(this._refToId.get(ref))
      obj?.meshView.setVisible(visible)
    }

    const s = this._step

    // Step ② — the site facts: outlet anchor, cell zone, and the interval ghost.
    show('floor_outlet', s >= 1)
    show('cell_area',    s >= 1)
    if (this._ghost) {
      this._ghost.setVisible(!this._approved && s >= 1)
      this._ghost.showNominal(s >= 3)
    }
    // The decided entity (workbench) exists only after approval.
    show('workbench', this._approved && s >= 1)

    // Step ⑤ — the compiled equipment + constraints.
    const equipment = ['base_plate', 'robot', 'container_a', 'container_b']
    if (s >= 4) {
      if (stagger) {
        // Staggered reveal driven by tick(); links appear after the last entity.
        this._reveal = {
          queue: equipment.map(ref => this._revealItemFor(ref)).filter(Boolean),
          nextAt: 0,
        }
      } else if (!this._reveal) {
        for (const ref of equipment) show(ref, true)
        for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, true)
      }
    } else {
      this._reveal = null
      for (const ref of equipment) show(ref, false)
      for (const id of this._linkIds) ctrl._service.setLinkViewVisible(id, false)
    }
  }

  _revealItemFor(ref) {
    const id     = this._refToId.get(ref)
    const entity = this._layoutDsl.entities.find(e => e.ref === ref)
    if (!id || !entity) return null
    const d = entity.dimensions ?? { x: 100, y: 100, z: 100 }
    return {
      id,
      pos:    new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z),
      radius: Math.max(d.x, d.y, d.z) * 0.5,
    }
  }

  // ── Decision approval (the centerpiece) ────────────────────────────────────

  approveDecision() {
    if (!this._active || this._approved || !this._ghost || this._ghost.collapsing) return

    const ctrl = this._ctrl
    this._ghost.startCollapse({
      onSnapped: () => {
        // Band has condensed onto the nominal box — reveal the real solid.
        this._approved = true
        const obj = ctrl._scene.getObject(this._ghostTargetId)
        obj?.meshView.setVisible(true)
        const prov = this._decisionProv
        const entity = this._layoutDsl.entities.find(e => e.ref === prov.entityRef)
        const pos = new THREE.Vector3(entity.position.x, entity.position.y, entity.position.z)
        const d   = entity.dimensions
        ctrl._activeRipples.push(new RippleEffect(
          ctrl._sceneView.scene, pos, 0x3a7bd5, Math.max(d.x, d.y, d.z) * 0.5,
        ))
        useUIStore.getState().actions.demoApproveDecision(prov.ref)
      },
      // Residual fade finishes in tick(); disposal happens there (single place).
    })
  }

  // ── Bidirectional region authoring (ADR-049 Phase 3, §5.2) ──────────────────

  /** Compiles the region scenario and starts the live authoring sub-mode. */
  enterAuthoring() {
    if (this._active) return
    let compiled, scene
    try {
      compiled = compileContext(regionContext)
      scene    = compileLayout(compiled.layoutDsl)
    } catch (err) {
      this._ctrl._uiView.showToast(`Authoring compile failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }
    this._ctrl._uiView.showConfirmDialog(
      '現在のシーンを置き換えて 領域オーサリング (ADR-049 Phase 3) を開始しますか?',
      (ok) => { if (ok) this._startAuthoring(compiled, scene) },
      { title: '領域オーサリング — 衝突のライブ解消', confirmLabel: '開始' },
    )
  }

  async _startAuthoring(compiled, scene) {
    const ctrl = this._ctrl
    const viewContext = { camera: ctrl._camera, renderer: ctrl._sceneView.renderer, container: document.body }
    try {
      await ctrl._service.importFromJson(scene, viewContext, { clear: true })
    } catch (err) {
      ctrl._uiView.showToast(`Authoring scene load failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }
    ctrl._commandStack.clear()
    ctrl._refreshUndoRedoState()
    ctrl._selMgr.clearObjectSelection()
    ctrl._selMgr.setObjectSelected(false)
    ctrl._linkNetworkView?.setForceHidden(true)

    // Mutable copy the widgets edit; the imported JSON stays the authoritative input.
    this._editCtx = JSON.parse(JSON.stringify(regionContext))

    // The compiled zone meshes are hidden — the draggable widgets ARE the regions.
    for (const obj of ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(false)
    }

    // One draggable widget per single-variable region requirement.
    const labels = { r_vision_footprint: 'ビジョン要求', r_mech_footprint: 'メカ要求' }
    this._authorWidgets = []
    for (const req of this._editCtx.requirements) {
      if ((req.constrains?.length ?? 0) !== 1 || !req.admissible?.region) continue
      const widget = new RegionAuthoringWidget(ctrl._sceneView.scene, document.body, {
        region: req.admissible.region,
        handleRadius: 30,
        labelText: labels[req.ref] ?? req.ref,
      })
      this._authorWidgets.push({ reqRef: req.ref, varRef: req.constrains[0], widget })
    }

    const { center, radius } = this._computeBounds(compiled.layoutDsl)
    ctrl._sceneView.fitCameraToSphere(center, radius)

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.demoStart({
      steps: [{
        title: '領域オーサリング — 衝突のライブ解消',
        narration: '各担当の設置許容ゾーンを 3D で直接ドラッグして編集できる。重なれば衝突は消え (緑)、離れれば再発する (赤)。3D は入力デバイス、契約はテキスト DSL のまま (invariant 9)。',
      }],
      facts: [], intents: [], decisions: [], obligations: [], acceptance: [],
      openQuestions: [], blockedChecks: [], trace: [], conflicts: [],
    })
    ui.demoSetStep(0, 'conflicts')

    this._active     = true
    this._authoring  = true
    this._authorDrag = null
    this._revalidate() // initial conflict colouring + inspector population
  }

  /** Re-runs the validator on the edited context and repaints conflict state. */
  _revalidate() {
    const result = validateContext(this._editCtx)
    const conflictVars = new Set(result.conflicts.map(c => c.variable))
    for (const w of this._authorWidgets) w.widget.setConflict(conflictVars.has(w.varRef))
    useUIStore.getState().actions.demoSetConflicts(result.conflicts)
  }

  // Pointer delegation from AppController (returns true when the event is consumed).

  onAuthorPointerDown(e) {
    if (!this._authoring) return false
    if (e.button !== 0 && e.pointerType !== 'touch') return false
    const ctrl = this._ctrl
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const meshes = this._authorWidgets.flatMap(w => w.widget.handleMeshes)
    const hits = ctrl._raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return false // let OrbitControls handle non-handle drags

    const mesh  = hits[0].object
    const entry = this._authorWidgets.find(w => w.widget.handleMeshes.includes(mesh))
    if (!entry) return false
    const pt = new THREE.Vector3()
    if (!ctrl._raycaster.ray.intersectPlane(ctrl._groundPlane, pt)) return false

    entry.widget.startDrag(mesh.userData.handleId, pt)
    this._authorDrag = entry
    ctrl._controls.enabled = false
    ctrl._activeDragPointerId = e.pointerId
    return true
  }

  onAuthorPointerMove(e) {
    if (!this._authoring || !this._authorDrag) return false
    const ctrl = this._ctrl
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const pt = new THREE.Vector3()
    if (!ctrl._raycaster.ray.intersectPlane(ctrl._groundPlane, pt)) return true
    const region = this._authorDrag.widget.dragTo(pt)
    this._editCtx = applyAdmissibleEdit(this._editCtx, this._authorDrag.reqRef, { region })
    this._revalidate()
    return true
  }

  onAuthorPointerUp() {
    if (!this._authoring || !this._authorDrag) return false
    this._authorDrag.widget.endDrag()
    this._authorDrag = null
    this._ctrl._controls.enabled = true
    this._ctrl._activeDragPointerId = null
    return true
  }

  // ── Negotiation visualization (ADR-049 Phase 4) ─────────────────────────────

  /**
   * Loads the multi-actor conflict scenario and shows the persona projections
   * (conflict matrix + negotiation-cluster resolution order) in the Inspector.
   * Data-only: the current scene is left untouched (the conflict scenario's
   * layout is a single AnnotatedRegion — replacing the scene would add nothing).
   */
  enterNegotiation() {
    if (this._active) return
    try {
      compileContext(conflictContext) // validate compilability up front (PHILOSOPHY #11)
    } catch (err) {
      this._ctrl._uiView.showToast(`Negotiation compile failed: ${err.message}`, { type: 'error' })
      console.error('[ContextDemoController]', err)
      return
    }
    this._ctrl._uiView.showConfirmDialog(
      '交渉設計ビューを開きますか? (現在のシーンはそのまま — 衝突マトリックスと解消順序を表示)',
      (ok) => { if (ok) this._startNegotiation() },
      { title: '交渉設計 — 衝突マトリックス × 解消順序 (ADR-049 Phase 4)', confirmLabel: '開く' },
    )
  }

  _startNegotiation() {
    const ctrl   = this._ctrl
    const result = validateContext(conflictContext)
    // Keep ctx + result for re-projection; the approval interaction never
    // re-validates — it only re-applies the approval gate (CODE_CONTRACTS).
    this._negCtx    = conflictContext
    this._negResult = result

    // Open with nothing approved: every conflict/cluster reads `proposed`. The
    // user walks the resolution-order DAG approving each Decision in turn.
    const approvedRefs = new Set()
    const matrix = projectConflictMatrix(conflictContext, result, { approvedRefs })
    const order  = projectResolutionOrder(conflictContext, result, { approvedRefs })

    // The negotiation view is a data overlay — keep the scene, just clear room.
    ctrl._linkNetworkView?.setForceHidden(true)

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.demoStart({
      steps: [{
        title: '交渉設計 — 衝突マトリックスと解消順序',
        narration: '共有設計変数ごとに、誰のどの要求が衝突しているかをマトリックスで一望する。衝突 (R6) と交渉クラスター (R7) はルールが吐く (ADR-049 不変条件7)。解消順序 (DAG) を上から辿り、単一 Decision → n-ary 合同 Decision の順に承認していく。承認するとマトリックスのセルが proposed (◐) → resolved (✓) に変わる。n-ary は上流の衝突をすべて確定してから合同確定できる (不変条件8)。actor 列クリックでペルソナ射影。',
      }],
      facts: [], intents: [], obligations: [], acceptance: [],
      openQuestions: [], blockedChecks: [], trace: [],
      decisions: conflictContext.decisions ?? [],
      conflicts: result.conflicts,
    })
    ui.demoSetMatrix(matrix, result.negotiationClusters, order)
    ui.demoSetStep(0, 'matrix')

    this._active      = true
    this._negotiation = true
  }

  /**
   * Approves a proposed Decision in the negotiation view (single or n-ary) and
   * re-projects the matrix + resolution order with the updated approval set.
   * Pure data overlay: no re-validation (the cached `_negResult` is reused), no
   * scene mutation. The n-ary `d_cell_joint` simultaneously fixes every variable
   * in the cluster it resolves (ADR-049 invariant 8).
   *
   * @param {string} decisionRef — the resolving Decision ref (e.g. d_standoff, d_cell_joint)
   */
  approveNegotiationDecision(decisionRef) {
    if (!this._negotiation || !this._negCtx || !this._negResult) return
    const ui = useUIStore.getState().actions
    ui.demoApproveDecision(decisionRef)

    const approvedRefs = new Set(Object.keys(useUIStore.getState().demo.approvedDecisions))
    const matrix = projectConflictMatrix(this._negCtx, this._negResult, { approvedRefs })
    const order  = projectResolutionOrder(this._negCtx, this._negResult, { approvedRefs })
    ui.demoSetMatrix(matrix, this._negResult.negotiationClusters, order)

    // Summarise the nominal(s) the Decision fixes (single: nominal; n-ary: nominals{}).
    const d = (this._negCtx.decisions ?? []).find(x => x.ref === decisionRef)
    let detail = ''
    if (d?.nominals) {
      detail = Object.entries(d.nominals).map(([v, n]) => `${v.replace(/^v_/, '')}=${n}`).join(', ')
    } else if (d?.nominal != null) {
      detail = `${String(d.resolves).replace(/^conflict_v_/, '')}=${d.nominal}`
    }
    const kind = d?.nominals ? '合同確定' : '確定'
    this._ctrl._uiView.showToast(`${kind}: ${decisionRef}${detail ? ` — ${detail}` : ''}`, { type: 'info' })
  }

  // ── Requirement → 3D traceability ──────────────────────────────────────────

  /**
   * Highlights the spec element(s) derived from a requirement ref.
   * Accepts requirement refs (f_*, d_*, o_*, g_*) and OpenQuestion refs
   * (resolved through their `about` field).
   */
  selectItem(ref) {
    if (!this._active) return
    const ctrl = this._ctrl
    const ui   = useUIStore.getState()
    ui.actions.demoSelectItem(ref)

    // OpenQuestion → the requirement it is about ("f_outlet.attrs.ratedCurrent" → "f_outlet")
    let reqRef = ref
    if (ref.startsWith('oq_')) {
      const oq = ui.demo.openQuestions.find(q => q.ref === ref)
      reqRef = oq?.about?.split('.')[0] ?? ref
    }

    const targets = this._traceByFrom.get(reqRef) ?? []
    if (targets.length === 0) {
      ctrl._uiView.showToast(`${reqRef} から派生した仕様要素はありません`)
      return
    }

    // Prefer an entity target; fall back to constraint targets.
    const entityTarget = targets.find(t => !t.startsWith('constraint:'))
    if (entityTarget) {
      const id  = this._refToId.get(entityTarget)
      const obj = ctrl._scene.getObject(id)
      if (!obj) return
      const meshVisible = obj.meshView.cuboid?.visible ?? true
      if (!meshVisible) {
        ctrl._uiView.showToast(`→ ${obj.name}（後のステップで出現します）`)
        return
      }
      ctrl._switchActiveObject(id, true)
      return
    }

    // Constraint-only targets (e.g. o_power → 給電の connects リンク).
    const linkId = this._constraintToLinkId.get(targets[0])
    const link   = linkId ? ctrl._scene.getLink(linkId) : null
    if (!link) {
      ctrl._uiView.showToast(`${reqRef} → ${targets[0]}`)
      return
    }
    if (this._step >= 4) {
      this._flashLink(linkId)
    }
    const srcName = ctrl._scene.getObject(link.sourceId)?.name ?? link.sourceId
    const tgtName = ctrl._scene.getObject(link.targetId)?.name ?? link.targetId
    ctrl._uiView.showToast(`→ リンク: ${srcName} → ${tgtName} (${link.semanticType})`)
  }

  _flashLink(linkId) {
    const svc = this._ctrl._service
    let count = 0
    const iv = setInterval(() => {
      svc.setLinkViewVisible(linkId, count % 2 === 1)
      count++
      if (count >= 6) {
        clearInterval(iv)
        svc.setLinkViewVisible(linkId, this._active && this._step >= 4)
      }
    }, 150)
  }

  // ── Per-frame animation (driven by AppController's loop) ──────────────────

  tick(t) {
    if (!this._active) return

    if (this._authoring) {
      const cam = this._ctrl._sceneView.activeCamera
      const rdr = this._ctrl._sceneView.renderer
      for (const w of this._authorWidgets) w.widget.tick(t, cam, rdr)
    }

    if (this._ghost) {
      const done = this._ghost.tick(t, this._ctrl._sceneView.activeCamera, this._ctrl._sceneView.renderer)
      if (done) {
        this._ghost.dispose()
        this._ghost = null
      }
    }

    if (this._reveal) {
      if (t >= this._reveal.nextAt) {
        const item = this._reveal.queue.shift()
        if (item) {
          const obj = this._ctrl._scene.getObject(item.id)
          obj?.meshView.setVisible(true)
          this._ctrl._activeRipples.push(new RippleEffect(
            this._ctrl._sceneView.scene, item.pos, 0x10b981, item.radius,
          ))
          this._reveal.nextAt = t + REVEAL_INTERVAL
        }
        if (this._reveal.queue.length === 0) {
          for (const id of this._linkIds) this._ctrl._service.setLinkViewVisible(id, true)
          this._reveal     = null
          this._revealDone = true
        }
      }
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /** Bounding sphere of the compiled layout (pure data — no scene reads). */
  _computeBounds(layoutDsl) {
    const box = new THREE.Box3()
    for (const e of layoutDsl.entities) {
      if (e.position && e.dimensions) {
        const { x, y, z } = e.position
        const d = e.dimensions
        box.expandByPoint(new THREE.Vector3(x - d.x / 2, y - d.y / 2, z - d.z / 2))
        box.expandByPoint(new THREE.Vector3(x + d.x / 2, y + d.y / 2, z + d.z / 2))
      } else if (e.position) {
        box.expandByPoint(new THREE.Vector3(e.position.x, e.position.y, e.position.z))
      }
      if (Array.isArray(e.vertices)) {
        for (const v of e.vertices) box.expandByPoint(new THREE.Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0))
      }
    }
    if (box.isEmpty()) return { center: new THREE.Vector3(), radius: 10 }
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1)
    return { center, radius }
  }
}
