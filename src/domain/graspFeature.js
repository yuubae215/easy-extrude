/**
 * graspFeature — "where on this object should it be grasped" as a DECLARATION
 * (ADR-119 D2/D3, ADR-128).
 *
 * ## Why this module exists
 *
 * Before it, where to grasp was 100% derived: `FACES_BY_GRIPPER_KIND` (ADR-118)
 * picked the faces a hand touches and a 3×3 grid picked the points. That is a
 * good DEFAULT and a bad ONLY option — a grasp point depends on the workpiece's
 * function (a handle, a flat landing, a keep-out), which geometry cannot know.
 * The user had no way to say "grasp it HERE".
 *
 * ## The state that does not look like a state (原則 #31)
 *
 * The whole point of this module is that **"I never said" and "I said anywhere"
 * are different**, and both differ again from **"I said something broken"**:
 *
 *   derived            — no declaration. Falls back to ADR-118's face derivation,
 *                        and the panel SAYS SO ("sampled the whole +Z face") so
 *                        the user can notice they never chose.
 *   declared-anywhere  — the user looked and decided not to narrow. Same samples
 *                        as `derived`, deliberately NOT the same state: one is an
 *                        answer, the other is a silence.
 *   declared-specs     — 1..N named grasp specs + a strategy (ADR-152 D1; a
 *                        legacy face list is migrated into this state).
 *   malformed          — a declaration exists but cannot be read. Never degraded
 *                        to `derived`: "declared and quietly ignored" is exactly
 *                        the lie D3 forbids, and it would come back as a
 *                        well-formed answer of zero candidates (原則 #11).
 *
 * ## Declaration wins, one direction (ADR-119 D3)
 *
 * When specs are declared, candidates come from THOSE specs only. They are never
 * merged with the derived set: a user who declared "here and nowhere else" would
 * find their statement silently widened. The one exception is the one the user
 * declares — `strategy.fallback: 'derived'`.
 *
 * ## What this module does NOT do (scope boundary — CLAUDE.md)
 *
 * It says WHERE the surface is worth touching. Whether the hand can close there,
 * whether the approach clips something, whether the arm reaches — all of that is
 * solved in `core/` behind the contract. Pure module (no THREE / no DOM) so the
 * THREE-free `test:context` lane and the controller share one definition (§1.1).
 *
 * @module domain/graspFeature
 */

import { GRIPPER_KIND } from '../context/GraspDeclarationCatalog.js'
import { rotateVec3 } from './rotateVec3.js'

/**
 * The declaration's kind — a closed, kind-discriminated union, same governance as
 * `gripper` (ADR-118) and `robot.kinematics` (ADR-127). The kind decides which
 * fields even exist, so it is carried rather than inferred (原則 #2).
 *
 * ADR-152 D1 replaced the face list with named GRASP SPECS: a "face" had been
 * doing two jobs (where the hand comes from, and what the jaws touch), and the
 * commonest instruction on a shop floor — "come down from the top, pinch the
 * sides, 20 mm below the top face" — could not be said with it. The old list is
 * still READ (see `LEGACY_FACE_LIST_KIND`) and migrated on the way in; nothing
 * writes it.
 */
export const GRASP_FEATURE_KIND = Object.freeze({
  ANYWHERE: 'anywhere',
  SPECS:    'specs',
})

/** Every kind a document may declare — the population an unknown kind is measured against. */
export const DECLARED_FEATURE_KINDS = Object.freeze(Object.values(GRASP_FEATURE_KIND))

/**
 * The pre-ADR-152 face-list kind. READ ONLY: a document that still says it is
 * migrated to specs by `resolveGraspFeature` (lossless — same samples, same
 * answer) and the migration is counted and reported. It is deliberately not in
 * `DECLARED_FEATURE_KINDS`: listing it there would make it a thing one may write,
 * i.e. a second way to say "grasp only here" (§1.1).
 */
export const LEGACY_FACE_LIST_KIND = 'faces'

/**
 * The resolved STATE of one target's grasp-location declaration. Four values, and
 * the reason there are four rather than two is the whole ADR: silence, an explicit
 * "anywhere", a narrowed declaration, and a broken one must each be
 * distinguishable — collapsing any pair of them hides a real difference behind an
 * identical-looking answer (原則 #31). ADR-152 renamed the third and added none.
 */
