/**
 * CriteriaHearing — the hearing flow's trials and what changed after them
 * (ADR-165 D3 / D4, the half before agreement).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new documents; never mutates its inputs. (PHILOSOPHY #6)
 *
 * ## A trial is the one stored fact
 *
 * Opening "Try it" is a human act: *this person looked at results while
 * holding these expectations*. It cannot be recomputed, so it is stored —
 * `criteriaHearing.trials[] = {actor, line, seen, chosen?}`, where `line` is
 * that end user's slice of the line at the moment of looking (the same slice
 * `CriteriaLine.currentLine` states) and `seen` is the candidates shown —
 * each as it was shown (`{id, label, actuals}` — core/'s answer, copied, so
 * the look stays readable after core/'s model changes: ADR-165 §PR4 の俯瞰 3).
 * `seen: []` is a declared zero, not a blank (PHILOSOPHY #31): the solver was
 * not reachable, or had nothing to show, and the trial says so. `chosen` is the
 * candidate the person picked on that look (a human act — stored; inferring
 * weights from it is core/'s — 後続 PR, DEF-067).
 *
 * Everything else is derived on every read (ADR-165 §PR3 の俯瞰 Q2):
 *
 *     round k = diff( trials_k.line , trials_{k+1}.line  or  the line now )
 *
 * The line *now* is the agreed snapshot once the agreement covers the person —
 * from then on the line moves only by proposal, and that half of D4 is
 * `CriteriaLine.lineHistory`. Answers given before the first trial are first
 * answers, not changes, so they never appear here. The direction of a change
 * and "safety was cut" come from `CriteriaLine.lineChangeOf` /
 * `isSafetyCut` — one place says what loosened means.
 *
 * A trial is recorded only when the person's line differs from their last
 * trial: walking back and forth without changing anything is not a new look.
 *
 * @module context/CriteriaHearing
 */

import { CRITERIA_ELEMENTS } from './CriteriaCatalog.js'
import { countUnheard, BLANK_FIELD } from './CriteriaElicitation.js'
import { endUsersOf, isEndUser } from './ActorStance.js'
import { TARGET_KIND } from './Ownership.js'
import { sameClaimValue } from './Proposal.js'
import {
  currentLine, agreementOf, isFrozenLineTarget, lineChangeOf, isSafetyCut,
} from './CriteriaLine.js'

/** Every trial in the document, in recording order. */
export function trialsOf(ctx) {
  return ctx?.criteriaHearing?.trials ?? []
}

/** One end user's trials, in recording order (the 1-based index is the trial number). */
export function trialsOfActor(ctx, actorRef) {
  return trialsOf(ctx).filter(t => t.actor === actorRef)
}

/**
 * The blanks that belong to one end user, split by the step that asks them.
 * The census is the population (PHILOSOPHY #31) — this only filters it.
 *
 * @returns {{mix: object[], elements: object[], duplicates: object[]}}
 */
export function respondentBlanks(ctx, actorRef) {
  const census = countUnheard(ctx)
  const mine = census.blanks.filter(b => b.actor === actorRef)
  return {
    mix: mine.filter(b => b.field === BLANK_FIELD.MIX),
    elements: mine.filter(b => b.field !== BLANK_FIELD.MIX),
    duplicates: census.duplicates.filter(d => d.actor === actorRef),
  }
}

/** True once the agreement froze this end user's line (they answer by proposal from then on). */
export function isRespondentFrozen(ctx, actorRef) {
  return isFrozenLineTarget(ctx, { kind: TARGET_KIND.ACTOR_MIX, ref: actorRef })
}

/**
 * **The trial gate** — every reason `actorRef` cannot open "Try it" now, from
 * one call (PHILOSOPHY #11: the disabled flag and its explanation share a return).
 */
export function trialGuards(ctx, actorRef) {
  const reasons = []
  const actor = (ctx?.actors ?? []).find(a => a.ref === actorRef)
  if (!actor || !isEndUser(actor)) {
    reasons.push(`"${actorRef}" does not stand as an end user — only end users are heard (ADR-165 D1).`)
    return { ok: false, reasons }
  }
  if (isRespondentFrozen(ctx, actorRef)) {
    reasons.push(`"${actorRef}" has agreed to the line — changes after agreement are proposals, recorded on the floor (ADR-165 D5).`)
  }
  const b = respondentBlanks(ctx, actorRef)
  const blanks = b.mix.length + b.elements.length
  if (blanks > 0) {
    reasons.push(`${blanks} of "${actorRef}"'s answers are still blank — a trial shows results against a whole line.`)
  }
  if (b.duplicates.length > 0) {
    reasons.push(`"${actorRef}" has ${b.duplicates.length} element(s) answered twice — which one to try is a guess.`)
  }
  return { ok: reasons.length === 0, reasons }
}

