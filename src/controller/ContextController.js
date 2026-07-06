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
import { createDocEditCommand } from '../command/DocEditCommand.js'
import { validateContext } from '../context/ContextValidator.js'
import { applyAdmissibleEdit } from '../context/ContextEditModel.js'
import { applyQuestionAnswer } from '../context/FormApplication.js'
import {
  createBlankDoc, addActor, addFact, addVariable, addRequirement,
  updateActor, updateVariable, updateRequirement, removeDocEntry,
} from '../context/DocBuilder.js'
import { getTemplateMeta, exampleFiles } from '../context/TemplateCatalog.js'
import { canonicalForm } from '../context/CanonicalForm.js'
import { structurePreview } from '../view/TemplatePreviewMath.js'
import {
  WIZARD_CATALOG, CELL_INTAKE_WIZARD,
  startWizard, nextWizardState, prevWizardState, wizardStepGaps,
} from '../context/WizardCatalog.js'
import {
  getParametricAsset, clampParams, instantiateAsset, applyAssetCommit,
} from '../context/ParametricAssets.js'
import { ParametricPreviewView } from '../view/ParametricPreviewView.js'
import { RegionAuthoringWidget } from '../view/RegionAuthoringWidget.js'
import { RegionGhostView, personaColor } from '../view/RegionGhostView.js'
import { UncertaintyGhostView } from '../view/UncertaintyGhostView.js'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import conflictContext from '../../examples/cell_conflict_context.json'
import regionContext from '../../examples/cell_region_context.json'
import phase2Context from '../../examples/cell_phase2_context.json'
import roboticsContext from '../../examples/cell_robotics_context.json'

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
  'cell_robotics_context.json': roboticsContext,
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

    // ── Parametric asset viewer (ADR-063 Phase 4) ──────────────────────────────
    /** @type {ParametricPreviewView|null} live asset ghost preview (sole owner) */
    this._assetPreview = null

    // ── Why breadcrumb / φ⁻¹ provenance (ADR-052 Phase 2) ──────────────────────
    /** @type {string|null} scene id whose Why provenance is currently shown */
    this._provenanceSceneId = null

    // ── Template-gallery structure previews (ADR-062 Phase 5) ──────────────────
    /** @type {object|null} memoized file → structurePreview map (static docs) */
    this._templatePreviewCache = null

    // Re-project whenever the canonical document changes — covers approval, region
    // edit, undo, and redo uniformly (they all mutate the doc through the service).
    this._ctxService.on('contextChanged', () => this._reproject())

    const { registerCallback } = useUIStore.getState().actions
    registerCallback('onOpenTemplateGallery',    ()           => this.openTemplateGallery())
    registerCallback('onCloseTemplateGallery',   ()           => this.closeTemplateGallery())
    registerCallback('onSelectTemplate',         (id)         => this.selectTemplate(id))
    registerCallback('onForkTemplate',           (id)         => this.forkExample(id))
    registerCallback('onContextNegotiate',       ()           => this.enterNegotiation())
    registerCallback('onContextAuthor',          ()           => this.enterAuthoring())
    registerCallback('onContextRegionGhost',     ()           => this.enterRegionGhost())
    registerCallback('onApproveContextDecision', (ref)        => this.approveDecision(ref))
    registerCallback('onAnswerQuestion',         (ref, q, a)  => this.answerQuestion(ref, q, a))
    registerCallback('onAddDocEntry',            (type, data) => this.addDocEntry(type, data))
    registerCallback('onEditDocEntry',           (type, data) => this.editDocEntry(type, data))
    registerCallback('onRemoveDocEntry',         (type, ref)  => this.removeDocEntry(type, ref))
    registerCallback('onIntakePreview',          (spec)       => this.previewIntake(spec))
    registerCallback('onAddNlFacts',             (facts)      => this.addNlFacts(facts))
    registerCallback('onWizardStart',            ()           => this.startWizard())
    registerCallback('onWizardNext',             ()           => this.wizardNext())
    registerCallback('onWizardBack',             ()           => this.wizardBack())
    registerCallback('onWizardFinish',           ()           => this.finishWizard())
    registerCallback('onWizardExit',             ()           => this.exitWizard())
    registerCallback('onAssetViewerOpen',        (assetId)    => this.openAssetViewer(assetId))
    registerCallback('onAssetParam',             (key, value) => this.setAssetParam(key, value))
    registerCallback('onAssetViewerCommit',      ()           => this.commitAsset())
    registerCallback('onAssetViewerClose',       ()           => this.closeAssetViewer())
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

  // ── Template gallery (Phase 2 — Entry B, ADR-051 §3) ────────────────────────
  // "New Project" (the gallery) is the single create-new entry. Its blank card
  // (`selectTemplate('blank')`) replaces the former `newContext()` direct path —
  // it handles active-overlay cleanup via `exit()` and needs no confirm dialog
  // (the gallery footer is the disclaimer, ADR-051 §7).

  /** Open the starter-template picker modal. */
  openTemplateGallery() {
    const ui = useUIStore.getState().actions
    ui.setTemplateGalleryPreviews(this._templatePreviews())
    ui.setTemplateGalleryOpen(true)
  }

  /**
   * Structure previews for the gallery cards (ADR-062 Phase 5), keyed by
   * example file. The fact is the ADR-056 normal form (`canonicalForm`); the
   * card shape is the pure `structurePreview` projection. Computed once and
   * memoized — the bundled docs are static modules. A doc whose derivation
   * throws gets no preview (an honest missing card, never a guessed one — #11).
   */
  _templatePreviews() {
    if (this._templatePreviewCache) return this._templatePreviewCache
    const previews = {}
    for (const [file, doc] of Object.entries(TEMPLATE_DOCS)) {
      try {
        previews[file] = structurePreview(canonicalForm(doc))
      } catch (err) {
        console.error(`[ContextController] structure preview failed for ${file}`, err)
        previews[file] = null
      }
    }
    this._templatePreviewCache = previews
    return previews
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
      this._ctrl._uiView.showToast(`Unknown template: ${id}`, { type: 'warn' })
      return
    }
    this.closeTemplateGallery()
    if (this.isActive) this.exit()

    if (meta.source.kind === 'blank') {
      // The guided card is a wizard ENTRY POINT (ADR-063 Phase 5) — same blank
      // doc, but the doc keeps a neutral project name and the wizard FSM starts
      // immediately after negotiation opens.
      const docName = meta.wizard ? 'New Project' : meta.name
      Promise.resolve(this._ctxService.adoptDoc(createBlankDoc(docName), this._viewContext()))
        .then(() => {
          this._startNegotiation()
          if (meta.wizard) this.startWizard()
        })
        .catch(err => {
          this._ctrl._uiView.showToast(`Failed to load template: ${err.message}`, { type: 'error' })
          console.error('[ContextController]', err)
        })
      return
    }

    const doc = TEMPLATE_DOCS[meta.source.file]
    if (!doc) {
      this._ctrl._uiView.showToast(`Template definition not found: ${meta.source.file}`, { type: 'error' })
      return
    }
    this._loadThen(doc, () => this._startNegotiation())
  }

  /**
   * Fork an example as the starting point (ADR-058 — "fork & tweak"). The example
   * doc is *cloned* into the working doc (so editing never touches the bundled
   * module), the scene is regenerated from it, and the **original example is
   * retained as a read-only seed** (`context.authorSeed`) so the intake forms can
   * surface its filled values as anchors the user copies and overrides.
   *
   * The seed is NOT a second source of truth — it is a read-only mirror of the
   * example file; the working doc stays owned by ContextService (§1.1 /
   * PHILOSOPHY #1). It is set *after* `_startNegotiation` because `contextStart`
   * resets `authorSeed` to null. Only `kind:'example'` templates are forkable
   * (a blank doc has nothing to anchor against — use the Empty Project card).
   *
   * @param {string} id — TemplateCatalog entry id (must be an example)
   */
  forkExample(id) {
    const meta = getTemplateMeta(id)
    if (!meta || meta.source.kind !== 'example') {
      this._ctrl._uiView.showToast(`Cannot fork template: ${id}`, { type: 'warn' })
      return
    }
    const seed = TEMPLATE_DOCS[meta.source.file]
    if (!seed) {
      this._ctrl._uiView.showToast(`Template definition not found: ${meta.source.file}`, { type: 'error' })
      return
    }
    this.closeTemplateGallery()
    if (this.isActive) this.exit()

    const working = JSON.parse(JSON.stringify(seed))   // clone — edits never touch the module
    this._loadThen(working, () => {
      this._startNegotiation()
      const ui = useUIStore.getState().actions
      ui.contextSetSeed(JSON.parse(JSON.stringify(seed)))   // read-only anchor mirror
      ui.contextSetTab('intake')                            // open the authoring forms
      this._ctrl._uiView.showToast(`Forked “${meta.name}” — tweak the requirements to make it yours`)
    })
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
        ctrl._uiView.showToast(`Unknown entry type: ${type}`, { type: 'warn' })
        return
    }
    const label = { actor: 'Add Actor', fact: 'Add Fact', variable: 'Add Variable', requirement: 'Add Requirement' }[type]
    const cmd = createAddDocEntryCommand(this._ctxService, beforeDoc, afterDoc, label, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)
        ctrl._refreshUndoRedoState()
      })
      .catch(err => {
        ctrl._uiView.showToast(`Could not add entry: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
      })
  }

  /**
   * Edit an existing doc entry in place (ADR-058 Phase 2 — fork & tweak, per-field).
   * `data` is the full rebuilt entry, keyed by its (unchanged) `ref`. Dispatches to
   * the pure `updateX` DocBuilder function (input-immutable, PHILOSOPHY #6), then
   * commits via the generic `createDocEditCommand` so the tweak is a single undoable
   * mutation that regenerates derived geometry (a criterion value can shift a zone).
   * If the edit orphans a Decision / breaks an invariant, `compileContext` throws —
   * we surface it and never push (PHILOSOPHY #11); the panel's live values stay,
   * so the user can correct and retry.
   *
   * @param {'actor'|'variable'|'requirement'} type
   * @param {object} data — the full rebuilt entry (its `ref` selects the target)
   */
  editDocEntry(type, data) {
    if (!this.isNegotiation) return
    const ctrl      = this._ctrl
    const beforeDoc = this._ctxService.getDoc()
    let afterDoc
    switch (type) {
      case 'actor':       afterDoc = updateActor(beforeDoc, data);       break
      case 'variable':    afterDoc = updateVariable(beforeDoc, data);    break
      case 'requirement': afterDoc = updateRequirement(beforeDoc, data); break
      default:
        ctrl._uiView.showToast(`Unknown entry type: ${type}`, { type: 'warn' })
        return
    }
    const label = { actor: 'Edit Actor', variable: 'Edit Variable', requirement: 'Edit Requirement' }[type]
    this._runDocEdit(beforeDoc, afterDoc, label, `Could not save ${type}`)
  }

  /**
   * Remove an existing doc entry through the CommandStack (undoable). Uses the pure
   * `removeDocEntry` builder; a stale ref is a safe no-op clone (PHILOSOPHY #11). A
   * removal that orphans a reference (a requirement's actor / variable) is caught by
   * `compileContext` and surfaced, not silently dropped.
   *
   * @param {'actor'|'variable'|'requirement'|'fact'} type
   * @param {string} ref
   */
  removeDocEntry(type, ref) {
    if (!this.isNegotiation) return
    const beforeDoc = this._ctxService.getDoc()
    const afterDoc  = removeDocEntry(beforeDoc, type, ref)
    this._runDocEdit(beforeDoc, afterDoc, `Remove ${type} ${ref}`, `Could not remove ${type}`)
  }

  /** Shared execute→push→refresh (or toast-on-throw) for edit / remove commands. */
  _runDocEdit(beforeDoc, afterDoc, label, failMsg) {
    const ctrl = this._ctrl
    const cmd = createDocEditCommand(this._ctxService, beforeDoc, afterDoc, label, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)   // post-hoc record (CODE_CONTRACTS push vs execute)
        ctrl._refreshUndoRedoState()
      })
      .catch(err => {
        ctrl._uiView.showToast(`${failMsg}: ${err.message}`, { type: 'error' })
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

    const label = `NL intake (${facts.length} Fact${facts.length > 1 ? 's' : ''})`
    const cmd = createAddDocEntryCommand(this._ctxService, beforeDoc, afterDoc, label, this._viewContext())
    Promise.resolve(cmd.execute())
      .then(() => {
        ctrl._commandStack.push(cmd)
        ctrl._refreshUndoRedoState()
        const unknown = facts.filter(f => f.status === 'unknown').length
        ctrl._uiView.showToast(
          `Imported ${facts.length} Fact${facts.length > 1 ? 's' : ''}${unknown ? ` (${unknown} need confirmation)` : ''}`,
        )
      })
      .catch(err => {
        ctrl._uiView.showToast(`NL intake failed: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
      })
  }

  // ── Guided-intake wizard (ADR-063 Phase 3) ───────────────────────────────────
  // The wizard is an ordered vessel around the existing intake forms: every
  // commit still flows through addDocEntry (DocBuilder → AddDocEntryCommand),
  // so leaving mid-wizard always leaves a valid, undoable working doc. This
  // controller is the SOLE writer of `context.wizard` (same discipline as the
  // grasp FSM — ADR-057 / PHILOSOPHY #5); transitions are computed by the pure
  // WizardCatalog functions, and the `next` gate is enforced here against the
  // AUTHORITATIVE doc (the panel derives the same gaps for display from the
  // projected slice — one predicate, two projections).

  /** Enter the guided-intake wizard at step 0 and show its tab. */
  startWizard() {
    if (!this.isNegotiation) {
      this._ctrl._uiView.showToast(
        'Open a context first (New Project / Import) to start the guided intake.',
        { type: 'warn' },
      )
      return
    }
    const ui = useUIStore.getState().actions
    ui.contextSetWizard(startWizard(CELL_INTAKE_WIZARD))
    ui.contextSetTab('wizard')
  }

  /**
   * Advance to the next step (or review). Blocked with the printable step-gap
   * reasons while the current step's committed entries don't satisfy its gate —
   * the panel already prints the same list, the toast is the belt-and-braces
   * surface for a programmatic call (never a silent no-op — PHILOSOPHY #11).
   */
  wizardNext() {
    const state = useUIStore.getState().context.wizard
    if (!this.isNegotiation || !state) return
    const def = WIZARD_CATALOG[state.defId]
    const doc = this._ctxService.getDoc() ?? {}
    const gaps = wizardStepGaps(def, state, doc)
    if (gaps.length > 0) {
      this._ctrl._uiView.showToast(gaps.join(' · '), { type: 'warn' })
      return
    }
    useUIStore.getState().actions.contextSetWizard(nextWizardState(def, state, doc))
  }

  /** Step back (review → last step; step 0 stays). Always allowed. */
  wizardBack() {
    const state = useUIStore.getState().context.wizard
    if (!this.isNegotiation || !state) return
    const def = WIZARD_CATALOG[state.defId]
    useUIStore.getState().actions.contextSetWizard(prevWizardState(def, state))
  }

  /**
   * Finish from the review step: deactivate the wizard and land on the matrix
   * (the doc the wizard built is already fully committed — finishing is a view
   * transition, not a commit; ADR-063 §4 forbids the all-or-nothing modal).
   */
  finishWizard() {
    const state = useUIStore.getState().context.wizard
    if (!this.isNegotiation || !state) return
    const ui = useUIStore.getState().actions
    ui.contextSetWizard(null)
    ui.contextSetTab('matrix')
    this._ctrl._uiView.showToast('Guided intake finished — the document is ready to negotiate')
  }

  /** Leave the wizard at any point; committed steps stay in the doc (undoable). */
  exitWizard() {
    if (!this.isNegotiation) return
    useUIStore.getState().actions.contextSetWizard(null)
  }

  // ── Parametric asset viewer (ADR-063 Phase 4) ────────────────────────────────
  // The 3-D viewer is an INPUT DEVICE: sliders drive the pure `instantiateAsset`
  // fragment, the ghost preview responds live, and the only doc-mutating exit is
  // an explicit commit that records the converted numbers/text (variables + one
  // asserted fact) through the generic doc-edit command — the 3-D state itself
  // is never committed (ADR-063 Goal 2; optimistic preview / pessimistic commit
  // — ADR-050 Phase 3 discipline). Sole writer of `context.assetViewer`; sole
  // owner of `_assetPreview` (disposed on close / exit — PHILOSOPHY #4/#9).

  /**
   * Open the parametric viewer on an asset at its schema defaults and render
   * the live ghost preview. Negotiate-mode only (the panel lives in its tab).
   * @param {string} assetId — PARAMETRIC_CATALOG entry id
   */
  openAssetViewer(assetId) {
    if (!this.isNegotiation) return
    const asset = getParametricAsset(assetId)
    if (!asset) {
      this._ctrl._uiView.showToast(`Unknown asset: ${assetId}`, { type: 'warn' })
      return
    }
    const values = clampParams(asset, {})
    useUIStore.getState().actions.contextSetAssetViewer({ assetId, values })

    if (!this._assetPreview) this._assetPreview = new ParametricPreviewView(this._ctrl._sceneView.scene)
    this._assetPreview.update(instantiateAsset(asset, values).entities)

    // Frame the camera once per open (per-keystroke re-framing would disorient —
    // same rule as the intake ghost).
    const sphere = this._assetPreview.boundingSphere()
    if (sphere) this._ctrl._sceneView.fitCameraToSphere(sphere.center, sphere.radius * 1.6)
  }

  /**
   * Live slider change: clamp through the pure layer, replace the slice, and
   * rebuild the ghost. No doc mutation, no CommandStack — a preview keystroke
   * is not a commit.
   * @param {string} key
   * @param {number} value
   */
  setAssetParam(key, value) {
    const viewer = useUIStore.getState().context.assetViewer
    if (!this.isNegotiation || !viewer) return
    const asset = getParametricAsset(viewer.assetId)
    if (!asset) return
    const values = clampParams(asset, { ...viewer.values, [key]: value })
    useUIStore.getState().actions.contextSetAssetViewer({ ...viewer, values })
    this._assetPreview?.update(instantiateAsset(asset, values).entities)
  }

  /**
   * Commit the current parameter values as doc entries (variables + one asserted
   * fact — the "converted numbers/text") through the generic doc-edit command so
   * the whole commit is one undoable mutation. A recommit upserts by ref (pure
   * `applyAssetCommit`), never duplicates. The viewer stays open so the user can
   * keep iterating; the preview ghost stays a preview.
   */
  commitAsset() {
    const viewer = useUIStore.getState().context.assetViewer
    if (!this.isNegotiation || !viewer) return
    const asset = getParametricAsset(viewer.assetId)
    if (!asset) return
    const beforeDoc = this._ctxService.getDoc()
    const afterDoc  = applyAssetCommit(beforeDoc, asset, viewer.values)
    this._runDocEdit(beforeDoc, afterDoc, `Commit asset ${asset.name}`, 'Could not commit asset')
    this._ctrl._uiView.showToast(
      `Committed "${asset.name}" — ${asset.params.length} variable${asset.params.length > 1 ? 's' : ''} + 1 fact (numbers, not boxes)`,
    )
  }

  /** Close the viewer and dispose the ghost preview (PHILOSOPHY #9). */
  closeAssetViewer() {
    useUIStore.getState().actions.contextSetAssetViewer(null)
    this._disposeAssetPreview()
  }

  _disposeAssetPreview() {
    if (!this._assetPreview) return
    this._assetPreview.dispose()
    this._assetPreview = null
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
    const labelText = `${label}: ${fmtNum(lo)}–${fmtNum(hi)} ${unit} · unconfirmed`

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
   * Open the negotiation view over the loaded context document. The view is a
   * persistent overlay on the loaded context — it never replaces the user's
   * scene. If no document is loaded yet, guide the user instead of bootstrapping
   * a demo (the cell examples are reachable as "New Project" templates).
   */
  enterNegotiation() {
    if (this.isActive) return
    if (this._ctxService.loaded) { this._startNegotiation(); return }
    this._ctrl._uiView.showToast(
      'No context loaded. Start one from New Project, import a .ctx.json, or try the Tutorial.',
      { type: 'warn' },
    )
  }

  _startNegotiation() {
    const ctrl   = this._ctrl
    const doc    = this._ctxService.getDoc()
    const result = this._ctxService.getValidatorResult()

    // contextStart resets the assetViewer slice — dispose its ghost too, or a
    // re-entry (e.g. importing a new .ctx.json mid-session) would leak the view
    // with no slice pointing at it (PHILOSOPHY #9).
    this._disposeAssetPreview()

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
      requirements:        doc?.requirements ?? [],
      conflicts:           result.conflicts,
      negotiationClusters: result.negotiationClusters,
      conflictMatrix:      this._ctxService.projectMatrix(),
      resolutionOrder:     this._ctxService.projectOrder(),
      form,
      checks:              this._ctxService.projectChecks(),
    })
    // The whole Why-rooted 5W1H tree overview (ADR-052 Phase 3 — bird's-eye
    // complement to the selection-driven Why breadcrumb).
    ui.contextSetWhyTree(this._ctxService.whyTree())
    // Blank doc (no actors) opens on the wizard tab (ADR-063 Phase 3 — the
    // guided route is the canonical entry for a doc with nothing in it yet;
    // the expert Intake tab stays one tab away).
    const initialTab = form.length > 0 ? 'questions'
      : (doc?.actors?.length ?? 0) === 0 ? 'wizard'
      : 'matrix'
    ui.contextSetTab(initialTab)
    this._mode = 'negotiate'
    this._provenanceSceneId = null
  }

  // ── Why breadcrumb / φ⁻¹ provenance (ADR-052 Phase 2) ────────────────────────

  /**
   * Surface the Why provenance of a selected scene entity in the inspector
   * (ADR-052 Phase 2 — "scene operation → provenance presentation"). The selected
   * mesh is a *derived* What/How projection of the canonical doc (invariant 9); this
   * climbs the doc's derived→source edges (φ⁻¹) back to the Why — the KPI / criterion
   * / Intent that the placement exists to satisfy — with the measured-vs-target Gap
   * joined in by ContextService. Only meaningful in negotiate mode, where the derived
   * scene is visible and selectable (author / ghost hide the meshes).
   *
   * @param {string|null} sceneId — selected scene entity id, or null to clear
   */
  showProvenance(sceneId) {
    if (!this.isNegotiation) return
    const ui = useUIStore.getState().actions
    if (!sceneId) {
      this._provenanceSceneId = null
      ui.contextSetProvenance(null)
      return
    }
    const prov = this._ctxService.recoverProvenance(sceneId)
    if (!prov || !prov.found) {
      // The tapped entity is not context-derived (e.g. a user-added solid) — clear
      // rather than leaving a stale breadcrumb (PHILOSOPHY #11: no silent staleness).
      this._provenanceSceneId = null
      ui.contextSetProvenance(null)
      return
    }
    this._provenanceSceneId = sceneId
    ui.contextSetProvenance(prov)
    ui.contextSetTab('why')
  }

  // ── Region authoring (Phase 3, §4.5) ─────────────────────────────────────────

  /**
   * Start the live region-authoring overlay over the loaded context. The loaded
   * doc must carry single-variable region requirements; if it does not (nothing
   * loaded, or a non-region scenario), guide the user instead of replacing the
   * scene with a demo (the region example is the "Robot Cell — Regions" template).
   */
  enterAuthoring() {
    if (this.isActive) return
    if (this._ctxService.loaded && this._regionReqs(this._ctxService.getDoc()).length > 0) {
      this._startAuthoring(); return
    }
    this._ctrl._uiView.showToast(
      "This view needs a context with region requirements — load the 'Robot Cell — Regions' template from New Project.",
      { type: 'warn' },
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
        ctrl._uiView.showToast(`Could not apply region edit: ${err.message}`, { type: 'error' })
        console.error('[ContextController]', err)
        const entry = this._authorWidgets.find(w => w.reqRef === reqRef)
        entry?.widget.setRegion(before.region)
        this._editCtx = applyAdmissibleEdit(this._editCtx, reqRef, before)
        this._recolourAuthoring(validateContext(this._editCtx))
      })
  }

  // ── Region ghost overlay (Phase 3, §5.3) ─────────────────────────────────────

  /**
   * Overlay each actor's admissible footprint as a persona-coloured ghost over
   * the loaded context. As with authoring the loaded doc must carry region
   * requirements; guide the user otherwise instead of replacing the scene.
   */
  enterRegionGhost() {
    if (this.isActive) return
    if (this._ctxService.loaded && this._regionReqs(this._ctxService.getDoc()).length > 0) {
      this._startRegionGhost(); return
    }
    this._ctrl._uiView.showToast(
      "This view needs a context with region requirements — load the 'Robot Cell — Regions' template from New Project.",
      { type: 'warn' },
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
    const kind = d?.nominals ? 'Settled jointly' : 'Settled'
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
        ctrl._uiView.showToast(`Could not apply answer: ${err.message}`, { type: 'error' })
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
          this._ctrl._uiView.showToast(`JSON parse error: ${file.name}`, { type: 'error' })
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
      this._ctrl._uiView.showToast('No context is loaded', { type: 'warn' })
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
        // Acceptance verdicts refresh through the same one path — a form answer
        // that unblocks a robotics check flips blocked→pass here, and the panel's
        // component-local snapshot turns that fact into the landing flash
        // (ADR-062 Phase 4; PHILOSOPHY #5).
        ui.contextSetChecks(this._ctxService.projectChecks())
        const doc = this._ctxService.getDoc()
        ui.contextSetActors(doc?.actors ?? [])
        ui.contextSetVars(doc?.variables ?? [])
        ui.contextSetRequirements(doc?.requirements ?? [])
        // Refresh the whole-doc Why-tree overview — add/answer/edit all reshape it
        // (ADR-052 Phase 3; one re-projection path — PHILOSOPHY #5).
        ui.contextSetWhyTree(this._ctxService.whyTree())
        // Refresh the Why breadcrumb's joined Gap if an entity is selected — approval
        // / region edit / undo can change R6 conflicts (PHILOSOPHY #5, one path).
        if (this._provenanceSceneId) {
          const prov = this._ctxService.recoverProvenance(this._provenanceSceneId)
          ui.contextSetProvenance(prov?.found ? prov : null)
        }
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
    this._disposeAssetPreview()  // asset ghost preview too (ADR-063 Phase 4)

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
    // The grasp ghost lives inside the negotiate overlay's grasp tab — overlay
    // exit is its disposal boundary (ADR-059 §B-5, PHILOSOPHY #9).
    ctrl._graspCtrl?.disposeGhost()
    ui.contextEnd()
    this._mode = null
    this._provenanceSceneId = null
  }

  // ── Per-frame animation (driven by AppController's loop) ──────────────────────

  tick(t) {
    // Live intake preview pulses in negotiate mode (Phase 3 — Entry D).
    if (this._intakeGhost) {
      this._intakeGhost.tick(t, this._ctrl._sceneView.activeCamera, this._ctrl._sceneView.renderer)
    }
    // Parametric asset ghost pulse (ADR-063 Phase 4) — live, uncommitted preview.
    this._assetPreview?.tick(t)
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