export const GRASP_FEATURE_STATE = Object.freeze({
  DERIVED:           'derived',
  DECLARED_ANYWHERE: 'declared-anywhere',
  DECLARED_SPECS:    'declared-specs',
  MALFORMED:         'malformed',
})

/** Which hand a spec is written for (the wire's gripper kinds). */
export const SPEC_HANDS = Object.freeze(Object.values(GRIPPER_KIND))

/** The jaws' closing axes — a LOCAL axis of the object. */
export const CLOSING_AXES = Object.freeze(['x', 'y', 'z'])

/**
 * How the specs are used (ADR-152 D1). The ORDER of the spec list is the
 * priority, so no spec carries a number — "two specs at rank 3" stays
 * unrepresentable.
 */
export const STRATEGY_ORDER = Object.freeze({ PRIORITY: 'priority', SCORE: 'score' })
export const STRATEGY_FALLBACK = Object.freeze({ NONE: 'none', DERIVED: 'derived' })

/**
 * What an omitted strategy means — the same default ADR-119 D3 chose ("the
 * declaration wins": try in order, never quietly widen). Carried alongside
 * `strategyDeclared: false` so the panel can say "(default)" instead of passing
 * the default off as something the user said (原則 #31).
 */
export const DEFAULT_STRATEGY = Object.freeze({
  order: STRATEGY_ORDER.PRIORITY, fallback: STRATEGY_FALLBACK.NONE,
})

/**
 * The strategy a migrated face list gets: every face's samples mixed and ranked
 * by score, nothing derived — exactly what the face list used to mean.
 */
const MIGRATED_STRATEGY = Object.freeze({
  order: STRATEGY_ORDER.SCORE, fallback: STRATEGY_FALLBACK.NONE,
})

/**
 * The six faces of a box, named by their outward local axis. This is the whole
 * declarable vocabulary today (ADR-119 D2 "面 + その上の領域"); a curved-surface
 * or handle vocabulary is the falsification this assumption is waiting for.
 */
export const DECLARABLE_FACES = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z'])

/** Local-frame outward normal of each declarable face. */
const FACE_NORMAL = Object.freeze({
  '+x': Object.freeze({ x:  1, y:  0, z:  0 }),
  '-x': Object.freeze({ x: -1, y:  0, z:  0 }),
  '+y': Object.freeze({ x:  0, y:  1, z:  0 }),
  '-y': Object.freeze({ x:  0, y: -1, z:  0 }),
  '+z': Object.freeze({ x:  0, y:  0, z:  1 }),
  '-z': Object.freeze({ x:  0, y:  0, z: -1 }),
})

/** Which local axis a face's normal runs along. */
const FACE_AXIS = Object.freeze({ '+x': 'x', '-x': 'x', '+y': 'y', '-y': 'y', '+z': 'z', '-z': 'z' })

/**
 * The two in-plane axes of a face, in (u, v) order. Fixed per normal axis so a
 * region declared on `+x` means the same thing as the same region on `-x` — a
 * region whose meaning depended on which side you sampled would be unusable.
 */
const IN_PLANE_AXES = Object.freeze({
  x: Object.freeze(['y', 'z']),
  y: Object.freeze(['x', 'z']),
  z: Object.freeze(['x', 'y']),
})

/** The opposite of each face — what a parallel jaw needs a pair of. */
const OPPOSITE_FACE = Object.freeze({
  '+x': '-x', '-x': '+x', '+y': '-y', '-y': '+y', '+z': '-z', '-z': '+z',
})

/** A region covering the whole face — what an omitted region means. */
export const FULL_REGION = Object.freeze({ uMin: 0, uMax: 1, vMin: 0, vMax: 1 })

/**
 * Outward local normal of a declared face. **Throws on a face outside the
 * vocabulary** (原則 #31): defaulting would put a sample with a fabricated normal
 * on the wire, and `core/` derives the approach direction from that normal — a
 * guessed one is not a slightly-wrong answer, it is a confidently wrong one.
 *
 * @param {string} face
 * @returns {{x:number,y:number,z:number}}
 */
