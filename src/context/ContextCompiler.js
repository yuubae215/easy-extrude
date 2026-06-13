/**
 * ContextCompiler — compile a Context DSL object into a concrete Layout DSL (layout/1.0).
 *
 * Pure computation: no I/O, no Three.js, no DOM. (PHILOSOPHY #3)
 *
 * Two-stage compile chain (ADR-046 §6):
 *
 *   compileContext(ctx) → { layoutDsl, openQuestions, blockedChecks, trace }
 *   compileLayout(layoutDsl) → SceneSerializer v1.3 JSON   (existing, ADR-045)
 *
 * Reference markers allowed inside specification.layout:
 *
 *   { "$fact":     "f_bench.attrs.height.value" }  → scalar from a Given fact
 *   { "$decision": "d_bench_distance" }            → decision.nominal, verbatim
 *   { "$expr":     "f_bench.attrs.height.value / 2" } → safe arithmetic (+ - * / parens)
 *
 * Resolution rules enforce the constitutional invariants:
 *   - "$fact" hitting the literal "unknown" → throw (確定前の値は仕様に流せない)
 *   - "$fact" hitting an interval object   → throw (interval は Decision 経由でのみ確定 — invariant 2)
 *
 * @module context/ContextCompiler
 */

import { UNKNOWN } from './ContextDslSchema.js'
import { validateContext, navigate, constraintRef } from './ContextValidator.js'

/**
 * @param {object} ctx — Context DSL object (context/0.1, 0.2, or 0.3)
 * @returns {{ layoutDsl: object, openQuestions: object[], blockedChecks: object[], trace: object[],
 *             provenance: object[], conflicts: object[], negotiationClusters: object[],
 *             promoted: string[], checkResults: object[] }}
 * @throws {Error} on validation failure or unresolvable references
 */
export function compileContext(ctx) {
  const result = validateContext(ctx)
  if (!result.valid) {
    throw new Error(`Context DSL validation failed:\n  - ${result.errors.join('\n  - ')}`)
  }

  const facts     = new Map((ctx.given     ?? []).map(f => [f.ref, f]))
  const decisions = new Map((ctx.decisions ?? []).map(d => [d.ref, d]))
  const resolver  = makeResolver(facts, decisions)

  const layoutDsl = resolveNode(ctx.specification.layout, resolver)

  return {
    layoutDsl,
    openQuestions:       result.openQuestions,
    blockedChecks:       result.blockedChecks,
    trace:               ctx.specification.trace ?? [],
    provenance:          extractProvenance(ctx),
    conflicts:           result.conflicts,
    negotiationClusters: result.negotiationClusters,
    promoted:            result.promoted,
    checkResults:        result.checkResults,
  }
}

// ── Provenance extraction ─────────────────────────────────────────────────────

/**
 * Read-only walk of specification.layout collecting one record per reference
 * marker, so downstream consumers (e.g. uncertainty visualization) know which
 * entity property came from which fact/decision/expression — and, for
 * decisions, what the unresolved source interval was.
 *
 * Resolution must already be possible (compileContext calls this only after
 * resolveNode succeeded); calling it standalone on an unresolvable context throws.
 *
 * Record shapes:
 *   { entityRef, path, marker: 'decision', ref, nominal, status, decidedBy,
 *     rationale, resolvesFact, interval, unit }
 *   { entityRef, path, marker: 'fact', ref, value }
 *   { entityRef, path, marker: 'expr', source, value }
 *
 * entityRef is the layout entity ref, or constraintRef(c) for constraints.
 * path is dot-joined relative to the entity ("position.x", "frames.0.translation.z").
 *
 * @param {object} ctx — Context DSL object (context/0.1)
 * @returns {object[]}
 */
export function extractProvenance(ctx) {
  const facts     = new Map((ctx.given     ?? []).map(f => [f.ref, f]))
  const decisions = new Map((ctx.decisions ?? []).map(d => [d.ref, d]))
  const resolver  = makeResolver(facts, decisions)
  const layout    = ctx.specification?.layout ?? {}
  const records   = []

  const walk = (node, entityRef, segs) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, entityRef, [...segs, String(i)]))
      return
    }
    if (node === null || typeof node !== 'object') return

    const keys = Object.keys(node)
    if (keys.length === 1 && (keys[0] === '$fact' || keys[0] === '$decision' || keys[0] === '$expr')) {
      const path = segs.join('.')
      if (keys[0] === '$decision') {
        const decision = decisions.get(node.$decision)
        const fact     = decision ? facts.get(decision.resolves) : undefined
        records.push({
          entityRef, path, marker: 'decision',
          ref:          node.$decision,
          nominal:      decision?.nominal,
          status:       decision?.status,
          decidedBy:    decision?.decidedBy,
          rationale:    decision?.rationale,
          resolvesFact: decision?.resolves,
          interval:     fact?.quantity?.interval ?? null,
          unit:         fact?.quantity?.unit     ?? null,
        })
      } else if (keys[0] === '$fact') {
        records.push({ entityRef, path, marker: 'fact', ref: node.$fact, value: resolver.fact(node.$fact) })
      } else {
        records.push({ entityRef, path, marker: 'expr', source: node.$expr, value: resolver.expr(node.$expr) })
      }
      return
    }

    for (const [key, value] of Object.entries(node)) walk(value, entityRef, [...segs, key])
  }

  for (const entity of layout.entities ?? []) walk(entity, entity.ref, [])
  for (const c of layout.constraints ?? []) walk(c, constraintRef(c), [])

  return records
}

