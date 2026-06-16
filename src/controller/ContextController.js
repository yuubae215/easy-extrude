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
 * Scope:
 *   - Phase 2 — Negotiation (data only): `enterNegotiation()` projects the conflict
 *     matrix + resolution order; `approveDecision(ref)` is undoable through
 *     `createApproveDecisionCommand` (doc mutation `status: proposed → agreed`).
 *   - Phase 3 — Authoring + region ghosts (3D, ADR-050 §6/§4.5):
 *       · `enterAuthoring()` drives `RegionAuthoringWidget`s over the loaded doc's
 *         single-variable region requirements. A live drag recolours only
 *         (optimistic — PHILOSOPHY #7) against a cloned edit context; on pointer-up
 *         the finished edit is committed once through `createEditAdmissibleCommand`
 *         so the whole drag is a single **undoable** doc mutation that regenerates
 *         the derived scene (ADR-050 §3.5, §7 — full regen deferred to drag end).
 *       · `enterRegionGhost()` overlays each actor's admissible footprint in its
 *         persona colour (`RegionGhostView`, the read-only output projection) and
 *         mirrors the conflict-matrix persona filter into 3-D ghost dimming.
 *
 * Re-projection is event-driven: the controller subscribes to ContextService's
 * `contextChanged` (emitted by approval / region edit / undo / redo) and repaints
 * from there — approve / undo / redo all flow through one path (PHILOSOPHY #5).
 *
 * All side effects live here (PHILOSOPHY #3); projection / validation stay in the
 * pure `src/context/*` layer, reached through ContextService (or directly for the
 * live-drag recolour, which must not mutate the canonical doc). The widgets and
 * ghost views are solely owned here (PHILOSOPHY #4/#9): created on enter, disposed
 * on exit.
 */
import * as THREE from 'three'
import { useUIStore } from '../store/uiStore.js'
import { createApproveDecisionCommand } from '../command/ApproveDecisionCommand.js'
import { createEditAdmissibleCommand } from '../command/EditAdmissibleCommand.js'
import { createAnswerQuestionCommand } from '../command/AnswerQuestionCommand.js'
import { createAddDocEntryCommand } from '../command/AddDocEntryCommand.js'
import { validateContext } from '../context/ContextValidator.js'
import { applyAdmissibleEdit } from '../context/ContextEditModel.js'
import { applyQuestionAnswer } from '../context/FormApplication.js'
import { createBlankDoc, addActor, addFact, addVariable, addRequirement } from '../context/DocBuilder.js'
import { getTemplateMeta, exampleFiles } from '../context/TemplateCatalog.js'
import { RegionAuthoringWidget } from '../view/RegionAuthoringWidget.js'
import { RegionGhostView, personaColor } from '../view/RegionGhostView.js'
import { UncertaintyGhostView } from '../view/UncertaintyGhostView.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import conflictContext from '../../examples/cell_conflict_context.json'
import regionContext from '../../examples/cell_region_context.json'
import phase2Context from '../../examples/cell_phase2_context.json'

/**
 * Bundled example docs the template gallery (ADR-051 Phase 2) can seed from,
 * keyed by the filename referenced in `TemplateCatalog`. Resolving a
 * `kind:'example'` template to a doc is a side effect (static JSON import) and so
 * lives here, not in the pure catalog.
 */
const TEMPLATE_DOCS = {
  'cell_conflict_context.json': conflictContext,
  'cell_region_context.json':   regionContext,
  'cell_phase2_context.json':   phase2Context,
}

// Fail loudly at module load if the catalog references a file with no bundled doc
// (PHILOSOPHY #11 — never let a gallery card silently load nothing).
for (const file of exampleFiles()) {
  if (!TEMPLATE_DOCS[file]) {
    console.error(`[ContextController] TemplateCatalog references "${file}" but no bundled doc is mapped in TEMPLATE_DOCS`)
  }
}

export class ContextController {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl       = ctrl
    this._ctxService = ctrl._ctxService

    /** Active overlay sub-mode: null | 'negotiate' | 'author' | 'ghost'. */
    this._mode = null

    // ── Region authoring (Phase 3, §4.5) ───────────────────────────────────────
    /** @type {{reqRef:string, varRef:string, widget:RegionAuthoringWidget}[]} */
    this._authorWidgets = []
    /** @type {{reqRef:string, varRef:string, widget:RegionAuthoringWidget, before:object}|null} */
    this._authorDrag = null
    /** @type {object|null} cloned context the live drag recolours (never the canonical doc) */
    this._editCtx = null

    // ── Region ghost overlay (Phase 3, §5.3) ───────────────────────────────────
    /** @type {RegionGhostView[]} sole owner — disposed in exit() (PHILOSOPHY #9) */
    this._regionGhosts = []
    /** @type {string|null} last persona filter pushed to the ghost views */
    this._ghostFilter = null

    // ── Live intake preview (ADR-051 Phase 3, Entry D) ─────────────────────────
    /** @type {UncertaintyGhostView|null} live admissible-interval ghost (sole owner) */
    this._intakeGhost = null

    // Re-project whenever the canonical document changes — covers approval, region
    // edit, undo, and redo uniformly (they all mutate the doc through the service).
    this._ctxService.on('contextChanged', () => this._reproject())

    const { registerCallback } = useUIStore.getState().actions
    registerCallback('onNewContext',             ()           => this.newContext())
    registerCallback('onOpenTemplateGallery',    ()           => this.openTemplateGallery())
    registerCallback('onCloseTemplateGallery',   ()           => this.closeTemplateGallery())
    registerCallback('onSelectTemplate',         (id)         => this.selectTemplate(id))
    registerCallback('onContextNegotiate',       ()           => this.enterNegotiation())
    registerCallback('onContextAuthor',          ()           => this.enterAuthoring())
    registerCallback('onContextRegionGhost',     ()           => this.enterRegionGhost())
    registerCallback('onApproveContextDecision', (ref)        => this.approveDecision(ref))
    registerCallback('onAnswerQuestion',         (ref, q, a)  => this.answerQuestion(ref, q, a))
    registerCallback('onAddDocEntry',            (type, data) => this.addDocEntry(type, data))
    registerCallback('onIntakePreview',          (spec)       => this.previewIntake(spec))
    registerCallback('onAddNlFacts',             (facts)      => this.addNlFacts(facts))
    registerCallback('onContextExit',            ()           => this.exit())
    registerCallback('onImportCtxJson',          ()           => this.importContextFile())
    registerCallback('onExportCtxJson',          ()           => this.exportContextFile())
  }

  /** True while any context overlay is active. */
  get isActive()      { return this._mode !== null }
  /** True while the negotiation overlay is active. */
  get isNegotiation() { return this._mode === 'negotiate' }
  /** True while the region-authoring overlay is active. */
  get isAuthoring()   { return this._mode === 'author' }
  /** True while the region-ghost overlay is active. */
  get isRegionGhost() { return this._mode === 'ghost' }

  // ── Blank-doc creation (Phase 1 — Entry A, ADR-051 §3) ──────────────────────

  /**
   * Create a blank context document and open the negotiate overlay (intake mode).
   * Clears the current scene after confirmation — blank doc has no layout spec,
   * so `adoptDoc()` is used instead of `loadContext()` (no compile/layout step).
   */
  newContext() {
    if (this.isActive) return
    this._ctrl._uiView.showConfirmDialog(
      '空の Context ドキュメントを作成します。現在のシーンはリセットされます。\n' +
      '要件入力パネルでアクター・変数・要件を追加してください (ADR-051 §3 Entry A)。',
      (ok) => {
        if (!ok) return
        const doc = createBlankDoc()
        Promise.resolve(this._ctxService.adoptDoc(doc, this._viewContext()))
          .then(() => this._startNegotiation())
          .catch(err => {
            this._ctrl._uiView.showToast(`Context 作成失敗: ${err.message}`, { type: 'error' })
            console.error('[ContextController]', err)
          })
      },
      { title: '新規 Context', confirmLabel: '作成' },
    )
  }

  // ── Template gallery (Phase 2 — Entry B, ADR-051 §3) ────────────────────────

  /** Open the starter-template picker modal. */
  openTemplateGallery() {
    useUIStore.getState().actions.setTemplateGalleryOpen(true)
  }

  /** Close the starter-template picker modal. */
  closeTemplateGallery() {
    useUIStore.getState().actions.setTemplateGalleryOpen(false)
  }

  /**
   * Load a starter template by id and open the negotiate overlay. The gallery's
   * footer already states the scene-replacement consequence (ADR-051 §7), so no
   * second confirm dialog is shown. A blank template uses `adoptDoc` (no layout);
   * an example template uses `loadContext` (regenerates the derived scene). Any
   * active overlay is exited first so its widgets / ghosts are disposed cleanly
   * (PHILOSOPHY #9) before the new doc replaces the scene.
   *
   * @param {string} id — TemplateCatalog entry id
   */
  selectTemplate(id) {
    const meta = getTemplateMeta(id)
    if (!meta) {
      this._ctrl._uiView.showToast(`未知のテンプレート: ${id}`, { type: 'warn' })
      return
    }
    this.closeTemplateGallery()
    if (this.isActive) this.exit()

    if (meta.source.kind === 'blank') {
      Promise.resolve(this._ctxService.adoptDoc(createBlankDoc(meta.name), this._viewContext()))
        .then(() => this._startNegotiation())
        .catch(err => {
          this._ctrl._uiView.showToast(`テンプレート読み込み失敗: ${err.message}`, { type: 'error' })
          console.error('[ContextController]', err)
        })
      return
    }

    const doc = TEMPLATE_DOCS[meta.source.file]
    if (!doc) {
      this._ctrl._uiView.showToast(`テンプレート定義が見つかりません: ${meta.source.file}`, { type: 'error' })
      return
    }
    this._loadThen(doc, () => this._startNegotiation())
  }

  /**
   * Add a doc entry (actor / fact / variable / requirement) through the CommandStack
   * so the addition is undoable. Dispatches to the appropriate pure DocBuilder
   * function (input-immutable, PHILOSOPHY #6), then commits via AddDocEntryCommand.
   *
   * @param {'actor'|'fact'|'variable'|'requirement'} type
   * @param {object} data — shaped by type
   */
  addDocEntry(type, data) {
    if (!this.isNegotiation) return
    const ctrl      = this._ctrl
    const beforeDoc = this._ctxService.getDoc()
    let afterDoc
    switch (type) {
      case 'actor':       afterDoc = addActor(beforeDoc, data);       break
      case 'fact':        afterDoc = addFact(beforeDoc, data);         break
      case 'variable':    afterDoc = addVariable(beforeDoc, data);     break
      case 'requirement': afterDoc = addRequirement(beforeDoc, data);  break
      default:
        ctrl._uiView.showToast(`未知のエントリ種別: ${type}`, { type: 'warn' })
        return
    }
    const label = { actor: 'Actor 追加', fact: 'Fact 追加', variable: 'Variable 追加', requirement: 'Requirement 追加' }[type]
    const cmd = createAddDocEntryCommand(this._ctxService, beforeDoc, afterDoc, label, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)
        ctrl._refreshUndoRedoState()
      })
      .catch(err => {
        ctrl._uiView.showToast(`エントリを追加できません: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
      })
  }

  // ── Natural-language intake (Phase 4 — Entry C, ADR-051 §3) ─────────────────

  /**
   * Fold a batch of NL-extracted Fact fragments into the canonical doc as a single
   * undoable mutation. The fragments come from the pure `extractFacts` bridge (the
   * panel computes + previews them; this method only performs the side effect).
   * Conservative facts (`status:'unknown'`) raise OpenQuestions the FormPanel then
   * resolves — the NL bridge never silently fixes a value (ADR-051 §Negative).
   *
   * @param {object[]} facts — `given[]`-shaped fragments from NlIntake.extractFacts
   */
  addNlFacts(facts) {
    if (!this.isNegotiation) return
    if (!Array.isArray(facts) || facts.length === 0) return
    const ctrl = this._ctrl
    const beforeDoc = this._ctxService.getDoc()
    const afterDoc  = facts.reduce((doc, f) => addFact(doc, f), beforeDoc)

    const label = `NL 取り込み (${facts.length} Fact)`
    const cmd = createAddDocEntryCommand(this._ctxService, beforeDoc, afterDoc, label, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)
        ctrl._refreshUndoRedoState()
        const unknown = facts.filter(f => f.status === 'unknown').length
        ctrl._uiView.showToast(
          `${facts.length} 件の Fact を取り込みました${unknown ? `（うち ${unknown} 件は要確定）` : ''}`,
        )
      })
      .catch(err => {
        ctrl._uiView.showToast(`NL 取り込みに失敗しました: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
      })
  }

  // ── Live intake preview (Phase 3 — Entry D, ADR-051 §3) ─────────────────────

  /**
   * Drive a single live uncertainty-band ghost from the IntakePanel's admissible
   * interval inputs (ADR-051 Entry D). As the user types `[lo, hi]` the band
   * grows / shrinks in 3-D, making the uncertainty of an unfixed acceptance band
   * tangible (ADR-047 ghost lineage; the band is only collapsed by an explicit
   * Decision — ADR-046 invariant 2). `spec === null` clears the preview.
   *
   * The ghost is reused across keystrokes (updated in place — PHILOSOPHY #4/#9);
   * the camera is framed once when it first appears (re-framing per keystroke
   * would be disorienting). Sole owner: created here, disposed in `previewIntake(null)`
   * and `exit()`.
   *
   * @param {{ lo:number, hi:number, unit?:string, label?:string }|null} spec
   */
  previewIntake(spec) {
    if (!this.isNegotiation || !spec) { this._disposeIntakeGhost(); return }
    const { lo, hi, unit = '', label = 'requirement' } = spec
    if (!(hi > lo)) { this._disposeIntakeGhost(); return }

    const nominal   = (lo + hi) / 2
    const labelText = `${label}: ${fmtNum(lo)}–${fmtNum(hi)} ${unit} · 未確定`

    if (this._intakeGhost) {
      this._intakeGhost.setIntervalPreview({ interval: [lo, hi], nominal, labelText })
      return
    }

    // First appearance — pick a fixed slab thickness from the initial span and
    // frame the camera once (subsequent updates only move / rescale the band).
    const span = Math.max(hi - lo, 1e-6)
    const side = Math.max(span * 0.5, 1)
    const dims = { x: Math.max(span * 0.15, 0.5), y: side, z: side }
    const position = { x: 0, y: 0, z: dims.z / 2 }

    this._intakeGhost = new UncertaintyGhostView(this._ctrl._sceneView.scene, document.body, {
      axis: 'x', interval: [lo, hi], nominal, dims, position, labelText,
    })
    this._intakeGhost.showNominal(true)

    const center = new THREE.Vector3(nominal, 0, dims.z / 2)
    const radius = Math.max(span / 2 + dims.x, side)
    this._ctrl._sceneView.fitCameraToSphere(center, radius)
  }

  _disposeIntakeGhost() {
    if (!this._intakeGhost) return
    this._intakeGhost.dispose()
    this._intakeGhost = null
  }

  // ── Negotiation (Phase 2, data only) ─────────────────────────────────────────

  /**
   * Open the negotiation view over the loaded context document. If no document
   * is loaded yet, bootstrap the bundled conflict example (real `.ctx.json`
   * import is Phase 4); loading a context regenerates the derived scene
   * (invariant 9), so confirm before replacing the current scene.
   */
  enterNegotiation() {
    if (this.isActive) return
    if (this._ctxService.loaded) { this._startNegotiation(); return }
    this._ctrl._uiView.showConfirmDialog(
      'コンテキストを読み込んで交渉設計ビューを開きますか? (現在のシーンは要求から再生成されます)',
      (ok) => { if (ok) this._loadThen(conflictContext, () => this._startNegotiation()) },
      { title: '交渉設計 — 衝突マトリックス × 解消順序 (ADR-050)', confirmLabel: '開く' },
    )
  }

  _startNegotiation() {
    const ctrl   = this._ctrl
    const doc    = this._ctxService.getDoc()
    const result = this._ctxService.getValidatorResult()

    ctrl._linkNetworkView?.setForceHidden(true)

    const form = this._ctxService.projectForm()
    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.contextStart({
      mode:                'negotiate',
      loaded:              true,
      docMeta:             { name: doc?.meta?.name ?? 'Context', version: doc?.version },
      decisions:           doc?.decisions ?? [],
      actors:              doc?.actors ?? [],
      variables:           doc?.variables ?? [],
      conflicts:           result.conflicts,
      negotiationClusters: result.negotiationClusters,
      conflictMatrix:      this._ctxService.projectMatrix(),
      resolutionOrder:     this._ctxService.projectOrder(),
      form,
    })
    // Blank doc (no actors) opens on intake tab so the user can start adding entries.
    const initialTab = form.length > 0 ? 'questions'
      : (doc?.actors?.length ?? 0) === 0 ? 'intake'
      : 'matrix'
    ui.contextSetTab(initialTab)
    this._mode = 'negotiate'
  }

  // ── Region authoring (Phase 3, §4.5) ─────────────────────────────────────────

  /**
   * Start the live region-authoring overlay. The loaded doc must carry
   * single-variable region requirements; if it does not (nothing loaded, or a
   * non-region scenario like the conflict example is loaded), bootstrap the
   * bundled region example — loading regenerates the scene (invariant 9), so
   * confirm first.
   */
  enterAuthoring() {
    if (this.isActive) return
    if (this._ctxService.loaded && this._regionReqs(this._ctxService.getDoc()).length > 0) {
      this._startAuthoring(); return
    }
    this._ctrl._uiView.showConfirmDialog(
      '現在のシーンを置き換えて 領域オーサリング (ADR-050 Phase 3) を開始しますか?',
      (ok) => { if (ok) this._loadThen(regionContext, () => this._startAuthoring()) },
      { title: '領域オーサリング — 衝突のライブ解消', confirmLabel: '開始' },
    )
  }

  _startAuthoring() {
    const ctrl = this._ctrl
    const doc  = this._ctxService.getDoc()

    ctrl._linkNetworkView?.setForceHidden(true)
    // The compiled zone meshes are hidden — the draggable widgets ARE the regions.
    this._hideDerivedMeshes()

    // Mutable clone the live drag recolours; the canonical doc stays authoritative.
    this._editCtx = JSON.parse(JSON.stringify(doc))

    this._authorWidgets = []
    for (const req of this._regionReqs(doc)) {
      const widget = new RegionAuthoringWidget(ctrl._sceneView.scene, document.body, {
        region: req.admissible.region,
        handleRadius: 30,
        labelText: req.by ?? req.ref,
      })
      this._authorWidgets.push({ reqRef: req.ref, varRef: req.constrains[0], widget })
    }

    this._fitToCompiled()

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.contextStart({
      mode:     'author',
      loaded:   true,
      docMeta:  { name: doc?.meta?.name ?? 'Context', version: doc?.version },
      conflicts: [],
    })
    ui.contextSetTab('conflicts')
    this._mode = 'author'
    this._authorDrag = null
    this._recolourAuthoring(validateContext(this._editCtx))
  }

  /** Recolour widgets + publish conflicts from a validator result. */
  _recolourAuthoring(result) {
    const conflictVars = new Set(result.conflicts.map(c => c.variable))
    for (const w of this._authorWidgets) w.widget.setConflict(conflictVars.has(w.varRef))
    useUIStore.getState().actions.contextSetConflicts(result.conflicts)
  }

  // Pointer delegation from AppController (returns true when the event is consumed).

  onAuthorPointerDown(e) {
    if (!this.isAuthoring) return false
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

    // Snapshot the admissible at pointer-down — the undo target of the whole drag.
    entry.before = { region: entry.widget.getRegion() }
    entry.widget.startDrag(mesh.userData.handleId, pt)
    this._authorDrag = entry
    ctrl._controls.enabled = false
    ctrl._activeDragPointerId = e.pointerId
    return true
  }

  onAuthorPointerMove(e) {
    if (!this.isAuthoring || !this._authorDrag) return false
    const ctrl = this._ctrl
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const pt = new THREE.Vector3()
    if (!ctrl._raycaster.ray.intersectPlane(ctrl._groundPlane, pt)) return true
    // Live recolour ONLY (optimistic) — re-validate the cloned edit context, never
    // the canonical doc. Full regeneration is deferred to pointer-up (§7).
    const region = this._authorDrag.widget.dragTo(pt)
    this._editCtx = applyAdmissibleEdit(this._editCtx, this._authorDrag.reqRef, { region })
    this._recolourAuthoring(validateContext(this._editCtx))
    return true
  }

  onAuthorPointerUp() {
    if (!this.isAuthoring || !this._authorDrag) return false
    const drag = this._authorDrag
    drag.widget.endDrag()
    this._authorDrag = null
    this._ctrl._controls.enabled = true
    this._ctrl._activeDragPointerId = null

    const after = { region: drag.widget.getRegion() }
    // Skip a no-op drag (a tap on a handle with no movement).
    if (JSON.stringify(after.region) !== JSON.stringify(drag.before.region)) {
      this._commitRegionEdit(drag.reqRef, drag.before, after)
    }
    return true
  }

  /**
   * Commit a finished region edit through the CommandStack so it is undoable. The
   * command mutates the canonical doc + regenerates (ADR-050 §3.5); the service's
   * `contextChanged` event then drives `_reproject()`. If the edit would orphan a
   * Decision (resolves a conflict R6 no longer emits — ADR-049 invariant 7),
   * compileContext throws; we surface it and roll the widget back (PHILOSOPHY #11).
   */
  _commitRegionEdit(reqRef, before, after) {
    const ctrl = this._ctrl
    const cmd = createEditAdmissibleCommand(this._ctxService, reqRef, before, after, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)   // post-hoc record (CODE_CONTRACTS push vs execute)
        ctrl._refreshUndoRedoState()
      })
      .catch((err) => {
        ctrl._uiView.showToast(`領域編集を適用できません: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
        const entry = this._authorWidgets.find(w => w.reqRef === reqRef)
        entry?.widget.setRegion(before.region)
        this._editCtx = applyAdmissibleEdit(this._editCtx, reqRef, before)
        this._recolourAuthoring(validateContext(this._editCtx))
      })
  }

  // ── Region ghost overlay (Phase 3, §5.3) ─────────────────────────────────────

  /**
   * Overlay each actor's admissible footprint as a persona-coloured ghost. As with
   * authoring the loaded doc must carry region requirements; bootstrap the region
   * example otherwise (regenerates the scene — confirm first).
   */
  enterRegionGhost() {
    if (this.isActive) return
    if (this._ctxService.loaded && this._regionReqs(this._ctxService.getDoc()).length > 0) {
      this._startRegionGhost(); return
    }
    this._ctrl._uiView.showConfirmDialog(
      '現在のシーンを置き換えて 許容領域ゴースト重畳 (ADR-050 Phase 3) を開きますか?',
      (ok) => { if (ok) this._loadThen(regionContext, () => this._startRegionGhost()) },
      { title: '許容領域ゴースト — actor 別色分け重畳', confirmLabel: '開く' },
    )
  }

  _startRegionGhost() {
    const ctrl   = this._ctrl
    const doc    = this._ctxService.getDoc()
    const result = this._ctxService.getValidatorResult()

    ctrl._linkNetworkView?.setForceHidden(true)
    // The compiled zone meshes are hidden — the persona ghosts ARE the regions.
    this._hideDerivedMeshes()

    const actorOrder = (doc.actors ?? []).map(a => a.ref)
    this._regionGhosts = []
    for (const g of this._ctxService.projectGhosts()) {
      const regions = g.regions.map(r => ({
        ...r, color: personaColor(Math.max(0, actorOrder.indexOf(r.actor))),
      }))
      this._regionGhosts.push(new RegionGhostView(ctrl._sceneView.scene, document.body, { ...g, regions }))
    }

    this._fitToCompiled()

    const ui = useUIStore.getState().actions
    ui.setNPanelVisible(false)
    ui.contextStart({
      mode:                'ghost',
      loaded:              true,
      docMeta:             { name: doc?.meta?.name ?? 'Context', version: doc?.version },
      decisions:           doc?.decisions ?? [],
      conflicts:           result.conflicts,
      negotiationClusters: result.negotiationClusters,
      conflictMatrix:      this._ctxService.projectMatrix(),
      resolutionOrder:     this._ctxService.projectOrder(),
    })
    ui.contextSetPersonaFilter(null)
    ui.contextSetTab('matrix')
    this._mode = 'ghost'
    this._ghostFilter = null
  }

  // ── Decision approval (undoable doc mutation, ADR-050 §3.5) ───────────────────

  /**
   * Approve a proposed Decision (single or n-ary) through the CommandStack so it
   * is undoable. The matrix transition (`proposed ◐ → resolved ✓`) follows from
   * the doc-derived `approvedRefs` and is repainted by `_reproject()` via the
   * service's `contextChanged` event.
   *
   * @param {string} decisionRef — e.g. d_standoff (single), d_cell_joint (n-ary)
   */
  approveDecision(decisionRef) {
    if (!this.isNegotiation) return
    const ctrl = this._ctrl

    const cmd = createApproveDecisionCommand(this._ctxService, decisionRef, this._viewContext())
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

  // ── Form answer (undoable doc mutation, ADR-050 §3.5) ────────────────────────

  /**
   * Commit a form-question answer through the CommandStack so it is undoable.
   * `applyQuestionAnswer` builds the afterDoc (pure, input-immutable); both
   * before and after are snapshotted. The command calls `applyContextDoc` with
   * `regenerate:true` — answers may change derived geometry (e.g. a fact value
   * promotes a `stated` admissible to `derived`, shifting a zone).
   *
   * Re-projection (including form shrinkage) flows through `contextChanged` →
   * `_reproject()` (PHILOSOPHY #5) — not done inline here.
   *
   * @param {string} qRef — OpenQuestion ref
   * @param {{ ref, target, answerKind }} question — from FormPanel
   * @param {object} answer — shaped by answerKind
   */
  answerQuestion(qRef, question, answer) {
    if (!this.isNegotiation) return
    const ctrl = this._ctrl
    const beforeDoc = this._ctxService.getDoc()
    const afterDoc  = applyQuestionAnswer(beforeDoc, question, answer)
    const cmd = createAnswerQuestionCommand(this._ctxService, qRef, beforeDoc, afterDoc, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)
        ctrl._refreshUndoRedoState()
      })
      .catch((err) => {
        ctrl._uiView.showToast(`回答を適用できません: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
      })
  }

  // ── .ctx.json import / export (ADR-050 §5) ────────────────────────────────────

  /**
   * Open a file picker for `.ctx.json` files, parse, and load via ContextService.
   * On success: scene is regenerated, undo history is cleared (project-open boundary
   * — same contract as `loadContext` in AppController._onContextLoaded). Then
   * automatically enter negotiate mode so the user sees the matrix + questions.
   * Side-effectful; must only be called from a user gesture.
   */
  importContextFile() {
    const input = document.createElement('input')
    input.type   = 'file'
    input.accept = '.ctx.json,.json'
    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        let doc
        try {
          doc = JSON.parse(ev.target.result)
        } catch {
          this._ctrl._uiView.showToast(`JSON 解析エラー: ${file.name}`, { type: 'error' })
          return
        }
        this._loadThen(doc, () => this._startNegotiation())
      }
      reader.readAsText(file)
    })
    input.click()
  }

  /**
   * Download the current canonical Context DSL document as a `.ctx.json` file.
   * The doc IS the project artifact — no compilation or conversion needed.
   */
  exportContextFile() {
    const doc = this._ctxService.getDoc()
    if (!doc) {
      this._ctrl._uiView.showToast('コンテキストが読み込まれていません', { type: 'warn' })
      return
    }
    const name      = doc?.meta?.name ?? 'context'
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const filename  = `${name.replace(/\s+/g, '_')}-${timestamp}.ctx.json`
    const blob      = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
    const url       = URL.createObjectURL(blob)
    const a         = document.createElement('a')
    a.href          = url
    a.download      = filename
    a.click()
    URL.revokeObjectURL(url)
    this._ctrl._uiView.showToast(`Saved: ${filename}`)
  }

  // ── Re-projection (event-driven — covers approve / region edit / undo / redo) ──

  _reproject() {
    if (this._mode === 'negotiate' || this._mode === 'ghost') {
      const result = this._ctxService.getValidatorResult()
      const ui = useUIStore.getState().actions
      ui.contextSetMatrix(
        this._ctxService.projectMatrix(),
        result.negotiationClusters,
        this._ctxService.projectOrder(),
      )
      ui.contextSetConflicts(result.conflicts)
      // Update the form so answered questions disappear immediately (PHILOSOPHY #5).
      // Also refresh actors and variables so IntakePanel dropdowns stay current.
      if (this._mode === 'negotiate') {
        ui.contextSetForm(this._ctxService.projectForm())
        const doc = this._ctxService.getDoc()
        ui.contextSetActors(doc?.actors ?? [])
        ui.contextSetVars(doc?.variables ?? [])
      }
    } else if (this._mode === 'author') {
      // A committed / undone region edit regenerated the scene — re-hide the
      // derived meshes, resync the edit clone, and recolour from the new doc.
      this._hideDerivedMeshes()
      this._editCtx = JSON.parse(JSON.stringify(this._ctxService.getDoc()))
      this._syncAuthorWidgets()
      this._recolourAuthoring(this._ctxService.getValidatorResult())
    }
  }

  /** Resync widget regions to the canonical doc (after undo / redo of an edit). */
  _syncAuthorWidgets() {
    const byRef = new Map(this._regionReqs(this._ctxService.getDoc()).map(r => [r.ref, r]))
    for (const w of this._authorWidgets) {
      const req = byRef.get(w.reqRef)
      if (req?.admissible?.region) w.widget.setRegion(req.admissible.region)
    }
  }

  // ── Exit ──────────────────────────────────────────────────────────────────────

  /** Close the active overlay (the regenerated scene stays behind). */
  exit() {
    if (!this.isActive) return
    const ctrl = this._ctrl
    const ui = useUIStore.getState().actions

    this._disposeIntakeGhost()   // live intake preview is only valid inside an overlay

    if (this._mode === 'author') {
      ctrl._controls.enabled = true
      for (const w of this._authorWidgets) w.widget.dispose()
      this._authorWidgets = []
      this._authorDrag = null
      this._editCtx = null
      this._showDerivedMeshes()
    } else if (this._mode === 'ghost') {
      for (const v of this._regionGhosts) v.dispose()
      this._regionGhosts = []
      this._ghostFilter = null
      this._showDerivedMeshes()
    }

    ctrl._linkNetworkView?.setForceHidden(false)
    ui.contextEnd()
    this._mode = null
  }

  // ── Per-frame animation (driven by AppController's loop) ──────────────────────

  tick(t) {
    // Live intake preview pulses in negotiate mode (Phase 3 — Entry D).
    if (this._intakeGhost) {
      this._intakeGhost.tick(t, this._ctrl._sceneView.activeCamera, this._ctrl._sceneView.renderer)
    }
    if (this._mode === 'author') {
      const cam = this._ctrl._sceneView.activeCamera
      const rdr = this._ctrl._sceneView.renderer
      for (const w of this._authorWidgets) w.widget.tick(t, cam, rdr)
    } else if (this._mode === 'ghost') {
      const cam = this._ctrl._sceneView.activeCamera
      const rdr = this._ctrl._sceneView.renderer
      // Mirror the conflict-matrix persona filter into the 3-D ghost dimming.
      const filter = useUIStore.getState().context.personaFilter
      if (filter !== this._ghostFilter) {
        this._ghostFilter = filter
        for (const v of this._regionGhosts) v.setPersonaFilter(filter)
      }
      for (const v of this._regionGhosts) v.tick(t, cam, rdr)
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  _viewContext() {
    return { camera: this._ctrl._camera, renderer: this._ctrl._sceneView.renderer, container: document.body }
  }

  /** Load a document then run a start function; toasts on failure (PHILOSOPHY #11). */
  async _loadThen(doc, start) {
    try {
      // loadContext emits contextLoaded → AppController._onContextLoaded does the
      // scene-side housekeeping (clear undo/selection, frame the camera).
      await this._ctxService.loadContext(doc, this._viewContext())
    } catch (err) {
      this._ctrl._uiView.showToast(`Context load failed: ${err.message}`, { type: 'error' })
      console.error('[ContextController]', err)
      return
    }
    start()
  }

  /** Single-variable region requirements of a doc (the authorable / ghostable set). */
  _regionReqs(doc) {
    return (doc?.requirements ?? []).filter(
      r => (r.constrains?.length ?? 0) === 1 && r.admissible?.region,
    )
  }

  _hideDerivedMeshes() {
    for (const obj of this._ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(false)
    }
  }

  _showDerivedMeshes() {
    for (const obj of this._ctrl._scene.objects.values()) {
      if (!(obj instanceof CoordinateFrame)) obj.meshView.setVisible(true)
    }
  }

  /** Frame the camera on the compiled layout (mm-scale scene — never the default). */
  _fitToCompiled() {
    const layoutDsl = this._ctxService.getCompiled()?.layoutDsl
    if (!layoutDsl) return
    const box = new THREE.Box3()
    for (const e of layoutDsl.entities) {
      if (e.position && e.dimensions) {
        const { x, y, z } = e.position, d = e.dimensions
        box.expandByPoint(new THREE.Vector3(x - d.x / 2, y - d.y / 2, z - d.z / 2))
        box.expandByPoint(new THREE.Vector3(x + d.x / 2, y + d.y / 2, z + d.z / 2))
      } else if (e.position) {
        box.expandByPoint(new THREE.Vector3(e.position.x, e.position.y, e.position.z))
      }
      if (Array.isArray(e.vertices)) {
        for (const v of e.vertices) box.expandByPoint(new THREE.Vector3(v.x ?? 0, v.y ?? 0, v.z ?? 0))
      }
    }
    if (box.isEmpty()) return
    const center = box.getCenter(new THREE.Vector3())
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1)
    this._ctrl._sceneView.fitCameraToSphere(center, radius)
  }
}

/** Compact number formatting for the intake ghost label (drops trailing zeros). */
function fmtNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}
