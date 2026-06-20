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
 *   robot_reach  — every taught TCP target is reachable (and optionally keeps a
 *                  minimum singularity/reach margin). (ADR-053 Phase 1 §7.1/§9.)
 *   collision_free — no pre-baked contact pair drops below the required
 *                  clearance. (ADR-053 Phase 1 §7.2/§7.3/§9.)
 *
 * ADR-053 boundary: `robot_reach`/`collision_free` consume *pre-baked
 * measurement-instrument operands* — `targets[].reachable`/`margin` and
 * `contacts[].clearance` are produced by the future RoboticsService (FK/IK/BVH);
 * this engine performs only the pure formal evaluation that collapses them to a
 * boolean (the characteristic function of the admissible set — ADR-053 §1.1).
 * No THREE, no geometry solving here.
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
export const PREDICATE_KINDS = ['no_overlap', 'reach_covers', 'swept_volume', 'robot_reach', 'collision_free']

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
    case 'no_overlap':     return evalNoOverlap(predicate)
    case 'reach_covers':   return evalReachCovers(predicate)
    case 'swept_volume':   return evalSweptVolume(predicate)
    case 'robot_reach':    return evalRobotReach(predicate)
    case 'collision_free': return evalCollisionFree(predicate)
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

// ── robot_reach (ADR-053 Phase 1) ────────────────────────────────────────────

function evalRobotReach({ targets, marginMin }) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new MalformedPredicate('robot_reach: targets must be a non-empty array')
  }
  if (marginMin !== undefined && typeof marginMin !== 'number') {
    throw new MalformedPredicate('robot_reach: marginMin must be a number when present')
  }

  const violations = []
  targets.forEach((t, i) => {
    if (!t || typeof t !== 'object' || typeof t.reachable !== 'boolean') {
      throw new MalformedPredicate(`robot_reach: target[${i}] must have a boolean "reachable"`)
    }
    const ref = t.ref ?? `target[${i}]`
    if (!t.reachable) {
      violations.push({ kind: 'unreachable', target: ref })
      return
    }
    // Reachable but below the required singularity/reach margin (only when both
    // a threshold and a measured margin are present — a missing margin is not a
    // failure, the reachable flag already passed).
    if (marginMin !== undefined && typeof t.margin === 'number' && t.margin < marginMin) {
      violations.push({ kind: 'low_margin', target: ref, margin: t.margin, required: marginMin })
    }
  })
  return { kind: 'robot_reach', pass: violations.length === 0, violations }
}

// ── collision_free (ADR-053 Phase 1) ──────────────────────────────────────────

function evalCollisionFree({ scope, contacts, clearance = 0 }) {
  if (scope !== undefined && scope !== 'self' && scope !== 'env') {
    throw new MalformedPredicate('collision_free: scope must be "self" or "env" when present')
  }
  if (!Array.isArray(contacts)) {
    throw new MalformedPredicate('collision_free: contacts must be an array')
  }
  if (typeof clearance !== 'number') {
    throw new MalformedPredicate('collision_free: clearance must be a number')
  }

  const violations = []
  contacts.forEach((c, i) => {
    if (!c || typeof c !== 'object' || typeof c.clearance !== 'number') {
      throw new MalformedPredicate(`collision_free: contact[${i}] must have a numeric "clearance"`)
    }
    // A negative clearance is penetration; below the required clearance is a
    // violation. An empty contacts list is a legitimate pass (nothing touches).
    if (c.clearance < clearance) {
      violations.push({
        kind: 'contact',
        a: c.a ?? `contact[${i}].a`,
        b: c.b ?? `contact[${i}].b`,
        clearance: c.clearance,
        required: clearance,
      })
    }
  })
  return { kind: 'collision_free', pass: violations.length === 0, violations }
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
