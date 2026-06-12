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
 * Constitutional invariants (ADR-046 §2.3, continued by ADR-049 §2.2):
 *   1. No orphan spec — every L4 entity/constraint has ≥1 TraceLink
 *   2. Intervals are never silently collapsed — only an explicit Decision resolves them
 *   3. AcceptanceChecks referencing assumed/unknown facts are blocked
 *   4. OpenQuestions are emitted by the validator, never hand-written
 *   6. Admissible regions are canonically derived from (kpi, criterion);
 *      hand-stated regions are provisional and raise an OpenQuestion (R9)
 *   7. Conflicts / NegotiationClusters are emitted by the validator (R6 / R7),
 *      never hand-written — only Decision.resolves may reference them
 *   8. A negotiation cluster is resolved by a single n-ary Decision
 *      (resolves: Variable[] + nominals{}), never by pairwise decisions
 *
 * context/0.2 (ADR-049) adds L2.5 on top of 0.1 — additive only:
 *   variables[]     shared design variables that several actors' KPIs reference
 *   requirements[]  (kpi, criterion) pairs constraining those variables
 */

export const CONTEXT_DSL_VERSION = 'context/0.2'

/** Accepted input versions — 0.2 is a strict superset of 0.1. */
export const SUPPORTED_VERSIONS = ['context/0.1', 'context/0.2']

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

/** Requirement negotiability — which side bends when a conflict is resolved. */
export const VALID_NEGOTIABILITY = ['must', 'should']

/**
 * Provenance of a Requirement's admissible region (ADR-049 invariant 6).
 * 'derived' — computed from (kpi, criterion); the canonical form.
 * 'stated'  — supplied by a human (form answer or 3D sketch); provisional,
 *             promoted to 'derived' once KPI backing exists (R9 asks for it).
 */
export const VALID_ADMISSIBLE_SOURCE = ['stated', 'derived']

/** Deterministic ref prefix for validator-emitted Conflicts (R6). */
export const CONFLICT_REF_PREFIX = 'conflict_'

/** Deterministic ref prefix for validator-emitted NegotiationClusters (R7). */
export const CLUSTER_REF_PREFIX = 'nc_'
