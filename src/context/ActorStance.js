/**
 * ActorStance — who stands as an end user, and what their job is (ADR-165 D1).
 *
 * Pure: no I/O, no Three.js, no DOM.
 *
 * Up to context/0.5 one field, `role`, carried two facts: the job function
 * (`maintainer`) and the stance (`endUser`). They are now two fields. This
 * module is **the one place** that reads them — including the legacy reading
 * of `role: "endUser"` — so the day the legacy value is finally dropped there
 * is one line to delete, not a scatter of `role === 'endUser'` that quietly
 * keeps answering the old way (registered in IDENTITY_RULES).
 *
 * @module context/ActorStance
 */

import { LEGACY_END_USER_ROLE } from './ContextDslSchema.js'

/**
 * True when the actor stands as an end user of this project.
 * Reads `endUser: true`, and the legacy `role: "endUser"` of 0.1–0.5 docs.
 */
export function isEndUser(actor) {
  return actor?.endUser === true || actor?.role === LEGACY_END_USER_ROLE
}

/**
 * The actor's declared job function (職能), or null when none is declared.
 * The legacy `role: "endUser"` declares a stance, **not** a job, so it reads
 * as null — never as a default job (R13 counts it instead).
 */
export function jobFunctionOf(actor) {
  const role = actor?.role
  if (typeof role !== 'string' || role === '' || role === LEGACY_END_USER_ROLE) return null
  return role
}

/** True when `role` carries the legacy stance value (an error in a 0.6 doc). */
export function writesLegacyStanceRole(actor) {
  return actor?.role === LEGACY_END_USER_ROLE
}

/**
 * The actor standing as an end user (input-immutable). The one writer of the
 * stance field — it never touches `role`, so a declared job survives.
 */
export function withEndUserStance(actor) {
  return { ...actor, endUser: true }
}

/**
 * The end user with a declared job function (input-immutable). Writing the
 * job replaces a legacy stance-in-role, and the stance moves to its own field
 * so it is not lost with it.
 */
export function withJobFunction(actor, role) {
  return { ...withEndUserStance(actor), role }
}

/** The actor no longer standing as an end user (input-immutable). Clears a legacy stance-in-role too. */
export function withoutEndUserStance(actor) {
  const { endUser: _stance, ...rest } = actor
  return writesLegacyStanceRole(rest) ? (({ role: _legacy, ...r }) => r)(rest) : rest
}

/** End users of a document, in actor order. Cardinality 1..N; 0 is reported, never defaulted. */
export function endUsersOf(ctx) {
  return (ctx?.actors ?? []).filter(isEndUser)
}