export function faceNormalOrThrow(face) {
  const n = FACE_NORMAL[face]
  if (!n) {
    throw new Error(
      `graspFeature: 未宣言の面 "${face}"。DECLARABLE_FACES は ${DECLARABLE_FACES.join(' / ')} ` +
      `— 既定へ倒すと、存在しない面の法線でアプローチ方向が決まる`,
    )
  }
  return n
}

/** The local axis a face's normal runs along ('x' | 'y' | 'z'). */
export function faceAxisOrThrow(face) {
  faceNormalOrThrow(face)
  return FACE_AXIS[face]
}

/** The face's two in-plane axes as [uAxis, vAxis]. */
export function inPlaneAxesOrThrow(face) {
  return IN_PLANE_AXES[faceAxisOrThrow(face)]
}

/**
 * The world word for each world axis direction — ROS REP-103 (CLAUDE.md: +X
 * forward, +Y left, +Z up). These are the words a person uses for the cell, which
 * is exactly why they are NOT the declaration's vocabulary: an object turned 90°
 * about Z would take its "front" with it (ADR-152 案 L).
 */
const WORLD_WORDS = Object.freeze([
  Object.freeze({ axis: Object.freeze({ x:  1, y:  0, z:  0 }), word: 'front' }),
  Object.freeze({ axis: Object.freeze({ x: -1, y:  0, z:  0 }), word: 'back' }),
  Object.freeze({ axis: Object.freeze({ x:  0, y:  1, z:  0 }), word: 'left' }),
  Object.freeze({ axis: Object.freeze({ x:  0, y: -1, z:  0 }), word: 'right' }),
  Object.freeze({ axis: Object.freeze({ x:  0, y:  0, z:  1 }), word: 'top' }),
  Object.freeze({ axis: Object.freeze({ x:  0, y:  0, z: -1 }), word: 'bottom' }),
])

/** Beyond this angle from every world axis a face is "tilted", not "top" (ADR-152 D2). */
export const FACE_WORD_MAX_ANGLE = 30 * Math.PI / 180

/** The word for a face that points along no world axis (never a false "top"). */
export const TILTED_WORD = 'tilted'

/**
 * "+x — where is that?" answered in the words of the cell (ADR-152 D2).
 *
 * The declaration stays in LOCAL axes (it turns with the object — the reason 案 L
 * was rejected); this DERIVES, for the object's current rotation, which way that
 * local face points in the world and names it: `+z · top`, `+x · left` (after a
 * 90° turn about Z). A face more than 30° from every world axis is `tilted` — a
 * made-up "top" on a tipped box is the lie this word exists to prevent.
 *
 * Derived, never stored: turn the object and the word changes while the
 * declaration does not. Pure (no THREE) — the panel chip and the 3D label read it.
 *
 * @param {string} face  a DECLARABLE_FACES value (throws otherwise — 原則 #31)
 * @param {{x:number,y:number,z:number,w:number}|null|undefined} rotation  the object's world rotation
 * @returns {{face: string, word: string, worldNormal: {x:number,y:number,z:number}, label: string}}
 */
export function faceWorldWord(face, rotation) {
  const n = faceNormalOrThrow(face)
  const q = rotation ?? { x: 0, y: 0, z: 0, w: 1 }
  const w = rotateVec3(n, q)
  const len = Math.hypot(w.x, w.y, w.z) || 1
  const unit = { x: w.x / len, y: w.y / len, z: w.z / len }
  let best = null
  let bestDot = -Infinity
  for (const cand of WORLD_WORDS) {
    const d = cand.axis.x * unit.x + cand.axis.y * unit.y + cand.axis.z * unit.z
    if (d > bestDot) { bestDot = d; best = cand }
  }
  const angle = Math.acos(Math.max(-1, Math.min(1, bestDot)))
  const word = angle > FACE_WORD_MAX_ANGLE ? TILTED_WORD : best.word
  return { face, word, worldNormal: unit, label: `${face} · ${word}` }
}

/**
 * The two CONTACT faces a closing axis implies (ADR-152: derived, never declared)
 * — what the jaws touch, as distinct from where the hand comes from.
 * @param {'x'|'y'|'z'} axis
 * @returns {[string, string]}
 */
