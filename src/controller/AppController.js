/**
 * AppController - handles user input and manages the animation loop
 *
 * Connects Model (CuboidModel) with View (SceneView / MeshView / UIView).
 * Side effects: event listener registration, requestAnimationFrame, Model state updates.
 */
import * as THREE from 'three'
import { FACES, computeOutwardFaceNormal, getCentroid, toNDC } from '../model/CuboidModel.js'

export class AppController {
  /**
   * @param {{ corners: THREE.Vector3[] }} model
   * @param {import('../view/SceneView.js').SceneView} sceneView
   * @param {import('../view/MeshView.js').MeshView} meshView
   * @param {import('../view/UIView.js').UIView} uiView
   */
  constructor(model, sceneView, meshView, uiView) {
    this._corners   = model.corners
    this._sceneView = sceneView
    this._meshView  = meshView
    this._uiView    = uiView

    // Build initial geometry
    meshView.updateGeometry(this._corners)

    // Selection mode
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

    // ── Face mode state ───────────────────────────────────────────────────
    this._hoveredFace      = null
    this._faceDragging     = false
    this._dragFaceIdx      = null
    this._dragNormal       = new THREE.Vector3()
    this._dragPlane        = new THREE.Plane()
    this._dragStart        = new THREE.Vector3()
    this._savedFaceCorners = []

    // ── Blender-style grab state ──────────────────────────────────────────
    // G to start, X/Y/Z to constrain axis, type a value to set distance,
    // Enter/LClick to confirm, Esc/RClick to cancel.
    this._grab = {
      active:       false,
      axis:         null,               // null | 'x' | 'y' | 'z'
      startMouse:   new THREE.Vector2(),
      startCorners: [],
      centroid:     new THREE.Vector3(),
      dragPlane:    new THREE.Plane(),  // camera-facing plane for free grab
      startPoint:   new THREE.Vector3(),
      inputStr:     '',                 // numeric input buffer
      hasInput:     false,
    }

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

    this._grab.active       = true
    this._grab.axis         = null
    this._grab.inputStr     = ''
    this._grab.hasInput     = false
    this._grab.startMouse.copy(this._mouse)
    this._grab.startCorners = this._corners.map(c => c.clone())
    this._grab.centroid.copy(getCentroid(this._corners))

    // Set up camera-facing plane through the centroid
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._grab.dragPlane.setFromNormalAndCoplanarPoint(camDir, this._grab.centroid)

    // Start point = intersection of current mouse ray with the plane
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._grab.dragPlane, pt)) {
      this._grab.startPoint.copy(pt)
    } else {
      this._grab.startPoint.copy(this._grab.centroid)
    }

    this._controls.enabled = false
    this._updateGrabStatus()
  }

  /** Confirms and applies the grab */
  _confirmGrab() {
    if (!this._grab.active) return
    this._applyGrab()
    this._grab.active = false
    this._grab.axis   = null
    this._controls.enabled = true
    this._uiView.setStatus(this._objSelected ? 'Object selected' : '')
  }

  /** Cancels the grab and restores the original position */
  _cancelGrab() {
    if (!this._grab.active) return
    this._grab.startCorners.forEach((c, i) => this._corners[i].copy(c))
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
    this._grab.active = false
    this._grab.axis   = null
    this._controls.enabled = true
    this._uiView.setStatus(this._objSelected ? 'Object selected' : '')
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
    const delta = pt.clone().sub(this._grab.startPoint)
    this._grab.startCorners.forEach((c, i) => {
      this._corners[i].copy(c).add(delta)
    })
  }

  /**
   * Axis-constrained grab: projects mouse movement onto the screen-space
   * representation of the world axis to derive the world-space distance.
   *
   * Steps:
   * 1. Project centroid and (centroid + axis unit vector) to NDC to get the
   *    screen-space axis direction.
   * 2. Project the mouse delta (NDC) onto that direction to get NDC movement.
   * 3. Divide by the screen-space length per world unit to get world distance.
   */
  _applyAxisConstrainedGrab() {
    const axisVec = this._getAxisVec(this._grab.axis)

    // Project centroid and centroid+axis to NDC
    const centerNDC  = this._grab.centroid.clone().project(this._camera)
    const axisEndNDC = this._grab.centroid.clone().add(axisVec).project(this._camera)

    const dx        = axisEndNDC.x - centerNDC.x
    const dy        = axisEndNDC.y - centerNDC.y
    const screenLen = Math.sqrt(dx * dx + dy * dy)
    if (screenLen < 1e-4) return

    const axisNormX = dx / screenLen
    const axisNormY = dy / screenLen

    // Project mouse delta (NDC) onto axis direction → convert to world distance
    const mdx  = this._mouse.x - this._grab.startMouse.x
    const mdy  = this._mouse.y - this._grab.startMouse.y
    const dist = (mdx * axisNormX + mdy * axisNormY) / screenLen

    this._grab.startCorners.forEach((c, i) => {
      this._corners[i].copy(c).addScaledVector(axisVec, dist)
    })
  }

  /** Updates the status bar with current grab information */
  _updateGrabStatus() {
    const axisLabel  = this._grab.axis ? ` ${this._grab.axis.toUpperCase()}` : ''
    const inputLabel = this._grab.hasInput ? `  input: ${this._grab.inputStr}_` : ''
    this._uiView.setStatus(`Grab${axisLabel}${inputLabel}`)
  }

  // ─── Mouse events ─────────────────────────────────────────────────────────
  _onMouseMove(e) {
    this._updateMouse(e)

    // During grab: update position in real time
    if (this._grab.active) {
      this._applyGrab()
      this._updateGrabStatus()
      return
    }

    if (this._selectionMode === 'object') {
      if (this._objDragging) {
        if (this._objCtrlDrag) {
          // Rotate around centroid on the Y axis
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle)
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
      } else {
        this._uiView.setCursor(this._hitCuboid() ? 'pointer' : 'default')
      }
      return
    }

    // ── Face mode ────────────────────────────────────────────────────────
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
      this._uiView.setStatus(`${FACES[this._dragFaceIdx].name}  Δ ${dist.toFixed(3)}`)

      // Extrusion display: bracket-style lines + label
      const currentFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci])
      this._meshView.setExtrusionDisplay(this._savedFaceCorners, currentFaceCorners)
      // Label sits at the midpoint of the span segment (same ARM_LEN=0.5 as MeshView)
      const armDir = new THREE.Vector3()
        .subVectors(this._savedFaceCorners[1], this._savedFaceCorners[0]).normalize()
      const ARM_LEN = 0.5
      const tipS = this._savedFaceCorners[0].clone().addScaledVector(armDir, ARM_LEN)
      const tipC = currentFaceCorners[0].clone().addScaledVector(armDir, ARM_LEN)
      const midpoint = tipS.clone().add(tipC).multiplyScalar(0.5)
        .addScaledVector(armDir, 0.15)
      const screen = this._projectToScreen(midpoint)
      this._uiView.setExtrusionLabel(`Δ ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
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
    // During grab: left-click confirms, right-click cancels
    if (this._grab.active) {
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

    // ── Face mode ────────────────────────────────────────────────────────
    const hit = this._hitFace()
    if (!hit) return
    this._faceDragging        = true
    this._dragFaceIdx         = hit.faceIdx
    this._controls.enabled    = false
    this._dragNormal.copy(computeOutwardFaceNormal(this._corners, this._dragFaceIdx))
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._dragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
    this._dragStart.copy(hit.point)
    this._savedFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci].clone())
  }

  _onMouseUp(e) {
    if (e.button !== 0) return
    if (this._objDragging)  { this._objDragging  = false; this._objCtrlDrag = false; this._controls.enabled = true }
    if (this._faceDragging) {
      this._faceDragging = false
      this._dragFaceIdx  = null
      this._controls.enabled = true
      this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
    }
  }

  _onKeyDown(e) {
    // ── Keys active during grab ───────────────────────────────────────────
    if (this._grab.active) {
      switch (e.key) {
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
    if (e.key === 'o' || e.key === 'O') this.setMode('object')
    if (e.key === 'f' || e.key === 'F') this.setMode('face')
    if ((e.key === 'g' || e.key === 'G') && this._selectionMode === 'object' && this._objSelected) {
      this._startGrab()
    }
  }

  // ─── Animation loop ───────────────────────────────────────────────────────
  start() {
    const loop = () => {
      requestAnimationFrame(loop)
      this._sceneView.render()
    }
    loop()
  }
}
