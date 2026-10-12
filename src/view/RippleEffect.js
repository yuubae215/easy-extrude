// @ts-nocheck
import * as THREE from 'three'
import { DURATION } from '../theme/tokens.js'
import { rippleFrame } from './LinkMotionMath.js'

const DURATION_S = DURATION.ripple / 1000

/**
 * Transient sphere that swells and fades — "something arrived here" (the
 * Context DSL demo's decision approval and staged reveal).
 *
 * ADR-166 M4b: this used to also say "a link was bound". That meaning moved to
 * `LinkBindEffect` (light running from both ends to the midpoint); one effect
 * no longer carries two facts. The swell and the fade were linear ramps; they
 * now follow the motion identity — size = `land`, opacity = `fade`
 * (`LinkMotionMath.rippleFrame`).
 *
 * Lifecycle: constructor adds to scene; tick() returns true when done; caller calls dispose().
 * (PHILOSOPHY #9 — allocations and deallocations are symmetric)
 * Spawned through `MotionGovernor.spawn` (ADR-065 Phase 1), which supplies the
 * reduced-motion flag from the single boundary.
 */
export class RippleEffect {
  /**
   * @param {number} [radius=0.15]  Base sphere radius in world units — pass an
   *   entity-scaled value for scenes whose unit is not ~metres (e.g. mm scenes).
   * @param {{reduced?: boolean}} [opts]  reduced=true renders a static
   *   confirmation cue (fixed mid-scale, fixed opacity) held for the duration
   *   instead of the swell+fade — information preserved, movement dropped
   *   (ADR-065 Phase 1, PHILOSOPHY #11).
   */
  constructor(scene, position, color, radius = 0.15, { reduced = false } = {}) {
    this._scene = scene
    this._reduced = reduced
    this._start = performance.now() / 1000
    const geo = new THREE.SphereGeometry(radius, 8, 8)
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity:     0.8,
      wireframe:   true,
      depthTest:   false,
    })
    this._mesh = new THREE.Mesh(geo, mat)
    this._mesh.renderOrder = 3
    this._mesh.position.copy(position)
    this._apply(0)
    scene.add(this._mesh)
  }

  _apply(progress) {
    const f = rippleFrame(progress, this._reduced)
    this._mesh.scale.setScalar(f.scale)
    this._mesh.material.opacity = f.opacity
  }

  /**
   * Advances the animation. Returns true when the ripple has finished and should be disposed.
   * @param {number} t  seconds from performance.now() / 1000
   */
  tick(t) {
    const elapsed = t - this._start
    if (elapsed >= DURATION_S) return true
    if (this._reduced) return false                       // static cue: hold, no motion
    this._apply(elapsed / DURATION_S)
    return false
  }

  dispose() {
    this._scene.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._mesh.material.dispose()
  }
}
