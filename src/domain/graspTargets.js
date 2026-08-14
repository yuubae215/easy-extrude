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
import { GRIPPER_KIND } from '../context/GraspDeclarationCatalog.js'
import {
  resolveGraspFeature, faceNormalOrThrow, inPlaneAxesOrThrow,
  GRASP_FEATURE_STATE, FULL_REGION,
} from './graspFeature.js'

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
 * @property {{state:string, faces:{face:string,region:object}[], errors:string[]}} feature
 *           resolved grasp-location declaration (ADR-119 D2) — ALWAYS present, and
 *           `state:'derived'` is a real answer ("nobody said"), never a missing one
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
      // Where the user said to grasp it, resolved through the ONE resolution
      // point (ADR-119 D2). Resolved eagerly rather than left as a raw field so
      // no consumer downstream is tempted to read `e.graspFeature` itself.
      feature:    resolveGraspFeature(e),
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
 * How many samples are taken across each axis of a sampled face. 3×3 = 9 points:
 * enough that `core/`'s per-sample candidate generation has a spread to rank (a
 * single point yields a single candidate and an unrankable "top-N"), few enough
 * to stay legible in the funnel counts.
 */
const GRID = 3

/**
 * Which faces of the box a hand actually touches (ADR-118).
 *
 * **This table is the fix for a real defect.** Before it, every request sampled
 * the top face only, and `core/`'s parallel-jaw gate measures the object width as
 * the spread of the surface samples projected onto the closing axis. A 3×3 grid
 * inset from the rim spans `d/2`, not `d` — so a 300 mm box reported a 150 mm
 * width and the gate passed jaws that physically cannot close on it. The gate was
 * optimistic by exactly 2×, and nothing was wrong with the gate: the samples were
 * describing a face the jaws never touch.
 *
 * A suction cup, by contrast, seals against the top — for it the old sampling was
 * the right face all along. That is the whole point: the face to sample is a
 * property of the HAND, not of the object, and leaving it unstated meant silently
 * serving one hand and misleading the other.
 *
 * Values are unit local-axis pairs: which axis the face normal points along, and
 * (for opposed faces) that they come in a pair the jaws close across.
 */
const FACES_BY_GRIPPER_KIND = Object.freeze({
  // Jaws close across two opposed side faces (±X here — the closing axis the
  // solver derives from the candidate's roll picks which pair actually matters,
  // and sampling both gives it the full width to project).
  [GRIPPER_KIND.PARALLEL_JAW]: Object.freeze(['+x', '-x']),
  // A cup seals on one face, and the reachable one on a bin is the top.
  [GRIPPER_KIND.SUCTION]: Object.freeze(['+z']),
})

/**
 * The faces to sample for a declared hand kind. **Throws on an undeclared kind**
 * (原則 #31): defaulting would resurrect exactly the defect above, where a hand
 * silently got samples from a face it never touches.
 *
 * `null` (no gripper declared) is legal and means the grasp gate is vacuous, so
 * the sampled face only has to be *plausible* — the top face is the one a reader
 * expects to see ghosts on.
 *
 * @param {string|null|undefined} kind
 * @returns {ReadonlyArray<string>}
 */
export function facesForGripperKind(kind) {
  if (kind == null) return FACES_BY_GRIPPER_KIND[GRIPPER_KIND.SUCTION]
  const faces = FACES_BY_GRIPPER_KIND[kind]
  if (!faces) {
    throw new Error(
      `graspTargets: 未宣言のハンド種別 "${kind}"。FACES_BY_GRIPPER_KIND に行を足すこと ` +
      `— 既定へ倒すと、触れもしない面のサンプルで把持ゲートが判定される (ADR-118)`,
    )
  }
  return faces
}

/**
 * Which faces (and which region of each) this run actually samples — the ONE
 * place ADR-119 D3's "declaration wins, one direction" is implemented.
 *
 * A declared face list is used **verbatim**: it is never unioned with the derived
 * set, because a user who declared "here and nowhere else" would otherwise find
 * their statement quietly widened back to the default. `declared-anywhere` and
 * `derived` both fall to ADR-118's hand-driven derivation — same samples, and
 * deliberately still different STATES upstream (one is an answer, the other a
 * silence — the caller reports which, 原則 #31).
 *
 * `malformed` samples NOTHING and says so by returning an empty plan: the submit
 * gate (`graspFeatureGaps`) blocks the run before it can be mistaken for "the
 * solver found no pose".
 *
 * @param {{state:string, faces:{face:string,region:object}[]}|null|undefined} feature
 * @param {string|null} gripperKind
 * @returns {{face: string, region: {uMin:number,uMax:number,vMin:number,vMax:number}}[]}
 */
