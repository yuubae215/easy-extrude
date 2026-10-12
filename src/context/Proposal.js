/**
 * Proposal — "you may always try to move it" (ADR-104 D3 / U1 / U2).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new documents; never mutates its inputs. (PHILOSOPHY #6)
 *
 * A proposal is what an edit gesture becomes when the gesture's author holds no
 * key for the claim's owner. It is not a new concept in this repo — it is the
 * decide / propose verb boundary (ADR-056 / ADR-077, `Decision.proposed →
 * agreed`) applied to geometry: proposing ranks and suggests, deciding returns
 * a fact, and the two never share a return type.
 *
 * States and the transitions between them are specified in
 * `docs/STATE_TRANSITIONS.md` §提案 — not restated here (§1.1).
 *
 * ## A proposal carries a diff, or it is not a proposal (D3)
 *
 * `from → to` plus a rationale. Without the diff a receipt cannot say *what was
 * approved*, and `makeProposal` refuses to build one — the incomplete receipt is
 * unrepresentable rather than merely discouraged.
 *
 * ## There is no fourth state (U2)
 *
 * Whether a proposal has gone stale is `from === current value`, evaluated at
 * the moment someone asks. Storing staleness would persist a fact the document
 * already answers, and the stored copy would start drifting the first time a
 * claim moved without anything re-marking the proposals (§1.1 / D4). Rejected
 * approvals leave the proposal exactly where it was — the guard is a gate, not
 * a transition.
 *
 * @module context/Proposal
 */

import { readClaim, ownerOf, isOwnerUndeclared, isOwnerlessDeclared, TARGET_KIND } from './Ownership.js'
import { hasKey } from './Keyring.js'
import { isLineProposal, lineApprovalGuards, lineRejectionGuards, lineVersion } from './CriteriaLine.js'

/** Ref prefix for proposals (parallel to `conflict_` / `nc_`). */
export const PROPOSAL_REF_PREFIX = 'prop_'

/** Proposal lifecycle (`docs/STATE_TRANSITIONS.md` §提案). */
export const PROPOSAL_STATE = Object.freeze({
  /** On the table, carrying its diff. The only non-terminal state. */
  PROPOSED: 'proposed',
  /** The owner approved: the claim moved and a receipt was appended. Terminal. */
  APPROVED: 'approved',
  /** The proposer took it back. Terminal. */
  WITHDRAWN: 'withdrawn',
  /**
   * Someone with the right to approve said no. Terminal (ADR-165 §PR2 の俯瞰
   * C / D — added for the line's zero-sum veto, open to ADR-104 owners too:
   * one state set, not one per kind of proposal).
   */
  REJECTED: 'rejected',
})

/**
 * Legal transitions. Both ends are terminal: re-opening an approved or
 * withdrawn proposal would rewrite history, so wanting the change again means
 * **a new proposal** (same discipline as U3's superseding agenda items).
 */
const PROPOSAL_TRANSITIONS = Object.freeze({
  [PROPOSAL_STATE.PROPOSED]:  [PROPOSAL_STATE.APPROVED, PROPOSAL_STATE.WITHDRAWN, PROPOSAL_STATE.REJECTED],
  [PROPOSAL_STATE.APPROVED]:  [],
  [PROPOSAL_STATE.WITHDRAWN]: [],
  [PROPOSAL_STATE.REJECTED]:  [],
})

/** Structural equality over claim values (intervals, regions, criteria). */
export function sameClaimValue(a, b) {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a).sort()
  const kb = Object.keys(b).sort()
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false
  return ka.every(k => sameClaimValue(a[k], b[k]))
}

/**
 * Build a proposal, refusing the shapes that cannot become receipts (D3).
 *
 * @param {object} spec
 * @param {string} spec.ref        — `prop_*`
 * @param {string} spec.by         — the proposing actor
 * @param {{kind: string, ref: string}} spec.target
 * @param {any}    spec.from       — the claim's value when the gesture started
 * @param {any}    spec.to         — the wanted value
 * @param {string} spec.rationale  — why; lands verbatim in `Decision.rationale`
 * @returns {object} a frozen proposal in state `proposed`
 */
export function makeProposal({ ref, by, target, from, to, rationale }) {
  if (!ref?.startsWith(PROPOSAL_REF_PREFIX)) {
    throw new Error(`[Proposal] ref must start with "${PROPOSAL_REF_PREFIX}", got "${ref}"`)
  }
  if (!by) throw new Error('[Proposal] a proposal must name its proposer (`by`)')
  if (!target?.kind || !target?.ref) throw new Error('[Proposal] a proposal must name its target')
  if (!rationale?.trim()) {
    throw new Error(
      '[Proposal] a proposal must carry a rationale — it becomes Decision.rationale, ' +
      'and a receipt without one cannot say why the change was accepted (ADR-104 D3)')
  }
  if (sameClaimValue(from, to)) {
    throw new Error(
      '[Proposal] a proposal must carry a diff (from → to) — approving a no-op would ' +
      'record a receipt that states nothing (ADR-104 D3)')
  }
  return Object.freeze({ ref, by, target, from, to, rationale, state: PROPOSAL_STATE.PROPOSED })
}

