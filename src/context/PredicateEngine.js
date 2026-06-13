/**
 * PredicateEngine — approximate geometric acceptance predicates (ADR-049 Phase 3,
 * joining the predicate engine deferred in ADR-046 §4.2).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3) Functions
 * return `{ pass, violations }` value objects and NEVER throw on `pass:false`
 * (a failing predicate is a normal result). The only thrown error is
 * `MalformedPredicate`, for a structurally invalid predicate object — mirroring
 * the `NotPromotable`/bail discipline in AdmissiblePromotion. (PHILOSOPHY #11:
 * a malformed predicate must surface as a validator error, never be swallowed.)
 *
 * Predicate coordinates are literal numbers in this slice — `$fact`/`$decision`
 * marker resolution does not run inside predicate objects (the validator runs
 * before resolution). Fact-backed values flow through `acceptance.requires`,
 * which blocks the check upstream when a required fact is assumed/unknown.
 *
 * Supported kinds:
 *   no_overlap   — every pair of AABBs keeps a minimum clearance; optionally all
 *                  boxes stay inside a `within` AABB. (ADR-046 §4.2 example.)
 *   reach_covers — every target point lies inside a reach envelope (sphere or
 *                  z-axis cylinder).
 *   swept_volume — a capsule chain (radius around a polyline path) keeps a
 *                  minimum clearance from each obstacle AABB. Conservative
 *                  sampling approximation, not an exact swept solid.
 *
 * @module context/PredicateEngine
 */

import {
  aabbClearance,
  pointAabbDistance,
  pointInSphere,
  pointInCylinder,
} from './RegionGeometry.js'

/** Predicate kinds the engine can execute. */
export const PREDICATE_KINDS = ['no_overlap', 'reach_covers', 'swept_volume']

/** Samples per path segment for the swept-volume capsule-chain approximation. */
const SWEPT_SAMPLES_PER_SEGMENT = 16

/** Thrown when a predicate object is structurally invalid (not on pass:false). */
export class MalformedPredicate extends Error {
  constructor(message) {
    super(message)
    this.name = 'MalformedPredicate'
  }
}

/**
 * Evaluate a structured acceptance predicate.
 *
 * @param {object} predicate — { kind, ... } (see module doc for per-kind shape)
 * @returns {{ kind: string, pass: boolean, violations: object[], detail?: object }}
 * @throws {MalformedPredicate}
 */
export function evaluatePredicate(predicate) {
  if (!predicate || typeof predicate !== 'object') {
    throw new MalformedPredicate('predicate must be an object')
  }
  switch (predicate.kind) {
    case 'no_overlap':   return evalNoOverlap(predicate)
    case 'reach_covers': return evalReachCovers(predicate)
    case 'swept_volume': return evalSweptVolume(predicate)
    default:
      throw new MalformedPredicate(`unknown predicate kind "${predicate.kind}" — use one of: ${PREDICATE_KINDS.join(', ')}`)
  }
}

// ── no_overlap ────────────────────────────────────────────────────────────────

function evalNoOverlap({ boxes, clearance = 0, within, axes }) {
  if (!Array.isArray(boxes) || boxes.length === 0) {
    throw new MalformedPredicate('no_overlap: boxes must be a non-empty array')
  }
  const useAxes = axes ?? inferAxes(boxes[0])
  for (const b of boxes) assertBox(b, useAxes, 'no_overlap')

  const violations = []

  // Every unordered pair must keep `clearance` apart. Deterministic order: the
  // boxes are visited in input order, i < j.
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const gap = aabbClearance(boxes[i], boxes[j], useAxes)
      if (gap < clearance) {
        violations.push({
          kind: 'pair',
          a: boxes[i].ref ?? `box[${i}]`,
          b: boxes[j].ref ?? `box[${j}]`,
          clearance: gap,
          required: clearance,
        })
      }
    }
  }

  // Optional containment: every box inside `within`.
  if (within) {
    assertBox(within, useAxes, 'no_overlap.within')
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]
      const outside = useAxes.some(ax => b[ax][0] < within[ax][0] || b[ax][1] > within[ax][1])
      if (outside) {
        violations.push({ kind: 'within', a: b.ref ?? `box[${i}]` })
      }
    }
  }

  return { kind: 'no_overlap', pass: violations.length === 0, violations }
}

