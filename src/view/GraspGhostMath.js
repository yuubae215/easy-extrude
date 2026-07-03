/**
 * GraspGhostMath — pure client-side derivations for the stage-1 grasp candidate
 * ghost (ADR-059 §A/§B, PHILOSOPHY #29 "Rigor on the Wire, Play in the Client").
 *
 * Everything here derives *presentation* facts (approach direction, ghost colour,
 * line style, target proximity) from the *wire* facts the contract commits to —
 * the `pose.kind:'endEffector'` cartesian frame and the `score` breakdown. Nothing
 * here is ever demanded back as a new wire field.
 *
 * Pure: no THREE, no DOM, no I/O, input-immutable — loads under bare `node --test`
 * (the `test:context` lane runs without node_modules).
 *
 * @module view/GraspGhostMath
 */

/**
 * The capability gate (ADR-059 §A-1): a candidate earns a spatial ghost only when
 * its pose is the typed `endEffector` branch AND the frame passes a shape check —
 * `position` a length-3 number array, `orientation` a length-4 number array.
 * Anything else (opaque, `jointSpace`, malformed) returns null and the UI shows an
 * honest "spatial view unavailable" caption instead (PHILOSOPHY #11 — never
 * fabricate a pose; heuristic interpretation of opaque poses is forbidden).
 *
 * @param {object|null|undefined} pose — `candidate.pose` straight off the wire
 * @returns {{position: number[], orientation: number[]}|null}
 */
export function renderableEndEffectorFrame(pose) {
  if (!pose || typeof pose !== 'object' || pose.kind !== 'endEffector') return null
  const f = pose.frame
  if (!f || typeof f !== 'object') return null
  const p = f.position
  const q = f.orientation
  const allNum = (a, n) => Array.isArray(a) && a.length === n && a.every(v => typeof v === 'number' && Number.isFinite(v))
  if (!allNum(p, 3) || !allNum(q, 4)) return null
  return { position: p, orientation: q }
}

/**
 * Rotate a vector by a quaternion [x, y, z, w] (wire order — the contract's
 * `cartesianFrame.orientation`). Standard v' = q·v·q⁻¹ expansion.
 *
 * @param {number[]} q — [x, y, z, w]
 * @param {number[]} v — [x, y, z]
 * @returns {number[]}
 */
export function quatRotate(q, v) {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  // v' = v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ]
}

/**
 * The approach direction, derived by *convention* (ADR-059 §A-3): the −Z axis of
 * the end-effector frame (gripper TCP convention). This is documented as a
 * convention, not requested as an `approachVector` wire field — if a real solver
 * disagrees, this convention constant is what changes; the contract does not
 * (PHILOSOPHY #29 growth governor).
 *
 * @param {number[]} orientation — frame quaternion [x, y, z, w]
 * @returns {number[]} unit vector pointing from the gripper toward the target
 */
export function approachVector(orientation) {
  return quatRotate(orientation, [0, 0, -1])
}

/**
 * Score → ghost hue (ADR-059 §B-2): totalScore maps low→amber, high→teal.
 * Presentation only — ranking stays owned by the score bars (score-first,
 * ADR-057); the ghost never re-orders anything.
 *
 * @param {number} totalScore — clamped into [0, 1]
 * @returns {number} 0xRRGGBB
 */
export function scoreColor(totalScore) {
  const t = Math.max(0, Math.min(1, Number.isFinite(totalScore) ? totalScore : 0))
  // Lerp amber (0xe0a030) → teal (0x18c0a8) in RGB — monotone, cheap, and the two
  // endpoints match the app's existing warn/ok palette.
  const lerp = (a, b) => Math.round(a + (b - a) * t)
  const r = lerp(0xe0, 0x18), g = lerp(0xa0, 0xc0), b = lerp(0x30, 0xa8)
  return (r << 16) | (g << 8) | b
}

/**
 * Score booleans → ghost line style (ADR-059 §B-2): all three verdicts true →
 * solid; any false → dashed. Derived from the wire's committed verdicts only.
 *
 * @param {{withinReach?: boolean, ikSolvable?: boolean, interferenceFree?: boolean}} score
 * @returns {'solid'|'dashed'}
 */
export function ghostLineStyle(score) {
  const s = score ?? {}
  return (s.withinReach === true && s.ikSolvable === true && s.interferenceFree === true)
    ? 'solid' : 'dashed'
}

/**
 * Nearest-target pick for the grasped-object highlight: index of the centre
 * closest to the TCP position, or null when `centers` is empty or the closest
 * one is farther than `maxDist`. Display-only proximity heuristic (permitted by
 * CODE_CONTRACTS "Centroid Is Validation-Only" for display) — never feeds back
 * into any state-mutating computation.
 *
 * @param {number[]} tcp — [x, y, z]
 * @param {number[][]} centers — candidate target centres, [x, y, z] each
 * @param {number} [maxDist=Infinity]
 * @returns {number|null}
 */
export function nearestTargetIndex(tcp, centers, maxDist = Infinity) {
  let best = null
  let bestD2 = maxDist * maxDist
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i]
    const dx = c[0] - tcp[0], dy = c[1] - tcp[1], dz = c[2] - tcp[2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 <= bestD2) { bestD2 = d2; best = i }
  }
  return best
}
