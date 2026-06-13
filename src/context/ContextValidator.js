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
 *                            fact / intent / obligation / decision
 *                            / requirement                          → error
 *   R3 orphan-spec         — every spec entity and constraint must
 *                            appear as trace.to                     → error
 *   R4 unassigned-scope    — Obligation.responsible === "unassigned"→ OpenQuestion
 *   R5 blocked-acceptance  — acceptance.requires resolves to an
 *                            unknown attr or assumed/unknown fact   → blockedChecks
 *
 * ADR-049 Phase 1 rules (context/0.2):
 *   R6 conflict            — requirements constraining the same shared
 *                            variable with disjoint admissible
 *                            intervals                              → conflicts
 *   R7 negotiation-cluster — alternating cycle in the Requirement–
 *                            Variable bipartite graph               → negotiationClusters
 *   R9 stated-without-kpi  — admissible.source === "stated" with no
 *                            (kpi, criterion) backing               → OpenQuestion
 *
 * ADR-049 Phase 2 rules:
 *   stated→derived promotion — a stated requirement carrying a closed-form
 *                            monotonic kpi is promoted to a derived interval
 *                            (AdmissiblePromotion) BEFORE R6/R7/R9 run
 *   R8 role-kpi-catalog    — an actor of a discipline whose catalog-mandatory
 *                            KPI is contributed by no requirement → OpenQuestion
 *
 * @module context/ContextValidator
 */

import {
  SUPPORTED_VERSIONS,
  VALID_FACT_STATUS,
  BLOCKING_FACT_STATUS,
  VALID_CHECK_MODES,
  VALID_TRACE_KINDS,
  VALID_NEGOTIABILITY,
  VALID_ADMISSIBLE_SOURCE,
  CONFLICT_REF_PREFIX,
  UNKNOWN,
  UNASSIGNED,
} from './ContextDslSchema.js'
import { detectConflicts, detectNegotiationClusters } from './RequirementGraph.js'
import { promoteAdmissible } from './AdmissiblePromotion.js'
import { requiredKpis } from './RoleKpiCatalog.js'

/**
 * @param {object} ctx — Context DSL object
 * @returns {{ valid: boolean, errors: string[], openQuestions: object[], blockedChecks: object[],
 *             conflicts: object[], negotiationClusters: object[], promoted: string[] }}
 */
