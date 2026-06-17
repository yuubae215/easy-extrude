// @ts-nocheck
/**
 * ContextService — owns the canonical Context DSL document and drives scene
 * regeneration (ADR-050 §3).
 *
 * The product artifact of a context-first project is the Context DSL document
 * (`context/0.3`). The 3D scene is a *derived output projection* obtained by the
 * pure chain `compileContext() → compileLayout() → importFromJson()` (ADR-049
 * invariant 9, ADR-050 §2). Save / load / diff all operate on the document.
 *
 * This service is a side-effect coordinator (PHILOSOPHY #3): it holds **no pure
 * logic** of its own. Validation / compilation / projection are delegated to the
 * pure `src/context/*` layer (94 tests, unchanged), and scene re-rendering to
 * `SceneService.importFromJson`. Every document change produces a **new document**
 * (input-immutable — PHILOSOPHY #6), mirroring the pure `applyAdmissibleEdit`.
 *
 * Ownership contracts (CODE_CONTRACTS / ADR-050 §3):
 *   - `loadContext()` is the single authoritative entry point for adopting a doc
 *     (PHILOSOPHY #1). It validates + compiles + imports + rebuilds the derivation
 *     bookkeeping, then emits `contextLoaded`.
 *   - The accessors `getDoc()/getValidatorResult()/getCompiled()` and the ref-map
 *     getters own their freshness guarantee (PHILOSOPHY #23) — callers never run a
 *     manual "refresh" step.
 *   - Decision approval is a **real document mutation** (`status: proposed →
 *     agreed`), not a transient set — so the conflict-matrix `resolved` state is
 *     doc-derived and the change is undoable via a CommandStack command (§3.5).
 *
 * Emits (ADR-013 lineage, PHILOSOPHY #5): `contextLoaded`, `contextChanged`,
 * `conflictsChanged`, `decisionApproved`.
 *
 * @module service/ContextService
 */
import { EventEmitter } from '../core/EventEmitter.js'
import { compileContext } from '../context/ContextCompiler.js'
import { validateContext } from '../context/ContextValidator.js'
import { applyAdmissibleEdit } from '../context/ContextEditModel.js'
import {
  projectConflictMatrix,
  projectResolutionOrder,
  projectRegionGhosts,
} from '../context/PersonaProjection.js'
import { projectForm } from '../context/FormProjection.js'
import { buildWhyTree, recoverProvenance } from '../context/ProvenanceTree.js'
import { compileLayout, buildRefMap, linkIdForConstraint } from '../layout/LayoutCompiler.js'
import { SCENE_JSON_VERSION } from '../layout/LayoutDslSchema.js'

/** Decision statuses that count as "approved" for the persona-projection gate. */
const APPROVED_STATUS = new Set(['agreed', 'signed'])

export class ContextService extends EventEmitter {
  /**
   * @param {import('./SceneService.js').SceneService} sceneService — the scene
   *   coordinator whose `importFromJson` regenerates the derived scene. Injected
   *   (not imported) so unit tests can mock it and run THREE-free.
   */
  constructor(sceneService) {
    super()
    this._scene = sceneService

    /** @type {object|null} canonical Context DSL document (the project artifact) */
    this._doc = null
    /** @type {object|null} validateContext(_doc) output */
    this._validatorResult = null
    /** @type {object|null} compileContext(_doc) output */
    this._compiled = null

    // ── Compiled-context derivation bookkeeping (was inline in the demo's _start)
    /** @type {Map<string,string>} layout DSL entity ref → scene entity id */
    this._refToId = new Map()
    /** @type {Map<string,string[]>} trace.from → trace.to[] */
    this._traceByFrom = new Map()
    /** @type {Map<string,string>} "constraint:a→b" → SpatialLink id */
    this._constraintToLinkId = new Map()
    /** @type {string[]} all derived SpatialLink ids */
    this._linkIds = []
  }

  // ── Freshness-owning accessors (PHILOSOPHY #23) ────────────────────────────

  /** True once a context document has been loaded. */
  get loaded() { return this._doc !== null }

  getDoc()             { return this._doc }
  getValidatorResult() { return this._validatorResult }
  getCompiled()        { return this._compiled }
  getRefToId()         { return this._refToId }
  getTraceByFrom()     { return this._traceByFrom }
  getConstraintToLinkId() { return this._constraintToLinkId }
  getLinkIds()         { return this._linkIds }

  // ── Document adoption (the single authoritative entry, PHILOSOPHY #1) ───────

  /**
   * Adopt a context document: validate → compile → import → rebuild bookkeeping.
   * Replaces the current scene (`{clear:true}`) — loading a context regenerates
   * the derived scene (ADR-049 invariant 9). Throws on validation / compile /
   * import failure; the caller surfaces it (PHILOSOPHY #11) — the service never
   * shows UI itself (PHILOSOPHY #3).
   *
   * @param {object} doc — Context DSL object (context/0.x)
   * @param {object} viewContext — { camera, renderer, container } for importFromJson
   * @returns {Promise<{imported:number, skipped:number}>}
   */
  async loadContext(doc, viewContext) {
    const validatorResult = validateContext(doc)
    const compiled = compileContext(doc)                 // throws on invalid doc
    const scene    = compileLayout(compiled.layoutDsl)    // throws on invalid layout

    const importResult = await this._scene.importFromJson(scene, viewContext, { clear: true })

    this._doc             = doc
    this._validatorResult = validatorResult
    this._compiled        = compiled
    this._rebuildDerivation(compiled)

    this.emit('contextLoaded', { doc, validatorResult, compiled, importResult })
    return importResult
  }

