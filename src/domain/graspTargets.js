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
import { rotateVec3 } from './rotateVec3.js'
import { GRIPPER_KIND } from '../context/GraspDeclarationCatalog.js'
import {
  resolveGraspFeature, faceNormalOrThrow, inPlaneAxesOrThrow, usableSpecs,
  faceWorldWord, DECLARABLE_FACES,
  GRASP_FEATURE_STATE, FULL_REGION, STRATEGY_FALLBACK,
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
 * @property {{x:number,y:number,z:number}} [innerDimensions] cavity full extents when
 *           the body is HOLLOW (ADR-133 D1). Absent means solid — never `{0,0,0}`,
 *           which would make "no cavity declared" and "a cavity of zero size" the
 *           same value (原則 #31).
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

// `rotateVec3` moved to its own module so graspFeature.js (the face-word
// derivation, ADR-152 D2) can use the same one without an import cycle (§1.1).
export { rotateVec3 }

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
      // 空洞の内寸 (ADR-133 D1)。宣言が無ければ `undefined` = **中身の詰まった
      // 立体**。`{0,0,0}` で埋めないのは、「空洞を宣言していない」と「空洞の大きさが
      // ゼロ」を区別できなくするため (原則 #31)。この一語だけがトレーを 1 つの箱と
      // 5 枚の壁に分ける。
      innerDimensions: isVec3(e.innerDimensions) ? {
        x: e.innerDimensions.x, y: e.innerDimensions.y, z: e.innerDimensions.z,
      } : undefined,
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
 * Which faces the DERIVED sampling (ADR-118) covers for this run — the faces the
 * hand touches, whole. Used when nothing narrows the search (`derived`,
 * `declared-anywhere`) and, under declared specs, only as the declared
 * `fallback: 'derived'` (ADR-152 D1).
 *
 * `malformed` samples NOTHING and says so by returning an empty plan: the submit
 * gate (`graspFeatureGaps`) blocks the run before it can be mistaken for "the
 * solver found no pose".
 *
 * @param {{state:string}|null|undefined} feature
 * @param {string|null} gripperKind
 * @returns {{face: string, region: {uMin:number,uMax:number,vMin:number,vMax:number}}[]}
 */
export function samplingPlanFor(feature, gripperKind = null) {
  const state = feature?.state ?? GRASP_FEATURE_STATE.DERIVED
  if (state === GRASP_FEATURE_STATE.MALFORMED) return []
  return facesForGripperKind(gripperKind).map(face => ({ face, region: FULL_REGION }))
}

/**
 * Does a run with this declaration send the derived `surfaceSamples` at all?
 * Always, unless specs are declared — then only for `fallback: 'derived'`
 * (ADR-152 D1: a declaration is never silently widened; the one widening is the
 * one the user declares).
 * @param {{state:string, strategy?:{fallback:string}}|null|undefined} feature
 * @returns {boolean}
 */
export function sendsDerivedSamples(feature) {
  const state = feature?.state ?? GRASP_FEATURE_STATE.DERIVED
  if (state === GRASP_FEATURE_STATE.MALFORMED) return false
  if (state !== GRASP_FEATURE_STATE.DECLARED_SPECS) return true
  return feature.strategy?.fallback === STRATEGY_FALLBACK.DERIVED
}

/**
 * The grid of one face region, in the WORLD frame (mm), each sample carrying the
 * face's outward world normal. The one sampler: the derived faces and every spec's
 * approach region go through it, so a full region reproduces the pre-ADR-119 set
 * exactly and a migrated face list reproduces its old samples exactly.
 *
 * @param {GraspTarget} target
 * @param {string} face
 * @param {{uMin:number,uMax:number,vMin:number,vMax:number}} region
 * @returns {{point:[number,number,number], normal:[number,number,number]}[]}
 */
export function faceRegionSamples(target, face, region) {
  const { position: p, dimensions: d, rotation: q } = target
  const half = { x: d.x / 2, y: d.y / 2, z: d.z / 2 }
  const n = faceNormalOrThrow(face)
  const worldNormal = rotateVec3(n, q)
  const [uAxis, vAxis] = inPlaneAxesOrThrow(face)
  const nAxis = n.x !== 0 ? 'x' : n.y !== 0 ? 'y' : 'z'
  const samples = []
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
  return samples
}

/**
 * Derive the wire-shaped `target.surfaceSamples` for one target: a grid over each
 * face the DERIVED plan covers (`samplingPlanFor`), each sample carrying that
 * face's outward normal, expressed in the world frame.
 *
 * Choosing WHICH face is a declaration (what the hand touches); deciding whether
 * the grasp holds is `core/`'s. Rotation is applied to the local offsets and to
 * the normals, so a tilted solid reports its actual faces rather than an
 * axis-aligned lie.
 *
 * @param {GraspTarget} target
 * @param {string|null} [gripperKind]  a `GRIPPER_KIND` value, or null when undeclared
 * @returns {{point:[number,number,number], normal:[number,number,number]}[]}
 */
export function surfaceSamplesFor(target, gripperKind = null) {
  if (!target) return []
  return samplingPlanFor(target.feature, gripperKind)
    .flatMap(({ face, region }) => faceRegionSamples(target, face, region))
}

/**
 * The wire-shaped `target.graspSpecs` for one target and the declared hand
 * (ADR-152 D4), in priority order, only the specs this hand can use
 * (`usableSpecs`). Everything is resolved from the object's LOCAL declaration to
 * the WORLD frame here — the approach region's grid, the closing axis rotated by
 * the object's pose — so `core/` never learns about local axes. Lengths stay in
 * the scene unit (mm); the controller converts at the wire (ADR-136).
 *
 * Absent facts stay absent: no closing axis → no `closingAxis` key (the solver
 * then tries every roll, as before); depth 0 is sent only when DECLARED.
 *
 * @param {GraspTarget} target
 * @param {string|null} gripperKind
 * @returns {{id:string, samples:object[], closingAxis?:[number,number,number], depth?:number, tiltTolerance?:number}[]}
 */
export function graspSpecsFor(target, gripperKind = null) {
  if (!target) return []
  return usableSpecs(target.feature, gripperKind).map(spec => {
    const wire = {
      id: spec.name,
      samples: faceRegionSamples(target, spec.approach.from, spec.approach.region),
    }
    if (spec.closing) {
      const a = { x: 0, y: 0, z: 0 }
      a[spec.closing] = 1
      const w = rotateVec3(a, target.rotation)
      wire.closingAxis = /** @type {[number,number,number]} */ ([w.x, w.y, w.z])
    }
    if (spec.depthDeclared) wire.depth = spec.depth
    if (spec.approach.tiltTolerance !== null) wire.tiltTolerance = spec.approach.tiltTolerance
    return wire
  })
}

/**
 * The target itself as a wire box (ADR-152 D4) — centre and half-extents in the
 * scene unit (mm), its world rotation. Sent so `core/` can measure a declared
 * closing axis's width as the object's THICKNESS; it never becomes an obstacle.
 * Same shape as an obstacle box minus `kind` — the contract's `target.box` is
 * one box by definition and carries no discriminator.
 * @param {GraspTarget} target
 * @returns {{center:[number,number,number], halfExtents:[number,number,number], orientation:[number,number,number,number]}}
 */
export function targetBoxFor(target) {
  const { kind: _kind, ...rest } = box(target.position, halved(target.dimensions), target.rotation)
  return rest
}

/**
 * Derive the wire-shaped `obstacles` for a run: every OTHER graspable body in the
 * layout, as an ORIENTED BOX (ADR-133 D5).
 *
 * ## Why this stopped being a bounding sphere
 *
 * The sphere form (half the box diagonal) was chosen as "deliberately
 * conservative": it over-covers the corners, so it can only ever reject a
 * candidate an exact test would pass, never the reverse. That argument is sound
 * for the APPROACH PATH, and it was the only consumer when it was written.
 *
 * ADR-145 gave the obstacles a second consumer — the arm's own links — and there
 * the same conservatism stops being safe and becomes useless. Measured on the
 * single-arm cell: the pedestal (300x300x120) has a bounding-sphere radius of
 * 220.5mm, and the robot's own base sits 60mm from its centre. **The robot grows
 * out of the inside of its own obstacle.** Every arm configuration collides, so
 * either the whole check is discarded or the first link is excluded by hand; the
 * shoulder origin cleared that sphere by 2.5mm, which is not a margin, it is a
 * coincidence. As a box the same pedestal is simply a surface the base rests on.
 *
 * An entity already declares everything an exact box needs — centre, full extents
 * and a world quaternion — so this is not an approximation being refined. It is
 * the declaration being passed through instead of being thrown away.
 *
 * The target itself is excluded — an object cannot be its own obstacle, and
 * including it would reject every candidate that touches the thing being picked.
 *
 * @param {GraspTarget[]} targets
 * @param {string|null} excludeRef  ref of the target being grasped
 * @returns {WireObstacle[]}
 */
export function obstaclesExcluding(targets, excludeRef) {
  return (targets ?? [])
    .filter(t => t.ref !== excludeRef)
    .flatMap(t => boxesForBody(t))
}

/**
 * @typedef {{kind:'box', center:[number,number,number],
 *            halfExtents:[number,number,number],
 *            orientation:[number,number,number,number]}} WireObstacle
 */

/**
 * One body → the boxes that stand for it on the wire.
 *
 * A plain solid is one box. A body that declares `innerDimensions` is HOLLOW and
 * becomes its walls instead (ADR-133 D2) — see `hollowBodyBoxes`.
 *
 * @param {GraspTarget} t
 * @returns {WireObstacle[]}
 */
export function boxesForBody(t) {
  const inner = t.innerDimensions
  if (isVec3(inner)) return hollowBodyBoxes(t, inner)
  return [box(t.position, halved(t.dimensions), t.rotation)]
}

/** @param {{x:number,y:number,z:number}} d */
function halved(d) {
  return { x: d.x / 2, y: d.y / 2, z: d.z / 2 }
}

/**
 * Build one wire box. Local offsets are rotated by the body's own quaternion, so
 * the walls of a turned tray turn with it rather than staying axis-aligned.
 *
 * @param {{x:number,y:number,z:number}} center
 * @param {{x:number,y:number,z:number}} half
 * @param {{x:number,y:number,z:number,w:number}} q
 * @returns {WireObstacle}
 */
function box(center, half, q) {
  return {
    kind: 'box',
    center: /** @type {[number,number,number]} */ ([center.x, center.y, center.z]),
    halfExtents: /** @type {[number,number,number]} */ ([half.x, half.y, half.z]),
    orientation: /** @type {[number,number,number,number]} */ ([q.x, q.y, q.z, q.w]),
  }
}

/**
 * A hollow body (tray, bin, tote) → **five boxes**: one floor and four walls
 * (ADR-133 D2).
 *
 * ## Why five and not one
 *
 * One box for a tray claims the tray is solid, so nothing can ever be picked out
 * of it: every candidate that reaches inside is rejected, and the funnel says
 * "interference" for what is actually the normal way to use a tray. The interior
 * has to be empty for the arm to be allowed in, and the only way to say that with
 * convex boxes is to name the shell.
 *
 * ## Why the thicknesses are derived and not declared
 *
 * Wall thickness is `(outer − inner)/2` per horizontal axis and the floor is
 * `outer.z − inner.z` (ADR-133 D1). Declaring both the inner size and the
 * thickness would let them disagree; one of the two has to be the derived one
 * (§1.1), and the measured quantities a person actually has are the inner and
 * outer sizes.
 *
 * The interior is open at the TOP — a lid is a different body, and a tray that
 * declared one would be a closed box, not a tray.
 *
 * ## これは障害物の粒度だけで、シーングラフではない (DEF-041)
 *
 * ADR-133 D1 は Layout DSL に `Container` entity type を足し、D2 は壁を**個別に選択
 * できる Solid** として Outliner に出す設計だった。今日**未実装**なのはそちらで、
 * ここが割るのは *core/ へ送る障害物*に限られる。既存 Solid の `innerDimensions` で
 * 代替したのは、要求が干渉判定の粒度であって新しい実体種別ではなく、entity type を
 * 増やすと Outliner・選択・コンパイラ・ギャラリーへ波及するから — 壁を個別選択させる
 * かどうかは **UI 側の別の判断**である。
 *
 * @param {GraspTarget} t
 * @param {{x:number,y:number,z:number}} inner  inner (cavity) full extents
 * @returns {WireObstacle[]}
 */
export function hollowBodyBoxes(t, inner) {
  const outer = t.dimensions
  const q = t.rotation
  const ho = halved(outer)
  const hi = halved(inner)
  // 厚み (導出): 水平は両側に等分、床は下側にだけ付く。
  const wallX = ho.x - hi.x
  const wallY = ho.y - hi.y
  const floor = outer.z - inner.z
  // 内寸が外寸以上 = 壁が無い。これは「薄い壁」ではなく**宣言の誤り**なので、
  // 0 厚の壁を 4 枚置いて「囲われている」ふりをせず、中身の無い箱として扱う
  // (原則 #11 の裏返し — 黙って意味の違うものを返さない)。
  if (wallX <= 0 || wallY <= 0 || floor <= 0) {
    return [box(t.position, ho, q)]
  }
  const cavityCenterZ = -ho.z + floor + hi.z   // 空洞の中心 (ローカル)
  /** @param {{x:number,y:number,z:number}} local */
  const placed = (local, half) => {
    const w = rotateVec3(local, q)
    return box(
      { x: t.position.x + w.x, y: t.position.y + w.y, z: t.position.z + w.z },
      half,
      q,
    )
  }
  return [
    // 床: 外寸いっぱいの板。
    placed({ x: 0, y: 0, z: -ho.z + floor / 2 }, { x: ho.x, y: ho.y, z: floor / 2 }),
    // 壁 ±X: 空洞の高さぶんだけ立つ。
    placed({ x: -(hi.x + wallX / 2), y: 0, z: cavityCenterZ }, { x: wallX / 2, y: ho.y, z: hi.z }),
    placed({ x: +(hi.x + wallX / 2), y: 0, z: cavityCenterZ }, { x: wallX / 2, y: ho.y, z: hi.z }),
    // 壁 ±Y: X 壁と重ならないよう内寸幅に収める (二重に数えない)。
    placed({ x: 0, y: -(hi.y + wallY / 2), z: cavityCenterZ }, { x: hi.x, y: wallY / 2, z: hi.z }),
    placed({ x: 0, y: +(hi.y + wallY / 2), z: cavityCenterZ }, { x: hi.x, y: wallY / 2, z: hi.z }),
  ]
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
    // "+x — where is that?" for the SELECTED object as it stands now (ADR-152 D2):
    // face → world word ('top', 'left', 'tilted'). Derived from its rotation on
    // every refresh, never stored — turn the object and the words change while
    // the declaration does not.
    faceWords:   selected
      ? Object.fromEntries(DECLARABLE_FACES.map(f => [f, faceWorldWord(f, selected.rotation).word]))
      : null,
  }
}
