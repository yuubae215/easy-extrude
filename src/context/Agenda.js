/**
 * Agenda — what actually reached the floor, and what the floor recorded
 * (ADR-104 D4 / U3 / U4).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new documents; never mutates its inputs. (PHILOSOPHY #6)
 *
 * States and transitions are specified in `docs/STATE_TRANSITIONS.md` §議題 —
 * not restated here (§1.1).
 *
 * ## The one rule (D4)
 *
 *   > Derived values are not stored. Human acts are stored.
 *
 * A conflict is re-derived by R6 from the requirement graph on every validate,
 * so it is never written down: opening the floor and looking at conflicts
 * leaves no trace, which is correct — nobody did anything yet. Tabling one,
 * settling it, and closing it undecided cannot be recomputed from the document,
 * so those are stored. This is why `agenda[]` holds **only tabled conflicts**
 * while the agenda a person sees is `agenda[] ∪ proposals[]`, assembled on read
 * by `projectAgenda()`: a proposal is already an agenda item the moment it
 * exists, and copying it into a second array would be the second source this
 * rule exists to prevent (§1.1).
 *
 * ## Undecided is a result (D4)
 *
 * "We met and did not settle it" is stored exactly like a settlement. If
 * tabling something is history, then quietly deleting the ones that went
 * nowhere is not.
 *
 * ## Re-flaring makes a new item (U3)
 *
 * A settled conflict that comes back is a **new** agenda item carrying
 * `supersedes`, never a reopened old one. Receipts stay an append-only line, so
 * "what is the current conclusion" always has one answer — the last settlement.
 * A branching history would give that question as many answers as branches, and
 * the provenance walk (Why tab, ADR-052) reconstructs the lineage from the
 * references anyway, which is the derived value D4 says not to store.
 *
 * @module context/Agenda
 */

import { ownerOf, TARGET_KIND, isOwnerUndeclared, isOwnerlessDeclared } from './Ownership.js'
import { PROPOSAL_STATE } from './Proposal.js'
import { hasKey } from './Keyring.js'

/** Ref prefix for agenda items (parallel to `conflict_` / `nc_` / `prop_`). */
export const AGENDA_REF_PREFIX = 'ag_'

/** Agenda-item lifecycle (`docs/STATE_TRANSITIONS.md` §議題). */
export const AGENDA_STATE = Object.freeze({
  /** On the floor. The only non-terminal state. */
  OPEN: 'open',
  /** Resolved with every involved party's key. Terminal, and a receipt. */
  SETTLED: 'settled',
  /** Closed without a conclusion. Terminal, and **also** a receipt. */
  CLOSED_UNDECIDED: 'closed_undecided',
})

/** Legal transitions. Both ends terminal — re-flaring means a *new* item (U3). */
const AGENDA_TRANSITIONS = Object.freeze({
  [AGENDA_STATE.OPEN]:             [AGENDA_STATE.SETTLED, AGENDA_STATE.CLOSED_UNDECIDED],
  [AGENDA_STATE.SETTLED]:          [],
  [AGENDA_STATE.CLOSED_UNDECIDED]: [],
})

/** What an agenda row came from. Proposals are derived; conflicts are tabled. */
export const AGENDA_SOURCE = Object.freeze({
  CONFLICT: 'conflict',
  PROPOSAL: 'proposal',
})

/**
 * Table a conflict — the human act that starts the record (D4).
 *
 * @param {object} ctx
 * @param {string} ref        — `ag_*`
 * @param {string} conflictRef — an R6 conflict ref (`conflict_*`)
 * @param {string} by          — who put it on the floor
 * @param {{supersedes?: string}} [opts] — the settled item this one re-opens (U3)
 * @returns {object} a new context object
 */
export function tableConflict(ctx, ref, conflictRef, by, { supersedes } = {}) {
  if (!ref?.startsWith(AGENDA_REF_PREFIX)) {
    throw new Error(`[Agenda] ref must start with "${AGENDA_REF_PREFIX}", got "${ref}"`)
  }
  if (!by) throw new Error('[Agenda] tabling is a human act — it must name who did it (ADR-104 D4)')
  const item = { ref, conflict: conflictRef, by, state: AGENDA_STATE.OPEN }
  if (supersedes) item.supersedes = supersedes
  return { ...ctx, agenda: [...(ctx.agenda ?? []), item] }
}

