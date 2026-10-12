/**
 * CriteriaLine — the agreed line, its versions, and how it moves (ADR-165 D4 / D5).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new documents; never mutates its inputs. (PHILOSOPHY #6)
 *
 * **The line** is every end user's answers to the value tree — the mix
 * `{D,Q,C,S}` and, per catalog element, `{expectation, weight}`. It is the same
 * population the census counts (`CriteriaElicitation`), so "what was heard" and
 * "what is frozen" are one table, not two (ADR-165 §PR2 の俯瞰 B).
 *
 * States and transitions are specified in `docs/STATE_TRANSITIONS.md`
 * §判定基準の線 — not restated here (§1.1). In short:
 *
 *     hearing ──(unheard = 0 ∧ every end user agreed)──► agreed vN ◄──► change proposed
 *
 * ## What is stored and what is derived
 *
 * Stored (human acts cannot be recomputed): `criteriaAgreement.agreed`
 * `{line, version, by}` — the snapshot the end users agreed to — and
 * `criteriaAgreement.pending {line, by}` — agreements gathering toward the next
 * completion. On proposals: `approvals[]`, and on approval `lineVersion` /
 * `approversRequired`.
 *
 * Derived on every read: the status, the current version, which proposals are
 * line proposals, whether a pending agreement went stale, the direction of a
 * change (loosened / tightened — closed form, CLAUDE.md §AI 向けガード 軸 3),
 * and whether the document drifted from `agreed.line ⊕ approved proposals`.
 *
 * ## Re-hearing (ADR-165 §PR2 の俯瞰 A)
 *
 * The agreement holds while every end user is in `agreed.by`. A newcomer drops
 * the status back to hearing — their 18 blanks are counted, and everyone
 * re-agrees to the line *with* them, because the zero-sum party changed. The
 * version is kept, and the rows already agreed stay frozen meanwhile: losing
 * the agreement does not hand the old lines back to direct edits.
 *
 * ## What is not here (後続 PR — DEF-062)
 *
 * Whether a change is inside the margin, and what it gives up (差し出すもの),
 * are core/'s values (ADR-165 D6 — PR4). The gate that makes approvers read
 * them is in place (`lineApprovalGuards` G3) and fires once a proposal carries
 * `offerings`; until core/ returns them nothing sets the field (DEF-062).
 *
 * The history before agreement — changes made after seeing a trial — is
 * `CriteriaHearing.hearingHistory` (PR3). What this module records is the
 * line after agreement.
 *
 * @module context/CriteriaLine
 */

import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS, criteriaElementOf } from './CriteriaCatalog.js'
import { answersOf, countUnheard } from './CriteriaElicitation.js'
import { endUsersOf, isEndUser } from './ActorStance.js'
import { TARGET_KIND } from './Ownership.js'
import { PROPOSAL_STATE, sameClaimValue, isStale } from './Proposal.js'
import { hasKey } from './Keyring.js'

/** The three states of the line (`docs/STATE_TRANSITIONS.md` §判定基準の線). */
export const LINE_STATUS = Object.freeze({
  HEARING:         'hearing',
  AGREED:          'agreed',
  CHANGE_PROPOSED: 'changeProposed',
})

/** The direction a proposal moves a line field (derived — never stored). */
export const LINE_CHANGE = Object.freeze({
  LOOSENED:      'loosened',
  TIGHTENED:     'tightened',
  CHANGED:       'changed',        // the comparison itself changed — no single direction
  WEIGHT_RAISED: 'weightRaised',
  WEIGHT_LOWERED:'weightLowered',
  MIX_CHANGED:   'mixChanged',
})

/** The line's field names inside one end user's slice. */
const FIELD = Object.freeze({ MIX: 'mix', EXPECTATION: 'criterion', WEIGHT: 'weight' })

const refsOf = (actors) => actors.map(a => a.ref)
const isSubset = (needed, have) => needed.every(r => have.includes(r))

