/**
 * The concept model document and the code say the same words (ADR-168).
 *
 * `docs/SPATIAL_RELATION_MODEL.md` is where the vocabulary is grown by people
 * (語彙は主観で変化する — 当事者 2026-10-21); `src/domain/arrangement.js` is
 * where the machine reads it. A word added on one side only is a second source
 * that has started to drift (§1.1), so the two are compared in BOTH directions:
 *
 *   1. every declarable word of the domain appears in §3 of the document;
 *   2. every backticked word in the first column of §3 is declarable — or is
 *      one of the observed-only values the document names as such.
 *
 * The population of (2) is the document's own table, not a list kept here
 * (a list kept here would be a third copy — ADR-102).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CONTACTS, FACE_TOWARD, ABSOLUTE_TOWARD, RELATIVE_DIRS } from './domain/arrangement.js'
import { OBSERVED_CONTACT } from './domain/arrangementGeometry.js'

const doc = readFileSync(new URL('../docs/SPATIAL_RELATION_MODEL.md', import.meta.url), 'utf8')

/** The rows of §3's table (between its heading and the next `##`). */
function wordTableRows() {
  const start = doc.indexOf('## 3.')
  assert.ok(start >= 0, '§3 (the word table) is missing from the model document')
  const end = doc.indexOf('\n## ', start + 1)
  return doc.slice(start, end < 0 ? undefined : end)
    .split('\n')
    .filter(l => l.startsWith('| ') && !l.startsWith('| 語') && !l.startsWith('|---'))
}

const firstColumnWords = () => wordTableRows()
  .flatMap(row => [...row.split('|')[1].matchAll(/`([^`]+)`/g)].map(m => m[1]))

const DECLARABLE = [...CONTACTS, ...FACE_TOWARD, ...ABSOLUTE_TOWARD, ...RELATIVE_DIRS]

test('every declarable word of the domain is in the document\'s word table', () => {
  const words = new Set(firstColumnWords())
  const missing = DECLARABLE.filter(w => !words.has(w))
  assert.deepEqual(missing, [], `declarable in code but absent from docs/SPATIAL_RELATION_MODEL.md §3: ${missing.join(', ')}`)
})

test('every word in the document\'s word table is declarable in code', () => {
  const extra = firstColumnWords().filter(w => !DECLARABLE.includes(w))
  assert.deepEqual(extra, [], `in docs/SPATIAL_RELATION_MODEL.md §3 but not declarable in code: ${extra.join(', ')}`)
})

test('the observed-only contact values are named by the document as observed-only', () => {
  const observedOnly = Object.values(OBSERVED_CONTACT).filter(v => !CONTACTS.includes(v))
  for (const v of observedOnly) {
    assert.match(doc, new RegExp(`観測だけに在る値[^\\n]*\`${v}\``), `"${v}" is observable but the document does not say it is observed-only`)
  }
})
