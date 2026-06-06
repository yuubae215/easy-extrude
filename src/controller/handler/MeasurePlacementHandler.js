/**
 * MeasurePlacementHandler — manages M-key / Add→Measure placement flow.
 *
 * Encapsulates all measure placement state and the start/confirmPoint/cancel
 * lifecycle for the two-phase MeasureLine creation (click p1, click p2).
 *
 * Owned by AppController as this._measureHandler.
 * Accesses parent controller via this._ctrl.
 */

import * as THREE from 'three'
import { MeasureLine }     from '../../domain/MeasureLine.js'
import { CoordinateFrame } from '../../domain/CoordinateFrame.js'
import { collectSnapTargets } from '../../model/CuboidModel.js'
import { S_MEASURE_PLACING } from '../../core/editorStates.js'
import { pickBestSnapTarget } from '../snap/SnapSystem.js'

export class MeasurePlacementHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /**
     * All mutable measure placement state — mirrored from AppController._measure.
     * AppController._measure must point to this.state after construction.
     * @type {object}
     */
    this.state = {
      /** @type {import('three').Vector3|null} fixed first endpoint */
      p1:            null,
      /** @type {import('three').Vector3|null} live cursor position (snapped) */
      p2:            null,
      /** @type {{label:string, position:import('three').Vector3, type:string, objectId:string, elementId:string}[]} */
      snapTargets:   [],
      snapping:      false,
      /** @type {{label:string, position:import('three').Vector3, type:string, objectId:string, elementId:string}|null} */
      snappedTarget: null,
      /** Anchor reference captured when p1 was confirmed (ADR-028).
       *  @type {{ objectId:string, type:string, elementId:string }|null} */
      p1Anchor:      null,
      /** Three.js Line for preview before entity is created */
      previewLine:   null,
      /** True while the user is holding a pointer down to snap a point */
      pressing:      false,
      /** MeshView used for snap candidate display (may differ from _meshView when active obj is MeasureLine) */
      snapMeshView:  null,
    }
  }

  // ── Public operation lifecycle ─────────────────────────────────────────────

  /**
   * Enters measure placement mode: click p1, then p2 to create a MeasureLine.
   * Exits edit mode if active, disables orbit on touch devices.
   */
  start() {
    const { _ctrl: ctrl } = this
    if (ctrl._scene.selectionMode === 'edit') ctrl.setMode('object')
    ctrl._opState.send('BEGIN_MEASURE')
    const s = this.state
    s.p1            = null
    s.p2            = null
    s.p1Anchor      = null
    s.snapTargets   = []
    s.snapping      = false
    s.snappedTarget = null
    // Snap display requires a MeshView with THREE.Points infrastructure.
    // MeasureLineView and CoordinateFrameView have no snap display infrastructure.
    // Fall back to any real MeshView-backed object for snap candidate rendering.
    const activeObj = ctrl._scene.activeObject
    const _isSnapCapable = o => !(o instanceof MeasureLine) && !(o instanceof CoordinateFrame)
    s.snapMeshView = (activeObj && _isSnapCapable(activeObj))
      ? activeObj.meshView
      : ([...ctrl._scene.objects.values()].find(_isSnapCapable)?.meshView ?? null)
    // On touch devices, disable orbit so single-finger touch places measure
    // points instead of orbiting the camera.  Use (pointer: coarse) rather
    // than innerWidth so that tablets and landscape phones are also covered.
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._controls.enabled = false
    ctrl._uiView.setCursor('crosshair')
    this.updateStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Cancels measure placement and restores normal view state.
   */
  cancel() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_MEASURE_PLACING)) return
    const s = this.state
    s.p1            = null
    s.p2            = null
    s.p1Anchor      = null
    s.snapping      = false
    s.snappedTarget = null
    s.snapTargets   = []
    s.pressing      = false
    if (s.previewLine) {
      ctrl._sceneView.scene.remove(s.previewLine)
      s.previewLine.geometry.dispose()
      s.previewLine.material.dispose()
      s.previewLine = null
    }
    s.snapMeshView?.clearSnapDisplay()
    s.snapMeshView = null
    ctrl._opState.send('CANCEL')
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._controls.enabled = true
    ctrl._uiView.setCursor('default')
    ctrl._refreshObjectModeStatus()
    ctrl._updateMobileToolbar()
  }

  /**
   * Confirms the current snapped cursor position as a measure point.
   * Phase 1: sets p1. Phase 2: creates the MeasureLine entity.
   * Called from _onPointerUp so mobile users can hold-to-snap before releasing.
   */
  confirmPoint() {
    const { _ctrl: ctrl } = this
    const s  = this.state
    const pt = this.pickPoint()
    if (!pt) return
    if (!s.p1) {
      // Phase 1 → Phase 2: record start point and its anchor (ADR-028)
      s.p1 = pt.clone()
      const t = s.snappedTarget
      s.p1Anchor = (t?.objectId && t?.elementId)
        ? { objectId: t.objectId, type: t.type, elementId: t.elementId }
        : null
      this.updateStatus()
    } else {
      // Phase 2: record end point → create entity
      const p2 = pt.clone()
      // Capture anchor refs before clearing state (ADR-028)
      const t2       = s.snappedTarget
      const p2Anchor = (t2?.objectId && t2?.elementId)
        ? { objectId: t2.objectId, type: t2.type, elementId: t2.elementId }
        : null
      const p1Anchor = s.p1Anchor
      if (s.previewLine) {
        ctrl._sceneView.scene.remove(s.previewLine)
        s.previewLine.geometry.dispose()
        s.previewLine.material.dispose()
        s.previewLine = null
      }
      s.snapMeshView?.clearSnapDisplay()
      s.snapMeshView  = null
      ctrl._opState.send('CONFIRM')
      const p1            = s.p1
      s.p1            = null
      s.p2            = null
      s.p1Anchor      = null
      s.snapTargets   = []
      s.snapping      = false
      s.snappedTarget = null
      const obj = ctrl._service.createMeasureLine(
        p1, p2,
        ctrl._camera,
        ctrl._sceneView.renderer,
        document.body,
        { p1: p1Anchor, p2: p2Anchor },
      )
      ctrl._switchActiveObject(obj.id, true)
      if (window.matchMedia('(pointer: coarse)').matches) ctrl._controls.enabled = true
      ctrl._uiView.setCursor('default')
      ctrl._refreshObjectModeStatus()
      ctrl._updateMobileToolbar()
    }
  }

  /**
   * Updates the status bar text to reflect the current measure placement phase.
   */
  updateStatus() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_MEASURE_PLACING)) return
    const s = this.state
    if (!s.p1) {
      ctrl._uiView.setStatusRich([
        { text: 'Measure', bold: true, color: '#f9a825' },
        { text: 'Click to set start point', color: '#888' },
        { text: 'ESC cancel', color: '#444' },
      ])
    } else {
      const parts = [
        { text: 'Measure', bold: true, color: '#f9a825' },
        { text: 'Click to set end point', color: '#888' },
      ]
      if (s.p2) {
        const d = s.p1.distanceTo(s.p2)
        const f = d < 1 ? `${(d * 100).toFixed(1)} cm` : `${d.toFixed(3)} m`
        parts.push({ text: f, bold: true, color: '#f9a825' })
      }
      if (s.snapping && s.snappedTarget) {
        parts.push({ text: `Snap: ${s.snappedTarget.label}`, color: '#ff9800' })
      }
      parts.push({ text: 'ESC cancel', color: '#444' })
      ctrl._uiView.setStatusRich(parts)
    }
  }

  /**
   * Finds the nearest V/E/F snap target to the current mouse cursor.
   * Returns the snapped world position (or ground-plane fallback).
   * Also updates this.state.snapping / snappedTarget / snapTargets.
   * @returns {import('three').Vector3|null}
   */
  pickPoint() {
    const { _ctrl: ctrl } = this
    const s  = this.state
    const mx = (ctrl._mouse.x + 1) / 2 * innerWidth
    const my = (-ctrl._mouse.y + 1) / 2 * innerHeight

    const targets = collectSnapTargets(ctrl._scene.objects, 'all')
    s.snapTargets = targets

    const bestTarget = pickBestSnapTarget(targets, mx, my, ctrl._camera)

    if (bestTarget) {
      s.snapping      = true
      s.snappedTarget = bestTarget
      return bestTarget.position.clone()
    }

    // Fallback: intersect ground plane (Z=0)
    s.snapping      = false
    s.snappedTarget = null
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const pt = new THREE.Vector3()
    if (ctrl._raycaster.ray.intersectPlane(ctrl._groundPlane, pt)) return pt
    return null
  }

  /**
   * Builds or updates the dashed preview line shown during measure placement phase 2.
   * @param {import('three').Vector3} p1
   * @param {import('three').Vector3} p2
   */
  updatePreview(p1, p2) {
    const { _ctrl: ctrl } = this
    const s   = this.state
    const pts = [p1.x, p1.y, p1.z, p2.x, p2.y, p2.z]
    if (!s.previewLine) {
      const geo = new THREE.BufferGeometry()
      const mat = new THREE.LineDashedMaterial({
        color: 0xf9a825, dashSize: 0.15, gapSize: 0.08, depthTest: false,
      })
      s.previewLine = new THREE.Line(geo, mat)
      s.previewLine.renderOrder = 1
      ctrl._sceneView.scene.add(s.previewLine)
    }
    const geo = s.previewLine.geometry
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    geo.attributes.position.needsUpdate = true
    s.previewLine.computeLineDistances()
  }
}