/**
 * One end user's slice of the line: only the fields that are answered, so a
 * snapshot never invents a value for a blank.
 */
function sliceOf(ctx, actor) {
  const slice = { mix: {}, elements: {} }
  for (const c of CRITERIA_CATEGORIES) {
    if (typeof actor.mix?.[c] === 'number') slice.mix[c] = actor.mix[c]
  }
  for (const e of CRITERIA_ELEMENTS) {
    const answers = answersOf(ctx, actor.ref, e.key)
    if (answers.length !== 1) continue   // a duplicate is not a value (R12 error)
    const r = answers[0]
    const entry = {}
    if (r.criterion !== undefined) entry.criterion = r.criterion
    if (r.weight !== undefined) entry.weight = r.weight
    slice.elements[e.key] = entry
  }
  return slice
}

/**
 * The line as the document states it right now.
 * @param {object} ctx
 * @returns {Record<string, {mix: object, elements: Record<string, {criterion?: object, weight?: number}>}>}
 */
export function currentLine(ctx) {
  return Object.fromEntries(endUsersOf(ctx).map(u => [u.ref, sliceOf(ctx, u)]))
}

/** The stored agreement record, or null when nobody has agreed to anything yet. */
export function agreementOf(ctx) {
  return ctx?.criteriaAgreement ?? null
}

/**
 * **Which line field a target names**, or null when it names none. The one
 * reader of "this claim is part of the line" (IDENTITY_RULES).
 *
 * A target is a line field when it is an end user's mix, or the expectation /
 * weight of a requirement that answers a catalog element for the end user who
 * owns it.
 *
 * @param {object} ctx
 * @param {{kind: string, ref: string}} target
 * @returns {{actor: string, field: string, element?: string, category?: string}|null}
 */
export function lineFieldOf(ctx, target) {
  if (!target) return null
  if (target.kind === TARGET_KIND.ACTOR_MIX) {
    const actor = (ctx?.actors ?? []).find(a => a.ref === target.ref)
    return actor && isEndUser(actor) ? { actor: actor.ref, field: FIELD.MIX } : null
  }
  const field = target.kind === TARGET_KIND.REQUIREMENT_CRITERION ? FIELD.EXPECTATION
    : target.kind === TARGET_KIND.REQUIREMENT_WEIGHT ? FIELD.WEIGHT
    : null
  if (!field) return null
  const req = (ctx?.requirements ?? []).find(r => r.ref === target.ref)
  const element = criteriaElementOf(req)
  if (!req || !element) return null
  const owner = (ctx?.actors ?? []).find(a => a.ref === req.owner)
  if (!owner || !isEndUser(owner)) return null
  return { actor: owner.ref, field, element: element.key, category: element.category }
}

/**
 * **Is this claim frozen by the agreement?** True when the target is a line
 * field of an end user covered by the last completed agreement. Stays true
 * through re-hearing (a newcomer does not unfreeze the others' rows).
 */
export function isFrozenLineTarget(ctx, target) {
  const f = lineFieldOf(ctx, target)
  const agreed = agreementOf(ctx)?.agreed
  return Boolean(f && agreed && agreed.line?.[f.actor])
}

/** A line proposal = a proposal against a frozen line field (ADR-165 D5). */
export function isLineProposal(ctx, proposal) {
  return isFrozenLineTarget(ctx, proposal?.target)
}

/**
 * The current version, or null before the first agreement.
 * `max(agreed.version, lineVersion of every approved line proposal)`.
 */
export function lineVersion(ctx) {
  const agreed = agreementOf(ctx)?.agreed
  if (!agreed) return null
  return (ctx?.proposals ?? [])
    .filter(p => p.state === PROPOSAL_STATE.APPROVED && typeof p.lineVersion === 'number')
    .reduce((v, p) => Math.max(v, p.lineVersion), agreed.version)
}

