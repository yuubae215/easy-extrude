/**
 * AppController - handles user input and manages the animation loop
 *
 * Connects Model (CuboidModel) with View (SceneView / MeshView / UIView).
 * Side effects: event listener registration, requestAnimationFrame, Model state updates.
 */
import * as THREE from 'three'
import { FACES, computeOutwardFaceNormal, getCentroid, toNDC, getPivotCandidates } from '../model/CuboidModel.js'

export class AppController {
  /**
   * @param {{ corners: THREE.Vector3[] }} model
   * @param {import('../view/SceneView.js').SceneView} sceneView
   * @param {import('../view/MeshView.js').MeshView} meshView
   * @param {import('../view/UIView.js').UIView} uiView
   */
  constructor(model, sceneView, meshView, uiView, gizmoView = null) {
    this._corners   = model.corners
    this._sceneView = sceneView
    this._meshView  = meshView
    this._uiView    = uiView
    this._gizmoView = gizmoView

    // Build initial geometry
    meshView.updateGeometry(this._corners)

    // Selection mode: 'object' | 'edit'
    this._selectionMode = 'object'

    // ── Object mode state ─────────────────────────────────────────────────
    this._objSelected           = false
    this._objDragging           = false
    this._objCtrlDrag           = false
    this._objDragPlane          = new THREE.Plane()
    this._objDragStart          = new THREE.Vector3()
    this._objDragStartCorners   = []
    this._objRotateStartX       = 0
    this._objRotateCentroid     = new THREE.Vector3()
    this._objRotateStartCorners = []

    // ── Edit mode (face extrude) state ────────────────────────────────────
    this._hoveredFace      = null
    this._faceDragging     = false
    this._dragFaceIdx      = null
    this._dragNormal       = new THREE.Vector3()
    this._dragPlane        = new THREE.Plane()
    this._dragStart        = new THREE.Vector3()
    this._savedFaceCorners = []

    // ── Blender-style grab state ──────────────────────────────────────────
    // G to start, X/Y/Z to constrain axis, type a value to set distance,
    // G > V to select pivot point, Enter/LClick to confirm, Esc/RClick to cancel.
    this._grab = {
      active:          false,
      axis:            null,               // null | 'x' | 'y' | 'z'
      startMouse:      new THREE.Vector2(),
      startCorners:    [],
      centroid:        new THREE.Vector3(),
      pivot:           new THREE.Vector3(), // active pivot (default = centroid)
      pivotLabel:      'Centroid',
      dragPlane:       new THREE.Plane(),  // camera-facing plane through pivot
      startPoint:      new THREE.Vector3(),
      inputStr:        '',                 // numeric input buffer
      hasInput:        false,
      // Pivot select sub-mode (G > V)
      pivotSelectMode: false,
      hoveredPivotIdx: -1,
      candidates:      [],
      // Ctrl snap state
      snapping:        false,
    }

    // Ctrl key state (for snap-to-origin during grab)
    this._ctrlHeld = false

    // Raycaster
    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()

    // UI wiring
    uiView.setCanvas(sceneView.renderer.domElement)
    uiView.onModeChange(mode => this.setMode(mode))

    this._bindEvents()
    this.setMode('object')
  }

  // ─── Convenience getters ──────────────────────────────────────────────────
  get _camera()   { return this._sceneView.camera }
  get _controls() { return this._sceneView.controls }

  // ─── Event binding ────────────────────────────────────────────────────────
  _bindEvents() {
    window.addEventListener('mousemove', e => this._onMouseMove(e))
    window.addEventListener('mousedown', e => this._onMouseDown(e))
    window.addEventListener('mouseup',   e => this._onMouseUp(e))
    window.addEventListener('keydown',   e => this._onKeyDown(e))
    window.addEventListener('keyup',     e => this._onKeyUp(e))
  }

  // ─── Raycasting ───────────────────────────────────────────────────────────
  _updateMouse(e) {
    const v = toNDC(e.clientX, e.clientY, innerWidth, innerHeight)
    this._mouse.copy(v)
  }

