/**
 * CelebrationMath — pure transition predicates and descriptors for the
 * celebration layer (ADR-065 Phase 4, Widening 2; named rule 4).
 *
 * A celebration is the high-production rendering of a fact TRANSITION that
 * just happened — never of a level or a state:
 *   - the input is always a pair of committed fact snapshots (prev, cur); a
 *     state that was already true at load renders nothing ("initial load is
 *     not a transition" — every predicate returns null/false when `prev` is
 *     null/undecodable, and the tests pin this),
 *   - malformed input degrades to null/false, never a guessed celebration
 *     (PHILOSOPHY #11 — honest silence),
 *   - session facts are legitimate (the CommandStack depth is observable,
 *     honest client state); cross-session achievements would require
 *     persistence = badges = rejected (ADR-062, unchanged).
 *
 * The snapshots themselves stay component-local (DOM: `usePrevOnChange`) or
 * controller-local (3D: the landing listener) — never a uiStore or wire field
 * (ADR-062 §2).
 *
 * Pure and THREE-free: runs in the bare `node --test` lane.
 */
import { COLOR, DURATION } from '../theme/tokens.js'
import { unsettledCount } from './CheckFeedbackMath.js'
import { clamp01, easeOutCubic } from './MotionMath.js'

/**
 * CommandStack-depth milestones a session can cross (the stack caps at
 * CommandStack.MAX = 50 — a deeper milestone would be unreachable).
 */
export const CELEBRATION_MILESTONES = Object.freeze([10, 25, 50])

/**
 * A tracked fact list just became empty: the transition from "some open items"
 * to "none". Shared by conflicts → ∅ and open questions → ∅ (§1.1 — one
 * predicate, two fact sources). `prev` null (no history yet = initial load)
 * or either side not an array → false.
 *
 * @param {Array|null|undefined} prev
 * @param {Array|null|undefined} cur
 * @returns {boolean}
 */
export function clearedTransition(prev, cur) {
  if (!Array.isArray(prev) || !Array.isArray(cur)) return false
  return prev.length > 0 && cur.length === 0
}

/**
 * Every acceptance check just became `pass`. Operates on `checkStatusKeys`
 * snapshots (CheckFeedbackMath) so the decode/validation logic is not
 * re-implemented here (§1.1). Requires a non-empty current check set — "zero
 * checks all pass" is vacuous, not a win — and at least one previously
 * non-passing check (the transition, not the standing state).
 *
 * @param {string[]|null|undefined} prevKeys
 * @param {string[]|null|undefined} curKeys
 * @returns {boolean}
 */
export function allGreenTransition(prevKeys, curKeys) {
  const prevOpen = unsettledCount(prevKeys)
  const curOpen  = unsettledCount(curKeys)
  if (prevOpen === null || curOpen === null) return false
  return prevOpen > 0 && curOpen === 0 && curKeys.length > 0
}

/**
 * The largest milestone the CommandStack depth just crossed upward
 * (prev < m ≤ cur), or null. Downward moves (undo) and non-finite input never
 * fire. Re-crossing after an undo/redo swing is a true session fact and is
 * allowed — the presentation budget absorbs any spam.
 *
 * @param {number|null|undefined} prevDepth
 * @param {number|null|undefined} curDepth
 * @returns {number|null}
 */
export function commandMilestone(prevDepth, curDepth) {
  if (!Number.isFinite(prevDepth) || !Number.isFinite(curDepth)) return null
  if (curDepth <= prevDepth) return null
  let crossed = null
  for (const m of CELEBRATION_MILESTONES) {
    if (prevDepth < m && m <= curDepth) crossed = m
  }
  return crossed
}

/**
 * Presentation descriptor for one celebration kind. Everything the DOM burst /
 * 3D field needs, derived from tokens — unknown kind → null (#11).
 *
 * @param {'all-green'|'conflicts-cleared'|'questions-cleared'|'milestone'} kind
 * @param {{milestone?: number}} [detail]
 * @returns {{kind: string, label: string, color: string, particles: number,
 *            durationMs: number}|null}
 */
export function celebrationDescriptor(kind, detail = {}) {
  const base = { particles: 14, durationMs: DURATION.celebration }
  switch (kind) {
    case 'all-green':
      return { ...base, kind, label: 'All checks pass', color: COLOR.fxGreen }
    case 'conflicts-cleared':
      return { ...base, kind, label: 'All conflicts resolved', color: COLOR.fxGreen }
    case 'questions-cleared':
      return { ...base, kind, label: 'All questions answered', color: COLOR.fxBlue }
    case 'milestone': {
      if (!Number.isFinite(detail.milestone)) return null
      return { ...base, kind, label: `${detail.milestone} operations this session`, color: COLOR.fxBlue, particles: 10 }
    }
    default:
      return null
  }
}

/**
 * Pick AT MOST ONE celebration for a re-projection that may satisfy several
 * transitions at once (answering the last question can simultaneously clear
 * the conflicts and unblock every check — one doc change, one re-projection).
 * The budget of 1 concurrent celebration (named rule 4) is enforced here
 * structurally: the overlay mounts one picker, the picker returns one
 * descriptor. Priority: the biggest win first.
 *
 *   all-green  >  conflicts-cleared  >  questions-cleared
 *
 * @param {{checks?:    {prev: string[]|null, cur: string[]|null},
 *          conflicts?: {prev: Array|null,    cur: Array|null},
 *          questions?: {prev: Array|null,    cur: Array|null}}} facts
 * @returns {ReturnType<typeof celebrationDescriptor>}
 */
export function pickCelebration(facts) {
  if (!facts || typeof facts !== 'object') return null
  if (allGreenTransition(facts.checks?.prev, facts.checks?.cur)) {
    return celebrationDescriptor('all-green')
  }
  if (clearedTransition(facts.conflicts?.prev, facts.conflicts?.cur)) {
    return celebrationDescriptor('conflicts-cleared')
  }
  if (clearedTransition(facts.questions?.prev, facts.questions?.cur)) {
    return celebrationDescriptor('questions-cleared')
  }
  return null
}

/**
 * Per-frame shape of one 3D celebration particle (CelebrationField renders it;
 * the curve lives here so it is unit-testable, same split as `pulseFrame`).
 *
 * Motion allowed: radial flight 0 → 1 of `maxDist` with an ease-out, a slight
 * upward lift, and a fade-out over the last 60%.
 * Reduced motion: a static held cue — frozen at 40% radius, low opacity —
 * information preserved ("something was just won"), movement dropped (#30).
 *
 * @param {number} progress ∈ [0,1]
 * @param {boolean} [reduced]
 * @returns {{dist: number, lift: number, opacity: number, scale: number}}
 */
export function particleFrame(progress, reduced = false) {
  if (reduced) return { dist: 0.4, lift: 0.1, opacity: 0.4, scale: 1 }
  const p = clamp01(progress)
  const eased = easeOutCubic(p)
  return {
    dist:    eased,
    lift:    0.25 * eased,
    opacity: p < 0.4 ? 0.9 : 0.9 * (1 - (p - 0.4) / 0.6),
    scale:   1 - 0.5 * p,
  }
}
