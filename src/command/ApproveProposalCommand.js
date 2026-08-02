/**
 * ApproveProposalCommand — the owner accepts a proposal (ADR-104 U1).
 *
 * **One command, three effects, indivisible.** Approval moves the claim to the
 * proposed value, marks the proposal approved, and appends the `Decision`
 * receipt. They are not separate steps that happen to be called together: if a
 * receipt could be written while the claim stayed put, the receipt would say
 * "agreed" while R6 kept deriving the very conflict it claims to have settled —
 * two authorities for one fact (§1.1). Undo unwinds all three for the same
 * reason; "keep the receipt, revert the claim" has no way to be expressed.
 *
 * Unlike `ApproveDecisionCommand` (a status flip that leaves the compiled layout
 * invariant), this **regenerates**: the claim drives geometry.
 *
 * The signature is not a parameter the caller invents. It comes from
 * `ContextService.signatureForProposal(ref, keyring)`, which intersects the held
 * keys with the claim's owner and refuses when the guards refuse — so "approved
 * with a key I do not hold" has no argument shape (ADR-104 U4), and the gate
 * cannot be bypassed by calling the command directly (PHILOSOPHY #1).
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref — the proposal ref
 * @param {{decidedBy: string[], keyCardinality: number}} signature — from
 *   `signatureForProposal()`; `null` there means the approval is refused and
 *   this command must not be built
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{label: string, execute(): Promise<object>, undo(): Promise<object>}}
 */
export function createApproveProposalCommand(ctxService, ref, signature, viewContext) {
  if (!signature?.decidedBy?.length) {
    throw new Error(
      `[ApproveProposalCommand] refusing to build an approval of "${ref}" without a signature. ` +
      'Call ContextService.signatureForProposal(ref, keyring) and show its guard reasons ' +
      'instead of approving unsigned (ADR-104 D5 / PHILOSOPHY #11).')
  }
  return {
    label: `Approve proposal ${ref}`,
    execute() { return ctxService.approveProposal(ref, signature, viewContext) },
    undo()    { return ctxService.unapproveProposal(ref, viewContext) },
  }
}
