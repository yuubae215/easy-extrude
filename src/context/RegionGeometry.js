/**
 * RegionGeometry — axis-aligned box (AABB) interval math shared by R6 region
 * conflict detection (RequirementGraph) and the acceptance predicate engine
 * (PredicateEngine) (ADR-049 Phase 3).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3) The module
 * deliberately implements its own tiny vector/box math instead of importing
 * `THREE.Box3`/`THREE.Vector3` so the whole `src/context/` tree stays loadable
 * under bare `node --test` with no `three` dependency.
 *
 * Why AABB only (the Helly-2-D caveat):
 *   R6's 1-D conflict logic relies on the Helly property — a family of intervals
 *   has empty common intersection iff some *pair* is disjoint — so one binding
 *   pair (lo = max(mins), hi = min(maxes)) fully describes the conflict. This
 *   does NOT generalise to arbitrary 2-D convex sets (the Helly number in the
 *   plane is 3: three pairwise-overlapping sets can have empty common
 *   intersection). It DOES hold per-axis for axis-aligned boxes, because the
 *   intersection of AABBs decomposes independently per axis:
 *       ∩ AABBᵢ = (∩ intervalsₓ) × (∩ intervalsᵧ) [× (∩ interval_z)]
 *   and the common intersection is empty iff it is empty on ≥1 axis. So region
 *   conflict = run the 1-D interval logic once per axis. Convex-polygon
 *   footprints are out of scope (rejected at R0') because their intersection
 *   needs LP/GJK and breaks the clean per-axis gap-reporting contract.
 *
 * @module context/RegionGeometry
 */

/** Canonical axis ordering for deterministic per-axis output. */
export const AXIS_ORDER = ['x', 'y', 'z']

/**
 * Intersect a family of 1-D intervals under the half-open [min, max) convention
 * (ADR-046): intervals that merely touch (e.g. [200,350] vs [350,600]) do NOT
 * intersect. This is the ONE place the `lo < hi` test lives — both the scalar
 * R6 branch and every region axis call through here so the convention can never
 * diverge (CODE_CONTRACTS: half-open consistency).
 *
 * @param {Array<[number, number]>} intervals
 * @returns {{ lo: number, hi: number, empty: boolean }}
 *   lo = max of the mins, hi = min of the maxes. empty ⇔ !(lo < hi). When empty,
 *   [hi, lo] is the no-man's-land gap between the binding constraints.
 */
export function intersectIntervals(intervals) {
  const lo = Math.max(...intervals.map(iv => iv[0]))
  const hi = Math.min(...intervals.map(iv => iv[1]))
  return { lo, hi, empty: !(lo < hi) }
}

/**
 * Intersect a family of AABB boxes axis by axis. Each box is a plain map
 * { x: [lo,hi], y: [lo,hi], z?: [lo,hi], ... }; only the listed `axes` are
 * considered. Returns the intersection box, the axes on which it is empty, and
 * the per-axis gap for those empty axes. Global emptiness ⇔ emptyAxes.length > 0.
 *
 * @param {object[]} boxes — each carries `[lo,hi]` per axis in `axes`
 * @param {string[]} axes  — e.g. ['x','y'] (2-D footprint) or ['x','y','z'] (3-D)
 * @returns {{ box: object, emptyAxes: string[], gap: object }}
 *   box = { axis: [lo,hi] } per axis; gap = { axis: [hi,lo] } only for empty axes.
 */
export function intersectBoxes(boxes, axes) {
  const box = {}
  const gap = {}
  const emptyAxes = []
  for (const axis of axes) {
    const { lo, hi, empty } = intersectIntervals(boxes.map(b => b[axis]))
    box[axis] = [lo, hi]
    if (empty) {
      emptyAxes.push(axis)
      gap[axis] = [hi, lo]
    }
  }
  return { box, emptyAxes, gap }
}

/**
 * Do two AABBs overlap on every axis? Uses the CLOSED-interval convention
 * (touching counts as contact) — distinct from the half-open conflict
 * convention above, because physical clearance treats a shared face as zero
 * gap, not as separation.
 *
 * @param {object} a — { axis: [lo,hi] }
 * @param {object} b
 * @param {string[]} axes
 * @returns {boolean}
 */
