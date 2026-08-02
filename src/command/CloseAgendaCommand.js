/**
 * CloseAgendaCommand — the two ways a tabled conflict leaves the floor
 * (ADR-104 D4 / D5 / U4).
 *
 * Both endings are receipts. Settling records that every involved party agreed;
 * closing undecided records that they met and did not. Keeping only the first
 * would mean deleting the meetings that went nowhere — and if tabling something
 * is history, quietly dropping the ones without a conclusion is not.
 *
 * Settling needs **every involved party's key**, not just one (the same n-ary
 * shape as ADR-049 invariant 8: a conflict over a shared variable is settled
 * once, by everyone, never pairwise). Closing undecided needs no keys, because
 * nobody is claiming agreement. The signature comes from
 * `ContextService.signatureForSettlement()`, so a settlement cannot be signed
 * past its own gate (PHILOSOPHY #1 / #11).
 *
 * Undo restores the item to `open` in both cases — a history rewind, not a
 * transition (terminal states have no outgoing edges; re-flaring is a new item
 * carrying `supersedes`, ADR-104 U3).
 *
 * @module command/CloseAgendaCommand
 */

/**
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref — the agenda-item ref
 * @param {{decidedBy: string[], keyCardinality: number}} signature — from
 *   `signatureForSettlement()`; `null` there means the settlement is refused
 * @param {object} viewContext
 */
export function createSettleAgendaCommand(ctxService, ref, signature, viewContext) {
  if (!signature?.decidedBy?.length) {
    throw new Error(
      `[CloseAgendaCommand] refusing to build a settlement of "${ref}" without a signature. ` +
      'Call ContextService.signatureForSettlement(ref, keyring) and show its guard reasons ' +
      'instead of settling unsigned (ADR-104 D5 / PHILOSOPHY #11).')
  }
  return {
    label: `Settle ${ref}`,
    execute() { return ctxService.settleAgendaItem(ref, signature, viewContext) },
    undo()    { return ctxService.restoreAgendaItem(ref, viewContext) },
  }
}

/**
 * @param {import('../service/ContextService.js').ContextService} ctxService
 * @param {string} ref
 * @param {{by: string, note?: string}} closer — who closed it, and optionally why
 * @param {object} viewContext
 */
export function createCloseUndecidedCommand(ctxService, ref, closer, viewContext) {
  return {
    label: `Close ${ref} undecided`,
    execute() { return ctxService.closeAgendaItemUndecided(ref, closer, viewContext) },
    undo()    { return ctxService.restoreAgendaItem(ref, viewContext) },
  }
}
