/**
 * WithdrawProposalCommand — the proposer takes a proposal back (ADR-104 D3).
 *
 * Terminal, and **kept**: withdrawal is a human act, and the rule is that human
 * acts are stored while derived values are not (ADR-104 D4). Wanting the change
 * again later means raising a new proposal, not reviving this one — the same
 * append-only discipline that makes a re-flared conflict a new agenda item
 * (U3), so history is never rewritten in place.
 *
 * Undo restores the proposal to `proposed`, which is a history rewind rather
 * than a state transition (the transition table has no edge back out of a
 * terminal state, and `restoreProposalState` is the undo-only door).
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref — the proposal ref
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{label: string, execute(): Promise<object>, undo(): Promise<object>}}
 */
export function createWithdrawProposalCommand(ctxService, ref, viewContext) {
  return {
    label: `Withdraw proposal ${ref}`,
    execute() { return ctxService.withdrawProposal(ref, viewContext) },
    undo()    { return ctxService.unwithdrawProposal(ref, viewContext) },
  }
}