/**
 * Who must approve a line proposal: every end user except the proposer.
 * An approved proposal answers with what was required *then* (stored), since
 * end users may come and go afterwards.
 */
export function requiredApprovers(ctx, proposal) {
  if (Array.isArray(proposal?.approversRequired)) return proposal.approversRequired
  return refsOf(endUsersOf(ctx)).filter(r => r !== proposal?.by)
}

/** Approvers still missing from a line proposal. */
export function outstandingApprovers(ctx, proposal) {
  const have = proposal?.approvals ?? []
  return requiredApprovers(ctx, proposal).filter(r => !have.includes(r))
}

/** True when the pending agreement was given to a line the document no longer states. */
function isPendingStale(ctx, pending) {
  return Boolean(pending) && !sameClaimValue(pending.line, currentLine(ctx))
}

/**
 * **The line's state**, derived. Never stored.
 *
 * @param {object} ctx
 * @returns {{
 *   status: string, version: number|null, endUsers: string[],
 *   agreedBy: string[], awaiting: string[], pendingStale: boolean,
 *   heardInFull: boolean, openProposals: string[], rehearing: boolean,
 * }}
 */
export function lineStatus(ctx) {
  const endUsers = refsOf(endUsersOf(ctx))
  const agreement = agreementOf(ctx)
  const agreed = agreement?.agreed ?? null
  const pending = agreement?.pending ?? null
  const census = countUnheard(ctx)
  const openProposals = (ctx?.proposals ?? [])
    .filter(p => p.state === PROPOSAL_STATE.PROPOSED && isLineProposal(ctx, p))
    .map(p => p.ref)

  const holds = Boolean(agreed) && endUsers.length > 0 && isSubset(endUsers, agreed.by ?? [])
  if (holds) {
    return {
      status: openProposals.length ? LINE_STATUS.CHANGE_PROPOSED : LINE_STATUS.AGREED,
      version: lineVersion(ctx),
      endUsers,
      agreedBy: [...agreed.by],
      awaiting: [],
      pendingStale: false,
      heardInFull: census.complete,
      openProposals,
      rehearing: false,
    }
  }

  const pendingStale = isPendingStale(ctx, pending)
  const agreedBy = pending && !pendingStale ? pending.by.filter(r => endUsers.includes(r)) : []
  return {
    status: LINE_STATUS.HEARING,
    version: lineVersion(ctx),
    endUsers,
    agreedBy,
    awaiting: endUsers.filter(r => !agreedBy.includes(r)),
    pendingStale,
    heardInFull: census.complete,
    openProposals,
    // A completed agreement existed and the end users changed under it (俯瞰 A).
    rehearing: Boolean(agreed),
  }
}

/**
 * **The agreement gate** — every reason `actorRef` cannot agree now, from one
 * call (PHILOSOPHY #11: the disabled flag and its explanation share a return).
 *
 * @param {object} ctx
 * @param {string} actorRef
 * @param {Set<string>|string[]} [keyring] — omit to skip the key check (pure transforms)
 * @returns {{ok: boolean, reasons: string[]}}
 */
export function agreementGuards(ctx, actorRef, keyring) {
  const reasons = []
  const actor = (ctx?.actors ?? []).find(a => a.ref === actorRef)
  if (!actor || !isEndUser(actor)) {
    reasons.push(`"${actorRef}" does not stand as an end user — only end users agree to the line (ADR-165 D1).`)
  }
  const census = countUnheard(ctx)
  if (!census.complete) {
    reasons.push(census.started
      ? `${census.count} criteria answers are still unheard${census.duplicates.length ? ` and ${census.duplicates.length} are duplicated` : ''} — the line can be agreed only once everything has been heard (ADR-165).`
      : 'No one stands as an end user yet, so there is no line to agree to.')
  }
  const s = lineStatus(ctx)
  if (s.status !== LINE_STATUS.HEARING) {
    reasons.push(`The line is already agreed (v${s.version}) — change it by proposing, not by agreeing again.`)
  } else if (s.agreedBy.includes(actorRef)) {
    reasons.push(`"${actorRef}" has already agreed to this line.`)
  }
  if (keyring !== undefined) {
    const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
    if (!hasKey(keys, actorRef)) {
      reasons.push(`Agreeing is "${actorRef}"'s own act — hold their key to press it.`)
    }
  }
  return { ok: reasons.length === 0, reasons }
}

