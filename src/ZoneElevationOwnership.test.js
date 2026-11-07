/**
 * ZoneElevationOwnership.test.js — "one thing stands on one height" (ADR-170 D5)
 * has an asker at every place it can be broken, and no unasked writer.
 *
 * The rule is broken from four sides: declaring a belonging (`createSpatialLink`
 * with `contains`), moving a zone to another height (the translation entry),
 * turning a Region into a zone (`setPlaceType`), and a loaded file. A census of
 * the CURRENT askers would pass the day a fifth caller appears without asking
 * (原則 #31 — the missing guard has no node to visit), so the population is the
 * CALLERS, derived from the code: every file that calls the write must either
 * ask the named question first or be declared as restoration.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, stripComments, extractMethodBody } from './census/sources.js'
import { relPath, repoPath } from './census/sources.js'

const SERVICE = 'src/service/SceneService.js'

/**
 * Writes that can break D5, the question that must be asked before each, and
 * the callers that are declared as restoration (they replay a state that
 * already passed the question — re-asking would make undo asymmetric).
 */
const GUARDED_WRITES = [
  {
    name:     'declaring a belonging (createSpatialLink)',
    call:     /\.createSpatialLink\s*\(/,
    question: /spatialLinkRefusal\s*\(/,
    restoration: {},
  },
  {
    name:     'turning a Region into a zone (setPlaceType)',
    call:     /(?:_service|sceneService|service)\.setPlaceType\s*\(/,
    question: /placeTypeRefusal\s*\(/,
    restoration: {
      'src/command/SetPlaceTypeCommand.js':
        'undo / redo replay a placeType that already passed the question',
      'src/controller/place/PlaceToolController.js':
        'the region was created on the line above: it contains nothing yet, so becoming a zone moves no one',
    },
  },
]

/** How far above the write the question may be asked (same handler body). */
const WINDOW = 8

test('every caller of a D5-breaking write asks its question first, or is declared restoration (ADR-170)', () => {
  const violations = []
  for (const rule of GUARDED_WRITES) {
    for (const abs of collectSources()) {
      const rel = relPath(abs)
      if (rel === SERVICE || rel.endsWith('.test.js')) continue
      const lines = stripComments(readFileSync(abs, 'utf8'))
      lines.forEach((line, i) => {
        if (!rule.call.test(line)) return
        if (rule.restoration[rel]) return
        const window = lines.slice(Math.max(0, i - WINDOW), i + 1).join('\n')
        if (!rule.question.test(window)) {
          violations.push(`${rel}:${i + 1} — ${rule.name} without asking ${rule.question} first`)
        }
      })
    }
  }
  assert.deepEqual(violations, [], `\n${violations.join('\n')}\n`)
})

test('the declared restorations still exist (a stale declaration is not a guard)', () => {
  for (const rule of GUARDED_WRITES) {
    for (const rel of Object.keys(rule.restoration)) {
      const src = stripComments(readFileSync(repoPath(rel), 'utf8')).join('\n')
      assert.match(src, rule.call, `${rel} is declared restoration for "${rule.name}" but no longer calls it`)
    }
  }
})

test('the service asks the questions where the writes happen (the asker is not hollow)', () => {
  const lines = stripComments(readFileSync(repoPath(SERVICE), 'utf8'))
  const body = (name) => {
    const m = extractMethodBody(lines, name)
    assert.ok(m, `${SERVICE} has no ${name}()`)
    return m.body.join('\n')
  }
  assert.match(body('createSpatialLink'), /this\.spatialLinkRefusal\s*\(/,
    'createSpatialLink no longer refuses a second-height belonging (the backstop is gone)')
  assert.match(body('_policyDelta'), /this\.zoneElevationRefusal\s*\(/,
    '_policyDelta no longer asks before moving a zone to another height')
  assert.match(body('applyPreviewTranslation'), /refused:/,
    'applyPreviewTranslation no longer hands the refusal back — the gesture would stop silently (原則 #11)')

  const validator = readFileSync(repoPath('src/layout/LayoutValidator.js'), 'utf8')
  assert.match(validator, /zoneElevationConflicts\s*\(/, 'a loaded file is no longer checked for D5')
})
