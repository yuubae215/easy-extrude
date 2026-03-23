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
  buildCuboidFromRect,
  computeOutwardFaceNormal,
  getCentroid,
  toNDC,
  getPivotCandidates,
  getVertexPivotCandidates,
  getEdgePivotCandidates,
  getFacePivotCandidates,
  collectSnapTargets,
  collectWorldSnapTargets,
} from '../model/CuboidModel.js'
import { SceneService }    from '../service/SceneService.js'
import { Cuboid }          from '../domain/Cuboid.js'
import { Sketch }          from '../domain/Sketch.js'
import { ImportedMesh }      from '../domain/ImportedMesh.js'
import { MeasureLine }       from '../domain/MeasureLine.js'
import { CoordinateFrame }   from '../domain/CoordinateFrame.js'
import { Face }            from '../graph/Face.js'
import { ICONS }           from '../view/UIView.js'
import { NodeEditorView }  from '../view/NodeEditorView.js'

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

    // ── Application service (owns SceneModel aggregate root) ─────────────
    this._service = new SceneService(sceneView.scene)

    // ── Domain event subscriptions — keep View in sync with domain state ──
    this._service.on('objectAdded',   obj       => {
      const type = obj instanceof ImportedMesh
        ? 'imported'
        : obj instanceof MeasureLine
          ? 'measure'
          : obj instanceof CoordinateFrame
            ? 'frame'
            : obj instanceof Sketch
              ? 'sketch'
              : 'cuboid'
      outlinerView?.addObject(obj.id, obj.name, type, obj.parentId ?? null)
    })
    this._service.on('objectRemoved', id        => outlinerView?.removeObject(id))
    this._service.on('objectRenamed', (id, nm)  => {
      outlinerView?.setObjectName(id, nm)
      if (id === this._scene.activeId && this._scene.selectionMode === 'object') {
        this._refreshObjectModeStatus()
      }
    })
    this._service.on('activeChanged', id        => outlinerView?.setActive(id))
    this._service.on('geometryApplied', ({ objectId }) => {
      const obj = this._scene.getObject(objectId)
      const sphere = obj?.meshView?.cuboid?.geometry?.boundingSphere
      if (sphere && sphere.radius > 0) {
        this._sceneView.fitCameraToSphere(sphere.center, sphere.radius)
      }
    })
    this._service.on('geometryError', ({ message }) =>
      this._uiView.showToast(`Geometry error: ${message}`)
    )

    // ── Measure placement state ────────────────────────────────────────────
    // Active while the user is placing a MeasureLine (M key / Add → Measure).
    // Phase 1: waiting for first click (p1 = null)
    // Phase 2: p1 set, waiting for second click (preview line shown)
    this._measure = {
      active:       false,
      /** @type {THREE.Vector3|null} fixed first endpoint */
      p1:           null,
      /** @type {THREE.Vector3|null} live cursor position (snapped) */
      p2:           null,
      /** @type {{label:string, position:THREE.Vector3, type:string}[]} */
      snapTargets:  [],
      snapping:     false,
      /** @type {{label:string, position:THREE.Vector3, type:string}|null} */
      snappedTarget: null,
      /** Three.js Line for preview before entity is created */
      previewLine:  null,
      /** True while the user is holding a pointer down to snap a point */
      pressing:     false,
      /** MeshView used for snap candidate display (may differ from _meshView when active obj is MeasureLine) */
      snapMeshView: null,
    }

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
    /** @type {Map<string, import('three').Vector3[]>} corners snapshot for each selected object at drag start */
    this._objDragAllStartCorners = new Map()
    this._objRotateStartX       = 0
    this._objRotateCentroid     = new THREE.Vector3()
    this._objRotateStartCorners = []

    // ── Rectangle selection state ──────────────────────────────────────────
    /** @type {Set<string>} IDs of all currently selected objects (multi-select) */
    this._selectedIds = new Set()
    this._rectSel = {
      active:    false,
      startPx:   { x: 0, y: 0 },
      currentPx: { x: 0, y: 0 },
    }
    this._rectSelEl = this._createRectSelEl()

    // ── Edit mode hover state ───────────────────────────────────────────────
    /** @type {import('../graph/Face.js').Face|null} */
    this._hoveredFace      = null

    // ── Edit mode sub-element selection state (Phase 6) ────────────────────
    /** @type {'vertex'|'edge'|'face'} */
    this._editSelectMode = 'face'
    /** @type {import('../graph/Vertex.js').Vertex|null} */
    this._hoveredVertex  = null
    /** @type {import('../graph/Edge.js').Edge|null} */
    this._hoveredEdge    = null

    // ── Face extrude state (Edit Mode · 3D, E key) ─────────────────────────
    this._faceExtrude = {
      active:        false,
      /** @type {import('../graph/Face.js').Face|null} */
      face:          null,
      savedCorners:  [],
      normal:        new THREE.Vector3(),
      dist:          0,
      dragPlane:     new THREE.Plane(),
      startPoint:    new THREE.Vector3(),
      inputStr:      '',
      hasInput:      false,
      snapping:      false,
      snappedTarget: null,
      snapTargets:   [],
    }

    // ── Blender-style grab state ───────────────────────────────────────────
    this._grab = {
      active:          false,
      axis:            null,
      startMouse:      new THREE.Vector2(),
      startCorners:    [],
      /** @type {Map<string, import('three').Vector3[]>} corners snapshot for all selected objects */
      allStartCorners: new Map(),
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
      /** Current candidate filter in pivot select mode: 'all'|'vertex'|'edge'|'face' */
      pivotMode:       'all',
      snapping:        false,
      /** Set to true after G->V pivot confirm; enables auto-snap without Ctrl */
      autoSnap:        false,
      /** The snap target currently locked to, or null */
      snappedTarget:   null,
      /** Snap target filter: 'all'|'vertex'|'edge'|'face' */
      snapMode:        'all',
      /** All snap candidates from last _trySnapToGeometry call (for display) */
      snapTargets:     [],
      /** Grid snap unit size (Ctrl during grab). Cycled with Ctrl+Wheel. */
      gridSize:        1,
      /** When true, grabbed object snaps Z so its bottom rests on the top surface below. */
      stackMode:       false,
      /** True when stacking is actively snapping Z this frame. */
      stacking:        false,
    }

    // ── CoordinateFrame rotate state (R key, ADR-019 Phase B) ─────────────
    // Symmetric to _grab but applies a quaternion rotation to CoordinateFrame.rotation.
    this._rotate = {
      active:     false,
      /** World-space axis to rotate around: null = view-space Z, 'x'|'y'|'z' = world axes. */
      axis:       null,
      /** Screen-angle (radians) from frame projected position to mouse at start. */
      startAngle: 0,
      /** Saved rotation quaternion at the moment rotation begins (for cancel). */
      startRot:   new THREE.Quaternion(),
      /** Numeric degree string typed by the user; empty when mouse-driven. */
      inputStr:   '',
      /** True when the user has typed at least one digit. */
      hasInput:   false,
    }

    this._ctrlHeld  = false

    this._raycaster = new THREE.Raycaster()
    this._mouse     = new THREE.Vector2()

    // ── Pointer tracking (Pointer Events API — mouse + touch + stylus) ─────
    /** @type {number|null} pointerId of the active edit drag; null when idle */
    this._activeDragPointerId = null

    // ── UI wiring ──────────────────────────────────────────────────────────
    uiView.setCanvas(sceneView.renderer.domElement)
    uiView.onModeChange(mode => this.setMode(mode))

    if (outlinerView) {
      outlinerView.onSelect( id       => this._onOutlinerSelect(id))
      outlinerView.onDelete( id       => this._deleteObject(id))
      outlinerView.onAdd(  ()         => this._addObject())
      outlinerView.onVisible((id, v)  => this._setObjectVisible(id, v))
      outlinerView.onRename( (id, nm) => this._renameObject(id, nm))
    }

    uiView.onNameChange(name => {
      if (this._scene.activeId) this._renameObject(this._scene.activeId, name)
    })
    uiView.onDescriptionChange(desc => {
      const obj = this._activeObj
      if (obj) obj.description = desc
    })

    // ── Mobile drawer coordination ─────────────────────────────────────────
    uiView.onOutlinerToggle(() => {
      if (!outlinerView) return
      if (outlinerView.isDrawerOpen) {
        outlinerView.closeDrawer()
        uiView.hideBackdrop()
      } else {
        if (uiView.nPanelVisible) this._toggleNPanel()
        outlinerView.openDrawer()
        uiView.showBackdrop(() => outlinerView.closeDrawer())
      }
    })

    uiView.onNPanelToggle(() => {
      if (outlinerView?.isDrawerOpen) {
        outlinerView.closeDrawer()
        uiView.hideBackdrop()
      }
      this._toggleNPanel()
      if (uiView.nPanelVisible) {
        uiView.showBackdrop(() => this._toggleNPanel())
      } else {
        uiView.hideBackdrop()
      }
    })

    this._bindEvents()

    // Create the initial object
    this._addObject()
    this.setMode('object')
  }

  // ─── Domain state shorthand ───────────────────────────────────────────────

  /** Shorthand to access SceneModel through the ApplicationService. */
  get _scene() { return this._service.scene }

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
   * @param {'box'|'sketch'|'measure'|'frame'} [type='box']
   */
  _addObject(type = 'box') {
    if (type === 'sketch')  { this._addSketchObject();     return }
    if (type === 'measure') { this._startMeasurePlacement(); return }
    if (type === 'frame')   { this._addCoordinateFrame();  return }

    // Exit Edit Mode cleanly before adding, so the previous object's visual state is cleared
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const obj = this._service.createCuboid()
    this._switchActiveObject(obj.id, true)
  }

  /**
   * Adds a CoordinateFrame as a child of the currently active geometry object.
   * No-ops with a toast if no suitable parent is selected.
   */
  _addCoordinateFrame() {
    const parentId = this._scene.activeId
    const parent   = parentId ? this._scene.getObject(parentId) : null
    // MeasureLine and ImportedMesh are not valid parents (ADR-019).
    // CoordinateFrame parents are now allowed (nested frame hierarchy).
    if (!parent || parent instanceof MeasureLine || parent instanceof ImportedMesh) {
      this._uiView.showToast('Select a geometry object or frame to add a coordinate frame', { type: 'warn' })
      return
    }
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    const frame = this._service.createCoordinateFrame(parentId)
    if (frame) this._switchActiveObject(frame.id, true)
  }

  // ── STEP import ─────────────────────────────────────────────────────────────

  _triggerStepImport() {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = '.stp,.step,.STP,.STEP'
    input.addEventListener('change', async () => {
      const file = input.files?.[0]
      if (!file) return

      const scale = await this._showUnitDialog()
      if (scale === null) return  // user cancelled

      const ws = this._service.wsChannel
      if (!ws) {
        // Fall back to REST upload
        try {
          if (!this._service._bff) return
          const result = await this._service._bff.importStep(file)
          console.log('[AppController] STEP import result (REST):', result)
        } catch (err) {
          console.error('[AppController] STEP import error:', err)
        }
        return
      }
      // Send via WebSocket
      const reader = new FileReader()
      reader.onload = () => {
        const base64 = btoa(
          new Uint8Array(reader.result).reduce((s, b) => s + String.fromCharCode(b), '')
        )
        const jobId = `job_${Date.now()}`
        ws.send('import.step', { jobId, filename: file.name, data: base64, scale })
      }
      reader.readAsArrayBuffer(file)
    })
    input.click()
  }

  /** Shows a modal dialog for unit scale selection. Resolves with scale factor or null if cancelled. */
  _showUnitDialog() {
    return new Promise((resolve) => {
      const UNITS = [
        { label: 'No conversion  (1 : 1)',    value: 1 },
        { label: 'mm  →  m       (÷ 1000)',   value: 0.001 },
        { label: 'm   →  mm      (× 1000)',   value: 1000 },
        { label: 'cm  →  m       (÷ 100)',    value: 0.01 },
        { label: 'inch →  m      (× 0.0254)', value: 0.0254 },
        { label: 'inch →  mm     (× 25.4)',   value: 25.4 },
      ]

      const overlay = document.createElement('div')
      overlay.style.cssText = [
        'position:fixed;inset:0;background:rgba(0,0,0,0.6)',
        'display:flex;align-items:center;justify-content:center;z-index:9999',
      ].join(';')

      const dlg = document.createElement('div')
      dlg.style.cssText = [
        'background:#1e2a3a;border:1px solid #3a4a5a;border-radius:6px',
        'padding:20px 24px;min-width:320px;color:#ecf0f1;font-family:monospace',
        'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
      ].join(';')

      const title = document.createElement('div')
      title.textContent = 'Import STEP — Unit Conversion'
      title.style.cssText = 'font-size:13px;font-weight:bold;margin-bottom:14px;color:#aad4f5'
      dlg.appendChild(title)

      const lbl = document.createElement('div')
      lbl.textContent = 'Scale'
      lbl.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:6px'
      dlg.appendChild(lbl)

      const sel = document.createElement('select')
      sel.style.cssText = [
        'width:100%;background:#0d1a26;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;padding:6px 8px;font-family:monospace;font-size:12px',
        'cursor:pointer;outline:none',
      ].join(';')
      UNITS.forEach((u, i) => {
        const opt = document.createElement('option')
        opt.value = i
        opt.textContent = u.label
        sel.appendChild(opt)
      })
      dlg.appendChild(sel)

      const btnRow = document.createElement('div')
      btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px'

      const btnCancel = document.createElement('button')
      btnCancel.textContent = 'Cancel'
      btnCancel.style.cssText = [
        'padding:6px 14px;background:#2c3e50;color:#ecf0f1;border:1px solid #3a4a5a',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px',
      ].join(';')

      const btnImport = document.createElement('button')
      btnImport.textContent = 'Import'
      btnImport.style.cssText = [
        'padding:6px 14px;background:#e67e22;color:#fff;border:none',
        'border-radius:4px;cursor:pointer;font-family:monospace;font-size:12px;font-weight:bold',
      ].join(';')

      btnRow.appendChild(btnCancel)
      btnRow.appendChild(btnImport)
      dlg.appendChild(btnRow)
      overlay.appendChild(dlg)
      document.body.appendChild(overlay)

      const close = (result) => { document.body.removeChild(overlay); resolve(result) }
      btnCancel.addEventListener('click', () => close(null))
      btnImport.addEventListener('click', () => close(UNITS[sel.value].value))
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null) })
    })
  }

  // ────────────────────────────────────────────────────────────────────────────

  _addSketchObject() {
    // Exit current mode cleanly before switching active object
    if (this._scene.selectionMode === 'edit') this.setMode('object')

    const obj = this._service.createSketch()
    this._switchActiveObject(obj.id, true)
    this.setMode('edit')  // enters Edit Mode · 2D
  }

  /** Enters measure placement mode: click p1, then p2 to create a MeasureLine. */
  _startMeasurePlacement() {
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    this._measure.active       = true
    this._measure.p1           = null
    this._measure.p2           = null
    this._measure.snapTargets  = []
    this._measure.snapping     = false
    this._measure.snappedTarget = null
    // Snap display requires a MeshView with THREE.Points infrastructure.
    // MeasureLineView and CoordinateFrameView have no snap display infrastructure.
    // Fall back to any real MeshView-backed object for snap candidate rendering.
    const activeObj = this._scene.activeObject
    const _isSnapCapable = o => !(o instanceof MeasureLine) && !(o instanceof CoordinateFrame)
    this._measure.snapMeshView = (activeObj && _isSnapCapable(activeObj))
      ? activeObj.meshView
      : ([...this._scene.objects.values()].find(_isSnapCapable)?.meshView ?? null)
    this._uiView.setCursor('crosshair')
    this._updateMeasureStatus()
    this._updateMobileToolbar()
  }

  _cancelMeasure() {
    if (!this._measure.active) return
    this._measure.active       = false
    this._measure.p1           = null
    this._measure.p2           = null
    this._measure.snapping     = false
    this._measure.snappedTarget = null
    this._measure.snapTargets  = []
    this._measure.pressing     = false
    if (this._measure.previewLine) {
      this._sceneView.scene.remove(this._measure.previewLine)
      this._measure.previewLine.geometry.dispose()
      this._measure.previewLine.material.dispose()
      this._measure.previewLine = null
    }
    this._measure.snapMeshView?.clearSnapDisplay()
    this._measure.snapMeshView = null
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    this._updateMobileToolbar()
  }

  /**
   * Confirms the current snapped cursor position as a measure point.
   * Phase 1: sets p1. Phase 2: creates the MeasureLine entity.
   * Called from _onPointerUp so mobile users can hold-to-snap before releasing.
   */
  _confirmMeasurePoint() {
    const pt = this._measurePickPoint()
    if (!pt) return
    if (!this._measure.p1) {
      // Phase 1 → Phase 2: record start point
      this._measure.p1 = pt.clone()
      this._updateMeasureStatus()
    } else {
      // Phase 2: record end point → create entity
      const p2 = pt.clone()
      if (this._measure.previewLine) {
        this._sceneView.scene.remove(this._measure.previewLine)
        this._measure.previewLine.geometry.dispose()
        this._measure.previewLine.material.dispose()
        this._measure.previewLine = null
      }
      this._measure.snapMeshView?.clearSnapDisplay()
      this._measure.snapMeshView  = null
      this._measure.active        = false
      const p1                    = this._measure.p1
      this._measure.p1            = null
      this._measure.p2            = null
      this._measure.snapTargets   = []
      this._measure.snapping      = false
      this._measure.snappedTarget = null
      const obj = this._service.createMeasureLine(
        p1, p2,
        this._camera,
        this._sceneView.renderer,
        document.body,
      )
      this._switchActiveObject(obj.id, true)
      this._uiView.setCursor('default')
      this._refreshObjectModeStatus()
      this._updateMobileToolbar()
    }
  }

  _updateMeasureStatus() {
    if (!this._measure.active) return
    if (!this._measure.p1) {
      this._uiView.setStatusRich([
        { text: 'Measure', bold: true, color: '#f9a825' },
        { text: 'Click to set start point', color: '#888' },
        { text: 'ESC cancel', color: '#444' },
      ])
    } else {
      const parts = [
        { text: 'Measure', bold: true, color: '#f9a825' },
        { text: 'Click to set end point', color: '#888' },
      ]
      if (this._measure.p2) {
        const d = this._measure.p1.distanceTo(this._measure.p2)
        const f = d < 1 ? `${(d * 100).toFixed(1)} cm` : `${d.toFixed(3)} m`
        parts.push({ text: f, bold: true, color: '#f9a825' })
      }
      if (this._measure.snapping && this._measure.snappedTarget) {
        parts.push({ text: `Snap: ${this._measure.snappedTarget.label}`, color: '#ff9800' })
      }
      parts.push({ text: 'ESC cancel', color: '#444' })
      this._uiView.setStatusRich(parts)
    }
  }

  /**
   * Finds the nearest V/E/F snap target to the current mouse cursor.
   * Returns the snapped world position (or ground-plane fallback).
   * Also updates this._measure.snapping / snappedTarget / snapTargets.
   */
  _measurePickPoint() {
    const SNAP_PX = 25
    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    const targets = collectSnapTargets(this._scene.objects, 'all')
    this._measure.snapTargets = targets

    let bestDist   = SNAP_PX
    let bestTarget = null
    const camMat = this._camera.matrixWorldInverse
    for (const t of targets) {
      const camPos = t.position.clone().applyMatrix4(camMat)
      if (camPos.z >= 0) continue
      const s = this._projectToScreen(t.position)
      const d = Math.hypot(mx - s.x, my - s.y)
      if (d < bestDist) { bestDist = d; bestTarget = t }
    }

    if (bestTarget) {
      this._measure.snapping      = true
      this._measure.snappedTarget = bestTarget
      return bestTarget.position.clone()
    }

    // Fallback: intersect ground plane (Z=0)
    this._measure.snapping      = false
    this._measure.snappedTarget = null
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (this._raycaster.ray.intersectPlane(this._groundPlane, pt)) return pt
    return null
  }

  /** Builds or updates the dashed preview line shown during measure placement phase 2. */
  _updateMeasurePreview(p1, p2) {
    const pts = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]
    if (!this._measure.previewLine) {
      const geo  = new THREE.BufferGeometry()
      const mat  = new THREE.LineDashedMaterial({
        color: 0xf9a825, dashSize: 0.15, gapSize: 0.08, depthTest: false,
      })
      this._measure.previewLine = new THREE.Line(geo, mat)
      this._measure.previewLine.renderOrder = 1
      this._sceneView.scene.add(this._measure.previewLine)
    }
    const geo = this._measure.previewLine.geometry
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    geo.attributes.position.needsUpdate = true
    this._measure.previewLine.computeLineDistances()
  }

  _deleteObject(id) {
    const target = this._scene.getObject(id)
    if (!target) return

    // Frames are always deletable.  Geometry objects require at least one
    // other geometry object to remain in the scene.
    if (!(target instanceof CoordinateFrame)) {
      const geometryCount = [...this._scene.objects.values()]
        .filter(o => !(o instanceof CoordinateFrame)).length
      if (geometryCount <= 1) {
        this._uiView.showToast('Scene must contain at least one object', { type: 'warn' })
        return
      }
    }

    // If deleting the active object while in Edit Mode, exit cleanly first
    // (setMode operates on the active meshView, so must be called before dispose)
    if (id === this._scene.activeId && this._scene.selectionMode === 'edit') {
      this.setMode('object')
    }

    const wasActive = this._scene.activeId === id

    // Determine next active object: prefer geometry objects over frames.
    const nextId = wasActive
      ? (
          // First try another geometry object
          [...this._scene.objects.entries()].find(
            ([k, o]) => k !== id && !(o instanceof CoordinateFrame),
          )?.[0]
          // Fall back to any object (e.g. another frame)
          ?? [...this._scene.objects.keys()].find(k => k !== id)
          ?? null
        )
      : null

    this._service.deleteObject(id)

    if (wasActive && nextId) {
      this._switchActiveObject(nextId, true)
    }
  }

  /**
   * Duplicates the active Cuboid, makes the copy active, and immediately
   * starts a grab so the user can position it (Blender Shift+D behaviour).
   * No-ops if there is no active object or it is a Sketch.
   */
  _duplicateObject() {
    const id = this._scene.activeId
    if (!id) return
    if (this._scene.selectionMode === 'edit') this.setMode('object')
    const copy = this._service.duplicateCuboid(id)
    if (!copy) return
    this._selectedIds.clear()
    this._selectedIds.add(copy.id)
    this._switchActiveObject(copy.id, true)
    this._startGrab()
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

    this._service.setActiveObject(id)
    this._objSelected = select

    const obj = this._scene.getObject(id)
    if (obj) obj.meshView.setObjectSelected(select)

    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
  }

  _setObjectVisible(id, visible) {
    this._service.setObjectVisible(id, visible)
  }

  _renameObject(id, name) {
    this._service.renameObject(id, name)
    if (id === this._scene.activeId) this._updateNPanel()
  }

  /** Toggles N panel visibility and updates gizmo offset (desktop only) */
  _toggleNPanel() {
    this._uiView.toggleNPanel()
    this._updateNPanel()
    if (this._gizmoView) {
      const mobile = window.innerWidth < 768
      this._gizmoView.setRightOffset(!mobile && this._uiView.nPanelVisible ? 216 : 16)
    }
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
    // Store bound references so dispose() can remove them.
    this._handlers = {
      pointermove: e => this._onPointerMove(e),
      pointerdown: e => this._onPointerDown(e),
      pointerup:   e => this._onPointerUp(e),
      keydown:     e => this._onKeyDown(e),
      keyup:       e => this._onKeyUp(e),
      wheel:       e => this._onWheel(e),
      contextmenu: e => e.preventDefault(),
    }
    window.addEventListener('pointermove', this._handlers.pointermove)
    window.addEventListener('pointerdown', this._handlers.pointerdown)
    window.addEventListener('pointerup',   this._handlers.pointerup)
    window.addEventListener('keydown',     this._handlers.keydown)
    window.addEventListener('keyup',       this._handlers.keyup)
    window.addEventListener('wheel',       this._handlers.wheel, { passive: false })
    window.addEventListener('contextmenu', this._handlers.contextmenu)
  }

  dispose() {
    if (!this._handlers) return
    window.removeEventListener('pointermove', this._handlers.pointermove)
    window.removeEventListener('pointerdown', this._handlers.pointerdown)
    window.removeEventListener('pointerup',   this._handlers.pointerup)
    window.removeEventListener('keydown',     this._handlers.keydown)
    window.removeEventListener('keyup',       this._handlers.keyup)
    window.removeEventListener('wheel',       this._handlers.wheel)
    window.removeEventListener('contextmenu', this._handlers.contextmenu)
    this._handlers = null
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
      .filter(o => !(o instanceof MeasureLine) && o.meshView.cuboid?.visible)
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
    const fi   = Math.floor(hit.face.a / 4)
    const face = this._activeObj?.faces?.[fi] ?? null
    return face ? { face, point: hit.point } : null
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

    if (obj instanceof Sketch && obj.sketchRect) {
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

  // ─── Mobile toolbar ────────────────────────────────────────────────────────

  /** Rebuilds the mobile floating toolbar to reflect current app state. */
  _updateMobileToolbar() {
    const mode     = this._scene.selectionMode
    const substate = this._scene.editSubstate

    if (this._grab.active) {
      this._uiView.setMobileToolbar([
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => this._confirmGrab() },
        { icon: ICONS.stack,   label: 'Stack',   onClick: () => this._toggleStackMode(), active: this._grab.stackMode },
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => this._cancelGrab(), danger: true },
        { spacer: true },
      ])
      return
    }

    if (mode === 'object') {
      // Always show the same 4 buttons; Edit/Delete are disabled when no
      // object is selected. Fixed count prevents layout shifts on selection.
      const hasObj  = this._objSelected
      const canEdit = hasObj && !(this._activeObj instanceof ImportedMesh) && !(this._activeObj instanceof MeasureLine) && !(this._activeObj instanceof CoordinateFrame)
      const canGrab = hasObj
      this._uiView.setMobileToolbar([
        {
          icon: ICONS.add, label: 'Add',
          onClick: () => {
            const canAddFrame = this._objSelected && !(this._activeObj instanceof MeasureLine) && !(this._activeObj instanceof ImportedMesh)
            this._uiView.showAddMenu(
              window.innerWidth / 2, window.innerHeight / 2,
              () => this._addObject('box'),
              () => this._addObject('sketch'),
              () => this._addObject('measure'),
              () => this._triggerStepImport(),
              canAddFrame ? () => this._addObject('frame') : undefined,
            )
          },
        },
        { icon: ICONS.edit,   label: 'Edit',   onClick: () => this.setMode('edit'),                                     disabled: !canEdit },
        { icon: ICONS.delete, label: 'Delete', onClick: () => this._deleteObject(this._scene.activeId), danger: hasObj, disabled: !hasObj },
        { icon: ICONS.stack,  label: 'Stack',  onClick: () => { this._grab.stackMode = !this._grab.stackMode; this._updateMobileToolbar() }, active: this._grab.stackMode, disabled: !canGrab },
      ])
      return
    }

    if (substate === '2d-sketch') {
      // Always show ← first so its position never shifts. Extrude is disabled
      // until a rectangle has been drawn.
      const hasRect = this._sketch.p1 && this._sketch.p2 &&
        (Math.abs(this._sketch.p2.x - this._sketch.p1.x) > 0.01 ||
         Math.abs(this._sketch.p2.y - this._sketch.p1.y) > 0.01)
      this._uiView.setMobileToolbar([
        { icon: ICONS.back,    label: 'Object',  onClick: () => this.setMode('object') },
        { icon: ICONS.extrude, label: 'Extrude', onClick: () => this._enterExtrudePhase(), disabled: !hasRect },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (substate === '2d-extrude') {
      this._uiView.setMobileToolbar([
        { icon: ICONS.confirm, label: 'Confirm', onClick: () => this._confirmExtrudePhase() },
        { icon: ICONS.cancel,  label: 'Cancel',  onClick: () => this._cancelExtrudePhase(), danger: true },
        { spacer: true },
        { spacer: true },
      ])
      return
    }

    if (substate === '3d') {
      const em = this._editSelectMode
      this._uiView.setMobileToolbar([
        { icon: ICONS.back,   label: 'Object', onClick: () => this.setMode('object') },
        { icon: ICONS.vertex, label: 'Vertex', onClick: () => this._setEditSelectMode('vertex'), active: em === 'vertex' },
        { icon: ICONS.edge,   label: 'Edge',   onClick: () => this._setEditSelectMode('edge'),   active: em === 'edge' },
        { icon: ICONS.face,   label: 'Face',   onClick: () => this._setEditSelectMode('face'),   active: em === 'face' },
      ])
    }
  }

  // ─── Status bar helpers ────────────────────────────────────────────────────

  /** Single source of truth for "X selected" / '' status in Object Mode. */
  _refreshObjectModeStatus() {
    if (!this._objSelected || !this._activeObj) {
      this._uiView.setStatus('')
      return
    }
    this._uiView.setStatusRich([
      { text: this._activeObj.name, bold: true, color: '#e8e8e8' },
      { text: 'selected', color: '#888' },
    ])
  }

  // ─── Edit mode sub-element helpers (Phase 6) ─────────────────────────────

  /** Status bar for Edit Mode · 3D showing current sub-element mode. */
  _refreshEditModeStatus() {
    const LABEL = { vertex: 'Vertex', edge: 'Edge', face: 'Face' }
    const COLOR = { vertex: '#69f0ae', edge: '#ffd740', face: '#4fc3f7' }
    const m = this._editSelectMode
    this._uiView.setStatusRich([
      { text: 'Edit', color: '#888' },
      { text: LABEL[m], bold: true, color: COLOR[m] },
      { text: '1 Vertex  2 Edge  3 Face', color: '#444' },
    ])
  }

  /** Switches the sub-element mode and clears stale hover state. */
  _setEditSelectMode(mode) {
    this._editSelectMode = mode
    this._hoveredFace   = null
    this._hoveredVertex = null
    this._hoveredEdge   = null
    if (this._meshView) {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearVertexHover()
      this._meshView.clearEdgeHover()
    }
    this._uiView.setCursor('default')
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  /**
   * Projects a world position to screen pixels.
   * @param {import('three').Vector3} pos3d
   * @returns {{ x: number, y: number }}
   */
  _toScreenPx(pos3d) {
    const v = pos3d.clone().project(this._camera)
    return {
      x: (v.x + 1) / 2 * innerWidth,
      y: (-v.y + 1) / 2 * innerHeight,
    }
  }

  /**
   * Finds the vertex of the active object nearest to screen position (mx, my).
   * @param {number} mx  screen x in pixels
   * @param {number} my  screen y in pixels
   * @param {number} [maxPx=15]  max pixel radius
   * @returns {import('../graph/Vertex.js').Vertex|null}
   */
  _findNearestVertex(mx, my, maxPx = 15) {
    const obj = this._activeObj
    if (!obj?.vertices) return null
    let best = null, bestDist = maxPx
    for (const v of obj.vertices) {
      const s = this._toScreenPx(v.position)
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
   * @returns {import('../graph/Edge.js').Edge|null}
   */
  _findNearestEdge(mx, my, maxPx = 15) {
    const obj = this._activeObj
    if (!obj?.edges) return null
    let best = null, bestDist = maxPx
    for (const e of obj.edges) {
      const mid = e.v0.position.clone().add(e.v1.position).multiplyScalar(0.5)
      const s = this._toScreenPx(mid)
      const d = Math.hypot(s.x - mx, s.y - my)
      if (d < bestDist) { bestDist = d; best = e }
    }
    return best
  }

  /**
   * Handles a click in Edit Mode · 3D — updates editSelection and visuals.
   * @param {boolean} shift  whether Shift was held
   */
  _handleEditClick(shift) {
    const sel = this._scene.editSelection
    let element = null

    if (this._editSelectMode === 'face')   element = this._hoveredFace
    else if (this._editSelectMode === 'vertex') element = this._hoveredVertex
    else if (this._editSelectMode === 'edge')   element = this._hoveredEdge

    if (!element) {
      if (!shift) this._scene.clearEditSelection()
    } else {
      if (shift) {
        if (sel.has(element)) sel.delete(element)
        else                  sel.add(element)
      } else {
        this._scene.clearEditSelection()
        sel.add(element)
      }
    }

    this._meshView.updateEditSelection(sel, this._corners)

    const count = sel.size
    if (count > 0) {
      const LABEL = { vertex: 'vertex', edge: 'edge', face: 'face' }
      this._uiView.setStatusRich([
        { text: String(count), bold: true, color: '#e8e8e8' },
        { text: `${LABEL[this._editSelectMode]}${count > 1 ? 's' : ''} selected`, color: '#888' },
      ])
    } else {
      this._refreshEditModeStatus()
    }
    this._updateMobileToolbar()
  }

  // ─── Mode management ───────────────────────────────────────────────────────
  setMode(mode) {
    // ImportedMesh, MeasureLine, and CoordinateFrame have no vertex graph — Edit Mode is not supported
    if (mode === 'edit' && (
      this._activeObj instanceof ImportedMesh ||
      this._activeObj instanceof MeasureLine  ||
      this._activeObj instanceof CoordinateFrame
    )) {
      this._uiView.showToast('Edit Mode is not available for this object type')
      return
    }

    // ── Cancel all in-progress operations ──────────────────────────────────
    if (this._grab.active)   this._cancelGrab()
    if (this._rotate.active) this._cancelRotate()
    if (this._faceExtrude.active) this._cancelFaceExtrude()
    if (this._objDragging) {
      this._objDragging = false
      this._objCtrlDrag = false
    }

    // ── Clear all edit visual state on the current active object ───────────
    if (this._meshView) {
      this._meshView.setFaceHighlight(null, this._corners)
      this._meshView.clearExtrusionDisplay()
      this._meshView.clearSketchRect()
      this._meshView.clearVertexHover()
      this._meshView.clearEdgeHover()
      this._meshView.clearEditSelection()
    }
    this._uiView.clearExtrusionLabel()
    this._hoveredFace   = null
    this._hoveredVertex = null
    this._hoveredEdge   = null
    this._scene.clearEditSelection()

    // ── Substate reset and mode dispatch ───────────────────────────────────
    this._cleanupEditSubstate()
    this._scene.setSelectionMode(mode)
    this._controls.enabled = true

    if (mode === 'object') {
      // Restore selection state when returning from Edit Mode — the active
      // object is still valid but _objSelected was cleared on Edit entry.
      if (this._activeObj && !this._objSelected) {
        this._objSelected = true
        this._activeObj.meshView.setObjectSelected(true)
      }
      this._refreshObjectModeStatus()
      this._uiView.updateMode('object')
      this._updateMobileToolbar()
    } else {
      // edit mode — dispatch on entity type
      this._clearObjectSelection()
      this._setObjectSelected(false)
      this._objDragging = false
      if (this._activeObj instanceof Sketch) {
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
    this._updateMobileToolbar()
  }

  _enterEditMode3D() {
    this._scene.setEditSubstate('3d')
    this._editSelectMode = 'face'
    this._uiView.updateMode('edit', '3d')
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
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
    this._updateMobileToolbar()
  }

  _applyExtrudePreview() {
    const parsed = parseFloat(this._extrudePhase.inputStr)
    const height = this._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
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
    const parsed = parseFloat(this._extrudePhase.inputStr)
    const height = this._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
      : this._extrudePhase.height
    if (Math.abs(height) < 0.001) { this._cancelExtrudePhase(); return }

    const cuboid = this._service.extrudeSketch(this._scene.activeId, height)
    if (!cuboid) return

    this._meshView.updateGeometry(cuboid.corners)
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
    const parsed = parseFloat(this._extrudePhase.inputStr)
    const height = this._extrudePhase.hasInput
      ? (isNaN(parsed) ? 0 : parsed)
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
    this._refreshObjectModeStatus()
    this._updateMobileToolbar()
  }

  // ─── Rectangle selection helpers ──────────────────────────────────────────

  /** Creates the CSS overlay <div> used to draw the selection rectangle. */
  _createRectSelEl() {
    const el = document.createElement('div')
    Object.assign(el.style, {
      position:       'fixed',
      pointerEvents:  'none',
      display:        'none',
      zIndex:         '50',
      boxSizing:      'border-box',
    })
    document.body.appendChild(el)
    return el
  }

  /** Updates the overlay position/style to reflect the current drag rectangle. */
  _updateRectSelDisplay() {
    const { startPx, currentPx } = this._rectSel
    const isRight = currentPx.x >= startPx.x
    const x = Math.min(startPx.x, currentPx.x)
    const y = Math.min(startPx.y, currentPx.y)
    const w = Math.abs(currentPx.x - startPx.x)
    const h = Math.abs(currentPx.y - startPx.y)
    Object.assign(this._rectSelEl.style, {
      display:     'block',
      left:        x + 'px',
      top:         y + 'px',
      width:       w + 'px',
      height:      h + 'px',
      border:      '1px ' + (isRight ? 'solid' : 'dashed') + ' ' + (isRight ? '#4fc3f7' : '#ffa726'),
      background:  isRight ? 'rgba(79,195,247,0.05)' : 'rgba(255,167,38,0.05)',
    })
  }

  /** Clears visual selection highlight for all currently selected objects. */
  _clearObjectSelection() {
    for (const id of this._selectedIds) {
      const obj = this._scene.getObject(id)
      if (obj) obj.meshView.setObjectSelected(false)
    }
    this._selectedIds.clear()
  }

  /**
   * Finalizes the rectangle selection.
   * Right-drag (x increases): enclosed-only mode.
   * Left-drag (x decreases): touch mode (any overlap counts).
   */
  _finalizeRectSelection() {
    const { startPx, currentPx } = this._rectSel
    const w = Math.abs(currentPx.x - startPx.x)
    const h = Math.abs(currentPx.y - startPx.y)

    // Tiny movement — treat as deselect click
    if (w < 3 && h < 3) {
      this._clearObjectSelection()
      this._setObjectSelected(false)
      return
    }

    const isRight = currentPx.x >= startPx.x
    const minX = Math.min(startPx.x, currentPx.x)
    const minY = Math.min(startPx.y, currentPx.y)
    const maxX = Math.max(startPx.x, currentPx.x)
    const maxY = Math.max(startPx.y, currentPx.y)

    const matched = []
    for (const obj of this._scene.objects.values()) {
      if (!obj.meshView.cuboid.visible) continue
      const corners = obj.corners ?? _meshBboxCorners(obj)
      if (!corners || corners.length === 0) continue
      const pts = corners.map(c => this._toScreenPx(c))

      if (isRight) {
        // Enclosed: every projected corner must be inside the rect
        if (pts.every(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)) {
          matched.push(obj)
        }
      } else {
        // Touch: object screen-bounding-box overlaps the rect
        const bMinX = Math.min(...pts.map(p => p.x))
        const bMaxX = Math.max(...pts.map(p => p.x))
        const bMinY = Math.min(...pts.map(p => p.y))
        const bMaxY = Math.max(...pts.map(p => p.y))
        if (bMinX <= maxX && bMaxX >= minX && bMinY <= maxY && bMaxY >= minY) {
          matched.push(obj)
        }
      }
    }

    // Clear previous multi-selection then apply new one
    this._clearObjectSelection()
    if (matched.length === 0) {
      this._setObjectSelected(false)
      return
    }

    for (const obj of matched) {
      obj.meshView.setObjectSelected(true)
      this._selectedIds.add(obj.id)
    }

    // Make the first matched object active
    const first = matched[0]
    if (first.id !== this._scene.activeId) {
      // Deselect previous active's box-helper (already handled above)
      this._service.setActiveObject(first.id)
    }
    this._objSelected = true
    this._refreshObjectModeStatus()
    this._updateNPanel()
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
    this._grab.snapMode        = 'all'
    this._grab.snapTargets     = []
    this._grab.startMouse.copy(this._mouse)
    this._grab.startCorners = this._corners.map(c => c.clone())
    // Snapshot corners of every selected object for multi-object grab
    this._grab.allStartCorners = new Map()
    for (const id of this._selectedIds) {
      const selObj = this._scene.getObject(id)
      if (selObj) this._grab.allStartCorners.set(id, selObj.corners.map(c => c.clone()))
    }
    this._grab.centroid.copy(getCentroid(this._corners))
    this._grab.pivot.copy(this._grab.centroid)
    this._grab.pivotLabel = 'Centroid'
    this._grab.autoSnap   = false

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
    this._updateMobileToolbar()
  }

  _confirmGrab() {
    if (!this._grab.active) return
    if (this._grab.pivotSelectMode) { this._cancelPivotSelect(); return }
    this._applyGrab()
    this._grab.active        = false
    this._grab.axis          = null
    this._grab.autoSnap      = false
    this._grab.snappedTarget = null
    this._grab.stackMode     = false
    this._grab.stacking      = false
    this._meshView.clearPivotDisplay()
    this._meshView.clearSnapDisplay()
    this._controls.enabled = true
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
  }

  _cancelGrab() {
    if (!this._grab.active) return
    if (this._grab.pivotSelectMode) { this._grab.pivotSelectMode = false }
    // Restore all selected objects to their pre-grab positions
    for (const [id, startCorners] of this._grab.allStartCorners) {
      const selObj = this._scene.getObject(id)
      if (selObj) {
        startCorners.forEach((c, i) => selObj.corners[i].copy(c))
        selObj.meshView.updateGeometry(selObj.corners)
        selObj.meshView.updateBoxHelper()
      }
    }
    this._meshView.clearPivotDisplay()
    this._meshView.clearSnapDisplay()
    this._grab.active        = false
    this._grab.axis          = null
    this._grab.autoSnap      = false
    this._grab.snappedTarget = null
    this._grab.stackMode     = false
    this._grab.stacking      = false
    this._controls.enabled = true
    this._uiView.setCursor('default')
    this._refreshObjectModeStatus()
    this._updateNPanel()
    this._updateMobileToolbar()
  }

  // ── CoordinateFrame rotation (R key, ADR-019) ────────────────────────────

  /**
   * Starts rotate mode for the active CoordinateFrame.
   * Only valid when the active object is a CoordinateFrame and no grab is active.
   */
  _startRotate() {
    const frame = this._activeObj
    if (!(frame instanceof CoordinateFrame)) return
    if (this._grab.active) return

    this._rotate.active    = true
    this._rotate.axis      = null
    this._rotate.inputStr  = ''
    this._rotate.hasInput  = false
    this._rotate.startRot.copy(frame.rotation)

    // Compute the screen-space angle from the projected frame origin to the mouse.
    // This allows the mouse-driven angle to be relative to where it started.
    const projected = frame._worldPos.clone().project(this._camera)
    this._rotate.startAngle = Math.atan2(
      this._mouse.y - projected.y,
      this._mouse.x - projected.x,
    )

    this._updateRotateStatus()
  }

  /**
   * Confirms the current rotation and exits rotate mode.
   */
  _confirmRotate() {
    if (!this._rotate.active) return
    this._applyRotate()
    this._rotate.active   = false
    this._rotate.axis     = null
    this._rotate.inputStr = ''
    this._rotate.hasInput = false
    this._refreshObjectModeStatus()
  }

  /**
   * Cancels the rotation, restoring the frame to its saved rotation.
   */
  _cancelRotate() {
    if (!this._rotate.active) return
    const frame = this._activeObj
    if (frame instanceof CoordinateFrame) {
      frame.rotation.copy(this._rotate.startRot)
      frame.meshView.updateRotation(frame.rotation)
    }
    this._rotate.active   = false
    this._rotate.axis     = null
    this._rotate.inputStr = ''
    this._rotate.hasInput = false
    this._refreshObjectModeStatus()
  }

  /**
   * Sets the world-axis constraint for the current rotation.
   * Toggling the same axis clears the constraint (free rotation).
   * @param {'x'|'y'|'z'} axis
   */
  _setRotateAxis(axis) {
    this._rotate.axis = (this._rotate.axis === axis) ? null : axis
    this._rotate.inputStr = ''
    this._rotate.hasInput = false
    // Recompute start angle with new axis
    const frame = this._activeObj
    if (frame instanceof CoordinateFrame) {
      const projected = frame._worldPos.clone().project(this._camera)
      this._rotate.startAngle = Math.atan2(
        this._mouse.y - projected.y,
        this._mouse.x - projected.x,
      )
    }
    this._applyRotate()
    this._updateRotateStatus()
  }

  /**
   * Applies the current rotation delta to the active CoordinateFrame.
   * Called on every pointer move and on numeric input changes.
   */
  _applyRotate() {
    const frame = this._activeObj
    if (!(frame instanceof CoordinateFrame) || !this._rotate.active) return

    let angle
    if (this._rotate.hasInput) {
      const parsed = parseFloat(this._rotate.inputStr)
      angle = isNaN(parsed) ? 0 : parsed * (Math.PI / 180)
    } else {
      // Mouse-driven: measure signed angle from start to current mouse position.
      const projected = frame._worldPos.clone().project(this._camera)
      const currentAngle = Math.atan2(
        this._mouse.y - projected.y,
        this._mouse.x - projected.x,
      )
      angle = currentAngle - this._rotate.startAngle
    }

    // Build axis vector: world axis when constrained, view-direction when free.
    let axisVec
    if (this._rotate.axis === 'x') axisVec = new THREE.Vector3(1, 0, 0)
    else if (this._rotate.axis === 'y') axisVec = new THREE.Vector3(0, 1, 0)
    else if (this._rotate.axis === 'z') axisVec = new THREE.Vector3(0, 0, 1)
    else {
      // Screen-plane rotation: axis points toward the camera (view direction negated).
      axisVec = new THREE.Vector3()
      this._camera.getWorldDirection(axisVec).negate()
    }

    const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisVec, angle)
    frame.rotation.copy(this._rotate.startRot).premultiply(deltaQ)
    frame.meshView.updateRotation(frame.rotation)
    this._updateRotateStatus()
  }

  /**
   * Updates the status bar text to reflect the current rotate operation.
   */
  _updateRotateStatus() {
    const AXIS_COLORS = { x: '#e05252', y: '#6ab04c', z: '#4a9eed' }
    const parts = [{ text: 'Rotate', bold: true, color: '#80b3ff' }]

    if (this._rotate.axis) {
      parts.push({ text: this._rotate.axis.toUpperCase(), bold: true, color: AXIS_COLORS[this._rotate.axis] })
    }
    if (this._rotate.hasInput) {
      parts.push({ text: this._rotate.inputStr + '°_', color: '#ffeb3b' })
    }
    parts.push({ text: 'Enter confirm  Esc cancel', color: '#444' })
    this._uiView.setStatusRich(parts)
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
    // Stack snap: adjust Z so grabbed objects rest on top of any object below
    if (this._grab.stackMode) {
      this._applyStackSnap()
    } else {
      this._grab.stacking = false
    }
    // Update geometry for all selected objects
    for (const id of this._selectedIds) {
      const selObj = this._scene.getObject(id)
      if (selObj) {
        selObj.meshView.updateGeometry(selObj.corners)
        selObj.meshView.updateBoxHelper()
      }
    }
  }

  /** Toggles stacking mode on/off during an active grab. */
  _toggleStackMode() {
    this._grab.stackMode = !this._grab.stackMode
    this._grab.stacking  = false
    this._applyGrab()
    this._updateGrabStatus()
    this._updateMobileToolbar()
  }

  /**
   * Stack snap: after all grab movement is applied, cast downward rays from the
   * bottom face of the active grabbed object. If another object is directly below,
   * shift all grabbed objects upward so the bottom face rests on that surface.
   *
   * Must be called after `_applyGrabDeltaToAll()` has updated vertex positions.
   */
  _applyStackSnap() {
    const grabbed = this._activeObj
    if (!(grabbed instanceof Cuboid)) { this._grab.stacking = false; return }

    // Find bottom Z of the grabbed object
    const gCorners = grabbed.corners
    let gZMin = Infinity
    gCorners.forEach(c => { if (c.z < gZMin) gZMin = c.z })

    // Collect meshes from non-grabbed objects (excluding MeasureLine)
    const grabbedIds = new Set(this._selectedIds)
    const targetMeshes = [...this._scene.objects.values()]
      .filter(o => !grabbedIds.has(o.id) && !(o instanceof MeasureLine) && o.meshView?.cuboid?.visible)
      .map(o => o.meshView.cuboid)

    if (!targetMeshes.length) { this._grab.stacking = false; return }

    // Sample the bottom face: 4 corners at gZMin + centroid
    const bottomCorners = gCorners.filter(c => Math.abs(c.z - gZMin) < 0.001)
    const center = new THREE.Vector3()
    bottomCorners.forEach(c => center.add(c))
    center.divideScalar(bottomCorners.length || 1)

    const origins = [...bottomCorners, center]
    const downDir = new THREE.Vector3(0, 0, -1)
    const stackRay = new THREE.Raycaster()

    // Cast downward from well above the scene; find the highest surface hit at (x,y).
    // Using gZMin+ε as origin would miss surfaces above the current bottom face.
    const RAY_TOP = 10000
    let highestHitZ = null
    for (const origin of origins) {
      stackRay.set(new THREE.Vector3(origin.x, origin.y, RAY_TOP), downDir)
      const hits = stackRay.intersectObjects(targetMeshes)
      if (hits.length > 0) {
        const hz = hits[0].point.z
        if (highestHitZ === null || hz > highestHitZ) highestHitZ = hz
      }
    }

    if (highestHitZ === null) { this._grab.stacking = false; return }

    const zOffset = highestHitZ - gZMin
    // Skip if already resting on the surface (within 1mm tolerance)
    if (Math.abs(zOffset) < 0.001) { this._grab.stacking = false; return }

    // Apply additional Z shift to all selected objects' vertex positions directly
    for (const id of this._selectedIds) {
      const selObj = this._scene.getObject(id)
      if (selObj instanceof Cuboid) {
        selObj.corners.forEach(c => { c.z += zOffset })
      }
    }
    this._grab.stacking = true
  }

  /**
   * Applies `delta` to the active object and all other selected objects.
   * Uses each object's own startCorners snapshot from `_grab.allStartCorners`.
   * @param {import('three').Vector3} delta
   */
  _applyGrabDeltaToAll(delta) {
    for (const [id, startCorners] of this._grab.allStartCorners) {
      const selObj = this._scene.getObject(id)
      if (selObj) selObj.move(startCorners, delta)
    }
  }

  _applyGrabFromInput() {
    this._grab.snapping = false
    const parsed = parseFloat(this._grab.inputStr)
    if (this._grab.inputStr && isNaN(parsed)) {
      this._uiView.showToast('Invalid number')
      return
    }
    const dist    = isNaN(parsed) ? 0 : parsed
    const axisVec = this._getAxisVec(this._grab.axis)
    this._applyGrabDeltaToAll(axisVec.clone().multiplyScalar(dist))
  }

  _applyFreeGrab() {
    this._raycaster.setFromCamera(this._mouse, this._camera)
    const pt = new THREE.Vector3()
    if (!this._raycaster.ray.intersectPlane(this._grab.dragPlane, pt)) return
    let delta = pt.clone().sub(this._grab.startPoint)
    if (this._grab.autoSnap) {
      delta = this._trySnapToGeometry(delta)
    } else if (this._ctrlHeld) {
      delta = this._applyGridSnapToDelta(delta)
      this._grab.snapping      = false
      this._grab.snappedTarget = null
    } else {
      this._grab.snapping      = false
      this._grab.snappedTarget = null
    }
    this._applyGrabDeltaToAll(delta)
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

    if (this._grab.autoSnap) {
      const delta        = new THREE.Vector3().addScaledVector(axisVec, dist)
      const snappedDelta = this._trySnapToGeometry(delta)
      this._applyGrabDeltaToAll(snappedDelta)
    } else if (this._ctrlHeld) {
      this._grab.snapping      = false
      this._grab.snappedTarget = null
      const g           = this._grab.gridSize
      const snappedDist = Math.round(dist / g) * g
      this._applyGrabDeltaToAll(axisVec.clone().multiplyScalar(snappedDist))
    } else {
      this._grab.snapping      = false
      this._grab.snappedTarget = null
      this._applyGrabDeltaToAll(axisVec.clone().multiplyScalar(dist))
    }
  }

  _updateGrabStatus() {
    if (this._grab.pivotSelectMode) {
      const MODE_LABEL = { all: 'All', vertex: 'Vertex', edge: 'Edge', face: 'Face' }
      const MODE_COLOR = { all: '#aaa', vertex: '#69f0ae', edge: '#ffd740', face: '#4fc3f7' }
      const m = this._grab.pivotMode ?? 'all'
      this._uiView.setStatusRich([
        { text: 'Select Pivot', bold: true, color: '#e8e8e8' },
        { text: MODE_LABEL[m], color: MODE_COLOR[m] },
        { text: '1 Vertex  2 Edge  3 Face', color: '#444' },
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
    if (this._grab.stackMode) {
      if (this._grab.stacking) {
        parts.push({ text: 'Stack: ON', bold: true, color: '#a5d6a7' })
      } else {
        parts.push({ text: 'Stack', color: '#4caf50' })
      }
    }
    if (this._grab.snapping && this._grab.snappedTarget) {
      parts.push({ text: `Snap: ${this._grab.snappedTarget.label}`, bold: true, color: '#ff9800' })
    } else if (this._grab.autoSnap) {
      parts.push({ text: 'Auto Snap [World]', color: '#80cbc4' })
      parts.push({ text: 'Origin / X / Y / Z', color: '#444' })
    } else if (this._ctrlHeld) {
      parts.push({ text: `Grid: ${this._grab.gridSize}`, bold: true, color: '#80cbc4' })
      parts.push({ text: 'Scroll to change', color: '#444' })
    }

    this._uiView.setStatusRich(parts)
  }

  // ─── Grid snap (Ctrl during grab) ─────────────────────────────────────────

  /** Grid sizes cycled by Ctrl+Wheel during grab */
  static get GRID_SIZES() { return [0.1, 0.25, 0.5, 1, 2.5, 5, 10] }

  /**
   * Rounds a delta vector to the nearest multiple of the current grid size.
   * @param {THREE.Vector3} delta
   * @returns {THREE.Vector3}
   */
  _applyGridSnapToDelta(delta) {
    const g = this._grab.gridSize
    return new THREE.Vector3(
      Math.round(delta.x / g) * g,
      Math.round(delta.y / g) * g,
      Math.round(delta.z / g) * g,
    )
  }

  _onWheel(e) {
    if (!this._grab.active || !this._ctrlHeld) return
    e.preventDefault()
    const sizes = AppController.GRID_SIZES
    const idx   = sizes.indexOf(this._grab.gridSize)
    // fall back to nearest index if current size not in list
    const cur   = idx >= 0 ? idx : sizes.findIndex(s => s >= this._grab.gridSize) || 0
    const next  = e.deltaY > 0
      ? Math.min(cur + 1, sizes.length - 1)
      : Math.max(cur - 1, 0)
    this._grab.gridSize = sizes[next]
    this._applyGrab()
    this._updateGrabStatus()
  }

  // ─── Face extrude (E key) ──────────────────────────────────────────────────

  _startFaceExtrude(face) {
    const fe = this._faceExtrude
    fe.active        = true
    fe.face          = face
    fe.savedCorners  = face.vertices.map(v => v.position.clone())
    fe.dist          = 0
    fe.inputStr      = ''
    fe.hasInput      = false
    fe.snapping      = false
    fe.snappedTarget = null
    fe.normal.copy(computeOutwardFaceNormal(this._corners, face.index))
    const center = fe.savedCorners.reduce((a, c) => a.add(c), new THREE.Vector3()).divideScalar(fe.savedCorners.length)
    const camDir = new THREE.Vector3()
    this._camera.getWorldDirection(camDir)
    fe.dragPlane.setFromNormalAndCoplanarPoint(camDir, center)
    const pt = new THREE.Vector3()
    this._raycaster.setFromCamera(this._mouse, this._camera)
    fe.startPoint.copy(this._raycaster.ray.intersectPlane(fe.dragPlane, pt) ? pt : center)
    this._controls.enabled = false
    this._updateFaceExtrudeStatus()
    this._updateMobileToolbar()
  }

  _applyFaceExtrude() {
    const { face, savedCorners, normal, dist } = this._faceExtrude
    this._activeObj.extrudeFace(face, savedCorners, normal, dist)
    this._meshView.updateGeometry(this._corners)
    this._meshView.setFaceHighlight(face.index, this._corners)
    const currentFaceCorners = face.vertices.map(v => v.position)
    const { spanMid, armDir } = this._meshView.setExtrusionDisplay(savedCorners, currentFaceCorners)
    const labelPos = spanMid.clone().addScaledVector(armDir, 0.25)
    const screen = this._projectToScreen(labelPos)
    this._uiView.setExtrusionLabel(`D ${Math.abs(dist).toFixed(3)}`, screen.x, screen.y)
    this._updateNPanel()
  }

  _applyFaceExtrudeFromInput() {
    this._faceExtrude.snapping = false
    const parsed = parseFloat(this._faceExtrude.inputStr)
    if (this._faceExtrude.inputStr && isNaN(parsed)) {
      this._uiView.showToast('Invalid number')
      return
    }
    this._faceExtrude.dist = isNaN(parsed) ? 0 : parsed
    this._applyFaceExtrude()
  }

  _confirmFaceExtrude() {
    this._faceExtrude.active = false
    this._controls.enabled = true
    this._meshView.clearExtrusionDisplay()
    this._meshView.clearSnapDisplay()
    this._meshView.setFaceHighlight(null, this._corners)
    this._scene.editSelection.clear()
    this._meshView.updateEditSelection(this._scene.editSelection, this._corners)
    this._uiView.clearExtrusionLabel()
    this._updateNPanel()
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  _cancelFaceExtrude() {
    const { face, savedCorners, normal } = this._faceExtrude
    if (face) {
      this._activeObj.extrudeFace(face, savedCorners, normal, 0)
      this._meshView.updateGeometry(this._corners)
      this._meshView.setFaceHighlight(face.index, this._corners)
    }
    this._faceExtrude.active = false
    this._controls.enabled = true
    this._meshView.clearExtrusionDisplay()
    this._meshView.clearSnapDisplay()
    this._uiView.clearExtrusionLabel()
    this._refreshEditModeStatus()
    this._updateMobileToolbar()
  }

  _updateFaceExtrudeStatus() {
    const fe = this._faceExtrude
    const parts = [
      { text: 'Extrude', bold: true, color: '#ffffff' },
      { text: fe.face?.name ?? '', color: '#4fc3f7' },
    ]
    if (fe.hasInput) {
      parts.push({ text: fe.inputStr + '_', color: '#ffeb3b' })
    } else {
      parts.push({ text: `D: ${fe.dist.toFixed(3)}`, color: '#ffeb3b' })
    }
    if (fe.snapping && fe.snappedTarget) {
      parts.push({ text: `Snap: ${fe.snappedTarget.label}`, bold: true, color: '#ff9800' })
    }
    const hint = window.innerWidth < 768
      ? 'Release to confirm'
      : 'Enter confirm  Esc cancel'
    parts.push({ text: hint, color: '#444' })
    this._uiView.setStatusRich(parts)
  }

  /**
   * Snaps face extrude distance to nearest geometry element projected onto the face normal.
   * @param {number} dist  raw extrude distance
   * @returns {number}  snapped or original distance
   */
  _trySnapFaceExtrude(dist) {
    const SNAP_PX = 25
    const fe      = this._faceExtrude
    const center  = fe.savedCorners.reduce((a, c) => a.add(c), new THREE.Vector3()).divideScalar(fe.savedCorners.length)
    const posAfter = center.clone().addScaledVector(fe.normal, dist)

    // Compare snap targets to the mouse cursor, not the face center
    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    const geoTargets   = collectSnapTargets(this._scene.objects, 'all', new Set([this._scene.activeId]))
    const worldTargets = collectWorldSnapTargets(posAfter)
    const targets      = [...geoTargets, ...worldTargets]
    fe.snapTargets = targets
    let bestDist   = SNAP_PX
    let bestTarget = null

    const camMat = this._camera.matrixWorldInverse
    for (const t of targets) {
      const camPos = t.position.clone().applyMatrix4(camMat)
      if (camPos.z >= 0) continue
      const s = this._projectToScreen(t.position)
      const d = Math.hypot(mx - s.x, my - s.y)
      if (d < bestDist) { bestDist = d; bestTarget = t }
    }

    if (bestTarget) {
      fe.snapping      = true
      fe.snappedTarget = bestTarget
      return bestTarget.position.clone().sub(center).dot(fe.normal)
    }
    fe.snapping      = false
    fe.snappedTarget = null
    return dist
  }

  // ─── Geometry snap ─────────────────────────────────────────────────────────

  /**
   * Attempts to snap the grab pivot to the nearest geometry element.
   * Snap candidates: all Vertex positions, Edge midpoints, Face centers.
   * @param {THREE.Vector3} delta  current free delta
   * @returns {THREE.Vector3}  snapped or original delta
   */
  _trySnapToGeometry(delta) {
    const SNAP_PX    = 25
    const pivotAfter = this._grab.pivot.clone().add(delta)
    const pScreen    = this._projectToScreen(pivotAfter)

    const grabbedIds   = new Set(this._grab.allStartCorners.keys())
    const geoTargets   = collectSnapTargets(this._scene.objects, this._grab.snapMode, grabbedIds)
    const worldTargets = collectWorldSnapTargets(pivotAfter)
    const targets      = [...geoTargets, ...worldTargets]
    this._grab.snapTargets = targets  // cache for candidate display
    let bestDist   = SNAP_PX
    let bestTarget = null

    const camMat = this._camera.matrixWorldInverse
    for (const t of targets) {
      // Skip targets behind the camera (camera-space z >= 0 means behind)
      const camPos = t.position.clone().applyMatrix4(camMat)
      if (camPos.z >= 0) continue

      const s = this._projectToScreen(t.position)
      const d = Math.hypot(pScreen.x - s.x, pScreen.y - s.y)
      if (d < bestDist) { bestDist = d; bestTarget = t }
    }

    if (bestTarget) {
      this._grab.snapping      = true
      this._grab.snappedTarget = bestTarget
      return bestTarget.position.clone().sub(this._grab.pivot)
    }
    this._grab.snapping      = false
    this._grab.snappedTarget = null
    return delta
  }

  // ─── Pivot point selection ─────────────────────────────────────────────────

  _startPivotSelect() {
    if (!this._grab.active || this._grab.pivotSelectMode) return
    // Pivot selection uses Cuboid-specific vertex geometry — skip for non-Cuboid types.
    if (this._activeObj instanceof ImportedMesh || this._activeObj instanceof MeasureLine || this._activeObj instanceof CoordinateFrame) return
    this._grab.startCorners.forEach((c, i) => this._corners[i].copy(c))
    this._meshView.updateGeometry(this._corners)
    this._meshView.updateBoxHelper()
    this._grab.pivotSelectMode = true
    this._grab.pivotMode       = 'all'
    this._grab.hoveredPivotIdx = -1
    this._grab.candidates = getPivotCandidates(this._grab.startCorners)
    this._meshView.showPivotCandidates(this._grab.candidates)
    this._updateGrabStatus()
  }

  /**
   * Filters pivot candidates by sub-element type and refreshes the display.
   * @param {'all'|'vertex'|'edge'|'face'} mode
   */
  _setPivotCandidateMode(mode) {
    this._grab.pivotMode = mode
    const corners = this._grab.startCorners
    const candidates =
      mode === 'vertex' ? getVertexPivotCandidates(corners) :
      mode === 'edge'   ? getEdgePivotCandidates(corners)   :
      mode === 'face'   ? getFacePivotCandidates(corners)   :
                          getPivotCandidates(corners)
    this._grab.candidates      = candidates
    this._grab.hoveredPivotIdx = -1
    this._meshView.showPivotCandidates(candidates)
    this._meshView.setHoveredPivot(null)
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
      this._meshView.setHoveredPivot(cand)
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

  /**
   * Changes the snap target filter during grab and resets the current snap lock.
   * @param {'all'|'vertex'|'edge'|'face'} mode
   */
  _setSnapMode(mode) {
    this._grab.snapMode      = mode
    this._grab.snapping      = false
    this._grab.snappedTarget = null
    this._meshView.clearSnapLocked()
    this._updateGrabStatus()
  }

  _confirmPivotSelect() {
    const idx = this._grab.hoveredPivotIdx
    if (idx >= 0) {
      const cand = this._grab.candidates[idx]
      this._grab.pivot.copy(cand.position)
      this._grab.pivotLabel = cand.label
      this._restartGrabFromPivot()
      this._grab.autoSnap = true  // auto-snap enabled after pivot selection
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

  // ─── Pointer events (mouse + touch + stylus) ──────────────────────────────
  _onPointerMove(e) {
    // During a drag, only process the pointer that started it
    if (this._activeDragPointerId !== null && e.pointerId !== this._activeDragPointerId) return
    this._updateMouse(e)

    if (this._rotate.active) {
      this._applyRotate()
      return
    }

    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        this._updatePivotHover()
        return
      }
      this._applyGrab()
      if (this._grab.autoSnap) {
        this._meshView.showSnapCandidates(this._grab.snapTargets)
        if (this._grab.snapping && this._grab.snappedTarget) {
          this._meshView.showSnapLocked(
            this._grab.snappedTarget.position,
            this._grab.snappedTarget.type,
            this._grab.pivot,
          )
        } else {
          this._meshView.clearSnapLocked()
        }
      } else {
        this._meshView.clearSnapDisplay()
      }
      this._updateGrabStatus()
      this._updateNPanel()
      return
    }

    // ── Measure placement hover ───────────────────────────────────────────
    if (this._measure.active) {
      const pt = this._measurePickPoint()
      if (pt) {
        this._measure.p2 = pt
        // Show snap candidates via snapMeshView (a real MeshView, not MeasureLineView)
        const smv = this._measure.snapMeshView
        if (smv) {
          smv.showSnapCandidates(this._measure.snapTargets)
          if (this._measure.snapping && this._measure.snappedTarget) {
            smv.showSnapLocked(
              this._measure.snappedTarget.position,
              this._measure.snappedTarget.type,
              pt,
            )
          } else {
            smv.clearSnapLocked()
          }
        }
        // Phase 2: draw preview line
        if (this._measure.p1) {
          this._updateMeasurePreview(this._measure.p1, pt)
        }
      }
      this._updateMeasureStatus()
      return
    }

    if (this._scene.selectionMode === 'object') {
      if (this._rectSel.active) {
        this._rectSel.currentPx = { x: e.clientX, y: e.clientY }
        this._updateRectSelDisplay()
        return
      }
      if (this._objDragging) {
        if (this._objCtrlDrag) {
          const angle = (e.clientX - this._objRotateStartX) * 0.01
          const quat  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle)
          this._objRotateStartCorners.forEach((c, i) => {
            this._corners[i].copy(c).sub(this._objRotateCentroid).applyQuaternion(quat).add(this._objRotateCentroid)
          })
          this._meshView.updateGeometry(this._corners)
          if (this._objSelected) this._meshView.updateBoxHelper()
        } else {
          this._raycaster.setFromCamera(this._mouse, this._camera)
          const pt = new THREE.Vector3()
          if (this._raycaster.ray.intersectPlane(this._objDragPlane, pt)) {
            const delta = pt.clone().sub(this._objDragStart)
            // Apply delta to all selected objects
            for (const [id, startCorners] of this._objDragAllStartCorners) {
              const selObj = this._scene.getObject(id)
              if (selObj) selObj.move(startCorners, delta)
            }
            // Stack snap: after XY movement, adjust Z so the object rests on
            // the highest surface directly below it (same logic as _grab path).
            if (this._grab.stackMode) this._applyStackSnap()
            // Update geometry for all dragged objects
            for (const [id] of this._objDragAllStartCorners) {
              const selObj = this._scene.getObject(id)
              if (selObj) {
                selObj.meshView.updateGeometry(selObj.corners)
                selObj.meshView.updateBoxHelper()
              }
            }
          }
        }
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

    // ── Face extrude mode (E key) ─────────────────────────────────────────
    if (this._faceExtrude.active) {
      if (this._faceExtrude.hasInput) return
      this._raycaster.setFromCamera(this._mouse, this._camera)
      const pt = new THREE.Vector3()
      if (!this._raycaster.ray.intersectPlane(this._faceExtrude.dragPlane, pt)) return
      const rawDist = pt.clone().sub(this._faceExtrude.startPoint).dot(this._faceExtrude.normal)
      this._faceExtrude.dist = this._trySnapFaceExtrude(rawDist)
      this._applyFaceExtrude()
      // snap visuals
      const fe = this._faceExtrude
      this._meshView.showSnapCandidates(fe.snapTargets)
      if (fe.snapping && fe.snappedTarget) {
        const faceCenterAfter = fe.savedCorners
          .reduce((a, c) => a.add(c), new THREE.Vector3())
          .divideScalar(fe.savedCorners.length)
          .addScaledVector(fe.normal, fe.dist)
        this._meshView.showSnapLocked(fe.snappedTarget.position, fe.snappedTarget.type, faceCenterAfter)
      } else {
        this._meshView.clearSnapLocked()
      }
      this._updateFaceExtrudeStatus()
      return
    }

    // ── Hover detection per sub-element mode ──────────────────────────────
    if (this._editSelectMode === 'face') {
      const hit  = this._hitFace()
      const face = hit?.face ?? null
      if (face !== this._hoveredFace) {
        this._hoveredFace = face
        this._meshView.setFaceHighlight(face?.index ?? null, this._corners)
        if (face) {
          const hasSel = [...this._scene.editSelection].some(x => x instanceof Face)
          this._uiView.setStatusRich([
            { text: 'Face', color: '#888' },
            { text: face.name, color: '#e8e8e8' },
            { text: hasSel ? 'E to extrude' : 'Click to select', color: '#555' },
          ])
        } else {
          this._refreshEditModeStatus()
        }
        this._uiView.setCursor(face ? 'pointer' : 'default')
      }
      return
    }

    const mx = (this._mouse.x + 1) / 2 * innerWidth
    const my = (-this._mouse.y + 1) / 2 * innerHeight

    if (this._editSelectMode === 'vertex') {
      const v = this._findNearestVertex(mx, my)
      if (v !== this._hoveredVertex) {
        this._hoveredVertex = v
        if (v) {
          this._meshView.showVertexHover(v)
          this._uiView.setStatusRich([
            { text: 'Vertex', bold: true, color: '#69f0ae' },
            { text: 'Click to select', color: '#555' },
          ])
          this._uiView.setCursor('pointer')
        } else {
          this._meshView.clearVertexHover()
          this._refreshEditModeStatus()
          this._uiView.setCursor('default')
        }
      }
      return
    }

    if (this._editSelectMode === 'edge') {
      const e = this._findNearestEdge(mx, my)
      if (e !== this._hoveredEdge) {
        this._hoveredEdge = e
        if (e) {
          this._meshView.showEdgeHover(e)
          this._uiView.setStatusRich([
            { text: 'Edge', bold: true, color: '#ffd740' },
            { text: 'Click to select', color: '#555' },
          ])
          this._uiView.setCursor('pointer')
        } else {
          this._meshView.clearEdgeHover()
          this._refreshEditModeStatus()
          this._uiView.setCursor('default')
        }
      }
    }
  }

  _onPointerDown(e) {
    // Ignore secondary touches while an edit drag is already active
    if (this._activeDragPointerId !== null && e.pointerType === 'touch') {
      // Second finger while rect selection is active: cancel rect sel so
      // OrbitControls can handle the two-finger orbit/dolly gesture.
      if (this._rectSel.active) {
        this._rectSel.active = false
        this._rectSelEl.style.display = 'none'
        this._activeDragPointerId = null
      }
      return
    }

    // Only process events that target the canvas. Toolbar button taps are
    // handled by the buttons' own click listeners, not via pointer events.
    // Without this guard, button taps trigger _handleEditClick which clears
    // face selection before the button's click handler fires (e.g. Extrude).
    if (e.target !== this._sceneView.renderer.domElement) return

    if (this._rotate.active) {
      if (e.button === 0) { this._confirmRotate(); return }
      if (e.button === 2) { this._cancelRotate();  return }
      return
    }

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

    if (this._faceExtrude.active) {
      if (e.button === 0) {
        // Don't confirm immediately — let pointermove update the distance,
        // then confirm on pointerup. This allows touch-drag to set distance.
        this._activeDragPointerId = e.pointerId
        return
      }
      if (e.button === 2) { this._cancelFaceExtrude(); return }
      return
    }

    // ── Measure placement clicks ──────────────────────────────────────────
    if (this._measure.active) {
      if (e.button === 2) { this._cancelMeasure(); return }
      if (e.button === 0) {
        // Hold to snap, release to confirm — handled in _onPointerUp.
        // This lets mobile users slide their finger to the snap target before lifting.
        this._measure.pressing = true
        this._activeDragPointerId = e.pointerId
        return
      }
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
        this._activeDragPointerId = e.pointerId
      }
      return
    }

    if (this._scene.selectionMode === 'object') {
      const result = this._hitAnyObject()
      if (result) {
        const { hit, obj } = result
        if (!this._selectedIds.has(obj.id)) {
          // Clicked an unselected object — clear previous selection, select only this
          this._clearObjectSelection()
          if (obj.id !== this._scene.activeId) {
            this._switchActiveObject(obj.id, true)
          } else if (!this._objSelected) {
            this._setObjectSelected(true)
          }
          this._selectedIds.add(obj.id)
        } else {
          // Clicked an already-selected object — keep all selected, update active
          if (obj.id !== this._scene.activeId) {
            this._service.setActiveObject(obj.id)
            this._objSelected = true
            this._refreshObjectModeStatus()
            this._updateNPanel()
          }
        }

        // MeasureLine and CoordinateFrame cannot be dragged
        if (obj instanceof MeasureLine || obj instanceof CoordinateFrame) {
          return
        }

        // Snapshot corners of every selected object for this drag
        this._objDragAllStartCorners = new Map()
        for (const id of this._selectedIds) {
          const selObj = this._scene.getObject(id)
          if (selObj?.corners) this._objDragAllStartCorners.set(id, selObj.corners.map(c => c.clone()))
        }

        this._objDragging      = true
        // Ctrl+drag (rotate) only works for locally-editable objects (Cuboid).
        this._objCtrlDrag      = e.ctrlKey && !(obj instanceof ImportedMesh) && !(obj instanceof MeasureLine) && !(obj instanceof CoordinateFrame)
        this._controls.enabled = false
        this._activeDragPointerId = e.pointerId
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
        // No object hit — start rectangle selection.
        // Do NOT disable _controls here: orbit (right-click / two-finger) uses
        // separate buttons/fingers and must remain available simultaneously.
        this._rectSel.active    = true
        this._rectSel.startPx   = { x: e.clientX, y: e.clientY }
        this._rectSel.currentPx = { x: e.clientX, y: e.clientY }
        this._activeDragPointerId = e.pointerId
      }
      return
    }

    // ── Edit mode: click to select sub-elements ───────────────────────────
    // Refresh hover state for touch (pointermove may not fire before pointerdown on touch devices)
    if (this._scene.editSubstate === '3d') {
      if (this._editSelectMode === 'face') {
        const hit = this._hitFace()
        this._hoveredFace = hit?.face ?? null
        this._meshView.setFaceHighlight(this._hoveredFace?.index ?? null, this._corners)
      } else if (this._editSelectMode === 'vertex') {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._hoveredVertex = this._findNearestVertex(mx, my)
      } else if (this._editSelectMode === 'edge') {
        const mx = (this._mouse.x + 1) / 2 * innerWidth
        const my = (-this._mouse.y + 1) / 2 * innerHeight
        this._hoveredEdge = this._findNearestEdge(mx, my)
      }
    }
    this._handleEditClick(e.shiftKey)

    // Mobile: auto-start face extrude immediately after a face tap, so the
    // user can drag to set the distance without pressing the Extrude button.
    // (Only fires when a face was selected without Shift — not for multi-select.)
    if (window.innerWidth < 768 &&
        this._scene.editSubstate === '3d' &&
        this._editSelectMode === 'face' &&
        !e.shiftKey) {
      const faces = [...this._scene.editSelection].filter(x => x instanceof Face)
      if (faces.length > 0) {
        this._startFaceExtrude(faces[0])
        this._activeDragPointerId = e.pointerId
      }
    }
  }

  _onPointerUp(e) {
    if (e.button !== 0) return

    // ── Measure point confirmation (hold-to-snap, release-to-confirm) ─────
    if (this._measure.active && this._measure.pressing) {
      if (this._activeDragPointerId === e.pointerId) {
        this._activeDragPointerId = null
        this._measure.pressing    = false
        this._confirmMeasurePoint()
      }
      return
    }

    // wasDragging: a canvas drag started for this pointer (via _onPointerDown)
    const wasDragging = this._activeDragPointerId === e.pointerId
    if (wasDragging) this._activeDragPointerId = null
    if (this._faceExtrude.active) {
      // Only confirm when a canvas drag was started; prevents double-confirm
      // when the mobile Confirm toolbar button fires both pointerup and click.
      if (wasDragging) this._confirmFaceExtrude()
      return
    }
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
            this._updateMobileToolbar()
          }
        }
      }
      return
    }
    if (this._rectSel.active) {
      this._rectSel.active = false
      this._rectSelEl.style.display = 'none'
      this._controls.enabled = true
      this._finalizeRectSelection()
      return
    }
    if (this._objDragging) {
      this._objDragging  = false
      this._objCtrlDrag  = false
      this._controls.enabled = true
      this._activeDragPointerId = null
      this._uiView.setCursor(this._hitAnyObject() ? 'pointer' : 'default')
      this._updateNPanel()
    }
  }

  _onKeyUp(e) {
    if (e.key === 'Control') {
      this._ctrlHeld = false
      if (this._grab.active && !this._grab.pivotSelectMode) this._updateGrabStatus()
      if (this._faceExtrude.active) this._updateFaceExtrudeStatus()
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Control') this._ctrlHeld = true

    // ── Keys active during rotate (CoordinateFrame R key, ADR-019) ────────
    if (this._rotate.active) {
      switch (e.key) {
        case 'x': case 'X': this._setRotateAxis('x'); return
        case 'y': case 'Y': this._setRotateAxis('y'); return
        case 'z': case 'Z': this._setRotateAxis('z'); return
        case 'Enter':  this._confirmRotate(); return
        case 'Escape': this._cancelRotate();  return
      }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._rotate.inputStr += e.key
        this._rotate.hasInput  = true
        this._applyRotate()
        this._updateRotateStatus()
        return
      }
      if (e.key === '-' && this._rotate.inputStr.length === 0) {
        this._rotate.inputStr = '-'
        this._rotate.hasInput = true
        this._updateRotateStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._rotate.inputStr = this._rotate.inputStr.slice(0, -1)
        this._rotate.hasInput = this._rotate.inputStr.length > 0 && this._rotate.inputStr !== '-'
        this._applyRotate()
        this._updateRotateStatus()
        return
      }
      return
    }

    // ── Keys active during grab ────────────────────────────────────────────
    if (this._grab.active) {
      if (this._grab.pivotSelectMode) {
        if (e.key === 'Escape') this._cancelPivotSelect()
        if (e.key === '1') { this._setPivotCandidateMode('vertex'); return }
        if (e.key === '2') { this._setPivotCandidateMode('edge');   return }
        if (e.key === '3') { this._setPivotCandidateMode('face');   return }
        return
      }
      switch (e.key) {
        case 'v': case 'V': this._startPivotSelect(); return
        case 'x': case 'X': this._setGrabAxis('x'); return
        case 'y': case 'Y': this._setGrabAxis('y'); return
        case 'z': case 'Z': this._setGrabAxis('z'); return
        case 's': case 'S': this._toggleStackMode(); return
        case 'Enter':        this._confirmGrab();    return
        case 'Escape':       this._cancelGrab();     return
        case '1': this._setSnapMode('vertex'); return
        case '2': this._setSnapMode('edge');   return
        case '3': this._setSnapMode('face');   return
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

    // ── Measure placement keys ─────────────────────────────────────────────
    if (this._measure.active) {
      if (e.key === 'Escape') { this._cancelMeasure(); return }
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

    // ── Face extrude keys (Edit Mode · 3D) ────────────────────────────────
    if (this._faceExtrude.active) {
      if (e.key === 'Enter')  { e.preventDefault(); this._confirmFaceExtrude(); return }
      if (e.key === 'Escape') { this._cancelFaceExtrude(); return }
      if ((e.key >= '0' && e.key <= '9') || e.key === '.') {
        this._faceExtrude.inputStr += e.key
        this._faceExtrude.hasInput  = true
        this._applyFaceExtrudeFromInput()
        this._updateFaceExtrudeStatus()
        return
      }
      if (e.key === '-' && this._faceExtrude.inputStr.length === 0) {
        this._faceExtrude.inputStr = '-'
        this._faceExtrude.hasInput = true
        this._updateFaceExtrudeStatus()
        return
      }
      if (e.key === 'Backspace') {
        this._faceExtrude.inputStr = this._faceExtrude.inputStr.slice(0, -1)
        this._faceExtrude.hasInput = this._faceExtrude.inputStr.length > 0 && this._faceExtrude.inputStr !== '-'
        this._applyFaceExtrudeFromInput()
        this._updateFaceExtrudeStatus()
        return
      }
      return
    }

    // ── Sub-element mode switching (Edit Mode · 3D only) ──────────────────
    if (this._scene.selectionMode === 'edit' && this._scene.editSubstate === '3d') {
      if (e.key === '1') { this._setEditSelectMode('vertex'); return }
      if (e.key === '2') { this._setEditSelectMode('edge');   return }
      if (e.key === '3') { this._setEditSelectMode('face');   return }
      if ((e.key === 'e' || e.key === 'E') && this._editSelectMode === 'face') {
        const selected = [...this._scene.editSelection].filter(x => x instanceof Face)
        if (selected.length > 0) this._startFaceExtrude(selected[0])
        return
      }
    }

    // ── Normal keys ────────────────────────────────────────────────────────
    if (e.key === 'Tab') {
      // Only prevent default when the mode transition will actually occur.
      // For ImportedMesh, setMode('edit') is a no-op — swallow the key only
      // when switching to object mode or when the active object is editable.
      const enteringEdit = this._scene.selectionMode === 'object'
      const isReadOnly = this._activeObj instanceof ImportedMesh || this._activeObj instanceof MeasureLine || this._activeObj instanceof CoordinateFrame
      if (!enteringEdit || !isReadOnly) {
        e.preventDefault()
        this.setMode(enteringEdit ? 'edit' : 'object')
      }
      return
    }
    if (e.key === 'n' || e.key === 'N') {
      this._toggleNPanel()
      return
    }

    if (this._scene.selectionMode === 'object') {
      // M: start measure placement
      if (e.key === 'm' || e.key === 'M') {
        this._startMeasurePlacement()
        return
      }
      // Shift+D: duplicate active object and immediately grab (Blender-style)
      if (e.key === 'D' && e.shiftKey && this._objSelected) {
        e.preventDefault()
        this._duplicateObject()
        return
      }
      // G: grab
      if ((e.key === 'g' || e.key === 'G') && this._objSelected) {
        this._startGrab()
        return
      }
      // R: rotate (CoordinateFrame only, ADR-019)
      if ((e.key === 'r' || e.key === 'R') && this._activeObj instanceof CoordinateFrame) {
        this._startRotate()
        return
      }
      // Shift+A: show Add menu
      if (e.key === 'A' && e.shiftKey) {
        e.preventDefault()
        const screenX = (this._mouse.x + 1) / 2 * innerWidth
        const screenY = (-this._mouse.y + 1) / 2 * innerHeight
        const canAddFrame = this._objSelected && !(this._activeObj instanceof MeasureLine) && !(this._activeObj instanceof ImportedMesh)
        this._uiView.showAddMenu(screenX, screenY,
          () => this._addObject('box'),
          () => this._addObject('sketch'),
          () => this._addObject('measure'),
          () => this._triggerStepImport(),
          canAddFrame ? () => this._addObject('frame') : undefined,
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

  // ── BFF + Node Editor initialisation (Phase B, ADR-017) ──────────────────

  /**
   * Initialises BFF connection and opens the WebSocket Geometry Service channel.
   * Called asynchronously from start() — non-blocking; app works without BFF.
   */
  async _initBff() {
    await this._service.connectBff()
    if (!this._service.bffConnected) return

    // Open WebSocket geometry channel
    this._service.openGeometryChannel()

    // Wire up Node Editor
    this._nodeEditorView = new NodeEditorView(document.body, this._service)
    this._uiView.onNodeEditorToggle(() => {
      const visible = this._nodeEditorView.toggle()
      // Visual feedback on header button
      const btn = this._uiView._nodeEditorBtn
      if (btn) btn.style.borderColor = visible ? '#3a7bd5' : '#3a3a3a'
    })
  }

  // ─── Animation loop ────────────────────────────────────────────────────────
  start() {
    const loop = () => {
      requestAnimationFrame(loop)
      this._sceneView.render()
      if (this._gizmoView) this._gizmoView.update()
      // Keep MeasureLine HTML labels positioned over the correct screen pixel
      for (const obj of this._scene.objects.values()) {
        if (obj instanceof MeasureLine) obj.meshView.updateLabelPosition()
      }
      // Sync CoordinateFrame positions every frame.
      //
      // Position model: worldPos = parentCentroid + translation
      //
      // Two paths:
      //  a) Frame is being grabbed → move() already updated _worldPos.
      //     Back-derive the new translation so the offset is preserved when
      //     the parent moves later.
      //  b) Frame is not grabbed  → recompute worldPos from parentCentroid +
      //     translation (frame follows parent).
      //
      // Either way, meshView.updatePosition(_worldPos) is called at the end.
      //
      // Frames are processed in topological order (parents before children)
      // so that nested frame chains (ADR-019) propagate correctly in one pass.
      const grabbedFrameIds = this._grab.active ? this._grab.allStartCorners : new Map()
      const allFrames = [...this._scene.objects.values()].filter(o => o instanceof CoordinateFrame)
      const depthCache = new Map()
      const getFrameDepth = (frame) => {
        if (depthCache.has(frame.id)) return depthCache.get(frame.id)
        const parent = this._scene.getObject(frame.parentId)
        const d = (parent instanceof CoordinateFrame) ? getFrameDepth(parent) + 1 : 0
        depthCache.set(frame.id, d)
        return d
      }
      allFrames.sort((a, b) => getFrameDepth(a) - getFrameDepth(b))

      for (const obj of allFrames) {
        const parent = this._scene.getObject(obj.parentId)
        if (!parent || parent.corners.length === 0) continue

        const parentCentroid = new THREE.Vector3()
        for (const c of parent.corners) parentCentroid.add(c)
        parentCentroid.divideScalar(parent.corners.length)

        if (grabbedFrameIds.has(obj.id)) {
          // (a) Grabbed: _worldPos already updated by move(). Sync translation.
          obj.translation.copy(obj._worldPos).sub(parentCentroid)
        } else {
          // (b) Not grabbed: follow parent, keep translation offset.
          obj._worldPos.copy(parentCentroid).add(obj.translation)
        }
        obj.meshView.updatePosition(obj._worldPos)
      }
    }
    loop()

    // Non-blocking BFF + Node Editor setup (Phase B)
    this._initBff().catch(err => {
      console.warn('[AppController] BFF init failed (offline mode):', err.message)
    })
  }
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/**
 * Returns 8 AABB corners for objects that don't have a `corners` property
 * (e.g. ImportedMesh). Falls back to empty array if bounding box is unavailable.
 * @param {object} obj  scene entity
 * @returns {THREE.Vector3[]}
 */
function _meshBboxCorners(obj) {
  const geo = obj.meshView?.cuboid?.geometry
  if (!geo) return []
  geo.computeBoundingBox()
  const box = geo.boundingBox
  if (!box || box.isEmpty()) return []
  const { min, max } = box
  return [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, max.z),
    new THREE.Vector3(min.x, max.y, max.z),
  ]
}