/**
 * **Agree** — one end user agrees to the line as the document states it.
 *
 * Agreements gather in `pending` against one snapshot. If the line changed
 * since the others agreed, their agreement was to a different line, so the
 * gathering restarts with this person (the stale agreement is not silently
 * carried over). When every end user has agreed, the snapshot becomes
 * `agreed` — v1 the first time, the current version on a re-hearing.
 *
 * @param {object} ctx
 * @param {string} actorRef
 * @returns {object} a new context object
 */
export function agreeToLine(ctx, actorRef) {
  const guards = agreementGuards(ctx, actorRef)
  if (!guards.ok) throw new Error(`[CriteriaLine] cannot agree as "${actorRef}": ${guards.reasons.join(' ')}`)

  const snapshot = currentLine(ctx)
  const prior = agreementOf(ctx) ?? {}
  const pending = prior.pending && sameClaimValue(prior.pending.line, snapshot)
    ? { line: snapshot, by: [...prior.pending.by, actorRef] }
    : { line: snapshot, by: [actorRef] }

  const endUsers = refsOf(endUsersOf(ctx))
  if (isSubset(endUsers, pending.by)) {
    const agreed = { line: snapshot, version: lineVersion(ctx) ?? 1, by: pending.by }
    return { ...ctx, criteriaAgreement: { agreed } }
  }
  return { ...ctx, criteriaAgreement: { ...(prior.agreed ? { agreed: prior.agreed } : {}), pending } }
}

/**
 * **The line approval gate** (ADR-165 D5) — every reason the held keys cannot
 * approve a line proposal now.
 *
 * G0  terminal — an approved / withdrawn / rejected proposal has nowhere to go.
 * G1' authority — approvers are the *other* end users; the keyring must hold at
 *     least one who has not approved yet. With no approvers required (one end
 *     user) the change passes as "no approvers — recorded only".
 * G2  optimistic lock — `from === current value` (ADR-104 U2), unchanged.
 * G3  offerings — when the proposal carries what it gives up (core/, D6), each
 *     approver must have read it. Same weight for everyone; only the reading is
 *     added outside the margin.
 *
 * @returns {{ok: boolean, reasons: string[], approvers: string[], outstanding: string[], required: string[]}}
 */
export function lineApprovalGuards(ctx, proposal, keyring) {
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
  const reasons = []
  const required = requiredApprovers(ctx, proposal)
  const outstanding = outstandingApprovers(ctx, proposal)
  const approvers = outstanding.filter(r => hasKey(keys, r))

  if (proposal.state !== PROPOSAL_STATE.PROPOSED) {
    reasons.push(`This proposal is already ${proposal.state} — approving it again would rewrite history. Raise a new proposal instead.`)
  }
  if (outstanding.length > 0 && approvers.length === 0) {
    const mine = (proposal.approvals ?? []).filter(r => hasKey(keys, r))
    reasons.push(mine.length
      ? `You already approved as ${mine.join(', ')}. Still waiting on ${outstanding.join(', ')}.`
      : `A change to the agreed line needs every other end user's approval — waiting on ${outstanding.join(', ')} (you hold ${keys.size === 0 ? 'no keys' : [...keys].join(', ')}).`)
  }
  if (isStale(ctx, proposal)) {
    reasons.push(`"${proposal.target.ref}" has moved since this proposal was written, so approving it would overwrite a change nobody agreed to. Withdraw and re-draw the diff.`)
  }
  if ((proposal.offerings ?? []).length > 0) {
    const unread = approvers.filter(r => !(proposal.offeringsReadBy ?? []).includes(r))
    if (unread.length) {
      reasons.push(`This change is outside the margin — ${unread.join(', ')} must read what it gives up before approving (ADR-165 D5).`)
    }
  }
  return { ok: reasons.length === 0, reasons, approvers, outstanding, required }
}

