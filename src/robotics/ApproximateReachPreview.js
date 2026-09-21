/**
 * ApproximateReachPreview — the CLIENT's non-authoritative arm preview (ADR-144).
 *
 * Pure computation: no I/O, no Three.js, no DOM (PHILOSOPHY #3), and no `three`
 * import, so it loads under bare `node --test` like the rest of `src/robotics/`.
 *
 * ## What this is, and what it is deliberately not
 *
 * `core/`'s `UniversalRobotsIkSolver` is the ONE place a joint configuration is
 * DECIDED (ADR-127/135). It reaches the client as `score.reachSolution`, a closed
 * kind union on the wire. On GitHub Pages there is no `core/` — the stub answers
 * `{kind:'undeclared'}` honestly, and ADR-135 correctly draws nothing rather than
 * invent an arm.
 *
 * This module fills that gap WITHOUT becoming a second solver. It writes no
 * kinematic equations: it samples the joint space with `sampleConfigs` and
 * measures where the hand lands with `forwardKinematics` — the very FK-sampling
 * measurement instrument ADR-053 §7.1 already blessed for the front — and keeps
 * the sampled configuration whose hand lands nearest the candidate's pose. The
 * refinement rounds re-run that same grid inside a narrowing window; nothing here
 * inverts anything. The analytic UR solution stays in `core/` alone (ADR-144
 * rejected option B precisely so one calculation does not live in two languages).
 *
 * ## Three honesty rules this module exists to keep
 *
 * 1. **The result is not the contract's.** It is `{origin:'clientApproximate'…}`,
 *    NOT a `{kind:'solved'…}` — a different discriminator and a different shape,
 *    so the wire's `reachSolution` schema rejects it structurally (asserted with
 *    ajv in the test). It never rides the wire and is never sent to `core/`.
 * 2. **Beyond tolerance is `null`, not "the closest one".** A configuration whose
 *    hand misses by 40 cm is not a rough preview, it is a wrong arm wearing the
 *    look of an answer (PHILOSOPHY #11 — no silent fallback).
 * 3. **Only the hand's POSITION is matched.** Orientation is not part of the
 *    objective, so the previewed wrist can be turned any way that puts the flange
 *    in the right place. That is exactly why the preview must be drawn as an
 *    unverified ghost (ADR-144 D4) and never as a solution.
 *
 * Collision, singularity and self-interference are not considered AT ALL —
 * solving those is `core/`'s責務 and always will be (CLAUDE.md scope boundary).
 *
 * @module robotics/ApproximateReachPreview
 */

import { MalformedChain, forwardKinematics, movableJoints, quatRotateVec, sampleConfigs } from './Kinematics.js'
import { mToMM, mmToM } from '../domain/worldUnits.js'

/**
 * The search budget and the honesty threshold, in one declared place.
 *
 * `COARSE_SAMPLES: 4` is not a rounded-up 3 or a rounded-down 5. Joint spans here
 * are ±2π, and an ODD count lands on both −2π and +2π (the same rotation) plus 0:
 * 5 samples per joint buy only 3 distinct arm poses. Measured over 100 random
 * reachable targets, 4 coarse samples put 98% of previews within 1 mm while 5 put
 * only 64% within 10 mm — the coarser-looking grid is the better instrument.
 *
 * `TOLERANCE_MM` is an ABSOLUTE PHYSICAL LENGTH (ADR-137 D1's third kind); the
 * conversion to the chain's meters happens through `worldUnits`, never inline.
 */
export const APPROXIMATE_PREVIEW = Object.freeze({
  /** How far the previewed hand may miss the candidate pose before we draw nothing. */
  TOLERANCE_MM: 10,
  /** Samples per influential joint in the first, whole-space grid. */
  COARSE_SAMPLES: 4,
  /** How many of the coarse grid's best configurations are refined (multi-start). */
  STARTS: 8,
  /** Halvings of the search window around each start. */
  REFINE_ROUNDS: 12,
  /** Samples per influential joint inside a refinement window. */
  REFINE_SAMPLES: 3,
})

/** The discriminator of a client-side approximation — deliberately NOT `kind`. */
export const CLIENT_APPROXIMATE = 'clientApproximate'

/**
 * Deterministic probe configurations for the influence test below. Fixed, not
 * random: an instrument whose answer changes between two runs cannot be the input
 * to a preview the user is asked to trust as "roughly this".
 */
const INFLUENCE_PROBES = [0, 0.37, -0.81, 1.23]
const INFLUENCE_NUDGE = 0.41
const INFLUENCE_EPSILON = 1e-9

