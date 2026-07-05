/**
 * CheckFeedbackMath unit tests (ADR-062 Phase 4) — THREE-free, bare `node --test`.
 *
 * The module only re-shapes proof-layer facts (checkResults statuses, baked
 * predicate operands) for display; these tests pin the honest-degrade rules
 * (`null`, never a fabricated signal — PHILOSOPHY #11) and that the meter
 * shares the ADR-061 near-miss curve.
 *
 * Run with: pnpm test:context
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { checkStatusKeys, checkTransitions, unsettledCount, checkMeter } from './CheckFeedbackMath.js'
import { nearMissCloseness } from './GraspFunnelMath.js'

describe('checkStatusKeys', () => {
  it('encodes ref:status pairs in order', () => {
    assert.deepEqual(
      checkStatusKeys([{ ref: 'a_reach', status: 'pass' }, { ref: 'a_env', status: 'blocked' }]),
      ['a_reach:pass', 'a_env:blocked'],
    )
  })

  it('degrades the whole list to null on a missing ref, invalid status, or non-array', () => {
    assert.equal(checkStatusKeys(null), null)
    assert.equal(checkStatusKeys([{ status: 'pass' }]), null)
    assert.equal(checkStatusKeys([{ ref: '', status: 'pass' }]), null)
    assert.equal(checkStatusKeys([{ ref: 'a_x', status: 'maybe' }]), null)
  })
})

describe('checkTransitions', () => {
  it('reports a status flip for refs present on both sides', () => {
    const prev = ['a_env:blocked', 'a_reach:pass']
    const cur  = ['a_env:pass',    'a_reach:pass']
    assert.deepEqual(checkTransitions(prev, cur), [{ ref: 'a_env', from: 'blocked', to: 'pass' }])
  })

  it('an added or removed check is not a transition; unchanged sets yield []', () => {
    assert.deepEqual(checkTransitions(['a_a:pass'], ['a_a:pass', 'a_new:fail']), [])
    assert.deepEqual(checkTransitions(['a_a:pass', 'a_old:fail'], ['a_a:pass']), [])
  })

  it('degrades to null without two decodable snapshots', () => {
    assert.equal(checkTransitions(null, ['a_a:pass']), null)
    assert.equal(checkTransitions(['nonsense'], ['a_a:pass']), null)
    assert.equal(checkTransitions(['a_a:pass'], ['a_a:later']), null)
  })
})

describe('unsettledCount', () => {
  it('counts fail + blocked, not pass', () => {
    assert.equal(unsettledCount(['a_a:pass', 'a_b:fail', 'a_c:blocked']), 2)
    assert.equal(unsettledCount([]), 0)
  })

  it('degrades to null on an undecodable snapshot', () => {
    assert.equal(unsettledCount(null), null)
    assert.equal(unsettledCount(['a_a:pass', 'junk']), null)
  })
})

describe('checkMeter', () => {
  it('robot_reach: worst target margin vs marginMin, full meter when the requirement is met', () => {
    const m = checkMeter('robot_reach', {
      kind: 'robot_reach', marginMin: 25,
      targets: [{ ref: 'pick', reachable: true, margin: 132 }, { ref: 'place', reachable: true, margin: 31 }],
    })
    assert.deepEqual(m, { worst: 31, required: 25, headroom: 6, closeness: 1 })
  })

  it('robot_reach: no marginMin or no measured margins → null (no meter is honest)', () => {
    assert.equal(checkMeter('robot_reach', { targets: [{ reachable: true, margin: 9 }] }), null)
    assert.equal(checkMeter('robot_reach', { marginMin: 5, targets: [{ reachable: true }] }), null)
    assert.equal(checkMeter('robot_reach', { marginMin: 5, targets: [] }), null)
  })

  it('collision_free: worst contact clearance vs required clearance (default 0)', () => {
    const m = checkMeter('collision_free', {
      kind: 'collision_free', scope: 'env', clearance: 25,
      contacts: [{ a: 'link2', b: 'fence', clearance: 96 }, { a: 'link3', b: 'table', clearance: 22 }],
    })
    assert.equal(m.worst, 22)
    assert.equal(m.required, 25)
    assert.equal(m.headroom, -3)
    const penetration = checkMeter('collision_free', {
      contacts: [{ a: 'l3', b: 'l5', clearance: -1.2 }],
    })
    assert.equal(penetration.required, 0)
    assert.equal(penetration.worst, -1.2)
  })

  it('collision_free: an empty contact list has no worst distance → null', () => {
    assert.equal(checkMeter('collision_free', { scope: 'self', contacts: [] }), null)
  })

  it('non-robotics kinds and malformed predicates → null', () => {
    assert.equal(checkMeter('no_overlap', { boxes: [] }), null)
    assert.equal(checkMeter('robot_reach', null), null)
    assert.equal(checkMeter(undefined, {}), null)
  })

  it('closeness is the shared ADR-061 near-miss curve over the shortfall (one curve, two panels)', () => {
    const m = checkMeter('collision_free', { clearance: 25, contacts: [{ a: 'x', b: 'y', clearance: 22 }] })
    assert.equal(m.closeness, nearMissCloseness(3))
    const pass = checkMeter('robot_reach', { marginMin: 5, targets: [{ reachable: true, margin: 40 }] })
    assert.equal(pass.closeness, nearMissCloseness(0))
  })

  it('never mutates its input (pure)', () => {
    const predicate = { marginMin: 5, targets: [{ reachable: true, margin: 9 }] }
    const frozen = JSON.stringify(predicate)
    checkMeter('robot_reach', predicate)
    assert.equal(JSON.stringify(predicate), frozen)
  })
})