/** @param {object} ctx @param {string} ref */
export function findProposal(ctx, ref) {
  return (ctx?.proposals ?? []).find(p => p.ref === ref) ?? null
}

/**
 * **Derived** staleness (U2): the proposal's `from` no longer matches the claim.
 * Never stored — asked.
 *
 * @param {object} ctx
 * @param {object} proposal
 * @returns {boolean}
 */
export function isStale(ctx, proposal) {
  return !sameClaimValue(proposal.from, readClaim(ctx, proposal.target))
}

/**
 * **The approval gate** — every reason approval is refused, from one call
 * (PHILOSOPHY #11: the disabled flag and its explanation share a return value,
 * so a UI cannot show one without the other).
 *
 * G0 terminal — an approved or withdrawn proposal has nowhere to go.
 * G1 authority — only a holder of the owner's key may approve (D5). An
 *    undeclared owner cannot be approved *for*, which turns the missing
 *    declaration into the next actionable step rather than a silent block.
 * G2 optimistic lock — `from === current value` (U2). Proposals are never
 *    blocked while being written; the collision is detected at approval, which
 *    is the choice `docs/CONCURRENCY.md` requires be made before the code
 *    (PHILOSOPHY #7) — optimistic, favouring responsiveness.
 *
 * @param {object} ctx
 * @param {object} proposal
 * @param {Set<string>|string[]} keyring
 * @returns {{ok: boolean, reasons: string[], owner: string|undefined}}
 */
export function approvalGuards(ctx, proposal, keyring) {
  // ADR-165 D5: a proposal against the agreed line is approved by the other
  // end users, not by the owner's key — a different authority, same gate shape.
  if (isLineProposal(ctx, proposal)) {
    return { ...lineApprovalGuards(ctx, proposal, keyring), owner: undefined, line: true }
  }
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
  const reasons = []
  const owner = ownerOf(ctx, proposal.target)

  if (proposal.state !== PROPOSAL_STATE.PROPOSED) {
    reasons.push(`This proposal is already ${proposal.state} — approving it again would rewrite history. Raise a new proposal instead.`)
  }

  if (isOwnerUndeclared(owner)) {
    reasons.push(`"${proposal.target.ref}" has no declared owner, so there is no key that can approve this. Declare an owner first.`)
  } else if (isOwnerlessDeclared(owner)) {
    reasons.push(`"${proposal.target.ref}" is declared to have no owner — it can be edited directly, so there is nothing to approve.`)
  } else if (!hasKey(keys, owner)) {
    reasons.push(`Only a holder of "${owner}"'s key may approve this (you hold ${keys.size === 0 ? 'no keys' : [...keys].join(', ')}).`)
  }

  if (isStale(ctx, proposal)) {
    reasons.push(`"${proposal.target.ref}" has moved since this proposal was written, so approving it would overwrite a change nobody agreed to. Withdraw and re-draw the diff.`)
  }

  return { ok: reasons.length === 0, reasons, owner }
}

/** Append a proposal to the document. */
export function addProposal(ctx, proposal) {
  return { ...ctx, proposals: [...(ctx.proposals ?? []), proposal] }
}

/**
 * Remove a proposal — the **undo** of raising one, not a domain transition.
 * Withdrawal is a human act and is kept (D4); undo unwinds history and leaves
 * no trace by design, the same split the CommandStack already draws between
 * ordinary edits and document facts.
 */
export function removeProposal(ctx, ref) {
  return { ...ctx, proposals: (ctx.proposals ?? []).filter(p => p.ref !== ref) }
}

/** Replace one proposal, checking the transition is legal. */
function withProposalState(ctx, ref, state, extra = {}) {
  const proposals = (ctx.proposals ?? []).map(p => {
    if (p.ref !== ref) return p
    const legal = PROPOSAL_TRANSITIONS[p.state] ?? []
    if (!legal.includes(state)) {
      throw new Error(
        `[Proposal] ${p.state} → ${state} is not a legal transition for "${ref}" ` +
        `(legal: ${legal.length ? legal.join(', ') : 'none — terminal'}). ` +
        'See docs/STATE_TRANSITIONS.md §提案.')
    }
    return { ...p, ...extra, state }
  })
  return { ...ctx, proposals }
}

/**
 * Withdraw a proposal (the proposer takes it back). Terminal.
 * @param {object} ctx @param {string} ref
 */
