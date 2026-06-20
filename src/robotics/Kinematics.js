/**
 * Kinematics — pure forward kinematics (FK) and FK-sampling reachability for the
 * robotics measurement instrument (ADR-053 Phase 2).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3) Like
 * `RegionGeometry`, this module implements its own tiny SE(3) quaternion/vector
 * math instead of importing `THREE` so the whole robotics compute core stays
 * loadable under bare `node --test` with no `three` dependency.
 *
 * Scope (ADR-053 §11): this is the *initial pure-JS form* of the measurement
 * instrument that §3 blesses ("初期形はこれ"). It computes reachability by
 * **FK sampling** — the brute-force method ADR-053 §7.1 names ("FK サンプリングで
 * 到達点群を作りターゲット内包を判定する総当たり") — NOT by an inverse-kinematics
 * solver. The KDL-WASM IK/Jacobian path of §4 swaps in later behind the same
 * `ComputeBackend` seam; until then `margin` is a length-unit reach margin
 * (clearance inside the outer workspace boundary), not a singularity margin
 * (which needs the Jacobian — deferred). The values produced here are exactly the
 * pre-baked `robot_reach` operands the Phase-1 `PredicateEngine` consumes
 * (ADR-053 §2 boundary: the instrument fills the term, the predicate collapses it
 * to a boolean).
 *
 * Coordinate convention: ROS world frame (+X fwd, +Y left, +Z up), right-handed,
 * matching URDF and `SceneService._updateWorldPoses` (ADR-053 §5). RPY uses the
 * URDF/ROS yaw-pitch-roll convention R = Rz(yaw)·Ry(pitch)·Rx(roll).
 *
 * @module robotics/Kinematics
 */

/** Thrown when a kinematic job is structurally invalid or unbounded. */
export class MalformedChain extends Error {
  constructor(message) {
    super(message)
    this.name = 'MalformedChain'
  }
}

/** Safety cap on the FK sample grid so a careless `samples` cannot hang. */
export const MAX_SAMPLE_CONFIGS = 60000

// ── tiny SE(3) math (no THREE) ────────────────────────────────────────────────

const IDENTITY_QUAT = { x: 0, y: 0, z: 0, w: 1 }

function vec(a) {
  if (!a) return { x: 0, y: 0, z: 0 }
  if (Array.isArray(a)) return { x: a[0] ?? 0, y: a[1] ?? 0, z: a[2] ?? 0 }
  return { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 }
}

function addVec(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function normalize3(a) {
  const v = vec(a)
  const n = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  if (n === 0) return { x: 0, y: 0, z: 1 }
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

/** Quaternion from an axis-angle (axis need not be normalised). */
export function quatFromAxisAngle(axis, angle) {
  const a = normalize3(axis)
  const h = angle / 2
  const s = Math.sin(h)
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) }
}

/** Quaternion from URDF/ROS roll-pitch-yaw (R = Rz(y)·Ry(p)·Rx(r)). */
export function quatFromRpy(r, p, y) {
  const cr = Math.cos(r / 2), sr = Math.sin(r / 2)
  const cp = Math.cos(p / 2), sp = Math.sin(p / 2)
  const cy = Math.cos(y / 2), sy = Math.sin(y / 2)
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  }
}

/** Hamilton product a⊗b (apply b in a's frame). */
export function quatMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  }
}

/** Rotate vector v by quaternion q (v' = q·v·q⁻¹, optimised). */
export function quatRotateVec(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}

// ── forward kinematics ────────────────────────────────────────────────────────

/** Movable (non-fixed) joints, in chain order — these consume a `q` value. */
export function movableJoints(chain) {
  return (chain?.joints ?? []).filter(j => (j.type ?? 'fixed') !== 'fixed')
}

/**
 * Forward kinematics: TCP world pose for a joint-value vector.
 *
 * @param {object} chain — { base?, joints: [{ type, axis?, origin?:{xyz?,rpy?},
 *   limit?:{lower,upper} }], tcp?:{xyz?,rpy?} }
 * @param {number[]} q — one value per *movable* joint, in chain order
 * @returns {{ position: {x,y,z}, quaternion: {x,y,z,w} }}
 */
