/**
 * ContextValidator — validate a Context DSL object and *generate* OpenQuestions.
 *
 * Pure computation: no I/O, no Three.js, no DOM.
 *
 * The key design point (ADR-046 §4): OpenQuestions are not authored by humans.
 * They are emitted mechanically by these rules, so that requirement/spec gap
 * detection no longer depends on who happened to attend the review.
 *
 * Rules implemented (MVP):
 *   R1 unknown-attr        — Fact.attrs value === "unknown"        → OpenQuestion
 *   R2 dangling-trace      — trace.from must reference an existing
 *                            fact / intent / obligation / decision  → error
 *   R3 orphan-spec         — every spec entity and constraint must
 *                            appear as trace.to                     → error
 *   R4 unassigned-scope    — Obligation.responsible === "unassigned"→ OpenQuestion
 *   R5 blocked-acceptance  — acceptance.requires resolves to an
 *                            unknown attr or assumed/unknown fact   → blockedChecks
 *
 * @module context/ContextValidator
 */

import {
  CONTEXT_DSL_VERSION,
  VALID_FACT_STATUS,
  BLOCKING_FACT_STATUS,
  VALID_CHECK_MODES,
  VALID_TRACE_KINDS,
  UNKNOWN,
  UNASSIGNED,
} from './ContextDslSchema.js'

/**
 * @param {object} ctx — Context DSL object
 * @returns {{ valid: boolean, errors: string[], openQuestions: object[], blockedChecks: object[] }}
 */
export function validateContext(ctx) {
  const errors        = []
  const openQuestions = []
  const blockedChecks = []

  if (!ctx || typeof ctx !== 'object') {
    return { valid: false, errors: ['Context DSL must be a non-null object'], openQuestions, blockedChecks }
  }

  if (ctx.version !== CONTEXT_DSL_VERSION) {
    errors.push(`version must be "${CONTEXT_DSL_VERSION}", got "${ctx.version}"`)
  }

  const facts       = new Map((ctx.given       ?? []).map(f => [f.ref, f]))
  const intents     = new Map((ctx.intents     ?? []).map(g => [g.ref, g]))
  const obligations = new Map((ctx.obligations ?? []).map(o => [o.ref, o]))
  const decisions   = new Map((ctx.decisions   ?? []).map(d => [d.ref, d]))

  // ── R0: basic fact shape ────────────────────────────────────────────────────
  for (const fact of facts.values()) {
    if (!VALID_FACT_STATUS.includes(fact.status)) {
      errors.push(`given "${fact.ref}": status "${fact.status}" is not valid. Use one of: ${VALID_FACT_STATUS.join(', ')}`)
    }
  }

  // ── R1: unknown attributes → OpenQuestion ───────────────────────────────────
  for (const fact of facts.values()) {
    for (const [key, value] of Object.entries(fact.attrs ?? {})) {
      if (value === UNKNOWN) {
        openQuestions.push({
          ref:        `oq_unknown_${fact.ref}_${key}`,
          raisedBy:   'R1:unknown-attr',
          about:      `${fact.ref}.attrs.${key}`,
          summary:    `「${fact.subject}」の ${key} が未確認 (status: ${fact.status})`,
        })
      }
    }
  }

  // ── R4: unassigned obligations → OpenQuestion ───────────────────────────────
  for (const obligation of obligations.values()) {
    if (obligation.responsible === UNASSIGNED) {
      openQuestions.push({
        ref:      `oq_scope_${obligation.ref}`,
        raisedBy: 'R4:unassigned-scope',
        about:    obligation.ref,
        summary:  `「${obligation.deliverable}」の責任区分が未合意 — 請求確定をブロックする`,
      })
    }
  }

  // ── Specification + trace ────────────────────────────────────────────────────
  const spec  = ctx.specification ?? {}
  const trace = spec.trace ?? []

  const requirementRefs = new Set([
    ...facts.keys(), ...intents.keys(), ...obligations.keys(), ...decisions.keys(),
  ])

  // R2: dangling trace sources
  for (const [i, link] of trace.entries()) {
    if (!requirementRefs.has(link.from)) {
      errors.push(`trace[${i}].from "${link.from}" does not reference any given / intent / obligation / decision`)
    }
    if (!VALID_TRACE_KINDS.includes(link.kind)) {
      errors.push(`trace[${i}].kind "${link.kind}" is not valid. Use one of: ${VALID_TRACE_KINDS.join(', ')}`)
    }
  }

  // R3: orphan spec — every entity and constraint must be a trace target
  const tracedTargets = new Set(trace.map(link => link.to))
  const layout        = spec.layout

  if (layout && typeof layout === 'object') {
    for (const entity of layout.entities ?? []) {
      if (!tracedTargets.has(entity.ref)) {
        errors.push(`orphan spec: entity "${entity.ref}" has no TraceLink — 誰も頼んでいない仕様 (ADR-046 invariant 1)`)
      }
    }
    for (const c of layout.constraints ?? []) {
      const cRef = constraintRef(c)
      if (!tracedTargets.has(cRef)) {
        errors.push(`orphan spec: constraint "${cRef}" has no TraceLink (ADR-046 invariant 1)`)
      }
    }
  } else {
    errors.push('specification.layout must be an object (layout/1.0 shape, $fact/$decision/$expr refs allowed)')
  }

  // ── R5: blocked acceptance checks ────────────────────────────────────────────
  for (const check of ctx.acceptance ?? []) {
    if (!VALID_CHECK_MODES.includes(check.mode)) {
      errors.push(`acceptance "${check.ref}": mode "${check.mode}" is not valid. Use one of: ${VALID_CHECK_MODES.join(', ')}`)
    }

    const blockedBy = []
    for (const path of check.requires ?? []) {
      const [factRef, ...rest] = path.split('.')
      const fact = facts.get(factRef)

      if (!fact) {
        errors.push(`acceptance "${check.ref}": requires "${path}" — fact "${factRef}" not found`)
        continue
      }
      if (BLOCKING_FACT_STATUS.includes(fact.status)) {
        blockedBy.push(`oq_status_${factRef}`)   // assumed/unknown fact (invariant 3)
      }
      const leaf = rest.length ? navigate(fact, rest) : undefined
      if (leaf === UNKNOWN) {
        blockedBy.push(`oq_unknown_${factRef}_${rest[rest.length - 1]}`)
      }
    }

    if (blockedBy.length > 0) {
      blockedChecks.push({ check: check.ref, blockedBy })
    }
  }

  return { valid: errors.length === 0, errors, openQuestions, blockedChecks }
}

/** Canonical ref form for a constraint, e.g. "constraint:robot_base→robot_mount". */
export function constraintRef(c) {
  return `constraint:${c.source}→${c.target}`
}

/** Navigate an object along a path segment array; undefined if missing. */
export function navigate(obj, segments) {
  let node = obj
  for (const seg of segments) {
    if (node == null || typeof node !== 'object') return undefined
    node = node[seg]
  }
  return node
}
