/**
 * DocBuilder — pure functions for constructing Context DSL documents (ADR-051 Phase 1).
 *
 * All functions are input-immutable: they deep-clone the input doc and return a
 * new one, never mutating the source (PHILOSOPHY #6). No I/O, no THREE/DOM —
 * load under bare `node --test` (PHILOSOPHY #3).
 *
 * All entry-point functions follow the same pattern as FormApplication:
 *   fn(doc, entry) → newDoc   (returns new doc, never mutates)
 */
import { CONTEXT_DSL_VERSION } from './ContextDslSchema.js'

/**
 * Create a minimal valid blank context document.
 *
 * The blank doc has no `specification.layout` — the service adopts it via
 * `adoptDoc()` which clears the scene without a compile/layout step.
 * All arrays are empty; the validator emits OpenQuestions as actors / variables /
 * requirements are added through the intake UI (ADR-051 §3 Entry A).
 *
 * @param {string} [name]
 * @returns {object} canonical Context DSL doc (context/0.3)
 */
export function createBlankDoc(name = '新しいプロジェクト') {
  return {
    version:      CONTEXT_DSL_VERSION,
    meta:         { name, baseline: null },
    actors:       [],
    sources:      [],
    given:        [],
    variables:    [],
    requirements: [],
    obligations:  [],
    decisions:    [],
  }
}

/**
 * Add an actor to the doc (input-immutable).
 *
 * @param {object} doc
 * @param {{ ref: string, role: string, discipline?: string }} actor
 * @returns {object} new doc
 */
export function addActor(doc, actor) {
  const clone = _clone(doc)
  clone.actors = [...(clone.actors ?? []), actor]
  return clone
}

/**
 * Add a given fact to the doc (input-immutable).
 *
 * @param {object} doc
 * @param {{ ref: string, subject: string, attrs: object, status: string, evidence?: string[], note?: string }} fact
 * @returns {object} new doc
 */
export function addFact(doc, fact) {
  const clone = _clone(doc)
  clone.given = [...(clone.given ?? []), fact]
  return clone
}

/**
 * Add a shared design variable to the doc (input-immutable).
 *
 * @param {object} doc
 * @param {{ ref: string, unit: string, domain: [number, number], description?: string }} variable
 * @returns {object} new doc
 */
export function addVariable(doc, variable) {
  const clone = _clone(doc)
  clone.variables = [...(clone.variables ?? []), variable]
  return clone
}

/**
 * Add a requirement to the doc (input-immutable).
 * Admissible interval `[lo, hi)` is `stated`; the validator promotes it to
 * `derived` once the KPI backing is satisfiable (ADR-049 §2.2 / R9).
 *
 * @param {object} doc
 * @param {{ ref: string, by: string, kpi: {name:string,expr:string,unit:string}, criterion: {op:string,value:number}, constrains: string[], negotiability: string, admissible: {interval:[number,number],source:'stated'}, evidence?: string[], note?: string }} requirement
 * @returns {object} new doc
 */
export function addRequirement(doc, requirement) {
  const clone = _clone(doc)
  clone.requirements = [...(clone.requirements ?? []), requirement]
  return clone
}

/** Deep clone via JSON round-trip (Context DSL docs are JSON-serializable). */
function _clone(doc) {
  return JSON.parse(JSON.stringify(doc))
}