/** Remove a tabled item — the **undo** of tabling, not a domain transition. */
export function removeAgendaItem(ctx, ref) {
  return { ...ctx, agenda: (ctx.agenda ?? []).filter(a => a.ref !== ref) }
}

/** @param {object} ctx @param {string} ref */
export function findAgendaItem(ctx, ref) {
  return (ctx?.agenda ?? []).find(a => a.ref === ref) ?? null
}

/**
 * The actors whose keys a settlement needs: the owners of every requirement the
 * conflict is between. Same shape as the existing n-ary joint Decision
 * (ADR-049 invariant 8) — a conflict over one variable is settled once, by
 * everyone, not pairwise.
 *
 * @param {object} ctx
 * @param {object} conflict — an R6 conflict (`{ ref, variable, between[] }`)
 * @returns {string[]} distinct declared owners, in document order
 */
export function involvedOwners(ctx, conflict) {
  const owners = []
  for (const reqRef of conflict?.between ?? []) {
    const owner = ownerOf(ctx, { kind: TARGET_KIND.REQUIREMENT_ADMISSIBLE, ref: reqRef })
    if (!isOwnerUndeclared(owner) && !isOwnerlessDeclared(owner) && !owners.includes(owner)) {
      owners.push(owner)
    }
  }
  return owners
}

/**
 * **The settlement gate** — every reason a settlement is refused, from one call
 * (PHILOSOPHY #11, same shape as `approvalGuards`).
 *
 * @param {object} ctx
 * @param {object} item      — the agenda item
 * @param {object} conflict  — the R6 conflict it tabled (live, re-derived)
 * @param {Set<string>|string[]} keyring
 * @returns {{ok: boolean, reasons: string[], required: string[], held: string[]}}
 */
export function settlementGuards(ctx, item, conflict, keyring) {
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
  const reasons = []

  if (item.state !== AGENDA_STATE.OPEN) {
    reasons.push(`This item is already ${item.state} — a settled item is not re-settled. Table a new one that supersedes it.`)
  }

  if (!conflict) {
    reasons.push(`R6 no longer derives "${item.conflict}" from the document — the disagreement is gone, so close the item as undecided rather than settling a conflict that no longer exists.`)
  }

  const required = conflict ? involvedOwners(ctx, conflict) : []
  const missing  = required.filter(owner => !hasKey(keys, owner))
  if (conflict && required.length === 0) {
    reasons.push('None of the requirements in this conflict has a declared owner, so there is no set of keys that can settle it. Declare owners first.')
  } else if (missing.length) {
    reasons.push(`Settling needs every involved party's key — missing ${missing.join(', ')}.`)
  }

  return { ok: reasons.length === 0, reasons, required, held: required.filter(o => hasKey(keys, o)) }
}

/** Replace one agenda item, checking the transition is legal. */
function withAgendaState(ctx, ref, state, extra = {}) {
  const agenda = (ctx.agenda ?? []).map(item => {
    if (item.ref !== ref) return item
    const legal = AGENDA_TRANSITIONS[item.state] ?? []
    if (!legal.includes(state)) {
      throw new Error(
        `[Agenda] ${item.state} → ${state} is not a legal transition for "${ref}" ` +
        `(legal: ${legal.length ? legal.join(', ') : 'none — terminal'}). ` +
        'See docs/STATE_TRANSITIONS.md §議題.')
    }
    return { ...item, ...extra, state }
  })
  return { ...ctx, agenda }
}

/**
 * Settle a tabled conflict. Terminal, and a receipt.
 *
 * `decidedBy` comes from the keyring intersection, never from the caller (U4),
 * and the keyring's size at this moment is burned in alongside it: a settlement
 * reached when only one party held keys is not invalidated later, it is
 * **counted** — the context that made it correct cannot be re-derived once more
 * people join (D4).
 *
 * @param {object} ctx
 * @param {string} ref
 * @param {{decidedBy: string[], keyCardinality: number}} signature
 * @returns {object} a new context object
 */