export function withdrawProposal(ctx, ref) {
  return withProposalState(ctx, ref, PROPOSAL_STATE.WITHDRAWN)
}

/**
 * **Approve — one indivisible transform** (ADR-104 U1).
 *
 * Moves the claim to `to`, marks the proposal approved, and appends the
 * `Decision` receipt in a single new document. The three cannot be applied
 * separately, so the state where a receipt says "agreed" while the claim still
 * holds the old value — and R6 therefore keeps deriving the conflict the
 * receipt claims to have settled — is not expressible (§1.4 / §1.1).
 *
 * `decidedBy` is not a free parameter: callers pass the keyring, and the
 * signature is the intersection with the owner (U4). "Decided with a key I do
 * not hold" has no argument shape.
 *
 * @param {object} ctx
 * @param {string} ref — proposal ref
 * @param {{decidedBy: string[], keyCardinality: number}} signature
 * @returns {object} a new context object
 */
export function approveProposal(ctx, ref, { decidedBy, keyCardinality }) {
  const proposal = findProposal(ctx, ref)
  if (!proposal) throw new Error(`[Proposal] no proposal "${ref}"`)
  if (isLineProposal(ctx, proposal)) return approveLineProposal(ctx, proposal, { decidedBy, keyCardinality })
  if (!decidedBy?.length) {
    throw new Error(
      `[Proposal] approving "${ref}" needs at least one held key — ` +
      'the receipt exists to record that the *owner* agreed (ADR-104 D5)')
  }

  const withClaim  = writeClaim(ctx, proposal.target, proposal.to)
  const withState  = withProposalState(withClaim, ref, PROPOSAL_STATE.APPROVED, {
    decidedBy,
    keyCardinalityAtDecision: keyCardinality,
  })
  const receipt = {
    ref: `d_${ref}`,
    resolves: ref,
    decidedBy,
    status: 'agreed',
    rationale: proposal.rationale,
    keyCardinalityAtDecision: keyCardinality,
  }
  return { ...withState, decisions: [...(withState.decisions ?? []), receipt] }
}

/**
 * **The inverse of `approveProposal`** — the undo path (§3.5).
 *
 * Undo has to unwind all three effects together for the same reason approval
 * applied them together (U1): leaving the receipt behind while the claim went
 * back would produce a document whose receipt says "agreed" and whose R6 output
 * says "still in conflict". Being unable to write that state is the property,
 * and it has to hold in both directions or it does not hold.
 *
 * @param {object} ctx
 * @param {string} ref
 * @returns {object} a new context object
 */
export function unapproveProposal(ctx, ref, signature) {
  const proposal = findProposal(ctx, ref)
  if (!proposal) throw new Error(`[Proposal] no proposal "${ref}"`)
  if (Array.isArray(proposal.approvals)) return unapproveLineProposal(ctx, proposal, signature)
  const withClaim = writeClaim(ctx, proposal.target, proposal.from)
  return {
    ...restoreProposalState(withClaim, ref, PROPOSAL_STATE.PROPOSED),
    decisions: (withClaim.decisions ?? []).filter(d => d.resolves !== ref),
  }
}

/**
 * Reverse a terminal transition — the **undo** path only, never a domain move.
 * Withdrawing and then un-withdrawing is not something a person can do; undo
 * rewinds history, which is a different act from changing one's mind (that is
 * a new proposal — see the transition table above).
 */
export function restoreProposalState(ctx, ref, state) {
  const proposals = (ctx.proposals ?? []).map(p => {
    if (p.ref !== ref) return p
    const next = { ...p, state }
    delete next.decidedBy
    delete next.keyCardinalityAtDecision
    delete next.rejectedBy
    delete next.lineVersion
    delete next.approversRequired
    return next
  })
  return { ...ctx, proposals }
}

/**
 * Write a claim's value. Kept next to `approveProposal` because approval is the
 * only path that moves a claim someone else owns — the direct-edit path already
 * has its own entry (`applyAdmissibleEdit`).
 *
 * @param {object} ctx
 * @param {{kind: string, ref: string}} target
 * @param {any} value
 * @returns {object} a new context object
 */
export function writeClaim(ctx, target, value) {
  if (target.kind === TARGET_KIND.ACTOR_MIX) {
    const actors = (ctx.actors ?? []).map(a => (a.ref === target.ref ? { ...a, mix: value } : a))
    return { ...ctx, actors }
  }
  const field = target.kind.split('.')[1]
  const requirements = (ctx.requirements ?? []).map(req =>
    req.ref === target.ref ? { ...req, [field]: value } : req)
  return { ...ctx, requirements }
}

