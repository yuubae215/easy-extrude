// @ts-nocheck
import * as THREE from 'three'
import { DURATION } from '../theme/tokens.js'
import { easeOutCubic } from './MotionMath.js'
import { lerpVec } from './CameraMath.js'

/**
 * CameraFlight — the interruptible fly-to-selection / frame transient (ADR-068).
 *
 * The sibling of `BootReveal`: where BootReveal composes offsets around a fixed
 * target to open a session, CameraFlight eases BOTH the camera position AND the
 * OrbitControls target from a captured start pose to a full end pose (computed
 * once via the shared `CameraMath.focusPose` derivation). It is Tier D delight
 * over navigation — a smooth journey where the app used to jump — spawned
 * EXCLUSIVELY through `MotionGovernor.spawn`, which supplies the reduced-motion
 * read from the single boundary. Under reduced motion the flight never starts:
 * the camera simply IS the end pose (the static terminal cue, PHILOSOPHY #30).
 *
 * OrbitControls has `enableDamping = false` and `update()` is not called in the
 * animate loop, so writing `camera.position`/`controls.target` each frame is
 * safe — exactly the seam BootReveal relies on. On arrival the flight calls
 * `controls.update()` once so the next user orbit pivots around the new target.
 *
 * INTERRUPTION CONTRACT (the user always wins — identical to BootReveal):
 *   - `finish()` — called by AppController on the first canvas pointerdown /
 *     wheel — snaps to the end pose immediately.
 *   - external-write guard: if anything else moved the camera since our last
 *     write (a fresh fitCameraToSphere, a scene load), the flight abandons
 *     itself WITHOUT restoring — the external writer owns the camera. The same
 *     guard makes budget eviction (`dispose()` mid-flight) safe.
 */
export class CameraFlight {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {import('three/addons/controls/OrbitControls.js').OrbitControls} controls
   * @param {{position:{x,y,z}, target:{x,y,z}, near?:number, far?:number}} end
   *   the destination pose (from `SceneView.focusPose`)
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(camera, controls, end, { reduced = false } = {}) {
    this._camera   = camera
    this._controls = controls
    this._end      = end
    this._duration = DURATION.cameraFocus / 1000
    this._start    = null
    this._from     = { pos: camera.position.clone(), tgt: controls.target.clone() }
    this._done     = false
    this._lastWritten = null

    if (reduced) { this._done = true; this._land() }   // static cue: end pose only
    else this._lastWritten = this._apply(0)
  }

  /** Expand clip planes for the destination distance, sync controls, land exactly. */
  _land() {
    const e = this._end
    this._camera.position.set(e.position.x, e.position.y, e.position.z)
    this._controls.target.set(e.target.x, e.target.y, e.target.z)
    if (Number.isFinite(e.near)) this._camera.near = e.near
    if (Number.isFinite(e.far))  this._camera.far  = Math.max(this._camera.far, e.far)
    this._camera.updateProjectionMatrix()
    this._controls.update()
  }

  /** Write one eased frame; returns the camera position written (for the guard). */
  _apply(p) {
    const e = easeOutCubic(p)
    const pos = lerpVec(this._from.pos, this._end.position, e)
    const tgt = lerpVec(this._from.tgt, this._end.target, e)
    this._camera.position.set(pos.x, pos.y, pos.z)
    this._controls.target.set(tgt.x, tgt.y, tgt.z)
    return this._camera.position.clone()
  }

  /** True while the flight is still animating the camera. */
  get active() { return !this._done }

  /** Snap to the end pose now (user input pre-empts the flight). */
  finish() {
    if (this._done) return
    this._done = true
    if (this._cameraStolen()) return
    this._land()
  }

  /** Someone else wrote the camera since our last frame — they own it now. */
  _cameraStolen() {
    if (!this._lastWritten) return false
    const tol = Math.max(this._end.position.x, this._end.position.y, this._end.position.z, 1) * 1e-4
    return this._camera.position.distanceToSquared(this._lastWritten) > tol * tol
  }

  /**
   * @param {number} t loop-clock seconds
   * @returns {boolean} done
   */
  tick(t) {
    if (this._done) return true
    if (this._cameraStolen()) { this._done = true; return true }
    if (this._start === null) this._start = t
    const p = (t - this._start) / this._duration
    if (p >= 1) { this._done = true; this._land(); return true }
    this._lastWritten = this._apply(p)
    return false
  }

  /** Governor teardown (natural end or budget eviction) = finish. */
  dispose() { this.finish() }
}
