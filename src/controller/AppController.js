/**
 * AppController - handles user input and manages the animation loop
 *
 * Connects VoxelModel with View (SceneView / MeshView / UIView / OutlinerView).
 * Side effects: event listener registration, requestAnimationFrame, model state updates.
 */
import * as THREE from 'three'
import {
  createBoxVoxels,
  cloneVoxelShape,
  extrudeVoxelFace,
  computeExposedFaces,
  getVoxelCentroid,
  getVoxelBoundingBox,
  getVoxelPivotCandidates,
  toNDC,
} from '../model/VoxelModel.js'
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

    // ── Multi-object scene state ───────────────────────────────────────────
    // Each entry: { id, name, description, voxelShape, exposedFaces, meshView }
    this._objects  = new Map()
    this._activeId = null

    // ── Selection mode: 'object' | 'edit' ─────────────────────────────────
    this._selectionMode = 'object'

    // ── Object mode state ──────────────────────────────────────────────────
    this._objSelected       = false
    this._objDragging       = false
    this._objDragPlane      = new THREE.Plane()
    this._objDragStart      = new THREE.Vector3()
    this._objDragStartOffset = new THREE.Vector3()

    // ── Edit mode (face extrude) state ─────────────────────────────────────
    this._hoveredFace     = null   // index into exposedFaces array
    this._faceDragging    = false
    this._dragFaceDir     = { dx: 0, dy: 0, dz: 0 }
    this._dragNormal      = new THREE.Vector3()
    this._dragPlane       = new THREE.Plane()
    this._dragStart       = new THREE.Vector3()
    this._savedVoxelShape = null   // deep clone at drag start
    this._savedFaceVerts  = []     // 4 THREE.Vector3 — face verts at drag start
    this._savedFaceName   = ''
    this._lastDragSteps   = 0

    // ── Blender-style grab state ───────────────────────────────────────────
    this._grab = {
      active:          false,
      axis:            null,
      startMouse:      new THREE.Vector2(),
      startOffset:     new THREE.Vector3(),
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
      outlinerView.onSelect(id      => this._onOutlinerSelect(id))
      outlinerView.onDelete(id      => this._deleteObject(id))
      outlinerView.onAdd(()         => this._addObject())
      outlinerView.onVisible((id, v) => this._setObjectVisible(id, v))
      outlinerView.onRename((id, n)  => this._renameObject(id, n))
    }

    uiView.onNameChange(name => {
      if (this._activeId) this._renameObject(this._activeId, name)
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

  get _activeObj() {
    return this._activeId ? this._objects.get(this._activeId) ?? null : null
  }

  get _voxelShape() {
    return this._activeObj?.voxelShape ?? null
  }

  get _meshView() {
    return this._activeObj?.meshView ?? null
  }

  // ─── Convenience getters ──────────────────────────────────────────────────
  get _camera()   { return this._sceneView.camera }
  get _controls() { return this._sceneView.controls }

  // ─── Object management ────────────────────────────────────────────────────

  _addObject() {
    const idx  = this._objects.size
    const id   = `obj_${idx}_${Date.now()}`
    const name = idx === 0 ? 'Cube' : `Cube.${String(idx).padStart(3, '0')}`

    // Start as a 2x2x2 voxel box centered at origin
    const voxelShape = createBoxVoxels(2, 2, 2)
    if (idx > 0) {
      const step = idx * 0.5
      voxelShape.offset.x += step
      voxelShape.offset.y += step
    }

    const meshView    = new MeshView(this._sceneView.scene)
    const exposedFaces = meshView.updateGeometryFromVoxelShape(voxelShape)

    this._objects.set(id, { id, name, description: '', voxelShape, exposedFaces, meshView })

    if (this._outlinerView) this._outlinerView.addObject(id, name)

    this._switchActiveObject(id, true)
  }

  _deleteObject(id) {
    if (this._objects.size <= 1) return

    const obj = this._objects.get(id)
    if (!obj) return

    obj.meshView.dispose(this._sceneView.scene)
    this._objects.delete(id)

    if (this._outlinerView) this._outlinerView.removeObject(id)

    if (this._activeId === id) {
      const ids = [...this._objects.keys()]
      this._switchActiveObject(ids[ids.length - 1], true)
    }
  }

  _switchActiveObject(id, select = false) {
    if (this._activeId && this._activeId !== id) {
      const prev = this._objects.get(this._activeId)
      if (prev) prev.meshView.setObjectSelected(false)
    }

    this._activeId    = id
    this._objSelected = select

    const obj = this._objects.get(id)
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
    const obj = this._objects.get(id)
    if (!obj) return
    obj.meshView.setVisible(visible)
  }

  _renameObject(id, name) {
    const obj = this._objects.get(id)
    if (!obj || !name) return
    obj.name = name
    if (this._outlinerView) this._outlinerView.setObjectName(id, name)
    if (id === this._activeId) this._updateNPanel()
  }

  _onOutlinerSelect(id) {
    if (this._selectionMode === 'edit') this.setMode('object')
    if (id !== this._activeId) {
      this._switchActiveObject(id, true)
    } else {
      this._setObjectSelected(true)
    }
  }

  // ─── Geometry rebuild ─────────────────────────────────────────────────────

  /**
   * Rebuilds mesh geometry from obj.voxelShape, updates exposedFaces and BoxHelper.
   * @param {{ voxelShape, exposedFaces, meshView }} obj
   */
  _rebuildMesh(obj) {
    if (!obj) return
    const exposedFaces = obj.meshView.updateGeometryFromVoxelShape(obj.voxelShape)
    obj.exposedFaces   = exposedFaces
    obj.meshView.updateBoxHelper()
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

  _hitAnyObject() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const meshes = [...this._objects.values()]
      .filter(o => o.meshView.cuboid.visible)
      .map(o => o.meshView.cuboid)
    const hits = this._raycaster.intersectObjects(meshes)
    if (!hits.length) return null
    const hitMesh = hits[0].object
    const obj = [...this._objects.values()].find(o => o.meshView.cuboid === hitMesh)
    return obj ? { hit: hits[0], obj } : null
  }

  _hitActiveCuboid() {
    if (!this._activeObj) return null
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const hits = this._raycaster.intersectObject(this._activeObj.meshView.cuboid)
    return hits.length ? hits[0] : null
  }

  /**
   * Returns { faceIdx, point } where faceIdx indexes into activeObj.exposedFaces,
   * or null if no hit.
   */
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
    const shape = this._voxelShape
    if (!shape) return
    const { min, max } = getVoxelBoundingBox(shape)
    const centroid = new THREE.Vector3().addVectors(min, max).multiplyScalar(0.5)
    const dims     = new THREE.Vector3().subVectors(max, min)
    const obj      = this._activeObj
    this._uiView.updateNPanel(centroid, dims, obj?.name ?? '', obj?.description ?? '')
  }

  // ─── Mode management ───────────────────────────────────────────────────────
  setMode(mode) {
    if (this._grab.active) this._cancelGrab()
    this._selectionMode = mode
    if (mode === 'object') {
      if (this._meshView) {
        this._meshView.clearFaceHighlight()
        this._meshView.clearExtrusionDisplay()
      }
      this._uiView.clearExtrusionLabel()
      this._hoveredFace  = null
      this._faceDragging = false
      if (this._objSelected && this._activeObj) {
        this._uiView.setStatusRich([
          { text: this._activeObj.name, bold: true, color: '#e8e8e8' },
          { text: 'selected', color: '#888' },
        ])
      } else {
        this._uiView.setStatus('')
      }
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
    const shape = this._voxelShape
    if (!shape) return

    this._grab.active          = true
    this._grab.axis            = null
    this._grab.inputStr        = ''
    this._grab.hasInput        = false
    this._grab.pivotSelectMode = false
    this._grab.hoveredPivotIdx = -1
    this._grab.startMouse.copy(this._mouse)
    this._grab.startOffset.copy(shape.offset)
    this._grab.centroid.copy(getVoxelCentroid(shape))
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
    const shape = this._voxelShape
    if (shape) shape.offset.copy(this._grab.startOffset)
    this._rebuildMesh(this._activeObj)
    this._grab.active = false
    this._grab.axis   = null
    this._meshView.clearPivotDisplay()
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
    this._rebuildMesh(this._activeObj)
  }

  _applyGrabFromInput() {
    this._grab.snapping = false
    const dist    = parseFloat(this._grab.inputStr) || 0
    const axisVec = this._getAxisVec(this._grab.axis)
    const shape   = this._voxelShape
    if (shape) shape.offset.copy(this._grab.startOffset).addScaledVector(axisVec, dist)
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
    const shape = this._voxelShape
    if (shape) shape.offset.copy(this._grab.startOffset).add(delta)
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

    const shape = this._voxelShape
    if (!shape) return

    if (this._ctrlHeld) {
      const delta        = new THREE.Vector3().addScaledVector(axisVec, dist)
      const snappedDelta = this._trySnapToOrigin(delta)
      shape.offset.copy(this._grab.startOffset).add(snappedDelta)
    } else {
      this._grab.snapping = false
      shape.offset.copy(this._grab.startOffset).addScaledVector(axisVec, dist)
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
    // Restore to startOffset so pivot candidates reflect the unmodified shape bounds
    const shape = this._voxelShape
    if (shape) shape.offset.copy(this._grab.startOffset)
    this._rebuildMesh(this._activeObj)
    this._grab.pivotSelectMode = true
    this._grab.hoveredPivotIdx = -1
    this._grab.candidates      = getVoxelPivotCandidates(this._voxelShape)
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

    if (this._selectionMode === 'object') {
      if (this._objDragging) {
        this._raycaster.setFromCamera(this._mouse, this._camera)
        const pt = new THREE.Vector3()
        if (this._raycaster.ray.intersectPlane(this._objDragPlane, pt)) {
          const delta = pt.clone().sub(this._objDragStart)
          const shape = this._voxelShape
          if (shape) shape.offset.copy(this._objDragStartOffset).add(delta)
        }
        this._rebuildMesh(this._activeObj)
        this._updateNPanel()
      } else {
        this._uiView.setCursor(this._hitAnyObject() ? 'pointer' : 'default')
      }
      return
    }

    // ── Edit mode ─────────────────────────────────────────────────────────
    if (this._faceDragging) {
      this._raycaster.setFromCamera(this._mouse, this._camera)
      const pt = new THREE.Vector3()
      if (!this._raycaster.ray.intersectPlane(this._dragPlane, pt)) return

      const dist  = pt.clone().sub(this._dragStart).dot(this._dragNormal)
      const steps = Math.round(dist)

      if (steps !== this._lastDragSteps) {
        this._lastDragSteps = steps
        const newShape = extrudeVoxelFace(this._savedVoxelShape, this._dragFaceDir, steps)
        this._activeObj.voxelShape = newShape
        const exposedFaces = this._meshView.updateGeometryFromVoxelShape(newShape)
        this._activeObj.exposedFaces = exposedFaces
      }

      const currentFaceVerts = this._savedFaceVerts.map(v =>
        v.clone().addScaledVector(this._dragNormal, this._lastDragSteps))
      this._meshView.setFaceHighlightFromVerts(currentFaceVerts)

      this._uiView.setStatusRich([
        { text: 'Extrude', bold: true, color: '#ffffff' },
        { text: this._savedFaceName, color: '#4fc3f7' },
        { text: `D: ${dist.toFixed(3)} [${this._lastDragSteps}]`, color: '#ffeb3b' },
      ])

      const { spanMid, armDir } = this._meshView.setExtrusionDisplay(
        this._savedFaceVerts, currentFaceVerts)
      const labelPos = spanMid.clone().addScaledVector(armDir, 0.25)
      const screen = this._projectToScreen(labelPos)
      this._uiView.setExtrusionLabel(`D ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
      this._updateNPanel()
      return
    }

    // Hover — update face highlight
    const hit = this._hitFace()
    const fi  = hit ? hit.faceIdx : null
    if (fi !== this._hoveredFace) {
      this._hoveredFace = fi
      const faces = this._activeObj?.exposedFaces
      if (fi !== null && faces?.[fi]) {
        this._meshView.setFaceHighlightFromVerts(faces[fi].verts)
        this._uiView.setStatusRich([
          { text: 'Face', color: '#888' },
          { text: faces[fi].name, color: '#e8e8e8' },
          { text: 'Drag to extrude', color: '#555' },
        ])
      } else {
        this._meshView.clearFaceHighlight()
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

    if (this._selectionMode === 'object') {
      const result = this._hitAnyObject()
      if (result) {
        const { hit, obj } = result
        if (obj.id !== this._activeId) {
          this._switchActiveObject(obj.id, true)
        } else if (!this._objSelected) {
          this._setObjectSelected(true)
        }
        this._objDragging = true
        this._controls.enabled = false
        this._uiView.setCursor('grabbing')

        const camDir = new THREE.Vector3()
        this._camera.getWorldDirection(camDir)
        this._objDragPlane.setFromNormalAndCoplanarPoint(camDir, hit.point)
        this._objDragStart.copy(hit.point)
        this._objDragStartOffset.copy(this._voxelShape.offset)
      } else {
        this._setObjectSelected(false)
      }
      return
    }

    // ── Edit mode ─────────────────────────────────────────────────────────
    const hit = this._hitFace()
    if (!hit) return
    const { faceIdx, point } = hit
    const faces = this._activeObj?.exposedFaces
    if (!faces?.[faceIdx]) return

    const faceDesc = faces[faceIdx]
    this._faceDragging    = true
    this._dragFaceDir     = faceDesc.dir
    this._dragNormal.set(faceDesc.dir.dx, faceDesc.dir.dy, faceDesc.dir.dz)
    this._savedVoxelShape = cloneVoxelShape(this._activeObj.voxelShape)
    this._savedFaceVerts  = faceDesc.verts.map(v => v.clone())
    this._savedFaceName   = faceDesc.name
    this._lastDragSteps   = 0
    this._controls.enabled = false
    this._uiView.setCursor('grabbing')

    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    this._dragPlane.setFromNormalAndCoplanarPoint(camDir, point)
    this._dragStart.copy(point)
  }

  _onMouseUp(e) {
    if (e.button !== 0) return
    if (this._objDragging) {
      this._objDragging      = false
      this._controls.enabled = true
      this._uiView.setCursor(this._hitAnyObject() ? 'pointer' : 'default')
      this._updateNPanel()
    }
    if (this._faceDragging) {
      this._faceDragging = false
      this._controls.enabled = true
      this._meshView.clearExtrusionDisplay()
      this._uiView.clearExtrusionLabel()
      this._uiView.setCursor('default')
      // Force hover re-detection on next mouse move
      this._hoveredFace = null
      this._meshView.clearFaceHighlight()
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

    // ── Normal keys ────────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      e.preventDefault()
      this.setMode(this._selectionMode === 'object' ? 'edit' : 'object')
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

    if (this._selectionMode === 'object') {
      if ((e.key === 'g' || e.key === 'G') && this._objSelected) {
        this._startGrab()
        return
      }
      if (e.key === 'A' && e.shiftKey) {
        e.preventDefault()
        this._addObject()
        return
      }
      if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete') && this._objSelected) {
        this._deleteObject(this._activeId)
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