  /**
   * Re-derivation primitive: adopt a new document, re-validate, and (when
   * `regenerate`) re-compile + re-import + rebuild bookkeeping. Compilation runs
   * **before** any state mutation so a compile failure leaves the prior state
   * intact (no half-applied doc). Emits `contextChanged`, plus `conflictsChanged`
   * when the conflict set actually differs.
   *
   * @param {object} newDoc
   * @param {object} viewContext
   * @param {{regenerate?: boolean}} [opts]
   * @returns {Promise<object>} the new validator result
   */
  async applyContextDoc(newDoc, viewContext, { regenerate = false } = {}) {
    const validatorResult = validateContext(newDoc)

    let compiled = this._compiled
    let scene    = null
    if (regenerate) {
      compiled = compileContext(newDoc)              // may throw — aborts before commit
      scene    = compileLayout(compiled.layoutDsl)
    }

    const prevConflicts = this._validatorResult?.conflicts ?? []

    if (regenerate) {
      await this._scene.importFromJson(scene, viewContext, { clear: true })
      this._compiled = compiled
      this._rebuildDerivation(compiled)
    }

    this._doc             = newDoc
    this._validatorResult = validatorResult

    this.emit('contextChanged', { doc: newDoc, validatorResult, regenerated: regenerate })
    if (!conflictsEqual(prevConflicts, validatorResult.conflicts)) {
      this.emit('conflictsChanged', { conflicts: validatorResult.conflicts })
    }
    return validatorResult
  }

  // ── Blank-doc adoption (ADR-051 Phase 1) ────────────────────────────────────

  /**
   * Adopt a blank (no specification.layout) context document: validate → clear
   * the scene → set state → emit `contextLoaded`. Unlike `loadContext`, this
   * skips the compile / layout / import-from-layout pipeline because the doc has
   * no layout spec yet. The scene is cleared with an empty scene JSON so the user
   * starts from a clean 3-D view. Throws on validation failure.
   *
   * Called by `ContextController.newContext()` for Entry A (ADR-051 §3).
   *
   * @param {object} doc — blank Context DSL doc (createBlankDoc() output)
   * @param {object} viewContext — { camera, renderer, container }
   * @returns {Promise<{imported:number, skipped:number}>}
   */
  async adoptDoc(doc, viewContext) {
    const validatorResult = validateContext(doc)
    if (!validatorResult.valid) {
      throw new Error(`Context DSL validation failed:\n  - ${validatorResult.errors.join('\n  - ')}`)
    }

    // Clear the scene without a layout compile step.
    const emptyScene = {
      version:        SCENE_JSON_VERSION,
      objects:        [],
      links:          [],
      transformGraph: { nodes: [], edges: [] },
    }
    const importResult = await this._scene.importFromJson(emptyScene, viewContext, { clear: true })

    this._doc             = doc
    this._validatorResult = validatorResult
    this._compiled        = null
    this._refToId         = new Map()
    this._traceByFrom     = new Map()
    this._constraintToLinkId = new Map()
    this._linkIds         = []

    this.emit('contextLoaded', { doc, validatorResult, compiled: null, importResult })
    return importResult
  }

  // ── Authoring mutations (each yields a new doc — PHILOSOPHY #6) ─────────────

  /**
   * Apply a finished admissible edit (region / interval) to a requirement and
   * regenerate the scene. The pure `applyAdmissibleEdit` returns a new document;
   * this service performs the re-derivation side effects.
   *
   * @param {string} reqRef
   * @param {object} admissible — `{interval}` | `{region}` (ADR-050 §4.5 future: `{pose}`)
   * @param {object} viewContext
   * @param {{regenerate?: boolean}} [opts] — defaults to regenerating (geometry changed)
   * @returns {Promise<object>} the new validator result
   */
  applyAdmissible(reqRef, admissible, viewContext, { regenerate = true } = {}) {
    const newDoc = applyAdmissibleEdit(this._doc, reqRef, admissible)
    return this.applyContextDoc(newDoc, viewContext, { regenerate })
  }

  /**
   * Approve a Decision: mutate its status `proposed → agreed` in a new document.
   * The compiled layout is **invariant under this flip** — `$decision` markers
   * resolve to `decision.nominal` verbatim regardless of status — so the scene is
   * not regenerated (avoids the §7 full-recompile cost for a pure status change).
   * The conflict-matrix transition to `resolved` follows from the doc-derived
   * `approvedRefs` (ADR-049 Phase 4 backward-compat seam). Undoable via
   * `unapproveDecision` (§3.5).
   *
   * @param {string} ref — the Decision ref to approve
   * @param {object} viewContext
   * @returns {Promise<object>}
   */
  approveDecision(ref, viewContext) {
    const p = this.applyContextDoc(this._withDecisionStatus(ref, 'agreed'), viewContext)
    this.emit('decisionApproved', { ref })
    return p
  }