export function contactFacesOf(axis) {
  if (!CLOSING_AXES.includes(axis)) {
    throw new Error(`graspFeature: 未宣言の閉じ軸 "${axis}" — CLOSING_AXES は ${CLOSING_AXES.join(' / ')}`)
  }
  return [`+${axis}`, `-${axis}`]
}

/** True when `a` and `b` are opposed faces of the box (what jaws close across). */
export function facesAreOpposed(a, b) {
  return OPPOSITE_FACE[a] === b
}

/** Finite-number guard shared by every numeric field here (NaN is not a small number). */
function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * Read one face's optional region, returning `{ region, errors }`.
 *
 * A region is normalised [0,1] across the face's two in-plane axes, so it means
 * the same fraction of the face whatever the solid's size — a region in metres
 * would silently stop covering the face the day the box is resized.
 *
 * An unreadable region is an ERROR, not a fallback to the full face: "I narrowed
 * it to the handle" degrading to "anywhere on this face" is the silent widening
 * D3 exists to prevent.
 */
function readRegion(raw, where) {
  if (raw === undefined || raw === null) return { region: FULL_REGION, errors: [] }
  if (typeof raw !== 'object') return { region: null, errors: [`${where}: region must be an object`] }

  const { uMin = 0, uMax = 1, vMin = 0, vMax = 1 } = raw
  const errors = []
  for (const [k, v] of Object.entries({ uMin, uMax, vMin, vMax })) {
    if (!isFiniteNumber(v)) errors.push(`${where}: region.${k} must be a finite number`)
    else if (v < 0 || v > 1) errors.push(`${where}: region.${k} must be within 0..1 (normalised across the face)`)
  }
  if (errors.length) return { region: null, errors }
  if (!(uMin < uMax)) errors.push(`${where}: region needs uMin < uMax (an empty region declares nowhere to grasp)`)
  if (!(vMin < vMax)) errors.push(`${where}: region needs vMin < vMax (an empty region declares nowhere to grasp)`)
  if (errors.length) return { region: null, errors }

  return { region: Object.freeze({ uMin, uMax, vMin, vMax }), errors: [] }
}

/**
 * **The single resolution point** for "what did this entity say about where to
 * grasp it" (§1.1). Every consumer — the sampler, the panel, the viewport
 * overlay, the submit gate — asks this and none of them reads
 * `entity.graspFeature` itself.
 *
 * Always returns a complete answer; never throws on document content, because a
 * hand-written `.ctx.json` typo must not take down the grasp panel. The broken
 * case comes back as `MALFORMED` with printable reasons instead (原則 #11).
 *
 * A legacy face list (`kind: 'faces'`) is migrated here, on read (ADR-152 D1):
 * each face becomes one spec approaching from that face over its region, with no
 * closing axis, depth or tilt tolerance (= the old candidate set), and the
 * strategy is `score` / `none` (= the old union ranked by score). The migrated
 * specs carry `hand: null` — "whatever hand is declared", which is what a face
 * list meant, having no hand of its own. `migratedFaces` counts them so the panel
 * can say so (the ADR-151 legacy-tcp etiquette).
 *
 * @param {any} entity  a Layout DSL entity (or anything, including null)
 * @returns {ResolvedGraspFeature}
 */
