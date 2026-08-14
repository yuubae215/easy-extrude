/**
 * robotKinematics — the front's `robot.kinematics` DECLARATION, derived from the
 * URDF the app actually draws (ADR-127 D1/D2, DEF-030).
 *
 * ## Why this module exists
 *
 * ADR-127 built a real closed-form UR inverse-kinematics solver in `core/` and
 * wired it behind a declaration: `robot.kinematics` present ⇒ analytic IK, absent
 * ⇒ the old wrist-cone proxy. The front never sent the declaration, so the solver
 * was correct, tested, and **unreachable from the screen** — the ADR said so in
 * its own Consequences ("この ADR の価値は届いていない"). This module is the
 * missing half.
 *
 * ## Derived, not copied (§1.1)
 *
 * ADR-127 accepted a redundancy it did not want: the same six lengths would live
 * both in `public/robot/skeleton_arm.urdf` (what the front DRAWS) and in whatever
 * the front SENDS, with no way to notice them drifting apart. DEF-030 planned to
 * close that with a test. This closes it one step harder — the six numbers are
 * READ OUT OF THE URDF, so there is no second copy to drift. The test then pins
 * them to the published UR5e values, which is what makes a URDF edit that changes
 * the arm loud instead of silent.
 *
 * ## The kind is a structural claim, so it is structurally checked
 *
 * `kind: 'universalRobots'` asserts axes 2/3/4 parallel and an orthogonal wrist —
 * that is what makes a closed form exist at all. Emitting the kind for a chain
 * that is not shaped that way would hand `core/` six numbers for an arm nobody
 * has, and the answer would look exactly like a correct one. So the shape is
 * verified before the kind is claimed, and a chain that fails simply yields no
 * declaration (the naive cone judgement stays, which is ADR-127 D3's safe
 * default) rather than a confident lie.
 *
 * Pure module (no THREE / no DOM). @module domain/robotKinematics
 */

import { parseUrdfChain } from '../robotics/UrdfChain.js'
import { quatFromRpy, quatMul, quatRotateVec, movableJoints } from '../robotics/Kinematics.js'

/** The contract's kind for a UR-style 6-axis arm (ADR-127 D1). */
export const KINEMATICS_KIND_UR = 'universalRobots'

/**
 * How many movable joints a UR has. Not a tunable: the closed form is derived for
 * this exact structure, so a 7-axis chain is a different arm, not a longer one.
 */
const UR_JOINT_COUNT = 6

/** Direction cosine tolerance for "parallel" / "orthogonal" in the structure check. */
const AXIS_EPS = 1e-6

/**
 * **The declared flange convention** (ADR-127 D6, `FLANGE_Z_IS_APPROACH`): the
 * tool flange's local +Z points out of the flange face, along the approach.
 *
 * This is a DECLARATION, not a derivation — which way a flange faces is an
 * agreement outside the wire, and ADR-127 warns that a self-consistent wrong
 * agreement passes every round-trip inside `core/`. The reconciliation has to
 * happen against something outside that loop, and the only such thing is the
 * geometry the front DRAWS: `skeleton_arm.urdf` puts the flange face at +Z of
 * `wrist_3_link`. `RobotKinematicsDeclaration.test.js` reads that visual back out
 * of the URDF and asserts it lies on this axis, so flipping the drawn flange
 * breaks the build instead of quietly inverting every grasp approach.
 */
export const FLANGE_APPROACH_AXIS = Object.freeze({ x: 0, y: 0, z: 1 })

/** Thrown never — kept as the named reason a chain yields no declaration. */
export const NOT_UR_REASONS = Object.freeze({
  JOINT_COUNT:  'joint-count',
  AXIS_LOCAL_Z: 'axis-not-local-z',
  STRUCTURE:    'structure',
  WRIST_OFFSET: 'wrist-offset',
})

