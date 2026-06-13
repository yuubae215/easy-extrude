// @ts-nocheck
/**
 * RegionAuthoringWidget — a bidirectional 3D input device for an AABB admissible
 * region (ADR-049 Phase 3, §5.2). Renders a 2-D footprint box on the ground
 * plane with draggable corner handles (resize) and a center handle (translate).
 *
 * This is the "双方向化" half of the uncertainty ghost: the same 3D surface that
 * *shows* an admissible region is also where the user *authors* it. Dragging a
 * handle produces a new `stated` admissible region that the controller writes
 * back into a ContextEditModel and re-validates live, recolouring the widget by
 * conflict state (green = clear, red = conflicting). The text DSL stays the
 * contract (ADR-049 invariant 9).
 *
 * Lifecycle mirrors RippleEffect / UncertaintyGhostView: constructor adds to the
 * scene; the owning ContextDemoController calls tick() per frame and dispose() on
 * exit. Sole owner = ContextDemoController (PHILOSOPHY #4/#9).
 *
 * Coordinates: the box lives in world XY on the ground plane. Flat parts are
 * lifted slightly off Z=0 so they don't straddle the plane / z-fight with the
 * grid (CODE_CONTRACTS §4 "Ground Markers Must Not Straddle Z=0").
 *
 * @module view/RegionAuthoringWidget
 */
import * as THREE from 'three'

const Z_FILL    = 2     // mm lift for the fill + edges
const Z_HANDLE  = 6     // mm lift for the pickable handles (above the fill)
const OK_COLOR       = 0x10b981 // green — region currently clear of conflict
const CONFLICT_COLOR = 0xcc3333 // red — region in conflict
const HANDLE_COLOR   = 0xffffff

export class RegionAuthoringWidget {
  /**
   * @param {THREE.Scene} scene
   * @param {HTMLElement} container        DOM element for the HTML label
   * @param {object} cfg
   * @param {{x:[number,number], y:[number,number]}} cfg.region  initial AABB box
   * @param {number} cfg.handleRadius      world-unit handle pick radius
   * @param {string} cfg.labelText
   */
  constructor(scene, container, { region, handleRadius = 30, labelText = '' }) {
    this._scene  = scene
    this._region = { x: [...region.x], y: [...region.y] }
    this._r      = handleRadius
    this._conflict = false

    this._group = new THREE.Group()
    scene.add(this._group)

    // Fill plane (transparent; depthTest true — it is a ground object, ADR §4).
    this._fillMat = new THREE.MeshBasicMaterial({
      color: OK_COLOR, transparent: true, opacity: 0.18,
      depthTest: true, depthWrite: false, side: THREE.DoubleSide,
    })
    this._fill = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._fillMat)
    this._fill.renderOrder = 1
    this._group.add(this._fill)

    // Edge ring.
    this._edgeMat = new THREE.LineBasicMaterial({ color: OK_COLOR, transparent: true, opacity: 0.9 })
    this._edges = new THREE.LineLoop(new THREE.BufferGeometry(), this._edgeMat)
    this._edges.renderOrder = 2
    this._group.add(this._edges)

