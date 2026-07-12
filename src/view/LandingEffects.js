// @ts-nocheck
import * as THREE from 'three'
import {
  voxelFrame, voxelJitter, glitchGate,
  voxelDelay, localProgress, voxelFlash, voxelEnvelope,
} from './CommandFeedbackMath.js'

/**
 * LandingEffects — transient 3D rendering of an entity LIFECYCLE transition
 * (ADR-065 Phase 2, volume revision). RippleEffect lineage: constructor adds
 * to the scene, `tick(t)` returns true when finished, `dispose()` releases.
 * Spawned exclusively through `MotionGovernor.spawn` (budget + reduced-motion).
 *
 * VOLUME DESIGN: this view fires only for appear/vanish transitions
 * (`CommandFeedbackMath.lifecycleDescriptor`) — routine pose operations are
 * silent. The effect itself carries the semantic:
 *   - dissolve: the entity shatters into voxel fragments that fly outward,
 *     tumble and evaporate (the only remaining trace of a deleted entity),
 *   - materialize: the reverse — a glitch-flickering voxel shell converges
 *     onto the just-created entity and evaporates.
 *
 * One InstancedMesh (a single draw call regardless of voxel count — the
 * `_animate` performance guard, same as CelebrationField). Own overlay
 * geometry only — it NEVER touches the entity's material/emissive
 * (`_syncEmissive` stays the sole owner, PHILOSOPHY #4). Sized from the
 * entity's bounds so the cue stays proportionate in mm-scale and m-scale
 * scenes alike (#27). Directions and jitter are deterministic (no
 * Math.random) — a replayed transition looks identical.
 */
export class VoxelBurst {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x:number,y:number,z:number}, radius:number}} bounds
   *   from `CommandFeedbackMath.boundsOf` (the appearing/vanishing entity's
   *   world corners, captured at the domain event)
   * @param {{kind:'materialize'|'dissolve', color:number, duration:number}} desc
   *   from `CommandFeedbackMath.lifecycleDescriptor` (duration in seconds)
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(scene, bounds, desc, { reduced = false } = {}) {
    this._scene    = scene
    this._kind     = desc.kind
    this._reduced  = reduced
    this._duration = desc.duration
    this._start    = performance.now() / 1000
    this._center   = new THREE.Vector3(bounds.center.x, bounds.center.y, bounds.center.z)
    this._maxDist  = Math.max(bounds.radius * 1.7, 0.32)

    const count = 40 // richer cloud; still ONE draw call (InstancedMesh)
    this._count = count
    const size  = Math.max(bounds.radius * 0.11, 0.018)
    const geo   = new THREE.BoxGeometry(size, size, size)
    this._baseColor = new THREE.Color(desc.color)
    this._flashColor = new THREE.Color(0xffffff)
    const mat   = new THREE.MeshBasicMaterial({
      color:       this._baseColor.clone(),
      transparent: true,
      opacity:     0.92,
      depthTest:   false,
      blending:    THREE.AdditiveBlending, // fragments glow where they overlap
    })
    this._mesh = new THREE.InstancedMesh(geo, mat, count)
    this._mesh.renderOrder = 3

    // Deterministic directions on a spiral-sphere fan with per-voxel radius
    // jitter and a per-voxel stagger delay — a voxel cloud that detaches in a
    // wave, not a perfect shell moving in lockstep (no Math.random).
    this._dirs = []
    this._jitters = []
    this._delays = []
    for (let i = 0; i < count; i++) {
      const phi   = Math.acos(1 - 2 * (i + 0.5) / count)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      this._dirs.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ))
      this._jitters.push(voxelJitter(i))
      this._delays.push(voxelDelay(i))
    }

    this._applyFrame(0)
    scene.add(this._mesh)
  }

  /** Write one frame into the instance matrices from the pure curves. */
  _applyFrame(progress) {
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const euler = new THREE.Euler()
    const scl = new THREE.Vector3()
    for (let i = 0; i < this._count; i++) {
      const jitter = this._jitters[i]
      // Per-voxel LOCAL progress (the stagger): reduced motion holds the shell
      // at a single frame, so it ignores the offset (static held cue #30).
      const lp = this._reduced ? progress : localProgress(progress, this._delays[i])
      const f = voxelFrame(this._kind, lp, this._reduced)
      pos.copy(this._dirs[i])
        .multiplyScalar(f.dist * jitter * this._maxDist)
        .add(this._center)
      // Deterministic per-voxel tumble around alternating signed axes so
      // fragments rotate independently.
      euler.set(
        f.spin * (i % 2 === 0 ? 1 : -1),
        f.spin * jitter,
        f.spin * ((i % 3) - 1),
      )
      quat.setFromEuler(euler)
      // One shared material = one opacity, so BOTH the per-voxel fade and the
      // glitch flicker ride per-instance scale: size folds in the voxel's own
      // opacity (staggered evaporation) × the glitch gate (materialize only).
      const gate = (this._kind === 'materialize' && !this._reduced)
        ? glitchGate(i, lp)
        : 1
      const visible = this._reduced ? f.scale : f.scale * f.opacity
      scl.setScalar(Math.max(visible * gate, 0.001))
      m.compose(pos, quat, scl)
      this._mesh.setMatrixAt(i, m)
    }
    this._mesh.instanceMatrix.needsUpdate = true
    // Whole-cloud alpha envelope + boundary flash (colour → white at the
    // break / assembly instant). Reduced motion: fixed low-opacity, no flash.
    if (this._reduced) {
      this._mesh.material.color.copy(this._baseColor)
      this._mesh.material.opacity = 0.4
    } else {
      const flash = voxelFlash(this._kind, progress)
      this._mesh.material.color.copy(this._baseColor).lerp(this._flashColor, flash * 0.8)
      this._mesh.material.opacity = voxelEnvelope(progress)
    }
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const progress = (t - this._start) / this._duration
    if (progress >= 1) return true
    if (this._reduced) return false // static held cue — constructed frame stands
    this._applyFrame(progress)
    return false
  }

  dispose() {
    this._scene.remove(this._mesh)
    this._mesh.geometry.dispose()
    this._mesh.material.dispose()
    this._mesh.dispose()
  }
}