/** Add two vec3s. */
const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
/** |v| */
const norm = (v) => Math.hypot(v.x, v.y, v.z)
/** a · b */
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const vec = (xyz) => ({ x: xyz?.[0] ?? 0, y: xyz?.[1] ?? 0, z: xyz?.[2] ?? 0 })

/**
 * Walk the chain at q = 0, collecting for each MOVABLE joint:
 *   `local`   — the displacement from the previous movable joint, expressed in
 *               the frame that joint's own axis is the +Z of. This is the frame
 *               the DH lengths are naturally read in, which is why the reading
 *               below is a decomposition rather than index magic.
 *   `axis`    — its axis direction in the BASE frame (for the structure check).
 *
 * @param {{joints: any[]}} chain
 * @returns {{local: {x:number,y:number,z:number}, axis: {x:number,y:number,z:number},
 *            limit: {lower:number, upper:number}|null, name: string}[]}
 */
function movableJointFrames(chain) {
  const out = []
  let quat = { x: 0, y: 0, z: 0, w: 1 }
  // Displacement accumulated through FIXED joints since the last movable one, in
  // the frame the last movable joint's axis is +Z of.
  let pending = { x: 0, y: 0, z: 0 }

  for (const joint of chain.joints ?? []) {
    const origin = joint.origin ?? {}
    pending = add(pending, vec(origin.xyz))
    if (origin.rpy) {
      const r = quatFromRpy(origin.rpy[0], origin.rpy[1], origin.rpy[2])
      // The rpy rotates the frame the NEXT displacement is expressed in, so the
      // pending offset stays in the frame it was measured in — it belongs to the
      // joint we are about to record.
      quat = quatMul(quat, r)
    }
    if ((joint.type ?? 'fixed') === 'fixed') continue
    out.push({
      name:  joint.name,
      local: pending,
      axis:  quatRotateVec(quat, vec(joint.axis ?? [0, 0, 1])),
      limit: joint.limit ?? null,
    })
    pending = { x: 0, y: 0, z: 0 }
  }
  return out
}

/** True when two unit-ish axes are (anti)parallel. */
const parallel   = (a, b) => Math.abs(Math.abs(dot(a, b)) - 1) < AXIS_EPS
/** True when two unit-ish axes are perpendicular. */
const orthogonal = (a, b) => Math.abs(dot(a, b)) < AXIS_EPS

/**
 * Read the six standard-DH lengths of a UR-shaped chain out of the URDF, or
 * report WHY the chain is not one.
 *
 * The reading, joint frame by joint frame (each joint's own axis is that frame's
 * +Z, so a component along z is an offset ALONG the axis and a component along x
 * is a link length ACROSS it — the two things DH calls `d` and `a`):
 *
 *   d1 = shoulder height   — base → shoulder along axis 1
 *   a2 = upper-arm length  — shoulder → elbow across axis 2   (UR sign: negative)
 *   a3 = forearm length    — elbow → wrist1 across axis 3     (UR sign: negative)
 *   d4 = forearm offset    — elbow → wrist1 along axis 3
 *   d5, d6 = wrist offsets — magnitudes. The URDF alternates their y SIGN because
 *            each wrist joint carries an Rx(π/2); that alternation is a frame
 *            artifact, not a physical direction, whereas a2/a3's negative signs
 *            are the genuine DH convention and are kept.
 *
 * @param {{joints: any[]}} chain  a parsed URDF chain
 * @returns {{ dh: object, jointLimits: {min:number,max:number}[]|null }
 *           | { reason: string, detail: string }}
 */
