// @ts-nocheck
import * as THREE from 'three'
import { snapFlashFrame } from './SnapFeedbackMath.js'

/**
 * SnapFlash — transient 3D rendering of a snap-lock engagement during a drag
 * (ADR-065 Phase 2, snap engagement flash). RippleEffect lineage: constructor
 * adds to the scene, `tick(t)` returns true when finished, `dispose()`
 * releases. Spawned exclusively through `MotionGovernor.spawn`.
 *
 * Three camera-facing parts driven by the pure `snapFlashFrame` curve: a
 * popping ring (overshoot-settle), a staggered echo wavefront, and a centre
 * spark that contracts onto the lock point. Billboarding reads
 * `sceneView.activeCamera` each tick (never a captured perspective camera —
 * the ortho toggle must not break facing); facing is legibility, not motion,
 * so it also applies under reduced motion, where the effect holds a static
 * ring for its duration instead of animating.
 *
 * Own overlay geometry only — never the entity's material/emissive (#4).
 * Sized from the descriptor's entity-proportional radius (#27). Deterministic
 * (no Math.random) — a replayed engagement looks identical.
 */
export class SnapFlash {
  /**
   * @param {THREE.Scene} scene
   * @param {{activeCamera: THREE.Camera}} sceneView  camera accessor (read per tick)
   * @param {{x:number, y:number, z:number, radius:number, color:number,
   *          duration:number, intensity:number}} desc
   *   from `SnapFeedbackMath.snapFlashDescriptor` (duration in seconds)
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(scene, sceneView, desc, { reduced = false } = {}) {
    this._scene     = scene
    this._sceneView = sceneView
    this._reduced   = reduced
    this._duration  = desc.duration
    this._intensity = desc.intensity
    this._start     = performance.now() / 1000

    const matOpts = { color: desc.color, transparent: true, opacity: 0,
                      depthTest: false, side: THREE.DoubleSide }
    this._ring  = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 32),
                                 new THREE.MeshBasicMaterial(matOpts))
    this._echo  = new THREE.Mesh(new THREE.RingGeometry(0.88, 0.96, 32),
                                 new THREE.MeshBasicMaterial(matOpts))
    this._spark = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16),
                                 new THREE.MeshBasicMaterial(matOpts))

    this._group = new THREE.Group()
    for (const mesh of [this._ring, this._echo, this._spark]) {
      mesh.renderOrder = 3
      this._group.add(mesh)
    }
    this._group.position.set(desc.x, desc.y, desc.z)
    this._baseRadius = desc.radius

    this._applyFrame(0)
    this._face()
    scene.add(this._group)
  }

  /** Compose one pure-curve frame into the three parts' scale/opacity. */
  _applyFrame(progress) {
    const f = snapFlashFrame(progress, this._reduced, this._intensity)
    const r = this._baseRadius
    this._ring.scale.setScalar(Math.max(f.ringScale * r, 0.001))
    this._ring.material.opacity = f.ringOpacity
    this._echo.scale.setScalar(Math.max(f.echoScale * r, 0.001))
    this._echo.material.opacity = f.echoOpacity
    this._spark.scale.setScalar(Math.max(f.sparkScale * r, 0.001))
    this._spark.material.opacity = f.sparkOpacity
  }

  /** Face the active camera (perspective or ortho — read per tick). */
  _face() {
    const cam = this._sceneView?.activeCamera
    if (cam) this._group.quaternion.copy(cam.quaternion)
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const progress = (t - this._start) / this._duration
    if (progress >= 1) return true
    this._face()
    if (this._reduced) return false // static held cue — constructed frame stands
    this._applyFrame(progress)
    return false
  }

  dispose() {
    this._scene.remove(this._group)
    for (const mesh of [this._ring, this._echo, this._spark]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
}
