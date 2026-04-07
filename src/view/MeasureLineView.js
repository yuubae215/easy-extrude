// @ts-nocheck — pre-existing Three.js object-access patterns; not yet fully annotated.
/**
 * MeasureLineView — 1D measurement line renderer (Phase D).
 *
 * Renders:
 *  - A dashed Three.js Line from p1 to p2
 *  - An HTML label at the midpoint showing the distance in metres
 *  - A BoxHelper for selection highlight (reuses BoxHelper convention from MeshView)
 *
 * Exposes the minimal interface expected by AppController / SceneService:
 *   setVisible(v), setObjectSelected(v), dispose(scene)
 *   + edit-mode no-ops to keep setMode() safe.
 *
 * Note: the `cuboid` property alias is intentionally absent — MeasureLine
 * objects are excluded from raycasting in AppController._hitAnyObject().
 */
import * as THREE from 'three'

export class MeasureLineView {
  /**
   * @param {THREE.Scene}   scene       Three.js scene to add objects to
   * @param {HTMLElement}   container   DOM element to append the label to (typically document.body)
   * @param {THREE.Camera}  camera      Camera used to project world→screen for label placement
   * @param {HTMLElement}   renderer    renderer.domElement — used to get canvas bounds
   */
  constructor(scene, container, camera, renderer) {
    this._scene    = scene
    this._container = container
    this._camera   = camera
    this._renderer = renderer

    // ── Line geometry ──────────────────────────────────────────────────────
    this._geo = new THREE.BufferGeometry()
    this._mat = new THREE.LineDashedMaterial({
      color:       0xf9a825,   // amber — clearly distinct from grid / wireframe
      dashSize:    0.15,
      gapSize:     0.08,
      linewidth:   1,          // only 1 is guaranteed cross-browser
      depthTest:   false,
    })
    this._line = new THREE.Line(this._geo, this._mat)
    this._line.renderOrder = 1
    scene.add(this._line)

    // ── End-point markers (small spheres) ──────────────────────────────────
    const dotGeo = new THREE.SphereGeometry(0.05, 8, 8)
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xf9a825, depthTest: false })
    this._dot1 = new THREE.Mesh(dotGeo, dotMat)
    this._dot2 = new THREE.Mesh(dotGeo, dotMat)
    this._dot1.renderOrder = 1
    this._dot2.renderOrder = 1
    scene.add(this._dot1)
    scene.add(this._dot2)
    this._dotGeo = dotGeo
    this._dotMat = dotMat

    // ── BoxHelper for object-selected highlight ────────────────────────────
    // We attach to an invisible helper object whose bounding-box wraps the line.
    this._helperObj = new THREE.Object3D()
    scene.add(this._helperObj)
    this.boxHelper = new THREE.BoxHelper(this._helperObj, 0xf9a825)
    this.boxHelper.visible = false
    scene.add(this.boxHelper)

    // ── HTML distance label ────────────────────────────────────────────────
    this._label = document.createElement('div')
    Object.assign(this._label.style, {
      position:      'fixed',
      pointerEvents: 'none',
      userSelect:    'none',
      background:    'rgba(30, 30, 30, 0.82)',
      color:         '#f9a825',
      fontSize:      '12px',
      fontFamily:    'monospace',
      padding:       '2px 6px',
      borderRadius:  '3px',
      border:        '1px solid #f9a825',
      whiteSpace:    'nowrap',
      display:       'none',
      zIndex:        '50',
    })
    container.appendChild(this._label)

    // ── Internal state ─────────────────────────────────────────────────────
    /** @type {THREE.Vector3} */
    this._p1 = new THREE.Vector3()
    /** @type {THREE.Vector3} */
    this._p2 = new THREE.Vector3()
  }

  // ── Geometry update ────────────────────────────────────────────────────────

  /**
   * Updates both endpoints and refreshes geometry + label.
   * @param {THREE.Vector3} p1
   * @param {THREE.Vector3} p2
   */
  update(p1, p2) {
    this._p1.copy(p1)
    this._p2.copy(p2)

    const pts = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]
    this._geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    this._geo.attributes.position.needsUpdate = true
    this._line.computeLineDistances()     // required for LineDashedMaterial

    this._dot1.position.copy(p1)
    this._dot2.position.copy(p2)

    // Reposition helper object so BoxHelper wraps the line
    const mid = p1.clone().add(p2).multiplyScalar(0.5)
    this._helperObj.position.copy(mid)
    if (this.boxHelper.visible) this.boxHelper.update()

    this._updateLabel(p1, p2)
  }

  /**
   * Projects midpoint to screen and updates label position + text.
   * Must be called once per frame (from AppController._animate) while the
   * measure line is visible, so the label tracks camera movement.
   */
  updateLabelPosition() {
    if (!this._line.visible) return
    this._updateLabel(this._p1, this._p2)
    this._scaleDots()
  }

  /**
   * Scales endpoint spheres so they appear at a constant screen size (~8 px)
   * regardless of camera distance.  Called every frame from updateLabelPosition().
   */
  _scaleDots() {
    const cam = this._camera
    if (!cam.isPerspectiveCamera) return
    const tanHalfFov = Math.tan((cam.fov * Math.PI) / 360)
    const screenH    = this._renderer.domElement.clientHeight || 1
    const targetPx   = 8   // desired diameter in screen pixels
    for (const dot of [this._dot1, this._dot2]) {
      const d = cam.position.distanceTo(dot.position)
      // world size that covers targetPx pixels at distance d
      const worldSize = (targetPx / screenH) * 2 * d * tanHalfFov
      // base sphere radius is 0.05; scale factor = worldSize / 0.05
      const s = worldSize / 0.05
      dot.scale.setScalar(s)
    }
  }

  _updateLabel(p1, p2) {
    const dist = p1.distanceTo(p2)
    const mid  = p1.clone().add(p2).multiplyScalar(0.5)

    // Project to NDC then to screen pixels
    const ndc = mid.clone().project(this._camera)
    const canvas = this._renderer.domElement
    const rect   = canvas.getBoundingClientRect()
    const sx = (ndc.x  + 1) / 2 * rect.width  + rect.left
    const sy = (-ndc.y + 1) / 2 * rect.height + rect.top

    // Hide label if behind camera
    if (ndc.z > 1) {
      this._label.style.display = 'none'
      return
    }

    const formatted = dist < 0.001
      ? '0 m'
      : dist < 1
        ? `${(dist * 100).toFixed(1)} cm`
        : `${dist.toFixed(3)} m`

    this._label.textContent  = formatted
    this._label.style.display = 'block'
    this._label.style.left   = `${Math.round(sx + 8)}px`
    this._label.style.top    = `${Math.round(sy - 10)}px`
  }

  // ── Visual state ───────────────────────────────────────────────────────────

  setVisible(visible) {
    this._line.visible = visible
    this._dot1.visible = visible
    this._dot2.visible = visible
    this._label.style.display = visible ? 'block' : 'none'
  }

  setObjectSelected(sel) {
    this.boxHelper.visible = sel
    if (sel) this.boxHelper.update()
  }

  // ── Move support ───────────────────────────────────────────────────────────

  /**
   * Called by AppController after move() to refresh the line and label.
   * corners = [p1, p2] — exactly two Vector3s.
   * @param {THREE.Vector3[]} corners
   */
  updateGeometry(corners) {
    if (!corners || corners.length < 2) return
    this.update(corners[0], corners[1])
  }

  /** Refreshes the BoxHelper outline (called by AppController after confirm/cancel grab). */
  updateBoxHelper() {
    if (this.boxHelper.visible) this.boxHelper.update()
  }

  // ── Edit-mode no-ops (keeps AppController.setMode() safe) ─────────────────

  setFaceHighlight()     {}
  clearExtrusionDisplay() {}
  clearSketchRect()      {}
  clearVertexHover()     {}
  clearEdgeHover()       {}
  clearEditSelection()   {}
  clearPivotDisplay()    {}
  clearSnapDisplay()     {}
  showSnapCandidates()   {}
  showSnapNearest()      {}
  clearSnapNearest()     {}
  showSnapLocked()       {}
  clearSnapLocked()      {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Removes all Three.js objects from the scene and the label from the DOM.
   * @param {THREE.Scene} scene
   */
  dispose(scene) {
    scene.remove(this._line)
    scene.remove(this._dot1)
    scene.remove(this._dot2)
    scene.remove(this._helperObj)
    scene.remove(this.boxHelper)
    this._geo.dispose()
    this._mat.dispose()
    this._dotGeo.dispose()
    this._dotMat.dispose()
    this._label.remove()
  }
}
