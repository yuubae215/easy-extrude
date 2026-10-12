/**
 * FloorLightGeometry — pure vertex builders for the map annotations' floor
 * light (ADR-166 M3). THREE-free so the shapes are asked under bare
 * `node --test`; `AnnotatedRegionView` / `AnnotatedLineView` only wrap the
 * returned arrays in BufferAttributes.
 *
 * Two shapes carry the "light on the floor" reading, and they are chosen to be
 * COMPLEMENTARY in the view angle (`MapVisualMath.floorLightGains`):
 *   - the EDGE BAND lies on the floor: brightest at the polygon's edge, fading
 *     inward — a pool of light whose rim is the boundary. Seen from straight
 *     above it carries the whole reading; at a glancing angle it compresses.
 *   - the LIGHT CURTAIN stands on a polyline: brightest at the floor, fading
 *     upward — the glow a lit edge throws into the air. Edge-on (invisible)
 *     from straight above, it is exactly what remains legible at a glancing
 *     angle, where a floor decal collapses to a stripe.
 *
 * Shading is a per-vertex grey (1 = full light, 0 = none). The materials are
 * additive and tinted by `material.color`, so a 0 vertex contributes nothing —
 * the fade needs no alpha channel and the tint has one owner (#4).
 *
 * Sizes are passed in by the caller, derived from the entity's own extent
 * (PHILOSOPHY #27 — a world-unit constant vanishes in an mm cell and swamps a
 * site plan; this module never invents a length).
 */

/**
 * Edge band of a closed polygon, in the polygon's centroid-local frame: one
 * quad per edge between the edge and the same edge scaled by `inset` toward the
 * origin (the same construction the Zone rim ring has always used — ADR-031).
 *
 * @param {Array<{x:number,y:number,z?:number}>} pts centroid-local vertices (N ≥ 3)
 * @param {number} inset inner scale ∈ (0,1) — 0.78 leaves a band 22% deep
 * @returns {{positions: Float32Array, shade: Float32Array, index: Uint32Array}}
 *   `shade` is RGB grey per vertex (outer 1, inner 0); empty arrays for N < 3.
 */
export function edgeBand(pts, inset) {
  const n = Array.isArray(pts) ? pts.length : 0
  if (n < 3 || !(inset > 0 && inset < 1)) {
    return { positions: new Float32Array(0), shade: new Float32Array(0), index: new Uint32Array(0) }
  }
  // 2 vertices per polygon vertex: [outer_i, inner_i]
  const positions = new Float32Array(n * 2 * 3)
  const shade     = new Float32Array(n * 2 * 3)
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const z = p.z ?? 0
    const o = i * 6
    positions[o]     = p.x;          positions[o + 1] = p.y;          positions[o + 2] = z
    positions[o + 3] = p.x * inset;  positions[o + 4] = p.y * inset;  positions[o + 5] = z
    shade[o] = shade[o + 1] = shade[o + 2] = 1
    // inner vertex stays 0
  }
  const index = new Uint32Array(n * 6)
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const oi = i * 2, ii = i * 2 + 1, oj = j * 2, ij = j * 2 + 1
    index.set([oi, oj, ii, ii, oj, ij], i * 6)
  }
  return { positions, shade, index }
}

/**
 * Light curtain standing on a polyline: one vertical quad per segment, from
 * the floor (`z` of the point) up by `height` along world +Z (ROS Z-up).
 *
 * @param {Array<{x:number,y:number,z?:number}>} pts polyline vertices (N ≥ 2)
 * @param {boolean} closed also join the last vertex back to the first
 * @param {number} height curtain height (> 0, caller-derived — #27)
 * @returns {{positions: Float32Array, shade: Float32Array, index: Uint32Array, arcs: Float32Array}}
 *   Two vertices per polyline vertex `[floor_i, top_i]` (closed rings repeat
 *   the first vertex at the end so the arc fraction runs 0 → 1 without a
 *   seam). `shade` is the RESTING shade (floor 1, top 0) — callers that animate
 *   the light along the wall rewrite it in place, scaling by `arcs[k]` (the
 *   arc-length fraction ∈ [0,1] of vertex pair k). Empty for N < 2 or a
 *   zero-length polyline.
 */
export function lightCurtain(pts, closed, height) {
  const empty = {
    positions: new Float32Array(0), shade: new Float32Array(0),
    index: new Uint32Array(0), arcs: new Float32Array(0),
  }
  if (!Array.isArray(pts) || pts.length < 2 || !(height > 0)) return empty
  const ring = closed ? [...pts, pts[0]] : pts
  const m = ring.length
  const cum = new Float64Array(m)
  for (let i = 1; i < m; i++) {
    const a = ring[i - 1], b = ring[i]
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, (b.z ?? 0) - (a.z ?? 0))
  }
  const total = cum[m - 1]
  if (!(total > 0)) return empty

  const positions = new Float32Array(m * 2 * 3)
  const shade     = new Float32Array(m * 2 * 3)
  const arcs      = new Float32Array(m)
  for (let i = 0; i < m; i++) {
    const p = ring[i]
    const z = p.z ?? 0
    const o = i * 6
    positions[o]     = p.x; positions[o + 1] = p.y; positions[o + 2] = z
    positions[o + 3] = p.x; positions[o + 4] = p.y; positions[o + 5] = z + height
    shade[o] = shade[o + 1] = shade[o + 2] = 1
    arcs[i] = cum[i] / total
  }
  const index = new Uint32Array((m - 1) * 6)
  for (let i = 0; i < m - 1; i++) {
    const f0 = i * 2, t0 = i * 2 + 1, f1 = i * 2 + 2, t1 = i * 2 + 3
    index.set([f0, f1, t0, t0, f1, t1], i * 6)
  }
  return { positions, shade, index, arcs }
}
