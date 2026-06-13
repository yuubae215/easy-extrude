/**
 * ContextPhase3.test.js — ADR-049 Phase 3: region Variables, AABB conflict
 * detection, and the approximate acceptance predicate engine.
 *
 * Run with:  pnpm test:context
 *
 * Scenario: examples/cell_region_context.json — a 2-D footprint region variable
 * with disjoint admissible boxes (conflict on the X axis only), a retained
 * scalar conflict, and four acceptance predicates exercising pass / fail /
 * blocked outcomes.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileContext } from './ContextCompiler.js'
import { validateContext } from './ContextValidator.js'
import { detectConflicts } from './RequirementGraph.js'
import { intersectIntervals, intersectBoxes, aabbClearance } from './RegionGeometry.js'
import { evaluatePredicate, MalformedPredicate } from './PredicateEngine.js'

const here = dirname(fileURLToPath(import.meta.url))

const loadScenario = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_region_context.json'), 'utf8'))

// ── RegionGeometry unit ───────────────────────────────────────────────────────

test('intersectIntervals: touching intervals are empty (half-open [min,max))', () => {
  assert.deepStrictEqual(intersectIntervals([[200, 350], [350, 600]]), { lo: 350, hi: 350, empty: true })
  assert.deepStrictEqual(intersectIntervals([[200, 400], [300, 600]]), { lo: 300, hi: 400, empty: false })
})

test('intersectBoxes: empty on one axis only → that axis in emptyAxes with gap', () => {
  const boxes = [
    { x: [600, 1200], y: [-300, 300] },
    { x: [1300, 1800], y: [-100, 100] },
  ]
  const { emptyAxes, gap, box } = intersectBoxes(boxes, ['x', 'y'])
  assert.deepStrictEqual(emptyAxes, ['x'])
  assert.deepStrictEqual(gap, { x: [1200, 1300] })
  assert.deepStrictEqual(box.y, [-100, 100]) // non-empty axis still reports its intersection
})

test('intersectBoxes: AABB intersection is empty iff empty on ≥1 axis (per-axis decomposition)', () => {
  // Three boxes pairwise-overlapping on each axis individually but with an empty
  // common X intersection — AABB emptiness is still decided per axis (the
  // Helly-2-D pitfall does not bite axis-aligned boxes).
  const boxes = [
    { x: [0, 100], y: [0, 100] },
    { x: [90, 200], y: [0, 100] },
    { x: [150, 300], y: [0, 100] },
  ]
  const { emptyAxes } = intersectBoxes(boxes, ['x', 'y'])
  assert.deepStrictEqual(emptyAxes, ['x']) // common X = [150,100] empty; Y = [0,100] fine
})

test('aabbClearance: overlapping boxes are < a positive required clearance', () => {
  const a = { x: [0, 220], y: [0, 220] }
  const b = { x: [220, 400], y: [0, 120] } // touches on X face
  assert.equal(aabbClearance(a, b, ['x', 'y']) < 20, true)
  const c = { x: [300, 400], y: [0, 120] } // separated 80mm on X
  assert.equal(aabbClearance(a, c, ['x', 'y']), 80)
})

// ── R6 region conflict ────────────────────────────────────────────────────────

test('R6 region: disjoint admissible boxes emit a Conflict with a per-axis gap map', () => {
  const result = validateContext(loadScenario())
  const conflict = result.conflicts.find(c => c.ref === 'conflict_v_base_footprint')
  assert.ok(conflict, '領域 Variable の衝突が検出されること')
  assert.deepStrictEqual(conflict.between, ['r_mech_footprint', 'r_vision_footprint'])
  assert.deepStrictEqual(conflict.gap, { x: [1200, 1300] })
  assert.deepStrictEqual(conflict.admissibleSets.r_vision_footprint, { x: [600, 1200], y: [-300, 300] })
})

test('R6 region: overlapping boxes do not conflict', () => {
  const requirements = new Map([
    ['r_a', { ref: 'r_a', constrains: ['v_f'], admissible: { region: { x: [0, 200], y: [0, 200] }, source: 'stated' } }],
    ['r_b', { ref: 'r_b', constrains: ['v_f'], admissible: { region: { x: [100, 300], y: [50, 250] }, source: 'stated' } }],
  ])
  assert.equal(detectConflicts(requirements).length, 0)
})

test('R6 region: touching on one axis still conflicts (half-open convention reused per axis)', () => {
  const requirements = new Map([
    ['r_a', { ref: 'r_a', constrains: ['v_f'], admissible: { region: { x: [0, 200], y: [0, 100] }, source: 'stated' } }],
    ['r_b', { ref: 'r_b', constrains: ['v_f'], admissible: { region: { x: [200, 400], y: [0, 100] }, source: 'stated' } }],
  ])
  const conflicts = detectConflicts(requirements)
  assert.equal(conflicts.length, 1)
  assert.deepStrictEqual(conflicts[0].gap, { x: [200, 200] })
})

test('R6 region: a Decision resolving the region conflict marks it resolvedBy', () => {
  const conflict = validateContext(loadScenario()).conflicts.find(c => c.ref === 'conflict_v_base_footprint')
  assert.equal(conflict.resolvedBy, 'd_footprint')
})

// ── R6 scalar backward-compat (regression guard for the array gap shape) ───────

test('R6 scalar: gap is still a [hi,lo] array (backward compatible)', () => {
  const conflict = validateContext(loadScenario()).conflicts.find(c => c.ref === 'conflict_v_camera_standoff')
  assert.deepStrictEqual(conflict.gap, [350, 380])
  assert.deepStrictEqual(conflict.admissibleSets.r_cam_resolution, [200, 350])
})

// ── PredicateEngine unit ──────────────────────────────────────────────────────

test('no_overlap: ADR-046 §4.2 example fails at 20mm clearance, passes at 0mm', () => {
  const boxes = [
    { ref: 'robot', x: [0, 220], y: [0, 220] },
    { ref: 'container_a', x: [220, 400], y: [0, 120] },
    { ref: 'container_b', x: [220, 400], y: [120, 240] },
  ]
  assert.equal(evaluatePredicate({ kind: 'no_overlap', clearance: 20, boxes }).pass, false)
  assert.equal(evaluatePredicate({ kind: 'no_overlap', clearance: 0, boxes }).pass, true)
})

test('no_overlap: within containment is enforced', () => {
  const res = evaluatePredicate({
    kind: 'no_overlap', clearance: 0,
    boxes: [{ ref: 'big', x: [0, 600], y: [0, 100] }],
    within: { x: [0, 500], y: [0, 300] },
  })
  assert.equal(res.pass, false)
  assert.equal(res.violations[0].kind, 'within')
})

test('reach_covers: a target outside the sphere is reported uncovered', () => {
  const res = evaluatePredicate({
    kind: 'reach_covers',
    envelope: { shape: 'sphere', center: { x: 0, y: 0, z: 0 }, radius: 850 },
    targets: [{ ref: 'tcp_pick', x: 600, y: 0, z: 200 }, { ref: 'tcp_place', x: 900, y: 0, z: 200 }],
  })
  assert.equal(res.pass, false)
  assert.deepStrictEqual(res.violations.map(v => v.target), ['tcp_place'])
})

test('swept_volume: clear path passes; an obstacle within clearance fails', () => {
  const base = {
    kind: 'swept_volume',
    path: [{ x: 0, y: 0, z: 0 }, { x: 600, y: 0, z: 0 }],
    radius: 120,
    clearance: 10,
  }
  assert.equal(evaluatePredicate({ ...base, obstacles: [{ ref: 'far', x: [900, 920], y: [-500, 500], z: [0, 1800] }] }).pass, true)
  assert.equal(evaluatePredicate({ ...base, obstacles: [{ ref: 'near', x: [700, 720], y: [-500, 500], z: [0, 1800] }] }).pass, false)
})

test('evaluatePredicate throws MalformedPredicate on an unknown kind (never on pass:false)', () => {
  assert.throws(() => evaluatePredicate({ kind: 'teleport' }), MalformedPredicate)
  assert.throws(() => evaluatePredicate({ kind: 'no_overlap', boxes: [] }), MalformedPredicate)
})

// ── R5 predicate integration (pass / fail / blocked) ──────────────────────────

test('R5: checkResults carries pass / fail / blocked; a blocked check does not run the engine', () => {
  const { checkResults } = validateContext(loadScenario())
  const byCheck = new Map(checkResults.map(r => [r.check, r]))

  assert.equal(byCheck.get('a_no_overlap').status, 'fail')
  assert.equal(byCheck.get('a_no_overlap').violations.length, 3)
  assert.equal(byCheck.get('a_reach').status, 'fail')
  assert.equal(byCheck.get('a_swept').status, 'pass')

  const blocked = byCheck.get('a_bolt_clearance')
  assert.equal(blocked.status, 'blocked')
  assert.equal(blocked.violations, undefined, 'blocked check must not be evaluated')
  assert.deepStrictEqual(blocked.blockedBy, ['oq_status_f_bolt'])
})

test('R5: a malformed structured predicate becomes a validation error', () => {
  const ctx = loadScenario()
  ctx.acceptance.find(a => a.ref === 'a_no_overlap').predicate.kind = 'bogus'
  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('a_no_overlap') && e.includes('bogus')))
})

// ── R0' region shape rejections ───────────────────────────────────────────────

test('R0\': a region admissible on a scalar variable is rejected', () => {
  const ctx = loadScenario()
  ctx.requirements.find(r => r.ref === 'r_cam_resolution').admissible = { region: { x: [0, 10] }, source: 'stated' }
  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('r_cam_resolution') && e.includes('region')))
})

test('R0\': a scalar interval on a region variable is rejected', () => {
  const ctx = loadScenario()
  ctx.requirements.find(r => r.ref === 'r_vision_footprint').admissible = { interval: [0, 100], source: 'stated' }
  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('r_vision_footprint')))
})

test('R0\': a convex-polygon region kind is rejected (AABB-only caveat)', () => {
  const ctx = loadScenario()
  ctx.variables.find(v => v.ref === 'v_base_footprint').region.kind = 'polygon'
  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('v_base_footprint') && e.includes('kind')))
})

test('R0\': an inverted region axis box is rejected', () => {
  const ctx = loadScenario()
  ctx.requirements.find(r => r.ref === 'r_vision_footprint').admissible.region.x = [1200, 600]
  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('r_vision_footprint') && e.includes('region.x')))
})

// ── compileContext pass-through + determinism ─────────────────────────────────

test('compileContext surfaces checkResults alongside conflicts', () => {
  const out = compileContext(loadScenario())
  assert.ok(Array.isArray(out.checkResults))
  assert.equal(out.checkResults.length, 4)
  assert.equal(out.conflicts.length, 2)
})

test('validator output is deterministic across runs', () => {
  assert.deepStrictEqual(validateContext(loadScenario()), validateContext(loadScenario()))
})
