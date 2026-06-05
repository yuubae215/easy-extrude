/**
 * FaceExtrudeHandler — manages E-key face extrusion in Edit Mode · 3D.
 *
 * Encapsulates all face-extrude state and the start/applyPreview/confirm/cancel
 * lifecycle. Snap-to-geometry is handled via trySnap().
 *
 * Owned by AppController as this._faceExtrudeHandler.
 * Accesses parent controller via this._ctrl.
 *
 * State machine: S_FACE_EXTRUDE ∈ AppController._opState.
 * Triggered by: E key (keyboard), tap on face (touch auto-start).
 */

import * as THREE from 'three'
import { Solid }                    from '../../domain/Solid.js'
import { S_FACE_EXTRUDE }           from '../../core/editorStates.js'
import { computeOutwardFaceNormal, collectSnapTargets } from '../../model/CuboidModel.js'

// Snap distance threshold in world units.
const SNAP_THRESHOLD = 0.15

export class FaceExtrudeHandler {
  /**
   * @param {import('../AppController.js').AppController} ctrl
   */
  constructor(ctrl) {
    this._ctrl = ctrl

    /**
     * All mutable face-extrude state — mirrors the old AppController._faceExtrude.
     * @type {object}
     */
    this.state = {
      /** @type {import('../../graph/Face.js').Face|null} The face being extruded. */
      face:          null,
      /** World-space face corner snapshots at drag start (for snap display). */
      savedCorners:  [],
      /** Body-frame face corner snapshots at drag start (for extrudeFace call). ADR-040 */
      savedLocalFaceCorners: [],
      /** World face normal — used for drag-plane dot product. @type {THREE.Vector3} */
      normal:        new THREE.Vector3(),
      /** Body-frame face normal — passed to Solid.extrudeFace(). @type {THREE.Vector3} */
      localNormal:   new THREE.Vector3(),
      /** Current signed extrusion distance (world units). */
      dist:          0,
      /** Drag plane aligned with the face normal; mouse ray intersects this. */
      dragPlane:     new THREE.Plane(),
      /** World-space drag start point (ray × dragPlane at operation start). */
      startPoint:    new THREE.Vector3(),
      /** Numeric distance string typed by the user; empty when mouse-driven. */
      inputStr:      '',
      /** True when the user has typed at least one digit. */
      hasInput:      false,
      /** True when the current dist is locked to a snap target. */
      snapping:      false,
      /** @type {{position: THREE.Vector3, type: string}|null} The locked snap target, or null. */
      snappedTarget: null,
      /** @type {{position: THREE.Vector3, type: string}[]} All snap candidates from last trySnap(). */
      snapTargets:   [],
    }
  }

  // ── Convenience getters ───────────────────────────────────────────────────

  get hasInput() { return this.state.hasInput }

  // ── Public operation lifecycle ────────────────────────────────────────────

  /**
   * Starts face extrude for the given face.
   * Initialises the drag plane, saves corner snapshots, collects snap targets.
   * @param {import('../../graph/Face.js').Face} face
   */
  start(face) {
    const { _ctrl: ctrl } = this
    const obj = ctrl._activeObj
    if (!(obj instanceof Solid)) return
    if (!ctrl._opState.send('BEGIN_FACE_EXTRUDE')) return

    const s = this.state
    s.face         = face
    s.dist         = 0
    s.inputStr     = ''
    s.hasInput     = false
    s.snapping     = false
    s.snappedTarget = null

    // Snapshot world-space face corners (for snap display centroid computation)
    s.savedCorners = face.vertices.map(v => v.position.clone())

    // Snapshot body-frame face corners (ADR-040: Solid mutation uses localCorners)
    const vIdx = face.vertices.map(v => obj.vertices.indexOf(v))
    s.savedLocalFaceCorners = vIdx.map(i => obj.localCorners[i].clone())

    // Compute world face normal (for drag distance dot product)
    const worldNormal = computeOutwardFaceNormal(obj.corners, face.index)
    s.normal.copy(worldNormal)

    // Compute body-frame face normal (for Solid.extrudeFace)
    // Body-frame normal = worldNormal rotated by the inverse of Solid orientation
    const invQ = obj.orientation.clone().conjugate()
    s.localNormal.copy(worldNormal).applyQuaternion(invQ)

    // Drag plane: passes through the face center, normal = camera direction
    // projected onto the face normal plane (allows Z variation along normal).
    const faceCenter = s.savedCorners
      .reduce((a, c) => a.add(c), new THREE.Vector3())
      .divideScalar(s.savedCorners.length)
    const camDir = new THREE.Vector3()
    ctrl._camera.getWorldDirection(camDir)
    // Use a plane whose normal is perpendicular to both the face normal and camDir,
    // so that horizontal mouse movement maps cleanly to extrusion distance.
    // Fallback: if camDir is nearly parallel to face normal, use camDir directly.
    let planeNormal = new THREE.Vector3().crossVectors(s.normal, camDir).cross(s.normal)
    if (planeNormal.lengthSq() < 0.001) planeNormal = camDir.clone()
    else planeNormal.normalize()
    s.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, faceCenter)

