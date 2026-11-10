/**
 * ZoneOverlapOwnership.test.js — who may write the facts ADR-170 S3 put on screen,
 * counted from the code rather than remembered (原則 #31).
 *
 *   the conflict light on a plate   → one writer: ZoneOwnershipController (原則 #4)
 *   a zone's owner                  → one writer of the document edit: ContextController
 *   "is this point inside that ring" → one closed form: domain/planar.js (before S3
 *     it was copied in SceneService and SemanticInferencer — a third use would
 *     have made a third copy)
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, stripComments, relPath } from './census/sources.js'

function callersOf(pattern, { skip = [] } = {}) {
  const out = []
  for (const abs of collectSources()) {
    const rel = relPath(abs)
    if (rel.endsWith('.test.js') || skip.includes(rel)) continue
    stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
      if (pattern.test(line)) out.push(`${rel}:${i + 1}`)
    })
  }
  return out
}

test('the conflict light on a plate has exactly one writer (ADR-170 S3 / 原則 #4)', () => {
  const writers = callersOf(/\.setOwnerConflict\??\.?\s*\(/, { skip: ['src/view/AnnotatedRegionView.js'] })
  assert.deepEqual(writers.map(w => w.split(':')[0]), ['src/controller/ZoneOwnershipController.js'], writers.join('\n'))
})

test('a zone\'s owner is written through one document edit (ADR-170 O2)', () => {
  const writers = callersOf(/\bdeclareZoneOwner\s*\(/, { skip: ['src/context/Ownership.js'] })
    .filter(w => !w.startsWith('src/controller/ContextController.js') && !w.startsWith('src/controller/AppController.js'))
  assert.deepEqual(writers, [], 'declareZoneOwner is called outside ContextController (and the AppController callback that calls it)')
  const app = callersOf(/\bdeclareZoneOwner\s*\(/).filter(w => w.startsWith('src/controller/AppController.js'))
  assert.equal(app.length, 1, 'the panel callback is the one UI entry')
  const appSrc = readFileSync(new URL('./controller/AppController.js', import.meta.url), 'utf8')
  assert.match(appSrc, /this\._ctxCtrl\.declareZoneOwner\(/, 'the UI entry goes through ContextController')
})

test('point-in-polygon is written once, in domain/planar.js', () => {
  const copies = callersOf(/function\s+\w*[Pp]oint[Ii]n[Pp]olygon\w*\s*\(/)
  assert.deepEqual(copies.map(c => c.split(':')[0]), ['src/domain/planar.js'], copies.join('\n'))
})