export function resolveGraspFeature(entity) {
  const raw = entity?.graspFeature
  if (raw === undefined || raw === null) return resolved(GRASP_FEATURE_STATE.DERIVED)
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return malformed(['graspFeature must be an object'])
  }
  if (raw.kind === GRASP_FEATURE_KIND.ANYWHERE) return resolved(GRASP_FEATURE_STATE.DECLARED_ANYWHERE)
  if (raw.kind === LEGACY_FACE_LIST_KIND) return migrateFaceList(raw)
  if (raw.kind !== GRASP_FEATURE_KIND.SPECS) {
    return malformed([
      `graspFeature.kind "${raw.kind}" is not declared — use one of: ${DECLARED_FEATURE_KINDS.join(' / ')}`,
    ])
  }

  if (!Array.isArray(raw.specs) || raw.specs.length === 0) {
    // The zero that does not look like a state (原則 #31): an empty spec list
    // names no way to grasp, and downstream it would be `candidatesGenerated: 0`.
    return malformed(['graspFeature.specs must list at least one grasp spec (an empty list declares no way to grasp)'])
  }

  const specs  = []
  const errors = []
  const names  = new Set()
  for (const [i, item] of raw.specs.entries()) {
    const { spec, errors: specErrors } = readSpec(item, `graspFeature.specs[${i}]`)
    if (specErrors.length) { errors.push(...specErrors); continue }
    if (names.has(spec.name)) {
      errors.push(`graspFeature.specs[${i}]: name "${spec.name}" is used twice — a result could not say which spec it came from`)
      continue
    }
    names.add(spec.name)
    specs.push(spec)
  }
  const { strategy, declared, errors: strategyErrors } = readStrategy(raw.strategy)
  errors.push(...strategyErrors)
  if (errors.length) return malformed(errors)
  return resolved(GRASP_FEATURE_STATE.DECLARED_SPECS, { specs, strategy, strategyDeclared: declared })
}

/**
 * @typedef {object} ResolvedGraspSpec
 * @property {string} name
 * @property {string|null} hand   a SPEC_HANDS value, or null = migrated (any hand)
 * @property {{from: string, region: {uMin:number,uMax:number,vMin:number,vMax:number},
 *             tiltTolerance: number|null}} approach
 * @property {'x'|'y'|'z'|null} closing   null = every roll (not declared)
 * @property {number} depth      Layout length unit (mm); 0 when not declared
 * @property {boolean} depthDeclared
 */

/**
 * @typedef {object} ResolvedGraspFeature
 * @property {string} state
 * @property {ResolvedGraspSpec[]} specs
 * @property {{order: string, fallback: string}} strategy
 * @property {boolean} strategyDeclared
 * @property {number} migratedFaces  how many legacy faces were migrated into specs (0 = none)
 * @property {string[]} errors
 */

function resolved(state, extra = {}) {
  return {
    state,
    specs: [],
    strategy: DEFAULT_STRATEGY,
    strategyDeclared: false,
    migratedFaces: 0,
    errors: [],
    ...extra,
  }
}

function malformed(errors) {
  return resolved(GRASP_FEATURE_STATE.MALFORMED, { errors })
}

/** The pre-ADR-152 face list → specs (lossless — see `resolveGraspFeature`). */
function migrateFaceList(raw) {
  if (!Array.isArray(raw.faces) || raw.faces.length === 0) {
    return malformed(['graspFeature.faces must list at least one face (an empty list declares nowhere to grasp)'])
  }
  const specs  = []
  const errors = []
  const seen   = new Set()
  for (const [i, item] of raw.faces.entries()) {
    const where = `graspFeature.faces[${i}]`
    const face  = typeof item === 'string' ? item : item?.face
    if (!DECLARABLE_FACES.includes(face)) {
      errors.push(`${where}: face "${face}" is not one of ${DECLARABLE_FACES.join(' / ')}`)
      continue
    }
    if (seen.has(face)) {
      errors.push(`${where}: face "${face}" is declared twice`)
      continue
    }
    seen.add(face)
    const { region, errors: regionErrors } = readRegion(typeof item === 'string' ? null : item?.region, where)
    if (regionErrors.length) { errors.push(...regionErrors); continue }
    specs.push(Object.freeze({
      name: face, hand: null,
      approach: Object.freeze({ from: face, region, tiltTolerance: null }),
      closing: null, depth: 0, depthDeclared: false,
    }))
  }
  if (errors.length) return malformed(errors)
  return resolved(GRASP_FEATURE_STATE.DECLARED_SPECS, {
    specs, strategy: MIGRATED_STRATEGY, strategyDeclared: true, migratedFaces: specs.length,
  })
}

