/**
 * AppController - handles user input and coordinates the animation loop.
 *
 * Connects SceneModel (domain state) with the View layer (SceneView / MeshView /
 * UIView / OutlinerView). Owns only transient interaction state (drag, hover,
 * grab, sketch phase, etc.) — persistent domain state lives in SceneModel.
 *
 * Side effects: event listener registration, requestAnimationFrame, SceneModel
 * and View mutations.
 */
import * as THREE from 'three'
import {
  FACES,
  createInitialCorners,
  buildCuboidFromRect,
  computeOutwardFaceNormal,
  getCentroid,
  toNDC,
  getPivotCandidates,
} from '../model/CuboidModel.js'
import { SceneModel } from '../model/SceneModel.js'
import { MeshView } from '../view/MeshView.js'

export class AppController {
  /**
   * @param {import('../view/SceneView.js').SceneView}       sceneView
   * @param {import('../view/UIView.js').UIView}             uiView
   * @param {import('../view/GizmoView.js').GizmoView}       gizmoView
   * @param {import('../view/OutlinerView.js').OutlinerView} outlinerView
   */
  constructor(sceneView, uiView, gizmoView = null, outlinerView = null) {
    this._sceneView    = sceneView
    this._uiView       = uiView
    this._gizmoView    = gizmoView
    this._outlinerView = outlinerView

    // ── Domain state (SceneModel owns objects, activeId, mode) ────────────
    this._scene = new SceneModel()

    // ── Sketch drawing state (Edit Mode · 2D) ──────────────────────────────
    this._sketch = {
      drawing: false,
      p1: null,  // THREE.Vector3 ground-plane point
      p2: null,  // THREE.Vector3 ground-plane point
    }
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

    // ── Sketch-to-cuboid extrude state ─────────────────────────────────────
    this._extrudePhase = {
      dragPlane:  new THREE.Plane(),
      startPoint: new THREE.Vector3(),
      height:     0,
      inputStr:   '',
      hasInput:   false,
    }

    // ── Object mode state ──────────────────────────────────────────────────
    this._objSelected           = false
    this._objDragging           = false
    this._objCtrlDrag           = false
    this._objDragPlane          = new THREE.Plane()
    this._objDragStart          = new THREE.Vector3()
    this._objDragStartCorners   = []
    this._objRotateStartX       = 0
    this._objRotateCentroid     = new THREE.Vector3()
    this._objRotateStartCorners = []

    // ── Edit mode (face extrude) state ─────────────────────────────────────
    this._hoveredFace      = null
    this._faceDragging     = false
    this._dragFaceIdx      = null
    this._dragNormal       = new THREE.Vector3()
    this._dragPlane        = new THREE.Plane()
    this._dragStart        = new THREE.Vector3()
    this._savedFaceCorners = []

    // ── Blender-style grab state ───────────────────────────────────────────
    this._grab = {
      active:          false,
      axis:            null,
      startMouse:      new THREE.Vector2(),
      startCorners:    [],
      centroid:        new THREE.Vector3(),
      pivot:           new THREE.Vector3(),
      pivotLabel:      'Centroid',
      dragPlane:       new THREE.Plane(),
      startPoint:      new THREE.Vector3(),
      inputStr:        '',
      hasInput:        false,
      pivotSelectMode: false,
      hoveredPivotIdx: -1,
      candidates:      [],
      snapping:        false,
    }

    this._ctrlHeld  = false
    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()

    // ── UI wiring ──────────────────────────────────────────────────────────
    uiView.setCanvas(sceneView.renderer.domElement)
    uiView.onModeChange(mode => this.setMode(mode))

    if (outlinerView) {
      outlinerView.onSelect(id  => this._onOutlinerSelect(id))
      outlinerView.onDelete(id  => this._deleteObject(id))
      outlinerView.onAdd(()     => this._addObject())
      outlinerView.onVisible((id, v) => this._setObjectVisible(id, v))
      outlinerView.onRename((id, name) => this._renameObject(id, name))
    }

    uiView.onNameChange(name => {
      if (this._scene.activeId) this._renameObject(this._scene.activeId, name)
    })
    uiView.onDescriptionChange(desc => {
      const obj = this._activeObj
      if (obj) obj.description = desc
    })

    this._bindEvents()

    // Create the initial object
    this._addObject()
    this.setMode('object')
  }

