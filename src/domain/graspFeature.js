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
 *   declared-faces     — 1..6 faces, each with an optional region on it.
 *   malformed          — a declaration exists but cannot be read. Never degraded
 *                        to `derived`: "declared and quietly ignored" is exactly
 *                        the lie D3 forbids, and it would come back as a
 *                        well-formed answer of zero candidates (原則 #11).
 *
 * ## Declaration wins, one direction (ADR-119 D3)
 *
 * When faces are declared, samples come from THOSE faces only. They are never
 * merged with the derived set: a user who declared "here and nowhere else" would
 * find their statement silently widened.
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

/**
 * The declaration's kind — a closed, kind-discriminated union, same governance as
 * `gripper` (ADR-118) and `robot.kinematics` (ADR-127). The kind decides which
 * fields even exist, so it is carried rather than inferred (原則 #2).
 */
export const GRASP_FEATURE_KIND = Object.freeze({
  ANYWHERE: 'anywhere',
  FACES:    'faces',
})

/** Every kind a document may declare — the population an unknown kind is measured against. */
export const DECLARED_FEATURE_KINDS = Object.freeze(Object.values(GRASP_FEATURE_KIND))

/**
 * The resolved STATE of one target's grasp-location declaration. Four values, and
 * the reason there are four rather than two is the whole ADR: silence, an explicit
 * "anywhere", a narrowed declaration, and a broken one must each be
 * distinguishable — collapsing any pair of them hides a real difference behind an
 * identical-looking answer (原則 #31).
 */
export const GRASP_FEATURE_STATE = Object.freeze({
  DERIVED:           'derived',
  DECLARED_ANYWHERE: 'declared-anywhere',
  DECLARED_FACES:    'declared-faces',
  MALFORMED:         'malformed',
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
 * @param {any} entity  a Layout DSL entity (or anything, including null)
 * @returns {{ state: string, faces: {face: string, region: {uMin:number,uMax:number,vMin:number,vMax:number}}[],
 *             errors: string[] }}
 */
export function resolveGraspFeature(entity) {
  const raw = entity?.graspFeature
  if (raw === undefined || raw === null) {
    return { state: GRASP_FEATURE_STATE.DERIVED, faces: [], errors: [] }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return malformed(['graspFeature must be an object'])
  }
  if (raw.kind === GRASP_FEATURE_KIND.ANYWHERE) {
    return { state: GRASP_FEATURE_STATE.DECLARED_ANYWHERE, faces: [], errors: [] }
  }
  if (raw.kind !== GRASP_FEATURE_KIND.FACES) {
    return malformed([
      `graspFeature.kind "${raw.kind}" is not declared — use one of: ${DECLARED_FEATURE_KINDS.join(' / ')}`,
    ])
  }

  if (!Array.isArray(raw.faces) || raw.faces.length === 0) {
    // The zero that does not look like a state (原則 #31): an empty faces[] is a
    // declaration that names nowhere, and its consequence downstream would be
    // zero surface samples — i.e. `candidatesGenerated: 0`, a well-formed answer.
    return malformed(['graspFeature.faces must list at least one face (an empty list declares nowhere to grasp)'])
  }

  const faces  = []
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
    faces.push({ face, region })
  }

  if (errors.length) return malformed(errors)
  return { state: GRASP_FEATURE_STATE.DECLARED_FACES, faces, errors: [] }
}

function malformed(errors) {
  return { state: GRASP_FEATURE_STATE.MALFORMED, faces: [], errors }
}

/**
 * Why Run cannot proceed on the WHERE-TO-GRASP side — the twin of
 * `targetDeclarationGaps` / `gripperDeclarationGaps`, returned as printable
 * reasons rather than a bare disabled button (原則 #11).
 *
 * ## The jaw rule is a real defect, not a formality
 *
 * ADR-118 fixed a gate that passed jaws which physically cannot close: `core/`
 * measures the object's width as the spread of the surface samples projected onto
 * the closing axis, so top-only sampling reported half the true width. A
 * DECLARATION can resurrect exactly that defect through the front door — declare
 * one face for a parallel jaw and the measured "width" collapses to the width of
 * that one face's sample grid, i.e. nearly nothing, and the gate passes
 * everything. So a jaw needs an OPPOSED PAIR, and saying so out loud beats
 * quietly adding the opposite face (which would be the merge D3 forbids).
 *
 * Any opposed pair counts, not specifically ±X: declaring "close across the top
 * and bottom" is a legitimate thing to mean, and the derived set is only a
 * default.
 *
 * @param {{state: string, faces: {face:string}[], errors: string[]}} resolved  from `resolveGraspFeature`
 * @param {string|null|undefined} gripperKind  a `GRIPPER_KIND` value, or null when undeclared
 * @returns {string[]}
 */
export function graspFeatureGaps(resolved, gripperKind) {
  if (!resolved) return []
  if (resolved.state === GRASP_FEATURE_STATE.MALFORMED) {
    return resolved.errors.map(e => `grasp location declaration is unreadable — ${e}`)
  }
  if (resolved.state !== GRASP_FEATURE_STATE.DECLARED_FACES) return []
  if (gripperKind !== GRIPPER_KIND.PARALLEL_JAW) return []

  const faces = resolved.faces.map(f => f.face)
  const hasPair = faces.some(a => faces.some(b => facesAreOpposed(a, b)))
  if (hasPair) return []
  return [
    `parallel jaw needs a pair of opposed faces, but only ${faces.join(' / ')} ${faces.length === 1 ? 'is' : 'are'} declared ` +
    `— the solver measures the opening from these samples, so one face reports almost no width (ADR-118)`,
  ]
}

/**
 * One-line English for what the samples of this run are based on — the sentence
 * that lets a user notice they never chose (ADR-119 D2 「導出に落ちたことは画面に
 * 出す」). Pure, so the panel and any future caption read the same words.
 *
 * @param {{state: string, faces: {face:string, region?: any}[]}} resolved
 * @param {ReadonlyArray<string>} derivedFaces  what ADR-118 would sample for the declared hand
 * @returns {string}
 */
export function graspFeatureSummary(resolved, derivedFaces = []) {
  switch (resolved?.state) {
    case GRASP_FEATURE_STATE.DECLARED_FACES: {
      const parts = resolved.faces.map(f => (
        f.region === FULL_REGION || isFullRegion(f.region)
          ? `${f.face} (whole face)`
          : `${f.face} (${pct(f.region.uMin)}–${pct(f.region.uMax)} × ${pct(f.region.vMin)}–${pct(f.region.vMax)})`
      ))
      return `declared: ${parts.join(', ')}`
    }
    case GRASP_FEATURE_STATE.DECLARED_ANYWHERE:
      return `declared: anywhere — sampling ${derivedFaces.join(' / ') || 'the derived faces'}`
    case GRASP_FEATURE_STATE.MALFORMED:
      return 'declared, but unreadable — nothing is being sampled'
    default:
      return `not declared — sampling ${derivedFaces.join(' / ') || 'the derived faces'} for the declared hand`
  }
}

/** True when a region covers the whole face (the value an omitted region means). */
export function isFullRegion(r) {
  return !!r && r.uMin === 0 && r.uMax === 1 && r.vMin === 0 && r.vMax === 1
}

const pct = (t) => `${Math.round(t * 100)}%`
