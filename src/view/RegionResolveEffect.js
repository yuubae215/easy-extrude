// @ts-nocheck
/**
 * RegionResolveEffect — transient 3-D counterpart of a conflict-matrix cell
 * resolving (ADR-065 Phase 5): the old no-man's-land gap band recolours
 * red → green, then dissolves.
 *
 * Fired by ContextController's ghost-mode re-projection when a variable's
 * ghost transitions out of a live conflict (the pure recognition is
 * `RegionGhostMath.regionResolveTransitions` — a diff of two committed
 * projections, never a re-implemented judgment, ADR-062). The NEW ghost state
 * is rendered instantly by the rebuilt RegionGhostView underneath — this
 * effect never delays the fact (ADR-065 Consequences §7), it only narrates
 * the old band's departure.
 *
 * RippleEffect lineage: constructor adds to scene, `tick(t) → done`,
 * `dispose()`. Spawned ONLY through `MotionGovernor.spawn`, which supplies
 * the reduced-motion flag from the single boundary — under reduced motion the
 * band holds a static settled-green cue for the duration instead of animating
 * (information preserved, movement dropped — PHILOSOPHY #30/#11).
 *
 * @module view/RegionResolveEffect
 */
import * as THREE from 'three'
import { resolveFrame, GAP_COLOR, RESOLVE_COLOR } from './RegionGhostMath.js'
import { mixHex } from './GraspGhostMath.js'
import { DURATION } from '../theme/tokens.js'

const DURATION_S = DURATION.regionResolve / 1000
/** Lift above the RegionGhostView overlay plane (Z_OVERLAY = 4) so the
 * departing band reads over the rebuilt ghost underneath. */
const Z_EFFECT = 5

export class RegionResolveEffect {
  /**
   * @param {THREE.Scene} scene
   * @param {{x: [number, number], y: [number, number]}[]} rects — the OLD gap
   *   band rectangles (RegionGhostMath.gapBandRects of the pre-resolution ghost)
   * @param {{reduced?: boolean}} [opts]
   */
  constructor(scene, rects, { reduced = false } = {}) {
    this._scene = scene
    this._reduced = reduced
    this._start = performance.now() / 1000
    this._meshes = []
    for (const r of rects) {
      const mat = new THREE.MeshBasicMaterial({
        color: GAP_COLOR, transparent: true, opacity: 0,
        depthTest: true, depthWrite: false, side: THREE.DoubleSide,
      })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat)
      mesh.position.set((r.x[0] + r.x[1]) / 2, (r.y[0] + r.y[1]) / 2, Z_EFFECT)
      mesh.scale.set(Math.max(r.x[1] - r.x[0], 1e-3), Math.max(r.y[1] - r.y[0], 1e-3), 1)
      mesh.renderOrder = 6
      scene.add(mesh)
      this._meshes.push(mesh)
    }
  }

  /**
   * @param {number} t seconds (the loop clock — performance.now() / 1000)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const p = (t - this._start) / DURATION_S
    if (p >= 1) return true
    const frame = resolveFrame(p, this._reduced)
    const hex = mixHex(GAP_COLOR, RESOLVE_COLOR, frame.mix)
    for (const mesh of this._meshes) {
      mesh.material.color.setHex(hex)
      mesh.material.opacity = frame.opacity
    }
    return false
  }

  dispose() {
    for (const mesh of this._meshes) {
      this._scene.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this._meshes = []
  }
}
