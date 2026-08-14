/**
 * Coarse grasp-search stand-in (ADR-117) — a TEST DOUBLE for the backend layer.
 *
 * ## What this is, and where it lives
 *
 * This file is deliberately NOT under `src/`. The repository's scope boundary
 * (CLAUDE.md) puts every *solution* to a robotics constraint — reach, IK, grasp
 * stability, visibility, interference — in `core/`, and lets the front declare
 * and display only. This module does solve those constraints, crudely, so it
 * lives on the backend side of the line: it is a stand-in for `core/`, reached
 * through the same wire contract, never imported by `src/`. `mocks/` is to
 * `core/` what `templates/` is to the contract — fixture material belonging to
 * the layer it stands in for.
 *
 * ## What it is FOR
 *
 * Letting someone exercise the grasp UX from a static URL, with no Python, no
 * BFF and no install. It is not an approximation anyone should trust
 * numerically: the ranking, the near-miss distances and the score values are
 * this file's invention, and they will disagree with `core/`. What it reproduces
 * faithfully is the *shape* of the answer:
 *
 *   - the response conforms to `grasp-search-response.schema.json`;
 *   - the funnel identity holds
 *     (`candidatesGenerated = Σ rejections + feasible`);
 *   - the stages are EXCLUSIVE and short-circuit in `core/`'s measured
 *     cheapest-first order (reach → IK → grasp → visibility → interference), so
 *     a multiply-infeasible candidate is attributed to the same single stage the
 *     real engine would attribute it to;
 *   - undeclared camera / gripper make their stages vacuously true, exactly as
 *     the contract specifies.
 *
 * Those are the properties the UI derives its presentation from, so they are the
 * ones a UX session must not be lied to about. The conformance tests next door
 * are what keep this list true rather than aspirational.
 *
 * Pure module: no fetch, no clock, no randomness. Same request in, same response
 * out — a reviewer's screenshot is reproducible (原則 #3).
 */

/** Stages, in the engine's measured cheapest-first short-circuit order. */
const STAGE = Object.freeze({
  REACH:        'rejectedByReach',
  IK:           'rejectedByIk',
  GRASP:        'rejectedByGrasp',
  VISIBILITY:   'rejectedByVisibility',
  INTERFERENCE: 'rejectedByInterference',
})

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (a) => Math.sqrt(dot(a, a))

/** Unit vector, or null when the input is degenerate (never a fabricated axis). */
function unit(v) {
  const n = norm(v)
  return n > 1e-12 ? scale(v, 1 / n) : null
}

/**
 * Shortest distance from a segment to a point — the primitive both the sightline
 * and the approach-path checks use.
 */
function segmentPointDistance(a, b, p) {
  const ab = sub(b, a)
  const len2 = dot(ab, ab)
  if (len2 < 1e-12) return norm(sub(p, a))
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2))
  return norm(sub(p, add(a, scale(ab, t))))
}

/**
 * Quaternion → forward (+X) axis, matching the contract's TCP convention.
 */
function forwardAxis(q) {
  const [x, y, z, w] = q
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)]
}

/**
 * Build the identity quaternion that points the tool along `approach`.
 * Presentation derives the visible gripper pose from this; it is a plausible
 * orientation, not a solved wrist configuration.
 */
function orientationFor(approach) {
  const f = [1, 0, 0]
  const d = dot(f, approach)
  if (d > 1 - 1e-9)  return [0, 0, 0, 1]
  if (d < -1 + 1e-9) return [0, 0, 1, 0]
  const axis = [
    f[1] * approach[2] - f[2] * approach[1],
    f[2] * approach[0] - f[0] * approach[2],
    f[0] * approach[1] - f[1] * approach[0],
  ]
  const u = unit(axis)
  if (!u) return [0, 0, 0, 1]
  const angle = Math.acos(Math.max(-1, Math.min(1, d)))
  const s = Math.sin(angle / 2)
  return [u[0] * s, u[1] * s, u[2] * s, Math.cos(angle / 2)]
}

