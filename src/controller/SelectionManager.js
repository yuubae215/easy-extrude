/**
 * SelectionManager — object selection, frame-chain visibility, and rectangle
 * selection finalization for AppController.
 *
 * State (_selectedIds, _objSelected, _activeFrameChain, _rectSel, _rectSelEl)
 * lives on AppController for backward compatibility; this manager reads/writes
 * it via ctrl.
 *
 * Owned by AppController as this._selMgr.
 */

import * as THREE from 'three'
import { CoordinateFrame } from '../domain/CoordinateFrame.js'
import { projectToScreen }  from './snap/SnapSystem.js'

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
    const ctrl = this._ctrl
    const treeIds = this.collectAllDescendantFrames(geoId)
    ctrl._activeFrameChain = treeIds
    for (const fid of treeIds) {
      const f = ctrl._scene.getObject(fid)
      if (!f) continue
      f.meshView.showFull()
      if (!ctrl._scene.isLinkEndpoint(fid)) f.meshView.showConnection(false)
    }
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
    ctrl._activeFrameChain = treeIds

    for (const fid of treeIds) {
      const f = ctrl._scene.getObject(fid)
      if (!f) continue
      const isSelected = fid === frameId
      if (isSelected) f.meshView.showFull()
      else            f.meshView.showDimmed()
      // A connection line runs from the parent's origin (a Solid centroid or a
      // CoordinateFrame origin). A world-parented root frame (robot_base) has no
      // parent, and SceneService skips updating its line (it would be a
      // degenerate origin→origin segment), so it gets no connection line.
      const hasParent = ctrl._scene.getObject(f.parentId) != null
      if (hasParent && !ctrl._scene.isLinkEndpoint(fid)) f.meshView.showConnection(!isSelected)
    }
  }

  /** Hides all frames in _activeFrameChain and clears connection lines. */
  hideFrameChain() {
    const ctrl = this._ctrl
    const chain = ctrl._activeFrameChain
    ctrl._activeFrameChain = new Set()
    for (const fid of chain) {
      const f = ctrl._scene.getObject(fid)
      if (!f) continue
      f.meshView.hide()
      f.meshView.hideConnection()
    }
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
