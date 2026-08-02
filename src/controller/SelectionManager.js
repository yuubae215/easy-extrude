/**
 * SelectionManager — THE selection (ADR-099).
 *
 * ## Why this class owns the whole decision
 *
 * Selection used to be a *procedure that every window re-implemented*. Five
 * windows could select something (Outliner row, viewport pick, double-click,
 * rectangle drag, LINK NETWORK row) and each wrote a different subset:
 *
 * | 窓 | 事前の clear | mode の正規化 | 選択集合への追加 |
 * |----|:---:|:---:|:---:|
 * | Outliner            | —   | あり | `_switchActiveObject` 内 |
 * | ビューポートのピック | あり | —   | 呼び出し側 |
 * | ダブルクリック       | あり | —   | 呼び出し側 |
 * | 矩形選択            | あり | —   | 呼び出し側 |
 * | LINK NETWORK        | —   | —   | `_switchActiveObject` 内 |
 *
 * `_selectedIds` was written from 8 places in `AppController` alone and the
 * visible highlight had three writers. Adding a window therefore meant writing a
 * subset, and whatever was left out became a symptom — which is precisely how
 * the panel (the newest window, holding the smallest subset) came to select
 * without the viewport following. Same shape ADR-097 found for pose.
 *
 * So the verbs below are the ONLY way to change what is selected, and
 * `src/SelectionOwnership.test.js` asks that by counting: writes to the
 * selection set / the highlight outside this file must be **0**. A census, not
 * a walk of today's callers — the sixth window is not in today's list (原則 #31).
 *
 * ## Cardinality (原則 #31 / ADR-099 §状態機械)
 *
 * Selection is a `0 / 1 / N` cardinality, and it used to be spread over two
 * fields: `_objSelected: boolean` and `_selectedIds: Set`. `_objSelected ===
 * true && _selectedIds.size === 0` was representable, and reachable (any path
 * that cleared one without the other). There is now ONE representation — the
 * union below — and `AppController._objSelected` is a getter over it, so the
 * illegal state cannot be written down and every assignment to it throws.
 *
 * ## Element KIND (原則 #31 一段上 / ADR-107)
 *
 * The state is `_sel`, a kind-discriminated union (`src/domain/selection.js`),
 * not a `Set`. A `Set` has no kind, so the day a second kind of thing became
 * selectable — the document's shared design variables — the split would have
 * been invisible in the implementation: the entrance census below counts writes
 * to the ENTITY side, so a second selection field for variables would have
 * passed it green (ADR-107 却下案 A). What changes here is the ELEMENT KIND;
 * the entrance count does not change, and the census that counts it is not
 * rebuilt — if it had to be rebuilt, that would be the evidence that the
 * selection had actually split in two.
 *
 * Every selectable kind declares its 3-D shape and its N-panel body in
 * `src/view/SelectionKinds.js`, and both tables throw on an undeclared kind:
 * "today's two kinds both have a shape" is a fact, not a rule.
 *
 * ## Visibility (ADR-096 / ADR-099 §3)
 *
 * This manager writes the `contextual` axis and nothing else. The claim is
 * recomputed WHOLESALE from the current selection on every change — never
 * patched — so "the context forgot to release one" is unrepresentable rather
 * than merely unlikely. Two things go into it:
 *
 *   - the selected entities themselves, at FULL. This is what makes selection
 *     unable to be silent (原則 #11): selecting a `tcp` whose eye is closed
 *     shows it *while selected* and lets the eye have it back afterwards.
 *   - their frame context, at DIMMED — a selected CF's TF tree, a selected
 *     geometry entity's descendant frames. Same intensity rule on both branches,
 *     which is what bounds FULL by the selection's cardinality at any N; see
 *     `_claimContext` for the measurement that produced it.
 *
 * The `explicit` axis is never touched here; its owner is the Outliner eye.
 * Handlers own axes, pixels have one owner (原則 #4).
 *
 * State lives on AppController (`_selMgr.ids` is read through
 * `ctrl._selectedIds`) for the many read-only call sites; this manager is its
 * only writer.
 *
 * Owned by AppController as this._selMgr.
 *
 * @see docs/adr/ADR-099-selection-round-trip-one-entry.md
 * @see docs/gsn/adr-099-selection-round-trip.gsn
 */

