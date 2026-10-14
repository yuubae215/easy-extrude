/**
 * The node editor's "just updated" light is its own fact (ADR-166 M4d4).
 *
 * It used to borrow the selection: `_flashNode` set `_selectedId` for 400 ms
 * and put the previous value back, so the selection drew two facts and a pick
 * made inside the window was silently reverted (原則 #4 — two writers of one
 * visual, last write wins). The light now lives in `_flashedAt`, and the
 * selection has exactly the writers that mean "the user picked this".
 *
 * Counted by METHOD, not by line (the M4d3b lesson): the allowed set is
 * declared, and an empty or grown set fails (原則 #31).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const SRC = readFileSync(fileURLToPath(new URL('./NodeEditorView.js', import.meta.url)), 'utf8')

/** The methods allowed to write `this._selectedId`. */
const SELECTION_WRITERS = ['constructor', '_selectNode']

/** Name of the class method enclosing each line (2-space indented `name(…) {`). */
function methodOfEachLine(src) {
  let current = null
  return src.split('\n').map(line => {
    const m = /^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/.exec(line)
    if (m) current = m[1]
    return current
  })
}

test('only the pick writes the node editor selection — the update light never borrows it', () => {
  const owners = methodOfEachLine(SRC)
  const writers = new Set()
  SRC.split('\n').forEach((line, i) => {
    if (/this\._selectedId\s*=[^=]/.test(line)) writers.add(owners[i])
  })
  assert.deepEqual([...writers].sort(), [...SELECTION_WRITERS].sort(),
    'a new writer of `_selectedId` — if it is not a user pick, it is a second fact riding the selection')
})

test('the update light has its own field and is drawn from elapsed time', () => {
  const owners = methodOfEachLine(SRC)
  const lines = SRC.split('\n')
  const flashWriters = new Set(lines.flatMap((l, i) => /this\._flashedAt\.(set|delete)\(/.test(l) ? [owners[i]] : []))
  assert.deepEqual([...flashWriters], ['_flashNode'])
  assert.match(SRC, /updateFlash\(performance\.now\(\) - flashedAt/,
    'the light is placed by elapsed time so a redraw mid-flash continues it')
})
