// @ts-nocheck
import * as THREE from 'three'
import { pulseFrame } from './CommandFeedbackMath.js'

/**
 * LandingEffects — transient 3D confirmation of a *committed* core-modeling
 * operation (ADR-065 Phase 2). RippleEffect lineage: constructor adds to the
 * scene, `tick(t)` returns true when finished, `dispose()` releases.
 * Spawned exclusively through `MotionGovernor.spawn` (budget + reduced-motion).
 *
 * Own overlay mesh only — it NEVER touches the entity's material/emissive
 * (`_syncEmissive` stays the sole owner, PHILOSOPHY #4) and is orientation-free
 * (a sphere pulse), so it cannot re-introduce the AABB-vs-OBB divergence that
 * banned BoxHelper (CODE_CONTRACTS §4). Sizing follows the RippleEffect
 * precedent: world radius derived from the landed entity's bounds, so the cue
 * stays proportionate in mm-scale and m-scale scenes alike (#27).
 */
export class LandingPulse {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x:number,y:number,z:number}, radius:number}} bounds
   *   from `CommandFeedbackMath.boundsOf` (entity world corners)
   * @param {{color:number, expand:1|-1, overshoot:boolean, duration:number}} desc
   *   from `CommandFeedbackMath.landingDescriptor`
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(scene, bounds, desc, { reduced = false } = {}) {
    this._scene = scene
    this._desc = desc
    this._reduced = reduced
    this._start = performance.now() / 1000
    const geo = new THREE.SphereGeometry(Math.max(bounds.radius * 1.05, 0.05), 12, 8)
    const mat = new THREE.MeshBasicMaterial({
      color:       desc.color,
      transparent: true,
      opacity:     0.85,
      wireframe:   true,
      depthTest:   false,
    })
    this._mesh = new THREE.Mesh(geo, mat)
    this._mesh.renderOrder = 3
    this._mesh.position.set(bounds.center.x, bounds.center.y, bounds.center.z)
    // Apply the first frame immediately (also the held static cue when reduced)
    // so the effect never renders one raw frame at construction scale.
    const f = pulseFrame(desc, 0, reduced)
    this._mesh.scale.setScalar(f.scale)
    mat.opacity = f.opacity
    scene.add(this._mesh)
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const progress = (t - this._start) / this._desc.duration
    if (progress >= 1) return true
    if (this._reduced) return false          // static cue: hold, no motion
    const f = pulseFrame(this._desc, progress, false)
    this._mesh.scale.setScalar(f.scale)
    this._mesh.material.opacity = f.opacity
    return false
  }

  dispose() {
    this._scene.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._mesh.material.dispose()
  }
}
