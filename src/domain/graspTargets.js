/**
 * Grasp target resolution + surface-sample derivation (ADR-117).
 *
 * ## Why this module exists
 *
 * The grasp request was being sent WITHOUT the one thing the search is about:
 * the object to be grasped. `GraspController.runGraspSearch` declared
 * `robot` / `plan` / `camera` / `gripper` but never `target`, and `core/`'s
 * adapter defaults an absent target to zero surface samples
 * (`pipeline.problem_from_declaration`), so `generate_candidates` yielded
 * nothing and EVERY run through the UI came back `candidatesGenerated: 0`.
 * The panel then told the user to "check that the layout contains graspable
 * geometry" — advice that could never work, because the layout's geometry was
 * not on the wire at all. This module puts it there.
 *
 * ## This is DECLARATION, not solving (scope boundary — CLAUDE.md)
 *
 * Everything here is geometry of the *declared* shape: which entities are
 * graspable, where their surfaces are, how big the other bodies are. It answers
 * "what is in the cell", never "can it be grasped". Reach / IK / grasp-gate /
 * visibility / interference stay solved in `core/` behind the contract — this
 * module does not import, reimplement, or approximate any of them. The precedent
 * is ADR-084 §2, which resolves `robot.base` / `robot.tcpOrientation` from Layout
 * DSL CoordinateFrame entities on the front side before sending: same verb
 * (resolve a declared fact from the DSL), same side of the boundary.
 *
 * ## Cardinality is an explicit state (原則 #31)
 *
 * 0 / 1 / N graspable solids are all legal and all named
 * (`TARGET_CARDINALITY`), mirroring the robot roster (ADR-090). Zero targets is
 * a stable, legal scene that gates the search off with a reason rather than
 * searching against an invented object; N requires an EXPLICIT pick, because
 * "which thing am I picking up" has no defensible default — silently choosing
 * the first solid would declare "grasp the pedestal" on a cell whose first solid
 * is the robot's own plinth.
 *
 * Pure module (no THREE / no DOM), so the THREE-free `test:context` lane and the
 * controller share one set of definitions (§1.1).
 */

import { VALID_ENTITY_TYPES } from '../layout/LayoutDslSchema.js'

/**
 * The graspable-target roster's cardinality, as a named state rather than a bare
 * count (原則 #31 — 0 and N are states that do not look like states):
 *   'none'   — no graspable solid in the layout. Legal and stable; grasp is gated.
 *   'single' — exactly one; selected implicitly (no picker shown — 原則 #15).
 *   'multi'  — N solids; the search needs an EXPLICIT choice, or it is gated off.
 */
export const TARGET_CARDINALITY = Object.freeze({ NONE: 'none', SINGLE: 'single', MULTI: 'multi' })

/**
 * Layout DSL entity type that can carry graspable geometry.
 *
 * Bound to the DSL vocabulary's owner (`VALID_ENTITY_TYPES`) rather than trusted
 * as a bare literal: if that vocabulary ever renames the type, this module must
 * fail LOUDLY at import. The silent alternative is the worse one — an unknown
 * type name makes `resolveGraspTargets` return zero targets, which is
 * indistinguishable from an honest "this cell has nothing to pick up" (原則 #31:
 * the 0 that does not look like a state).
 */
const SOLID = 'Solid'
if (!VALID_ENTITY_TYPES.includes(SOLID)) {
  throw new Error(
    `graspTargets: Layout DSL entity type "${SOLID}" is no longer in VALID_ENTITY_TYPES ` +
    `(${VALID_ENTITY_TYPES.join(', ')}). Grasp targets resolve by this type — update it here.`,
  )
}

/** Identity quaternion, used when an entity declares no rotation. */
const IDENTITY_Q = Object.freeze({ x: 0, y: 0, z: 0, w: 1 })

/**
 * @typedef {object} GraspTarget
 * @property {string} ref          Layout DSL entity ref (the identity — §1.1)
 * @property {string} label        human-readable name (a label, never an identity)
 * @property {{x:number,y:number,z:number}} position   world-frame CENTER of the box
 * @property {{x:number,y:number,z:number}} dimensions full extents (not half)
 * @property {{x:number,y:number,z:number,w:number}} rotation world-frame quaternion
 */

