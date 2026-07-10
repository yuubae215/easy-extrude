// @ts-nocheck
import * as THREE from 'three'

const DURATION = 0.6   // seconds

/**
 * Transient sphere that expands and fades over DURATION seconds.
 * Created at the midpoint of a newly accepted SpatialLink to confirm the relationship.
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
   *   confirmation cue (fixed mid-scale, fixed opacity) held for DURATION
   *   instead of the expand+fade — information preserved, movement dropped
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
    if (reduced) {
      this._mesh.scale.setScalar(2)
      mat.opacity = 0.35
    }
    scene.add(this._mesh)
  }

  /**
   * Advances the animation. Returns true when the ripple has finished and should be disposed.
   * @param {number} t  seconds from performance.now() / 1000
   */
  tick(t) {
    const elapsed = t - this._start
    if (elapsed >= DURATION) return true
    if (this._reduced) return false                       // static cue: hold, no motion
    const progress = elapsed / DURATION
    this._mesh.scale.setScalar(1 + progress * 3)           // 1× → 4× over DURATION
    this._mesh.material.opacity = 0.8 * (1 - progress)    // fade to 0
    return false
  }

  dispose() {
    this._scene.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._mesh.material.dispose()
  }
}
