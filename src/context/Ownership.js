/**
 * Ownership — who may write a claim, and what happens when nobody has said
 * (ADR-104 D1 / D2 / D3).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 * Returns new data; never mutates its inputs. (PHILOSOPHY #6)
 *
 * ## The one rule (ADR-104 D3)
 *
 *   key held      → DIRECT        the claim is rewritten in place; no meeting
 *   no key        → PROPOSE_ONLY  the gesture becomes a proposal; the floor gains an item
 *   derived value → READ_ONLY     nobody writes it — it is recomputed from the doc
 *
 * Permission is **three-valued and typed** (`EDIT_PERMISSION`), not a pair of
 * booleans: "can't edit" and "can't even ask" are different answers, and a
 * scatter of flags would make the difference unrepresentable in the type and
 * therefore invisible at the call site (§1.4).
 *
 * ## Why the answer and its reason come back together
 *
 * `editPermission()` returns `{ permission, reason }` from **one** predicate.
 * A caller that disables an affordance must show why (PHILOSOPHY #11 /
 * disabled-as-quest, ADR-065); deriving the reason separately is how the flag
 * and its explanation drift apart.
 *
 * ## Why `by` is not promoted to `owner`
 *
 * `requirement.by` is provenance — *who said it*. `owner` is authority — *who
 * may change it*. Inferring one from the other would fill a declared-zero with
 * a default, and that is exactly the collapse ADR-104 D2 forbids: an undeclared
 * owner means one of "really nobody" / "forgot to claim it" / "waiting for
 * someone else to claim it", and only the first is legitimate. So an undeclared
 * owner stays undeclared, resolves to PROPOSE_ONLY (neither "everyone writes"
 * nor "nobody writes"), and gets counted (PHILOSOPHY #31).
 *
 * @module context/Ownership
 */

import { hasKey } from './Keyring.js'

/**
 * The **declared** absence of an owner — "we looked, and this belongs to nobody".
 * Distinct from `undefined` (nobody has said), which is the counted case.
 * A declared-none claim is directly editable: the declaration *is* the decision.
 */
export const OWNER_NONE_DECLARED = 'none'

/** The three edit permissions (ADR-104 D3 / Consequences). */
export const EDIT_PERMISSION = Object.freeze({
  /** A key for the owner is held — the claim is rewritten in place. */
  DIRECT: 'direct',
  /** No key — the gesture becomes a proposal carrying `from → to` + rationale. */
  PROPOSE_ONLY: 'propose-only',
  /** A derived value. Nobody writes it, with or without keys. */
  READ_ONLY: 'read-only',
})

/**
 * Claim kinds a proposal may target.
 *
 * D3 says the rule is the same "for an entity or for a number", so both shapes
 * are declared here: a region/interval admissible (the 3D drag) and a scalar
 * criterion (a typed number). `CONFLICT` is the derived inhabitant of
 * READ_ONLY — it exists so the third permission has a real case rather than a
 * theoretical one.
 */
export const TARGET_KIND = Object.freeze({
  REQUIREMENT_ADMISSIBLE: 'requirement.admissible',
  REQUIREMENT_CRITERION:  'requirement.criterion',
  CONFLICT:               'conflict',
})

/**
 * Per-kind claim access. **An undeclared kind throws** (PHILOSOPHY #31): a
 * fall-through default would make "declared read-only" and "a kind nobody
 * thought about" indistinguishable, which is the absence of a decision wearing
 * the costume of one.
 *
 * @type {Readonly<Record<string, {writable: boolean, read: (ctx: object, target: object) => any}>>}
 */
const CLAIM_ACCESS_BY_KIND = Object.freeze({
  [TARGET_KIND.REQUIREMENT_ADMISSIBLE]: {
    writable: true,
    read: (ctx, target) => requirementOf(ctx, target)?.admissible ?? null,
  },
  [TARGET_KIND.REQUIREMENT_CRITERION]: {
    writable: true,
    read: (ctx, target) => requirementOf(ctx, target)?.criterion ?? null,
  },
  [TARGET_KIND.CONFLICT]: {
    // R6 recomputes conflicts from the requirement graph on every validate, so a
    // stored conflict would be a second source (§1.1 / ADR-104 D4).
    writable: false,
    read: () => null,
  },
})

/** @param {object} ctx @param {{ref: string}} target */
const requirementOf = (ctx, target) =>
  (ctx?.requirements ?? []).find(r => r.ref === target.ref) ?? null

/**
 * Look up a target kind's access rules, throwing on an undeclared kind.
 * @param {{kind: string}} target
 */
function accessFor(target) {
  const access = CLAIM_ACCESS_BY_KIND[target?.kind]
  if (!access) {
    throw new Error(
      `[Ownership] undeclared target kind "${target?.kind}". ` +
      `Declared kinds: ${Object.values(TARGET_KIND).join(', ')}. ` +
      'A new kind must declare whether it is writable — silently defaulting would ' +
      'hide "nobody decided" behind "declared read-only" (PHILOSOPHY #31 / ADR-104).')
  }
  return access
}

