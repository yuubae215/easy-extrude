// @ts-nocheck
import * as THREE from 'three'
import { buildGeometry } from '../model/CuboidModel.js'
import { DURATION, COLOR, hexNumber } from '../theme/tokens.js'
import { selectPulseFrame } from './SelectPulseMath.js'

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
 * entity's material/emissive (#4; MeshView's outline owns the steady selection
 * outline, which lands on `SELECTION_CUE` in the same instant — ADR-166 M4d2). Built from the entity's own OBB corners via the same
 * `buildGeometry` + `EdgesGeometry` path MeshView uses, so the pulse matches
 * the solid's orientation after R-key rotation. Sized by the entity, not a
 * world constant (#27). Deterministic. Under reduced motion it holds a static
 * outline for its duration instead of animating (movement dropped, cue kept).
 *
 * The frame is `selectPulseFrame` (ADR-166 M4d2): size lands, opacity fades —
 * two curves, brightest while small (ADR-093 D2). This class only writes it.
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
      color: hexNumber(COLOR.accent), transparent: true, depthTest: false,
    })
    this._lines = new THREE.LineSegments(this._edges, this._mat)
    this._lines.renderOrder = 3
    this._lines.position.copy(_CENTER)
    // Re-anchor the geometry so scaling happens about the centre.
    this._lines.geometry.translate(-_CENTER.x, -_CENTER.y, -_CENTER.z)

    this._write(0)
    scene.add(this._lines)
  }

  /** @param {number} t seconds (performance.now() / 1000) */
  tick(t) {
    const elapsed = t - this._start
    if (elapsed >= this._duration) return true
    this._write(elapsed / this._duration)
    return false
  }

  /** Sole writer of the pulse's pixels. @param {number} progress */
  _write(progress) {
    const f = selectPulseFrame(progress, this._reduced)
    this._lines.scale.setScalar(f.scale)
    this._mat.opacity = f.opacity
  }

  dispose() {
    this._scene.remove(this._lines)
    this._edges.dispose()
    this._mat.dispose()
  }
}
