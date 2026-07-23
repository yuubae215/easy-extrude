/**
 * UrdfChain — pure URDF → forward-kinematics `chain` parser (ADR-088).
 *
 * Pure computation: no I/O, no Three.js, no DOM (no `DOMParser`). (PHILOSOPHY #3)
 * Deliberately hand-parses the small, self-authored URDF subset with string /
 * regex extraction so the whole module loads under bare `node --test` — the same
 * discipline `Kinematics.js` follows by writing its own SE(3) math. `urdf-loader`
 * is the render path's parser but it produces THREE objects and needs a DOM, so
 * it is the wrong tool for the seed-derivation lane; this is its pure twin.
 *
 * WHY (ADR-088, §1.1): the robot flange (tool0) position is one fact with one
 * authority — the URDF kinematics + the shared rest pose. `parseUrdfChain` turns
 * the URDF text into the `{ joints:[{type,axis,origin}] }` shape
 * `forwardKinematics` consumes, so `SceneService` can DERIVE the tcp seed instead
 * of carrying a hand-copied constant that silently drifts when the URDF or the
 * rest pose changes.
 *
 * SCOPE (intentional, ADR-088 Consequences): this parses only the controlled
 * skeleton subset this repo ships (serial chain, revolute/continuous/prismatic/
 * fixed joints, no `<mimic>`, single kinematic branch). General third-party URDF
 * support is a non-goal — feed those through `urdf-loader` on the render side.
 *
 * @module robotics/UrdfChain
 */

import { forwardKinematics, movableJoints } from './Kinematics.js'

/** Thrown when the URDF text does not form a single serial chain we can walk. */
export class MalformedUrdf extends Error {
  constructor(message) {
    super(message)
    this.name = 'MalformedUrdf'
  }
}

/** First `name="…"` / `type="…"` style attribute value, or null. */
function attr(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`))
  return m ? m[1] : null
}

/** Whitespace-separated number list ("0 0 0.1625" → [0,0,0.1625]), or null. */
function nums(value) {
  if (value == null) return null
  const parts = value.trim().split(/\s+/).map(Number)
  return parts.some(Number.isNaN) ? null : parts
}

/**
 * Parse the URDF text into a forward-kinematics `chain`, joints ordered from the
 * base link out to the tool flange.
 *
 * @param {string} urdfText  the full URDF document as a string
 * @returns {{ joints: Array<{ name:string, type:string, axis?:number[],
 *   origin?:{ xyz?:number[], rpy?:number[] }, limit?:{lower:number,upper:number} }> }}
 */
export function parseUrdfChain(urdfText) {
  if (typeof urdfText !== 'string' || urdfText.length === 0) {
    throw new MalformedUrdf('parseUrdfChain: urdfText must be a non-empty string')
  }

  // Extract every <joint …>…</joint> block (self-authored subset — all joints
  // here use the block form with parent/child/origin children).
  const parsed = []
  const jointRe = /<joint\b([^>]*)>([\s\S]*?)<\/joint>/g
  let match
  while ((match = jointRe.exec(urdfText)) !== null) {
    const [, head, body] = match
    const name = attr(head, 'name')
    const type = attr(head, 'type') ?? 'fixed'
    const parentEl = body.match(/<parent\b[^>]*>/)
    const childEl = body.match(/<child\b[^>]*>/)
    const originEl = body.match(/<origin\b[^>]*>/)
    const axisEl = body.match(/<axis\b[^>]*>/)
    const limitEl = body.match(/<limit\b[^>]*>/)
    if (!name || !parentEl || !childEl) {
      throw new MalformedUrdf(`joint missing name/parent/child near "${head.trim()}"`)
    }

    const joint = { name, type, parent: attr(parentEl[0], 'link'), child: attr(childEl[0], 'link') }
    if (originEl) {
      const xyz = nums(attr(originEl[0], 'xyz'))
      const rpy = nums(attr(originEl[0], 'rpy'))
      joint.origin = {}
      if (xyz) joint.origin.xyz = xyz
      if (rpy) joint.origin.rpy = rpy
    }
    if (axisEl) {
      const xyz = nums(attr(axisEl[0], 'xyz'))
      if (xyz) joint.axis = xyz
    }
    if (limitEl) {
      const lower = Number(attr(limitEl[0], 'lower'))
      const upper = Number(attr(limitEl[0], 'upper'))
      if (!Number.isNaN(lower) && !Number.isNaN(upper)) joint.limit = { lower, upper }
    }
    parsed.push(joint)
  }

  if (parsed.length === 0) {
    throw new MalformedUrdf('parseUrdfChain: no <joint> elements found')
  }

  // Order the joints into a serial chain: the root link is the one that is some
  // joint's parent but never a child. Walk parent→child from there.
  const byParent = new Map()
  const childLinks = new Set()
  for (const j of parsed) {
    if (byParent.has(j.parent)) {
      throw new MalformedUrdf(`link "${j.parent}" drives two joints — not a serial chain`)
    }
    byParent.set(j.parent, j)
    childLinks.add(j.child)
  }
  const roots = [...byParent.keys()].filter(link => !childLinks.has(link))
  if (roots.length !== 1) {
    throw new MalformedUrdf(`expected exactly one root link, found ${roots.length}`)
  }

  const ordered = []
  const seen = new Set()
  let link = roots[0]
  while (byParent.has(link)) {
    const j = byParent.get(link)
    if (seen.has(j.name)) throw new MalformedUrdf(`cycle detected at joint "${j.name}"`)
    seen.add(j.name)
    ordered.push(j)
    link = j.child
  }
  if (ordered.length !== parsed.length) {
    throw new MalformedUrdf(`chain walked ${ordered.length} of ${parsed.length} joints — kinematic tree is not a single serial chain`)
  }

  // Project to the FK chain shape (drop parent/child bookkeeping, keep name so a
  // named rest pose can be mapped to an ordered q vector).
  const joints = ordered.map(j => {
    const out = { name: j.name, type: j.type }
    if (j.axis) out.axis = j.axis
    if (j.origin) out.origin = j.origin
    if (j.limit) out.limit = j.limit
    return out
  })
  return { joints }
}

/**
 * Ordered `q` vector (one value per movable joint, in chain order) for a rest
 * pose given as a { jointName: angle } map. Joints absent from the map are 0.
 *
 * @param {{joints:Array<{name:string,type?:string}>}} chain
 * @param {Record<string, number>} restPose
 * @returns {number[]}
 */
export function restPoseToQ(chain, restPose = {}) {
  return movableJoints(chain).map(j => restPose[j.name] ?? 0)
}

/**
 * DERIVE the tcp flange seed: the base-frame position of the tool flange (the
 * last link's origin) at the given rest pose, by forward kinematics of the URDF.
 * This is the single-source replacement for ADR-084's hand-copied
 * `ROBOT_FRAME_DEFAULTS[tcp]` constant (ADR-088).
 *
 * @param {string} urdfText
 * @param {Record<string, number>} restPose  { jointName: angle(rad) }
 * @returns {{ x:number, y:number, z:number }}  base-frame flange position
 */
export function deriveFlangeSeed(urdfText, restPose) {
  const chain = parseUrdfChain(urdfText)
  const { position } = forwardKinematics(chain, restPoseToQ(chain, restPose))
  return { x: position.x, y: position.y, z: position.z }
}