    // Handles: 4 corners (resize) + 1 center (translate).
    this._handleMat = new THREE.MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false })
    this._handleGeo = new THREE.SphereGeometry(handleRadius, 12, 12)
    this._handles = {}
    for (const id of ['x0y0', 'x1y0', 'x1y1', 'x0y1', 'center']) {
      const m = new THREE.Mesh(this._handleGeo, this._handleMat)
      m.renderOrder = 3
      m.userData.handleId = id
      this._handles[id] = m
      this._group.add(m)
    }

    // HTML label (MeasureLineView pattern).
    this._container = container
    this._label = document.createElement('div')
    Object.assign(this._label.style, {
      position: 'fixed', pointerEvents: 'none', userSelect: 'none',
      background: 'rgba(30,30,30,0.85)', color: '#10b981', fontSize: '12px',
      fontFamily: 'monospace', padding: '3px 8px', borderRadius: '3px',
      border: '1px solid #10b981', whiteSpace: 'nowrap', display: 'none', zIndex: '50',
    })
    this._label.textContent = labelText
    this._labelText = labelText
    container.appendChild(this._label)

    this._visible = true
    this._drag = null
    this._rebuild()
  }

  // ── Read / write region ─────────────────────────────────────────────────────

  getRegion() { return { x: [...this._region.x], y: [...this._region.y] } }

  setRegion(region) {
    this._region = { x: [...region.x], y: [...region.y] }
    this._rebuild()
  }

  // ── Picking + drag (driven by ContextDemoController) ────────────────────────

  /** Meshes to raycast for hit-testing a handle. */
  get handleMeshes() { return Object.values(this._handles) }

  /** Begin a drag on a handle id at a world point. */
  startDrag(handleId, worldPoint) {
    this._drag = {
      id: handleId,
      grab: worldPoint.clone(),
      start: { x: [...this._region.x], y: [...this._region.y] },
    }
  }

  /** Update the region from the current world point; returns the new region. */
  dragTo(worldPoint) {
    if (!this._drag) return this.getRegion()
    const dx = worldPoint.x - this._drag.grab.x
    const dy = worldPoint.y - this._drag.grab.y
    const s = this._drag.start
    const MIN = this._r * 2 // minimum box size so it never collapses

    if (this._drag.id === 'center') {
      this._region = { x: [s.x[0] + dx, s.x[1] + dx], y: [s.y[0] + dy, s.y[1] + dy] }
    } else {
      const x = [...s.x], y = [...s.y]
      if (this._drag.id.includes('x0')) x[0] = Math.min(s.x[0] + dx, s.x[1] - MIN)
      if (this._drag.id.includes('x1')) x[1] = Math.max(s.x[1] + dx, s.x[0] + MIN)
      if (this._drag.id.includes('y0')) y[0] = Math.min(s.y[0] + dy, s.y[1] - MIN)
      if (this._drag.id.includes('y1')) y[1] = Math.max(s.y[1] + dy, s.y[0] + MIN)
      this._region = { x, y }
    }
    this._rebuild()
    return this.getRegion()
  }

  endDrag() { this._drag = null }

  // ── Visual state ────────────────────────────────────────────────────────────

  /** Recolour by conflict state (green = clear, red = conflicting). */
  setConflict(inConflict) {
    if (inConflict === this._conflict) return
    this._conflict = inConflict
    const c = inConflict ? CONFLICT_COLOR : OK_COLOR
    this._fillMat.color.setHex(c)
    this._edgeMat.color.setHex(c)
    this._label.style.color = `#${c.toString(16).padStart(6, '0')}`
    this._label.style.borderColor = `#${c.toString(16).padStart(6, '0')}`
  }

  setVisible(visible) {
    this._visible = visible
    this._group.visible = visible
    if (!visible) this._label.style.display = 'none'
  }

  tick(t, camera, renderer) {
    if (!this._visible) return
    // Gentle fill pulse so the editable region reads as live.
    this._fillMat.opacity = 0.18 + 0.06 * Math.sin(t * 2)
    this._updateLabel(camera, renderer)
  }

  // ── Internal geometry ───────────────────────────────────────────────────────

  _rebuild() {
    const [x0, x1] = this._region.x
    const [y0, y1] = this._region.y
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2

    this._fill.position.set(cx, cy, Z_FILL)
    this._fill.scale.set(Math.max(x1 - x0, 1e-3), Math.max(y1 - y0, 1e-3), 1)

    const pts = [
      new THREE.Vector3(x0, y0, Z_FILL), new THREE.Vector3(x1, y0, Z_FILL),
      new THREE.Vector3(x1, y1, Z_FILL), new THREE.Vector3(x0, y1, Z_FILL),
    ]
    this._edges.geometry.setFromPoints(pts)

    this._handles.x0y0.position.set(x0, y0, Z_HANDLE)
    this._handles.x1y0.position.set(x1, y0, Z_HANDLE)
    this._handles.x1y1.position.set(x1, y1, Z_HANDLE)
    this._handles.x0y1.position.set(x0, y1, Z_HANDLE)
    this._handles.center.position.set(cx, cy, Z_HANDLE)

    this._labelText && (this._label.textContent =
      `${this._labelText}  [${Math.round(x0)},${Math.round(x1)}]×[${Math.round(y0)},${Math.round(y1)}]`)
    this._labelAnchor = new THREE.Vector3(cx, cy, Z_HANDLE)
  }

  _updateLabel(camera, renderer) {
    if (!camera || !renderer || !this._labelAnchor) return
    const ndc = this._labelAnchor.clone().project(camera)
    if (ndc.z > 1) { this._label.style.display = 'none'; return }
    const rect = renderer.domElement.getBoundingClientRect()
    const sx = (ndc.x + 1) / 2 * rect.width + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top
    this._label.style.display = 'block'
    this._label.style.left = `${Math.round(sx)}px`
    this._label.style.top  = `${Math.round(sy - 28)}px`
  }

  dispose() {
    this._scene.remove(this._group)
    this._fill.geometry.dispose()
    this._fillMat.dispose()
    this._edges.geometry.dispose()
    this._edgeMat.dispose()
    this._handleGeo.dispose()
    this._handleMat.dispose()
    this._label.remove()
  }
}
