// @ts-nocheck
import * as THREE from 'three'
import { particleFrame } from './CelebrationMath.js'

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
 * scenes (#27). The per-frame shape is the pure `particleFrame` curve —
 * under reduced motion it returns one static held frame (frozen mid-burst,
 * visible for the descriptor's duration), so the cue degrades to a static
 * rendering, never to nothing (#30/#11).
 */
export class CelebrationField {
  /**
   * @param {THREE.Scene} scene
   * @param {{center:{x:number,y:number,z:number}, radius:number}} bounds
   *   anchor from `CommandFeedbackMath.boundsOf` (the landed entity)
   * @param {{color:string, particles:number, durationMs:number}} desc
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
      color:       desc.color,
      transparent: true,
      opacity:     0.9,
      depthTest:   false,
    })
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

  /** Write one pure-curve frame into the instance matrices. */
  _applyFrame(progress) {
    const f = particleFrame(progress, this._reduced)
    const m = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    for (let i = 0; i < this._count; i++) {
      pos.copy(this._dirs[i])
        .multiplyScalar(f.dist * this._maxDist)
        .add(this._center)
      pos.z += f.lift * this._maxDist
      m.makeScale(f.scale, f.scale, f.scale)
      m.setPosition(pos)
      this._mesh.setMatrixAt(i, m)
    }
    this._mesh.instanceMatrix.needsUpdate = true
    this._mesh.material.opacity = f.opacity
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
