/**
 * RobotStageLook — the arm's material look has ONE writer (ADR-166 M4d3b, 原則 #4).
 *
 * The arm's opacity is a product of three facts: the material's own, the
 * unverified ghost (ADR-144 D4) and the clock-driven arrival (M4d3b). Before
 * M4d3b two methods wrote materials directly (`_setUnverifiedLook`,
 * `setToolMount`). That was harmless while the look was a switch; once a
 * per-frame reader composes the arrival, any direct write is overwritten on the
 * next frame — a writer that does nothing (the M4d2 lesson). So the census is
 * by METHOD: which methods of `RobotStage` assign a material's opacity /
 * transparency / depth-write. The unit lane cannot build a stage (it needs a
 * DOM to parse the URDF), so the claim is checked on the source.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { repoPath, stripComments } from '../census/sources.js'

const FILE = 'src/view/RobotStage.js'
const LOOK_WRITE = /\.(opacity|transparent|depthWrite)\s*=[^=]/

/**
 * The only methods allowed to write a material's look, and what each may write.
 * `tick` writes the waiting light — a mesh of its own, not the arm.
 */
const ALLOWED = Object.freeze({
  _writeLook: /\bmaterial\.(opacity|transparent|depthWrite)\s*=/,
  tick: /this\._beacon\.material\.opacity\s*=/,
})

test('only _writeLook writes the arm\'s materials; tick writes only the waiting light', () => {
  const lines = stripComments(readFileSync(repoPath(FILE), 'utf8'))
  let method = null
  /** @type {string[]} */
  const violations = []
  const seen = new Set()
  lines.forEach((line, i) => {
    const m = /^ {2}(?:static\s+|async\s+|get\s+)?(\w+)\s*\(.*\)\s*\{\s*$/.exec(line)
    if (m) method = m[1]
    if (!LOOK_WRITE.test(line)) return
    const allowed = ALLOWED[method]
    if (allowed && allowed.test(line)) { seen.add(method); return }
    violations.push(`${FILE}:${i + 1} (${method}) ${line.trim()}`)
  })
  assert.deepEqual(violations, [], 'a second writer of the arm\'s look — set the fact and call _writeLook()')
  // Both allowed writers must exist: an empty census is not a pass (原則 #31).
  assert.deepEqual([...seen].sort(), Object.keys(ALLOWED).sort())
})