// ── The agreed line (ADR-165 D5) ──────────────────────────────────────────────
//
// A line proposal is an ordinary proposal whose authority is different: not
// the owner's key but **every other end user's** approval. Approvals gather on
// the proposal (`approvals[]`, a set — the same key twice counts once); the one
// that completes the set applies the change, exactly like an ADR-104 approval
// (claim + state + receipt in one transform, U1), and stamps the version it
// produced. With no other end user the set is empty from the start, and the
// change passes recorded as "no approvers" (`approversRequired: []`).

/**
 * Add approvals to a line proposal; apply it when the set is complete.
 * @param {object} ctx
 * @param {object} proposal
 * @param {{decidedBy: string[], keyCardinality: number}} signature — the approvers being added now
 */
function approveLineProposal(ctx, proposal, { decidedBy, keyCardinality }) {
  const guards = lineApprovalGuards(ctx, proposal, decidedBy ?? [])
  if (!guards.ok) {
    throw new Error(`[Proposal] cannot approve line proposal "${proposal.ref}": ${guards.reasons.join(' ')}`)
  }
  const approvals = [...new Set([...(proposal.approvals ?? []), ...guards.approvers])]
  const complete = guards.required.every(r => approvals.includes(r))
  if (!complete) {
    const proposals = ctx.proposals.map(p => (p.ref === proposal.ref ? { ...p, approvals } : p))
    return { ...ctx, proposals }
  }

  const version = (lineVersion(ctx) ?? 0) + 1
  const withClaim = writeClaim(ctx, proposal.target, proposal.to)
  const withState = withProposalState(withClaim, proposal.ref, PROPOSAL_STATE.APPROVED, {
    approvals,
    decidedBy: approvals,
    approversRequired: guards.required,
    lineVersion: version,
    keyCardinalityAtDecision: keyCardinality,
  })
  const receipt = {
    ref: `d_${proposal.ref}`,
    resolves: proposal.ref,
    decidedBy: approvals,
    status: 'agreed',
    rationale: guards.required.length === 0
      ? `${proposal.rationale} (no other end user — recorded only)`
      : proposal.rationale,
    keyCardinalityAtDecision: keyCardinality,
  }
  return { ...withState, decisions: [...(withState.decisions ?? []), receipt] }
}

/**
 * Undo of one line approval: remove the approvers that approval added, and,
 * if it was the completing one, unwind claim + state + receipt together (U1).
 */
function unapproveLineProposal(ctx, proposal, signature) {
  const added = new Set(signature?.decidedBy ?? [])
  let next = ctx
  if (proposal.state === PROPOSAL_STATE.APPROVED) {
    const withClaim = writeClaim(ctx, proposal.target, proposal.from)
    next = {
      ...restoreProposalState(withClaim, proposal.ref, PROPOSAL_STATE.PROPOSED),
      decisions: (withClaim.decisions ?? []).filter(d => d.resolves !== proposal.ref),
    }
  }
  const proposals = next.proposals.map(p => (p.ref === proposal.ref
    ? { ...p, approvals: (p.approvals ?? []).filter(r => !added.has(r)) }
    : p))
  return { ...next, proposals }
}

/**
 * **The rejection gate.** A line proposal may be rejected by any other end
 * user (the zero-sum veto); an ordinary proposal by a holder of the owner's
 * key — the same authority that could have approved it.
 *
 * @returns {{ok: boolean, reasons: string[], by: string[]}}
 */
export function rejectionGuards(ctx, proposal, keyring) {
  if (isLineProposal(ctx, proposal)) return lineRejectionGuards(ctx, proposal, keyring)
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
  const reasons = []
  const owner = ownerOf(ctx, proposal.target)
  if (proposal.state !== PROPOSAL_STATE.PROPOSED) reasons.push(`This proposal is already ${proposal.state}.`)
  if (isOwnerUndeclared(owner) || isOwnerlessDeclared(owner)) {
    reasons.push(`"${proposal.target.ref}" has no owner who could reject this.`)
  } else if (!hasKey(keys, owner)) {
    reasons.push(`Only a holder of "${owner}"'s key may reject this.`)
  }
  return { ok: reasons.length === 0, reasons, by: !isOwnerUndeclared(owner) && hasKey(keys, owner) ? [owner] : [] }
}

/**
 * Reject a proposal. Terminal and kept (a human act — ADR-104 D4). The claim
 * does not move and no receipt is written: a receipt records what was agreed.
 * @param {object} ctx @param {string} ref @param {string[]} rejectedBy
 */
export function rejectProposal(ctx, ref, rejectedBy) {
  if (!rejectedBy?.length) {
    throw new Error(`[Proposal] rejecting "${ref}" must name who rejected it`)
  }
  return withProposalState(ctx, ref, PROPOSAL_STATE.REJECTED, { rejectedBy })
}
