/**
 * RoleKpiCatalog — versioned catalog of the KPIs each engineering discipline is
 * expected to contribute to a requirement context (ADR-049 Phase 2, R8).
 *
 * Pure data + a lookup helper: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 *
 * Rationale (ADR-049 §5.1): "did the right expert get asked?" must not depend on
 * who happened to attend the kick-off. A discipline's mandatory KPIs are a
 * reviewable, version-controlled asset; a missing one surfaces as an OpenQuestion
 * (R8) and is fixed permanently by updating the catalog — the same operating loop
 * as CODE_CONTRACTS.
 *
 * The catalog keys on an Actor's `discipline` (an additive field, ADR-049 Phase 2)
 * rather than the coarse `role` enum: roles (developer/maintainer/…) cannot express
 * that a vision engineer must contribute a "resolution" KPI. A context may override
 * the default catalog via `ctx.kpiCatalog` so fixtures and projects can encode their
 * own discipline expectations.
 *
 * @module context/RoleKpiCatalog
 */

/** Catalog format version (diffed across baselines like the context DSL). */
export const ROLE_KPI_CATALOG_VERSION = 'role-kpi/1.0'

/**
 * Default catalog: discipline → mandatory KPI names (`Requirement.kpi.name`).
 * Keep the canonical robot-cell disciplines from ADR-049 §1.
 */
export const ROLE_KPI_CATALOG = {
  vision: ['resolution'],
  robot:  ['singularityMargin', 'cycleTime'],
  mech:   ['installClearance'],
  eoat:   ['tcpClearance'],
}

/**
 * Mandatory KPI names for a discipline. Unknown disciplines have no obligations
 * (the catalog is an allow-list of expectations, not a closed enum of roles).
 *
 * @param {string} discipline
 * @param {Record<string, string[]>} [catalog]
 * @returns {string[]}
 */
export function requiredKpis(discipline, catalog = ROLE_KPI_CATALOG) {
  return catalog?.[discipline] ?? []
}