/**
 * Read the judgement parameters, honouring the contract's precedence: `plan{}`
 * wins over the legacy `robot.*` fallback (ADR-084 §4). An undeclared bound is
 * left unbounded rather than guessed — the same rule `core/` follows, and the
 * reason an undeclared reach envelope rejects nothing.
 */
function judgement(graspSearch) {
  const plan  = graspSearch.plan  ?? {}
  const robot = graspSearch.robot ?? {}
  const pick = (key, fallback) => {
    if (plan[key]  != null) return Number(plan[key])
    if (robot[key] != null) return Number(robot[key])
    return fallback
  }
  return {
    reachMin:  pick('reachMin', 0),
    reachMax:  pick('reachMax', Number.POSITIVE_INFINITY),
    coneHalf:  pick('wristConeHalfAngle', Math.PI),
  }
}

/**
 * A reach envelope that COVERS every declared sample, derived from the request.
 *
 * The point of this is the **positive control** for ADR-120. Everywhere else the
 * front never declares a reach envelope, so `reach_margin` is always absent —
 * and an absence you can never make appear is indistinguishable from a key this
 * stub simply does not know how to emit. A reviewer on GitHub Pages has no
 * `plan{}` form and no `curl`, so without this they can only ever see one half
 * of the claim (原則 #31 — the negative control alone proves nothing).
 *
 * Derived, not constant: the stub is unit-agnostic (a millimetre layout and a
 * metre layout must both work), so the bounds are scaled from the sample
 * distances rather than hard-coded. The margin is deliberately generous on both
 * sides so that the reach stage rejects NOTHING — the A/B must differ in the
 * declaration alone, not in which candidates survived.
 *
 * @param {object} graspSearch  the request's `graspSearch` declaration
 * @returns {{reachMin: number, reachMax: number}|null} null when there is
 *   nothing to cover (no samples → no distances → no basis, and inventing one
 *   would be the very guess this ADR is about)
 */
export function envelopeCoveringSamples(graspSearch) {
  const base    = graspSearch?.robot?.base ?? [0, 0, 0]
  const samples = graspSearch?.target?.surfaceSamples ?? []
  const distances = samples
    .map(s => norm(sub(s.point, base)))
    .filter(d => Number.isFinite(d) && d > 0)
  if (!distances.length) return null
  return {
    reachMin: Math.min(...distances) * 0.5,
    reachMax: Math.max(...distances) * 1.5,
  }
}

/**
 * The objective values this stand-in can produce, keyed by `core/`'s registered
 * names. Only the objectives the request actually weights are returned, so an
 * unweighted objective does not appear in the breakdown — mirroring
 * `evaluate_objectives`, which returns only requested names.
 *
 * A weighted objective this stub COULD NOT EVALUATE (`null`) is left out too, so
 * "not measured" is carried by the ABSENCE OF THE KEY rather than by a 0 that is
 * indistinguishable from a genuinely bad score (ADR-120 D2). The stub reproduced
 * the very defect ADR-120 names: with no reach envelope declared it reported
 * `reach_margin: 0`, which reads as "no margin left" when it means "nobody
 * measured".
 */
function objectiveScores(weights, { reachMargin, clearance, stability }) {
  const all = {
    reach_margin:       reachMargin,
    approach_clearance: clearance,
    grasp_stability:    stability,
  }
  const out = {}
  for (const name of Object.keys(weights ?? {})) {
    if (!(name in all)) continue
    const value = all[name]
    if (value == null) continue          // weighted, but not evaluable → no key
    out[name] = Math.max(0, Math.min(1, value))
  }
  return out
}

/**
 * Weighted average over the objectives that were ACTUALLY EVALUATED (ADR-120 D1).
 *
 * The unevaluated ones are out of the numerator AND the denominator, so weighting
 * an objective this stub cannot compute does not drag the absolute score down —
 * which is what makes `totalScore` comparable between runs, as the contract
 * claims ("absolute basis, so scores are comparable across requests").
 *
 * Nothing evaluated at all → 0, and `objectiveScores` is then empty: the empty
 * breakdown is what distinguishes it from a scored-but-bad candidate (a 0 with
 * keys present). The stub's numbers are its own invention either way — what is
 * held to the contract is this SHAPE, never the arithmetic (ADR-117).
 */
