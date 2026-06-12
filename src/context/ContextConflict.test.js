/**
 * ContextConflict.test.js — ADR-049 Phase 1: Requirement / Conflict model.
 *
 * Run with:  pnpm test:context
 *
 * Scenario: examples/cell_conflict_context.json — three engineers assert
 * requirements over two shared design variables:
 *   - conflict on v_camera_standoff (vision [200,350] vs robot [380,600])
 *   - negotiation cluster {r_cycle_time, r_cam_mount} × {v_robot_base_x, v_camera_standoff}
 *   - sketch-derived stated region without KPI backing (R9)
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileContext } from './ContextCompiler.js'
import { validateContext } from './ContextValidator.js'
import { detectConflicts, detectNegotiationClusters } from './RequirementGraph.js'

const here = dirname(fileURLToPath(import.meta.url))

const loadScenario = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_conflict_context.json'), 'utf8'))

// ── R6: conflict detection ────────────────────────────────────────────────────

test('R6: disjoint admissible intervals on a shared variable emit a Conflict with the gap', () => {
  const result = validateContext(loadScenario())
  assert.equal(result.valid, true, result.errors.join('\n'))

  const conflict = result.conflicts.find(c => c.ref === 'conflict_v_camera_standoff')
  assert.ok(conflict, 'v_camera_standoff の衝突が検出されること')
  assert.equal(conflict.variable, 'v_camera_standoff')
  assert.deepStrictEqual(conflict.between, ['r_cam_resolution', 'r_wrist_singularity'])
  assert.deepStrictEqual(conflict.admissibleSets, {
    r_cam_resolution:    [200, 350],
    r_wrist_singularity: [380, 600],
  })
  assert.deepStrictEqual(conflict.gap, [350, 380])
})

test('R6: overlapping intervals do not conflict', () => {
  const ctx = loadScenario()
  ctx.requirements.find(r => r.ref === 'r_wrist_singularity').admissible.interval = [300, 600]
  // the conflict no longer exists, so its resolving Decision must go too (invariant 7)
  ctx.decisions = ctx.decisions.filter(d => d.ref !== 'd_standoff')

  const result = validateContext(ctx)
  assert.equal(result.valid, true, result.errors.join('\n'))
  assert.equal(result.conflicts.length, 0)
})

test('R6: touching intervals conflict (half-open [min, max) convention)', () => {
  const requirements = new Map([
    ['r_a', { ref: 'r_a', by: 'a', constrains: ['v_x'], admissible: { interval: [200, 350], source: 'stated' } }],
    ['r_b', { ref: 'r_b', by: 'b', constrains: ['v_x'], admissible: { interval: [350, 600], source: 'stated' } }],
  ])
  const conflicts = detectConflicts(requirements)
  assert.equal(conflicts.length, 1)
  assert.deepStrictEqual(conflicts[0].gap, [350, 350])
})

test('R6: a Decision resolving the conflict marks it resolvedBy (history preserved)', () => {
  const result = validateContext(loadScenario())
  const conflict = result.conflicts.find(c => c.ref === 'conflict_v_camera_standoff')
  assert.equal(conflict.resolvedBy, 'd_standoff')
})

// ── Invariant 7: conflicts are emitted, never authored ────────────────────────

test('a Decision resolving a conflict that R6 does not emit is rejected', () => {
  const ctx = loadScenario()
  // widen the robot interval so the conflict disappears, but keep d_standoff
  ctx.requirements.find(r => r.ref === 'r_wrist_singularity').admissible.interval = [300, 600]

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('d_standoff') && e.includes('conflict_v_camera_standoff')))
})

// ── R7: negotiation clusters ──────────────────────────────────────────────────

test('R7: an alternating cycle in the requirement-variable graph is a NegotiationCluster', () => {
  const result = validateContext(loadScenario())
  assert.equal(result.negotiationClusters.length, 1)

  const cluster = result.negotiationClusters[0]
  assert.equal(cluster.ref, 'nc_v_camera_standoff+v_robot_base_x')
  assert.deepStrictEqual(cluster.requirements, ['r_cam_mount', 'r_cycle_time'])
  assert.deepStrictEqual(cluster.variables,    ['v_camera_standoff', 'v_robot_base_x'])
  assert.deepStrictEqual(cluster.actors,       ['robot_engineer', 'vision_engineer'])
})

test('R7: bridge requirements (single shared variable) are NOT part of the cluster', () => {
  // r_cam_resolution / r_wrist_singularity / r_eoat_clearance each constrain one
  // variable — they conflict or not, but they do not couple negotiations.
  const { negotiationClusters } = validateContext(loadScenario())
  const cluster = negotiationClusters[0]
  for (const bridge of ['r_cam_resolution', 'r_wrist_singularity', 'r_eoat_clearance']) {
    assert.ok(!cluster.requirements.includes(bridge), `${bridge} はクラスターに含まれないこと`)
  }
})

test('R7: breaking the cycle dissolves the cluster (forest → no cluster)', () => {
  const ctx = loadScenario()
  ctx.requirements.find(r => r.ref === 'r_cam_mount').constrains = ['v_robot_base_x']

  const result = validateContext(ctx)
  assert.equal(result.valid, true, result.errors.join('\n'))
  assert.equal(result.negotiationClusters.length, 0)
})

test('R7: an n-ary Decision covering all cluster variables marks it resolvedBy', () => {
  const result = validateContext(loadScenario())
  assert.equal(result.negotiationClusters[0].resolvedBy, 'd_cell_joint')
})

// ── Invariant 8: n-ary Decision shape ─────────────────────────────────────────

test('an n-ary Decision missing a nominal for a resolved variable is rejected', () => {
  const ctx = loadScenario()
  delete ctx.decisions.find(d => d.ref === 'd_cell_joint').nominals.v_camera_standoff

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('d_cell_joint') && e.includes('v_camera_standoff')))
})

test('an n-ary Decision resolving a nonexistent variable is rejected', () => {
  const ctx = loadScenario()
  ctx.decisions.find(d => d.ref === 'd_cell_joint').resolves.push('v_ghost')

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('v_ghost')))
})

// ── Decision.relaxes referential integrity ────────────────────────────────────

test('relaxes.requirement must reference an existing requirement', () => {
  const ctx = loadScenario()
  ctx.decisions.find(d => d.ref === 'd_standoff').relaxes.requirement = 'r_ghost'

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('r_ghost')))
})

// ── R9: stated admissible without KPI backing ─────────────────────────────────

test('R9: a stated region without (kpi, criterion) raises an OpenQuestion', () => {
  const { openQuestions } = validateContext(loadScenario())
  const refs = openQuestions.map(oq => oq.ref)

  assert.ok(refs.includes('oq_kpi_r_eoat_clearance'), 'スケッチ由来 stated 領域に根拠クライテリアを問う OQ が立つこと')
  assert.ok(!refs.includes('oq_kpi_r_cam_resolution'),    'KPI 裏付けのある stated 領域には OQ が立たないこと')
  assert.ok(!refs.includes('oq_kpi_r_wrist_singularity'), 'KPI 裏付けのある stated 領域には OQ が立たないこと')
})

// ── R0' shape checks ──────────────────────────────────────────────────────────

test('a requirement constraining a nonexistent variable is rejected', () => {
  const ctx = loadScenario()
  ctx.requirements.find(r => r.ref === 'r_cycle_time').constrains.push('v_ghost')

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('r_cycle_time') && e.includes('v_ghost')))
})

test('invalid negotiability and inverted intervals are rejected', () => {
  const ctx = loadScenario()
  const req = ctx.requirements.find(r => r.ref === 'r_eoat_clearance')
  req.negotiability = 'maybe'
  req.admissible.interval = [1200, 600]

  const result = validateContext(ctx)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('negotiability')))
  assert.ok(result.errors.some(e => e.includes('interval')))
})

// ── Trace integration: requirements are valid trace sources ───────────────────

test('trace.from may reference a requirement (kind: constrains)', () => {
  const result = validateContext(loadScenario())
  assert.equal(result.valid, true, result.errors.join('\n'))
})

// ── compileContext pass-through ───────────────────────────────────────────────

test('compileContext surfaces conflicts and negotiationClusters alongside layoutDsl', () => {
  const out = compileContext(loadScenario())

  assert.equal(out.layoutDsl.entities[0].ref, 'robot_base_zone')
  assert.equal(out.conflicts.length, 1)
  assert.equal(out.conflicts[0].ref, 'conflict_v_camera_standoff')
  assert.equal(out.negotiationClusters.length, 1)
  assert.equal(out.negotiationClusters[0].resolvedBy, 'd_cell_joint')
})

// ── Determinism (referenceable refs require stable output) ────────────────────

test('validator output is deterministic across runs', () => {
  const a = validateContext(loadScenario())
  const b = validateContext(loadScenario())
  assert.deepStrictEqual(a, b)
})

// ── Graph unit: larger cycle through three requirements ───────────────────────

test('detectNegotiationClusters finds a 6-cycle spanning three actors', () => {
  // r1–v1–r2–v2–r3–v3–r1 : every requirement bridges two variables
  const requirements = new Map([
    ['r1', { ref: 'r1', by: 'mech',   constrains: ['v1', 'v3'] }],
    ['r2', { ref: 'r2', by: 'robot',  constrains: ['v1', 'v2'] }],
    ['r3', { ref: 'r3', by: 'vision', constrains: ['v2', 'v3'] }],
  ])
  const clusters = detectNegotiationClusters(requirements)
  assert.equal(clusters.length, 1)
  assert.deepStrictEqual(clusters[0].requirements, ['r1', 'r2', 'r3'])
  assert.deepStrictEqual(clusters[0].variables,    ['v1', 'v2', 'v3'])
  assert.deepStrictEqual(clusters[0].actors,       ['mech', 'robot', 'vision'])
})

test('detectNegotiationClusters returns nothing for a forest', () => {
  const requirements = new Map([
    ['r1', { ref: 'r1', by: 'a', constrains: ['v1'] }],
    ['r2', { ref: 'r2', by: 'b', constrains: ['v1'] }],   // shared variable, still a tree
    ['r3', { ref: 'r3', by: 'c', constrains: ['v1', 'v2'] }],
  ])
  assert.equal(detectNegotiationClusters(requirements).length, 0)
})