// ── reach_covers ────────────────────────────────────────────────────────────

function evalReachCovers({ envelope, targets }) {
  if (!envelope || typeof envelope !== 'object') {
    throw new MalformedPredicate('reach_covers: envelope must be an object')
  }
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new MalformedPredicate('reach_covers: targets must be a non-empty array')
  }

  let covered
  if (envelope.shape === 'sphere') {
    if (typeof envelope.radius !== 'number' || !envelope.center) {
      throw new MalformedPredicate('reach_covers: sphere envelope needs center + radius')
    }
    covered = p => pointInSphere(p, envelope.center, envelope.radius)
  } else if (envelope.shape === 'cylinder') {
    if (typeof envelope.radius !== 'number' || !envelope.center
        || typeof envelope.zMin !== 'number' || typeof envelope.zMax !== 'number') {
      throw new MalformedPredicate('reach_covers: cylinder envelope needs center + radius + zMin + zMax')
    }
    covered = p => pointInCylinder(p, envelope.center, envelope.radius, envelope.zMin, envelope.zMax)
  } else {
    throw new MalformedPredicate(`reach_covers: envelope.shape "${envelope.shape}" — use "sphere" or "cylinder"`)
  }

  const violations = []
  targets.forEach((t, i) => {
    if (!covered(t)) violations.push({ kind: 'uncovered', target: t.ref ?? `target[${i}]` })
  })
  return { kind: 'reach_covers', pass: violations.length === 0, violations }
}

// ── swept_volume ────────────────────────────────────────────────────────────

function evalSweptVolume({ path, radius = 0, obstacles, clearance = 0 }) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new MalformedPredicate('swept_volume: path must have ≥2 waypoints')
  }
  if (!Array.isArray(obstacles)) {
    throw new MalformedPredicate('swept_volume: obstacles must be an array')
  }

  const violations = []
  obstacles.forEach((obs, i) => {
    const axes = inferAxes(obs)
    assertBox(obs, axes, 'swept_volume.obstacle')
    let minGap = Infinity
    // Sample points along each segment; capsule-chain distance ≈ min over
    // samples of (point-to-AABB distance − tool radius). Conservative.
    for (let s = 0; s < path.length - 1; s++) {
      const a = path[s], b = path[s + 1]
      for (let k = 0; k <= SWEPT_SAMPLES_PER_SEGMENT; k++) {
        const t = k / SWEPT_SAMPLES_PER_SEGMENT
        const p = {
          x: (a.x ?? 0) + t * ((b.x ?? 0) - (a.x ?? 0)),
          y: (a.y ?? 0) + t * ((b.y ?? 0) - (a.y ?? 0)),
          z: (a.z ?? 0) + t * ((b.z ?? 0) - (a.z ?? 0)),
        }
        const gap = pointAabbDistance(p, obs, axes) - radius
        if (gap < minGap) minGap = gap
      }
    }
    if (minGap < clearance) {
      violations.push({ kind: 'obstacle', obstacle: obs.ref ?? `obstacle[${i}]`, clearance: minGap, required: clearance })
    }
  })
  return { kind: 'swept_volume', pass: violations.length === 0, violations }
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Axes present on a box object, in canonical order. */
function inferAxes(box) {
  return ['x', 'y', 'z'].filter(ax => Array.isArray(box?.[ax]))
}

function assertBox(box, axes, where) {
  for (const ax of axes) {
    const iv = box?.[ax]
    if (!Array.isArray(iv) || iv.length !== 2 || typeof iv[0] !== 'number' || typeof iv[1] !== 'number' || iv[0] > iv[1]) {
      throw new MalformedPredicate(`${where}: axis "${ax}" must be [lo, hi] with lo ≤ hi`)
    }
  }
}