function totalScoreOf(scores, weights) {
  let weighted   = 0
  let weightSum  = 0
  for (const [name, value] of Object.entries(scores)) {
    const w = Number(weights?.[name] ?? 0)
    weighted  += value * w
    weightSum += w
  }
  return weightSum > 0 ? weighted / weightSum : 0
}

/**
 * Solve a grasp-search request, coarsely.
 *
 * @param {object} request  a contract-shaped GraspSearchRequest
 * @param {number} contractVersion  stamped onto the response
 * @returns {object} a contract-shaped GraspSearchResponse
 */
export function stubSolve(request, contractVersion) {
  const gs        = request?.graspSearch ?? {}
  const base      = gs.robot?.base ?? [0, 0, 0]
  const samples   = gs.target?.surfaceSamples ?? []
  const obstacles = gs.obstacles ?? []
  const camera    = gs.camera  ?? null
  const gripper   = gs.gripper ?? null
  const weights   = gs.objectiveWeights ?? {}
  const topN      = Number.isFinite(gs.topN) && gs.topN > 0 ? Math.floor(gs.topN) : 5
  const { reachMin, reachMax, coneHalf } = judgement(gs)

  // The pre-grasp standoff and the clearance reference are expressed in the
  // request's own length unit, which the contract never names. Deriving them
  // from the scene's own scale keeps the stub unit-agnostic: a millimetre layout
  // and a metre layout both get a standoff proportional to what they contain,
  // instead of a hard-coded constant that is either invisible or enormous.
  const spread = samples.length
    ? Math.max(...samples.map(s => norm(sub(s.point, base))))
    : 1
  const preGraspDistance   = spread * 0.1
  const clearanceReference = spread * 0.05

  const counts = {
    rejectedByReach: 0, rejectedByIk: 0, rejectedByGrasp: 0,
    rejectedByVisibility: 0, rejectedByInterference: 0,
  }
  let reachNearestMiss     = null
  let occlusionNearestMiss = null
  let graspNearestMiss     = null   // { kind, shortfall } — contract v5 (ADR-118)
  const keepMin = (cur, v) => (cur == null || v < cur ? v : cur)

  const feasible = []
  // Counted rather than assumed to equal `samples.length`: a degenerate sample
  // generates no candidate, and folding it into the total would break the
  // funnel identity the UI derives every bar width from.
  let generated = 0

  for (const sample of samples) {
    const point   = sample.point
    const outward = unit(sample.normal)
    if (!outward) continue                       // a normal-less sample defines no approach
    generated += 1
    const approach = scale(outward, -1)          // face-on: approach opposes the normal
    const preGrasp = add(point, scale(outward, preGraspDistance))
    const distance = norm(sub(point, base))

    // ── reach ────────────────────────────────────────────────────────────────
    if (distance < reachMin || distance > reachMax) {
      counts[STAGE.REACH] += 1
      const miss = distance > reachMax ? distance - reachMax : reachMin - distance
      reachNearestMiss = keepMin(reachNearestMiss, miss)
      continue
    }

    // ── IK (wrist cone against the declared TCP axis, else the base proxy) ────
    const reference = gs.robot?.tcpOrientation
      ? unit(forwardAxis(gs.robot.tcpOrientation))
      : unit(sub(point, base))
    if (reference) {
      const angle = Math.acos(Math.max(-1, Math.min(1, dot(reference, approach))))
      if (angle > coneHalf) { counts[STAGE.IK] += 1; continue }
    }

    // ── grasp gate (vacuously true with no gripper declared) ─────────────────
    // The "required opening" a parallel jaw needs is stood in for by the
    // clearance reference; the real gate searches contact pairs on the mesh.
    // The hand kind decides WHICH quantity is measured (ADR-118) — a jaw misses by
    // an opening shortfall, a cup by a seal-patch shortfall. Reporting one as the
    // other is the failure the contract union exists to prevent, so the stub keeps
    // the two apart too.
    let graspSlack = 1
    if (gripper) {
      const required = clearanceReference
      if (gripper.kind === 'suction') {
        const cup = Number(gripper.cupDiameter ?? 0)
        // Coarse stand-in for "is there a flat patch this big": the target's own
        // sample spread around the contact point.
        const patch = required * 2
        if (cup > patch) {
          counts[STAGE.GRASP] += 1
          const shortfall = cup - patch
          if (graspNearestMiss == null || shortfall < graspNearestMiss.shortfall) {
            graspNearestMiss = { kind: 'sealPatch', shortfall }
          }
          continue
        }
        graspSlack = patch > 0 ? Math.min(1, (patch - cup) / patch) : 1
      } else {
        const maxOpening = Number(gripper.maxOpening ?? 0)
        if (maxOpening < required) {
          counts[STAGE.GRASP] += 1
          const shortfall = required - maxOpening
          if (graspNearestMiss == null || shortfall < graspNearestMiss.shortfall) {
            graspNearestMiss = { kind: 'opening', shortfall }
          }
          continue
        }
        graspSlack = required > 0 ? Math.min(1, (maxOpening - required) / required) : 1
      }
    }

    // ── visibility (vacuously true with no camera declared) ──────────────────
    if (camera) {
      const eye  = camera.position ?? [0, 0, 0]
      const axis = unit(camera.viewAxis ?? [0, 0, -1])
      const toPoint = unit(sub(point, eye))
      const fov = Number(camera.fovHalfAngle ?? Math.PI)
      let rejected = false
      if (axis && toPoint && Math.acos(Math.max(-1, Math.min(1, dot(axis, toPoint)))) > fov) {
        rejected = true                          // outside the field of view: no depth to report
      } else {
        for (const o of obstacles) {
          const d = segmentPointDistance(eye, point, o.center)
          if (d < o.radius) {
            rejected = true
            occlusionNearestMiss = keepMin(occlusionNearestMiss, o.radius - d)
            break
          }
        }
      }
      if (rejected) { counts[STAGE.VISIBILITY] += 1; continue }
    }

    // ── interference along the approach path ─────────────────────────────────
    let minClearance = Number.POSITIVE_INFINITY
    let blocked = false
    for (const o of obstacles) {
      const d = segmentPointDistance(preGrasp, point, o.center)
      if (d < o.radius) { blocked = true; break }
      minClearance = Math.min(minClearance, d - o.radius)
    }
    if (blocked) { counts[STAGE.INTERFERENCE] += 1; continue }

    // ── survived every stage: score it ───────────────────────────────────────
    const span        = reachMax === Number.POSITIVE_INFINITY ? 0 : (reachMax - reachMin) / 2
    // No declared envelope → the margin is NOT MEASURED, which is a different
    // fact from "no margin left" (ADR-120). `null` travels as an absent key.
    const reachMargin = span > 0
      ? 1 - Math.abs(distance - (reachMin + span)) / span
      : null
    // `1` here IS an evaluation, not a stand-in: nothing declared nearby means
    // the approach is unobstructed, which the stub did measure.
    const clearance = Number.isFinite(minClearance) && clearanceReference > 0
      ? Math.min(1, minClearance / clearanceReference)
      : 1
    const scores = objectiveScores(weights, {
      reachMargin, clearance, stability: graspSlack,
    })
    const totalScore = totalScoreOf(scores, weights)

    feasible.push({
      pose: {
        kind:  'endEffector',
        frame: { position: preGrasp, orientation: orientationFor(approach) },
      },
      score: {
        withinReach: true, visible: true, ikSolvable: true,
        interferenceFree: true, graspable: true,
        objectiveScores: scores,
        totalScore: Math.max(0, totalScore),
      },
    })
  }

  feasible.sort((a, b) => b.score.totalScore - a.score.totalScore)
  const candidates = feasible.slice(0, topN).map((c, i) => ({ rank: i + 1, ...c }))

  return {
    contractVersion,
    candidates,
    diagnostics: {
      candidatesGenerated: generated,
      ...counts,
      feasible: feasible.length,
      returned: candidates.length,
      reachNearestMiss,
      occlusionNearestMiss,
      graspNearestMiss,
    },
  }
}
