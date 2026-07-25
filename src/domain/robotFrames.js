/**
 * Robot identity + roster resolution (ADR-090; supersedes ADR-084 §2's
 * "1-robot scope, resolve by name" premise).
 *
 * A robot's placement geometry is a first-class part of the scene: a PAIR of
 * CoordinateFrame entities carries the single source of truth (§1.1) that
 * grasp-search declares against. They form the canonical robotics TF tree
 * world → base → tcp:
 *
 *   role 'base' — world-parented (root). Position only (where the arm stands).
 *     Orientation is not used by reach evaluation.
 *   role 'tcp'  — a CHILD of the base frame (the tool point is expressed in the
 *     robot's own frame, so moving/rotating the base carries the TCP with it).
 *     Its *world* quaternion (composed through the base by
 *     SceneService._updateWorldPoses) becomes `robot.tcpOrientation` on the wire
 *     and drives the wrist-cone reference axis in core/ (ADR-084 §3). Its
 *     translation/rotation are stored LOCAL to the base.
 *
 * ## Identity is the entity, not the name (ADR-090 Decision 1)
 *
 * The frames carry a DECLARED `robotRole` ('base' | 'tcp'); a robot's identity is
 * its base frame's entity **id**. Names are labels — renaming a robot, or adding
 * a second one, no longer changes what anything resolves to. `ROBOT_BASE_FRAME_NAME`
 * / `TCP_FRAME_NAME` survive as (a) the seed names and (b) the BACKWARD-COMPATIBLE
 * resolution path for scenes / `.ctx.json` / Layout DSL written before the role
 * field existed. Legacy scenes get their roles stamped on scene entry
 * (SceneService.ensureRobotFrames), so the name path is a migration ramp, never
 * the steady state.
 *
 * ## This module is the single resolution point (§1.1)
 *
 * `resolveRobots()` is the ONE place that answers "which entities are robots".
 * Callers (SceneService seed, GraspController declaration, HitTestService,
 * AppController stage sync / visibility) consume the typed `Robot` aggregates it
 * returns and branch on those — never on `name === 'robot_base'`. The duplicate
 * duck-typing this replaces is guarded by `src/IdentityContainment.test.js`.
 *
 * Cardinality is an explicit state: 0 / 1 / N are all legal and named
 * (`ROBOT_CARDINALITY`) — see `docs/STATE_TRANSITIONS.md` §Robot roster. A scene
 * with zero robots is valid and stable; nothing silently repairs it to one, and
 * nothing solves a grasp against a robot that is not there (ADR-090 §力学(3)).
 *
 * Pure module (no THREE / no DOM) so SceneService (view side) and GraspController
 * (THREE-free test lane) share the same definitions.
 */

/** @type {'robot_base'} */
export const ROBOT_BASE_FRAME_NAME = 'robot_base'

/** @type {'tcp'} */
export const TCP_FRAME_NAME = 'tcp'

/**
 * Declared role of a CoordinateFrame inside a robot's TF tree — the field that
 * moved identity from the name to the entity (ADR-090 Decision 1). Serialized
 * with the frame (scene JSON + Layout DSL) so it round-trips like any other
 * declared fact. Read in exactly one place: this module's resolution below,
 * which turns it into the typed `Robot` aggregate every caller branches on
 * (原則 #2 — the tag never leaks into caller-side dispatch).
 */
export const ROBOT_ROLE = Object.freeze({ BASE: 'base', TCP: 'tcp' })

/**
 * The roster's cardinality, as a named state rather than a bare count
 * (原則 #31 — 0 and N are states that do not look like states):
 *   'none'   — no robot in the scene. Legal and stable; grasp is gated off.
 *   'single' — exactly one; it is selected implicitly (no selection UI).
 *   'multi'  — N robots; a grasp needs an EXPLICIT choice, or it is gated off.
 */
export const ROBOT_CARDINALITY = Object.freeze({ NONE: 'none', SINGLE: 'single', MULTI: 'multi' })

/**
 * True when `obj` is a robot base frame — the world-parented root of a robot's TF
 * tree, whose geometry is the robot skeleton and whose Outliner eye owns that
 * skeleton's visibility (ADR-087).
 *
 * Primary test: the DECLARED role. The name+parentId duck-type is the legacy
 * fallback for entities written before `robotRole` existed (ADR-090 Decision 1)
 * — it is why exactly one legacy robot still resolves, and why it can never
 * identify a second one (the name is not unique). Callers that need a hard type
 * guard pair this with `instanceof CoordinateFrame`.
 *
 * @param {{name?: string, parentId?: string|null, robotRole?: string|null}|null|undefined} obj
 * @returns {boolean}
 */
