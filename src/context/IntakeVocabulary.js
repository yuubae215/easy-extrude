/**
 * IntakeVocabulary — the closed selection lists every intake surface offers so
 * no field confronts the user as a blank canvas (ADR-063 Phase 2, "白紙撲滅" —
 * recognition over recall).
 *
 * Pure data, derived where a source already exists (§1.1 — one source per fact):
 *   - ROLES / NEGOTIABILITY are THE schema enums (re-exported by reference so a
 *     schema change cannot drift a UI copy).
 *   - DISCIPLINES is the union of the RoleKpiCatalog's discipline keys (every
 *     discipline with mandatory KPIs must be selectable — the previous inline
 *     UI list silently lacked 'eoat') plus curated extras that carry no KPI
 *     obligations yet.
 *   - UNITS is the union of the units the KPI expression assets declare plus
 *     curated geometry/time extras.
 *
 * These lists are suggestion sources, not straitjackets: unit fields render
 * them as datalist suggestions so the expert free-text escape hatch stays open
 * (ADR-063 Goal 3 — 段階開示の最深部は残す).
 *
 * Pure: no THREE, no DOM, no I/O — loads under bare `node --test`.
 *
 * @module context/IntakeVocabulary
 */
import { VALID_ROLES, VALID_NEGOTIABILITY } from './ContextDslSchema.js'
import { ROLE_KPI_CATALOG, kpiEntryName } from './RoleKpiCatalog.js'

/** Actor roles — the schema enum itself (same array reference). */
export const ROLES = VALID_ROLES

/** Requirement negotiability — the schema enum itself (same array reference). */
export const NEGOTIABILITY = VALID_NEGOTIABILITY

/**
 * Criterion comparison operators — exactly the set AdmissiblePromotion's
 * `makePredicate` can invert/evaluate (an op outside this list would silently
 * never promote).
 */
export const CRITERION_OPS = ['>=', '<=', '>', '<', '==']

/**
 * Engineering disciplines offered by actor forms. The KPI catalog's keys are
 * the authoritative core (they carry R8 obligations); curated extras follow.
 */
export const DISCIPLINES = Object.freeze([
  ...Object.keys(ROLE_KPI_CATALOG),
  'sw',
  'plan',
])

/** Units the KPI expression assets declare (deduped, catalog order). */
const catalogUnits = []
for (const entries of Object.values(ROLE_KPI_CATALOG)) {
  for (const entry of entries) {
    const unit = typeof entry === 'object' ? entry?.unit : null
    if (unit && kpiEntryName(entry) && !catalogUnits.includes(unit)) catalogUnits.push(unit)
  }
}

/**
 * Unit suggestions for variable/KPI unit fields: catalog-declared units first,
 * then curated geometry/time extras common in cell layouts.
 */
export const UNITS = Object.freeze([
  ...catalogUnits,
  ...['mm', 'm', 'deg', 'rad', 's', 'ratio', 'px', 'kg'].filter(u => !catalogUnits.includes(u)),
])
