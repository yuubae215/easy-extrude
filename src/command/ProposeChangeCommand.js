/**
 * ProposeChangeCommand — records raising a proposal for undo/redo
 * (ADR-104 D3, ADR-050 §3.5, ADR-022).
 *
 * What an edit gesture becomes when its author holds no key for the claim's
 * owner. The document gains a stored diff; no claim moves, which is exactly why
 * this needs nobody's permission.
 *
 * Undo **removes** the proposal rather than withdrawing it. The two are
 * different acts: withdrawal is a decision a person made and is kept in the
 * record (ADR-104 D4), while undo rewinds history and leaves nothing behind —
 * the same split the CommandStack already draws between ordinary edits and
 * document facts.
 *
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {object} proposal — built by `makeProposal()` (refuses a diffless one)
 * @param {object} viewContext — { camera, renderer, container }
 * @returns {{label: string, execute(): Promise<object>, undo(): Promise<object>}}
 */
export function createProposeChangeCommand(ctxService, proposal, viewContext) {
  return {
    label: `Propose ${proposal.target.ref}`,
    execute() { return ctxService.proposeChange(proposal, viewContext) },
    undo()    { return ctxService.unproposeChange(proposal.ref, viewContext) },
  }
}