import * as THREE from 'three'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { Solid }           from '../domain/Solid.js'
import { projectToScreen } from './snap/SnapSystem.js'
import { SelectPulse }     from '../view/SelectPulse.js'
import { COLOR, rgba }     from '../theme/tokens.js'
import { CONTEXTUAL }      from '../view/VisibilityAxes.js'
import { shapeForKind }    from '../view/SelectionKinds.js'
import {
  SELECTION_KIND,
  EMPTY_SELECTION,
  makeSelection,
  entityIdsOf,
  variableRefsOf,
  selectionSize,
  selectionSummary,
} from '../domain/selection.js'

/** Computes 8 world-space bbox corners for a mesh entity that lacks .corners. */
function _meshBboxCorners(obj) {
  const geo = obj.meshView?.cuboid?.geometry
  if (!geo) return null
  geo.computeBoundingBox()
  const b = geo.boundingBox
  if (!b) return null
  return [
    new THREE.Vector3(b.min.x, b.min.y, b.min.z),
    new THREE.Vector3(b.max.x, b.min.y, b.min.z),
    new THREE.Vector3(b.min.x, b.max.y, b.min.z),
    new THREE.Vector3(b.max.x, b.max.y, b.min.z),
    new THREE.Vector3(b.min.x, b.min.y, b.max.z),
    new THREE.Vector3(b.max.x, b.min.y, b.max.z),
    new THREE.Vector3(b.min.x, b.max.y, b.max.z),
    new THREE.Vector3(b.max.x, b.max.y, b.max.z),
  ]
}

