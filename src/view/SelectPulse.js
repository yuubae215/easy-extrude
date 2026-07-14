// @ts-nocheck
import * as THREE from 'three'
import { buildGeometry } from '../model/CuboidModel.js'
import { DURATION, COLOR, hexNumber } from '../theme/tokens.js'
import { easeOutCubic } from './MotionMath.js'

const _CENTER = new THREE.Vector3()

/**
 * SelectPulse — the selection "tap" cue (ADR-068). A brief outline that hugs
 * the newly-selected Solid's OBB, pops outward from the body centre, and fades.
 * It answers a Tier-A/F question — "this is the thing you just picked" — and
 * fires ONLY on a transition INTO selection (AppController tracks the last
 * pulsed id), never on re-selection churn (the same volume discipline as the
 * landing effects, PHILOSOPHY #30).
 *
 * RippleEffect lineage (`tick(t) → done`, `dispose()`), spawned exclusively
 * through `MotionGovernor.spawn`. Own overlay geometry only — never the
 * entity's material/emissive (#4; the instant boxHelper still owns the steady
 * selection outline). Built from the entity's own OBB corners via the same
 * `buildGeometry` + `EdgesGeometry` path MeshView uses, so the pulse matches
 * the solid's orientation after R-key rotation. Sized by the entity, not a
 * world constant (#27). Deterministic. Under reduced motion it holds a static
 * outline for its duration instead of animating (movement dropped, cue kept).
 */
export class SelectPulse {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3[]} corners  8 world-space OBB corners of the Solid
   * @param {{reduced?: boolean}} [opts] supplied by MotionGovernor.spawn
   */
  constructor(scene, corners, { reduced = false } = {}) {
    this._scene   = scene
    this._reduced = reduced
    this._duration = DURATION.selectPulse / 1000
    this._start    = performance.now() / 1000

    // Centre of the OBB — the pulse scales about it.
    _CENTER.set(0, 0, 0)
    for (const c of corners) _CENTER.add(c)
    _CENTER.multiplyScalar(1 / corners.length)

    const solidGeo = buildGeometry(corners)
    this._edges = new THREE.EdgesGeometry(solidGeo, 1)
    solidGeo.dispose()

    this._mat = new THREE.LineBasicMaterial({
      color: hexNumber(COLOR.accentActive), transparent: true, opacity: 0.9, depthTest: false,
    })
    this._lines = new THREE.LineSegments(this._edges, this._mat)
    this._lines.renderOrder = 3
    this._lines.position.copy(_CENTER)
    // Re-anchor the geometry so scaling happens about the centre.
    this._lines.geometry.translate(-_CENTER.x, -_CENTER.y, -_CENTER.z)

    if (reduced) { this._lines.scale.setScalar(1.15); this._mat.opacity = 0.5 }
    scene.add(this._lines)
  }

  /** @param {number} t seconds (performance.now() / 1000) */
  tick(t) {
    const elapsed = t - this._start
    if (elapsed >= this._duration) return true
    if (this._reduced) return false                 // static held outline
    const p = easeOutCubic(elapsed / this._duration)
    this._lines.scale.setScalar(1 + p * 0.35)        // 1× → 1.35× pop
    this._mat.opacity = 0.9 * (1 - p)                // fade to 0
    return false
  }

  dispose() {
    this._scene.remove(this._lines)
    this._edges.dispose()
    this._mat.dispose()
  }
}
