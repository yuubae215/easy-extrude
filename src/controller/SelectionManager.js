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
   * Shows the full frame tree of the geometry root that `frameId` belongs to.
   * The selected frame is full opacity; all others are dimmed.
   * @param {string} frameId
   */
  showFrameChain(frameId) {
    const ctrl = this._ctrl
    let geoRoot = ctrl._scene.getObject(frameId)
    while (geoRoot instanceof CoordinateFrame) {
      geoRoot = ctrl._scene.getObject(geoRoot.parentId)
    }
    if (!geoRoot) return

    const treeIds = this.collectAllDescendantFrames(geoRoot.id)
    ctrl._activeFrameChain = treeIds

    for (const fid of treeIds) {
      const f = ctrl._scene.getObject(fid)
      if (!f) continue
      const isSelected = fid === frameId
      if (isSelected) f.meshView.showFull()
      else            f.meshView.showDimmed()
      if (!ctrl._scene.isLinkEndpoint(fid)) f.meshView.showConnection(!isSelected)
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