  _hitCuboid() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const hits = this._raycaster.intersectObject(this._meshView.cuboid)
    return hits.length ? hits[0] : null
  }

  _hitFace() {
    const hit = this._hitCuboid()
    if (!hit) return null
    return { faceIdx: Math.floor(hit.face.a / 4), point: hit.point }
  }

  // ─── Utilities ────────────────────────────────────────────────────────────
  /** Converts a 3D world position to screen coordinates (px) */
  _projectToScreen(position) {
    const v = position.clone().project(this._camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  /** Computes centroid and bounding box dimensions, then updates the N panel */
  _updateNPanel() {
    if (!this._uiView.nPanelVisible) return
    const centroid = getCentroid(this._corners)
    const bMin = new THREE.Vector3(Infinity, Infinity, Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    this._corners.forEach(c => { bMin.min(c); bMax.max(c) })
    const dims = new THREE.Vector3().subVectors(bMax, bMin)
    this._uiView.updateNPanel(centroid, dims)
  }

  // ─── Mode management ──────────────────────────────────────────────────────
  setMode(mode) {
    if (this._grab.active) this._cancelGrab()
    this._selectionMode = mode
    if (mode === 'object') {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
      this._hoveredFace  = null
      this._faceDragging = false
      this._dragFaceIdx  = null
      this._uiView.setStatus(this._objSelected ? 'Object selected' : '')
    } else {
      // edit mode
      this._setObjectSelected(false)
      this._objDragging = false
      this._uiView.setStatus('')
    }
    this._controls.enabled = true
    this._uiView.updateMode(mode)
  }

  _setObjectSelected(sel) {
    this._objSelected = sel
    this._meshView.setObjectSelected(sel)
    this._uiView.setStatus(sel ? 'Object selected' : '')
  }

  // ─── Blender-style grab ───────────────────────────────────────────────────

  /** Starts grab mode (G key) */
  _startGrab() {
    if (!this._objSelected) return

    this._grab.active          = true
    this._grab.axis            = null
    this._grab.inputStr        = ''
    this._grab.hasInput        = false
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._grab.startMouse.copy(this._mouse)
    this._grab.startCorners = this._corners.map(c => c.clone())
    this._grab.centroid.copy(getCentroid(this._corners))
    this._grab.pivot.copy(this._grab.centroid)
    this._grab.pivotLabel = 'Centroid'

    // Set up camera-facing plane through the pivot
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._grab.dragPlane.setFromNormalAndCoplanarPoint(camDir, this._grab.pivot)

    // Start point = intersection of current mouse ray with the plane
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._grab.dragPlane, pt)) {
      this._grab.startPoint.copy(pt)
    } else {
      this._grab.startPoint.copy(this._grab.pivot)
    }

    this._controls.enabled = false
    this._uiView.setCursor('grabbing')
    this._updateGrabStatus()
  }

  /** Confirms and applies the grab */
  _confirmGrab() {
    if (!this._grab.active) return
    if (this._grab.pivotSelectMode) { this._cancelPivotSelect(); return }
    this._applyGrab()
    this._grab.active = false
    this._grab.axis   = null
    this._meshView.clearPivotDisplay()
    this._controls.enabled = true
    this._uiView.setCursor('default')
    this._uiView.setStatus(this._objSelected ? 'Object selected' : '')
    this._updateNPanel()
  }

  /** Cancels the grab and restores the original position */
  _cancelGrab() {
    if (!this._grab.active) return
    if (this._grab.pivotSelectMode) { this._grab.pivotSelectMode = false }
    this._grab.startCorners.forEach((c, i) => this._corners[i].copy(c))
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
    this._meshView.clearPivotDisplay()
    this._grab.active = false
    this._grab.axis   = null
    this._controls.enabled = true
    this._uiView.setCursor('default')
    this._uiView.setStatus(this._objSelected ? 'Object selected' : '')
    this._updateNPanel()
  }

  /** Sets the axis constraint (pressing the same key again removes it) */
  _setGrabAxis(axis) {
    this._grab.axis     = (this._grab.axis === axis) ? null : axis
    this._grab.inputStr = ''
    this._grab.hasInput = false
    this._applyGrab()
    this._updateGrabStatus()
  }

  /** Returns the world-space unit vector for the given axis */
  _getAxisVec(axis) {
    return new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
  }

  /** Computes the grab offset and applies it to all corners */
  _applyGrab() {
    if (!this._grab.active) return
    if (this._grab.hasInput && this._grab.axis) {
      this._applyGrabFromInput()
    } else if (this._grab.axis) {
      this._applyAxisConstrainedGrab()
    } else {
      this._applyFreeGrab()
    }
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
  }

  /** Applies grab offset from numeric input */
  _applyGrabFromInput() {
    this._grab.snapping = false
    const dist    = parseFloat(this._grab.inputStr) || 0
    const axisVec = this._getAxisVec(this._grab.axis)
    this._grab.startCorners.forEach((c, i) => {
      this._corners[i].copy(c).addScaledVector(axisVec, dist)
    })
  }

  /** Free grab: follows the mouse on a camera-facing plane */
  _applyFreeGrab() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (!this._raycaster.ray.intersectPlane(this._grab.dragPlane, pt)) return
    let delta = pt.clone().sub(this._grab.startPoint)
    if (this._ctrlHeld) {
      delta = this._trySnapToOrigin(delta)
    } else {
      this._grab.snapping = false
    }
    this._grab.startCorners.forEach((c, i) => {
      this._corners[i].copy(c).add(delta)
    })
  }

  /**
   * Axis-constrained grab: projects mouse movement onto the screen-space
   * representation of the world axis to derive the world-space distance.
   *
   * Steps:
   * 1. Project pivot and (pivot + axis unit vector) to NDC to get the
   *    screen-space axis direction.
   * 2. Project the mouse delta (NDC) onto that direction to get NDC movement.
   * 3. Divide by the screen-space length per world unit to get world distance.
   */
  _applyAxisConstrainedGrab() {
    const axisVec = this._getAxisVec(this._grab.axis)

    // Project pivot and pivot+axis to NDC
    const centerNDC  = this._grab.pivot.clone().project(this._camera)
    const axisEndNDC = this._grab.pivot.clone().add(axisVec).project(this._camera)

    const dx        = axisEndNDC.x - centerNDC.x
    const dy        = axisEndNDC.y - centerNDC.y
    const screenLen = Math.sqrt(dx * dx + dy * dy)
    if (screenLen < 1e-4) return

    const axisNormX = dx / screenLen
    const axisNormY = dy / screenLen

    // Project mouse delta (NDC) onto axis direction -> convert to world distance
    const mdx  = this._mouse.x - this._grab.startMouse.x
    const mdy  = this._mouse.y - this._grab.startMouse.y
    const dist = (mdx * axisNormX + mdy * axisNormY) / screenLen

    if (this._ctrlHeld) {
      const delta       = new THREE.Vector3().addScaledVector(axisVec, dist)
      const snappedDelta = this._trySnapToOrigin(delta)
      this._grab.startCorners.forEach((c, i) => {
        this._corners[i].copy(c).add(snappedDelta)
      })
    } else {
      this._grab.snapping = false
      this._grab.startCorners.forEach((c, i) => {
        this._corners[i].copy(c).addScaledVector(axisVec, dist)
      })
    }
  }

  /** Updates the status bar with current grab information */
  _updateGrabStatus() {
    if (this._grab.pivotSelectMode) {
      this._uiView.setStatus('Select Pivot Point  [click / Esc]')
      return
    }
    const axisLabel  = this._grab.axis ? ` ${this._grab.axis.toUpperCase()}` : ''
    const inputLabel = this._grab.hasInput ? `  input: ${this._grab.inputStr}_` : ''
    const pivotStr   = this._grab.pivotLabel !== 'Centroid' ? `  [${this._grab.pivotLabel}]` : ''
    const snapStr    = this._grab.snapping ? '  >> SNAP: World Origin' : ''
    this._uiView.setStatus(`Grab${axisLabel}${inputLabel}${pivotStr}${snapStr}`)
  }

  // ─── Ctrl snap-to-origin ─────────────────────────────────────────────────

  /**
   * Checks if applying delta would bring the pivot within snap range of world origin.
   * If so, returns a corrected delta that places the pivot exactly at the origin.
   * Sets this._grab.snapping accordingly.
   * @param {THREE.Vector3} delta
   * @returns {THREE.Vector3}
   */
  _trySnapToOrigin(delta) {
    const SNAP_PX  = 25
    const ORIGIN   = new THREE.Vector3(0, 0, 0)
    const pivotAfter = this._grab.pivot.clone().add(delta)

    const pNDC = pivotAfter.clone().project(this._camera)
    const oNDC = ORIGIN.clone().project(this._camera)
    const px   = (pNDC.x + 1) / 2 * innerWidth
    const py   = (-pNDC.y + 1) / 2 * innerHeight
    const ox   = (oNDC.x + 1) / 2 * innerWidth
    const oy   = (-oNDC.y + 1) / 2 * innerHeight

    if (Math.hypot(px - ox, py - oy) < SNAP_PX) {
      this._grab.snapping = true
      return this._grab.pivot.clone().negate() // moves pivot exactly to origin
    }
    this._grab.snapping = false
    return delta
  }

  // ─── Pivot point selection ────────────────────────────────────────────────

  /** Enters pivot select sub-mode (V key during grab) */
  _startPivotSelect() {
    if (!this._grab.active || this._grab.pivotSelectMode) return
    // Reset object to its position at grab start so it aligns with the candidates
    this._grab.startCorners.forEach((c, i) => this._corners[i].copy(c))
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
    this._grab.pivotSelectMode = true
    this._grab.hoveredPivotIdx = -1
    this._grab.candidates = getPivotCandidates(this._grab.startCorners)
    this._meshView.showPivotCandidates(this._grab.candidates)
    this._updateGrabStatus()
  }

  /** Scans candidates and snaps highlight to the nearest one within threshold */
  _updatePivotHover() {
    const SNAP_PX = 30
    let minDist    = Infinity
    let closestIdx = -1
    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight
    this._grab.candidates.forEach((c, i) => {
      const ndc = c.position.clone().project(this._camera)
      const sx  = (ndc.x + 1) / 2 * innerWidth
      const sy  = (-ndc.y + 1) / 2 * innerHeight
      const d   = Math.hypot(sx - mx, sy - my)
      if (d < minDist) { minDist = d; closestIdx = i }
    })
    if (minDist <= SNAP_PX && closestIdx >= 0) {
      this._grab.hoveredPivotIdx = closestIdx
      const cand = this._grab.candidates[closestIdx]
      this._meshView.setHoveredPivot(cand.position)
      this._uiView.setStatus(`Pivot: ${cand.label}`)
    } else {
      this._grab.hoveredPivotIdx = -1
      this._meshView.setHoveredPivot(null)
      this._uiView.setStatus('Select Pivot Point  [click / Esc]')
    }
  }

  /** Confirms the hovered pivot and returns to grab mode */
  _confirmPivotSelect() {
    const idx = this._grab.hoveredPivotIdx
    if (idx >= 0) {
      const cand = this._grab.candidates[idx]
      this._grab.pivot.copy(cand.position)
      this._grab.pivotLabel = cand.label
      this._restartGrabFromPivot()
    }
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._meshView.clearPivotDisplay()
    this._updateGrabStatus()
  }

  /** Cancels pivot select and returns to grab mode without changing pivot */
  _cancelPivotSelect() {
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._meshView.clearPivotDisplay()
    this._updateGrabStatus()
  }

  /**
   * Updates the drag plane and start point after a pivot change.
   * Resets axis/input so the new grab starts cleanly from the current mouse position.
   */
  _restartGrabFromPivot() {
    const pivot  = this._grab.pivot
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._grab.dragPlane.setFromNormalAndCoplanarPoint(camDir, pivot)
    this._grab.startPoint.copy(pivot)
    this._grab.axis     = null
    this._grab.inputStr = ''
    this._grab.hasInput = false
    this._grab.startMouse.copy(this._mouse)
  }

  // ─── Mouse events ─────────────────────────────────────────────────────────
  _onMouseMove(e) {
    this._updateMouse(e)

    // During grab
    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        this._updatePivotHover()
        return
      }
      this._applyGrab()
      if (this._ctrlHeld) {
        this._meshView.showSnapTarget(new THREE.Vector3(0, 0, 0), this._grab.snapping)
      }
      this._updateGrabStatus()
      this._updateNPanel()
      return
    }

    if (this._selectionMode === 'object') {
      if (this._objDragging) {
        if (this._objCtrlDrag) {
          // Rotate around centroid on the Z axis (ROS: +Z is up)
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
          this._objRotateStartCorners.forEach((c, i) => {
            this._corners[i].copy(c).sub(this._objRotateCentroid).applyQuaternion(quat).add(this._objRotateCentroid)
          })
        } else {
          // Translate on the camera-facing drag plane
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const pt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(this._objDragPlane, pt)) {
            const delta = pt.clone().sub(this._objDragStart)
            this._objDragStartCorners.forEach((c, i) => this._corners[i].copy(c).add(delta))
          }
        }
        this._meshView.updateGeometry(this._corners)
        if (this._objSelected) this._meshView.updateBoxHelper()
        this._updateNPanel()
      } else {
        this._uiView.setCursor(this._hitCuboid() ? 'pointer' : 'default')
      }
      return
    }

    // ── Edit mode (face extrude) ──────────────────────────────────────────
    if (this._faceDragging) {
      this._raycaster.setFromCamera(this._mouse, this._camera)
      const pt = new THREE.Vector3()
      if (!this._raycaster.ray.intersectPlane(this._dragPlane, pt)) return
      const dist   = pt.clone().sub(this._dragStart).dot(this._dragNormal)
      const offset = this._dragNormal.clone().multiplyScalar(dist)
      FACES[this._dragFaceIdx].corners.forEach((ci, i) => {
        this._corners[ci].copy(this._savedFaceCorners[i]).add(offset)
      })
      this._meshView.updateGeometry(this._corners)
      this._meshView.setFaceHighlight(this._dragFaceIdx, this._corners)
      this._uiView.setStatus(`${FACES[this._dragFaceIdx].name}  D ${dist.toFixed(3)}`)

      // Extrusion display: I-type dimension line + label at span midpoint
      const currentFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci])
      const { spanMid, armDir } = this._meshView.setExtrusionDisplay(this._savedFaceCorners, currentFaceCorners)
      const labelPos = spanMid.clone().addScaledVector(armDir, 0.25)
      const screen = this._projectToScreen(labelPos)
      this._uiView.setExtrusionLabel(`D ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
      this._updateNPanel()
      return
    }

    // Face hover detection
    const hit = this._hitFace()
    const fi  = hit ? hit.faceIdx : null
    if (fi !== this._hoveredFace) {
      this._hoveredFace = fi
      this._meshView.setFaceHighlight(fi, this._corners)
      this._uiView.setStatus(fi !== null ? FACES[fi].name : '')
      this._uiView.setCursor(fi !== null ? 'pointer' : 'default')
    }
  }

  _onMouseDown(e) {
    // During grab
    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        if (e.button === 0) { this._confirmPivotSelect(); return }
        if (e.button === 2) { this._cancelPivotSelect();  return }
        return
      }
      if (e.button === 0) { this._confirmGrab(); return }
      if (e.button === 2) { this._cancelGrab();  return }
      return
    }

    if (e.button !== 0) return
    this._updateMouse(e)

    if (this._selectionMode === 'object') {
      const hit = this._hitCuboid()
      if (hit) {
        if (!this._objSelected) this._setObjectSelected(true)
        this._objDragging       = true
        this._objCtrlDrag       = e.ctrlKey
        this._controls.enabled  = false
        this._uiView.setCursor('grabbing')
        const camDir = new THREE.Vector3()
        this._camera.getWorldDirection(camDir)
        this._objDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
        this._objDragStart.copy(hit.point)
        this._objDragStartCorners = this._corners.map(c => c.clone())
        if (e.ctrlKey) {
          this._objRotateStartX = e.clientX
          this._objRotateCentroid.copy(getCentroid(this._corners))
          this._objRotateStartCorners = this._corners.map(c => c.clone())
        }
      } else {
        this._setObjectSelected(false)
      }
      return
    }

    // ── Edit mode (face extrude) ──────────────────────────────────────────
    const hit = this._hitFace()
    if (!hit) return
    this._faceDragging        = true
    this._dragFaceIdx         = hit.faceIdx
    this._controls.enabled    = false
    this._uiView.setCursor('grabbing')
    this._dragNormal.copy(computeOutwardFaceNormal(this._corners, this._dragFaceIdx))
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
    this._dragStart.copy(hit.point)
    this._savedFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci].clone())
  }

  _onMouseUp(e) {
    if (e.button !== 0) return
    if (this._objDragging)  {
      this._objDragging  = false
      this._objCtrlDrag  = false
      this._controls.enabled = true
      this._uiView.setCursor(this._hitCuboid() ? 'pointer' : 'default')
      this._updateNPanel()
    }
    if (this._faceDragging) {
      this._faceDragging = false
      this._dragFaceIdx  = null
      this._controls.enabled = true
      this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
      this._uiView.setCursor('default')
      this._updateNPanel()
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Control') {
      this._ctrlHeld = false
      if (this._grab.active && !this._grab.pivotSelectMode) {
        this._grab.snapping = false
        this._meshView.clearPivotDisplay()
        this._updateGrabStatus()
      }
    }
  }

  _onKeyDown(e) {
    // Track Ctrl state
    if (e.key === 'Control') this._ctrlHeld = true

    // ── Keys active during grab ───────────────────────────────────────────
    if (this._grab.active) {
      // Pivot select sub-mode swallows all keys except Escape
      if (this._grab.pivotSelectMode) {
        if (e.key === 'Escape') this._cancelPivotSelect()
        return
      }
      switch (e.key) {
        case 'v': case 'V': this._startPivotSelect(); return
        case 'x': case 'X': this._setGrabAxis('x'); return
        case 'y': case 'Y': this._setGrabAxis('y'); return
        case 'z': case 'Z': this._setGrabAxis('z'); return
        case 'Enter':        this._confirmGrab();    return
        case 'Escape':       this._cancelGrab();     return
      }
      // Numeric input (only when an axis is constrained)
      if (this._grab.axis) {
        if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
          this._grab.inputStr += e.key
          this._grab.hasInput  = true
          this._applyGrab()
          this._updateGrabStatus()
          return
        }
        if (e.key === '-' && this._grab.inputStr.length === 0) {
          this._grab.inputStr = '-'
          this._grab.hasInput = true
          this._updateGrabStatus()
          return
        }
        if (e.key === 'Backspace') {
          this._grab.inputStr = this._grab.inputStr.slice(0, -1)
          this._grab.hasInput = this._grab.inputStr.length > 0 && this._grab.inputStr !== '-'
          this._applyGrab()
          this._updateGrabStatus()
          return
        }
      }
      return  // swallow all other keys during grab
    }

    // ── Normal keys ───────────────────────────────────────────────────────
    // Tab: toggle Object Mode <-> Edit Mode
    if (e.key === 'Tab') {
      e.preventDefault()
      this.setMode(this._selectionMode === 'object' ? 'edit' : 'object')
      return
    }
    // N: toggle N panel
    if (e.key === 'n' || e.key === 'N') {
      this._uiView.toggleNPanel()
      this._updateNPanel()
      if (this._gizmoView) {
        this._gizmoView.setRightOffset(this._uiView.nPanelVisible ? 216 : 16)
      }
      return
    }
    if (e.key === 'o' || e.key === 'O') this.setMode('object')
    if (e.key === 'e' || e.key === 'E') this.setMode('edit')
    if ((e.key === 'g' || e.key === 'G') && this._selectionMode === 'object' && this._objSelected) {
      this._startGrab()
    }
  }

  // ─── Animation loop ───────────────────────────────────────────────────────
  start() {
    const loop = () => {
      requestAnimationFrame(loop)
      this._sceneView.render()
      if (this._gizmoView) this._gizmoView.update()
    }
    loop()
  }
}