  // ─── Active-object accessors ──────────────────────────────────────────────

  /** Returns the active object entry, or null if none */
  get _activeObj() {
    return this._scene.activeObject
  }

  /** Returns the active object's corners array */
  get _corners() {
    return this._scene.activeObject?.corners ?? []
  }

  /** Returns the active object's MeshView */
  get _meshView() {
    return this._scene.activeObject?.meshView ?? null
  }

  // ─── Convenience getters ──────────────────────────────────────────────────
  get _camera()   { return this._sceneView.camera }
  get _controls() { return this._sceneView.controls }

  // ─── Object management ────────────────────────────────────────────────────

  /**
   * Adds a new object of the given type.
   * @param {'box'|'sketch'} [type='box']
   */
  _addObject(type = 'box') {
    if (type === 'sketch') { this._addSketchObject(); return }

    // Exit Edit Mode cleanly before adding, so the previous object's visual state is cleared
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const idx  = this._scene.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = idx === 0 ? 'Cube' : `Cube.${String(idx).padStart(3, '0')}`

    const corners = createInitialCorners()
    // Offset new objects so they don't stack exactly on top of each other
    if (idx > 0) {
      const step = idx * 0.5
      corners.forEach(c => { c.x += step; c.y += step })
    }

    const meshView = new MeshView(this._sceneView.scene)
    meshView.updateGeometry(corners)

    this._scene.addObject({ id, name, description: '', corners, dimension: 3, meshView })

    if (this._outlinerView) this._outlinerView.addObject(id, name)

    this._switchActiveObject(id, true)
  }

  _addSketchObject() {
    // Exit current mode cleanly before switching active object
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const idx  = this._scene.objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = `Sketch.${String(idx).padStart(3, '0')}`

    const meshView = new MeshView(this._sceneView.scene)
    meshView.setVisible(false)  // no geometry yet

    this._scene.addObject({ id, name, description: '', corners: [], dimension: 2, sketchRect: null, meshView })

    if (this._outlinerView) this._outlinerView.addObject(id, name)

    this._switchActiveObject(id, true)
    this.setMode('edit')  // enters Edit Mode · 2D
  }

  _deleteObject(id) {
    if (this._scene.objects.size <= 1) return   // always keep at least one object

    // If deleting the active object while in Edit Mode, exit cleanly first
    // (setMode operates on the active meshView, so must be called before dispose)
    if (id === this._scene.activeId && this._scene.selectionMode === 'edit') {
      this.setMode('object')
    }

    const obj = this._scene.getObject(id)
    if (!obj) return

    obj.meshView.dispose(this._sceneView.scene)
    this._scene.removeObject(id)

    if (this._outlinerView) this._outlinerView.removeObject(id)

    if (this._scene.activeId === id) {
      const ids = [...this._scene.objects.keys()]
      this._switchActiveObject(ids[ids.length - 1], true)
    }
  }

  /**
   * Switches the active object without toggling selection.
   * @param {string} id
   * @param {boolean} select - whether to set _objSelected = true
   */
  _switchActiveObject(id, select = false) {
    // Deselect / un-highlight previous
    if (this._scene.activeId && this._scene.activeId !== id) {
      const prev = this._scene.getObject(this._scene.activeId)
      if (prev) prev.meshView.setObjectSelected(false)
    }

    this._scene.setActiveId(id)
    this._objSelected = select

    const obj = this._scene.getObject(id)
    if (obj) obj.meshView.setObjectSelected(select)

    if (this._outlinerView) this._outlinerView.setActive(id)
    if (select && obj) {
      this._uiView.setStatusRich([
        { text: obj.name, bold: true, color: '#e8e8e8' },
        { text: 'selected', color: '#888' },
      ])
    } else {
      this._uiView.setStatus('')
    }
    this._updateNPanel()
  }

