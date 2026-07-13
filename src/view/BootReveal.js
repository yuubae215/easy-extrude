// @ts-nocheck
import * as THREE from 'three'
import { DURATION } from '../theme/tokens.js'
import { flightFrame } from './StageMath.js'

const _Z_UP = new THREE.Vector3(0, 0, 1)

/**
 * BootReveal — the one-shot camera fly-in that opens a session (ADR-067;
 * Tier D "delight" under PHILOSOPHY #30/ADR-066: it marks a real, rare
 * occasion — the app opening — and says nothing propositional). The camera
 * starts pulled back, high, and swung around world +Z, then composes down
 * onto the UNTOUCHED default pose: `flightFrame` is machine-tested to land
 * exactly on identity, so the classic boot framing is preserved to the bit.
 *
 * RippleEffect lineage (`tick(t) → done`, `dispose()`), spawned exclusively
 * through `MotionGovernor.spawn` — the governor supplies the reduced-motion
 * read from the single boundary. Under reduced motion the flight never
 * starts: the camera simply IS the final pose (the static terminal cue, same
 * discipline as the Phase 5 ghost choreography).
 *
 * INTERRUPTION CONTRACT (the user always wins):
 *   - `finish()` — called by AppController on the first canvas pointerdown /
 *     wheel and on a context load — snaps to the final pose immediately.
 *   - external-write guard: if anything else moved the camera since our last
 *     write (fitCameraToSphere, a scene load), the flight abandons itself
 *     WITHOUT restoring — the external writer owns the camera now. The same
 *     guard makes budget eviction (`dispose()` mid-flight) safe.
 */
export class BootReveal {
  /**
   * @param {THREE.PerspectiveCamera} camera the perspective camera at its
   *   final boot pose (SceneView constructor has already placed it)
   * @param {THREE.Vector3} target OrbitControls target (world origin at boot)
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(camera, target, { reduced = false } = {}) {
    this._camera = camera
    this._target = target.clone()
    this._final = camera.position.clone()
    this._duration = DURATION.bootReveal / 1000
    this._start = null
    this._done = reduced          // reduced: the final pose is the whole show
    this._lastWritten = reduced ? null : this._apply(flightFrame(0))
  }

  /** Compose the camera pose for one flight frame; returns the written position. */
  _apply(f) {
    const offset = this._final.clone().sub(this._target)
    const lift = offset.length() * f.lift
    offset.multiplyScalar(1 + f.dolly)
    offset.applyAxisAngle(_Z_UP, f.orbit)
    offset.z += lift
    const pos = offset.add(this._target)
    this._camera.position.copy(pos)
    return pos.clone()
  }

  /** True while the flight is still animating the camera. */
  get active() { return !this._done }

  /** Snap to the final pose now (user input / context load pre-empts the show). */
  finish() {
    if (this._done) return
    this._done = true
    if (this._cameraStolen()) return
    this._camera.position.copy(this._final)
  }

  /** Someone else wrote the camera since our last frame — they own it now. */
  _cameraStolen() {
    if (!this._lastWritten) return false
    const tol = Math.max(this._final.length(), 1) * 1e-5
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
    this._lastWritten = this._apply(flightFrame(p))
    if (p >= 1) this._done = true
    return this._done
  }

  /** Governor teardown (natural end or budget eviction) = finish. */
  dispose() { this.finish() }
}
