/**
 * IntakeAssist — pure helpers behind the playful intake surface (ADR-058
 * "UX 具体化 — 遊びの入力面・堅い検証境界").
 *
 * Everything here is client-side derivation over form state, the working doc's
 * ref lists, and the read-only seed (SeedAnchor). Nothing writes the doc — the
 * commit boundary stays the single `onAddDocEntry` command path (ADR-058 §B-3).
 *
 * Rigor rule (§B-2): field-level live checks call THE SAME predicates the
 * validator applies at commit. `isInterval` is imported from ContextValidator
 * (same function reference), never re-implemented — a looser UI copy would
 * create the "passes the form, fails the commit" divergence (§1.1).
 *
 * Pure: no THREE, no DOM, no I/O, input-immutable — loads under bare
 * `node --test` (PHILOSOPHY #3 / #6).
 */
import { isInterval } from './ContextValidator.js'
import { ROLE_KPI_CATALOG, kpiEntryName } from './RoleKpiCatalog.js'

export { isInterval } // re-exported so consumers see one import surface

// ── A-3: ref naming — live uniqueness + free-number suggestion ────────────────

/**
 * Live availability of a ref against the refs already in the working doc.
 * Purely informative — never blocks input (the playful side stays low-friction;
 * the commit boundary is what enforces).
 *
 * @param {string[]} existingRefs
 * @param {string} ref — raw input value (trimmed here)
 * @returns {'empty'|'free'|'taken'}
 */
export function refStatus(existingRefs, ref) {
  const r = (ref ?? '').trim()
  if (!r) return 'empty'
  return (existingRefs ?? []).includes(r) ? 'taken' : 'free'
}

/**
 * Suggest the first free numbered variant of a base ref (`r_reach` →
 * `r_reach_2` when taken). A trailing `_copy` or `_<n>` suffix on the base is
 * treated as the seed-copy scar and stripped before numbering, so suggestions
 * stay readable instead of stacking (`r_reach_copy_2_3`).
 *
 * @param {string[]} existingRefs
 * @param {string} base
 * @returns {string} a ref not present in existingRefs ('' for an empty base)
 */
export function suggestRef(existingRefs, base) {
  const stem = (base ?? '').trim().replace(/_(?:copy|\d+)$/, '')
  if (!stem) return ''
  const taken = new Set(existingRefs ?? [])
  if (!taken.has(stem)) return stem
  for (let n = 2; n < 1000; n++) {
    const candidate = `${stem}_${n}`
    if (!taken.has(candidate)) return candidate
  }
  return `${stem}_${Date.now()}` // pathological doc; still deterministic enough
}

// ── A-2: seed-diff tint — "is this field still the example's value?" ──────────

/**
 * True when a form field still holds the seed example's value (normalized
 * string comparison, since form state is strings while seed values may be
 * numbers). Drives the dashed-underline tint that disappears the moment the
 * user overrides the anchor — visible progress of "making the example yours".
 *
 * A null/undefined seed value never matches (no fabricated anchor —
 * PHILOSOPHY #11).
 *
 * @param {*} seedValue — value from the seed entry (string | number | null)
 * @param {string} currentValue — current form field state
 * @returns {boolean}
 */
export function matchesSeed(seedValue, currentValue) {
  if (seedValue === null || seedValue === undefined) return false
  return String(seedValue) === String(currentValue ?? '').trim()
}

// ── B-1: no silent disabled — missing-reason derivation ──────────────────────
// Each `*Gaps` function is THE submit predicate for its form: the button is
// disabled iff the list is non-empty, and the same list is what the caption
// prints. One predicate, two projections — never two implementations.

/**
 * @param {{ ref: string }} form — actor form state
 * @returns {string[]} human-readable reasons; empty ⇔ submittable
 */
export function actorGaps(form) {
  const gaps = []
  if (!(form.ref ?? '').trim()) gaps.push('ref is empty')
  return gaps
}

/**
 * @param {{ ref: string, unit: string, lo: string, hi: string }} form
 * @returns {string[]} human-readable reasons; empty ⇔ submittable
 */
export function variableGaps(form) {
  const gaps = []
  if (!(form.ref ?? '').trim())  gaps.push('ref is empty')
  if (!(form.unit ?? '').trim()) gaps.push('unit is empty')
  const lo = parseFloat(form.lo), hi = parseFloat(form.hi)
  if (isNaN(lo) || isNaN(hi)) {
    gaps.push('domain lo / hi must be numbers')
  } else if (!isInterval([lo, hi])) {
    gaps.push('domain hi must be greater than lo')
  }
  return gaps
}

/**
 * @param {{ ref: string, by: string, kpiName: string, kpiExpr?: string,
 *           constrains: string, val: string, admLo: string, admHi: string }} form
 * @returns {string[]} human-readable reasons; empty ⇔ submittable
 */
