/**
 * RoboticsService.test.js — ADR-053 Phase 2: the measurement-instrument
 * coordinator that bakes measured operands into the canonical doc.
 *
 * THREE-free: the ComputeBackend is faked so no robotics kernel / THREE is
 * exercised here (the kernels have their own Robotics.test.js). Verifies the §2
 * receptacle contract — input-immutability, predicate baking, the measured-Fact
 * path, event emission, and that a baked predicate then passes validateContext.
 *
 * Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { RoboticsService } from './RoboticsService.js'
import { validateContext } from '../context/ContextValidator.js'

/** A fake backend that records the job and returns a canned result. */
function fakeBackend(result) {
  const calls = []
  return {
    calls,
    run(job) {
      calls.push(job)
      return Promise.resolve(result)
    },
  }
}

const reachDoc = () => ({
  version: 'context/0.4',
  acceptance: [{
    ref: 'a_reach',
    mode: 'static',
    predicate: { kind: 'robot_reach', targets: [], marginMin: 5 },
  }],
})

// ── construction ────────────────────────────────────────────────────────────

test('RoboticsService requires a backend with a run method', () => {
  assert.throws(() => new RoboticsService(null), /ComputeBackend/)
  assert.throws(() => new RoboticsService({}), /ComputeBackend/)
})

// ── measureReach ──────────────────────────────────────────────────────────────

test('measureReach bakes the measured targets into the robot_reach predicate', async () => {
  const baked = [{ ref: 'pick', reachable: true, margin: 12 }, { ref: 'place', reachable: false }]
  const svc = new RoboticsService(fakeBackend({ backend: 'local', kind: 'reach', targets: baked }))
  const doc = reachDoc()

  const next = await svc.measureReach(doc, {
    acceptanceRef: 'a_reach',
    chain: { joints: [] },
    targets: [{ ref: 'pick', x: 1 }, { ref: 'place', x: 9 }],
  })

  assert.deepEqual(next.acceptance[0].predicate.targets, baked)
  assert.equal(next.acceptance[0].predicate.marginMin, 5)  // untouched fields preserved
})

test('measureReach does not mutate the input document (PHILOSOPHY #6)', async () => {
  const svc = new RoboticsService(fakeBackend({ targets: [{ ref: 'pick', reachable: true }] }))
  const doc = reachDoc()
  const before = JSON.stringify(doc)
  const next = await svc.measureReach(doc, { acceptanceRef: 'a_reach', chain: {}, targets: [] })
  assert.equal(JSON.stringify(doc), before)            // input frozen in value
  assert.notEqual(next, doc)                           // a new document
})

test('measureReach emits a measured event with the backend result', async () => {
  const result = { backend: 'local', kind: 'reach', targets: [{ ref: 'pick', reachable: true }] }
  const svc = new RoboticsService(fakeBackend(result))
  let seen = null
  svc.on('measured', e => { seen = e })
  await svc.measureReach(reachDoc(), { acceptanceRef: 'a_reach', chain: {}, targets: [] })
  assert.deepEqual(seen, { ref: 'a_reach', kind: 'reach', result })
})

test('measureReach throws on a missing or mistyped acceptance check (no silent loss)', async () => {
  const svc = new RoboticsService(fakeBackend({ targets: [] }))
  await assert.rejects(
    () => svc.measureReach(reachDoc(), { acceptanceRef: 'nope', chain: {}, targets: [] }),
    /no acceptance check/,
  )
  const collisionDoc = {
    version: 'context/0.4',
    acceptance: [{ ref: 'a_x', mode: 'static', predicate: { kind: 'collision_free', scope: 'self', contacts: [] } }],
  }
  await assert.rejects(
    () => svc.measureReach(collisionDoc, { acceptanceRef: 'a_x', chain: {}, targets: [] }),
    /not a robot_reach predicate/,
  )
})

// ── measureCollision ──────────────────────────────────────────────────────────

test('measureCollision bakes the measured contacts into the collision_free predicate', async () => {
  const contacts = [{ a: 'link3', b: 'link5', clearance: -1.2 }]
  const svc = new RoboticsService(fakeBackend({ backend: 'local', kind: 'collision', contacts }))
  const doc = {
    version: 'context/0.4',
    acceptance: [{ ref: 'a_self', mode: 'static', predicate: { kind: 'collision_free', scope: 'self', contacts: [] } }],
  }
  const next = await svc.measureCollision(doc, { acceptanceRef: 'a_self', scope: 'self', links: [] })
  assert.deepEqual(next.acceptance[0].predicate.contacts, contacts)
  assert.equal(next.acceptance[0].predicate.scope, 'self')
})

// ── measured Fact ─────────────────────────────────────────────────────────────

test('applyMeasuredFact writes status:measured and merges attrs immutably', () => {
  const svc = new RoboticsService(fakeBackend({}))
  const doc = {
    version: 'context/0.4',
    given: [{ ref: 'f_robot', subject: 'robot', status: 'unknown', attrs: { reach: { value: 850, unit: 'mm' } } }],
  }
  const next = svc.applyMeasuredFact(doc, { factRef: 'f_robot', attrs: { cycleTime: { value: 8.2, unit: 's' } } })
  assert.equal(next.given[0].status, 'measured')
  assert.deepEqual(next.given[0].attrs, { reach: { value: 850, unit: 'mm' }, cycleTime: { value: 8.2, unit: 's' } })
  assert.equal(doc.given[0].status, 'unknown')        // input untouched
})

test('applyMeasuredFact throws for an unknown fact ref', () => {
  const svc = new RoboticsService(fakeBackend({}))
  assert.throws(() => svc.applyMeasuredFact({ given: [] }, { factRef: 'ghost', attrs: {} }), /no given fact/)
})

// ── end-to-end: measured operands drive the formal verifier ───────────────────

test('a baked robot_reach predicate then passes validateContext when all targets reach', async () => {
  const svc = new RoboticsService(fakeBackend({
    targets: [{ ref: 'pick', reachable: true, margin: 12 }, { ref: 'place', reachable: true, margin: 7 }],
  }))
  const next = await svc.measureReach(reachDoc(), { acceptanceRef: 'a_reach', chain: {}, targets: [] })
  const res = validateContext(next)
  assert.equal(res.valid, true)
  assert.equal(res.checkResults.find(r => r.check === 'a_reach').status, 'pass')
})

test('a baked robot_reach predicate fails validateContext when a target is unreachable', async () => {
  const svc = new RoboticsService(fakeBackend({
    targets: [{ ref: 'pick', reachable: true, margin: 12 }, { ref: 'place', reachable: false }],
  }))
  const next = await svc.measureReach(reachDoc(), { acceptanceRef: 'a_reach', chain: {}, targets: [] })
  const res = validateContext(next)
  assert.equal(res.checkResults.find(r => r.check === 'a_reach').status, 'fail')
})