/**
 * **Record a trial** — `actorRef` opens "Try it" holding their current line.
 * Returns the same document when the line equals their last trial (no new
 * look). Throws when the gate refuses — a refused act is never a silent no-op.
 *
 * @param {object} ctx
 * @param {string} actorRef
 * @param {object[]} [seen] — the candidates shown, as snapshots
 *        (`CriteriaTrialWire.seenSnapshotOf`); `[]` = none were shown
 * @returns {object} a new context object (or `ctx` itself when nothing changed)
 */
export function recordTrial(ctx, actorRef, seen = []) {
  const guards = trialGuards(ctx, actorRef)
  if (!guards.ok) throw new Error(`[CriteriaHearing] cannot record a trial for "${actorRef}": ${guards.reasons.join(' ')}`)
  const line = currentLine(ctx)[actorRef]
  const mine = trialsOfActor(ctx, actorRef)
  const last = mine[mine.length - 1]
  if (last && sameClaimValue(last.line, line) && sameClaimValue(last.seen, seen)) return ctx
  const trial = { actor: actorRef, line, seen: [...seen] }
  return { ...ctx, criteriaHearing: { ...(ctx.criteriaHearing ?? {}), trials: [...trialsOf(ctx), trial] } }
}

/**
 * Every reason `actorRef` cannot pick `candidateId` now. The pick belongs to
 * the person's latest look, and only to a candidate that look showed.
 */
export function chooseGuards(ctx, actorRef, candidateId) {
  const mine = trialsOfActor(ctx, actorRef)
  const last = mine[mine.length - 1]
  if (!last) return { ok: false, reasons: [`"${actorRef}" has not tried the line yet — there is nothing to choose from.`] }
  if (isRespondentFrozen(ctx, actorRef)) return { ok: false, reasons: [`"${actorRef}" has agreed to the line — the hearing's looks are closed.`] }
  if (!(last.seen ?? []).some(c => c.id === candidateId)) {
    return { ok: false, reasons: [`"${candidateId}" was not among the candidates of ${actorRef}'s trial ${mine.length}.`] }
  }
  return { ok: true, reasons: [] }
}

/**
 * **Pick a candidate on the latest look** (ADR-165 D3 — "let the person
 * choose"). Writes `chosen` on that end user's last trial; picking again
 * replaces the pick of the same look. Throws when the gate refuses.
 */
export function chooseCandidate(ctx, actorRef, candidateId) {
  const g = chooseGuards(ctx, actorRef, candidateId)
  if (!g.ok) throw new Error(`[CriteriaHearing] ${g.reasons.join(' ')}`)
  const trials = trialsOf(ctx)
  let lastIndex = -1
  trials.forEach((t, i) => { if (t.actor === actorRef) lastIndex = i })
  if (trials[lastIndex].chosen === candidateId) return ctx
  const next = trials.map((t, i) => i === lastIndex ? { ...t, chosen: candidateId } : t)
  return { ...ctx, criteriaHearing: { ...ctx.criteriaHearing, trials: next } }
}

/** The line an end user's last round ends at: the agreed snapshot once frozen, else the line now. */
function lineAtEndOf(ctx, actorRef) {
  const agreed = agreementOf(ctx)?.agreed
  if (agreed?.line?.[actorRef]) return agreed.line[actorRef]
  return currentLine(ctx)[actorRef] ?? null
}

/** The field-level differences between two slices of one end user's line. */
function sliceChanges(from, to) {
  const out = []
  if (!from || !to) return out
  if (!sameClaimValue(from.mix ?? {}, to.mix ?? {})) {
    const f = { field: 'mix' }
    out.push({ field: 'mix', element: null, category: null, from: from.mix ?? {}, to: to.mix ?? {}, change: lineChangeOf(f, from.mix, to.mix), safetyCut: false })
  }
  for (const e of CRITERIA_ELEMENTS) {
    const a = from.elements?.[e.key] ?? {}
    const b = to.elements?.[e.key] ?? {}
    for (const field of ['criterion', 'weight']) {
      // A field blank at the trial was not changed after seeing — it was first
      // answered. The trial gate refuses a line with blanks, so this only
      // guards a hand-written file.
      if (a[field] === undefined || b[field] === undefined) continue
      if (sameClaimValue(a[field], b[field])) continue
      const f = { field, element: e.key, category: e.category }
      const change = lineChangeOf(f, a[field], b[field])
      out.push({ field, element: e.key, category: e.category, from: a[field], to: b[field], change, safetyCut: isSafetyCut(f, change) })
    }
  }
  return out
}

