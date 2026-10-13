/**
 * LayoutPlanMath.test.js — the floor plan on a launch Home card (ADR-166 M4c).
 *
 * What this evidence structurally misses (declared): whether a plan READS as
 * its cell to a person — that is the owner's eye on the real screen
 * (`docs/motion/media/m4c-*.png`), not a number.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { compileLayout } from '../layout/LayoutCompiler.js'
import { LAYOUT_TEMPLATE_CATALOG } from '../layout/LayoutTemplateCatalog.js'
import {
  PLAN_FRAME, PLAN_ROLE_BY_TYPE, PLAN_LIGHT_SPREAD,
  layoutPlan, layoutPlanOf, planLightDelay, poolBreathTiming, planTones,
} from './LayoutPlanMath.js'
import { STAGE, STAGE_LIGHT } from './StageMath.js'

const readExample = (file) =>
  JSON.parse(readFileSync(new URL(`../../examples/${file}`, import.meta.url), 'utf8'))

const coords = (points) => points.split(' ').map(s => s.split(',').map(Number))

function allPoints(plan) {
  const out = []
  for (const k of ['zones', 'lines', 'bodies']) for (const it of plan[k]) out.push(...coords(it.points))
  for (const k of ['robots', 'marks']) for (const it of plan[k]) out.push([it.x, it.y])
  return out
}

// ── population: every card that has an example has a plan (原則 #31) ─────────

test('every example template in the Home catalog has a non-empty plan; Empty declares it has none', () => {
  for (const t of LAYOUT_TEMPLATE_CATALOG) {
    if (t.source.kind === 'empty') continue   // declared absence: the Empty card draws no plan
    assert.equal(t.source.kind, 'example', `catalog kind "${t.source.kind}" has no plan rule — declare one`)
    const plan = layoutPlanOf(readExample(t.source.file))   // the call AppController makes
    assert.ok(plan, `${t.id}: no plan`)
    assert.ok(plan.bodies.length > 0, `${t.id}: a plan with no bodies says nothing about the cell`)
    assert.ok(plan.zones.length > 0, `${t.id}: the cell floor (Zone) is the pool of light`)
  }
})

test('every plan fits the card frame, and touches it on at least one axis (uniform fit)', () => {
  const { w, h, pad } = PLAN_FRAME
  for (const t of LAYOUT_TEMPLATE_CATALOG.filter(t => t.source.kind === 'example')) {
    const pts = allPoints(layoutPlan(compileLayout(readExample(t.source.file))))
    for (const [x, y] of pts) {
      assert.ok(x >= pad - 0.01 && x <= w - pad + 0.01, `${t.id}: x=${x} outside the frame`)
      assert.ok(y >= pad - 0.01 && y <= h - pad + 0.01, `${t.id}: y=${y} outside the frame`)
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
    const fillsX = Math.abs(Math.min(...xs) - pad) < 0.02 && Math.abs(Math.max(...xs) - (w - pad)) < 0.02
    const fillsY = Math.abs(Math.min(...ys) - pad) < 0.02 && Math.abs(Math.max(...ys) - (h - pad)) < 0.02
    assert.ok(fillsX || fillsY, `${t.id}: the plan should fill the frame on one axis`)
  }
})

test('a cell in mm and the same cell in m draw identically (scale-free — PHILOSOPHY #27)', () => {
  const mm = compileLayout(readExample('layout_palletizing.json'))
  const scaleObj = (o, k) => JSON.parse(JSON.stringify(o, (key, v) =>
    (['x', 'y', 'z'].includes(key) && typeof v === 'number') ? v * k : v))
  const m = { ...mm, objects: mm.objects.map(o => scaleObj(o, 0.001)) }
  assert.deepEqual(layoutPlan(m), layoutPlan(mm))
})

test('+Y is up the card (ROS world, SVG y negated)', () => {
  const box = (id, x, y) => ({
    type: 'Solid', id, position: { x, y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    localCorners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: a, y: b, z: 0 })),
  })
  const plan = layoutPlan({ objects: [box('south', 0, 0), box('north', 0, 10)] })
  const cy = (k) => { const c = coords(plan.bodies.find(b => b.key === k).points); return c.reduce((a, p) => a + p[1], 0) / c.length }
  assert.ok(cy('north') < cy('south'), 'the body at larger +Y must be higher on the card')
})

test('a yawed Solid draws its rotated footprint, not its axis-aligned box', () => {
  const s = Math.SQRT1_2
  const solid = {
    type: 'Solid', id: 'yawed', position: { x: 0, y: 0, z: 0 },
    orientation: { x: 0, y: 0, z: Math.sin(Math.PI / 8), w: Math.cos(Math.PI / 8) },   // 45° about +Z
    localCorners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: a, y: b, z: 0 })),
  }
  const pts = coords(layoutPlan({ objects: [solid] }).bodies[0].points)
  // A 45°-yawed square is a diamond: its 4 corners sit on the frame's axes.
  const { w, h } = PLAN_FRAME
  const onAxis = pts.filter(([x, y]) => Math.abs(x - w / 2) < 0.05 || Math.abs(y - h / 2) < 0.05)
  assert.equal(onAxis.length, 4, `expected a diamond, got ${JSON.stringify(pts)} (s=${s})`)
})

// ── identity: robot base through the one predicate ──────────────────────────

test('only robot bases are drawn among frames — Origin, mount and TCP frames are not on a plan', () => {
  const plan = layoutPlan(compileLayout(readExample('layout_pick_place_cell.json')))
  assert.deepEqual(plan.robots.map(r => r.key), ['cf_robot_base'])
})

test('a robot base parented under a Solid lands at its composed world position', () => {
  const solid = {
    type: 'Solid', id: 's', position: { x: 10, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 },
    localCorners: [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: a, y: b, z: 0 })),
  }
  const base = { type: 'CoordinateFrame', id: 'b', name: 'robot_base', robotRole: 'base', parentId: 's', translation: { x: 0, y: 0, z: 5 } }
  const plan = layoutPlan({ objects: [solid, base] })
  const body = coords(plan.bodies[0].points)
  const cx = body.reduce((a, p) => a + p[0], 0) / 4
  assert.ok(Math.abs(plan.robots[0].x - cx) < 0.01, 'the base sits over its Solid')
})

test('a frame with a broken parent chain is not drawn (never a guessed position — #11)', () => {
  const zone = { type: 'AnnotatedRegion', id: 'z', placeType: 'Zone', vertices: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }] }
  const orphan = { type: 'CoordinateFrame', id: 'b', robotRole: 'base', parentId: 'missing', translation: { x: 0, y: 0, z: 0 } }
  assert.equal(layoutPlan({ objects: [zone, orphan] }).robots.length, 0)
})

// ── cardinality: 0 and undeclared types ─────────────────────────────────────

test('nothing to draw → null, not an empty frame', () => {
  assert.equal(layoutPlan({ objects: [] }), null)
  assert.equal(layoutPlan(null), null)
  assert.equal(layoutPlan({ objects: [{ type: 'CoordinateFrame', id: 'o', name: 'Origin', parentId: null }] }), null)
})

test('an entity type with no declared plan role throws (PHILOSOPHY #31)', () => {
  assert.throws(() => layoutPlan({ objects: [{ type: 'Mystery', id: 'x' }] }), /no plan role declared/)
})

test('every entity type the compiler can emit has a declared plan role', () => {
  const src = readFileSync(new URL('../layout/LayoutCompiler.js', import.meta.url), 'utf8')
  const block = /const ENTITY_PREFIX = \{([\s\S]*?)\}/.exec(src)[1]
  const types = [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1])
  assert.ok(types.length >= 5)
  assert.deepEqual(types.filter(t => !Object.hasOwn(PLAN_ROLE_BY_TYPE, t)), [])
})

// ── choreography ────────────────────────────────────────────────────────────

test('the light comes on outward from the robot base: order 0 at the robot, 1 at the farthest item', () => {
  const plan = layoutPlan(compileLayout(readExample('layout_palletizing.json')))
  assert.equal(plan.robots[0].order, 0)
  assert.equal(plan.pool.x, plan.robots[0].x)
  const orders = ['zones', 'bodies', 'robots', 'marks'].flatMap(k => plan[k].map(i => i.order))
  assert.equal(Math.max(...orders), 1)
  assert.ok(orders.every(o => o >= 0 && o <= 1))
})

test('without a robot the light falls on the middle of the cell', () => {
  const plan = layoutPlan(compileLayout(readExample('layout_conveyor_line.json')))
  assert.deepEqual([plan.pool.x, plan.pool.y], [PLAN_FRAME.w / 2, PLAN_FRAME.h / 2])
})

test('planLightDelay: after the card, spread across PLAN_LIGHT_SPREAD, malformed input clamps', () => {
  assert.equal(planLightDelay(48, 0), 48)
  assert.equal(planLightDelay(48, 1), 48 + PLAN_LIGHT_SPREAD)
  assert.equal(planLightDelay(NaN, 2), PLAN_LIGHT_SPREAD)
  assert.equal(planLightDelay(-5, NaN), 0)
})

test('N cards never breathe in lockstep: the pool breath is the stage breath, phased by identity', () => {
  const ids = LAYOUT_TEMPLATE_CATALOG.map(t => t.id)
  const timings = ids.map(poolBreathTiming)
  for (const t of timings) {
    assert.equal(t.periodMs, STAGE.breath.period * 1000, 'one breath for the stage and its previews')
    assert.ok(t.delayMs <= 0 && t.delayMs > -t.periodMs)
  }
  assert.equal(new Set(timings.map(t => t.delayMs)).size, ids.length, 'every card has its own phase')
})

test('the plan is lit by the one stage light (no colour of its own)', () => {
  assert.equal(planTones().light, STAGE_LIGHT.color)
  const plan = layoutPlan(compileLayout(readExample('layout_pick_place_cell.json')))
  for (const z of plan.zones) assert.match(z.tone, /^#[0-9a-f]{6}$/)
})