export function requirementGaps(form) {
  const gaps = []
  if (!(form.ref ?? '').trim())        gaps.push('ref is empty')
  if (!(form.by ?? '').trim())         gaps.push('by (actor) is not selected')
  if (!(form.kpiName ?? '').trim())    gaps.push('KPI name is empty')
  // ADR-063 Phase 1: an expression asset instantiated without its variable (or
  // with an unfilled param) keeps its `{…}` placeholder — committing it would
  // silently produce a never-promotable expr, so the gap names it instead (#11).
  if (/\{[^}]*\}/.test(form.kpiExpr ?? '')) {
    gaps.push('KPI expr still has a {…} placeholder — pick a variable / fill the parameter')
  }
  if (!(form.constrains ?? '').trim()) gaps.push('constrains (variable) is not selected')
  if (isNaN(parseFloat(form.val)))     gaps.push('threshold must be a number')
  const lo = parseFloat(form.admLo), hi = parseFloat(form.admHi)
  if (isNaN(lo) || isNaN(hi)) {
    gaps.push('admissible lo / hi must be numbers')
  } else if (!isInterval([lo, hi])) {
    gaps.push('admissible hi must be greater than lo')
  }
  return gaps
}

// ── A-6: KPI catalog chips (RoleKpiCatalog is the source of truth) ────────────

/**
 * Flatten the KPI catalog into discipline-grouped chips for the requirement
 * form. Read-only projection: the catalog stays the single source (§1.1).
 * A `role-kpi/2.0` expression asset flows through whole (name, unit,
 * exprTemplate, params, suggestedOp, description — ADR-063 Phase 1: the chip
 * fills a ready expression the user only parameterises); a legacy 1.0 name
 * string yields a name-only chip — nothing is fabricated for it (#11).
 *
 * @param {Record<string, (string|object)[]>} [catalog]
 * @returns {{ discipline: string, name: string }[]} stable order; 2.0 entries
 *          additionally carry the asset fields
 */
export function kpiCatalogChips(catalog = ROLE_KPI_CATALOG) {
  const chips = []
  for (const discipline of Object.keys(catalog ?? {})) {
    for (const entry of catalog[discipline] ?? []) {
      const name = kpiEntryName(entry)
      if (name === null) continue
      chips.push(typeof entry === 'string' ? { discipline, name } : { discipline, ...entry })
    }
  }
  return chips
}

/**
 * Flatten one KPI expression asset into label/value lines for the chip's hover
 * mini-card (ADR-063 Phase 1) — the user browses what an asset fills and which
 * parameters stay theirs to tweak BEFORE picking. Only fields the asset has are
 * listed (a 1.0 name-only chip gets no fabricated lines — PHILOSOPHY #11).
 *
 * @param {object} chip — a kpiCatalogChips() entry
 * @returns {{ label: string, value: string }[]}
 */
export function kpiCardLines(chip) {
  if (!chip || typeof chip !== 'object') return []
  const lines = []
  const push = (label, value) => {
    if (value !== null && value !== undefined && value !== '') {
      lines.push({ label, value: String(value) })
    }
  }
  push('unit', chip.unit)
  push('expr', chip.exprTemplate)
  for (const p of chip.params ?? []) {
    if (p?.key) push(`tweak · ${p.key}`, p.label ? `${p.label}${p.example !== undefined ? ` (e.g. ${p.example})` : ''}` : p.example)
  }
  push('suggested op', chip.suggestedOp)
  push('about', chip.description)
  return lines
}

// ── A-1: seed chip hover mini-card ────────────────────────────────────────────

/**
 * Flatten one seed entry into label/value lines for the hover mini-card, so
 * the user can browse example entries before picking one. Only fields the
 * entry actually has are listed (no fabricated anchors — PHILOSOPHY #11).
 *
 * @param {'actor'|'variable'|'requirement'} kind
 * @param {object} entry — a seed entry of that kind
 * @returns {{ label: string, value: string }[]}
 */
export function seedCardLines(kind, entry) {
  if (!entry || typeof entry !== 'object') return []
  const lines = []
  const push = (label, value) => {
    if (value !== null && value !== undefined && value !== '') {
      lines.push({ label, value: String(value) })
    }
  }
  push('ref', entry.ref)
  if (kind === 'actor') {
    push('role', entry.role)
    push('discipline', entry.discipline)
  } else if (kind === 'variable') {
    push('unit', entry.unit)
    if (isInterval(entry.domain)) push('domain', `[${entry.domain[0]}, ${entry.domain[1]}]`)
    push('description', entry.description)
  } else if (kind === 'requirement') {
    push('by', entry.by)
    push('KPI', entry.kpi?.name)
    push('expr', entry.kpi?.expr)
    push('unit', entry.kpi?.unit)
    if (entry.criterion) push('criterion', `${entry.criterion.op ?? ''} ${entry.criterion.value ?? ''}`.trim())
    if (Array.isArray(entry.constrains)) push('constrains', entry.constrains.join(', '))
    push('negotiability', entry.negotiability)
    const iv = entry.admissible?.interval
    if (isInterval(iv)) push('admissible', `[${iv[0]}, ${iv[1]}]`)
  }
  return lines
}