/** One spec of `graspFeature.specs` → `{ spec, errors }` (ADR-152 D1). */
function readSpec(item, where) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { spec: null, errors: [`${where}: a grasp spec must be an object`] }
  }
  const errors = []
  const name = item.name
  if (typeof name !== 'string' || name.trim() === '') errors.push(`${where}: name is required (the result is reported per spec by name)`)
  if (!SPEC_HANDS.includes(item.hand)) errors.push(`${where}: hand must be one of ${SPEC_HANDS.join(' / ')}`)
  const approach = item.approach
  const from = approach?.from
  if (!DECLARABLE_FACES.includes(from)) {
    errors.push(`${where}: approach.from "${from}" is not one of ${DECLARABLE_FACES.join(' / ')}`)
  }
  const { region, errors: regionErrors } = readRegion(approach?.region, `${where}.approach`)
  errors.push(...regionErrors)
  const tilt = approach?.tiltTolerance
  if (tilt !== undefined && tilt !== null && (!isFiniteNumber(tilt) || tilt < 0)) {
    errors.push(`${where}: approach.tiltTolerance must be a number ≥ 0 (radians)`)
  }

  const closing = item.closing ?? null
  const depth   = item.depth
  if (closing !== null && !CLOSING_AXES.includes(closing)) {
    errors.push(`${where}: closing must be one of ${CLOSING_AXES.join(' / ')}`)
  }
  if (depth !== undefined && depth !== null && (!isFiniteNumber(depth) || depth < 0)) {
    errors.push(`${where}: depth must be a number ≥ 0 (mm)`)
  }
  if (item.hand === GRIPPER_KIND.SUCTION) {
    // A cup has no jaws to close and seals ON the face — a closing axis or a depth
    // would be carried to the wire and mean nothing (原則 #11: consumed, no effect).
    if (closing !== null) errors.push(`${where}: a suction spec cannot declare closing (a cup has no jaws)`)
    if (depth !== undefined && depth !== null) errors.push(`${where}: a suction spec cannot declare depth (a cup seals on the face)`)
  }
  if (closing !== null && DECLARABLE_FACES.includes(from) && FACE_AXIS[from] === closing) {
    errors.push(
      `${where}: closing "${closing}" is the approach axis of ${from} — ` +
      'the jaws would close along the direction the hand comes from',
    )
  }
  if (errors.length) return { spec: null, errors }
  return {
    spec: Object.freeze({
      name: name.trim(),
      hand: item.hand,
      approach: Object.freeze({ from, region, tiltTolerance: isFiniteNumber(tilt) ? tilt : null }),
      closing,
      depth: isFiniteNumber(depth) ? depth : 0,
      depthDeclared: isFiniteNumber(depth),
    }),
    errors: [],
  }
}

/** `graspFeature.strategy` → `{ strategy, declared, errors }`. Omitted = the default, marked as such. */
function readStrategy(raw) {
  if (raw === undefined || raw === null) return { strategy: DEFAULT_STRATEGY, declared: false, errors: [] }
  const errors = []
  const orders = Object.values(STRATEGY_ORDER)
  const fallbacks = Object.values(STRATEGY_FALLBACK)
  if (!orders.includes(raw.order)) errors.push(`graspFeature.strategy.order must be one of ${orders.join(' / ')}`)
  if (!fallbacks.includes(raw.fallback)) errors.push(`graspFeature.strategy.fallback must be one of ${fallbacks.join(' / ')}`)
  if (errors.length) return { strategy: DEFAULT_STRATEGY, declared: false, errors }
  return { strategy: Object.freeze({ order: raw.order, fallback: raw.fallback }), declared: true, errors: [] }
}

/**
 * Can this spec be used with the declared hand? (ADR-152 D1) A jaw spec under a
 * cup is not MALFORMED — it is a perfectly good statement about the part that
 * this hand cannot act on — so it is excluded from the run WITH A REASON rather
 * than failing the document. A migrated spec (`hand: null`) and an undeclared
 * hand (`handKind == null`, the gate switched off) match everything.
 *
 * @param {ResolvedGraspSpec} spec
 * @param {string|null|undefined} handKind
 * @returns {{usable: boolean, reason: string|null}}
 */
export function specUsability(spec, handKind) {
  if (spec.hand == null || handKind == null || spec.hand === handKind) return { usable: true, reason: null }
  return { usable: false, reason: `${spec.name}: the declared hand (${handKind}) cannot use a ${spec.hand} spec` }
}

