/**
 * LayoutTemplateRobotUsability.test.js — every Home-screen sample scene that
 * claims a robot must load one Grasp Search can actually solve for.
 *
 * `layout_pick_place_cell.json` / `layout_palletizing.json` / `factory_layout.json`
 * used to draw their "robot" as a plain `Solid` box with a `frames` child named
 * `robot_base` — a name that only resolves under the pre-ADR-090 legacy path
 * (`parentId === null && name === 'robot_base'`). `LayoutCompiler` parents a
 * Solid's child frames under that Solid's auto-generated Origin CF, so
 * `parentId` was never null; the frame carried no `robotRole` either (only a
 * standalone `CoordinateFrame` entity gets one — see `LayoutCompiler.js`
 * `generateObjects`). `resolveRobots()` therefore found **zero** robots in all
 * three scenes, and `GraspController.run()` gated every one of them off with
 * `status: 'no-robot'` — despite the scene visibly containing a robot-shaped
 * box and a name/description saying so (原則 #11's mirror: the UI didn't lie,
 * but the sample content did).
 *
 * This enumerates the templates by id (原則 #31 — declare the expected
 * cardinality per template rather than asserting "whatever is there resolves"),
 * so a future sample that silently drops its robot frames fails loudly instead
 * of green.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { compileLayout } from './LayoutCompiler.js'
import { LAYOUT_TEMPLATE_CATALOG } from './LayoutTemplateCatalog.js'
import { resolveRobots, robotCardinality, ROBOT_CARDINALITY } from '../domain/robotFrames.js'

const here = dirname(fileURLToPath(import.meta.url))

function loadExample(file) {
  return JSON.parse(readFileSync(join(here, '../../examples', file), 'utf8'))
}

/** Declared expectation per template id — the population this test covers. */
const EXPECTED_CARDINALITY = Object.freeze({
  pick_place:    ROBOT_CARDINALITY.SINGLE,
  conveyor:      ROBOT_CARDINALITY.NONE,   // a conveyor line has no robot; that is correct, not missing
  palletizing:   ROBOT_CARDINALITY.SINGLE,
  factory_cell:  ROBOT_CARDINALITY.SINGLE,
})

test('every Layout-DSL example template declares the expected robot cardinality', () => {
  const exampleTemplates = LAYOUT_TEMPLATE_CATALOG.filter(t => t.source.kind === 'example')

  assert.deepEqual(
    exampleTemplates.map(t => t.id).sort(),
    Object.keys(EXPECTED_CARDINALITY).sort(),
    'LAYOUT_TEMPLATE_CATALOG gained/lost an example template — update EXPECTED_CARDINALITY above ' +
    '(the population is declared here, not discovered, so a new template starts UNCOVERED rather than silently passing).',
  )

  for (const meta of exampleTemplates) {
    const dsl = loadExample(meta.source.file)
    const { objects } = compileLayout(dsl)
    const robots = resolveRobots(objects)

    assert.equal(
      robotCardinality(robots), EXPECTED_CARDINALITY[meta.id],
      `${meta.id} (${meta.source.file}): expected robot cardinality ` +
      `"${EXPECTED_CARDINALITY[meta.id]}" but resolveRobots() found ${robots.length}. ` +
      'A robot must be a standalone CoordinateFrame with a declared robotRole ' +
      '("base" world-parented + "tcp" parented to it) — a decorative Solid ' +
      'box named/described as a robot does not make GraspController see one.',
    )

    if (EXPECTED_CARDINALITY[meta.id] === ROBOT_CARDINALITY.SINGLE) {
      assert.ok(
        robots[0].hasTcp,
        `${meta.id} (${meta.source.file}): the declared robot has no tcp frame — ` +
        'grasp declaration needs the complete base+tcp TF pair.',
      )
    }
  }
})
