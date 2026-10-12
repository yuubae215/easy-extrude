/**
 * RejectProposalCommand — someone with the right to approve says no
 * (ADR-165 §PR2 の俯瞰 C / D).
 *
 * Terminal and **kept**, like withdrawal: a rejection is a human act, and
 * wanting the change again means a new proposal (ADR-104 D4 / U3). The claim
 * does not move and no receipt is written — a receipt records what was agreed.
 *
 * `rejectedBy` is not invented by the caller: it comes from
 * `ContextService.rejectionGuards(ref, keyring).by` — the held keys that may
 * reject (any other end user for a line proposal, the owner otherwise).
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref — the proposal ref
 * @param {string[]} rejectedBy
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{label: string, execute(): Promise<object>, undo(): Promise<object>}}
 */
export function createRejectProposalCommand(ctxService, ref, rejectedBy, viewContext) {
  if (!rejectedBy?.length) {
    throw new Error(
      `[RejectProposalCommand] refusing to reject "${ref}" without naming who — ` +
      'call ContextService.rejectionGuards(ref, keyring) and show its reasons instead (PHILOSOPHY #11).')
  }
  return {
    label: `Reject proposal ${ref}`,
    execute() { return ctxService.rejectProposal(ref, rejectedBy, viewContext) },
    undo()    { return ctxService.unrejectProposal(ref, viewContext) },
  }
}