/** The specs a run with this hand sends, in priority order. */
export function usableSpecs(resolvedFeature, handKind) {
  if (resolvedFeature?.state !== GRASP_FEATURE_STATE.DECLARED_SPECS) return []
  return resolvedFeature.specs.filter(s => specUsability(s, handKind).usable)
}

/**
 * Why Run cannot proceed on the WHERE-TO-GRASP side — the twin of
 * `targetDeclarationGaps` / `gripperDeclarationGaps`, returned as printable
 * reasons rather than a bare disabled button (原則 #11).
 *
 * Three stops:
 *   - an unreadable declaration (never degraded to `derived`);
 *   - every spec excluded by the hand (ADR-152 D1: stop, do not fall to
 *     `fallback: derived` silently — the user asked for these specs);
 *   - the ADR-118 defect re-entered through the front door: a jaw spec with no
 *     closing axis has its opening measured from the spread of the specs'
 *     samples, so unless those samples include an OPPOSED pair of faces the
 *     measured width collapses and the gate passes everything. Declaring a
 *     closing axis fixes it properly (the width is then the box's thickness).
 *
 * @param {ResolvedGraspFeature} resolvedFeature  from `resolveGraspFeature`
 * @param {string|null|undefined} gripperKind  a `GRIPPER_KIND` value, or null when undeclared
 * @returns {string[]}
 */
export function graspFeatureGaps(resolvedFeature, gripperKind) {
  if (!resolvedFeature) return []
  if (resolvedFeature.state === GRASP_FEATURE_STATE.MALFORMED) {
    return resolvedFeature.errors.map(e => `grasp location declaration is unreadable — ${e}`)
  }
  if (resolvedFeature.state !== GRASP_FEATURE_STATE.DECLARED_SPECS) return []

  const usable = usableSpecs(resolvedFeature, gripperKind)
  if (usable.length === 0) {
    return [
      `no grasp spec can be used by the declared hand (${gripperKind}) — ` +
      resolvedFeature.specs.map(s => specUsability(s, gripperKind).reason).join('; '),
    ]
  }
  if (gripperKind !== GRIPPER_KIND.PARALLEL_JAW) return []

  const unclosed = usable.filter(s => s.closing === null)
  if (unclosed.length === 0) return []
  const faces = usable.map(s => s.approach.from)
  const hasPair = faces.some(a => faces.some(b => facesAreOpposed(a, b)))
  if (hasPair) return []
  return [
    `parallel jaw: ${unclosed.map(s => s.name).join(' / ')} declare${unclosed.length === 1 ? 's' : ''} no closing axis, ` +
    `and the specs approach only ${[...new Set(faces)].join(' / ')} — the solver would measure the opening from one face ` +
    'and report almost no width (ADR-118). Declare a closing axis (or an opposed pair of faces).',
  ]
}

/**
 * One-line English for what the samples of this run are based on — the sentence
 * that lets a user notice they never chose (ADR-119 D2 「導出に落ちたことは画面に
 * 出す」). Pure, so the panel and any future caption read the same words.
 *
 * @param {ResolvedGraspFeature} resolvedFeature
 * @param {ReadonlyArray<string>} derivedFaces  what ADR-118 would sample for the declared hand
 * @returns {string}
 */
export function graspFeatureSummary(resolvedFeature, derivedFaces = []) {
  switch (resolvedFeature?.state) {
    case GRASP_FEATURE_STATE.DECLARED_SPECS: {
      const n = resolvedFeature.specs.length
      const names = resolvedFeature.specs.map(s => s.name).join(', ')
      return `declared: ${n} grasp spec${n === 1 ? '' : 's'} (${names}) — ${strategySummary(resolvedFeature)}`
    }
    case GRASP_FEATURE_STATE.DECLARED_ANYWHERE:
      return `declared: anywhere — sampling ${derivedFaces.join(' / ') || 'the derived faces'}`
    case GRASP_FEATURE_STATE.MALFORMED:
      return 'declared, but unreadable — nothing is being sampled'
    default:
      return `not declared — sampling ${derivedFaces.join(' / ') || 'the derived faces'} for the declared hand`
  }
}