export function validateContext(ctx) {
  const errors        = []
  const openQuestions = []
  const blockedChecks = []

  if (!ctx || typeof ctx !== 'object') {
    return { valid: false, errors: ['Context DSL must be a non-null object'], openQuestions, blockedChecks, conflicts: [], negotiationClusters: [], promoted: [] }
  }

  if (!SUPPORTED_VERSIONS.includes(ctx.version)) {
    errors.push(`version must be one of ${SUPPORTED_VERSIONS.map(v => `"${v}"`).join(', ')}, got "${ctx.version}"`)
  }

  const facts        = new Map((ctx.given        ?? []).map(f => [f.ref, f]))
  const intents      = new Map((ctx.intents      ?? []).map(g => [g.ref, g]))
  const obligations  = new Map((ctx.obligations  ?? []).map(o => [o.ref, o]))
  const decisions    = new Map((ctx.decisions    ?? []).map(d => [d.ref, d]))
  const variables    = new Map((ctx.variables    ?? []).map(v => [v.ref, v]))
  const requirements = new Map((ctx.requirements ?? []).map(r => [r.ref, r]))

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

  // ── R0': requirement / variable shape (ADR-049) ─────────────────────────────
  for (const req of requirements.values()) {
    for (const variable of req.constrains ?? []) {
      if (!variables.has(variable)) {
        errors.push(`requirement "${req.ref}": constrains "${variable}" does not reference any variable in variables[]`)
      }
    }
    if ((req.constrains ?? []).length === 0) {
      errors.push(`requirement "${req.ref}": constrains must list at least one shared variable`)
    }
    if (req.negotiability !== undefined && !VALID_NEGOTIABILITY.includes(req.negotiability)) {
      errors.push(`requirement "${req.ref}": negotiability "${req.negotiability}" is not valid. Use one of: ${VALID_NEGOTIABILITY.join(', ')}`)
    }
    const admissible = req.admissible
    if (admissible !== undefined) {
      if (!VALID_ADMISSIBLE_SOURCE.includes(admissible.source)) {
        errors.push(`requirement "${req.ref}": admissible.source "${admissible.source}" is not valid. Use one of: ${VALID_ADMISSIBLE_SOURCE.join(', ')}`)
      }
      const interval = admissible.interval
      if (interval !== undefined
        && (!Array.isArray(interval) || interval.length !== 2
            || typeof interval[0] !== 'number' || typeof interval[1] !== 'number'
            || interval[0] >= interval[1])) {
        errors.push(`requirement "${req.ref}": admissible.interval must be [min, max] with min < max`)
      }
    }
  }

  // ── stated → derived auto-promotion (ADR-049 Phase 2) ───────────────────────
  // R0' validated the human-authored requirements above. Now promote every
  // promotable `stated` requirement to a `derived` interval (closed-form
  // monotonic KPI inverted over the variable's domain). R9/R6/R7 and the
  // Decision checks run on the promoted set so the canonical region governs
  // both the open-question and the conflict outputs. promoteAdmissible returns
  // a new Map and never mutates the input (PHILOSOPHY #6).
  const { requirements: liveRequirements, promoted } = promoteAdmissible(requirements, variables, facts)

  // ── R9: stated admissible region without KPI backing → OpenQuestion ─────────
  // ADR-049 invariant 6: the canonical admissible region is derived from
  // (kpi, criterion). A stated region (form answer or 3D sketch) is accepted
  // provisionally, but the criterion behind it must be asked for — otherwise
  // a later relaxation cannot be quantified.
  for (const req of liveRequirements.values()) {
    if (req.admissible?.source === 'stated' && (!req.kpi || !req.criterion)) {
      openQuestions.push({
        ref:      `oq_kpi_${req.ref}`,
        raisedBy: 'R9:stated-without-kpi',
        about:    req.ref,
        summary:  `要求「${req.ref}」(${req.by}) の許容領域は stated のまま — 根拠となる KPI とクライテリアが未取得。緩和交渉時に定量比較できない`,
      })
    }
  }

  // ── R8: role-KPI catalog (ADR-049 Phase 2) ──────────────────────────────────
  // For each engineering discipline present among the actors, every KPI the
  // versioned catalog marks mandatory for that discipline must be contributed by
  // some requirement authored by an actor of that discipline. A gap surfaces as
  // an OpenQuestion — "did the right expert get asked?" becomes a reviewable
  // asset rather than depending on who attended the kick-off (ADR-049 §5.1).
  const catalog          = ctx.kpiCatalog
  const actors           = ctx.actors ?? []
  const disciplineByActor = new Map(actors.map(a => [a.ref, a.discipline]))
  const disciplines       = [...new Set(actors.map(a => a.discipline).filter(Boolean))].sort()
  for (const discipline of disciplines) {
    const contributed = new Set()
    for (const req of liveRequirements.values()) {
      if (disciplineByActor.get(req.by) === discipline && req.kpi?.name) contributed.add(req.kpi.name)
    }
    for (const kpiName of requiredKpis(discipline, catalog)) {
      if (!contributed.has(kpiName)) {
        openQuestions.push({
          ref:      `oq_rolekpi_${discipline}_${kpiName}`,
          raisedBy: 'R8:role-kpi-catalog',
          about:    discipline,
          summary:  `${discipline} 分野の必須 KPI「${kpiName}」を制約する要求がない — カタログ必須項目が未充足 (ADR-049 R8)`,
        })
      }
    }
  }

  // ── R6: conflicts / R7: negotiation clusters (computed, never authored) ─────
  const conflicts           = detectConflicts(liveRequirements)
  const negotiationClusters = detectNegotiationClusters(liveRequirements)
  const conflictByRef       = new Map(conflicts.map(c => [c.ref, c]))

  // ── Decision extensions (ADR-049): resolves conflict | Variable[], relaxes ──
  for (const decision of decisions.values()) {
    const resolves = decision.resolves

    if (Array.isArray(resolves)) {
      // n-ary joint decision over shared variables (invariant 8)
      for (const ref of resolves) {
        if (!variables.has(ref)) {
          errors.push(`decision "${decision.ref}": resolves "${ref}" does not reference any variable in variables[]`)
        }
        if (decision.nominals?.[ref] === undefined) {
          errors.push(`decision "${decision.ref}": nominals is missing an entry for "${ref}" — n-ary Decision は全変数の公称値を同時に持つ (ADR-049 invariant 8)`)
        }
      }
      // a joint decision covering all of a cluster's variables resolves it
      for (const cluster of negotiationClusters) {
        if (cluster.variables.every(v => resolves.includes(v))) {
          cluster.resolvedBy = decision.ref
        }
      }
    } else if (typeof resolves === 'string' && resolves.startsWith(CONFLICT_REF_PREFIX)) {
      const conflict = conflictByRef.get(resolves)
      if (!conflict) {
        errors.push(`decision "${decision.ref}": resolves "${resolves}" — この Conflict は現在のグラフから R6 が生成しない。吐かれていない衝突は解消できない (ADR-049 invariant 7)`)
      } else {
        conflict.resolvedBy = decision.ref
      }
    } else if (typeof resolves === 'string') {
      if (!facts.has(resolves) && !variables.has(resolves)) {
        errors.push(`decision "${decision.ref}": resolves "${resolves}" does not reference any fact, variable, or conflict`)
      }
    } else {
      errors.push(`decision "${decision.ref}": resolves must be a fact ref, a conflict ref, or an array of variable refs`)
    }

    if (decision.relaxes !== undefined && !liveRequirements.has(decision.relaxes.requirement)) {
      errors.push(`decision "${decision.ref}": relaxes.requirement "${decision.relaxes?.requirement}" does not reference any requirement in requirements[]`)
    }
  }

  // ── Specification + trace ────────────────────────────────────────────────────
  const spec  = ctx.specification ?? {}
  const trace = spec.trace ?? []

  const requirementRefs = new Set([
    ...facts.keys(), ...intents.keys(), ...obligations.keys(), ...decisions.keys(),
    ...requirements.keys(),
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

  return { valid: errors.length === 0, errors, openQuestions, blockedChecks, conflicts, negotiationClusters, promoted }
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
