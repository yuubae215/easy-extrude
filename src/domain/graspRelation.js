/**
 * graspRelation — the grasp as a RELATION between an object and a robot tcp
 * (ADR-164 D2).
 *
 * ## Derived, never stored
 *
 * The relation has no row of its own in any file. It is read off two facts that
 * already have an authority each (§1.1):
 *
 *   - the DOCUMENT's grasp declaration on a Solid (`graspFeature`), which since
 *     ADR-164 D2 may name the tcp it is for (`graspFeature.tcp`) and since D4
 *     carries its lift (`graspFeature.lift`; a pre-D4 `entity.lift` counts too);
 *   - the LIVE SCENE's bodies (which object, which tcp are on the screen now).
 *
 * The population is the document's declarations — not the scene's entities.
 * Walking what is on the screen can never show a declaration whose object was
 * deleted; that is how DEF-035's orphans fell silently (原則 #31). Counting from
 * the document is what turns "fell off" into a row.
 *
 * ## Four states, and why `hand-undeclared` is not `broken`
 *
 *   ok               — the object and the named tcp are both in the scene
 *   hand-undeclared  — the document never said which hand (every pre-ADR-164
 *                      document). Not filled in, not even with the only tcp in
 *                      the scene (ADR-164 §俯瞰 — a default is a choice nobody
 *                      made; the relation's panel offers the naming instead)
 *   broken-object    — the declared object is not in the scene
 *   broken-tcp       — a hand is named, but no robot tcp with that ref is in the
 *                      scene (deleted, renamed, or the ref names something else)
 *
 * When both sides are missing the OBJECT wins: the relation is filed under its
 * object (a grasp is declared ON a Solid), so "the object is gone" is the fact
 * that decides whether there is anything left to re-point.
 *
 * ## Cardinality
 *
 * At most ONE relation per object (`graspFeature` is 0..1 per Solid) — declared,
 * not inferred (ADR-164 §俯瞰: one hand per search on the wire). The relation's
 * identity is therefore its object's ref.
 *
 * Pure: no THREE, no DOM — loads under bare `node --test`.
 *
 * @module domain/graspRelation
 */

import { isRobotTcpFrame } from './robotFrames.js'
import { resolveGraspFeature } from './graspFeature.js'

/** The relation's state — a closed set (原則 #31: every row SAYS which one). */
export const GRASP_RELATION_STATE = Object.freeze({
  OK:              'ok',
  HAND_UNDECLARED: 'hand-undeclared',
  BROKEN_OBJECT:   'broken-object',
  BROKEN_TCP:      'broken-tcp',
})

/**
 * How each state is said on the row and the panel. Throws on an undeclared
 * state (`relationWordsFor`) — a new state must say itself, not inherit the
 * nearest wording.
 */
const WORDS_BY_STATE = Object.freeze({
  [GRASP_RELATION_STATE.OK]: Object.freeze({
    broken: false,
    detail: null,
  }),
  [GRASP_RELATION_STATE.HAND_UNDECLARED]: Object.freeze({
    broken: false,
    detail: 'which hand is not declared — the search uses whichever robot it is solved for',
  }),
  [GRASP_RELATION_STATE.BROKEN_OBJECT]: Object.freeze({
    broken: true,
    detail: 'the object this grasp is declared on is not in the scene — deleted or renamed',
  }),
  [GRASP_RELATION_STATE.BROKEN_TCP]: Object.freeze({
    broken: true,
    detail: 'the hand this grasp names is not a robot tcp in the scene — re-point it',
  }),
})

/** @param {string} state */
export function relationWordsFor(state) {
  const w = WORDS_BY_STATE[state]
  if (!w) throw new Error(`graspRelation: 未宣言の関係の状態 "${state}" — WORDS_BY_STATE に行を足すこと`)
  return w
}

/**
 * Does this document entity declare a grasp relation? A grasp declaration
 * (`graspFeature`), or a lift still at its pre-ADR-164-D4 address (`entity.lift`)
 * — the old lift is migrated onto the relation on read (`resolveDeclaredLift`),
 * so the object it sits on HAS a relation even with no `graspFeature`. Counting
 * only `graspFeature` would let that lift fall off the screen (原則 #31).
 *
 * @param {object} e  a Layout DSL entity
 */
export function declaresGraspRelation(e) {
  return e?.graspFeature != null || e?.lift != null
}