export function isRobotBaseFrame(obj) {
  if (!obj) return false
  if (obj.robotRole === ROBOT_ROLE.BASE) return true
  if (obj.robotRole === ROBOT_ROLE.TCP)  return false
  return obj.parentId === null && obj.name === ROBOT_BASE_FRAME_NAME
}

/**
 * True when `value` is a role this vocabulary defines — the guard deserializers use
 * before trusting a persisted field, so "what counts as a robot role" is decided
 * here and not re-listed at every read site (§1.1). An unknown / missing value is
 * not a role: the entity is then an ordinary frame and the legacy name path
 * decides (never a default role, 原則 #31 — no filling a required declaration in).
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRobotRole(value) {
  return value === ROBOT_ROLE.BASE || value === ROBOT_ROLE.TCP
}

/**
 * True when `obj` is a robot TCP frame (declared role, or the legacy `tcp` name).
 * Pairing to a particular base is by `parentId` — see `resolveRobots`.
 * @param {{name?: string, robotRole?: string|null}|null|undefined} obj
 * @returns {boolean}
 */
export function isRobotTcpFrame(obj) {
  if (!obj) return false
  if (obj.robotRole === ROBOT_ROLE.TCP)  return true
  if (obj.robotRole === ROBOT_ROLE.BASE) return false
  return obj.name === TCP_FRAME_NAME
}

/**
 * One robot: the typed aggregate that IS the answer to "which robot" (ADR-090
 * Decision 1). Identity is `baseFrame.id` — a stable entity id, not a name — so
 * a rename is a label change and a second robot is just another aggregate.
 *
 * Holds entity references only; poses are read through SceneService
 * (`worldPoseOf`), keeping this class pure and THREE-free. `tcpFrame` may be null
 * for a malformed / half-deleted pair: that is a real state, and the grasp gate
 * reports it rather than inventing an orientation (原則 #11).
 */
export class Robot {
  /**
   * @param {{id: string, name?: string}} baseFrame
   * @param {{id: string, name?: string}|null} tcpFrame
   */
  constructor(baseFrame, tcpFrame) {
    this.baseFrame = baseFrame
    this.tcpFrame  = tcpFrame ?? null
    Object.freeze(this)
  }

  /** Stable identity — the base frame's entity id. */
  get id() { return this.baseFrame.id }

  /** Display label (the base frame's name; duplicates are allowed). */
  get label() { return this.baseFrame.name ?? ROBOT_BASE_FRAME_NAME }

  /** A complete TF tree (base + tcp) — what a grasp declaration needs. */
  get hasTcp() { return this.tcpFrame !== null }
}

/**
 * THE resolution point (§1.1): scene entities → the robot roster, in insertion
 * order (so the roster's order is the scene's, stable across calls).
 *
 * Each base frame is paired with the TCP frame among its children. The legacy
 * ramp: a single base with no TCP child adopts a stray world-parented `tcp`
 * frame, which is the pre-ADR-085 shape that `ensureRobotFrames` re-homes on
 * scene entry (resolution must work BEFORE that upgrade runs, since the upgrade
 * itself asks this module which frames are robots).
 *
 * @param {Iterable<{id: string, name?: string, parentId?: string|null, robotRole?: string|null}>} objects
 * @returns {Robot[]}
 */
export function resolveRobots(objects) {
  const all   = [...(objects ?? [])]
  const bases = all.filter(isRobotBaseFrame)

  return bases.map((base) => {
    let tcp = all.find(o => o !== base && o.parentId === base.id && isRobotTcpFrame(o)) ?? null
    if (!tcp && bases.length === 1) {
      // Legacy pre-TF-tree scene: tcp saved as a world-parented sibling.
      tcp = all.find(o => o !== base && o.parentId == null && isRobotTcpFrame(o)) ?? null
    }
    return new Robot(base, tcp)
  })
}

/**
 * The roster's cardinality state (0 / 1 / N).
 * @param {Robot[]} robots
 * @returns {'none'|'single'|'multi'}
 */
export function robotCardinality(robots) {
  const n = robots?.length ?? 0
  if (n === 0) return ROBOT_CARDINALITY.NONE
  if (n === 1) return ROBOT_CARDINALITY.SINGLE
  return ROBOT_CARDINALITY.MULTI
}