export function samplingPlanFor(feature, gripperKind = null) {
  const state = feature?.state ?? GRASP_FEATURE_STATE.DERIVED
  if (state === GRASP_FEATURE_STATE.MALFORMED) return []
  if (state === GRASP_FEATURE_STATE.DECLARED_FACES) {
    return feature.faces.map(f => ({ face: f.face, region: f.region ?? FULL_REGION }))
  }
  return facesForGripperKind(gripperKind).map(face => ({ face, region: FULL_REGION }))
}

/**
 * Derive the wire-shaped `target.surfaceSamples` for one target: a grid over each
 * face this run samples (declared, or derived from the hand — `samplingPlanFor`),
 * each sample carrying that face's outward normal, expressed in the world frame.
 *
 * Choosing WHICH face is a declaration (what the hand touches, or what the user
 * said); deciding whether the grasp holds is `core/`'s. Rotation is applied to the
 * local offsets and to the normals, so a tilted solid reports its actual faces
 * rather than an axis-aligned lie.
 *
 * The grid runs at the same fractions inside a declared REGION as it does across a
 * whole face, so a full region reproduces the pre-ADR-119 sample set exactly —
 * adding the vocabulary does not move anyone's existing answers.
 *
 * @param {GraspTarget} target
 * @param {string|null} [gripperKind]  a `GRIPPER_KIND` value, or null when undeclared
 * @returns {{point:[number,number,number], normal:[number,number,number]}[]}
 */
export function surfaceSamplesFor(target, gripperKind = null) {
  if (!target) return []
  const { position: p, dimensions: d, rotation: q } = target
  const half = { x: d.x / 2, y: d.y / 2, z: d.z / 2 }
  const samples = []

  for (const { face, region } of samplingPlanFor(target.feature, gripperKind)) {
    const n = faceNormalOrThrow(face)
    const worldNormal = rotateVec3(n, q)
    const [uAxis, vAxis] = inPlaneAxesOrThrow(face)
    const nAxis = n.x !== 0 ? 'x' : n.y !== 0 ? 'y' : 'z'

    for (let i = 1; i <= GRID; i++) {
      for (let j = 1; j <= GRID; j++) {
        // Normalised position inside the declared region: the same i/(GRID+1)
        // fractions the whole-face grid used, remapped into [uMin,uMax].
        const u = region.uMin + (region.uMax - region.uMin) * (i / (GRID + 1))
        const v = region.vMin + (region.vMax - region.vMin) * (j / (GRID + 1))
        const local = { x: 0, y: 0, z: 0 }
        local[uAxis] = -half[uAxis] + d[uAxis] * u
        local[vAxis] = -half[vAxis] + d[vAxis] * v
        // Ride the face itself, at the full half-extent along its normal — this is
        // the term the old top-only sampling never contributed for a jaw, and its
        // absence is what halved the measured width.
        local[nAxis] = n[nAxis] * half[nAxis]
        const world = rotateVec3(local, q)
        samples.push({
          point:  /** @type {[number,number,number]} */ ([p.x + world.x, p.y + world.y, p.z + world.z]),
          normal: /** @type {[number,number,number]} */ ([worldNormal.x, worldNormal.y, worldNormal.z]),
        })
      }
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
 * Each row carries its resolved grasp-location declaration (ADR-119 D2) so the
 * panel can render "declared / not declared" WITHOUT reaching into the Layout DSL
 * itself — the resolution stays at its one point and the panel stays a renderer.
 *
 * @param {GraspTarget[]} targets
 * @param {string|null} selectedRef
 * @returns {{list:{ref:string,label:string,feature:object}[], selectedRef:string|null,
 *            cardinality:string, feature:object|null}}
 */
export function targetProjection(targets, selectedRef) {
  const list     = targets ?? []
  const selected = selectTarget(list, selectedRef)
  return {
    list:        list.map(t => ({ ref: t.ref, label: t.label, feature: t.feature })),
    selectedRef: selected?.ref ?? null,
    cardinality: targetCardinality(list),
    // The SELECTED target's declaration, lifted out so the panel's "where to
    // grasp" block does not re-run the "which one" question (原則 #25 — resolved
    // once, here).
    feature:     selected?.feature ?? null,
  }
}
