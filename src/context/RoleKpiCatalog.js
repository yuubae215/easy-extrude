/**
 * RoleKpiCatalog — versioned catalog of the KPIs each engineering discipline is
 * expected to contribute to a requirement context (ADR-049 Phase 2, R8), grown
 * into a catalog of **KPI expression assets** (ADR-063 Phase 1, `role-kpi/2.0`).
 *
 * Pure data + lookup helpers: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 *
 * Rationale (ADR-049 §5.1): "did the right expert get asked?" must not depend on
 * who happened to attend the kick-off. A discipline's mandatory KPIs are a
 * reviewable, version-controlled asset; a missing one surfaces as an OpenQuestion
 * (R8) and is fixed permanently by updating the catalog — the same operating loop
 * as CODE_CONTRACTS.
 *
 * ADR-063 Phase 1 (recognition over recall): a user facing the requirement form
 * cannot *recall* a KPI expression on the spot. Each catalog entry therefore
 * carries a curated, ready-to-use expression asset the user picks and then
 * tweaks parameters on — never authors from a blank field:
 *
 *   { name, unit, exprTemplate, params[], suggestedOp, description }
 *
 * `exprTemplate` uses `{var}` for the constrained variable and `{param}` for
 * each entry of `params[]` (curated example values — declared catalog data, not
 * client fabrication). `instantiateKpiExpr` substitutes what it can and leaves
 * unresolved placeholders verbatim so an incomplete instantiation stays visibly
 * incomplete (PHILOSOPHY #11 — the intake gap check names the leftover).
 *
 * Version discipline (§1.1 — one source): R8 keeps reading THIS catalog via
 * `requiredKpis`, which accepts both the 2.0 asset objects and the legacy 1.0
 * name arrays (a `ctx.kpiCatalog` override may still be 1.0-shaped) — additive,
 * never a second mandatory-KPI list.
 *
 * @module context/RoleKpiCatalog
 */

/** Catalog format version (diffed across baselines like the context DSL). */
export const ROLE_KPI_CATALOG_VERSION = 'role-kpi/2.0'

/**
 * Default catalog: discipline → mandatory KPI expression assets.
 * Keep the canonical robot-cell disciplines from ADR-049 §1; the asset NAMES
 * are exactly the 1.0 mandatory list (R8 semantics unchanged — every row here
 * is a mandatory expectation of its discipline, not a browsing library).
 *
 * exprTemplate forms are honest about promotability (ADR-049 Phase 2):
 * closed-form monotone templates (resolution, clearances) auto-promote the
 * stated interval to the derived canonical region; solver-function templates
 * (wrist_margin, motion_time) are opaque on purpose — they stay `stated` and
 * R9 keeps the criterion question open until a measurement bakes the fact.
 */
export const ROLE_KPI_CATALOG = {
  vision: [
    {
      name: 'resolution',
      unit: 'px/mm',
      exprTemplate: '{sensor_px} / {var}',
      params: [
        { key: 'sensor_px', label: 'sensor pixels (horizontal)', example: 3500 },
      ],
      suggestedOp: '>=',
      description:
        'Image pixels per mm on the target: sensor pixel count divided by the ' +
        'working-distance/FOV variable. Closed-form monotone — the admissible ' +
        'interval is auto-derived from the threshold.',
    },
  ],
  robot: [
    {
      name: 'singularityMargin',
      unit: 'deg',
      exprTemplate: 'wrist_margin({var})',
      params: [],
      suggestedOp: '>=',
      description:
        'Wrist-axis angular margin from the nearest singular pose, as a function ' +
        'of the constrained placement variable. Solver-owned function — the value ' +
        'is measured, not derived in closed form.',
    },
    {
      name: 'cycleTime',
      unit: 's',
      exprTemplate: 'motion_time({var})',
      params: [],
      suggestedOp: '<=',
      description:
        'One pick-place cycle duration as a function of the constrained placement ' +
        'variable. Solver-owned function — the value is measured, not derived in ' +
        'closed form.',
    },
  ],
  mech: [
    {
      name: 'installClearance',
      unit: 'mm',
      exprTemplate: '{var} - {occupied_mm}',
      params: [
        { key: 'occupied_mm', label: 'depth already occupied (mm)', example: 250 },
      ],
      suggestedOp: '>=',
      description:
        'Free installation clearance: the constrained envelope variable minus the ' +
        'depth already occupied by fixed equipment. Closed-form monotone.',
    },
  ],
  eoat: [
    {
      name: 'tcpClearance',
      unit: 'mm',
      exprTemplate: '{var} - {tool_radius_mm}',
      params: [
        { key: 'tool_radius_mm', label: 'tool radius (mm)', example: 45 },
      ],
      suggestedOp: '>=',
      description:
        'Clearance between the tool centre point envelope and the constrained ' +
        'standoff variable, minus the tool radius. Closed-form monotone.',
    },
  ],
}

/**
 * The KPI name of a catalog entry — a bare string under 1.0, an asset object
 * under 2.0. Anything else has no name (skipped by consumers, never fabricated).
 *
 * @param {string|{name?: string}} entry
 * @returns {string|null}
 */
export function kpiEntryName(entry) {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof entry.name === 'string') return entry.name
  return null
}

/**
 * Mandatory KPI names for a discipline. Unknown disciplines have no obligations
 * (the catalog is an allow-list of expectations, not a closed enum of roles).
 * Accepts both the 2.0 asset objects and legacy 1.0 name arrays — a
 * `ctx.kpiCatalog` override written against 1.0 keeps validating (additive).
 *
 * @param {string} discipline
 * @param {Record<string, (string|object)[]>} [catalog]
 * @returns {string[]}
 */
export function requiredKpis(discipline, catalog = ROLE_KPI_CATALOG) {
  return (catalog?.[discipline] ?? []).map(kpiEntryName).filter(n => n !== null)
}

/**
 * Instantiate an asset's `exprTemplate`: `{var}` becomes `varRef` (when given),
 * each `{param.key}` becomes the param's curated example value. Placeholders
 * that cannot be resolved are left verbatim — an incomplete expression must
 * stay visibly incomplete rather than silently guessing (PHILOSOPHY #11).
 *
 * @param {{ exprTemplate?: string, params?: {key: string, example?: *}[] }} asset
 * @param {string} [varRef] — the constrained variable's ref ('' leaves `{var}`)
 * @returns {string}
 */
export function instantiateKpiExpr(asset, varRef = '') {
  let expr = asset?.exprTemplate ?? ''
  if (varRef) expr = expr.split('{var}').join(varRef)
  for (const p of asset?.params ?? []) {
    if (p?.key && p.example !== undefined && p.example !== null) {
      expr = expr.split(`{${p.key}}`).join(String(p.example))
    }
  }
  return expr
}