  _setObjectVisible(id, visible) {
    const obj = this._scene.getObject(id)
    if (!obj) return
    obj.meshView.setVisible(visible)
  }

  _renameObject(id, name) {
    if (!this._scene.getObject(id) || !name) return
    this._scene.renameObject(id, name)
    if (this._outlinerView) this._outlinerView.setObjectName(id, name)
    if (id === this._scene.activeId) this._updateNPanel()
  }

  /** Called when user clicks a row in the outliner */
  _onOutlinerSelect(id) {
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    if (id !== this._scene.activeId) {
      this._switchActiveObject(id, true)
    } else {
      // Clicking the already-active row just re-selects it
      this._setObjectSelected(true)
    }
  }

  // ─── Event binding ─────────────────────────────────────────────────────────
  _bindEvents() {
    window.addEventListener('mousemove', e => this._onMouseMove(e))
    window.addEventListener('mousedown', e => this._onMouseDown(e))
    window.addEventListener('mouseup',   e => this._onMouseUp(e))
    window.addEventListener('keydown',   e => this._onKeyDown(e))
    window.addEventListener('keyup',     e => this._onKeyUp(e))
  }

  // ─── Raycasting ────────────────────────────────────────────────────────────
  _updateMouse(e) {
    const v = toNDC(e.clientX, e.clientY, innerWidth, innerHeight)
    this._mouse.copy(v)
  }

