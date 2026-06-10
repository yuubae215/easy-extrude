/**
 * ContextDslSchema — constants and type definitions for Context DSL v0.1 (ADR-046).
 *
 * Pure data: no I/O, no Three.js, no DOM.
 *
 * Context DSL v0.1 encodes the requirement context *upstream* of Layout DSL:
 *   L0 Provenance   → actors / sources           (who said it, based on what)
 *   L1 Given        → given[]                    (site facts — may be unknown / interval)
 *   L2 Intent       → intents[]                  (business goals)
 *   L3 Obligation   → obligations[]              (scope of work = defect boundary unit)
 *   L4 Specification→ specification.layout       (layout/1.0 shape with $fact/$decision/$expr refs)
 *   L5 Acceptance   → acceptance[]               (checkable predicates, static or witnessed)
 *
 * Constitutional invariants (ADR-046 §2.3):
 *   1. No orphan spec — every L4 entity/constraint has ≥1 TraceLink
 *   2. Intervals are never silently collapsed — only an explicit Decision resolves them
 *   3. AcceptanceChecks referencing assumed/unknown facts are blocked
 *   4. OpenQuestions are emitted by the validator, never hand-written
 */

export const CONTEXT_DSL_VERSION = 'context/0.1'

/** Actor roles — the four user personas plus the customer. */
export const VALID_ROLES = ['developer', 'maintainer', 'endUser', 'agent', 'customer']

/** Epistemic status of a Fact. */
export const VALID_FACT_STATUS = ['measured', 'asserted', 'assumed', 'unknown']

/** Fact statuses that block an AcceptanceCheck depending on them. */
export const BLOCKING_FACT_STATUS = ['assumed', 'unknown']

/** Acceptance check modes: compile-time geometric vs. witnessed at 立会. */
export const VALID_CHECK_MODES = ['static', 'witnessed']

/** TraceLink kinds (requirement → spec element). */
export const VALID_TRACE_KINDS = ['derives', 'satisfies', 'constrains']

/** Decision lifecycle. */
export const VALID_DECISION_STATUS = ['proposed', 'agreed', 'signed']

/** Sentinel for an attribute whose value nobody has provided yet. */
export const UNKNOWN = 'unknown'

/** Sentinel for an obligation whose responsibility split is not yet agreed. */
export const UNASSIGNED = 'unassigned'
