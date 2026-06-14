/**
 * ContextPhase4.test.js — ADR-049 Phase 4: persona projections of the
 * requirement/conflict graph (conflict matrix + negotiation resolution order).
 *
 * Run with:  pnpm test:context
 *
 * Scenario: examples/cell_conflict_context.json — 3 actors × 2 shared variables,
 * one single-variable conflict (v_camera_standoff, gap [350,380], resolved by
 * d_standoff) and one negotiation cluster (nc_v_camera_standoff+v_robot_base_x,
 * resolved by the n-ary d_cell_joint). The cluster's variable set covers the
 * conflict variable, so the resolution order is conflict → cluster.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { validateContext } from './ContextValidator.js'
import { projectConflictMatrix, projectResolutionOrder } from './PersonaProjection.js'

const here = dirname(fileURLToPath(import.meta.url))

const loadScenario = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_conflict_context.json'), 'utf8'))

// ── projectConflictMatrix ─────────────────────────────────────────────────────

test('conflict matrix: axes follow ctx order (actors × variables)', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  assert.deepStrictEqual(matrix.actors, ['mech_engineer', 'robot_engineer', 'vision_engineer'])
  assert.deepStrictEqual(matrix.variables, ['v_camera_standoff', 'v_robot_base_x'])
})

test('conflict matrix: both authors of the standoff conflict get a resolved cell (settled by d_standoff)', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  // conflict_v_camera_standoff is resolved by d_standoff in this scenario, so the
  // involved cells read `resolved`, not the live `conflict` state.
  assert.equal(matrix.cells['vision_engineer|v_camera_standoff'].state, 'resolved')
  assert.equal(matrix.cells['robot_engineer|v_camera_standoff'].state, 'resolved')
  // vision authors r_cam_resolution (single-var) AND the coupled r_cam_mount on
  // this variable — both land in the same cell, in ctx.requirements order.
  assert.deepStrictEqual(
    matrix.cells['vision_engineer|v_camera_standoff'].requirements,
    ['r_cam_resolution', 'r_cam_mount'],
  )
})

test('conflict matrix: an unresolved conflict reads state:conflict', () => {
  // Strip the resolving decisions so the R6 conflict stays live.
  const ctx = { ...loadScenario(), decisions: [] }
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  assert.equal(matrix.cells['vision_engineer|v_camera_standoff'].state, 'conflict')
  assert.equal(matrix.cells['robot_engineer|v_camera_standoff'].state, 'conflict')
  assert.equal(matrix.variableSummary.v_camera_standoff.resolvedBy, null)
})

test('conflict matrix: a non-conflicting single-variable claim is satisfied', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  assert.equal(matrix.cells['mech_engineer|v_robot_base_x'].state, 'satisfied')
  assert.deepStrictEqual(matrix.cells['mech_engineer|v_robot_base_x'].requirements, ['r_eoat_clearance'])
})

test('conflict matrix: multi-variable requirements are coupled and satisfied, never conflict', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  // r_cycle_time (robot) and r_cam_mount (vision) both constrain BOTH variables.
  const robotStandoff = matrix.cells['robot_engineer|v_camera_standoff']
  assert.ok(robotStandoff.requirements.includes('r_cycle_time'))
  assert.equal(robotStandoff.coupled, true)
  const visionBaseX = matrix.cells['vision_engineer|v_robot_base_x']
  assert.deepStrictEqual(visionBaseX.requirements, ['r_cam_mount'])
  assert.equal(visionBaseX.coupled, true)
  assert.equal(visionBaseX.state, 'satisfied') // coupled reqs never feed R6
})

test('conflict matrix: empty cells are state:none with no requirements', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  const cell = matrix.cells['mech_engineer|v_camera_standoff']
  assert.equal(cell.state, 'none')
  assert.deepStrictEqual(cell.requirements, [])
})

test('conflict matrix: variableSummary carries the R6 gap, between and resolvedBy', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  const s = matrix.variableSummary.v_camera_standoff
  assert.equal(s.inConflict, true)
  assert.equal(s.conflictRef, 'conflict_v_camera_standoff')
  assert.deepStrictEqual(s.gap, [350, 380])
  assert.deepStrictEqual(s.between, ['r_cam_resolution', 'r_wrist_singularity'])
  assert.equal(s.resolvedBy, 'd_standoff')
  assert.deepStrictEqual(s.actors, ['robot_engineer', 'vision_engineer'])
})

test('conflict matrix: a non-conflicting variable summarises as inConflict:false', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  const s = matrix.variableSummary.v_robot_base_x
  assert.equal(s.inConflict, false)
  assert.equal(s.conflictRef, null)
  assert.equal(s.resolvedBy, null)
})

test('conflict matrix: criteria expose kpi name + criterion op/value', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx))
  const crit = matrix.cells['vision_engineer|v_camera_standoff'].criteria
  assert.deepStrictEqual(crit, [
    { ref: 'r_cam_resolution', kpi: 'resolution',  op: '>=', value: 10 },
    { ref: 'r_cam_mount',      kpi: 'fovCoverage', op: '>=', value: 1 },
  ])
})

// ── projectResolutionOrder ────────────────────────────────────────────────────

test('resolution order: conflict precedes the cluster that contains its variable', () => {
  const ctx = loadScenario()
  const order = projectResolutionOrder(ctx, validateContext(ctx))
  assert.equal(order.length, 2)

  assert.equal(order[0].kind, 'conflict')
  assert.equal(order[0].ref, 'conflict_v_camera_standoff')
  assert.equal(order[0].order, 0)
  assert.equal(order[0].decisionKind, 'single')
  assert.equal(order[0].resolvedBy, 'd_standoff')
  assert.deepStrictEqual(order[0].dependsOn, [])

  assert.equal(order[1].kind, 'cluster')
  assert.equal(order[1].ref, 'nc_v_camera_standoff+v_robot_base_x')
  assert.equal(order[1].order, 1)
  assert.equal(order[1].decisionKind, 'n-ary')
  assert.equal(order[1].resolvedBy, 'd_cell_joint')
  assert.deepStrictEqual(order[1].dependsOn, ['conflict_v_camera_standoff'])
  assert.deepStrictEqual(order[1].actors, ['robot_engineer', 'vision_engineer'])
})

// ── edge cases ────────────────────────────────────────────────────────────────

test('edge: empty context yields empty matrix and empty order', () => {
  const empty = { actors: [], variables: [], requirements: [] }
  const result = { conflicts: [], negotiationClusters: [] }
  const matrix = projectConflictMatrix(empty, result)
  assert.deepStrictEqual(matrix.actors, [])
  assert.deepStrictEqual(matrix.variables, [])
  assert.deepStrictEqual(matrix.cells, {})
  assert.deepStrictEqual(projectResolutionOrder(empty, result), [])
})

test('edge: conflicts with no clusters are all independent leaves, ordered by ref', () => {
  const ctx = { requirements: [
    { ref: 'r_a', by: 'act_a' }, { ref: 'r_b', by: 'act_b' },
    { ref: 'r_c', by: 'act_c' }, { ref: 'r_d', by: 'act_d' },
  ] }
  const result = {
    conflicts: [
      { ref: 'conflict_v2', variable: 'v2', between: ['r_c', 'r_d'], gap: [1, 2] },
      { ref: 'conflict_v1', variable: 'v1', between: ['r_a', 'r_b'], gap: [3, 4] },
    ],
    negotiationClusters: [],
  }
  const order = projectResolutionOrder(ctx, result)
  assert.deepStrictEqual(order.map(s => s.ref), ['conflict_v1', 'conflict_v2'])
  assert.ok(order.every(s => s.kind === 'conflict' && s.dependsOn.length === 0))
})

test('purity: inputs are not mutated (PHILOSOPHY #6)', () => {
  const ctx = loadScenario()
  const result = validateContext(ctx)
  const ctxBefore = JSON.parse(JSON.stringify(ctx))
  const resultBefore = JSON.parse(JSON.stringify(result))
  projectConflictMatrix(ctx, result)
  projectResolutionOrder(ctx, result)
  assert.deepStrictEqual(ctx, ctxBefore)
  assert.deepStrictEqual(result, resultBefore)
})