/**
 * Every reason the held keys cannot reject a line proposal. Any one other end
 * user may reject — the zero-sum counterpart's veto, at the same weight as an
 * approval (ADR-165 §PR2 の俯瞰 C).
 */
export function lineRejectionGuards(ctx, proposal, keyring) {
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
  const reasons = []
  const eligible = requiredApprovers(ctx, proposal).filter(r => hasKey(keys, r))
  if (proposal.state !== PROPOSAL_STATE.PROPOSED) {
    reasons.push(`This proposal is already ${proposal.state}.`)
  }
  if (eligible.length === 0) {
    reasons.push(requiredApprovers(ctx, proposal).length === 0
      ? 'There is no other end user to reject this — with one end user a change is recorded, not approved.'
      : `Only the other end users (${requiredApprovers(ctx, proposal).join(', ')}) may reject a change to the agreed line.`)
  }
  return { ok: reasons.length === 0, reasons, by: eligible }
}

/** Write a line field into a slice (used by the drift replay). */
function writeSliceField(slice, f, value) {
  if (f.field === FIELD.MIX) return { ...slice, mix: { ...value } }
  const entry = { ...(slice.elements[f.element] ?? {}), [f.field]: value }
  return { ...slice, elements: { ...slice.elements, [f.element]: entry } }
}

/**
 * **Drift**: where the document states a line the agreement and its approved
 * proposals do not account for — a frozen field rewritten without a proposal
 * (in this app or in the file). `agreed.line ⊕ approved line proposals after
 * agreed.version`, replayed in version order, must equal the current line.
 *
 * @param {object} ctx
 * @returns {Array<{actor: string, field: string, element?: string, expected: any, actual: any}>}
 */
export function lineDrift(ctx) {
  const agreed = agreementOf(ctx)?.agreed
  if (!agreed) return []
  const expected = { ...agreed.line }
  const later = (ctx?.proposals ?? [])
    .filter(p => p.state === PROPOSAL_STATE.APPROVED && typeof p.lineVersion === 'number' && p.lineVersion > agreed.version)
    .sort((a, b) => a.lineVersion - b.lineVersion)
  for (const p of later) {
    const f = lineFieldOf(ctx, p.target)
    if (f && expected[f.actor]) expected[f.actor] = writeSliceField(expected[f.actor], f, p.to)
  }

  const now = currentLine(ctx)
  const drift = []
  for (const [actor, slice] of Object.entries(expected)) {
    const cur = now[actor]
    if (!cur) continue   // no longer an end user — a cardinality change, not a rewrite
    if (!sameClaimValue(slice.mix, cur.mix)) {
      drift.push({ actor, field: FIELD.MIX, expected: slice.mix, actual: cur.mix })
    }
    for (const e of CRITERIA_ELEMENTS) {
      const want = slice.elements[e.key] ?? {}
      const have = cur.elements[e.key] ?? {}
      for (const field of [FIELD.EXPECTATION, FIELD.WEIGHT]) {
        if (!sameClaimValue(want[field] ?? null, have[field] ?? null)) {
          drift.push({ actor, field, element: e.key, expected: want[field] ?? null, actual: have[field] ?? null })
        }
      }
    }
  }
  return drift
}

/**
 * The direction of a line change — closed form over `op` and the two values
 * (CLAUDE.md §AI 向けガード 軸 3). For `<=` a larger threshold asks less;
 * for `>=` a smaller one does.
 */
