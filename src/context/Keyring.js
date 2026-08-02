/**
 * Keyring — which actors you may write as (ADR-104 D1 / D6).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new sets; never mutates its inputs. (PHILOSOPHY #6)
 *
 * ## Why a set and not a mode
 *
 * "Which actor am I acting as right now?" is a choice, and a choice needs a
 * switch — that is a mode, and modes were what ADR-103/104 set out not to add.
 * "Which keys do I hold?" is a set: holding two keys at once is not a conflict
 * to arbitrate but the ordinary case of one person covering two roles. Nothing
 * has to be switched, so nothing becomes modal.
 *
 * Cardinality `0..N`, and **`0` is not filled in** (PHILOSOPHY #31):
 *
 *   0 — nobody has claimed a key. Every owned claim is PROPOSE_ONLY. Defaulting
 *       to "all keys" would make "silently rewriting someone else's claim" the
 *       out-of-the-box behaviour; defaulting to "no writes at all" would make
 *       the app inert until you name yourself. Both are inferences; the third
 *       state (propose) is the honest answer and needs no default.
 *   1 — the ordinary case.
 *   N — one person covering several roles. Legitimate, not a warning.
 *
 * ## Not authentication (D6)
 *
 * A client-side check on a document the user can open in devtools is a guard
 * against *mistakes*, not against adversaries, and it says so in the UI. The
 * real risk is rewriting a colleague's claim by accident, which this does
 * address. The **set is the structure that survives**; only the checking moves
 * server-side later (BFF / `core`), because authentication is a backend
 * responsibility and the front end declares and displays (repo layer rule).
 *
 * @module context/Keyring
 */

/**
 * An empty keyring — the honest starting point, not a placeholder.
 * @returns {Set<string>}
 */
export function emptyKeyring() {
  return new Set()
}

/**
 * @param {Iterable<string>} [actorRefs]
 * @returns {Set<string>}
 */
export function keyringOf(actorRefs = []) {
  return new Set(actorRefs)
}

/**
 * Grant a key. Idempotent — granting a held key is not an error, it is the same
 * set (a set has no "already there" failure mode to report).
 *
 * @param {Set<string>} keyring
 * @param {string} actorRef
 * @returns {Set<string>} a new set
 */
export function grantKey(keyring, actorRef) {
  return new Set([...keyring, actorRef])
}

/**
 * Revoke a key. Idempotent for the same reason.
 *
 * @param {Set<string>} keyring
 * @param {string} actorRef
 * @returns {Set<string>} a new set
 */
export function revokeKey(keyring, actorRef) {
  const next = new Set(keyring)
  next.delete(actorRef)
  return next
}

/**
 * @param {Set<string>|string[]} keyring
 * @param {string} actorRef
 * @returns {boolean}
 */
export function hasKey(keyring, actorRef) {
  return (keyring instanceof Set ? keyring : new Set(keyring ?? [])).has(actorRef)
}

/**
 * How many keys are held **at this moment**. Burned into every receipt
 * (ADR-104 U4) so that "there was only one party in the room" stays recoverable
 * later: a lone decision producing no negotiation receipt is correct (D5), but
 * that correctness depends on a context which cannot be re-derived after more
 * people join. Human acts get stored; derived values do not (D4).
 *
 * @param {Set<string>|string[]} keyring
 * @returns {number}
 */
export function keyCardinality(keyring) {
  return (keyring instanceof Set ? keyring : new Set(keyring ?? [])).size
}

/**
 * The keys held for a set of required actors — the argument shape that makes
 * "decided with a key I do not hold" unrepresentable (ADR-104 U4).
 *
 * A command never accepts a caller-supplied `decidedBy`; it takes the keyring
 * and the owners, and the intersection *is* the signature. The type does the
 * enforcing, so no runtime check has to be remembered at each call site.
 *
 * @param {Set<string>|string[]} keyring
 * @param {string[]} requiredOwners
 * @returns {string[]} held keys among `requiredOwners`, in the given order
 */
export function signatureFor(keyring, requiredOwners) {
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])
  return requiredOwners.filter(owner => keys.has(owner))
}
