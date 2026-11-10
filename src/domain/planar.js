/**
 * planar — closed-form polygon geometry on the XY plane (ADR-170 S3).
 *
 * The plan view is where a place is drawn, so "is this inside that" and "do these
 * two share area" are asked on XY. Public-domain closed forms only (CLAUDE.md
 * §AI 向けガード axis 3): ray casting, the shoelace area, Andrew's monotone chain
 * and Sutherland–Hodgman clipping. Nothing here ranks, scores or searches.
 * `core/` has no counterpart, so this is the one source, not a derivation of one.
 *
 * Before S3 the point-in-polygon test was written twice (SceneService and
 * SemanticInferencer); both now import it from here (`src/ZoneOverlapOwnership.test.js`
 * counts the copies).
 *
 * Pure: no THREE, no DOM. Points are anything with numeric `x` / `y`.
 *
 * @module domain/planar
 */

/**
 * Ray-casting point-in-polygon on XY (odd-even rule). A point exactly on an edge
 * may fall either way — callers that need "strictly inside" ask an area instead.
 * @param {number} px
 * @param {number} py
 * @param {ReadonlyArray<{x:number, y:number}>} poly  ordered ring (≥ 3)
 * @returns {boolean}
 */
export function pointInPolygonXY(px, py, poly) {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    if (((yi > py) !== (yj > py)) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

/**
 * Signed shoelace area on XY — positive for a counter-clockwise ring.
 * @param {ReadonlyArray<{x:number, y:number}>} poly
 * @returns {number}
 */
export function signedAreaXY(poly) {
  let a = 0
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n]
    a += p.x * q.y - q.x * p.y
  }
  return a / 2
}

const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/**
 * Convex hull on XY (Andrew's monotone chain), counter-clockwise, without
 * collinear points. Fewer than 3 distinct points give what they have.
 * @param {ReadonlyArray<{x:number, y:number}>} points
 * @returns {Array<{x:number, y:number}>}
 */
export function convexHullXY(points) {
  const pts = [...points].map(p => ({ x: p.x, y: p.y }))
    .sort((a, b) => (a.x - b.x) || (a.y - b.y))
  if (pts.length < 3) return pts
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * Whether a ring is convex on XY. Collinear vertices do not break convexity; a
 * ring with no area is not a plate and is not convex.
 * @param {ReadonlyArray<{x:number, y:number}>} poly
 * @returns {boolean}
 */
export function isConvexXY(poly) {
  const n = poly.length
  if (n < 3 || signedAreaXY(poly) === 0) return false
  let sign = 0
  for (let i = 0; i < n; i++) {
    const c = cross(poly[i], poly[(i + 1) % n], poly[(i + 2) % n])
    if (c === 0) continue
    const s = Math.sign(c)
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

/**
 * The area two CONVEX rings share on XY (Sutherland–Hodgman: clip `a` by every
 * edge of `b`). Throws on a ring that is not convex — the clip is only exact for
 * a convex clipper, and a wrong area would read as a decided overlap. Callers ask
 * `isConvexXY` first and say "cannot tell" for the rest (ADR-170 S3 Q5).
 * @param {ReadonlyArray<{x:number, y:number}>} a
 * @param {ReadonlyArray<{x:number, y:number}>} b
 * @returns {number} ≥ 0
 */
export function convexOverlapAreaXY(a, b) {
  if (!isConvexXY(a) || !isConvexXY(b)) {
    throw new Error('convexOverlapAreaXY: both rings must be convex (ask isConvexXY first)')
  }
  const clipper = signedAreaXY(b) > 0 ? [...b] : [...b].reverse()
  let out = [...a]
  for (let i = 0, n = clipper.length; i < n && out.length > 0; i++) {
    const p = clipper[i], q = clipper[(i + 1) % n]
    const inside = (v) => cross(p, q, v) >= 0
    const input = out
    out = []
    for (let j = 0, m = input.length; j < m; j++) {
      const cur = input[j], prev = input[(j + m - 1) % m]
      const curIn = inside(cur), prevIn = inside(prev)
      if (curIn !== prevIn) out.push(intersect(prev, cur, p, q))
      if (curIn) out.push(cur)
    }
  }
  return out.length < 3 ? 0 : Math.abs(signedAreaXY(out))
}

/** Where segment s0→s1 crosses the infinite line p→q (called only when it does). */
function intersect(s0, s1, p, q) {
  const d1 = cross(p, q, s0), d2 = cross(p, q, s1)
  const t = d1 / (d1 - d2)
  return { x: s0.x + (s1.x - s0.x) * t, y: s0.y + (s1.y - s0.y) * t }
}