  /** Hits any visible object — returns { hit, obj } or null */
  _hitAnyObject() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const meshes = [...this._scene.objects.values()]
      .filter(o => o.meshView.cuboid.visible)
      .map(o => o.meshView.cuboid)
    const hits = this._raycaster.intersectObjects(meshes)
    if (!hits.length) return null
    const hitMesh = hits[0].object
    const obj = [...this._scene.objects.values()].find(o => o.meshView.cuboid === hitMesh)
    return obj ? { hit: hits[0], obj } : null
  }

  /** Hits only the active object's mesh */
  _hitActiveCuboid() {
    if (!this._activeObj) return null
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const hits = this._raycaster.intersectObject(this._activeObj.meshView.cuboid)
    return hits.length ? hits[0] : null
  }

  _hitFace() {
    const hit = this._hitActiveCuboid()
    if (!hit) return null
    return { faceIdx: Math.floor(hit.face.a / 4), point: hit.point }
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────
  _projectToScreen(position) {
    const v = position.clone().project(this._camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  _updateNPanel() {
    if (!this._uiView.nPanelVisible) return
    const obj = this._activeObj
    if (!obj) return

    if (obj.dimension === 2 && obj.sketchRect) {
      const { p1, p2 } = obj.sketchRect
      const centroid = new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0)
      const dims = new THREE.Vector3(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y), 0)
      this._uiView.updateNPanel(centroid, dims, obj.name, obj.description ?? '')
      return
    }

    const corners = this._corners
    if (!corners.length) return
    const centroid = getCentroid(corners)
    const bMin = new THREE.Vector3(Infinity, Infinity, Infinity)
    const bMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    corners.forEach(c => { bMin.min(c); bMax.max(c) })
    const dims = new THREE.Vector3().subVectors(bMax, bMin)
    this._uiView.updateNPanel(centroid, dims, obj.name, obj.description ?? '')
  }

  // ─── Mode management ───────────────────────────────────────────────────────
  setMode(mode) {
    // ── Cancel all in-progress operations ──────────────────────────────────
    if (this._grab.active) this._cancelGrab()
    if (this._faceDragging) {
      this._faceDragging = false
      this._dragFaceIdx  = null
      if (this._meshView) this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
    }
    if (this._objDragging) {
      this._objDragging = false
      this._objCtrlDrag = false
    }

    // ── Clear all edit visual state on the current active object ───────────
    if (this._meshView) {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearExtrusionDisplay()
      this._meshView.clearSketchRect()
    }
    this._uiView.clearExtrusionLabel()
    this._hoveredFace  = null
    this._faceDragging = false
    this._dragFaceIdx  = null

    // ── Substate reset and mode dispatch ───────────────────────────────────
    this._cleanupEditSubstate()
    this._scene.setSelectionMode(mode)
    this._controls.enabled = true

    if (mode === 'object') {
      if (this._objSelected && this._activeObj) {
        this._uiView.setStatusRich([
          { text: this._activeObj.name, bold: true, color: '#e8e8e8' },
          { text: 'selected', color: '#888' },
        ])
      } else {
        this._uiView.setStatus('')
      }
      this._uiView.updateMode('object')
    } else {
      // edit mode — dispatch on dimension
      this._setObjectSelected(false)
      this._objDragging = false
      const dim = this._activeObj?.dimension ?? 3
      if (dim === 2) {
        this._enterEditMode2D()
      } else {
        this._enterEditMode3D()
      }
    }
  }

  _cleanupEditSubstate() {
    this._scene.setEditSubstate(null)
    this._sketch.drawing = false
    this._sketch.p1 = null
    this._sketch.p2 = null
    this._extrudePhase.hasInput = false
    this._extrudePhase.inputStr = ''
    this._extrudePhase.height = 0
  }

  _enterEditMode2D() {
    this._scene.setEditSubstate('2d-sketch')
    this._uiView.setStatus('')
    this._uiView.updateMode('edit', '2d')
    // Restore existing sketch rect if any
    const obj = this._activeObj
    if (obj?.sketchRect) {
      this._sketch.p1 = obj.sketchRect.p1.clone()
      this._sketch.p2 = obj.sketchRect.p2.clone()
      this._meshView.showSketchRect(this._sketch.p1, this._sketch.p2)
      this._uiView.setStatusRich([
        { text: 'Sketch', bold: true, color: '#4fc3f7' },
        { text: 'Drag to redraw · Enter to extrude', color: '#888' },
      ])
    } else {
      this._uiView.setStatusRich([
        { text: 'Sketch', bold: true, color: '#4fc3f7' },
        { text: 'Click and drag to draw rectangle', color: '#888' },
      ])
    }
  }

  _enterEditMode3D() {
    this._scene.setEditSubstate('3d')
    this._uiView.setStatus('')
    this._uiView.updateMode('edit', '3d')
  }

  _enterExtrudePhase() {
    if (!this._sketch.p1 || !this._sketch.p2) return
    this._scene.setEditSubstate('2d-extrude')
    this._extrudePhase.height = 1
    this._extrudePhase.inputStr = ''
    this._extrudePhase.hasInput = false

    // Drag plane at sketch center, with horizontal normal (allows Z variation on mouse move)
    const p1 = this._sketch.p1, p2 = this._sketch.p2
    const sketchCenter = new THREE.Vector3((p1.x + p2.x) / 2, (p1.y + p2.y) / 2, 0)
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    camDir.z = 0
    if (camDir.lengthSq() < 0.001) camDir.set(1, 0, 0)
    camDir.normalize()
    this._extrudePhase.dragPlane.setFromNormalAndCoplanarPoint(camDir, sketchCenter)

    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._extrudePhase.dragPlane, pt)) {
      this._extrudePhase.startPoint.copy(pt)
    } else {
      this._extrudePhase.startPoint.copy(sketchCenter)
    }

    // Show cuboid mesh for preview
    if (this._meshView) this._meshView.setVisible(true)
    this._applyExtrudePreview()
    this._uiView.updateMode('edit', '2d-extrude')
    this._updateExtrudePhaseStatus()
  }

  _applyExtrudePreview() {
    const height = this._extrudePhase.hasInput
      ? (parseFloat(this._extrudePhase.inputStr) || 0)
      : this._extrudePhase.height
    const corners = buildCuboidFromRect(this._sketch.p1, this._sketch.p2, height)
    this._meshView.updateGeometry(corners)
    this._meshView.showSketchRect(this._sketch.p1, this._sketch.p2)

    // Show extrusion label
    const labelPos = new THREE.Vector3(
      (this._sketch.p1.x + this._sketch.p2.x) / 2,
      (this._sketch.p1.y + this._sketch.p2.y) / 2,
      height / 2,
    )
    const screen = this._projectToScreen(labelPos)
    this._uiView.setExtrusionLabel(`H ${Math.abs(height).toFixed(3)}`, screen.x, screen.y)
  }

  _confirmExtrudePhase() {
    const height = this._extrudePhase.hasInput
      ? (parseFloat(this._extrudePhase.inputStr) || 0)
      : this._extrudePhase.height
    if (Math.abs(height) < 0.001) { this._cancelExtrudePhase(); return }

    const corners = buildCuboidFromRect(this._sketch.p1, this._sketch.p2, height)
    const obj = this._activeObj
    obj.corners = corners
    obj.dimension = 3
    obj.sketchRect = { p1: this._sketch.p1.clone(), p2: this._sketch.p2.clone() }

    this._meshView.updateGeometry(corners)
    this._meshView.setVisible(true)
    this._meshView.clearSketchRect()
    this._uiView.clearExtrusionLabel()

    this._uiView.setStatusRich([
      { text: 'Extruded', color: '#6ab04c' },
      { text: 'Edit Mode · 3D', bold: true, color: '#e8e8e8' },
    ])
    this._cleanupEditSubstate()
    this._enterEditMode3D()
  }

  _cancelExtrudePhase() {
    // Return to sketch phase
    this._uiView.clearExtrusionLabel()
    if (this._meshView) {
      this._meshView.setVisible(false)
      this._meshView.clearSketchRect()
    }
    this._extrudePhase.hasInput = false
    this._extrudePhase.inputStr = ''
    this._extrudePhase.height = 0
    this._enterEditMode2D()
  }

  _updateExtrudePhaseStatus() {
    const height = this._extrudePhase.hasInput
      ? (parseFloat(this._extrudePhase.inputStr) || 0)
      : this._extrudePhase.height
    const parts = [{ text: 'Extrude', bold: true, color: '#ffffff' }]
    if (this._extrudePhase.hasInput) {
      parts.push({ text: this._extrudePhase.inputStr + '_', color: '#ffeb3b' })
    } else {
      parts.push({ text: `H: ${height.toFixed(3)}`, color: '#ffeb3b' })
    }
    this._uiView.setStatusRich(parts)
  }

  _setObjectSelected(sel) {
    this._objSelected = sel
    if (this._meshView) this._meshView.setObjectSelected(sel)
    if (sel && this._activeObj) {
      this._uiView.setStatusRich([
        { text: this._activeObj.name, bold: true, color: '#e8e8e8' },
        { text: 'selected', color: '#888' },
      ])
    } else {
      this._uiView.setStatus('')
    }
  }

  // ─── Blender-style grab ────────────────────────────────────────────────────

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

    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._grab.dragPlane.setFromNormalAndCoplanarPoint(camDir, this._grab.pivot)

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

  _setGrabAxis(axis) {
    this._grab.axis     = (this._grab.axis === axis) ? null : axis
    this._grab.inputStr = ''
    this._grab.hasInput = false
    this._applyGrab()
    this._updateGrabStatus()
  }

  _getAxisVec(axis) {
    return new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0,
    )
  }

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

  _applyGrabFromInput() {
    this._grab.snapping = false
    const dist    = parseFloat(this._grab.inputStr) || 0
    const axisVec = this._getAxisVec(this._grab.axis)
    this._grab.startCorners.forEach((c, i) => {
      this._corners[i].copy(c).addScaledVector(axisVec, dist)
    })
  }

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

  _applyAxisConstrainedGrab() {
    const axisVec = this._getAxisVec(this._grab.axis)

    const centerNDC  = this._grab.pivot.clone().project(this._camera)
    const axisEndNDC = this._grab.pivot.clone().add(axisVec).project(this._camera)

    const dx        = axisEndNDC.x - centerNDC.x
    const dy        = axisEndNDC.y - centerNDC.y
    const screenLen = Math.sqrt(dx * dx + dy * dy)
    if (screenLen < 1e-4) return

    const axisNormX = dx / screenLen
    const axisNormY = dy / screenLen

    const mdx  = this._mouse.x - this._grab.startMouse.x
    const mdy  = this._mouse.y - this._grab.startMouse.y
    const dist = (mdx * axisNormX + mdy * axisNormY) / screenLen

    if (this._ctrlHeld) {
      const delta        = new THREE.Vector3().addScaledVector(axisVec, dist)
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

  _updateGrabStatus() {
    if (this._grab.pivotSelectMode) {
      this._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: 'Click to confirm', color: '#aaa' },
        { text: 'Esc to cancel', color: '#666' },
      ])
      return
    }

    const AXIS_COLORS = { x: '#e05252', y: '#6ab04c', z: '#4a9eed' }
    const parts = [{ text: 'Grab', bold: true, color: '#ffffff' }]

    if (this._grab.axis) {
      parts.push({ text: this._grab.axis.toUpperCase(), bold: true, color: AXIS_COLORS[this._grab.axis] })
    }
    if (this._grab.hasInput) {
      parts.push({ text: this._grab.inputStr + '_', color: '#ffeb3b' })
    }
    if (this._grab.pivotLabel !== 'Centroid') {
      parts.push({ text: this._grab.pivotLabel, color: '#888' })
    }
    if (this._grab.snapping) {
      parts.push({ text: 'Snap: Origin', bold: true, color: '#ff9800' })
    }

    this._uiView.setStatusRich(parts)
  }

  // ─── Ctrl snap-to-origin ──────────────────────────────────────────────────

  _trySnapToOrigin(delta) {
    const SNAP_PX    = 25
    const ORIGIN     = new THREE.Vector3(0, 0, 0)
    const pivotAfter = this._grab.pivot.clone().add(delta)

    const pNDC = pivotAfter.clone().project(this._camera)
    const oNDC = ORIGIN.clone().project(this._camera)
    const px   = (pNDC.x + 1) / 2 * innerWidth
    const py   = (-pNDC.y + 1) / 2 * innerHeight
    const ox   = (oNDC.x + 1) / 2 * innerWidth
    const oy   = (-oNDC.y + 1) / 2 * innerHeight

    if (Math.hypot(px - ox, py - oy) < SNAP_PX) {
      this._grab.snapping = true
      return this._grab.pivot.clone().negate()
    }
    this._grab.snapping = false
    return delta
  }

  // ─── Pivot point selection ─────────────────────────────────────────────────

  _startPivotSelect() {
    if (!this._grab.active || this._grab.pivotSelectMode) return
    this._grab.startCorners.forEach((c, i) => this._corners[i].copy(c))
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
    this._grab.pivotSelectMode = true
    this._grab.hoveredPivotIdx = -1
    this._grab.candidates = getPivotCandidates(this._grab.startCorners)
    this._meshView.showPivotCandidates(this._grab.candidates)
    this._updateGrabStatus()
  }

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
      this._uiView.setStatusRich([
        { text: 'Pivot', color: '#aaa' },
        { text: cand.label, bold: true, color: '#ffeb3b' },
      ])
    } else {
      this._grab.hoveredPivotIdx = -1
      this._meshView.setHoveredPivot(null)
      this._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: 'Click to confirm', color: '#aaa' },
        { text: 'Esc to cancel', color: '#666' },
      ])
    }
  }

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

  _cancelPivotSelect() {
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._meshView.clearPivotDisplay()
    this._updateGrabStatus()
  }

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

  // ─── Mouse events ──────────────────────────────────────────────────────────
  _onMouseMove(e) {
    this._updateMouse(e)

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

    if (this._scene.selectionMode === 'object') {
      if (this._objDragging) {
        if (this._objCtrlDrag) {
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
          this._objRotateStartCorners.forEach((c, i) => {
            this._corners[i].copy(c).sub(this._objRotateCentroid).applyQuaternion(quat).add(this._objRotateCentroid)
          })
        } else {
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
        this._uiView.setCursor(this._hitAnyObject() ? 'pointer' : 'default')
      }
      return
    }

    // ── Edit mode · 2D sketch ─────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      if (this._sketch.drawing) {
        const pt = new THREE.Vector3()
        this._raycaster.setFromCamera(this._mouse, this._camera)
        if (this._raycaster.ray.intersectPlane(this._groundPlane, pt)) {
          this._sketch.p2 = pt.clone()
          this._meshView.showSketchRect(this._sketch.p1, this._sketch.p2)
        }
      }
      return
    }

    // ── Edit mode · 2D extrude ────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-extrude') {
      if (!this._extrudePhase.hasInput) {
        const pt = new THREE.Vector3()
        this._raycaster.setFromCamera(this._mouse, this._camera)
        if (this._raycaster.ray.intersectPlane(this._extrudePhase.dragPlane, pt)) {
          this._extrudePhase.height = pt.z - this._extrudePhase.startPoint.z
        }
      }
      this._applyExtrudePreview()
      this._updateExtrudePhaseStatus()
      return
    }

    // ── Edit mode · 3D face extrude ───────────────────────────────────────
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
      this._uiView.setStatusRich([
        { text: 'Extrude', bold: true, color: '#ffffff' },
        { text: FACES[this._dragFaceIdx].name, color: '#4fc3f7' },
        { text: `D: ${dist.toFixed(3)}`, color: '#ffeb3b' },
      ])

      const currentFaceCorners = FACES[this._dragFaceIdx].corners.map(ci => this._corners[ci])
      const { spanMid, armDir } = this._meshView.setExtrusionDisplay(this._savedFaceCorners, currentFaceCorners)
      const labelPos = spanMid.clone().addScaledVector(armDir, 0.25)
      const screen = this._projectToScreen(labelPos)
      this._uiView.setExtrusionLabel(`D ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
      this._updateNPanel()
      return
    }

    const hit = this._hitFace()
    const fi  = hit ? hit.faceIdx : null
    if (fi !== this._hoveredFace) {
      this._hoveredFace = fi
      this._meshView.setFaceHighlight(fi, this._corners)
      if (fi !== null) {
        this._uiView.setStatusRich([
          { text: 'Face', color: '#888' },
          { text: FACES[fi].name, color: '#e8e8e8' },
          { text: 'Drag to extrude', color: '#555' },
        ])
      } else {
        this._uiView.setStatus('')
      }
      this._uiView.setCursor(fi !== null ? 'pointer' : 'default')
    }
  }

  _onMouseDown(e) {
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

    // ── Sketch drawing ────────────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      const pt = new THREE.Vector3()
      this._raycaster.setFromCamera(this._mouse, this._camera)
      if (this._raycaster.ray.intersectPlane(this._groundPlane, pt)) {
        this._sketch.drawing = true
        this._sketch.p1 = pt.clone()
        this._sketch.p2 = pt.clone()
        this._controls.enabled = false
      }
      return
    }

    if (this._scene.selectionMode === 'object') {
      const result = this._hitAnyObject()
      if (result) {
        const { hit, obj } = result
        // Switch active object if a different one was clicked
        if (obj.id !== this._scene.activeId) {
          this._switchActiveObject(obj.id, true)
        } else if (!this._objSelected) {
          this._setObjectSelected(true)
        }
        this._objDragging      = true
        this._objCtrlDrag      = e.ctrlKey
        this._controls.enabled = false
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

    // ── Edit mode ─────────────────────────────────────────────────────────
    const hit = this._hitFace()
    if (!hit) return
    this._faceDragging     = true
    this._dragFaceIdx      = hit.faceIdx
    this._controls.enabled = false
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
    if (this._sketch.drawing) {
      this._sketch.drawing = false
      this._controls.enabled = true
      // Save rect to object
      if (this._sketch.p1 && this._sketch.p2) {
        const obj = this._activeObj
        if (obj) {
          const dx = Math.abs(this._sketch.p2.x - this._sketch.p1.x)
          const dy = Math.abs(this._sketch.p2.y - this._sketch.p1.y)
          if (dx > 0.01 || dy > 0.01) {
            obj.sketchRect = { p1: this._sketch.p1.clone(), p2: this._sketch.p2.clone() }
            this._uiView.setStatusRich([
              { text: 'Sketch', bold: true, color: '#4fc3f7' },
              { text: 'Press Enter to extrude · Drag to redraw', color: '#888' },
            ])
          }
        }
      }
      return
    }
    if (this._objDragging) {
      this._objDragging  = false
      this._objCtrlDrag  = false
      this._controls.enabled = true
      this._uiView.setCursor(this._hitAnyObject() ? 'pointer' : 'default')
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
    if (e.key === 'Control') this._ctrlHeld = true

    // ── Keys active during grab ────────────────────────────────────────────
    if (this._grab.active) {
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
      return
    }

    // ── Sketch phase keys ──────────────────────────────────────────────────
    if (this._scene.editSubstate === '2d-sketch') {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (this._sketch.p1 && this._sketch.p2) {
          const dx = Math.abs(this._sketch.p2.x - this._sketch.p1.x)
          const dy = Math.abs(this._sketch.p2.y - this._sketch.p1.y)
          if (dx > 0.01 || dy > 0.01) this._enterExtrudePhase()
        }
        return
      }
      if (e.key === 'Escape') { this.setMode('object'); return }
      return
    }

    // ── Extrude-from-sketch phase keys ─────────────────────────────────────
    if (this._scene.editSubstate === '2d-extrude') {
      if (e.key === 'Enter') { e.preventDefault(); this._confirmExtrudePhase(); return }
      if (e.key === 'Escape') { this._cancelExtrudePhase(); return }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._extrudePhase.inputStr += e.key
        this._extrudePhase.hasInput = true
        this._applyExtrudePreview()
        this._updateExtrudePhaseStatus()
        return
      }
      if (e.key === '-' && this._extrudePhase.inputStr.length === 0) {
        this._extrudePhase.inputStr = '-'
        this._extrudePhase.hasInput = true
        this._updateExtrudePhaseStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._extrudePhase.inputStr = this._extrudePhase.inputStr.slice(0, -1)
        this._extrudePhase.hasInput = this._extrudePhase.inputStr.length > 0 && this._extrudePhase.inputStr !== '-'
        this._applyExtrudePreview()
        this._updateExtrudePhaseStatus()
        return
      }
      return
    }

    // ── Normal keys ────────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault()
      this.setMode(this._scene.selectionMode === 'object' ? 'edit' : 'object')
      return
    }
    if (e.key === 'n' || e.key === 'N') {
      this._uiView.toggleNPanel()
      this._updateNPanel()
      if (this._gizmoView) {
        this._gizmoView.setRightOffset(this._uiView.nPanelVisible ? 216 : 16)
      }
      return
    }
    if (e.key === 'o' || e.key === 'O') { this.setMode('object'); return }
    if (e.key === 'e' || e.key === 'E') { this.setMode('edit');   return }

    if (this._scene.selectionMode === 'object') {
      // G: grab
      if ((e.key === 'g' || e.key === 'G') && this._objSelected) {
        this._startGrab()
        return
      }
      // Shift+A: show Add menu
      if (e.key === 'A' && e.shiftKey) {
        e.preventDefault()
        const screenX = (this._mouse.x + 1) / 2 * innerWidth
        const screenY = (-this._mouse.y + 1) / 2 * innerHeight
        this._uiView.showAddMenu(screenX, screenY,
          () => this._addObject('box'),
          () => this._addObject('sketch'),
        )
        return
      }
      // X / Delete: delete active object
      if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete') && this._objSelected) {
        this._deleteObject(this._scene.activeId)
        return
      }
    }
  }

  // ─── Animation loop ────────────────────────────────────────────────────────
  start() {
    const loop = () => {
      requestAnimationFrame(loop)
      this._sceneView.render()
      if (this._gizmoView) this._gizmoView.update()
    }
    loop()
  }
}