export function settleAgendaItem(ctx, ref, { decidedBy, keyCardinality }) {
  if (!decidedBy?.length) {
    throw new Error(`[Agenda] settling "${ref}" needs at least one held key (ADR-104 D5 / U4)`)
  }
  return withAgendaState(ctx, ref, AGENDA_STATE.SETTLED, {
    decidedBy,
    keyCardinalityAtDecision: keyCardinality,
  })
}

/**
 * Close a tabled conflict without a conclusion. Terminal, and **also** a
 * receipt (D4) — it needs no key set, because nobody is claiming agreement.
 *
 * @param {object} ctx
 * @param {string} ref
 * @param {{by: string, note?: string}} closer
 * @returns {object} a new context object
 */
export function closeAgendaItemUndecided(ctx, ref, { by, note }) {
  if (!by) throw new Error('[Agenda] closing is a human act — it must name who did it (ADR-104 D4)')
  return withAgendaState(ctx, ref, AGENDA_STATE.CLOSED_UNDECIDED, { closedBy: by, ...(note ? { note } : {}) })
}

/** Reverse a terminal transition — the **undo** path only (never a domain move). */
export function restoreAgendaState(ctx, ref, state) {
  const agenda = (ctx.agenda ?? []).map(item => {
    if (item.ref !== ref) return item
    const next = { ...item, state }
    delete next.decidedBy
    delete next.keyCardinalityAtDecision
    delete next.closedBy
    return next
  })
  return { ...ctx, agenda }
}

/**
 * **The agenda as a person sees it** — tabled conflicts ∪ proposals, assembled
 * on read so neither is stored twice (§1.1).
 *
 * Proposals appear as open items while they are `proposed`; approving or
 * withdrawing one moves it off the floor by the proposal's own transition,
 * which is why an approval does not also have to remember to close an agenda
 * row (there is no row to forget).
 *
 * @param {object} ctx
 * @param {{conflicts?: object[]}} [validatorResult] — live R6 output
 * @returns {{ref: string, source: string, state: string, subject: string,
 *            by: string|undefined, live: boolean, supersedes?: string}[]}
 */
export function projectAgenda(ctx, validatorResult = {}) {
  const liveConflicts = new Set((validatorResult.conflicts ?? []).map(c => c.ref))

  const tabled = (ctx?.agenda ?? []).map(item => ({
    ref:     item.ref,
    source:  AGENDA_SOURCE.CONFLICT,
    state:   item.state,
    subject: item.conflict,
    by:      item.by,
    // A tabled conflict R6 no longer derives is still on the floor — the record
    // of tabling it is a human act. `live: false` says the disagreement itself
    // went away, which is a settlement gate, not a reason to drop the row.
    live:    liveConflicts.has(item.conflict),
    ...(item.supersedes ? { supersedes: item.supersedes } : {}),
    ...(item.decidedBy ? { decidedBy: item.decidedBy } : {}),
  }))

  const proposed = (ctx?.proposals ?? [])
    .filter(p => p.state === PROPOSAL_STATE.PROPOSED)
    .map(p => ({
      ref:     p.ref,
      source:  AGENDA_SOURCE.PROPOSAL,
      state:   AGENDA_STATE.OPEN,
      subject: p.target.ref,
      by:      p.by,
      live:    true,
    }))

  return [...tabled, ...proposed]
}

/**
 * The three counters the header carries (D4). They are **not summed**: an
 * unresolved conflict does not go away if everyone ignores it, while an ignored
 * proposal simply leaves the current value standing. Opposite urgencies read as
 * one number would be a lie in whichever direction the reader guessed.
 *
 * Zero is displayed, not hidden (PHILOSOPHY #15 / #31).
 *
 * @param {object} ctx
 * @param {{conflicts?: object[]}} [validatorResult]
 * @param {{undeclaredOwners?: number}} [counts] — supplied by the owner census
 * @returns {{conflicts: number, agenda: number, unowned: number}}
 */
export function agendaCounters(ctx, validatorResult = {}, counts = {}) {
  return {
    conflicts: (validatorResult.conflicts ?? []).length,
    agenda:    projectAgenda(ctx, validatorResult).filter(i => i.state === AGENDA_STATE.OPEN).length,
    unowned:   counts.undeclaredOwners ?? 0,
  }
}
