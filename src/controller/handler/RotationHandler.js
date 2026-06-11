/**
 * RotationHandler — manages R-key CoordinateFrame / Solid rotation.
 *
 * Encapsulates all rotation state and the start/apply/confirm/cancel lifecycle
 * for both CoordinateFrame (quaternion-based) and Solid (ADR-040 corner-baking).
 *
 * Owned by AppController as this._rotateHandler.
 * Accesses parent controller via this._ctrl.
 */

import * as THREE from 'three'
import { CoordinateFrame } from '../../domain/CoordinateFrame.js'
import { Solid }           from '../../domain/Solid.js'
import { RoleService }     from '../../service/RoleService.js'
import { createFrameRotateCommand }  from '../../command/FrameRotateCommand.js'
import { createSolidRotateCommand }  from '../../command/SolidRotateCommand.js'
import { S_ROTATE_ACTIVE } from '../../core/editorStates.js'

export class RotationHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /**
     * All mutable rotation state — accessed externally via .state or getters.
     * @type {object}
     */
    this.state = {
      /** World-space axis to rotate around: null = view-space Z, 'x'|'y'|'z' = world axes. */
      axis:       null,
      /** Screen-angle (radians) from projected pivot to mouse at start. */
      startAngle: 0,
      /** Saved rotation quaternion at the moment rotation begins (CoordinateFrame only). */
      startRot:   new THREE.Quaternion(),
      /** Numeric degree string typed by the user; empty when mouse-driven. */
      inputStr:   '',
      /** True when the user has typed at least one digit. */
      hasInput:   false,
      /** Degree increment for Ctrl snap. Cycled with Ctrl+Wheel. */
      stepSize:   1,
      /** True when startAngle should be captured from the next pointer position (mobile). */
      needsStartAngle:      false,
      /** Per-segment start angle; equals startAngle on PC (single drag). */
      segmentStartAngle:    0,
      /** Angle from pivot to cursor at the previous frame; used for incremental accumulation. */
      prevCurrentAngle:     0,
      /** Accumulated signed rotation (radians) for the current drag segment. */
      accumulatedAngle:     0,
      /** Per-segment quaternion for CoordinateFrame; equals startRot on PC. */
      segmentStartRot:      new THREE.Quaternion(),
      /** Solid orientation snapshot at rotate start — for undo. @type {import('three').Quaternion|null} */
      startOrientation:    null,
      /** Solid _position snapshot at rotate start — for undo. @type {import('three').Vector3|null} */
      startPos:            null,
      /** Solid orientation snapshot at segment start. @type {import('three').Quaternion|null} */
      segStartOrientation: null,
      /** Solid _position snapshot at segment start. @type {import('three').Vector3|null} */
      segStartPos:         null,
      /** Centroid of solid corners at segment start — rotation pivot + screen projection. @type {import('three').Vector3|null} */
      segStartPivot:       null,
      /** Display angle (radians) from last apply(); used by updateStatus(). */
      displayAngle:        0,
    }
  }

  /** Angle step sizes (degrees) cycled by Ctrl+Wheel during rotate. */
  static get ANGLE_STEPS() { return [1, 5, 10, 15, 22.5, 45, 90] }

  // ── Convenience getters (used by AppController toolbars / wheel handler) ───

  get axis()       { return this.state.axis }
  get stepSize()   { return this.state.stepSize }
  set stepSize(v)  { this.state.stepSize = v }

  /**
   * Cycles the Ctrl-snap angle step through ANGLE_STEPS (Ctrl+Wheel during rotate).
   * @param {number} deltaY  Wheel delta — positive = coarser step, negative = finer.
   */
  cycleStepSize(deltaY) {
    const steps = RotationHandler.ANGLE_STEPS
    const cur   = steps.indexOf(this.state.stepSize)
    const idx   = cur >= 0 ? cur : Math.max(steps.findIndex(s => s >= this.state.stepSize), 0)
    const next  = deltaY > 0
      ? Math.min(idx + 1, steps.length - 1)
      : Math.max(idx - 1, 0)
    this.state.stepSize = steps[next]
    this.apply()
    this.updateStatus()
  }

  // ── Public operation lifecycle ─────────────────────────────────────────────

  /**
   * Centralised guard for any UI rotation entry point.
   * Returns true and shows a toast when the frame must not be rotated because
   * it is part of a fixed-joint source chain.
   *
   * @param {import('../../domain/CoordinateFrame.js').CoordinateFrame} frame
   * @returns {boolean} true = blocked (caller should return early)
   */
  isFastenedRotationBlocked(frame) {
    if (!this._ctrl._service.isInFixedJointSourceChain(frame.id)) return false
    this._ctrl._uiView.showToast(
      'This frame is part of a fixed-joint constraint chain. Unfasten it first to rotate it independently.',
      { type: 'warn' },
    )
    return true
  }

  /**
   * Starts rotate mode for the active CoordinateFrame or Solid.
   * @param {boolean} [deferStartAngle=false] Mobile: capture start angle on first touch
   */
  start(deferStartAngle = false) {
    const { _ctrl: ctrl } = this
    const obj = ctrl._activeObj
    if (!(obj instanceof CoordinateFrame) && !(obj instanceof Solid)) return

    // Domain guards with user feedback — run before state transition
    if (obj instanceof CoordinateFrame) {
      if (!RoleService.canEdit(obj)) {
        ctrl._uiView.showToast(`This frame was declared by a ${obj.declaredBy}. Switch to that role to edit it.`, { type: 'warn' })
        return
      }
      if (this.isFastenedRotationBlocked(obj)) return
    } else {
      if (ctrl._service.hasFastenedChild(obj.id)) {
        ctrl._uiView.showToast('This object is held by a fastened constraint. Unfasten it first to move it independently.', { type: 'warn' })
        return
      }
    }

    if (!ctrl._opState.send('BEGIN_ROTATE')) return

    const s = this.state
    s.axis     = null
    s.inputStr = ''
    s.hasInput = false

    let projected
    if (obj instanceof CoordinateFrame) {
      s.startRot.copy(obj.rotation)
      s.segmentStartRot.copy(obj.rotation)
      projected = (ctrl._service.worldPoseOf(obj.id)?.position ?? obj.translation).clone().project(ctrl._camera)
    } else {
      s.startOrientation    = obj.orientation.clone()
      s.startPos            = obj._position.clone()
      s.segStartOrientation = obj.orientation.clone()
      s.segStartPos         = obj._position.clone()
      const pivot = obj._position.clone()
      s.segStartPivot       = pivot.clone()
      projected = pivot.clone().project(ctrl._camera)
      obj.meshView.boxHelper.visible = false
    }

    if (deferStartAngle) {
      s.needsStartAngle   = true
      s.startAngle        = 0
      s.segmentStartAngle = 0
      s.prevCurrentAngle  = 0
      s.accumulatedAngle  = 0
    } else {
      s.startAngle = Math.atan2(
        ctrl._mouse.y - projected.y,
        ctrl._mouse.x - projected.x,
      )
      s.segmentStartAngle = s.startAngle
      s.prevCurrentAngle  = s.startAngle
      s.accumulatedAngle  = 0
      s.needsStartAngle   = false
    }

    this.refreshSectorPreview()
    ctrl._controls.enabled = false
    this.updateStatus()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Confirms the current rotation and exits rotate mode.
   */
  confirm() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_ROTATE_ACTIVE)) return
    this.apply()
    const s = this.state

    if (ctrl._activeObj instanceof CoordinateFrame) {
      const frame = ctrl._activeObj
      const endQuat = frame.rotation.clone()
      if (!endQuat.equals(s.startRot)) {
        const cmd = createFrameRotateCommand(
          frame, s.startRot.clone(), endQuat, ctrl._service,
          () => ctrl._updateNPanel(),
        )
        ctrl._commandStack.push(cmd)
      }
    } else if (ctrl._activeObj instanceof Solid && s.startOrientation) {
      const solid = ctrl._activeObj
      if (!solid.orientation.equals(s.startOrientation)) {
        const cmd = createSolidRotateCommand(
          solid,
          s.startOrientation.clone(), solid.orientation.clone(),
          s.startPos.clone(),         solid._position.clone(),
          ctrl._service, () => ctrl._updateNPanel(),
        )
        ctrl._commandStack.push(cmd)
      }
    }

    if (ctrl._activeObj instanceof Solid) ctrl._activeObj.meshView.setObjectSelected(true)
    this._resetState()
    ctrl._rotateSectorPreview.hide()
    ctrl._opState.send('CONFIRM')
    ctrl._controls.enabled = true
    ctrl._refreshObjectModeStatus()
    ctrl._updateNPanel()
    ctrl._hideAxisGuide()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Cancels the rotation, restoring the object to its saved state.
   */
  cancel() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_ROTATE_ACTIVE)) return
    const s   = this.state
    const obj = ctrl._activeObj
    if (obj instanceof CoordinateFrame) {
      obj.rotation.copy(s.startRot)
      const parentWorldQuat = ctrl._service._getParentWorldQuat(obj)
      obj.meshView.updateRotation(parentWorldQuat.clone().multiply(obj.rotation))
    } else if (obj instanceof Solid && s.startOrientation) {
      obj.restorePose(s.startPos, s.startOrientation)
      obj.meshView.updateGeometry(obj.corners)
      obj.meshView.setObjectSelected(true)
    }
    this._resetState()
    ctrl._rotateSectorPreview.hide()
    ctrl._opState.send('CANCEL')
    ctrl._controls.enabled = true
    ctrl._hideAxisGuide()
    ctrl._refreshObjectModeStatus()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Sets the world-axis constraint for the current rotation.
   * Toggling the same axis clears the constraint (free rotation).
   * @param {'x'|'y'|'z'} axis
   */
  setAxis(axis) {
    const { _ctrl: ctrl } = this
    const s  = this.state
    s.axis     = (s.axis === axis) ? null : axis
    s.inputStr = ''
    s.hasInput = false
    const obj  = ctrl._activeObj

    // Re-snapshot current orientation/pivot as new segment start so accumulated
    // rotation from the prior axis constraint is preserved (mirrors _setGrabAxis()
    // segmentStart re-snapshot pattern).
    if (obj instanceof CoordinateFrame) {
      s.segmentStartRot.copy(obj.rotation)
    } else if (obj instanceof Solid) {
      s.segStartOrientation = obj.orientation.clone()
      s.segStartPos         = obj._position.clone()
      s.segStartPivot       = obj._position.clone()
    }

    let projected
    let rotCenter = null
    if (obj instanceof CoordinateFrame) {
      rotCenter = ctrl._service.worldPoseOf(obj.id)?.position ?? obj.translation
      projected = rotCenter.clone().project(ctrl._camera)
    } else if (obj instanceof Solid && s.segStartPivot) {
      rotCenter = s.segStartPivot
      projected = rotCenter.clone().project(ctrl._camera)
    }
    if (projected) {
      s.startAngle = Math.atan2(
        ctrl._mouse.y - projected.y,
        ctrl._mouse.x - projected.x,
      )
    }
    s.segmentStartAngle = s.startAngle
    s.prevCurrentAngle  = s.startAngle
    s.accumulatedAngle  = 0
    s.displayAngle      = 0

    if (s.axis && rotCenter) {
      ctrl._showAxisGuide(s.axis, rotCenter.clone(), 'rotate')
    } else {
      ctrl._hideAxisGuide()
    }
    this.refreshSectorPreview()
    this.apply()
    this.updateStatus()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Applies the current rotation delta to the active CoordinateFrame or Solid.
   * Called on every pointer move and on numeric input changes.
   */
  apply() {
    const { _ctrl: ctrl } = this
    const s   = this.state
    const obj = ctrl._activeObj
    if (!ctrl._opState.is(S_ROTATE_ACTIVE)) return
    if (!(obj instanceof CoordinateFrame) && !(obj instanceof Solid)) return

    let angle
    if (s.hasInput) {
      const parsed = parseFloat(s.inputStr)
      angle = isNaN(parsed) ? 0 : parsed * (Math.PI / 180)
    } else {
      let pivotScreen
      if (obj instanceof CoordinateFrame) {
        pivotScreen = (ctrl._service.worldPoseOf(obj.id)?.position ?? obj.translation).clone().project(ctrl._camera)
      } else {
        pivotScreen = (s.segStartPivot ?? obj._position.clone()).clone().project(ctrl._camera)
      }
      const currentAngle = Math.atan2(
        ctrl._mouse.y - pivotScreen.y,
        ctrl._mouse.x - pivotScreen.x,
      )
      if (s.needsStartAngle) {
        s.prevCurrentAngle = currentAngle
        s.accumulatedAngle = 0
        s.needsStartAngle  = false
        return
      }
      let delta = currentAngle - s.prevCurrentAngle
      if (delta > Math.PI)  delta -= 2 * Math.PI
      if (delta < -Math.PI) delta += 2 * Math.PI
      s.accumulatedAngle += delta
      s.prevCurrentAngle  = currentAngle
      angle = s.accumulatedAngle
      if (ctrl._ctrlHeld) {
        const stepRad = s.stepSize * (Math.PI / 180)
        angle = Math.round(angle / stepRad) * stepRad
      }
    }

    let axisVec
    if (s.axis === 'x') axisVec = new THREE.Vector3(1, 0, 0)
    else if (s.axis === 'y') axisVec = new THREE.Vector3(0, 1, 0)
    else if (s.axis === 'z') axisVec = new THREE.Vector3(0, 0, 1)
    else {
      axisVec = new THREE.Vector3()
      ctrl._camera.getWorldDirection(axisVec).negate()
    }

    // Sign correction for pointer-driven axis-constrained rotation (see CODE_CONTRACTS).
    if (!s.hasInput && s.axis) {
      const camFwd = new THREE.Vector3()
      ctrl._camera.getWorldDirection(camFwd)
      if (camFwd.dot(axisVec) > 0) angle = -angle
    }

    const deltaQ = new THREE.Quaternion().setFromAxisAngle(axisVec, angle)
    ctrl._service.applyPreviewRotation(obj, {
      segStartOrientation: obj instanceof CoordinateFrame
        ? s.segmentStartRot
        : s.segStartOrientation,
      segStartPos: s.segStartPos,
      pivot: s.segStartPivot ?? obj._position.clone(),
    }, deltaQ)
    s.displayAngle = angle
    this.updateStatus()
    ctrl._rotateSectorPreview.updateAngle(angle)
  }

  /**
   * (Re)creates the 3D sector preview at the pivot with the current axis orientation.
   */
  refreshSectorPreview() {
    const { _ctrl: ctrl } = this
    const obj = ctrl._activeObj
    if (!obj) return
    const s = this.state

    let center, radius
    if (obj instanceof Solid) {
      center = (s.segStartPivot ?? obj._position).clone()
      const raw = Math.max(...obj.corners.map(c => c.distanceTo(center)))
      radius = Math.max(raw, 0.5) * 1.1
    } else if (obj instanceof CoordinateFrame) {
      center = (ctrl._service.worldPoseOf(obj.id)?.position ?? obj.translation).clone()
      radius = 0.8
    } else {
      return
    }

    ctrl._rotateSectorPreview.show(center, radius, s.axis, ctrl._camera)
  }

  /**
   * Updates the status bar text to reflect the current rotate operation.
   */
  updateStatus() {
    const { _ctrl: ctrl } = this
    const s = this.state
    const AXIS_COLORS = { x: '#e05252', y: '#6ab04c', z: '#4a9eed' }
    const parts = [{ text: 'Rotate', bold: true, color: '#80b3ff' }]

    if (s.axis) {
      parts.push({ text: s.axis.toUpperCase(), bold: true, color: AXIS_COLORS[s.axis] })
    }
    if (s.hasInput) {
      parts.push({ text: s.inputStr + '°_', color: '#ffeb3b' })
    } else {
      const deg = (s.displayAngle * 180 / Math.PI).toFixed(1)
      parts.push({ text: `${deg}°`, color: '#546e7a' })
      if (ctrl._ctrlHeld) {
        parts.push({ text: `Step: ${s.stepSize}°`, bold: true, color: '#80cbc4' })
        parts.push({ text: 'Scroll to change', color: '#444' })
      }
    }
    parts.push({ text: 'Enter confirm  Esc cancel', color: '#444' })
    ctrl._uiView.setStatusRich(parts)
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  _resetState() {
    const s = this.state
    s.axis                = null
    s.inputStr            = ''
    s.hasInput            = false
    s.startOrientation    = null
    s.startPos            = null
    s.segStartOrientation = null
    s.segStartPos         = null
    s.segStartPivot       = null
    s.needsStartAngle     = false
  }
}
