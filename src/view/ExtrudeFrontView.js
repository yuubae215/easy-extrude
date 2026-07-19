// @ts-check
import * as THREE from 'three'
import { COLOR, hexNumber } from '../theme/tokens.js'
import { intensityStep, frontFrame, FRONT_BASE } from './ExtrudeFrontMath.js'

/**
 * ExtrudeFrontView — the glowing rim of the face being extruded
 * (ADR-080 Phase 2, Tier A).
 *
 * A closed line loop over the 4 face corners, drawn overlay-style (additive,
 * no depth test) so the boundary of change stays legible through the solid.
 * Intensity dynamics live in the pure `ExtrudeFrontMath`; this class only
 * renders them. Colour is the materialize green — growth shares the "appear"
 * vocabulary (`CommandFeedbackMath`), lerped toward white with momentum (P4).
 *
 * OWNERSHIP: created and disposed by `FaceExtrudeHandler` (start →
 * confirm/cancel) — its lifetime is tracked, so it is NOT a MotionGovernor
 * transient (the governor owns only transients nobody tracks). Ticked from
 * `AppController._animate` via the handler, like the other persistent views.
 *
 * Reduced motion (sampled ONCE at spawn from the single boundary, per-spawn
 * discipline): a static held rim — "this face is being extruded" is preserved,
 * the velocity glow is dropped (#30/#11). `tick`/`bump` become no-ops.
 */
export class ExtrudeFrontView {
  /**
   * @param {THREE.Scene} scene
   * @param {{reduced?: boolean}} [opts]
   */
  constructor(scene, { reduced = false } = {}) {
    this._scene = scene
    this._reduced = reduced
    this._intensity = FRONT_BASE
    this._lastT = null

    this._base = new THREE.Color(hexNumber(COLOR.fxGreen))
    this._white = new THREE.Color(0xffffff)

    this._geometry = new THREE.BufferGeometry()
    this._positions = new Float32Array(4 * 3)
    this._geometry.setAttribute('position', new THREE.BufferAttribute(this._positions, 3))
    this._material = new THREE.LineBasicMaterial({
      color: this._base.clone(),
      transparent: true,
      opacity: 0,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    })
    this._line = new THREE.LineLoop(this._geometry, this._material)
    this._line.renderOrder = 999
    this._line.frustumCulled = false
    this._line.visible = false
    scene.add(this._line)

    this._applyFrame()
  }

  /**
   * Reposition the rim onto the current world-space face corners.
   * @param {Array<{x:number,y:number,z:number}>} corners exactly the 4 face
   *   vertices (any other count hides the rim — honest silence, #11)
   */
  update(corners) {
    if (!Array.isArray(corners) || corners.length !== 4) {
      this._line.visible = false
      return
    }
    for (let i = 0; i < 4; i++) {
      const c = corners[i]
      this._positions[i * 3]     = c.x
      this._positions[i * 3 + 1] = c.y
      this._positions[i * 3 + 2] = c.z
    }
    this._geometry.attributes.position.needsUpdate = true
    this._line.visible = true
  }

  /**
   * Feed one drag step: |velocity| brightens the front immediately.
   * @param {number} velocity world-units/second (sign ignored)
   * @param {number} dt seconds since the previous step
   */
  bump(velocity, dt) {
    if (this._reduced) return
    this._intensity = intensityStep(this._intensity, Math.abs(velocity), dt)
    this._applyFrame()
  }

  /**
   * Per-frame decay while the drag is still (P2 余韻).
   * @param {number} t loop clock, seconds
   */
  tick(t) {
    if (this._reduced) return
    const dt = this._lastT === null ? 0 : Math.max(0, Math.min(t - this._lastT, 0.1))
    this._lastT = t
    this._intensity = intensityStep(this._intensity, 0, dt)
    this._applyFrame()
  }

  _applyFrame() {
    const f = frontFrame(this._intensity, this._reduced)
    this._material.opacity = f.opacity
    this._material.color.copy(this._base).lerp(this._white, f.whiteLerp)
  }

  /** Symmetric teardown (#9) — same commit as the allocation. */
  dispose() {
    this._scene.remove(this._line)
    this._geometry.dispose()
    this._material.dispose()
  }
}
