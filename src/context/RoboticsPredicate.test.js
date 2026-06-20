/**
 * RoboticsPredicate.test.js — ADR-053 Phase 1: the robot_reach / collision_free
 * acceptance predicates (pure formal evaluation of pre-baked measurement
 * operands; no THREE, no geometry solving — see PredicateEngine.js / ADR-053 §2).
 *
 * Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluatePredicate, MalformedPredicate, PREDICATE_KINDS } from './PredicateEngine.js'
import { validateContext } from './ContextValidator.js'
import {
  CONTEXT_DSL_VERSION,
  SUPPORTED_VERSIONS,
  VALID_PREDICATE_KINDS,
} from './ContextDslSchema.js'

// ── version + registration ────────────────────────────────────────────────────

test('CONTEXT_DSL_VERSION bumped to context/0.4 with backward-compatible SUPPORTED_VERSIONS', () => {
  assert.equal(CONTEXT_DSL_VERSION, 'context/0.4')
  for (const v of ['context/0.1', 'context/0.2', 'context/0.3', 'context/0.4']) {
    assert.ok(SUPPORTED_VERSIONS.includes(v), `0.4 bump must keep ${v} supported`)
  }
})

test('the two robotics kinds are registered in both the schema list and the engine', () => {
  for (const kind of ['robot_reach', 'collision_free']) {
    assert.ok(VALID_PREDICATE_KINDS.includes(kind), `${kind} missing from VALID_PREDICATE_KINDS`)
    assert.ok(PREDICATE_KINDS.includes(kind), `${kind} missing from engine PREDICATE_KINDS`)
  }
})

// ── robot_reach ────────────────────────────────────────────────────────────────

test('robot_reach: all targets reachable → pass with no violations', () => {
  const res = evaluatePredicate({
    kind: 'robot_reach',
    targets: [{ ref: 'pick', reachable: true }, { ref: 'place', reachable: true }],
  })
  assert.equal(res.pass, true)
  assert.equal(res.violations.length, 0)
})

test('robot_reach: an unreachable target is reported and never throws on pass:false', () => {
  const res = evaluatePredicate({
    kind: 'robot_reach',
    targets: [{ ref: 'pick', reachable: true }, { ref: 'place', reachable: false }],
  })
  assert.equal(res.pass, false)
  assert.deepEqual(res.violations, [{ kind: 'unreachable', target: 'place' }])
})

test('robot_reach: marginMin flags a reachable-but-low-margin target', () => {
  const res = evaluatePredicate({
    kind: 'robot_reach',
    marginMin: 5,
    targets: [{ ref: 'pick', reachable: true, margin: 12.5 }, { ref: 'place', reachable: true, margin: 2.1 }],
  })
  assert.equal(res.pass, false)
  assert.deepEqual(res.violations, [{ kind: 'low_margin', target: 'place', margin: 2.1, required: 5 }])
})

test('robot_reach: a reachable target without a measured margin passes even when marginMin is set', () => {
  const res = evaluatePredicate({
    kind: 'robot_reach',
    marginMin: 5,
    targets: [{ ref: 'pick', reachable: true }],
  })
  assert.equal(res.pass, true)
})

test('robot_reach: an unreachable target only yields the unreachable violation (margin not double-counted)', () => {
  const res = evaluatePredicate({
    kind: 'robot_reach',
    marginMin: 5,
    targets: [{ ref: 'place', reachable: false, margin: 1 }],
  })
  assert.deepEqual(res.violations, [{ kind: 'unreachable', target: 'place' }])
})

test('robot_reach: malformed shapes throw MalformedPredicate', () => {
  assert.throws(() => evaluatePredicate({ kind: 'robot_reach', targets: [] }), MalformedPredicate)
  assert.throws(() => evaluatePredicate({ kind: 'robot_reach', targets: [{ ref: 'x' }] }), MalformedPredicate)
  assert.throws(() => evaluatePredicate({ kind: 'robot_reach', targets: [{ reachable: true }], marginMin: 'lots' }), MalformedPredicate)
})

// ── collision_free ─────────────────────────────────────────────────────────────

test('collision_free: an empty contact list is a legitimate pass', () => {
  const res = evaluatePredicate({ kind: 'collision_free', scope: 'self', contacts: [] })
  assert.equal(res.pass, true)
  assert.equal(res.violations.length, 0)
})

test('collision_free: a penetrating contact (negative clearance) fails the default clearance 0', () => {
  const res = evaluatePredicate({
    kind: 'collision_free',
    scope: 'self',
    contacts: [{ a: 'link3', b: 'link5', clearance: -1.2 }, { a: 'link2', b: 'link4', clearance: 3 }],
  })
  assert.equal(res.pass, false)
  assert.deepEqual(res.violations, [{ kind: 'contact', a: 'link3', b: 'link5', clearance: -1.2, required: 0 }])
})

test('collision_free: a required clearance flags a too-close non-penetrating pair', () => {
  const base = { kind: 'collision_free', scope: 'env', contacts: [{ a: 'link2', b: 'table', clearance: 8 }] }
  assert.equal(evaluatePredicate({ ...base, clearance: 5 }).pass, true)
  assert.equal(evaluatePredicate({ ...base, clearance: 10 }).pass, false)
})

test('collision_free: malformed shapes throw MalformedPredicate', () => {
  assert.throws(() => evaluatePredicate({ kind: 'collision_free', scope: 'wrist', contacts: [] }), MalformedPredicate)
  assert.throws(() => evaluatePredicate({ kind: 'collision_free', contacts: 'none' }), MalformedPredicate)
  assert.throws(() => evaluatePredicate({ kind: 'collision_free', contacts: [{ a: 'x', b: 'y' }] }), MalformedPredicate)
  assert.throws(() => evaluatePredicate({ kind: 'collision_free', contacts: [], clearance: 'tight' }), MalformedPredicate)
})

// ── validator integration ──────────────────────────────────────────────────────

test('validateContext runs a robot_reach predicate and records its pass/fail in checkResults', () => {
  const mk = (predicate) => ({
    version: 'context/0.4',
    acceptance: [{ ref: 'a_reach', mode: 'static', predicate }],
  })

  const passRes = validateContext(mk({ kind: 'robot_reach', targets: [{ ref: 'pick', reachable: true }] }))
  assert.equal(passRes.valid, true)
  assert.deepEqual(
    passRes.checkResults.find(r => r.check === 'a_reach'),
    { check: 'a_reach', status: 'pass', violations: [] },
  )

  const failRes = validateContext(mk({ kind: 'robot_reach', targets: [{ ref: 'pick', reachable: false }] }))
  assert.equal(failRes.checkResults.find(r => r.check === 'a_reach').status, 'fail')
})

test('validateContext blocks a collision_free check that requires an unknown fact (never evaluates it)', () => {
  const ctx = {
    version: 'context/0.4',
    given: [{ ref: 'f_robot', subject: 'robot', status: 'unknown', attrs: {} }],
    acceptance: [{
      ref: 'a_self',
      mode: 'static',
      requires: ['f_robot'],
      predicate: { kind: 'collision_free', scope: 'self', contacts: [{ a: 'link3', b: 'link5', clearance: -1 }] },
    }],
  }
  const res = validateContext(ctx)
  const cr = res.checkResults.find(r => r.check === 'a_self')
  assert.equal(cr.status, 'blocked')           // blocked > fail: the penetration is NOT reported
  assert.ok(cr.blockedBy.includes('oq_status_f_robot'))
})

test('validateContext surfaces a malformed robotics predicate as an error', () => {
  const res = validateContext({
    version: 'context/0.4',
    acceptance: [{ ref: 'a_reach', mode: 'static', predicate: { kind: 'robot_reach', targets: [] } }],
  })
  assert.equal(res.valid, false)
  assert.ok(res.errors.some(e => e.includes('a_reach') && e.includes('non-empty')))
})

// ── purity ──────────────────────────────────────────────────────────────────────

test('evaluatePredicate does not mutate its input', () => {
  const pred = Object.freeze({
    kind: 'robot_reach',
    marginMin: 5,
    targets: [Object.freeze({ ref: 'pick', reachable: true, margin: 1 })],
  })
  assert.doesNotThrow(() => evaluatePredicate(pred))   // frozen input → no in-place writes
})
