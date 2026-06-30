/**
 * SeedAnchor — pure lookup over a read-only seed document (ADR-058 Phase 1,
 * "fork & tweak" authoring).
 *
 * When the user forks an example ("Use this example as a starting point"), the
 * original example doc is kept as a *read-only seed* (a mirror of the example
 * file, NOT a second source of truth — the working doc stays owned by
 * ContextService, §1.1 / PHILOSOPHY #1). This module indexes that seed by entity
 * kind + ref so the intake forms can surface the filled example values as faint
 * anchors the user copies and overrides ("類推オーサリング").
 *
 * Pure: no THREE, no DOM, no I/O, input-immutable (never mutates the seed) —
 * loads under bare `node --test` (PHILOSOPHY #3 / #6).
 */

/** Entity kinds the seed exposes, mapped to their doc array. */
const KIND_ARRAYS = {
  actor:       'actors',
  variable:    'variables',
  requirement: 'requirements',
  fact:        'given',
}

/**
 * @typedef {Object} SeedIndex
 * @property {object[]} actors
 * @property {object[]} variables
 * @property {object[]} requirements
 * @property {object[]} facts
 * @property {Object<string, Object<string, object>>} byRef
 *           — `byRef[kind][ref]` → the seed entry (kind ∈ actor|variable|requirement|fact)
 */

/**
 * Index a seed document by entity kind + ref.
 *
 * @param {object|null|undefined} seedDoc
 * @returns {SeedIndex} an index with empty arrays/maps when there is no seed
 */
export function buildSeedIndex(seedDoc) {
  /** @type {SeedIndex} */
  const index = {
    actors:       [],
    variables:    [],
    requirements: [],
    facts:        [],
    byRef:        { actor: {}, variable: {}, requirement: {}, fact: {} },
  }
  if (!seedDoc || typeof seedDoc !== 'object') return index

  const targetKey = { actor: 'actors', variable: 'variables', requirement: 'requirements', fact: 'facts' }
  for (const [kind, arrKey] of Object.entries(KIND_ARRAYS)) {
    const entries = Array.isArray(seedDoc[arrKey]) ? seedDoc[arrKey] : []
    for (const entry of entries) {
      if (!entry || typeof entry.ref !== 'string') continue
      index[targetKey[kind]].push(entry)
      // Last ref wins — matches the doc's own later-overrides-earlier convention.
      index.byRef[kind][entry.ref] = entry
    }
  }
  return index
}

/**
 * Look up a single seed entry by kind + ref.
 *
 * @param {SeedIndex} index
 * @param {'actor'|'variable'|'requirement'|'fact'} kind
 * @param {string} ref
 * @returns {object|null} the seed entry, or null when absent (no fabricated anchor — PHILOSOPHY #11)
 */
export function seedEntry(index, kind, ref) {
  if (!index || !index.byRef || !index.byRef[kind]) return null
  return index.byRef[kind][ref] ?? null
}

/** True when the seed has at least one indexed entry of any kind. */
export function seedIsEmpty(index) {
  return !index ||
    (index.actors.length === 0 && index.variables.length === 0 &&
     index.requirements.length === 0 && index.facts.length === 0)
}

/**
 * One-line human description of a seed requirement (chip label / tooltip): the
 * KPI criterion and admissible interval, formatted from the entry's own fields.
 *
 * @param {object} req — a seed requirement entry
 * @returns {string}
 */
export function describeSeedRequirement(req) {
  if (!req || typeof req !== 'object') return ''
  const parts = []
  const kpi = req.kpi?.name ?? req.kpi?.expr
  if (kpi && req.criterion) {
    parts.push(`${kpi} ${req.criterion.op ?? ''} ${req.criterion.value ?? ''}`.trim())
  } else if (kpi) {
    parts.push(String(kpi))
  }
  const interval = req.admissible?.interval
  if (Array.isArray(interval) && interval.length === 2) {
    parts.push(`[${interval[0]}, ${interval[1]}]`)
  }
  return parts.join(' · ')
}

/**
 * One-line human description of a seed actor (chip label / tooltip): role and
 * discipline, formatted from the entry's own fields (ADR-058 Phase 2).
 *
 * @param {object} actor — a seed actor entry
 * @returns {string}
 */
export function describeSeedActor(actor) {
  if (!actor || typeof actor !== 'object') return ''
  const parts = []
  if (actor.role) parts.push(String(actor.role))
  if (actor.discipline) parts.push(String(actor.discipline))
  return parts.join(' · ')
}

/**
 * One-line human description of a seed variable (chip label / tooltip): the
 * domain interval and unit, formatted from the entry's own fields (ADR-058 Phase 2).
 *
 * @param {object} v — a seed variable entry
 * @returns {string}
 */
export function describeSeedVariable(v) {
  if (!v || typeof v !== 'object') return ''
  const parts = []
  const domain = v.domain
  if (Array.isArray(domain) && domain.length === 2) {
    parts.push(`[${domain[0]}, ${domain[1]}]`)
  }
  if (v.unit) parts.push(String(v.unit))
  return parts.join(' ')
}