function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Which movable joints can move the TCP POSITION at all, in chain order.
 *
 * A wrist roll whose axis runs through the flange origin — `wrist_3` on the
 * shipped UR5e skeleton — cannot change where the hand is, only how it is turned.
 * Sampling it anyway multiplies the grid by `COARSE_SAMPLES` for nothing (a 4×
 * cost on this chain), so the grid gives it exactly one sample.
 *
 * MEASURED, not declared: nudging each joint at four fixed configurations and
 * watching the TCP is the same FK instrument the rest of this module uses, so a
 * different URDF answers for itself instead of inheriting a hand-written list
 * that would silently be wrong (§1.1 — no second source for the chain's shape).
 *
 * @param {object} chain
 * @returns {boolean[]} one flag per movable joint, in chain order
 */
export function positionInfluentialJoints(chain) {
  const count = movableJoints(chain).length
  const influential = new Array(count).fill(false)
  for (const base of INFLUENCE_PROBES) {
    const q = new Array(count).fill(0).map((_, i) => base + 0.13 * i)
    const at = forwardKinematics(chain, q).position
    for (let i = 0; i < count; i++) {
      if (influential[i]) continue
      const nudged = [...q]
      nudged[i] += INFLUENCE_NUDGE
      if (distance(forwardKinematics(chain, nudged).position, at) > INFLUENCE_EPSILON) influential[i] = true
    }
  }
  return influential
}

/**
 * A world point expressed in a robot base's frame — the conversion the FK chain
 * needs, because `forwardKinematics` walks from the URDF root (the base) while
 * the wire's candidate pose is in world coordinates.
 *
 * Both inputs are METERS (the wire's unit and the URDF's unit agree — ADR-136),
 * so nothing is converted here; this is a frame change, not a unit change. The
 * two are named apart on purpose: a point that arrives without saying which
 * frame it is in is the bug this function exists to make unwritable.
 *
 * @param {readonly number[]} worldPointM  [x,y,z] in world meters
 * @param {readonly number[]} baseM  robot base origin, [x,y,z] in world meters
 * @param {readonly number[]|null|undefined} baseQuat  base orientation [x,y,z,w]
 * @returns {{x:number,y:number,z:number}} the point in the base's frame
 */
export function toBaseFrame(worldPointM, baseM, baseQuat) {
  const d = {
    x: worldPointM[0] - baseM[0],
    y: worldPointM[1] - baseM[1],
    z: worldPointM[2] - baseM[2],
  }
  if (!Array.isArray(baseQuat) || baseQuat.length !== 4) return d
  // Rotate by the conjugate: world → base-local.
  const [x, y, z, w] = baseQuat
  return quatRotateVec({ x: -x, y: -y, z: -z, w }, d)
}

/** A chain whose joint limits are clipped to a window around `q` (frozen joints pinned). */
function windowed(chain, q, halfWidth, influential) {
  let i = -1
  return {
    ...chain,
    joints: chain.joints.map(joint => {
      if ((joint.type ?? 'fixed') === 'fixed') return joint
      i += 1
      const value = q[i] ?? 0
      if (!influential[i]) return { ...joint, limit: { lower: value, upper: value } }
      const lower = joint.limit?.lower ?? -Math.PI
      const upper = joint.limit?.upper ?? Math.PI
      return {
        ...joint,
        limit: {
          lower: Math.max(value - halfWidth, lower),
          upper: Math.min(value + halfWidth, upper),
        },
      }
    }),
  }
}

/** The whole-space grid, with one sample for every joint that cannot move the hand. */
function coarseChain(chain, influential) {
  let i = -1
  return {
    ...chain,
    joints: chain.joints.map(joint => {
      if ((joint.type ?? 'fixed') === 'fixed') return joint
      i += 1
      return influential[i] ? joint : { ...joint, limit: { lower: 0, upper: 0 } }
    }),
  }
}

const countsFor = (influential, samples) => influential.map(f => (f ? samples : 1))

/** How far a configuration is wound away from the zero pose (sum of |angle|). */
const windUp = (q) => q.reduce((sum, v) => sum + Math.abs(v), 0)

/**
 * The same arm, written with the least wound-up angles — a rewrite, not a search.
 *
 * These joints allow ±2π, so the grid can land on a wrist turned 6.1 rad when
 * −0.2 rad is the SAME physical rotation and the same hand position (a revolute
 * joint's FK is invariant under 2π). The sampled value is not wrong, it just
 * reads on screen as a claim about the arm that nobody made. Only wrapped when
 * the equivalent angle is still inside the declared limits — a joint that really
 * cannot be written that way keeps its value rather than being silently moved
 * outside its limit.
 *
 * @param {object} chain @param {readonly number[]} q
 * @returns {number[]} an equivalent configuration, joint for joint
 */
function leastWound(chain, q) {
  return movableJoints(chain).map((joint, i) => {
    const value = q[i] ?? 0
    const type = joint.type ?? 'fixed'
    if (type !== 'revolute' && type !== 'continuous') return value
    let wrapped = Math.atan2(Math.sin(value), Math.cos(value))   // → (−π, π]
    if (Math.abs(wrapped) >= Math.abs(value)) return value
    const lower = joint.limit?.lower
    const upper = joint.limit?.upper
    if (typeof lower === 'number' && typeof upper === 'number' && (wrapped < lower || wrapped > upper)) return value
    return wrapped
  })
}

/**
 * The best sampled configuration for a target the hand should reach, or `null`
 * when no sample lands close enough.
 *
 * @param {object} chain  the FK chain (`parseUrdfChain` output) — METERS
 * @param {readonly number[]|{x:number,y:number,z:number}} target  the hand
 *   position to approach, IN THE CHAIN'S BASE FRAME, meters (`toBaseFrame`)
 * @param {{toleranceMm?: number, budget?: object}} [options]
 * @returns {{origin: 'clientApproximate', joints: number[], toleranceMm: number,
 *   errorMm: number}|null} the approximation, or `null` when the nearest sampled
 *   hand misses by more than the tolerance — the ONLY two answers this function
 *   has. "Closest anyway" is not one of them (PHILOSOPHY #11).
 */
export function approximateJointsFor(chain, target, options = {}) {
  const toleranceMm = options.toleranceMm ?? APPROXIMATE_PREVIEW.TOLERANCE_MM
  const budget = { ...APPROXIMATE_PREVIEW, ...(options.budget ?? {}) }
  const goal = Array.isArray(target)
    ? { x: target[0], y: target[1], z: target[2] }
    : target
  if (!goal || ![goal.x, goal.y, goal.z].every(Number.isFinite)) return null

  let influential
  let starts
  try {
    influential = positionInfluentialJoints(chain)
    const grid = coarseChain(chain, influential)
    const coarse = sampleConfigs(grid, countsFor(influential, budget.COARSE_SAMPLES))
    starts = coarse
      .map(q => ({ q, error: distance(forwardKinematics(chain, q).position, goal) }))
      .sort((a, b) => a.error - b.error)
      .slice(0, budget.STARTS)
  } catch (err) {
    // A chain this instrument cannot sample (too many joints for the grid cap, or
    // a shape `forwardKinematics` rejects) yields NO approximation. It does not
    // yield a guess: the caller draws the rest pose, which claims nothing.
    if (err instanceof MalformedChain) return null
    throw err
  }

  const tolerance = mmToM(toleranceMm)
  const refineCounts = countsFor(influential, budget.REFINE_SAMPLES)
  /** @type {{q: number[], error: number}[]} */
  const refined = []
  for (const start of starts) {
    let q = start.q
    let error = start.error
    // One coarse grid step: the window that contains the cell around this sample.
    let halfWidth = (2 * Math.PI) / Math.max(1, budget.COARSE_SAMPLES - 1)
    for (let round = 0; round < budget.REFINE_ROUNDS; round++) {
      for (const candidate of sampleConfigs(windowed(chain, q, halfWidth, influential), refineCounts)) {
        const e = distance(forwardKinematics(chain, candidate).position, goal)
        if (e < error) { error = e; q = candidate }
      }
      halfWidth /= 2
    }
    // Rewrite before comparing: the wound and the plain form of one arm must not
    // compete with each other as if they were different answers.
    refined.push({ q: leastWound(chain, q), error })
  }

  // Among the arms that put the hand in the right place, prefer the PLAINEST one.
  // The joint limits here are ±2π, so several starts reach the same point with a
  // wrist wound most of a turn: identical as an answer, but read on screen as a
  // strange claim about the arm. This is a presentation preference over an
  // already-accepted set, never a relaxation of the tolerance — the accepting
  // test below is unchanged, and `null` is still the answer when nothing fits.
  const within = refined.filter(r => r.error <= tolerance)
  const best = within.length
    ? within.reduce((a, b) => (windUp(b.q) < windUp(a.q) ? b : a))
    : refined.reduce((a, b) => (b.error < a.error ? b : a), refined[0] ?? null)

  if (!best || best.error > tolerance) return null
  return {
    origin: CLIENT_APPROXIMATE,
    joints: best.q,
    toleranceMm,
    errorMm: mToMM(best.error),
  }
}
