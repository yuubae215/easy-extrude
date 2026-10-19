/**
 * ShadowCasterWatch — redraw the shadow map only when something that casts has
 * changed (ADR-166 M6 follow-up).
 *
 * The one stage light's shadow map (2048², PCF soft) was redrawn every frame.
 * In a still scene that is pure waste, and under software GL (CI) it cost ~40%
 * of the frame: the e2e job crossed its 15 min budget. The shadow is a function
 * of the casters' world matrices, their geometry, which of them are drawn, and
 * the lights that cast — so this compares exactly those against the last frame
 * and says whether the map is stale. Everything else (camera moves, hover,
 * selection glow, the pool's breath) leaves the shadow as it is.
 *
 * Reads only plain fields (`castShadow`, `matrixWorld.elements`, `geometry`),
 * so the unit lane drives it with plain objects.
 */
export class ShadowCasterWatch {
  constructor() {
    /** @type {Map<object, {geometry: unknown, m: Float64Array}>} last frame's casters */
    this._last = new Map()
  }

  /**
   * @param {Iterable<object>} drawn the objects that will be drawn this frame
   *   (call after the scene's world matrices are up to date)
   * @returns {boolean} true when the shadow map must be redrawn
   */
  changed(drawn) {
    let stale = false
    const seen = new Set()
    for (const o of drawn) {
      if (!o.castShadow) continue
      seen.add(o)
      const e = o.matrixWorld.elements
      const prev = this._last.get(o)
      if (!prev) {
        this._last.set(o, { geometry: o.geometry, m: Float64Array.from(e) })
        stale = true
        continue
      }
      if (prev.geometry !== o.geometry) { prev.geometry = o.geometry; stale = true }
      const m = prev.m
      for (let i = 0; i < 16; i++) {
        if (m[i] !== e[i]) { m.set(e); stale = true; break }
      }
    }
    // A caster that stopped being drawn (hidden, removed) leaves the map stale too.
    if (seen.size !== this._last.size) {
      for (const o of this._last.keys()) if (!seen.has(o)) this._last.delete(o)
      stale = true
    }
    return stale
  }

  /** Forget everything — the next frame redraws (e.g. after the light moved). */
  invalidate() { this._last.clear() }
}