    // Capture the ray intersection on drag plane as the start point
    ctrl._raycaster.setFromCamera(ctrl._mouse, ctrl._camera)
    const pt = new THREE.Vector3()
    if (ctrl._raycaster.ray.intersectPlane(s.dragPlane, pt)) {
      s.startPoint.copy(pt)
    } else {
      s.startPoint.copy(faceCenter)
    }

    // Collect snap targets from all other objects in the scene
    s.snapTargets = collectSnapTargets(ctrl._scene.objects, 'all', new Set([ctrl._scene.activeId]))

    ctrl._controls.enabled = false
    this.updateStatus()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Applies the current extrusion distance to the active Solid.
   * Uses the mouse-driven dist (state.dist) — not the typed input.
   */
  applyPreview() {
    const { _ctrl: ctrl } = this
    const s   = this.state
    const obj = ctrl._activeObj
    if (!ctrl._opState.is(S_FACE_EXTRUDE)) return
    if (!(obj instanceof Solid) || !s.face) return
    obj.extrudeFace(s.face, s.savedLocalFaceCorners, s.localNormal, s.dist)
    obj.meshView.updateGeometry(obj.corners)
    obj.meshView.updateBoxHelper()
  }

  /**
   * Applies the current extrusion distance from the typed input string.
   * Falls back to applyPreview() if the input is invalid.
   */
  applyFromInput() {
    const { _ctrl: ctrl } = this
    const s   = this.state
    const obj = ctrl._activeObj
    if (!ctrl._opState.is(S_FACE_EXTRUDE)) return
    if (!(obj instanceof Solid) || !s.face) return
    const parsed = parseFloat(s.inputStr)
    const dist   = isNaN(parsed) ? 0 : parsed
    obj.extrudeFace(s.face, s.savedLocalFaceCorners, s.localNormal, dist)
    obj.meshView.updateGeometry(obj.corners)
    obj.meshView.updateBoxHelper()
  }

