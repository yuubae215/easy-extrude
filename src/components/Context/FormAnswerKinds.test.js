/**
 * Every answer kind has a widget and an application (ADR-165 PR1).
 *
 * A form question is the projection of an OpenQuestion (FormProjection). For
 * the "answer everything → the form empties" property to hold *on screen*,
 * each answer kind needs both halves: a widget in FormPanel that collects the
 * answer, and a case in FormApplication that writes it. The application half
 * already throws when missing; the widget half had no check, and R10's `owner`
 * kind shipped with no widget at all — the question rendered with nothing to
 * press (PHILOSOPHY #11). This census counts the kinds against both files.
 *
 * The population is ANSWER_KIND itself, not the branches that exist
 * (PHILOSOPHY #31).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { ANSWER_KIND } from '../../context/FormProjection.js'

const here = dirname(fileURLToPath(import.meta.url))
const panel = readFileSync(join(here, 'FormPanel.jsx'), 'utf8')
const application = readFileSync(join(here, '..', '..', 'context', 'FormApplication.js'), 'utf8')

const count = (src, re) => (src.match(re) ?? []).length

test('every ANSWER_KIND has exactly one widget branch in FormPanel', () => {
  const missing = Object.keys(ANSWER_KIND)
    .filter(k => count(panel, new RegExp(`answerKind === ANSWER_KIND\\.${k}\\b`, 'g')) !== 1)
  assert.deepEqual(missing, [], `widget の無い (または二重の) 答えの種: ${missing.join(', ')}`)
})

test('every ANSWER_KIND has exactly one application case in FormApplication', () => {
  const missing = Object.values(ANSWER_KIND)
    .filter(v => count(application, new RegExp(`case '${v}':`, 'g')) !== 1)
  assert.deepEqual(missing, [], `適用の無い (または二重の) 答えの種: ${missing.join(', ')}`)
})