/**
 * The named selection predicate (原則 #25) — "which robot is this operation
 * about?", owned here so no caller re-derives it:
 *
 *   0 robots            → null  (nothing to select; the caller must gate)
 *   1 robot             → that robot, whatever `selectedId` says (implicit
 *                         selection: the single-robot case needs no UI, 原則 #15)
 *   N robots, id matches → that robot
 *   N robots, no match   → null  (an EXPLICIT choice is required — never a
 *                         silent "first one wins", which would solve for a robot
 *                         the user did not pick)
 *
 * @param {Robot[]} robots
 * @param {string|null|undefined} selectedId
 * @returns {Robot|null}
 */
export function selectRobot(robots, selectedId) {
  if (!robots?.length) return null
  if (robots.length === 1) return robots[0]
  return robots.find(r => r.id === selectedId) ?? null
}

/**
 * Next free base-frame name for a newly added robot: `robot_base`, then
 * `robot_base_2`, `robot_base_3`, … Names are labels only (identity is the
 * entity id), but keeping them distinct keeps the Outliner readable and the
 * legacy name path unambiguous for the first robot.
 *
 * @param {Iterable<{name?: string}>} objects
 * @returns {string}
 */
export function nextRobotBaseName(objects) {
  const taken = new Set([...(objects ?? [])].map(o => o?.name))
  if (!taken.has(ROBOT_BASE_FRAME_NAME)) return ROBOT_BASE_FRAME_NAME
  for (let i = 2; ; i++) {
    const candidate = `${ROBOT_BASE_FRAME_NAME}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Next free TCP-frame name, paired with the base name above (`tcp`, `tcp_2`, …).
 * @param {Iterable<{name?: string}>} objects
 * @returns {string}
 */
export function nextRobotTcpName(objects) {
  const taken = new Set([...(objects ?? [])].map(o => o?.name))
  if (!taken.has(TCP_FRAME_NAME)) return TCP_FRAME_NAME
  for (let i = 2; ; i++) {
    const candidate = `${TCP_FRAME_NAME}_${i}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * Default placement of a seeded / added robot's frames (ADR-084 §2, silent
 * auto-generation per ADR-073).
 *
 * The base keeps ADR-083's default WORLD position `[-2, 2, 0]` so existing
 * behaviour (and the skeleton's default pose) is unchanged — offset from the
 * origin so the arm does not spawn buried inside the origin-centred starter
 * cube. It stays world-parented (the same world frame the world gizmo and the
 * starter cube share). `ROBOT_ADD_OFFSET` shifts each ADDITIONAL robot along +Y
 * so a second arm does not spawn inside the first (ADR-090: N台 must be visibly
 * distinct on arrival).
 *
 * The `tcp` frame's default LOCAL translation is NOT a constant here (ADR-088):
 * it is the UR5e flange (tool0) position at the shared rest pose, DERIVED by
 * forward kinematics of `public/robot/skeleton_arm.urdf` and injected into
 * `SceneService` (see `view/robotSkeleton.js` → `TCP_LOCAL_SEED`). The flange
 * fact has one authority — the URDF + `ROBOT_REST_POSE` — so it cannot silently
 * drift from a hand-copied number when either input changes. (The tcp seed's
 * orientation stays identity, keeping the `tcpOrientation` wire contract
 * unchanged until the user re-aims it through the CF edit UI.)
 */
export const ROBOT_FRAME_DEFAULTS = Object.freeze({
  [ROBOT_BASE_FRAME_NAME]: Object.freeze({
    position: Object.freeze({ x: -2, y: 2, z: 0 }),
    rotation: Object.freeze({ x: 0, y: 0, z: 0, w: 1 }),
  }),
})

/** World-space offset applied per already-present robot when adding another. */
export const ROBOT_ADD_OFFSET = Object.freeze({ x: 0, y: -2, z: 0 })

/**
 * Default world pose for the `n`-th robot added to a scene (n = robots already
 * present). Pure: the offset rule lives here, not in the service.
 * @param {number} existingCount
 * @returns {{position: {x:number,y:number,z:number}, rotation: {x:number,y:number,z:number,w:number}}}
 */
export function robotBaseSeedPose(existingCount = 0) {
  const base = ROBOT_FRAME_DEFAULTS[ROBOT_BASE_FRAME_NAME]
  const n    = Math.max(0, existingCount)
  return {
    position: {
      x: base.position.x + ROBOT_ADD_OFFSET.x * n,
      y: base.position.y + ROBOT_ADD_OFFSET.y * n,
      z: base.position.z + ROBOT_ADD_OFFSET.z * n,
    },
    rotation: { ...base.rotation },
  }
}
