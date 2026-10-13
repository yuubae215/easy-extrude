// @ts-nocheck
import * as THREE from 'three'
import { bindFrame, bindRadius, BIND_TOTAL, LINK_TONES } from './LinkMotionMath.js'
import { lightTint } from './MapVisualMath.js'

/**
 * LinkBindEffect — a newly bound SpatialLink, told as light (ADR-166 M4b).
 *
 * Light leaves both ends, the two beads meet at the midpoint at the same
 * instant, flash there, and the line keeps an afterglow that fades — "these two
 * are now tied". Replaces the wireframe sphere that grew and faded linearly at
 * the midpoint (`RippleEffect`, which now only says "something arrived here")
 * and the line's own linear opacity flash (`SpatialLinkView.triggerFlash`,
 * retired — the line's pixels have one writer again, 原則 #4).
 *
 * Every number comes from the pure `LinkMotionMath.bindFrame`; this class only
 * applies it. The colour is the link type's colour lit by the stage light (the
 * same `lightTint` as the floor-light annotations — one light, M2).
 *
 * RippleEffect lineage: constructor adds to the scene, `tick(t)` returns true
 * when finished, `dispose()` releases (原則 #9). Spawned exclusively through
 * `MotionGovernor.spawn`, which supplies the reduced-motion flag; under reduced
 * motion the meeting point and the line hold a static lit cue for the same
 * duration.
 */
export class LinkBindEffect {
  /**
   * @param {THREE.Scene}   scene
   * @param {THREE.Vector3} srcPos  world centroid of the source
   * @param {THREE.Vector3} tgtPos  world centroid of the target
   * @param {number|undefined} color 0xRRGGBB — the link type's colour (unknown type → `LINK_TONES.unknown`)
   * @param {{reduced?: boolean}} [opts]
   */
  constructor(scene, srcPos, tgtPos, color, { reduced = false } = {}) {
    this._scene   = scene
    this._reduced = reduced
    this._start   = performance.now() / 1000
    this._src = srcPos.clone()
    this._tgt = tgtPos.clone()
    this._mid = srcPos.clone().lerp(tgtPos, 0.5)
    // Sized by the link's own span — the scene's unit never decides visibility (原則 #27).
    const radius = bindRadius(srcPos.distanceTo(tgtPos))

    const lit = lightTint(Number.isFinite(color) ? color : LINK_TONES.unknown)
    const additive = {
      color: lit, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    }
    const beadGeo = new THREE.SphereGeometry(radius, 12, 8)
    this._beads = [
      new THREE.Mesh(beadGeo, new THREE.MeshBasicMaterial(additive)),
      new THREE.Mesh(beadGeo, new THREE.MeshBasicMaterial(additive)),
    ]
    this._flash = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12),
                                 new THREE.MeshBasicMaterial(additive))
    this._flash.position.copy(this._mid)

    const lineGeo = new THREE.BufferGeometry().setFromPoints([this._src, this._tgt])
    this._glow = new THREE.Line(lineGeo, new THREE.LineBasicMaterial(additive))

    this._group = new THREE.Group()
    for (const o of [this._glow, ...this._beads, this._flash]) {
      o.renderOrder = 3
      this._group.add(o)
    }
    this._apply(0)
    scene.add(this._group)
  }

  /** Apply one pure frame. */
  _apply(elapsed) {
    const f = bindFrame(elapsed, this._reduced)
    this._beads[0].position.lerpVectors(this._src, this._mid, f.travel)
    this._beads[1].position.lerpVectors(this._tgt, this._mid, f.travel)
    for (const b of this._beads) b.material.opacity = f.beadOpacity
    this._flash.scale.setScalar(Math.max(f.flashScale, 0.001))
    this._flash.material.opacity = f.flashOpacity
    this._glow.material.opacity = f.lineGlow
    return f.done
  }

  /**
   * @param {number} t seconds (performance.now()/1000 — the loop clock)
   * @returns {boolean} true when finished (caller disposes)
   */
  tick(t) {
    const elapsed = t - this._start
    if (elapsed >= BIND_TOTAL) return true
    if (this._reduced) return false   // static held cue — the constructed frame stands
    return this._apply(elapsed)
  }

  dispose() {
    this._scene.remove(this._group)
    this._beads[0].geometry.dispose()   // shared by both beads
    for (const b of this._beads) b.material.dispose()
    this._flash.geometry.dispose()
    this._flash.material.dispose()
    this._glow.geometry.dispose()
    this._glow.material.dispose()
  }
}