// ── Reference resolution ──────────────────────────────────────────────────────

function makeResolver(facts, decisions) {
  return {
    fact(path) {
      const [factRef, ...rest] = path.split('.')
      const fact = facts.get(factRef)
      if (!fact) throw new Error(`$fact "${path}": fact "${factRef}" not found in given[]`)

      const value = rest.length ? navigate(fact, rest) : fact
      if (value === undefined) throw new Error(`$fact "${path}": path does not exist on fact "${factRef}"`)
      if (value === UNKNOWN) {
        throw new Error(`$fact "${path}" is "unknown" — 未確認の事実は仕様に流せない。先に確認するか Decision を記録すること`)
      }
      if (value !== null && typeof value === 'object' && 'interval' in value) {
        throw new Error(`$fact "${path}" is an interval — interval は $decision 経由でのみ確定できる (ADR-046 invariant 2)`)
      }
      if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'boolean') {
        throw new Error(`$fact "${path}" must resolve to a scalar, got ${typeof value}`)
      }
      return value
    },

    decision(ref) {
      const decision = decisions.get(ref)
      if (!decision) throw new Error(`$decision "${ref}" not found in decisions[]`)
      if (!('nominal' in decision)) throw new Error(`$decision "${ref}" has no nominal value`)
      return decision.nominal
    },

    expr(source) {
      return evaluateExpr(source, this)
    },
  }
}

/** Deep-walk a JSON node, substituting $fact / $decision / $expr markers. */
export function resolveNode(node, resolver) {
  if (Array.isArray(node)) return node.map(item => resolveNode(item, resolver))

  if (node !== null && typeof node === 'object') {
    const keys = Object.keys(node)
    if (keys.length === 1) {
      if (keys[0] === '$fact')     return resolver.fact(node.$fact)
      if (keys[0] === '$decision') return resolver.decision(node.$decision)
      if (keys[0] === '$expr')     return resolver.expr(node.$expr)
    }
    const out = {}
    for (const [key, value] of Object.entries(node)) out[key] = resolveNode(value, resolver)
    return out
  }

  return node
}

// ── Safe arithmetic expression evaluator (no eval) ────────────────────────────
//
// Grammar:  expr   := term (('+' | '-') term)*
//           term   := factor (('*' | '/') factor)*
//           factor := NUMBER | IDENT_PATH | '(' expr ')' | '-' factor
//
// IDENT_PATH (e.g. f_bench.attrs.height.value) resolves through resolver.fact().

function evaluateExpr(source, resolver) {
  const tokens = tokenize(source)
  let pos = 0

  const peek = () => tokens[pos]
  const next = () => tokens[pos++]

  function expr() {
    let value = term()
    while (peek() === '+' || peek() === '-') {
      const op = next()
      const rhs = term()
      value = op === '+' ? value + rhs : value - rhs
    }
    return value
  }

  function term() {
    let value = factor()
    while (peek() === '*' || peek() === '/') {
      const op = next()
      const rhs = factor()
      value = op === '*' ? value * rhs : value / rhs
    }
    return value
  }

  function factor() {
    const token = next()
    if (token === undefined) throw new Error(`$expr "${source}": unexpected end of expression`)
    if (token === '(') {
      const value = expr()
      if (next() !== ')') throw new Error(`$expr "${source}": missing ")"`)
      return value
    }
    if (token === '-') return -factor()
    if (typeof token === 'number') return token
    // identifier path → fact resolution (must be numeric)
    const value = resolver.fact(token)
    if (typeof value !== 'number') {
      throw new Error(`$expr "${source}": "${token}" resolved to non-number`)
    }
    return value
  }

  const value = expr()
  if (pos !== tokens.length) throw new Error(`$expr "${source}": unexpected token "${tokens[pos]}"`)
  return value
}

function tokenize(source) {
  const tokens = []
  const re = /\s*(\d+\.?\d*|[A-Za-z_][\w.]*|[+\-*/()])/y
  let lastIndex = 0
  while (lastIndex < source.length) {
    re.lastIndex = lastIndex
    const match = re.exec(source)
    if (!match) throw new Error(`$expr "${source}": invalid character at position ${lastIndex}`)
    const raw = match[1]
    tokens.push(/^\d/.test(raw) ? Number(raw) : raw)
    lastIndex = re.lastIndex
  }
  return tokens
}
