/**
 * GizmoView - Blender-style world orientation gizmo (top-right corner)
 *
 * Renders X/Y/Z axis indicators on a 2D canvas overlay.
 * Clicking an axis dot flies the camera to that axis view.
 *
 * The camera change is NOT applied here directly. `_onClick` derives the
 * destination pose (position/target/up) and hands it to the `onRequestView`
 * callback, which AppController wires to `flyToView` — an interruptible,
 * eased, reduced-motion-aware `CameraFlight` (ADR-068). The gizmo used to
 * teleport the camera in a single frame, the one camera surface that bypassed
 * the app's motion system; routing through the callback removes the
 * disorienting "jump" and folds the gizmo into the same governance every
 * other camera move obeys (PHILOSOPHY #30 Tier A — a navigation affordance).
 * `_applyInstant` is the graceful fallback if no callback is wired, so a
 * dropped wiring degrades to the old instant snap, never a silent no-op (#11).
 *
 * Side effects: DOM canvas creation, event listeners.
 */
import * as THREE from 'three'
import { COLOR, Z, rgba } from '../theme/tokens.js'

const UP_Y = new THREE.Vector3(0, 1, 0)

// Positive-axis colours share the 3D scene axis tokens (COLOR.axisX/Y/Z) so the
// gizmo and the world axes read as the same colour system; the back-facing
// (negative) tip is a dimmed, translucent variant of the same hue.
const AXES = [
  { label: 'X', dir: new THREE.Vector3(1, 0, 0), color: COLOR.axisX, negColor: rgba(COLOR.axisX, 0.4) },
  { label: 'Y', dir: new THREE.Vector3(0, 1, 0), color: COLOR.axisY, negColor: rgba(COLOR.axisY, 0.4) },
  { label: 'Z', dir: new THREE.Vector3(0, 0, 1), color: COLOR.axisZ, negColor: rgba(COLOR.axisZ, 0.4) },
]

const SIZE    = 128
const HALF    = SIZE / 2
const ARM_LEN = 44
const DOT_R   = 9
const NEG_R   = 7

export class GizmoView {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
   */
  constructor(camera, controls) {
    this._camera   = camera
    this._controls = controls
    this._hovered  = null  // e.g. 'X+', 'Y-'
    this._lastKey      = null   // axis key of last snap, for toggle-back
    this._prevPose     = null   // { position, up } captured before the last snap
    this._requestView  = null   // (pose) => void — set by AppController.onRequestView

    this._canvas = document.createElement('canvas')
    this._canvas.width  = SIZE
    this._canvas.height = SIZE
    this._canvas.setAttribute('role', 'img')
    this._canvas.setAttribute('aria-label', 'World orientation gizmo: click an axis to snap the camera')
    Object.assign(this._canvas.style, {
      position:     'fixed',
      top:          '46px',
      right:        '16px',
      borderRadius: '50%',
      background:   'rgba(24, 24, 40, 0.55)',
      cursor:       'default',
      zIndex:       String(Z.gizmo),
      userSelect:   'none',
    })
    document.body.appendChild(this._canvas)

    this._ctx = this._canvas.getContext('2d')

    this._canvas.addEventListener('click',      e => this._onClick(e))
    this._canvas.addEventListener('mousemove',  e => this._onHover(e))
    this._canvas.addEventListener('mouseleave', () => { this._hovered = null; this.update() })
  }

  /** Adjusts the right offset to avoid overlapping the N panel */
  setRightOffset(px) {
    this._canvas.style.right = `${px}px`
  }

  /**
   * Register the camera-move sink. AppController wires this to `flyToView` so an
   * axis click becomes an interruptible eased flight (ADR-068) instead of the
   * instant snap. When unset, `_onClick` falls back to `_applyInstant`.
   * @param {(pose:{position:THREE.Vector3, target:THREE.Vector3, up:THREE.Vector3}) => void} fn
   */
  onRequestView(fn) {
    this._requestView = fn
  }

  // ── Projection ─────────────────────────────────────────────────────────────