export function lineChangeOf(f, from, to) {
  if (f.field === FIELD.MIX) return LINE_CHANGE.MIX_CHANGED
  if (f.field === FIELD.WEIGHT) return to > from ? LINE_CHANGE.WEIGHT_RAISED : LINE_CHANGE.WEIGHT_LOWERED
  if (from?.op !== to?.op) return LINE_CHANGE.CHANGED
  const up = to.value > from.value
  if (from.op === '<=' || from.op === '<') return up ? LINE_CHANGE.LOOSENED : LINE_CHANGE.TIGHTENED
  if (from.op === '>=' || from.op === '>') return up ? LINE_CHANGE.TIGHTENED : LINE_CHANGE.LOOSENED
  return LINE_CHANGE.CHANGED
}

/**
 * **"Safety was cut"** — an expectation in category S that was loosened. The
 * one place that says it; both halves of the history (after agreement here,
 * before agreement in CriteriaHearing) ask this, so the two cannot disagree.
 */
export function isSafetyCut(f, change) {
  return f.category === 'S' && change === LINE_CHANGE.LOOSENED
}

/**
 * **The record of the line after agreement** (ADR-165 D4, the part PR2 can
 * say): every line proposal, open or closed, in document order, with who,
 * what, which way, and who approved. "Safety was cut" is derived — an
 * expectation in category S that was loosened — never typed by anyone.
 *
 * The other half of D4 — changes made *after seeing a trial* before the
 * agreement — is `CriteriaHearing.hearingHistory` (PR3).
 *
 * @param {object} ctx
 */
export function lineHistory(ctx) {
  return (ctx?.proposals ?? [])
    .map(p => ({ p, f: lineFieldOf(ctx, p.target) }))
    .filter(({ p, f }) => f && isFrozenLineTarget(ctx, p.target))
    .map(({ p, f }) => {
      const change = lineChangeOf(f, p.from, p.to)
      return {
        ref: p.ref,
        state: p.state,
        by: p.by,
        actor: f.actor,
        field: f.field,
        element: f.element ?? null,
        category: f.category ?? null,
        from: p.from,
        to: p.to,
        change,
        safetyCut: isSafetyCut(f, change),
        approvals: p.approvals ?? [],
        required: requiredApprovers(ctx, p),
        rejectedBy: p.rejectedBy ?? [],
        version: p.lineVersion ?? null,
        rationale: p.rationale,
      }
    })
}

/**
 * Every line field a person can propose to change, with its current value —
 * the menu of the "propose a line change" form. Only frozen fields appear
 * (an unfrozen one is answered directly).
 */
export function lineTargets(ctx) {
  const out = []
  for (const u of endUsersOf(ctx)) {
    const mixTarget = { kind: TARGET_KIND.ACTOR_MIX, ref: u.ref }
    if (isFrozenLineTarget(ctx, mixTarget)) out.push({ target: mixTarget, actor: u.ref, field: FIELD.MIX, value: u.mix ?? null })
    for (const e of CRITERIA_ELEMENTS) {
      const answers = answersOf(ctx, u.ref, e.key)
      if (answers.length !== 1) continue
      const r = answers[0]
      for (const [kind, field, value] of [
        [TARGET_KIND.REQUIREMENT_CRITERION, FIELD.EXPECTATION, r.criterion ?? null],
        [TARGET_KIND.REQUIREMENT_WEIGHT, FIELD.WEIGHT, r.weight ?? null],
      ]) {
        const target = { kind, ref: r.ref }
        if (isFrozenLineTarget(ctx, target)) out.push({ target, actor: u.ref, field, element: e.key, value })
      }
    }
  }
  return out
}

/** The read model the floor renders (status + history + menu), in one call. */
export function projectCriteriaLine(ctx) {
  return { ...lineStatus(ctx), history: lineHistory(ctx), targets: lineTargets(ctx) }
}