  /**
   * Confirms the extrusion, records an undo command, and exits face-extrude mode.
   */
  confirm() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_FACE_EXTRUDE)) return
    const s   = this.state
    const obj = ctrl._activeObj

    // Apply final distance from input or mouse
    const dist = s.hasInput ? (parseFloat(s.inputStr) || 0) : s.dist

    if (obj instanceof Solid && s.face) {
      obj.extrudeFace(s.face, s.savedLocalFaceCorners, s.localNormal, dist)
      obj.meshView.updateGeometry(obj.corners)
      obj.meshView.updateBoxHelper()

      // Record undo snapshot — store corner delta as a post-hoc command
      const endCorners = obj.corners.map(c => c.clone())
      // Reconstruct start corners from savedLocalFaceCorners being at dist=0
      const startLocalCorners = [...obj.localCorners]  // current localCorners ARE the committed ones
      // Use a simple inline undo command: re-extrude with saved data
      const face              = s.face
      const savedLocalFC      = s.savedLocalFaceCorners.map(c => c.clone())
      const localNormal       = s.localNormal.clone()
      const commitDist        = dist
      const service           = ctrl._service
      const cmd = {
        label: 'Face Extrude',
        execute() {
          obj.extrudeFace(face, savedLocalFC, localNormal, commitDist)
          obj.meshView.updateGeometry(obj.corners)
          obj.meshView.updateBoxHelper()
          service.invalidateWorldPose(obj.id)
        },
        undo() {
          obj.extrudeFace(face, savedLocalFC, localNormal, 0)
          obj.meshView.updateGeometry(obj.corners)
          obj.meshView.updateBoxHelper()
          service.invalidateWorldPose(obj.id)
        },
      }
      ctrl._commandStack.push(cmd)
    }

    // Clear snap display
    if (ctrl._meshView) ctrl._meshView.clearSnapDisplay()

    this._resetState()
    ctrl._opState.send('CONFIRM')
    ctrl._controls.enabled = true
    ctrl._refreshObjectModeStatus()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Cancels the face extrusion, restoring the Solid to its pre-extrude shape.
   */
  cancel() {
    const { _ctrl: ctrl } = this
    if (!ctrl._opState.is(S_FACE_EXTRUDE)) return
    const s   = this.state
    const obj = ctrl._activeObj

    // Restore original shape by re-extruding at dist = 0
    if (obj instanceof Solid && s.face) {
      obj.extrudeFace(s.face, s.savedLocalFaceCorners, s.localNormal, 0)
      obj.meshView.updateGeometry(obj.corners)
      obj.meshView.updateBoxHelper()
    }

    // Clear snap display
    if (ctrl._meshView) ctrl._meshView.clearSnapDisplay()

    this._resetState()
    ctrl._opState.send('CANCEL')
    ctrl._controls.enabled = true
    ctrl._refreshObjectModeStatus()
    if (window.matchMedia('(pointer: coarse)').matches) ctrl._updateMobileToolbar()
  }

  /**
   * Updates the status bar text to reflect the current face-extrude operation.
   */
  updateStatus() {
    const { _ctrl: ctrl } = this
    const s = this.state
    const dist = s.hasInput ? (parseFloat(s.inputStr) || 0) : s.dist
    const parts = [{ text: 'Extrude Face', bold: true, color: '#ffffff' }]
    if (s.hasInput) {
      parts.push({ text: s.inputStr + '_', color: '#ffeb3b' })
    } else {
      parts.push({ text: `D: ${dist.toFixed(3)}`, color: '#ffeb3b' })
    }
    if (s.snapping && s.snappedTarget) {
      parts.push({ text: `Snapped: ${s.snappedTarget.type}`, color: '#69f0ae' })
    }
    parts.push({ text: 'Enter confirm  Esc cancel', color: '#444' })
    ctrl._uiView.setStatusRich(parts)
  }

  /**
   * Tries to snap `rawDist` to the nearest relevant snap target on the face normal axis.
   * Updates state.snapping and state.snappedTarget.
   * @param {number} rawDist  Unsnapped distance from startPoint along face normal
   * @returns {number}        Snapped (or unchanged) distance
   */
  trySnap(rawDist) {
    const { _ctrl: ctrl } = this
    const s   = this.state
    const obj = ctrl._activeObj
    if (!(obj instanceof Solid) || !s.face) return rawDist

    // Face center after applying rawDist
    const faceCenter = s.savedCorners
      .reduce((a, c) => a.add(c), new THREE.Vector3())
      .divideScalar(s.savedCorners.length)
    const projectedCenter = faceCenter.clone().addScaledVector(s.normal, rawDist)

    // Test each snap target: project its position onto the face normal axis
    // and check if the distance is within the snap threshold.
    let bestDist  = rawDist
    let bestSnap  = null
    let bestDelta = Infinity

    for (const t of s.snapTargets) {
      // Project the target onto the face normal: signed dist from face center
      const snappedDist = t.position.clone().sub(faceCenter).dot(s.normal)
      const screenDelta = Math.abs(snappedDist - rawDist)
      if (screenDelta < SNAP_THRESHOLD && screenDelta < bestDelta) {
        bestDelta = screenDelta
        bestDist  = snappedDist
        bestSnap  = t
      }
    }

    s.snapping     = bestSnap !== null
    s.snappedTarget = bestSnap
    return bestDist
  }

  // ── Private ──────────────────────────────────────────────────────────────

  _resetState() {
    const s = this.state
    s.face                  = null
    s.savedCorners          = []
    s.savedLocalFaceCorners = []
    s.normal.set(0, 0, 0)
    s.localNormal.set(0, 0, 0)
    s.dist                  = 0
    s.inputStr              = ''
    s.hasInput              = false
    s.snapping              = false
    s.snappedTarget         = null
    s.snapTargets           = []
  }
}