export class SelectionManager {
  /**
   * @param {import('./AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl
    /**
     * THE selection. Its cardinality (0 / 1 / N) AND its element kind are both
     * this one value; `_objSelected` is a getter over it with no storage of its
     * own, and so is `ids`.
     * @type {{kind: string, ids?: Set<string>, refs?: Set<string>}}
     */
    this._sel = EMPTY_SELECTION
    /** Last entity that got a select pulse — keeps re-selection churn quiet (#30). */
    this._lastFxId = null
    /**
     * The painters the declared 3-D shapes (`SELECTION_SHAPE_BY_KIND`) name. ALL
     * of them run on every transition with the whole selection, so leaving a
     * kind releases its paint through the same wholesale write that claims the
     * new one — the same reason `_claimContext` is recomputed rather than
     * patched. Keys must match the declared `paint` names exactly; the census
     * asserts both directions (a painter nobody declared is as broken as a
     * declaration nobody paints).
     */
    this._painters = {
      meshHighlight: (sel, activeId) => this._paintMeshHighlight(sel, activeId),
      undecidedBand: (sel)           => this._paintUndecidedBand(sel),
    }
  }

  // ── Reading ─────────────────────────────────────────────────────────────────

  /** THE selection value (kind-discriminated union). Read-only. */
  get selection() { return this._sel }

  /**
   * The selected ENTITY ids. Empty when a variable is selected — with a variable
   * selected, no entity is selected, and that is the honest answer for the many
   * read-only call sites rather than a special case each of them must know.
   */
  get ids() { return entityIdsOf(this._sel) }

  /** The selected VARIABLE refs. Empty when the selection is of another kind. */
  get variableRefs() { return variableRefsOf(this._sel) }

  /** Selection cardinality — 0, 1 or N, in whatever kind is selected (原則 #31). */
  get count() { return selectionSize(this._sel) }

  /** Entity membership. A variable ref can never test true here (D3). @param {string} id */
  has(id) { return this.ids.has(id) }

  // ── The public entry points (原則 #1) ────────────────────────────────────────

  /**
   * Selects exactly one thing and makes it active. The verb every window uses
   * for "the user picked this" — the entity windows pass an id, the document
   * windows (the floor's matrix header, the undecided band) pass a
   * `variableRef(ref)` token. Widening the kind did not add a verb.
   *
   * @param {string|{ns:string,ref:string}} target — entity id, or `variableRef(ref)`
   * @param {{fx?: boolean}} [opts]  `fx:false` for a RESTORE (returning from Edit
   *   Mode re-asserts a selection the user never dropped, so it must not fire the
   *   select pulse again — the pulse means "this just became selected").
   */
  selectOnly(target, { fx = true } = {}) {
    if (target == null) return
    this._normalizeMode()
    const sel = makeSelection([target])
    this._apply(sel, this._activeIdFor(sel, target), { fx })
  }

  /**
   * Selects a whole set at once, with `activeId` as the one the panels talk
   * about (rectangle selection, assembly selection).
   *
   * There is deliberately no `addToSelection(id)`: no window asks for
   * single-item additive selection today, and an unused public verb is a second
   * entry point waiting to drift out of step with this one (§5).
   *
   * A mixed list throws inside `makeSelection` (ADR-107 D1) — mixing is not an
   * intended gesture, so failing loudly beats silently keeping one half.
   *
   * @param {Iterable<string|{ns:string,ref:string}>} members
   * @param {{activeId?: string|null}} [opts]
   */
  selectMany(members, { activeId = null } = {}) {
    const list = [...members]
    if (list.length === 0) { this.clearSelection(); return }
    this._normalizeMode()
    const sel = makeSelection(list)
    // No pulse for a bulk selection: the pulse answers "which one did I just
    // pick", and with N it answers nothing while costing N effects (#30).
    this._apply(sel, activeId ?? this._activeIdFor(sel, list[0]), { fx: false })
  }

  /**
   * Drops the whole selection. The active entity stays active — the N panel and
   * the mode machinery keep talking about it, exactly as before ADR-099.
   */
  clearSelection() {
    this._apply(EMPTY_SELECTION, this._ctrl._scene.activeId ?? null, { fx: false })
  }

  /**
   * Moves the active entity WITHIN the current selection (clicking an
   * already-selected object must not collapse a multi-selection to one).
   * @param {string} id
   */
  activateWithinSelection(id) {
    if (!this.has(id)) { this.selectOnly(id); return }
    this._apply(this._sel, id, { fx: false })
  }

  /**
   * Forgets an entity that is leaving the scene. Called by the delete path
   * BEFORE anything else re-selects, so a detached id can never survive inside
   * the selection or inside the contextual claim.
   * @param {string} id
   */
  forget(id) {
    if (!this.has(id)) return
    // The active entity is NOT chosen here: the delete path already knows which
    // entity should take over and says so with `selectOnly`. Guessing one would
    // be a second opinion about the same fact (§1.1).
    this._apply(
      makeSelection([...this.ids].filter(x => x !== id)),
      this._ctrl._scene.activeId ?? null,
    )
  }

  /**
   * Which entity the panels should talk about after selecting `member`.
   *
   * Selecting a VARIABLE leaves the active entity where it was: `activeId` names
   * an entity, and a variable is not one. That is not a gap — it is the same
   * contract `clearSelection()` has always had ("the active entity stays
   * active"), and it is what keeps the robot the user was looking at from
   * disappearing out of the panels while they inspect a number about it (D5
   * keeps it visible in 3-D at DIMMED).
   */
  _activeIdFor(sel, member) {
    return sel.kind === SELECTION_KIND.ENTITIES ? member : (this._ctrl._scene.activeId ?? null)
  }

  /**
   * Re-asserts the selection highlight after something REPLACED the mesh under
   * a selected entity (rotation rebuilds a Solid's geometry). It changes no
   * state — it re-runs the presentation of the state that is already there, and
   * it exists so that "rebuild the mesh" does not become a fourth writer of the
   * highlight (原則 #4).
   */
  reassertHighlight() {
    for (const id of this.ids) {
      const obj = this._ctrl._scene.getObject(id)
      obj?.meshView?.setObjectSelected(true)
    }
  }

  /**
   * Recomputes the contextual claim from the current selection. Called by
   * transient sub-modes (link creation) that borrow the axis and must hand it
   * back without guessing what was on screen before — the guess is what let the
   * two writers drift apart.
   */
  refreshFrameContext() {
    this._claimContext()
  }

  // ── The single writer ───────────────────────────────────────────────────────

  /**
   * THE state transition. Everything above is vocabulary; this is the only code
   * that writes the selection set, the visible highlight and the contextual
   * claim, and it always writes all three together — which is what makes "a
   * window that forgot a step" unrepresentable rather than merely discouraged.
   *
   * @param {{kind: string, ids?: Set<string>, refs?: Set<string>}} next
   *   the selection AFTER this transition, built by `makeSelection` (the only
   *   constructor — which is what makes a mixed selection unreachable from here)
   * @param {string|null} activeId
   * @param {{fx?: boolean}} [opts]
   */
  _apply(next, activeId, { fx = false } = {}) {
    const ctrl = this._ctrl
    const nextIds = entityIdsOf(next)

    // 1. Release the entities leaving the selection. An entity already detached
    //    from the scene resolves to null and is simply skipped. Switching KIND
    //    releases them all — nothing entity-shaped is selected any more.
    for (const id of this.ids) {
      if (nextIds.has(id)) continue
      const obj = ctrl._scene.getObject(id)
      if (!obj?.meshView) continue
      obj.meshView.setObjectSelected(false)
      if (obj instanceof CoordinateFrame) obj.meshView.hideParentAxesGhost?.()
    }

    // 2. The selection itself — one value carrying both cardinality and kind.
    this._sel = next

    // 3. Active entity. `setActiveObject` is the scene's own entry point; a
    //    selection with no active entity is legal (0 selected after a clear, and
    //    any variable selection — a variable is not an entity).
    if (activeId != null && activeId !== ctrl._scene.activeId) {
      ctrl._service.setActiveObject(activeId)
    }

    // 4. The 3-D shape of what is selected. EVERY declared painter runs with the
    //    whole selection, so a painter releases its own paint when the kind is
    //    no longer its own; `shapeForKind` is consulted so an undeclared kind
    //    throws here rather than painting nothing (ADR-107 D4 / 原則 #11).
    if (next.kind !== SELECTION_KIND.EMPTY) shapeForKind(next.kind)
    for (const paint of Object.keys(this._painters)) this._painters[paint](next, activeId)

    // 5. Visibility: one wholesale claim derived from the whole selection.
    this._claimContext()

    // 6. The windows that display the selection. They are told; they never poll
    //    (原則 #5), and the LINK NETWORK resolves entity → node itself (ADR-094).
    //    Both take ENTITY ids — with a variable selected they are told "none",
    //    which is the truth, not an omission.
    ctrl._service.updateLinkSelectionHighlight(nextIds)
    ctrl._linkNetworkView?.setSelection(nextIds)
    ctrl._uiView?.setSelectionSummary?.(selectionSummary(next))

    // 7. Presentation of the transition itself (ADR-068). Only on entering the
    //    selection of a Solid, never on re-selection churn (#30 volume discipline).
    const activeObj = activeId != null ? ctrl._scene.getObject(activeId) : null
    if (fx && nextIds.has(activeId) && activeObj instanceof Solid &&
        activeId !== this._lastFxId && activeObj.corners?.length === 8) {
      const corners = activeObj.corners
      ctrl._motion.spawn(reduced => new SelectPulse(ctrl._sceneView.scene, corners, { reduced }))
      this._lastFxId = activeId
    } else if (selectionSize(next) === 0) {
      this._lastFxId = null
    }

    // 8. Everything downstream that reads the selection.
    ctrl._refreshObjectModeStatus()
    ctrl._updateNPanel()
    ctrl._updateMobileToolbar()
    ctrl._syncContextProvenance?.()
  }

  // ── The declared painters (ADR-107 D4) ──────────────────────────────────────

  /**
   * `entities` — the outline itself, plus the parent-axes ghost on the active CF
   * only (ADR-034 §7: it answers "relative to what", a question about the one
   * entity the panels are talking about).
   */
  _paintMeshHighlight(sel, activeId) {
    const ctrl = this._ctrl
    for (const id of entityIdsOf(sel)) {
      const obj = ctrl._scene.getObject(id)
      if (!obj?.meshView) continue
      obj.meshView.setObjectSelected(true)
      if (!(obj instanceof CoordinateFrame)) continue
      const ghostPos = id === ctrl._scene.activeId ? ctrl._geometryAncestorCentroid(id) : null
      if (ghostPos) obj.meshView.showParentAxesGhost(ghostPos)
      else          obj.meshView.hideParentAxesGhost?.()
    }
  }

  /**
   * `variables` — the undecided band (ADR-050's region-ghost lineage) for each
   * selected variable. The bands' sole owner is `ContextController`, which
   * derives them wholesale from (mode, selection) in one place; handing it the
   * whole selection (empty set included) is how deselecting releases them.
   */
  _paintUndecidedBand(sel) {
    this._ctrl._ctxCtrl?.showVariableBands?.([...variableRefsOf(sel)])
  }

  /**
   * Normalises the mode so that "select something" means the same thing from
   * every window. Only the Outliner used to do this, so selecting from the
   * viewport while in Edit Mode left the app in a state the status bar could not
   * describe.
   */
  _normalizeMode() {
    const ctrl = this._ctrl
    if (ctrl._scene.selectionMode === 'edit') ctrl.setMode('object')
  }

  // ── The contextual axis (ADR-096) ───────────────────────────────────────────

  /**
   * Hands ONE claim, derived from the whole selection, to the axis' owner.
   * Wholesale replacement is the point: the manager decides which entities its
   * context wants and how strongly, `SceneService` composes that with the
   * `explicit` axis, and nothing accumulates.
   *
   * FULL beats DIMMED when two selected entities disagree about the same frame —
   * "someone is looking straight at it" is the stronger statement.
   *
   * ## The intensity rule, and why it is the same on both branches
   *
   * **What is selected is FULL; what merely hangs off it is DIMMED.** One rule,
   * both branches, so the invariant below holds no matter what mix is selected:
   *
   *     FULL(claim) === the selection      (exactly — never a superset)
   *     DIMMED(claim) === ⋃ chains − the selection
   *
   * ADR-099 named this as its mitigation for `RevealOnSelectMayFloodTheView`
   * ("contextual 軸の DIMMED を使い、選択本体だけ FULL にする") but the first
   * implementation applied it only to the CoordinateFrame branch: geometry
   * claimed its descendant frames at FULL, carrying over the single-selection
   * behaviour without asking what N does to it. Measured (2026-07-29, N Solids of
   * 3 frames each, rectangle selection):
   *
   * | N  | total | FULL (before) | FULL (after) |
   * |---:|------:|--------------:|-------------:|
   * |  1 |     4 |             4 |            1 |
   * | 10 |    40 |            40 |           10 |
   * | 50 |   200 |           200 |           50 |
   *
   * The *total* is unchanged (ADR-087 keeps its behaviour — selecting a Solid
   * still reveals its frames, and `visible = explicit || contextual !== null`
   * does not care which member it is), so this narrows the claim's **intensity**
   * and not its reach. That distinction is why the repair could stay short of the
   * "連鎖は主張しない" fallback the ADR held in reserve: dropping the chain would
   * have cost G2, dimming it costs nothing but emphasis.
   *
   * A Solid selected alone still has a full-intensity response — itself, whose
   * mesh the `want(id, FULL)` line below reveals. The frames around it were never
   * the tactile answer to "I picked this"; they are the context for it, which is
   * precisely what the CF branch has always called DIMMED.
   *
   * ## The variables branch (ADR-107 D5)
   *
   * Selecting a shared design variable claims the entities that variable
   * constrains — at DIMMED, by the SAME rule: what is selected is FULL, what
   * merely hangs off it is DIMMED. Since no entity is selected, FULL is empty,
   * and the invariant above holds unchanged rather than needing a second
   * formula:
   *
   *     FULL(claim) === the selection ∩ entities   (∅ for a variable selection)
   *     DIMMED(claim) === ⋃ chains − the selection
   *
   * This is what keeps the robot the user was looking at from vanishing when
   * they select a number about it — no new vocabulary, no `focused/neighbor`
   * second axis, just the claim the manager already makes (ADR-096 / ADR-099).
   */
  _claimContext() {
    const claim = new Map()
    const want = (id, strength) => {
      if (claim.get(id) === CONTEXTUAL.FULL) return
      claim.set(id, strength)
    }
    for (const ref of this.variableRefs) {
      // The chain of a variable = the entities the requirements constraining it
      // point at (ContextService owns the ref → scene-id half; the reachability
      // is pure). No document loaded ⇒ no chain, which is a legal empty claim.
      for (const sceneId of this._ctrl._ctxService?.entitiesConstrainedBy(ref) ?? []) {
        want(sceneId, CONTEXTUAL.DIMMED)
      }
    }
    for (const id of this.ids) {
      const obj = this._ctrl._scene.getObject(id)
      if (!obj) continue
      // The selected entity itself — ADR-099 G2. Without this line, selecting an
      // entity whose eye is closed is a decision with no visible consequence.
      want(id, CONTEXTUAL.FULL)
      if (obj instanceof CoordinateFrame) {
        for (const [fid, strength] of this._frameChainClaim(id)) want(fid, strength)
      } else {
        // The chain, not the pick — DIMMED (see the intensity rule above).
        for (const fid of this.collectAllDescendantFrames(id)) want(fid, CONTEXTUAL.DIMMED)
      }
    }
    this._ctrl._service.setContextualFrames(claim)
  }

  /**
   * The claim a selected CoordinateFrame makes: its whole TF tree, itself at
   * FULL and the rest DIMMED.
   *
   * A CoordinateFrame tree is rooted at EITHER a geometry Solid (user frames
   * hang off a Solid via its Origin frame, ADR-037) OR a world-parented root
   * CoordinateFrame that hangs off no geometry — the robot TF tree
   * (robot_base → tcp / user frames, ADR-084/085). An earlier version assumed
   * the former and bailed out (`if (!geoRoot) return`) whenever the walk reached
   * a parentless root frame, so selecting the robot — or adding / selecting any
   * robot-attached frame — showed nothing in the viewport.
   *
   * @param {string} frameId
   * @returns {Map<string, string>} id → CONTEXTUAL member
   */
  _frameChainClaim(frameId) {
    const ctrl = this._ctrl
    const start = ctrl._scene.getObject(frameId)
    if (!(start instanceof CoordinateFrame)) return new Map()

    // Walk up the parentId chain, remembering the last CoordinateFrame seen.
    let node   = start
    let rootCf = start
    while (node instanceof CoordinateFrame) {
      rootCf = node
      node   = ctrl._scene.getObject(node.parentId)
    }
    // `node` is the geometry root (a Solid) when the walk found one, else null
    // (frame-rooted tree). collectAllDescendantFrames() excludes the id passed
    // to it, so for a frame-rooted tree we add the root CoordinateFrame back in.
    const geoRoot = node
    const treeIds = this.collectAllDescendantFrames((geoRoot ?? rootCf).id)
    if (!geoRoot) treeIds.add(rootCf.id)

    return new Map([...treeIds].map(fid => [
      fid,
      fid === frameId ? CONTEXTUAL.FULL : CONTEXTUAL.DIMMED,
    ]))
  }

  /**
   * Collects ALL CoordinateFrame IDs in the frame tree rooted at `parentId`.
   * @param {string} parentId
   * @returns {Set<string>}
   */
  collectAllDescendantFrames(parentId) {
    const ctrl = this._ctrl
    const result = new Set()
    const recurse = (id) => {
      for (const child of ctrl._scene.getChildren(id)) {
        if (child instanceof CoordinateFrame) {
          result.add(child.id)
          recurse(child.id)
        }
      }
    }
    recurse(parentId)
    return result
  }

  // ── Rectangle selection ─────────────────────────────────────────────────────

  /** Updates the CSS overlay to reflect the current drag rectangle. */
  updateRectSelDisplay() {
    const ctrl = this._ctrl
    const { startPx, currentPx } = ctrl._rectSel
    const isRight = currentPx.x >= startPx.x
    const x = Math.min(startPx.x, currentPx.x)
    const y = Math.min(startPx.y, currentPx.y)
    const w = Math.abs(currentPx.x - startPx.x)
    const h = Math.abs(currentPx.y - startPx.y)
    Object.assign(ctrl._rectSelEl.style, {
      display:     'block',
      left:        x + 'px',
      top:         y + 'px',
      width:       w + 'px',
      height:      h + 'px',
      // A SEVENTH selection painter, not in ADR-100's blast-radius table —
      // found while collapsing the other six. Enclosed vs touch mode is
      // carried by the LINE STYLE (solid/dashed), which is what already
      // distinguished them; the two hues were saying "selecting" twice.
      border:      '1px ' + (isRight ? 'solid' : 'dashed') + ' ' + COLOR.accent,
      background:  rgba(COLOR.accent, 0.05),
    })
  }

  /**
   * Finalizes rectangle selection.
   * Right-drag (x increases): enclosed-only mode.
   * Left-drag (x decreases): touch (any overlap) mode.
   */
  finalizeRectSelection() {
    const ctrl = this._ctrl
    const { startPx, currentPx } = ctrl._rectSel
    const w = Math.abs(currentPx.x - startPx.x)
    const h = Math.abs(currentPx.y - startPx.y)

    if (w < 3 && h < 3) { this.clearSelection(); return }

    const isRight = currentPx.x >= startPx.x
    const minX = Math.min(startPx.x, currentPx.x)
    const minY = Math.min(startPx.y, currentPx.y)
    const maxX = Math.max(startPx.x, currentPx.x)
    const maxY = Math.max(startPx.y, currentPx.y)

    const matched = []
    for (const obj of ctrl._scene.objects.values()) {
      if (!obj.meshView.cuboid?.visible) continue
      const corners = obj.corners ?? _meshBboxCorners(obj)
      if (!corners || corners.length === 0) continue
      const pts = corners.map(c => projectToScreen(c, ctrl._camera))

      if (isRight) {
        if (pts.every(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) {
          matched.push(obj)
        }
      } else {
        const bMinX = Math.min(...pts.map(p => p.x))
        const bMaxX = Math.max(...pts.map(p => p.x))
        const bMinY = Math.min(...pts.map(p => p.y))
        const bMaxY = Math.max(...pts.map(p => p.y))
        if (bMinX <= maxX && bMaxX >= minX && bMinY <= maxY && bMaxY >= minY) {
          matched.push(obj)
        }
      }
    }

    // 0 matches is a legal outcome and means "deselect" — it goes through the
    // same entry as everything else rather than through a bespoke branch.
    this.selectMany(matched.map(o => o.id), { activeId: matched[0]?.id ?? null })
  }
}