/**
 * @typedef {object} GraspRelation
 * @property {string} objectRef     the Solid the grasp is declared on (= the relation's identity)
 * @property {string|null} tcpRef   the tcp the declaration names; null = not declared
 * @property {string} state         a GRASP_RELATION_STATE member
 * @property {string} objectLabel   the object's name (or its ref when nameless / missing)
 * @property {string|null} tcpLabel the tcp's name, its ref when missing, null when undeclared
 */

/** @param {object} e */
function labelOf(e) {
  return (typeof e?.name === 'string' && e.name) ? e.name : e?.ref
}

/**
 * Every grasp relation the document declares, judged against the scene.
 *
 * @param {{docDsl?: object|null, sceneDsl?: object|null}} inputs
 *   docDsl   — the document's Layout DSL (the population: entities carrying `graspFeature`)
 *   sceneDsl — the Layout DSL of what is on the screen (bodies + tcp frames). When
 *              the search's geometry came from the document itself, pass the
 *              document here too: then nothing can be missing, which is the truth.
 * @returns {GraspRelation[]} in document order
 */
export function graspRelationsOf({ docDsl = null, sceneDsl = null } = {}) {
  const scene = new Map()
  for (const e of sceneDsl?.entities ?? []) {
    if (e && typeof e.ref === 'string') scene.set(e.ref, e)
  }
  const out = []
  for (const e of docDsl?.entities ?? []) {
    if (!e || typeof e.ref !== 'string' || !declaresGraspRelation(e)) continue
    // The ONE reader of the declaration (§1.1) — an unreadable `tcp` makes the
    // whole declaration MALFORMED there (and blocks the run), so it reads as
    // "not declared" here rather than being re-validated a second way.
    const tcpRef = resolveGraspFeature(e).tcp
    const body = scene.get(e.ref) ?? null
    const tcp  = tcpRef ? (scene.get(tcpRef) ?? null) : null
    const state = !body ? GRASP_RELATION_STATE.BROKEN_OBJECT
      : tcpRef === null ? GRASP_RELATION_STATE.HAND_UNDECLARED
        : !(tcp && isRobotTcpFrame(tcp)) ? GRASP_RELATION_STATE.BROKEN_TCP
          : GRASP_RELATION_STATE.OK
    out.push({
      objectRef: e.ref,
      tcpRef,
      state,
      objectLabel: labelOf(body ?? e),
      tcpLabel: tcpRef === null ? null : (tcp ? labelOf(tcp) : tcpRef),
    })
  }
  return out
}

/**
 * The tcps a relation may name — every robot tcp on the screen, by ref. The
 * picker's options; a broken relation is re-pointed to one of these.
 *
 * @param {object|null|undefined} sceneDsl
 * @returns {{ref:string, label:string}[]}
 */
export function nameableTcpsOf(sceneDsl) {
  return (sceneDsl?.entities ?? [])
    .filter(e => e && typeof e.ref === 'string' && e.type === 'CoordinateFrame' && isRobotTcpFrame(e))
    .map(e => ({ ref: e.ref, label: labelOf(e) }))
}

/**
 * The run gap when the object's grasp is declared for a DIFFERENT hand than the
 * one the search is solved with (ADR-164 §俯瞰 2). Never a silent hand swap
 * (原則 #11). An undeclared hand is not a gap — the search uses its subject, as
 * every pre-ADR-164 document did. A broken relation is said here too: naming a
 * hand that is not on the screen cannot be "the subject's hand".
 *
 * @param {GraspRelation|null|undefined} relation  the target object's relation (or none)
 * @param {string|null} subjectTcpRef  the ref of the search subject's tcp (null when unknown)
 * @returns {string|null}
 */
export function relationHandGap(relation, subjectTcpRef) {
  if (!relation || relation.tcpRef === null) return null
  if (relation.state === GRASP_RELATION_STATE.BROKEN_TCP) {
    return `grasp: declared for hand "${relation.tcpRef}", which is not a robot tcp in the scene — re-point it on the grasp relation`
  }
  if (relation.state !== GRASP_RELATION_STATE.OK) return null
  if (subjectTcpRef === null || relation.tcpRef === subjectTcpRef) return null
  return `grasp: declared for ${relation.tcpLabel} — the search is solved for another robot's hand (pick that robot, or re-point the grasp)`
}

/**
 * How many relations of each kind — the count the Outliner heads its section
 * with, so "0 broken" is a number that was looked at, not an absence.
 * @param {GraspRelation[]} relations
 */
export function relationCensus(relations) {
  const broken = relations.filter(r => relationWordsFor(r.state).broken).length
  return { total: relations.length, broken }
}