export function aabbOverlap(a, b, axes) {
  return axes.every(axis => a[axis][0] <= b[axis][1] && b[axis][0] <= a[axis][1])
}

/**
 * Signed clearance between two AABBs (Minkowski separation distance):
 *   - positive  → Euclidean distance across the separated axes
 *   - 0         → boxes touch on the binding axis
 *   - negative  → boxes overlap; value is the (largest, i.e. least-negative)
 *                 per-axis separation, a penetration measure
 * `no_overlap` with a required `clearance` is violated when this value is
 * `< clearance` (so overlap and touching both fail a positive clearance).
 *
 * @param {object} a — { axis: [lo,hi] }
 * @param {object} b
 * @param {string[]} axes
 * @returns {number}
 */
export function aabbClearance(a, b, axes) {
  let anySeparated = false
  let sumSq = 0
  let maxSep = -Infinity
  for (const axis of axes) {
    const sep = Math.max(a[axis][0] - b[axis][1], b[axis][0] - a[axis][1])
    if (sep > 0) { anySeparated = true; sumSq += sep * sep }
    if (sep > maxSep) maxSep = sep
  }
  return anySeparated ? Math.sqrt(sumSq) : maxSep
}

/**
 * Euclidean distance from a point to an AABB (0 if inside).
 * @param {{x:number,y:number,z?:number}} p
 * @param {object} box — { axis: [lo,hi] }
 * @param {string[]} axes
 * @returns {number}
 */
export function pointAabbDistance(p, box, axes) {
  let sumSq = 0
  for (const axis of axes) {
    const v = p[axis] ?? 0
    const d = Math.max(box[axis][0] - v, 0, v - box[axis][1])
    sumSq += d * d
  }
  return Math.sqrt(sumSq)
}

/**
 * Is a point inside (or on) a sphere?
 * @param {{x:number,y:number,z?:number}} p
 * @param {{x:number,y:number,z?:number}} center
 * @param {number} r
 * @returns {boolean}
 */
export function pointInSphere(p, center, r) {
  const dx = (p.x ?? 0) - (center.x ?? 0)
  const dy = (p.y ?? 0) - (center.y ?? 0)
  const dz = (p.z ?? 0) - (center.z ?? 0)
  return dx * dx + dy * dy + dz * dz <= r * r
}

/**
 * Is a point inside (or on) a z-axis cylinder (radial in XY, capped in Z)?
 * @param {{x:number,y:number,z?:number}} p
 * @param {{x:number,y:number}} center
 * @param {number} r
 * @param {number} zMin
 * @param {number} zMax
 * @returns {boolean}
 */
export function pointInCylinder(p, center, r, zMin, zMax) {
  const dx = (p.x ?? 0) - (center.x ?? 0)
  const dy = (p.y ?? 0) - (center.y ?? 0)
  const z  = p.z ?? 0
  return dx * dx + dy * dy <= r * r && z >= zMin && z <= zMax
}

/**
 * Shortest distance from point p to the segment ab (3-D).
 * @param {{x:number,y:number,z?:number}} a
 * @param {{x:number,y:number,z?:number}} b
 * @param {{x:number,y:number,z?:number}} p
 * @returns {number}
 */
export function segmentPointDistance(a, b, p) {
  const ax = a.x ?? 0, ay = a.y ?? 0, az = a.z ?? 0
  const bx = b.x ?? 0, by = b.y ?? 0, bz = b.z ?? 0
  const px = p.x ?? 0, py = p.y ?? 0, pz = p.z ?? 0
  const dx = bx - ax, dy = by - ay, dz = bz - az
  const lenSq = dx * dx + dy * dy + dz * dz
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy + (pz - az) * dz) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx, cy = ay + t * dy, cz = az + t * dz
  const ex = px - cx, ey = py - cy, ez = pz - cz
  return Math.sqrt(ex * ex + ey * ey + ez * ez)
}