/**
 * True when `n` is a usable finite number. Rejects NaN / Infinity / null / '' —
 * a dimension that is not a number is not a small dimension (no silent 0).
 * @param {unknown} n
 * @returns {boolean}
 */
function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * True when `v` is a complete finite vec3.
 * @param {unknown} v
 * @returns {boolean}
 */
function isVec3(v) {
  return !!v && isFiniteNumber(/** @type {any} */ (v).x)
              && isFiniteNumber(/** @type {any} */ (v).y)
              && isFiniteNumber(/** @type {any} */ (v).z)
}

/**
 * Read an entity's rotation as a finite quaternion, falling back to identity when
 * none is declared. An entity that declares a MALFORMED rotation falls back too —
 * the alternative (throwing) would take down a search over a cosmetic field.
 * @param {any} entity
 * @returns {{x:number,y:number,z:number,w:number}}
 */
function rotationOf(entity) {
  const r = entity?.rotation
  if (r && isVec3(r) && isFiniteNumber(r.w)) return { x: r.x, y: r.y, z: r.z, w: r.w }
  return { ...IDENTITY_Q }
}

/**
 * Rotate a vector by a quaternion (pure; the standard
 * v + 2q_w(q_v × v) + 2(q_v × (q_v × v)) form, no matrix allocation).
 *
 * This is coordinate math on a declared pose, not a kinematic solution — the same
 * arithmetic the view layer already does to place a mesh.
 *
 * @param {{x:number,y:number,z:number}} v
 * @param {{x:number,y:number,z:number,w:number}} q
 * @returns {{x:number,y:number,z:number}}
 */
export function rotateVec3(v, q) {
  // t = 2 * (q_v × v)
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  }
}

/**
 * The single resolution point for "which entities can be picked up" (§1.1).
 *
 * A graspable target is a Layout DSL `Solid` with a complete finite position and
 * a strictly positive extent on every axis — a body with a surface. Entities that
 * fail either test are not silently repaired to a default box; they are simply
 * not targets (a zero-extent "solid" has no surface to sample, and inventing one
 * would put fabricated geometry on the wire — 原則 #11).
 *
 * CoordinateFrames are excluded by construction (they are not Solids), so a
 * robot's own base / tcp frames can never appear as things to grasp.
 *
 * @param {Array<any>|null|undefined} entities  Layout DSL `entities`
 * @returns {GraspTarget[]} in declaration order (deterministic — the picker's order)
 */
export function resolveGraspTargets(entities) {
  if (!Array.isArray(entities)) return []
  const targets = []
  for (const e of entities) {
    if (!e || e.type !== SOLID) continue
    if (typeof e.ref !== 'string' || e.ref === '') continue
    if (!isVec3(e.position) || !isVec3(e.dimensions)) continue
    const { x: dx, y: dy, z: dz } = e.dimensions
    if (!(dx > 0 && dy > 0 && dz > 0)) continue
    targets.push({
      ref:        e.ref,
      label:      typeof e.name === 'string' && e.name !== '' ? e.name : e.ref,
      position:   { x: e.position.x, y: e.position.y, z: e.position.z },
      dimensions: { x: dx, y: dy, z: dz },
      rotation:   rotationOf(e),
    })
  }
  return targets
}

/**
 * Name the roster's cardinality (原則 #31 — the count IS the state).
 * @param {GraspTarget[]} targets
 * @returns {'none'|'single'|'multi'}
 */
export function targetCardinality(targets) {
  const n = targets?.length ?? 0
  if (n === 0) return TARGET_CARDINALITY.NONE
  if (n === 1) return TARGET_CARDINALITY.SINGLE
  return TARGET_CARDINALITY.MULTI
}

/**
 * Resolve WHICH target a run is about — the named predicate the controller asks
 * instead of deciding for itself (原則 #25). Deliberately has no "first one"
 * fallback at N: solving for an object nobody chose is the same defect ADR-090
 * fixed for robots.
 *
 * @param {GraspTarget[]} targets
 * @param {string|null|undefined} ref  the user's explicit pick, if any
 * @returns {GraspTarget|null} null when the cardinality forbids an answer
 */
export function selectTarget(targets, ref) {
  const list = targets ?? []
  if (list.length === 0) return null
  if (ref) return list.find(t => t.ref === ref) ?? null
  if (list.length === 1) return list[0]
  return null
}