export function readUrKinematics(chain) {
  const j = movableJointFrames(chain)
  if (j.length !== UR_JOINT_COUNT) {
    return { reason: NOT_UR_REASONS.JOINT_COUNT, detail: `${j.length} movable joints, expected ${UR_JOINT_COUNT}` }
  }
  for (const joint of chain.joints ?? []) {
    if ((joint.type ?? 'fixed') === 'fixed') continue
    const a = vec(joint.axis ?? [0, 0, 1])
    if (Math.abs(a.z) !== 1 || a.x !== 0 || a.y !== 0) {
      return { reason: NOT_UR_REASONS.AXIS_LOCAL_Z, detail: `joint "${joint.name}" axis is not local ±Z` }
    }
  }

  // The structure the kind CLAIMS (ADR-127 D1): shoulder ⟂ base, axes 2/3/4
  // parallel, orthogonal wrist. Checked before the kind is emitted, because six
  // numbers for the wrong structure produce an answer that looks correct.
  const ax = j.map(x => x.axis)
  if (!orthogonal(ax[0], ax[1])) return notUr('axis 1 and 2 are not perpendicular')
  if (!parallel(ax[1], ax[2]) || !parallel(ax[2], ax[3])) return notUr('axes 2/3/4 are not parallel')
  if (!orthogonal(ax[3], ax[4])) return notUr('axes 4 and 5 are not perpendicular')
  if (!orthogonal(ax[4], ax[5])) return notUr('axes 5 and 6 are not perpendicular')

  // The wrist offsets must be pure cross-axis offsets in their own frames, or the
  // reading below would silently drop a component (原則 #31: a number we did not
  // account for has no field to appear in).
  if (Math.abs(j[4].local.x) > AXIS_EPS || Math.abs(j[4].local.z) > AXIS_EPS ||
      Math.abs(j[5].local.x) > AXIS_EPS || Math.abs(j[5].local.z) > AXIS_EPS) {
    return { reason: NOT_UR_REASONS.WRIST_OFFSET, detail: 'wrist offsets are not pure cross-axis translations' }
  }

  const dh = {
    d1: j[0].local.z,
    a2: j[2].local.x,
    a3: j[3].local.x,
    d4: j[3].local.z,
    d5: Math.abs(j[4].local.y),
    d6: Math.abs(j[5].local.y),
  }
  for (const [k, v] of Object.entries(dh)) {
    if (!Number.isFinite(v)) return notUr(`DH length ${k} is not a finite number`)
  }

  // Limits are sent only when EVERY joint declares one. A partial set would make
  // the undeclared joints look free while the declared ones look constrained, and
  // ADR-127 D4 is explicit that "unlimited" and "unstated" must not produce the
  // same answer — so the honest partial case is to declare none.
  const limits = j.map(x => x.limit)
  const jointLimits = limits.every(l => l && Number.isFinite(l.lower) && Number.isFinite(l.upper))
    ? limits.map(l => ({ min: l.lower, max: l.upper }))
    : null

  return { dh, jointLimits }
}

const notUr = (detail) => ({ reason: NOT_UR_REASONS.STRUCTURE, detail })

/**
 * The wire-shaped `robot.kinematics` declaration for the skeleton the app draws,
 * or `null` when the URDF is not a UR-shaped arm.
 *
 * `null` is a legitimate answer, not a failure: ADR-127 D3 says an absent
 * declaration keeps the naive cone judgement exactly as before, so the caller
 * omits the key and nothing changes. What must never happen is emitting the kind
 * for a chain that does not have the structure — hence the check above.
 *
 * @param {string} urdfText
 * @returns {{kind: string, dh: object, jointLimits?: {min:number,max:number}[]} | null}
 */
export function kinematicsDeclarationFromUrdf(urdfText) {
  let chain
  try {
    chain = parseUrdfChain(urdfText)
  } catch {
    return null
  }
  const read = readUrKinematics(chain)
  if ('reason' in read) return null
  return {
    kind: KINEMATICS_KIND_UR,
    dh: read.dh,
    ...(read.jointLimits ? { jointLimits: read.jointLimits } : {}),
  }
}

/** Number of movable joints in a chain — used by the URDF-agreement test. */
export function movableJointCount(chain) {
  return movableJoints(chain).length
}
