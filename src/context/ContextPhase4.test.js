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
import { projectConflictMatrix, projectResolutionOrder, projectRegionGhosts } from './PersonaProjection.js'

const here = dirname(fileURLToPath(import.meta.url))

const loadScenario = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_conflict_context.json'), 'utf8'))

const loadRegionScenario = () =>
  JSON.parse(readFileSync(join(here, '../../examples/cell_region_context.json'), 'utf8'))

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

// ── projectConflictMatrix: n-ary approval gate (ADR-049 Phase 4) ──────────────

test('approval gate: an unapproved resolving Decision reads state:proposed', () => {
  const ctx = loadScenario()
  // approvedRefs provided but empty → d_standoff is on the table, not yet agreed.
  const matrix = projectConflictMatrix(ctx, validateContext(ctx), { approvedRefs: new Set() })
  assert.equal(matrix.cells['vision_engineer|v_camera_standoff'].state, 'proposed')
  assert.equal(matrix.cells['robot_engineer|v_camera_standoff'].state, 'proposed')
  assert.equal(matrix.variableSummary.v_camera_standoff.resolvedBy, 'd_standoff')
  assert.equal(matrix.variableSummary.v_camera_standoff.approved, false)
})

test('approval gate: approving the Decision flips the cells to resolved', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx), { approvedRefs: new Set(['d_standoff']) })
  assert.equal(matrix.cells['vision_engineer|v_camera_standoff'].state, 'resolved')
  assert.equal(matrix.cells['robot_engineer|v_camera_standoff'].state, 'resolved')
  assert.equal(matrix.variableSummary.v_camera_standoff.approved, true)
})

test('approval gate: omitting approvedRefs preserves resolved (backward compat)', () => {
  const ctx = loadScenario()
  const matrix = projectConflictMatrix(ctx, validateContext(ctx)) // no gate
  assert.equal(matrix.cells['vision_engineer|v_camera_standoff'].state, 'resolved')
  assert.equal(matrix.variableSummary.v_camera_standoff.approved, true)
})

test('resolution order: approved flag gates on the approvedRefs set', () => {
  const ctx = loadScenario()
  const result = validateContext(ctx)
  const none = projectResolutionOrder(ctx, result, { approvedRefs: new Set() })
  assert.deepStrictEqual(none.map(s => s.approved), [false, false])

  // Approving only the upstream single conflict leaves the n-ary cluster pending.
  const partial = projectResolutionOrder(ctx, result, { approvedRefs: new Set(['d_standoff']) })
  assert.equal(partial[0].approved, true)   // conflict_v_camera_standoff
  assert.equal(partial[1].approved, false)  // cluster, still awaiting d_cell_joint

  const all = projectResolutionOrder(ctx, result, { approvedRefs: new Set(['d_standoff', 'd_cell_joint']) })
  assert.deepStrictEqual(all.map(s => s.approved), [true, true])
})

test('resolution order: omitting approvedRefs reads approved (backward compat)', () => {
  const ctx = loadScenario()
  const order = projectResolutionOrder(ctx, validateContext(ctx)) // no gate
  assert.deepStrictEqual(order.map(s => s.approved), [true, true])
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

// ── projectRegionGhosts (ADR-049 §5.3 actor-coloured region overlay) ──────────

test('region ghosts: one ghost per region variable, actors in ctx order', () => {
  const ctx    = loadRegionScenario()
  const ghosts = projectRegionGhosts(ctx, validateContext(ctx))
  // Only v_base_footprint is a region Variable; v_camera_standoff is scalar (skipped).
  assert.equal(ghosts.length, 1)
  const g = ghosts[0]
  assert.equal(g.variable, 'v_base_footprint')
  assert.deepStrictEqual(g.axes, ['x', 'y'])
  // mech_engineer precedes vision_engineer in ctx.actors → deterministic palette order.
  assert.deepStrictEqual(g.regions.map(r => r.actor), ['mech_engineer', 'vision_engineer'])
  assert.deepStrictEqual(g.regions.map(r => r.requirement), ['r_mech_footprint', 'r_vision_footprint'])
})

test('region ghosts: disjoint footprints intersect empty on x — the conflict is visible', () => {
  const ctx    = loadRegionScenario()
  const ghosts = projectRegionGhosts(ctx, validateContext(ctx))
  const g = ghosts[0]
  // vision x[600,1200] vs mech x[1300,1800] → empty on x; y overlaps.
  assert.equal(g.intersection.empty, true)
  assert.deepStrictEqual(g.intersection.emptyAxes, ['x'])
  assert.deepStrictEqual(g.intersection.gap.x, [1200, 1300]) // [hi, lo] no-man's-land
  assert.equal(g.inConflict, true)
  assert.equal(g.conflictRef, 'conflict_v_base_footprint')
})

test('region ghosts: state reflects the approval gate (proposed → resolved)', () => {
  const ctx    = loadRegionScenario()
  const result = validateContext(ctx)
  // No gate → resolvedBy reads resolved (backward-compat seam).
  assert.equal(projectRegionGhosts(ctx, result)[0].state, 'resolved')
  // Gate, nothing approved → the resolving Decision is only proposed.
  assert.equal(projectRegionGhosts(ctx, result, { approvedRefs: new Set() })[0].state, 'proposed')
  // Gate with d_footprint approved → resolved.
  assert.equal(
    projectRegionGhosts(ctx, result, { approvedRefs: new Set(['d_footprint']) })[0].state,
    'resolved',
  )
  // The resolving Decision's nominal is surfaced for the agreement-zone label.
  assert.deepStrictEqual(projectRegionGhosts(ctx, result)[0].nominal, { x: 1250, y: 0 })
})

test('region ghosts: purity — inputs are not mutated (PHILOSOPHY #6)', () => {
  const ctx    = loadRegionScenario()
  const result = validateContext(ctx)
  const ctxBefore = JSON.parse(JSON.stringify(ctx))
  projectRegionGhosts(ctx, result, { approvedRefs: new Set(['d_footprint']) })
  assert.deepStrictEqual(ctx, ctxBefore)
})
