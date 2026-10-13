// @ts-nocheck
import * as THREE from 'three'
import { particleFrame, particleProgress } from './CelebrationMath.js'

/**
 * CelebrationField — transient 3D particle burst for a session "won moment"
 * (ADR-065 Phase 4). RippleEffect lineage: constructor adds to the scene,
 * `tick(t)` returns true when finished, `dispose()` releases. Spawned
 * exclusively through `MotionGovernor.spawn` (budget + reduced-motion, named
 * rule 2) — never self-managed in the animation loop.
 *
 * One InstancedMesh (a single draw call regardless of particle count — the
 * `_animate` performance guard from ADR-065 Consequences §6). Own overlay
 * geometry only: never touches entity materials (PHILOSOPHY #4). Sized from
 * the anchor bounds so the burst stays proportionate in mm- and m-scale
 * scenes (#27). Each particle runs the pure `particleFrame` curve on its OWN
 * staggered clock (`particleProgress` — the fan never leaves in lockstep) and
 * is born in the one stage light (`desc.flash`), cooling to the win's state
 * tone — per-instance colour; one shared material has one opacity, so each
 * particle's fade rides its scale (the VoxelBurst constraint, ADR-166 M4d3).
 * Under reduced motion `particleFrame`
 * under reduced motion it returns one static held frame (frozen mid-burst,
 * visible for the descriptor's duration), so the cue degrades to a static
 * rendering, never to nothing (#30/#11).
 */
export class CelebrationField {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x:number,y:number,z:number}, radius:number}} bounds
   *   anchor from `CommandFeedbackMath.boundsOf` (the landed entity)
   * @param {{color:string, flash:string, particles:number, durationMs:number}} desc
   *   from `CelebrationMath.celebrationDescriptor`
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(scene, bounds, desc, { reduced = false } = {}) {
    this._scene    = scene
    this._reduced  = reduced
    this._duration = desc.durationMs / 1000 // view constants ms → loop clock s
    this._start    = performance.now() / 1000
    this._center   = new THREE.Vector3(bounds.center.x, bounds.center.y, bounds.center.z)
    this._maxDist  = Math.max(bounds.radius * 2.2, 0.4)

    const count = Math.max(desc.particles, 1) * 2 // 3D field is denser than the DOM fan
    this._count = count
    const size  = Math.max(bounds.radius * 0.06, 0.012)
    const geo   = new THREE.OctahedronGeometry(size)
    const mat   = new THREE.MeshBasicMaterial({
      // no `color`: the default (neutral) multiplier — colour is per instance
      transparent: true,
      opacity:     0.9,
      depthTest:   false,
    })
    this._baseColor  = new THREE.Color(desc.color)
    this._flashColor = new THREE.Color(desc.flash)
    this._mesh = new THREE.InstancedMesh(geo, mat, count)
    this._mesh.renderOrder = 3

    // Deterministic directions on a spiral-sphere fan (no Math.random — a
    // replayed celebration looks identical; also keeps tests reproducible).
    this._dirs = []
    for (let i = 0; i < count; i++) {
      const phi   = Math.acos(1 - 2 * (i + 0.5) / count)
      const theta = Math.PI * (1 + Math.sqrt(5)) * i
      this._dirs.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.sin(phi) * Math.sin(theta),
        Math.cos(phi),
      ))
    }

    this._applyFrame(0)
    scene.add(this._mesh)
  }

  /** Write one pure-curve frame per particle into the instance matrices and colours. */
  _applyFrame(progress) {
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const c = new THREE.Color()
    for (let i = 0; i < this._count; i++) {
      const f = particleFrame(particleProgress(progress, i, this._reduced), this._reduced)
      pos.copy(this._dirs[i])
        .multiplyScalar(f.dist * this._maxDist)
        .add(this._center)
      pos.z += f.lift * this._maxDist
      // The particle's own fade rides its scale (one material, one opacity);
      // the reduced held cue carries its opacity on the material instead.
      const s = Math.max(this._reduced ? f.scale : f.scale * (f.opacity / 0.9), 0.001)
      m.makeScale(s, s, s)
      m.setPosition(pos)
      this._mesh.setMatrixAt(i, m)
      this._mesh.setColorAt(i, c.copy(this._baseColor).lerp(this._flashColor, f.glow))
    }
    this._mesh.instanceMatrix.needsUpdate = true
    this._mesh.instanceColor.needsUpdate = true
    // Reduced: the held cue keeps its low opacity on the material.
    this._mesh.material.opacity = this._reduced ? particleFrame(0, true).opacity : 0.9
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
