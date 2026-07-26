/**
 * SelectionManager — object selection, frame-chain visibility, and rectangle
 * selection finalization for AppController.
 *
 * State (_selectedIds, _objSelected, _rectSel, _rectSelEl) lives on
 * AppController for backward compatibility; this manager reads/writes it via
 * ctrl.
 *
 * Visibility (ADR-096): this manager writes the `contextual` axis and nothing
 * else. It used to call `meshView.showFull()/showDimmed()/hide()` directly,
 * which made it a second writer of the same pixels the Outliner eye writes —
 * neither read the other, so opening a frame's eye and then selecting anything
 * else wiped the frame while its row still said "visible". The set of frames the
 * current selection wants is now handed to `SceneService.setContextualFrames()`,
 * which composes it with the `explicit` axis. Handlers own axes; pixels have one
 * owner (原則 #4).
 *
 * Owned by AppController as this._selMgr.
 */

import * as THREE from 'three'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { projectToScreen }  from './snap/SnapSystem.js'
import { CONTEXTUAL }       from '../view/VisibilityAxes.js'

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
  }

  /**
   * Sets the visual selection state on the active object and updates frame
   * visibility, status bar, and toolbar.
   * @param {boolean} sel
   */
  setObjectSelected(sel) {
    const ctrl = this._ctrl
    ctrl._objSelected = sel
    if (ctrl._meshView) ctrl._meshView.setObjectSelected(sel)
    if (ctrl._scene.activeId) {
      const active = ctrl._scene.getObject(ctrl._scene.activeId)
      if (active instanceof CoordinateFrame) {
        if (sel) this.showFrameChain(ctrl._scene.activeId)
        else     this.hideFrameChain()
      } else {
        this.setChildFramesVisible(ctrl._scene.activeId, sel)
      }
    }
    ctrl._refreshObjectModeStatus()
    ctrl._updateMobileToolbar()
    ctrl._syncContextProvenance?.()
  }

  /** Clears visual selection highlight for all currently selected objects. */
  clearObjectSelection() {
    const ctrl = this._ctrl
    this.hideFrameChain()
    for (const id of ctrl._selectedIds) {
      const obj = ctrl._scene.getObject(id)
      if (obj) obj.meshView.setObjectSelected(false)
    }
    ctrl._selectedIds.clear()
    ctrl._service.updateLinkSelectionHighlight(new Set())
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

  /**
   * Shows or hides the frame tree attached to a geometry object.
   * @param {string|null} parentId
   * @param {boolean} visible
   */
  setChildFramesVisible(parentId, visible) {
    if (!parentId) return
    if (visible) this.showGeometryFrameTree(parentId)
    else         this.hideFrameChain()
  }

  /**
   * Shows all CoordinateFrame descendants of a geometry object at full opacity.
   * @param {string} geoId
   */
  showGeometryFrameTree(geoId) {
    const treeIds = this.collectAllDescendantFrames(geoId)
    this._claimContext(new Map([...treeIds].map(fid => [fid, CONTEXTUAL.FULL])))
  }

  /**
   * Shows the full frame tree that `frameId` belongs to.
   * The selected frame is full opacity; all others are dimmed.
   *
   * A CoordinateFrame tree is rooted at EITHER a geometry Solid (user frames
   * hang off a Solid via its Origin frame, ADR-037) OR a world-parented root
   * CoordinateFrame that hangs off no geometry — the robot TF tree
   * (robot_base → tcp / user frames, ADR-084/085). The earlier version assumed
   * the former and bailed out (`if (!geoRoot) return`) whenever the walk reached
   * a parentless root frame, so selecting the robot — or adding / selecting any
   * robot-attached frame — showed nothing in the viewport (no CF axes, no tap
   * feedback). We now root the tree at that root CoordinateFrame instead.
   * @param {string} frameId
   */
  showFrameChain(frameId) {
    const ctrl = this._ctrl
    const start = ctrl._scene.getObject(frameId)
    if (!(start instanceof CoordinateFrame)) return

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

    this._claimContext(new Map([...treeIds].map(fid => [
      fid,
      fid === frameId ? CONTEXTUAL.FULL : CONTEXTUAL.DIMMED,
    ])))
  }

  /**
   * Releases this manager's claim on the contextual axis — the frames it was
   * showing go back to whatever their `explicit` axis says, which for a frame
   * the user opened by hand means STAYING VISIBLE (ADR-096 §症状 4; it used to
   * mean vanishing while the row's eye stayed open).
   */
  hideFrameChain() {
    this._claimContext(new Map())
  }

  /**
   * Recomputes the contextual claim from the current selection. Called by
   * transient sub-modes (link creation) that borrow the axis and must hand it
   * back without guessing what was on screen before — the guess is what let the
   * two writers drift apart.
   */
  refreshFrameContext() {
    const ctrl = this._ctrl
    const activeId = ctrl._scene.activeId
    if (!activeId || !ctrl._objSelected) { this.hideFrameChain(); return }
    const active = ctrl._scene.getObject(activeId)
    if (active instanceof CoordinateFrame) this.showFrameChain(activeId)
    else                                   this.setChildFramesVisible(activeId, true)
  }

  /**
   * Hands a contextual claim to its owner (原則 #4). The manager decides WHICH
   * frames its context wants and how strongly; `SceneService` composes that with
   * the `explicit` axis and is the only thing that touches a mesh view.
   * @param {Map<string, string>} frames  id → CONTEXTUAL member
   */
  _claimContext(frames) {
    const ctrl = this._ctrl
    ctrl._service.setContextualFrames(frames)
  }

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

    if (w < 3 && h < 3) {
      this.clearObjectSelection()
      this.setObjectSelected(false)
      return
    }

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

    this.clearObjectSelection()
    if (matched.length === 0) {
      this.setObjectSelected(false)
      return
    }

    for (const obj of matched) {
      obj.meshView.setObjectSelected(true)
      this.setChildFramesVisible(obj.id, true)
      ctrl._selectedIds.add(obj.id)
    }

    const first = matched[0]
    if (first.id !== ctrl._scene.activeId) {
      ctrl._service.setActiveObject(first.id)
    }
    ctrl._objSelected = true
    ctrl._refreshObjectModeStatus()
    ctrl._updateNPanel()
    ctrl._syncContextProvenance?.()
  }
}