/**
 * The strategy in words, saying when it was NOT declared (ADR-152 D1 — an omitted
 * strategy is shown as the default it is, not passed off as a choice).
 */
export function strategySummary(resolvedFeature) {
  const st = resolvedFeature?.strategy ?? DEFAULT_STRATEGY
  const order = st.order === STRATEGY_ORDER.SCORE ? 'best score across specs' : 'in priority order'
  const fallback = st.fallback === STRATEGY_FALLBACK.DERIVED ? 'fall back to the derived faces' : 'no fallback'
  return `${order} · ${fallback}${resolvedFeature?.strategyDeclared ? '' : ' (default)'}`
}

/** Region in words ("whole face" or "20–80% × 0–50%"). */
export function regionSummary(r) {
  return isFullRegion(r)
    ? 'whole face'
    : `${pct(r.uMin)}–${pct(r.uMax)} × ${pct(r.vMin)}–${pct(r.vMax)}`
}

/** True when a region covers the whole face (the value an omitted region means). */
export function isFullRegion(r) {
  return !!r && r.uMin === 0 && r.uMax === 1 && r.vMin === 0 && r.vMax === 1
}

const pct = (t) => `${Math.round(t * 100)}%`

// ── Writing back (ADR-152 D1: the only shape ever written is `specs`) ─────────

/**
 * One resolved spec → its Layout DSL form. Omitted facts stay omitted (an
 * undeclared depth is not written as 0; a whole-face region is not written as a
 * region — ADR-128 D3), so reading the written form back gives the same spec.
 *
 * A migrated spec (`hand: null`) is stamped with the hand the user is editing
 * under: the face list it came from had no hand of its own, and writing `null`
 * would be a document that no longer validates.
 *
 * @param {ResolvedGraspSpec} spec
 * @param {string|null} handKind  the declared hand, used only for a migrated spec
 * @returns {object}
 */
export function specToDsl(spec, handKind) {
  const hand = spec.hand ?? handKind ?? GRIPPER_KIND.PARALLEL_JAW
  const approach = { from: spec.approach.from }
  if (!isFullRegion(spec.approach.region)) approach.region = { ...spec.approach.region }
  if (spec.approach.tiltTolerance !== null) approach.tiltTolerance = spec.approach.tiltTolerance
  const out = { name: spec.name, hand, approach }
  if (hand !== GRIPPER_KIND.SUCTION) {
    if (spec.closing) out.closing = spec.closing
    if (spec.depthDeclared) out.depth = spec.depth
  }
  return out
}

/**
 * A whole declaration → its Layout DSL form (`kind: 'specs'`). The strategy is
 * written only when it was declared (or migrated — the migration's `score` is a
 * real statement about the old face list's meaning, not a default).
 *
 * @param {ResolvedGraspSpec[]} specs
 * @param {{order:string, fallback:string}} strategy
 * @param {boolean} strategyDeclared
 * @param {string|null} handKind
 * @returns {object|null}  null when there is no spec left (= clear, never `specs: []`)
 */
export function featureToDsl(specs, strategy, strategyDeclared, handKind) {
  if (!specs.length) return null
  const out = { kind: GRASP_FEATURE_KIND.SPECS, specs: specs.map(s => specToDsl(s, handKind)) }
  if (strategyDeclared) out.strategy = { order: strategy.order, fallback: strategy.fallback }
  return out
}

/**
 * A fresh spec for the "+ spec" button: a name not yet used, the declared hand,
 * from the top. A jaw spec starts with NO closing axis and NO depth — the user
 * has not said them, and the panel shows them as not declared (原則 #31).
 * @param {ResolvedGraspSpec[]} existing
 * @param {string|null} handKind
 * @returns {ResolvedGraspSpec}
 */
export function newSpec(existing, handKind) {
  const used = new Set(existing.map(s => s.name))
  let i = existing.length + 1
  while (used.has(`spec ${i}`)) i++
  return {
    name: `spec ${i}`,
    hand: handKind ?? GRIPPER_KIND.PARALLEL_JAW,
    approach: { from: '+z', region: FULL_REGION, tiltTolerance: null },
    closing: null, depth: 0, depthDeclared: false,
  }
}