  /** Reverse of `approveDecision` (`agreed → proposed`) — the undo path (§3.5). */
  unapproveDecision(ref, viewContext) {
    return this.applyContextDoc(this._withDecisionStatus(ref, 'proposed'), viewContext)
  }

  // ── Pure-projection wrappers (approvedRefs derived from the doc) ────────────

  projectMatrix() {
    return projectConflictMatrix(this._doc, this._validatorResult, { approvedRefs: this._approvedRefs() })
  }
  projectOrder() {
    return projectResolutionOrder(this._doc, this._validatorResult, { approvedRefs: this._approvedRefs() })
  }
  projectGhosts() {
    return projectRegionGhosts(this._doc, this._validatorResult, { approvedRefs: this._approvedRefs() })
  }
  projectForm() {
    return projectForm(this._validatorResult)
  }

  // ── Why-rooted 5W1H tree / φ⁻¹ provenance recovery (ADR-052) ────────────────

  /**
   * The Why-rooted 5W1H tree of the loaded document (ADR-052 §2.1). Pure
   * projection over the canonical doc — `null` until a doc is loaded.
   */
  whyTree() {
    return this._doc ? buildWhyTree(this._doc) : null
  }

  /**
   * φ⁻¹ — recover the Why provenance of a derived scene entity from its scene
   * entity id (ADR-052 §2.2). Reverses the `_refToId` map to obtain the canonical
   * layout ref, then delegates to the pure `recoverProvenance`. Returns `null`
   * when no doc is loaded; the recovery result's `found:false` when the id is not
   * a context-derived entity.
   *
   * The returned object additionally carries a `gaps` array: the measured-vs-target
   * **Gap** is an R6 output owned by `validateContext` (keyed `conflict_<variable>`),
   * which the pure `recoverProvenance` deliberately does NOT re-implement (it returns
   * the constrained `variables` instead — PHILOSOPHY #3 / ProvenanceTree contract).
   * The service holds the validator result, so it joins the gap in here by variable
   * ref — the one place that owns both halves.
   *
   * @param {string} sceneId — a scene entity id (as held by SceneService)
   * @returns {object|null}
   */
  recoverProvenance(sceneId) {
    if (!this._doc) return null
    const ref  = this._refForSceneId(sceneId)
    const prov = recoverProvenance(this._doc, ref ?? sceneId)

    // Join the R6 Gap by variable ref (validateContext owns the gap; this is glue,
    // not pure logic). A resolved conflict (Decision-settled) is flagged so the UI
    // can render it green rather than as a live gap.
    const byVar = new Map((this._validatorResult?.conflicts ?? []).map(c => [c.variable, c]))
    const gaps = prov.variables
      .map(v => byVar.get(v))
      .filter(Boolean)
      .map(c => ({ variable: c.variable, gap: c.gap, resolved: !!c.resolvedBy }))

    return { ...prov, gaps }
  }

  /** Reverse `_refToId` (scene entity id → canonical layout ref). */
  _refForSceneId(sceneId) {
    for (const [ref, id] of this._refToId) if (id === sceneId) return ref
    return null
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /** Rebuild the ref / trace / link bookkeeping from a compiled context. */
  _rebuildDerivation(compiled) {
    const layoutDsl = compiled.layoutDsl
    this._refToId = buildRefMap(layoutDsl.entities)

    this._constraintToLinkId = new Map()
    ;(layoutDsl.constraints ?? []).forEach((c, i) => {
      this._constraintToLinkId.set(`constraint:${c.source}→${c.target}`, linkIdForConstraint(i, c))
    })
    this._linkIds = [...this._constraintToLinkId.values()]

    this._traceByFrom = new Map()
    for (const link of compiled.trace ?? []) {
      if (!this._traceByFrom.has(link.from)) this._traceByFrom.set(link.from, [])
      this._traceByFrom.get(link.from).push(link.to)
    }
  }

  /** A new document with `ref`'s Decision status set to `status` (immutable). */
  _withDecisionStatus(ref, status) {
    return {
      ...this._doc,
      decisions: (this._doc?.decisions ?? []).map(d => (d.ref === ref ? { ...d, status } : d)),
    }
  }

  /** Refs of Decisions currently approved (agreed/signed) — the projection gate. */
  _approvedRefs() {
    return new Set(
      (this._doc?.decisions ?? [])
        .filter(d => APPROVED_STATUS.has(d.status))
        .map(d => d.ref),
    )
  }
}

/** Structural equality of two conflict arrays (by variable + gap signature). */
function conflictsEqual(a, b) {
  if (a.length !== b.length) return false
  const sig = c => `${c.variable}|${JSON.stringify(c.gap ?? null)}|${c.resolvedBy ?? ''}`
  const sa = a.map(sig).sort()
  const sb = b.map(sig).sort()
  return sa.every((s, i) => s === sb[i])
}