/** True when the kind is a derived value that nobody writes directly. */
export function isDerivedTarget(target) {
  return !accessFor(target).writable
}

/**
 * The current value of a claim — the left side of a proposal's diff and the
 * operand of the optimistic-locking guard (ADR-104 U2).
 *
 * @param {object} ctx     — Context DSL object
 * @param {{kind: string, ref: string}} target
 * @returns {any} the claim's value, or `null` when the target does not exist
 */
export function readClaim(ctx, target) {
  return accessFor(target).read(ctx, target)
}

/**
 * The owner of a claim.
 *
 * @param {object} ctx
 * @param {{kind: string, ref: string}} target
 * @returns {string|undefined} an actor ref, `OWNER_NONE_DECLARED`, or
 *   `undefined` when nobody has declared one (the counted case — D2)
 */
export function ownerOf(ctx, target) {
  accessFor(target)   // reject undeclared kinds here too — one gate, not two
  return requirementOf(ctx, target)?.owner
}

/**
 * **The two zeroes, told apart** (ADR-104 D2).
 *
 * As values these look identical — neither names an actor — and every caller
 * that re-derives the distinction inline gets it right until the day one of
 * them forgets which zero it was handling. `IdentityContainment.test.js` keeps
 * the comparison here.
 */
export const isOwnerUndeclared = owner => owner === undefined
export const isOwnerlessDeclared = owner => owner === OWNER_NONE_DECLARED

/**
 * Every writable claim whose owner nobody has declared (ADR-104 D2).
 *
 * The count is the deliverable, not the list: an undeclared owner is legitimate
 * exactly one third of the time, so it is surfaced and counted rather than
 * defaulted away (ratchet, same shape as ADR-100).
 *
 * @param {object} ctx
 * @returns {{kind: string, ref: string}[]} targets in document order
 */
export function undeclaredOwners(ctx) {
  return (ctx?.requirements ?? [])
    .filter(r => isOwnerUndeclared(r.owner))
    .map(r => ({ kind: TARGET_KIND.REQUIREMENT_ADMISSIBLE, ref: r.ref }))
}

/**
 * **The single derivation of "may I write this?"** (ADR-104 D3).
 *
 * Callers never reassemble this from `keys.has(owner)` — that inline rebuild is
 * the second-source shape `IdentityContainment.test.js` guards against, and it
 * loses the reason along the way.
 *
 * @param {Set<string>|string[]} keyring — held keys (`0..N`; empty is legitimate)
 * @param {object} ctx
 * @param {{kind: string, ref: string}} target
 * @returns {{permission: string, reason: string}} the answer and why, from one call
 */
export function editPermission(keyring, ctx, target) {
  const keys = keyring instanceof Set ? keyring : new Set(keyring ?? [])

  if (isDerivedTarget(target)) {
    return {
      permission: EDIT_PERMISSION.READ_ONLY,
      reason: 'This is derived from the document on every validate — it is not a claim anyone owns (ADR-104 D4).',
    }
  }

  const owner = ownerOf(ctx, target)

  if (isOwnerUndeclared(owner)) {
    return {
      permission: EDIT_PERMISSION.PROPOSE_ONLY,
      reason: `No owner has been declared for "${target.ref}". Declare one (or declare that it has none) to edit it directly — until then a change is a proposal.`,
    }
  }

  if (isOwnerlessDeclared(owner)) {
    return {
      permission: EDIT_PERMISSION.DIRECT,
      reason: `"${target.ref}" is declared to have no owner — anyone may edit it.`,
    }
  }

  if (hasKey(keys, owner)) {
    return {
      permission: EDIT_PERMISSION.DIRECT,
      reason: `You hold the key for "${owner}".`,
    }
  }

  return {
    permission: EDIT_PERMISSION.PROPOSE_ONLY,
    reason: keys.size === 0
      ? `"${target.ref}" is owned by "${owner}" and you hold no keys — a change becomes a proposal.`
      : `"${target.ref}" is owned by "${owner}"; you hold ${[...keys].join(', ')} — a change becomes a proposal.`,
  }
}

/**
 * Declare (or clear) a claim's owner — the pure document transform.
 *
 * @param {object} ctx
 * @param {string} reqRef
 * @param {string|null} owner — an actor ref, `OWNER_NONE_DECLARED`, or `null` to
 *   return the claim to the undeclared (counted) state
 * @returns {object} a new context object
 */
export function declareOwner(ctx, reqRef, owner) {
  const requirements = (ctx.requirements ?? []).map(req => {
    if (req.ref !== reqRef) return req
    const next = { ...req }
    if (owner === null) delete next.owner
    else next.owner = owner
    return next
  })
  return { ...ctx, requirements }
}
