/**
 * CriteriaElicitation — the unheard census (ADR-165 力学 1, PR1).
 *
 * The census counts blanks in the fields that must exist (PHILOSOPHY #31),
 * so the fixtures below are built to make "count what is present" and
 * "count what is missing" disagree: an end user who never mentioned safety,
 * N=2 where only one person answered, and zero end users (not a vacuous 0).
 *
 * This file is the maturity PATH of the GSN goal
 * UnaskedCriteriaAreCountedUntilZero (docs/gsn/adr-165-…gsn).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { countUnheard, BLANK_FIELD } from './CriteriaElicitation.js'
import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS, criteriaElementOf, elementsOfCategory } from './CriteriaCatalog.js'
import { isEndUser, jobFunctionOf, endUsersOf } from './ActorStance.js'
import { validateContext } from './ContextValidator.js'
import { CONTEXT_DSL_VERSION } from './ContextDslSchema.js'

const PER_PERSON = CRITERIA_CATEGORIES.length + 2 * CRITERIA_ELEMENTS.length

const fullMix = () => ({ D: 3, Q: 2, C: 1, S: 4 })
const answer = (owner, e, extra = {}) => ({
  ref: `crit_${owner}_${e.key}`, by: owner, owner,
  kpi: { name: e.key, unit: e.unit }, criterion: { op: e.op, value: 1 }, weight: 1, ...extra,
})
const allAnswers = (owner, skip = () => false) =>
  CRITERIA_ELEMENTS.filter(e => !skip(e)).map(e => answer(owner, e))

const doc = (actors, requirements = []) => ({ version: CONTEXT_DSL_VERSION, actors, requirements })

// ── the population is the catalog ─────────────────────────────────────────────

test('every upper-tier category has at least one element — safety included', () => {
  for (const c of CRITERIA_CATEGORIES) {
    assert.ok(elementsOfCategory(c).length >= 1, `${c} に要素が無い — 聞かれない区分が生まれる`)
  }
  assert.deepEqual(CRITERIA_CATEGORIES, ['D', 'Q', 'C', 'S'])
})

test('element keys are unique and a requirement maps to its element by kpi.name only', () => {
  const keys = CRITERIA_ELEMENTS.map(e => e.key)
  assert.equal(new Set(keys).size, keys.length)
  assert.equal(criteriaElementOf({ kpi: { name: 'takt' } })?.category, 'D')
  assert.equal(criteriaElementOf({ kpi: { name: 'cycleTime' } }), null, '設計の要求は要素ではない')
  assert.equal(criteriaElementOf({}), null)
})

// ── zero end users is "not started", not a vacuous zero ──────────────────────

test('zero end users: the hearing has not started, and the validator says so', () => {
  const ctx = doc([{ ref: 'a', role: 'developer' }])
  const c = countUnheard(ctx)
  assert.equal(c.started, false)
  assert.equal(c.complete, false, '0 人で「聞き切った」にはならない')
  assert.equal(c.count, 0)
  const refs = validateContext(ctx).openQuestions.map(q => q.ref)
  assert.ok(refs.includes('oq_criteria_no_end_user'))
})

// ── 1 end user: safety unanswered does not reach 0 ───────────────────────────

test('an end user who answered everything but safety still has the safety blanks', () => {
  const u = { ref: 'u', role: 'maintainer', endUser: true, mix: fullMix() }
  const ctx = doc([u], allAnswers('u', e => e.category === 'S'))
  const c = countUnheard(ctx)
  const safety = elementsOfCategory('S').length
  assert.equal(c.count, 2 * safety, '安全の要素ごとに期待値と重みの 2 つ')
  assert.ok(c.blanks.every(b => b.category === 'S'))
  assert.equal(c.complete, false)
})

test('a fresh end user owns every blank in the catalog', () => {
  const c = countUnheard(doc([{ ref: 'u', role: 'ehs', endUser: true }]))
  assert.equal(c.count, PER_PERSON)
  assert.equal(c.blanks.filter(b => b.field === BLANK_FIELD.MIX).length, CRITERIA_CATEGORIES.length)
})

// ── N = 2: one person answering does not answer for the other ────────────────

test('N=2: one end user answering fully leaves the other one counted', () => {
  const a = { ref: 'a', role: 'maintainer', endUser: true, mix: fullMix() }
  const b = { ref: 'b', role: 'approver', endUser: true }
  const c = countUnheard(doc([a, b], allAnswers('a')))
  assert.equal(c.count, PER_PERSON)
  assert.ok(c.blanks.every(x => x.actor === 'b'))
  assert.equal(c.complete, false)
})

test('N=2: both answered → complete, and no R12 question remains', () => {
  const a = { ref: 'a', role: 'maintainer', endUser: true, mix: fullMix() }
  const b = { ref: 'b', role: 'approver', endUser: true, mix: fullMix() }
  const ctx = doc([a, b], [...allAnswers('a'), ...allAnswers('b')])
  const c = countUnheard(ctx)
  assert.equal(c.count, 0)
  assert.equal(c.complete, true)
  const result = validateContext(ctx)
  assert.deepEqual(result.openQuestions.filter(q => q.raisedBy.startsWith('R12') && q.raisedBy !== 'R12:unagreed-criteria'), [])
  // Heard in full is half the gate: the agreement is asked next (ADR-165 PR2).
  assert.ok(result.openQuestions.some(q => q.raisedBy === 'R12:unagreed-criteria'))
  // An expectation names no design variable (the mapping is core/'s) — R0'
  // must not demand `constrains` of it.
  assert.deepEqual(result.errors, [])
})

test('an answer belongs to its owner, not to whoever typed it', () => {
  const a = { ref: 'a', role: 'maintainer', endUser: true, mix: fullMix() }
  const b = { ref: 'b', role: 'approver', endUser: true, mix: fullMix() }
  // a typed b's answers but did not make b their owner
  const typedByA = allAnswers('b').map(r => ({ ...r, by: 'a', owner: 'a', ref: r.ref + '_x' }))
  const c = countUnheard(doc([a, b], [...allAnswers('a'), ...typedByA]))
  assert.ok(c.blanks.some(x => x.actor === 'b'), 'b の欄は埋まっていない')
  assert.ok(c.duplicates.some(d => d.actor === 'a'), 'a の欄が二重になった')
})

// ── a declared zero is an answer ─────────────────────────────────────────────

test('weight 0 and mix S = 0 are answers, not blanks', () => {
  const u = { ref: 'u', role: 'maintainer', endUser: true, mix: { D: 1, Q: 1, C: 1, S: 0 } }
  const reqs = allAnswers('u').map(r => ({ ...r, weight: 0 }))
  assert.equal(countUnheard(doc([u], reqs)).count, 0)
})

test('an all-zero mix is an error, not an answer the validator lets through', () => {
  const u = { ref: 'u', role: 'maintainer', endUser: true, mix: { D: 0, Q: 0, C: 0, S: 0 } }
  const { errors } = validateContext(doc([u]))
  assert.ok(errors.some(e => e.includes('every mix value is 0')))
})

test('a mix on a non-end-user is an error', () => {
  const { errors } = validateContext(doc([{ ref: 'a', role: 'developer', mix: fullMix() }]))
  assert.ok(errors.some(e => e.includes('asked of end users only')))
})

// ── duplicates are reported, never picked ────────────────────────────────────

test('two answers for one element are ambiguous: counted as blank and reported', () => {
  const u = { ref: 'u', role: 'maintainer', endUser: true, mix: fullMix() }
  const takt = CRITERIA_ELEMENTS.find(e => e.key === 'takt')
  const reqs = [...allAnswers('u'), answer('u', takt, { ref: 'crit_u_takt_2' })]
  const c = countUnheard(doc([u], reqs))
  assert.deepEqual(c.duplicates, [{ actor: 'u', element: 'takt', refs: ['crit_u_takt', 'crit_u_takt_2'] }])
  assert.equal(c.complete, false)
  assert.ok(validateContext(doc([u], reqs)).errors.some(e => e.includes('"takt"')))
})

// ── D1: stance and job function are two fields ───────────────────────────────

test('legacy role "endUser" reads as an end user with no job function', () => {
  const legacy = { ref: 'op', role: 'endUser' }
  assert.equal(isEndUser(legacy), true)
  assert.equal(jobFunctionOf(legacy), null, '立場を職能の既定値で埋めない')
  assert.deepEqual(endUsersOf({ actors: [legacy, { ref: 'd', role: 'developer' }] }).map(a => a.ref), ['op'])
})

test('a 0.5 doc may carry the legacy role; R13 asks for the job function', () => {
  const ctx = { version: 'context/0.5', actors: [{ ref: 'op', role: 'endUser' }] }
  const { errors, openQuestions } = validateContext(ctx)
  assert.ok(!errors.some(e => e.includes('is a stance')))
  assert.ok(openQuestions.some(q => q.ref === 'oq_function_op' && q.raisedBy === 'R13:undeclared-function'))
})

test('a 0.6 doc that writes the legacy role is an error', () => {
  const { errors } = validateContext(doc([{ ref: 'op', role: 'endUser' }]))
  assert.ok(errors.some(e => e.includes('is a stance, not a job function')))
})

test('a maintainer who stands as an end user is both — no R13', () => {
  const ctx = doc([{ ref: 'm', role: 'maintainer', endUser: true }])
  assert.equal(isEndUser(ctx.actors[0]), true)
  assert.equal(jobFunctionOf(ctx.actors[0]), 'maintainer')
  assert.ok(!validateContext(ctx).openQuestions.some(q => q.raisedBy.startsWith('R13')))
})