  /** Projects world axes into canvas space using the camera's current rotation */
  _projectAxes() {
    const rot = new THREE.Matrix3().setFromMatrix4(this._camera.matrixWorldInverse)
    return AXES.map(a => {
      const v = a.dir.clone().applyMatrix3(rot)
      return {
        label:    a.label,
        color:    a.color,
        negColor: a.negColor,
        // positive tip
        px: HALF + v.x * ARM_LEN,
        py: HALF - v.y * ARM_LEN,
        // negative tip
        nx: HALF - v.x * ARM_LEN,
        ny: HALF + v.y * ARM_LEN,
        z: v.z,  // depth: positive = facing camera
      }
    })
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  update() {
    const ctx  = this._ctx
    const axes = this._projectAxes()

    ctx.clearRect(0, 0, SIZE, SIZE)

    // Build a flat render list (positive + negative for each axis)
    const items = []
    axes.forEach(a => {
      items.push({ key: a.label + '+', x: a.px, y: a.py, z:  a.z, label: a.label, color: a.color,    pos: true  })
      items.push({ key: a.label + '-', x: a.nx, y: a.ny, z: -a.z, label: '',       color: a.negColor, pos: false })
    })

    // Back-to-front sort so foreground axes overdraw background ones
    items.sort((a, b) => a.z - b.z)

    // 1. Draw all axis lines (center -> tip)
    items.forEach(it => {
      ctx.beginPath()
      ctx.moveTo(HALF, HALF)
      ctx.lineTo(it.x, it.y)
      ctx.strokeStyle = it.color
      ctx.lineWidth   = it.pos ? 2.5 : 1.8
      ctx.stroke()
    })

    // 2. Draw dot + label for each item (back-to-front)
    items.forEach(it => {
      const r         = it.pos ? DOT_R : NEG_R
      const isHovered = this._hovered === it.key

      ctx.beginPath()
      ctx.arc(it.x, it.y, r, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#ffffff' : it.color
      ctx.fill()

      if (it.pos) {
        ctx.fillStyle    = isHovered ? '#222' : '#fff'
        ctx.font         = `bold ${r + 1}px sans-serif`
        ctx.textAlign    = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(it.label, it.x, it.y)
      }
    })
  }

  // ── Hit testing ────────────────────────────────────────────────────────────

  _getHitKey(canvasX, canvasY) {
    const axes = this._projectAxes()
    let best     = null
    let bestDist = 12  // px hit radius

    axes.forEach(a => {
      const pd = Math.hypot(canvasX - a.px, canvasY - a.py)
      if (pd < bestDist) { bestDist = pd; best = a.label + '+' }
      const nd = Math.hypot(canvasX - a.nx, canvasY - a.ny)
      if (nd < bestDist) { bestDist = nd; best = a.label + '-' }
    })
    return best
  }

  _localCoords(e) {
    const rect = this._canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  _onHover(e) {
    const { x, y } = this._localCoords(e)
    const key = this._getHitKey(x, y)
    this._canvas.style.cursor = key ? 'pointer' : 'default'
    if (key !== this._hovered) {
      this._hovered = key
      this.update()
    }
  }

  _onClick(e) {
    const { x, y } = this._localCoords(e)
    const key = this._getHitKey(x, y)
    if (!key) return

    const target = this._controls.target.clone()
    const dist   = this._camera.position.distanceTo(target)

    // Toggle: clicking the same axis key a second time flies back to the
    // previous perspective view (position + up captured at the last snap).
    if (key === this._lastKey && this._prevPose) {
      const prev = this._prevPose
      this._lastKey  = null
      this._prevPose = null
      this._emitView({ position: prev.position.clone(), target, up: prev.up.clone() })
      return
    }

    // Save current camera state so the toggle can restore it
    this._prevPose = { position: this._camera.position.clone(), up: this._camera.up.clone() }
    this._lastKey  = key

    const pose = this._poseForKey(key, target, dist)
    if (!pose) { this._lastKey = null; this._prevPose = null; return }
    this._emitView(pose)
  }

  /**
   * Destination pose for an axis key. The up-vector and OrbitControls polar
   * axis must change together (see `_applyInstant`); this derives the desired
   * up so the applier (instant or flight) can enforce that pairing.
   * @returns {{position:THREE.Vector3, target:THREE.Vector3, up:THREE.Vector3}|null}
   */
  _poseForKey(key, target, dist) {
    const viewDirs = {
      'X+': new THREE.Vector3( 1,  0,  0),
      'X-': new THREE.Vector3(-1,  0,  0),
      'Y+': new THREE.Vector3( 0,  1,  0),
      'Y-': new THREE.Vector3( 0, -1,  0),
      'Z+': new THREE.Vector3( 0,  0,  1),
      'Z-': new THREE.Vector3( 0,  0, -1),
    }
    const dir = viewDirs[key]
    if (!dir) return null

    const position = target.clone().addScaledVector(dir, dist)

    // Z+/Z-: camera looks along ±Z, parallel to the world up (Z), so we declare
    // X as the "screen up" to escape the singularity, and nudge the camera off
    // the exact Z-axis (phi ≠ 90°) so OrbitControls stays stable. X±/Y±: the
    // camera sits at the equator of the Z-up sphere — keep Z up.
    let up
    if (key === 'Z+' || key === 'Z-') {
      position.y += 1e-4
      up = new THREE.Vector3(1, 0, 0)
    } else {
      up = new THREE.Vector3(0, 0, 1)  // ROS convention: +Z is up for horizontal views
    }
    return { position, target, up }
  }

  /** Route the pose to the eased flight if wired, else snap instantly. */
  _emitView(pose) {
    if (this._requestView) this._requestView(pose)
    else this._applyInstant(pose)
    this.update()
  }

  /**
   * Instant camera write — the graceful fallback when no flight sink is wired.
   * Sets position + up together and re-syncs OrbitControls' internal polar-axis
   * quat: OrbitControls computes `_quat = setFromUnitVectors(camera.up, Y)` once
   * and never recomputes it, so changing `camera.up` without syncing `_quat`
   * leaves the spherical coordinate system misaligned → gimbal lock on the next
   * drag. AppController.flyToView applies the identical orientation change, then
   * eases only the position/target.
   * @param {{position:THREE.Vector3, target:THREE.Vector3, up:THREE.Vector3}} pose
   */
  _applyInstant({ position, target, up }) {
    this._camera.position.copy(position)
    if (up) {
      this._camera.up.copy(up)
      this._controls._quat.setFromUnitVectors(up, UP_Y)
      this._controls._quatInverse.copy(this._controls._quat).invert()
    }
    this._camera.lookAt(target)
    this._controls.update()
  }
}
