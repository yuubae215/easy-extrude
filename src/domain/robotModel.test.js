/**
 * Which arm is this app talking about? (ADR-141)
 *
 * The assertion that matters is the LAST one in this file: the declared reach
 * envelope is pinned to the DH lengths of the URDF the app actually draws. That
 * is what makes an edit to either side loud. Everything above it establishes
 * that the vocabulary is closed and the band is computed the way the ADR says.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  ROBOT_MODEL_ID, ROBOT_MODELS, SHIPPED_ROBOT_MODEL_ID, RETIRED_REACH_PRESETS,
  robotModelById, reachBandFromDh, reachDisagreements, reachEnvelopeFor,
} from './robotModel.js'
import { readUrKinematics, kinematicsDeclarationFromUrdf } from './robotKinematics.js'
import { parseUrdfChain } from '../robotics/UrdfChain.js'

/** The very file `robotSkeleton.js` bundles — read here without Vite's `?raw`. */
const URDF = readFileSync(
  fileURLToPath(new URL('../../public/robot/skeleton_arm.urdf', import.meta.url)), 'utf8')

// ── The vocabulary is closed (原則 #31) ─────────────────────────────────────

test('an undeclared model id throws instead of quietly becoming the UR5e', () => {
  assert.throws(() => robotModelById('ur10e'), /undeclared robot model/)
  assert.throws(() => robotModelById(undefined), /undeclared robot model/)
})

test('every declared id has a row, and the shipped model is one of them', () => {
  for (const id of Object.values(ROBOT_MODEL_ID)) {
    assert.equal(robotModelById(id).id, id)
  }
  assert.equal(Object.keys(ROBOT_MODELS).length, Object.values(ROBOT_MODEL_ID).length)
  assert.ok(ROBOT_MODELS[SHIPPED_ROBOT_MODEL_ID], 'the shipped model has no row')
})

test('every row states where its envelope came from', () => {
  // An envelope with no stated origin cannot be told apart from a guess — which
  // is precisely what the three retired presets were.
  for (const model of Object.values(ROBOT_MODELS)) {
    assert.ok(model.reachProvenance?.length > 10, `${model.id} has no reach provenance`)
    assert.ok(model.reach.reachMin < model.reach.reachMax, `${model.id} reaches nowhere`)
    assert.ok(model.reach.wristConeHalfAngle > 0)
  }
})

test('the retired presets are named, so their removal is counted', () => {
  // ADR-103: a retired shape that is merely absent comes back the next time
  // somebody wants "a bigger arm".
  assert.deepEqual([...RETIRED_REACH_PRESETS], ['small-arm', 'large-arm'])
  for (const retired of RETIRED_REACH_PRESETS) {
    assert.equal(ROBOT_MODELS[retired], undefined, `${retired} came back as a model`)
  }
})

// ── The band ────────────────────────────────────────────────────────────────

test('the band spans "arm straight, wrist folded" to "everything colinear"', () => {
  const band = reachBandFromDh({ a2: -0.4, a3: -0.3, d5: 0.1, d6: 0.05 })
  assert.equal(band.lower, 0.7)
  assert.equal(Math.round(band.upper * 1000), 850)
})

test('DH sign convention does not change the band', () => {
  // a2/a3 are negative by UR convention; a chain written with positive lengths
  // is the same arm, and a band that disagreed would fail the build for a
  // cosmetic reason.
  const neg = reachBandFromDh({ a2: -0.4, a3: -0.3, d5: 0.1, d6: 0.05 })
  const pos = reachBandFromDh({ a2:  0.4, a3:  0.3, d5: 0.1, d6: 0.05 })
  assert.deepEqual(neg, pos)
})

test('an envelope outside the band is reported as a different robot', () => {
  const dh = { a2: -0.425, a3: -0.3922, d5: 0.0997, d6: 0.0996 }   // band 0.817–1.017
  assert.deepEqual(reachDisagreements({ reachMin: 0.2, reachMax: 0.85 }, dh), [])

  const tooLarge = reachDisagreements({ reachMin: 0.3, reachMax: 1.3 }, dh)
  assert.equal(tooLarge.length, 1)
  assert.match(tooLarge[0], /different robot/)

  const tooSmall = reachDisagreements({ reachMin: 0.12, reachMax: 0.5 }, dh)
  assert.equal(tooSmall.length, 1)
  assert.match(tooSmall[0], /different robot/)
})

test('nothing to compare is not a disagreement', () => {
  // No robot, or a chain that is not UR-shaped, must not manufacture a warning —
  // "undeclared" and "wrong" are different states (ADR-120).
  assert.deepEqual(reachDisagreements(null, { a2: -1, a3: -1, d5: 0, d6: 0 }), [])
  assert.deepEqual(reachDisagreements({ reachMin: 0, reachMax: 1 }, null), [])
})

test('an inverted envelope is reported even when its max fits the arm', () => {
  const dh = { a2: -0.425, a3: -0.3922, d5: 0.0997, d6: 0.0996 }
  const gaps = reachDisagreements({ reachMin: 0.9, reachMax: 0.85 }, dh)
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /reaches nowhere/)
})

test('no kinematics ⇒ no envelope offered, rather than a plausible one', () => {
  assert.equal(reachEnvelopeFor(null), null)
  assert.equal(reachEnvelopeFor({ kind: 'universalRobots' }), null)   // no dh
})

// ── The assertion this file exists for ──────────────────────────────────────

test('the shipped envelope describes the arm the app DRAWS', () => {
  // The two facts meet here and nowhere else. Before ADR-141 they never met at
  // all: the envelope came from a catalog of three imaginary arms and the
  // skeleton came from the URDF, so editing either one could not disturb the
  // other. Swap the URDF for a UR10e and this fails; move reachMax to 1.3 and
  // this fails.
  const { dh } = readUrKinematics(parseUrdfChain(URDF))
  const { reach, label } = robotModelById(SHIPPED_ROBOT_MODEL_ID)
  assert.deepEqual(reachDisagreements(reach, dh), [],
    `${label}'s declared envelope does not fit the drawn chain`)

  // And the band is the one the ADR quotes, so the numbers in the prose are the
  // numbers in the code.
  const band = reachBandFromDh(dh)
  assert.equal(Math.round(band.lower * 1000), 817)
  assert.equal(Math.round(band.upper * 1000), 1017)
})

test('the envelope the view will publish is the shipped one', () => {
  // `robotSkeleton.js` cannot be imported here (it reads the URDF through Vite's
  // `?raw`), so the composition it performs is reproduced from the same inputs.
  const kinematics = kinematicsDeclarationFromUrdf(URDF)
  assert.ok(kinematics, 'the bundled URDF stopped being UR-shaped')
  assert.deepEqual(reachEnvelopeFor(kinematics),
    robotModelById(SHIPPED_ROBOT_MODEL_ID).reach)
})