/**
 * How many samples are taken across each axis of the graspable face. 3×3 minus
 * nothing = 9 points: enough that `core/`'s per-sample candidate generation has a
 * spread to rank (a single point yields a single candidate and an unrankable
 * "top-N"), few enough to stay legible in the funnel counts.
 */
const GRID = 3

/**
 * Derive the wire-shaped `target.surfaceSamples` for one target: a grid over its
 * TOP face, each with the outward normal of that face, expressed in the world
 * frame.
 *
 * The top face is the honest default for a declared box: it is the face a
 * top-mounted arm can reach without the sample itself being buried in the body,
 * and it is the face `core/`'s naive candidate generator turns into a
 * face-on approach (`approach = -normal`). Choosing the graspable face properly
 * (from the gripper's kinematics and the surrounding clutter) is a SOLVING
 * question and stays in `core/` — this only declares where the surface is.
 *
 * Rotation is applied to the local offsets and to the normal, so a tilted solid
 * reports its actual face rather than an axis-aligned lie.
 *
 * @param {GraspTarget} target
 * @returns {{point:[number,number,number], normal:[number,number,number]}[]}
 */
export function surfaceSamplesFor(target) {
  if (!target) return []
  const { position: p, dimensions: d, rotation: q } = target
  const hz = d.z / 2
  // Inset the grid so samples sit ON the face rather than exactly on its rim,
  // where "is this point on the body" is ambiguous for any downstream check.
  const stepX = d.x / (GRID + 1)
  const stepY = d.y / (GRID + 1)
  const normal = rotateVec3({ x: 0, y: 0, z: 1 }, q)

  const samples = []
  for (let i = 1; i <= GRID; i++) {
    for (let j = 1; j <= GRID; j++) {
      const local = { x: -d.x / 2 + stepX * i, y: -d.y / 2 + stepY * j, z: hz }
      const world = rotateVec3(local, q)
      samples.push({
        point:  /** @type {[number,number,number]} */ ([p.x + world.x, p.y + world.y, p.z + world.z]),
        normal: /** @type {[number,number,number]} */ ([normal.x, normal.y, normal.z]),
      })
    }
  }
  return samples
}

/**
 * Derive the wire-shaped `obstacles` for a run: every OTHER graspable body in the
 * layout, as a bounding sphere.
 *
 * A bounding sphere (half the box diagonal) is deliberately CONSERVATIVE — it
 * over-covers the corners, so the interference stage can reject a candidate that
 * a exact-box check would pass. That direction is the safe one for a declaration:
 * it never claims a path is clear when it might not be. The exact swept-body test
 * is `core/`'s to make; this only says where the bodies are and how big.
 *
 * The target itself is excluded — an object cannot be its own obstacle, and
 * including it would reject every candidate that touches the thing being picked.
 *
 * @param {GraspTarget[]} targets
 * @param {string|null} excludeRef  ref of the target being grasped
 * @returns {{center:[number,number,number], radius:number}[]}
 */
export function obstaclesExcluding(targets, excludeRef) {
  return (targets ?? [])
    .filter(t => t.ref !== excludeRef)
    .map(t => {
      const { x, y, z } = t.dimensions
      return {
        center: /** @type {[number,number,number]} */ ([t.position.x, t.position.y, t.position.z]),
        radius: Math.sqrt(x * x + y * y + z * z) / 2,
      }
    })
}

/**
 * The DERIVED read-model the panel's target picker consumes — the same shape and
 * the same rules as the robot roster projection (ADR-090), so the two selectors
 * read identically. A projection, never a second source: the layout DSL stays the
 * authority and nothing writes back here (§1.1).
 *
 * @param {GraspTarget[]} targets
 * @param {string|null} selectedRef
 * @returns {{list:{ref:string,label:string}[], selectedRef:string|null, cardinality:string}}
 */
export function targetProjection(targets, selectedRef) {
  const list     = targets ?? []
  const selected = selectTarget(list, selectedRef)
  return {
    list:        list.map(t => ({ ref: t.ref, label: t.label })),
    selectedRef: selected?.ref ?? null,
    cardinality: targetCardinality(list),
  }
}
