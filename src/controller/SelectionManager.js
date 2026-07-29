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
 * that cleared one without the other). There is now ONE representation — the set
 * — and `AppController._objSelected` is a getter over it, so the illegal state
 * cannot be written down and every assignment to it throws.
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
 * State lives on AppController (`_selMgr._ids` is read through
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
import { CONTEXTUAL }      from '../view/VisibilityAxes.js'

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
     * THE selection. Its cardinality (0 / 1 / N) is the state; `_objSelected` is
     * a getter over `size > 0` and has no storage of its own.
     * @type {Set<string>}
     */
    this._ids = new Set()
    /** Last entity that got a select pulse — keeps re-selection churn quiet (#30). */
    this._lastFxId = null
  }

  // ── Reading ─────────────────────────────────────────────────────────────────

  /** The live selection set. Read-only by convention; the census test enforces it. */
  get ids() { return this._ids }

  /** Selection cardinality — 0, 1 or N (原則 #31). */
  get count() { return this._ids.size }

  /** @param {string} id */
  has(id) { return this._ids.has(id) }

  // ── The public entry points (原則 #1) ────────────────────────────────────────

  /**
   * Selects exactly one entity and makes it active. The verb every window uses
   * for "the user picked this".
   *
   * @param {string} id
   * @param {{fx?: boolean}} [opts]  `fx:false` for a RESTORE (returning from Edit
   *   Mode re-asserts a selection the user never dropped, so it must not fire the
   *   select pulse again — the pulse means "this just became selected").
   */
  selectOnly(id, { fx = true } = {}) {
    if (id == null) return
    this._normalizeMode()
    this._apply([id], id, { fx })
  }

  /**
   * Selects a whole set at once, with `activeId` as the one the panels talk
   * about (rectangle selection, assembly selection).
   *
   * There is deliberately no `addToSelection(id)`: no window asks for
   * single-item additive selection today, and an unused public verb is a second
   * entry point waiting to drift out of step with this one (§5).
   *
   * @param {Iterable<string>} ids
   * @param {{activeId?: string|null}} [opts]
   */
  selectMany(ids, { activeId = null } = {}) {
    const list = [...ids]
    if (list.length === 0) { this.clearSelection(); return }
    this._normalizeMode()
    // No pulse for a bulk selection: the pulse answers "which one did I just
    // pick", and with N it answers nothing while costing N effects (#30).
    this._apply(list, activeId ?? list[0], { fx: false })
  }

  /**
   * Drops the whole selection. The active entity stays active — the N panel and
   * the mode machinery keep talking about it, exactly as before ADR-099.
   */
  clearSelection() {
    this._apply([], this._ctrl._scene.activeId ?? null, { fx: false })
  }

  /**
   * Moves the active entity WITHIN the current selection (clicking an
   * already-selected object must not collapse a multi-selection to one).
   * @param {string} id
   */
  activateWithinSelection(id) {
    if (!this._ids.has(id)) { this.selectOnly(id); return }
    this._apply([...this._ids], id, { fx: false })
  }

  /**
   * Forgets an entity that is leaving the scene. Called by the delete path
   * BEFORE anything else re-selects, so a detached id can never survive inside
   * the selection or inside the contextual claim.
   * @param {string} id
   */
  forget(id) {
    if (!this._ids.has(id)) return
    // The active entity is NOT chosen here: the delete path already knows which
    // entity should take over and says so with `selectOnly`. Guessing one would
    // be a second opinion about the same fact (§1.1).
    this._apply([...this._ids].filter(x => x !== id), this._ctrl._scene.activeId ?? null)
  }

  /**
   * Re-asserts the selection highlight after something REPLACED the mesh under
   * a selected entity (rotation rebuilds a Solid's geometry). It changes no
   * state — it re-runs the presentation of the state that is already there, and
   * it exists so that "rebuild the mesh" does not become a fourth writer of the
   * highlight (原則 #4).
   */
  reassertHighlight() {
    for (const id of this._ids) {
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
   * @param {string[]} ids       the selection AFTER this transition
   * @param {string|null} activeId
   * @param {{fx?: boolean}} [opts]
   */
  _apply(ids, activeId, { fx = false } = {}) {
    const ctrl = this._ctrl
    const next = new Set(ids)

    // 1. Release the entities leaving the selection. An entity already detached
    //    from the scene resolves to null and is simply skipped.
    for (const id of this._ids) {
      if (next.has(id)) continue
      const obj = ctrl._scene.getObject(id)
      if (!obj?.meshView) continue
      obj.meshView.setObjectSelected(false)
      if (obj instanceof CoordinateFrame) obj.meshView.hideParentAxesGhost?.()
    }

    // 2. The set itself.
    this._ids = next

    // 3. Active entity. `setActiveObject` is the scene's own entry point; a
    //    selection with no active entity is legal (0 selected after a clear).
    if (activeId != null && activeId !== ctrl._scene.activeId) {
      ctrl._service.setActiveObject(activeId)
    }

    // 4. Highlight every selected entity, and hang the parent-axes ghost on the
    //    active CF only (ADR-034 §7 — it answers "relative to what", which is a
    //    question about the one entity the panels are talking about).
    for (const id of next) {
      const obj = ctrl._scene.getObject(id)
      if (!obj?.meshView) continue
      obj.meshView.setObjectSelected(true)
      if (!(obj instanceof CoordinateFrame)) continue
      const ghostPos = id === ctrl._scene.activeId ? ctrl._geometryAncestorCentroid(id) : null
      if (ghostPos) obj.meshView.showParentAxesGhost(ghostPos)
      else          obj.meshView.hideParentAxesGhost?.()
    }

    // 5. Visibility: one wholesale claim derived from the whole selection.
    this._claimContext()

    // 6. The windows that display the selection. They are told; they never poll
    //    (原則 #5), and the LINK NETWORK resolves entity → node itself (ADR-094).
    ctrl._service.updateLinkSelectionHighlight(this._ids)
    ctrl._linkNetworkView?.setSelection(this._ids)

    // 7. Presentation of the transition itself (ADR-068). Only on entering the
    //    selection of a Solid, never on re-selection churn (#30 volume discipline).
    const activeObj = activeId != null ? ctrl._scene.getObject(activeId) : null
    if (fx && next.has(activeId) && activeObj instanceof Solid &&
        activeId !== this._lastFxId && activeObj.corners?.length === 8) {
      const corners = activeObj.corners
      ctrl._motion.spawn(reduced => new SelectPulse(ctrl._sceneView.scene, corners, { reduced }))
      this._lastFxId = activeId
    } else if (next.size === 0) {
      this._lastFxId = null
    }

    // 8. Everything downstream that reads the selection.
    ctrl._refreshObjectModeStatus()
    ctrl._updateNPanel()
    ctrl._updateMobileToolbar()
    ctrl._syncContextProvenance?.()
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
   */
  _claimContext() {
    const claim = new Map()
    const want = (id, strength) => {
      if (claim.get(id) === CONTEXTUAL.FULL) return
      claim.set(id, strength)
    }
    for (const id of this._ids) {
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
      border:      '1px ' + (isRight ? 'solid' : 'dashed') + ' ' + (isRight ? '#4fc3f7' : '#ffa726'),
      background:  isRight ? 'rgba(79,195,247,0.05)' : 'rgba(255,167,38,0.05)',
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