export function forwardKinematics(chain, q = []) {
  if (!chain || !Array.isArray(chain.joints)) {
    throw new MalformedChain('chain.joints must be an array')
  }
  let pos = vec(chain.base)
  let quat = { ...IDENTITY_QUAT }
  let ji = 0
  for (const joint of chain.joints) {
    const origin = joint.origin ?? {}
    pos = addVec(pos, quatRotateVec(quat, vec(origin.xyz)))
    if (origin.rpy) quat = quatMul(quat, quatFromRpy(origin.rpy[0], origin.rpy[1], origin.rpy[2]))

    const type = joint.type ?? 'fixed'
    if (type === 'fixed') continue
    const qi = q[ji] ?? 0
    ji++
    if (type === 'revolute' || type === 'continuous') {
      quat = quatMul(quat, quatFromAxisAngle(joint.axis ?? [0, 0, 1], qi))
    } else if (type === 'prismatic') {
      const a = normalize3(joint.axis ?? [0, 0, 1])
      pos = addVec(pos, quatRotateVec(quat, { x: a.x * qi, y: a.y * qi, z: a.z * qi }))
    } else {
      throw new MalformedChain(`unknown joint type "${type}"`)
    }
  }
  if (chain.tcp) {
    pos = addVec(pos, quatRotateVec(quat, vec(chain.tcp.xyz)))
    if (chain.tcp.rpy) quat = quatMul(quat, quatFromRpy(chain.tcp.rpy[0], chain.tcp.rpy[1], chain.tcp.rpy[2]))
  }
  return { position: pos, quaternion: quat }
}

// ── FK-sampling reach ─────────────────────────────────────────────────────────

/** Default joint span when a continuous/limitless joint is sampled. */
const DEFAULT_SPAN = [-Math.PI, Math.PI]

function jointSpan(joint) {
  const lim = joint.limit
  if (lim && typeof lim.lower === 'number' && typeof lim.upper === 'number') {
    return [lim.lower, lim.upper]
  }
  return DEFAULT_SPAN
}

function linspace(lo, hi, n) {
  if (n <= 1) return [(lo + hi) / 2]
  const out = []
  for (let i = 0; i < n; i++) out.push(lo + (hi - lo) * (i / (n - 1)))
  return out
}

/**
 * Cartesian product of per-joint sampled values → an array of `q` vectors.
 * Throws `MalformedChain` if the grid would exceed `maxConfigs` (bounded cost).
 */
export function sampleConfigs(chain, samples = 5, maxConfigs = MAX_SAMPLE_CONFIGS) {
  const movable = movableJoints(chain)
  const axes = movable.map(j => linspace(jointSpan(j)[0], jointSpan(j)[1], samples))
  const total = axes.reduce((n, a) => n * a.length, 1)
  if (total > maxConfigs) {
    throw new MalformedChain(`FK sample grid ${total} exceeds maxConfigs ${maxConfigs} (lower samples or joint count)`)
  }
  let configs = [[]]
  for (const colVals of axes) {
    const next = []
    for (const prefix of configs) for (const v of colVals) next.push([...prefix, v])
    configs = next
  }
  return configs
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6
}

/**
 * FK-sampling reachability for a set of taught TCP targets — the pre-baked
 * `robot_reach` operands (ADR-053 §7.1/§9.2).
 *
 * A target is `reachable` when some sampled TCP lands within `tolerance` of it.
 * `margin` is the length-unit reach margin = (outer workspace boundary radius −
 * distance from base to target): positive ⇒ comfortably inside the workspace,
 * negative ⇒ beyond the farthest sampled TCP. (Not a singularity margin — that
 * needs the KDL Jacobian, deferred; see module doc / ADR-053 §11.)
 *
 * @param {object} chain
 * @param {Array<{ref?:string,x?:number,y?:number,z?:number}>} targets
 * @param {{samples?:number,tolerance?:number,maxConfigs?:number}} [options]
 * @returns {Array<{ref:string,reachable:boolean,margin?:number,error:number}>}
 */
export function reachTargets(chain, targets, options = {}) {
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new MalformedChain('reachTargets: targets must be a non-empty array')
  }
  const { samples = 5, tolerance = 10, maxConfigs } = options
  const base = vec(chain.base)
  const configs = sampleConfigs(chain, samples, maxConfigs)

  const cloud = []
  let maxReach = 0
  for (const q of configs) {
    const { position } = forwardKinematics(chain, q)
    cloud.push(position)
    const d = dist(base, position)
    if (d > maxReach) maxReach = d
  }

  return targets.map((t, i) => {
    const tp = vec(t)
    let nearest = Infinity
    for (const p of cloud) {
      const d = dist(tp, p)
      if (d < nearest) nearest = d
    }
    const reachable = nearest <= tolerance
    return {
      ref: t.ref ?? `target[${i}]`,
      reachable,
      margin: round6(maxReach - dist(base, tp)),
      error: round6(nearest),
    }
  })
}
