/**
 * EditModeSelectionHandler — sub-element selection for Edit Mode · 3D.
 *
 * Handles vertex/edge/face hover detection, click selection, and the
 * mode-switching (1 Vertex / 2 Edge / 3 Face) UI.
 *
 * State (_editSelectMode, _hoveredFace/Vertex/Edge) lives on AppController
 * for backward compatibility; this handler reads/writes it via ctrl.
 *
 * Owned by AppController as this._editSelHandler.
 */

import { projectToScreen } from '../snap/SnapSystem.js'

export class EditModeSelectionHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl
  }

  /** Status bar for Edit Mode · 3D showing current sub-element mode. */
  refreshStatus() {
    const LABEL = { vertex: 'Vertex', edge: 'Edge', face: 'Face' }
    const COLOR = { vertex: '#69f0ae', edge: '#ffd740', face: '#4fc3f7' }
    const m = this._ctrl._editSelectMode
    this._ctrl._uiView.setStatusRich([
      { text: 'Edit', color: '#888' },
      { text: LABEL[m], bold: true, color: COLOR[m] },
      { text: '1 Vertex  2 Edge  3 Face', color: '#444' },
    ])
  }

  /** Switches the sub-element mode and clears stale hover state. */
  setEditSelectMode(mode) {
    const ctrl = this._ctrl
    ctrl._editSelectMode = mode
    ctrl._hoveredFace    = null
    ctrl._hoveredVertex  = null
    ctrl._hoveredEdge    = null
    if (ctrl._meshView) {
      ctrl._meshView.setFaceHighlight(null, ctrl._corners)
      ctrl._meshView.clearVertexHover()
      ctrl._meshView.clearEdgeHover()
    }
    ctrl._uiView.setCursor('default')
    this.refreshStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Finds the vertex of the active object nearest to screen position (mx, my).
   * @param {number} mx  screen x in pixels
   * @param {number} my  screen y in pixels
   * @param {number} [maxPx=15]
   * @returns {import('../../graph/Vertex.js').Vertex|null}
   */
  findNearestVertex(mx, my, maxPx = 15) {
    const obj = this._ctrl._activeObj
    if (!obj?.vertices) return null
    let best = null, bestDist = maxPx
    for (const v of obj.vertices) {
      const s = projectToScreen(v.position, this._ctrl._camera)
      const d = Math.hypot(s.x - mx, s.y - my)
      if (d < bestDist) { bestDist = d; best = v }
    }
    return best
  }

  /**
   * Finds the edge of the active object nearest to screen position (mx, my)
   * by comparing to each edge's midpoint.
   * @param {number} mx
   * @param {number} my
   * @param {number} [maxPx=15]
   * @returns {import('../../graph/Edge.js').Edge|null}
   */
  findNearestEdge(mx, my, maxPx = 15) {
    const obj = this._ctrl._activeObj
    if (!obj?.edges) return null
    let best = null, bestDist = maxPx
    for (const e of obj.edges) {
      const mid = e.v0.position.clone().add(e.v1.position).multiplyScalar(0.5)
      const s = projectToScreen(mid, this._ctrl._camera)
      const d = Math.hypot(s.x - mx, s.y - my)
      if (d < bestDist) { bestDist = d; best = e }
    }
    return best
  }

  /**
   * Handles a click in Edit Mode · 3D — updates editSelection and visuals.
   * @param {boolean} shift  whether Shift was held
   */
  handleEditClick(shift) {
    const ctrl = this._ctrl
    const sel = ctrl._scene.editSelection
    let element = null

    if (ctrl._editSelectMode === 'face')        element = ctrl._hoveredFace
    else if (ctrl._editSelectMode === 'vertex') element = ctrl._hoveredVertex
    else if (ctrl._editSelectMode === 'edge')   element = ctrl._hoveredEdge

    if (!element) {
      if (!shift) ctrl._scene.clearEditSelection()
    } else {
      if (shift) {
        if (sel.has(element)) sel.delete(element)
        else                  sel.add(element)
      } else {
        ctrl._scene.clearEditSelection()
        sel.add(element)
      }
    }

    ctrl._meshView.updateEditSelection(sel, ctrl._corners)

    const count = sel.size
    if (count > 0) {
      const LABEL = { vertex: 'vertex', edge: 'edge', face: 'face' }
      ctrl._uiView.setStatusRich([
        { text: String(count), bold: true, color: '#e8e8e8' },
        { text: `${LABEL[ctrl._editSelectMode]}${count > 1 ? 's' : ''} selected`, color: '#888' },
      ])
    } else {
      this.refreshStatus()
    }
    ctrl._updateMobileToolbar()
  }
}