/**
 * **What each end user changed after seeing a trial** (ADR-165 D4, before
 * agreement). One round per trial that was followed by a change; the round
 * says which trial (1-based, per person) and what was shown. A round that
 * cut safety says so — derived, never typed.
 *
 * @param {object} ctx
 * @returns {Array<{actor: string, afterTrial: number, seen: object[], chosen: string|null, changes: object[], safetyCut: boolean}>}
 */
export function hearingHistory(ctx) {
  const rounds = []
  for (const u of endUsersOf(ctx)) {
    const mine = trialsOfActor(ctx, u.ref)
    mine.forEach((t, i) => {
      const to = i + 1 < mine.length ? mine[i + 1].line : lineAtEndOf(ctx, u.ref)
      const changes = sliceChanges(t.line, to)
      if (changes.length === 0) return
      rounds.push({ actor: u.ref, afterTrial: i + 1, seen: t.seen ?? [], chosen: t.chosen ?? null, changes, safetyCut: changes.some(c => c.safetyCut) })
    })
  }
  return rounds
}

/** The hearing flow's steps, in asking order (ADR-165 D3 — Step 1〜4; Step 5 is the review). */
export const HEARING_STEP = Object.freeze({
  END_USERS:    'endUsers',
  MIX:          'mix',
  EXPECTATIONS: 'expectations',
  TRIAL:        'trial',
})

/**
 * **The step gate of the hearing flow** — printable reasons `next` is not yet
 * honest for `respondent` at `stepId`. Empty ⇔ next allowed. Reads only the
 * document (or its projected slice — the same arrays either way), so the
 * controller and the panel ask one predicate (ADR-063 §4).
 *
 * An end user whose line is already agreed passes Steps 2〜4: they are not
 * re-asked, and changing their answers is a proposal on the floor.
 *
 * @param {string} stepId — HEARING_STEP value
 * @param {object} docLike
 * @param {string|null} respondent
 * @returns {string[]}
 */
export function hearingStepGaps(stepId, docLike, respondent) {
  const endUsers = endUsersOf(docLike).map(u => u.ref)
  if (stepId === HEARING_STEP.END_USERS) {
    if (endUsers.length === 0) return ['declare at least one person who stands as an end user — a hearing with no one to hear does not start']
    if (!endUsers.includes(respondent)) return ['pick who is answering']
    return []
  }
  if (!endUsers.includes(respondent)) return ['pick who is answering (Step 1)']
  if (isRespondentFrozen(docLike, respondent)) return []
  const b = respondentBlanks(docLike, respondent)
  switch (stepId) {
    case HEARING_STEP.MIX: {
      if (b.mix.length > 0) return [`answer all four — still blank: ${b.mix.map(x => x.category).join(', ')} (safety is asked even when nobody mentions it)`]
      const mix = (docLike.actors ?? []).find(a => a.ref === respondent)?.mix ?? {}
      if (Object.values(mix).every(v => v === 0)) return ['a ratio of all zeros says nothing — raise at least one']
      return []
    }
    case HEARING_STEP.EXPECTATIONS: {
      const out = []
      if (b.elements.length > 0) {
        const els = [...new Set(b.elements.map(x => x.element))]
        out.push(`${b.elements.length} answers still blank — ${els.join(', ')}`)
      }
      if (b.duplicates.length > 0) out.push(`answered twice: ${b.duplicates.map(d => d.element).join(', ')} — keep one`)
      return out
    }
    case HEARING_STEP.TRIAL:
      return trialsOfActor(docLike, respondent).length > 0 ? [] : ['open the trial (it is recorded when this step opens)']
    default:
      // An undeclared step is a step nobody decided a gate for (PHILOSOPHY #31).
      throw new Error(`[CriteriaHearing] no gate declared for step "${stepId}"`)
  }
}

/**
 * The slice of a document the hearing reads (actors, requirements, agreement,
 * trials) — what the store carries on the document edge so the panel can ask
 * the same pure gates the controller asks on the whole doc.
 */
export function criteriaSliceOf(doc) {
  return {
    actors:            doc?.actors ?? [],
    requirements:      doc?.requirements ?? [],
    criteriaAgreement: doc?.criteriaAgreement ?? null,
    criteriaHearing:   doc?.criteriaHearing ?? null,
  }
}
