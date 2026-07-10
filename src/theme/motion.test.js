/**
 * motion.test.js — pins the ADR-065 Phase 1 single-boundary rule: the ONLY
 * place in `src/` that mentions the reduced-motion media query is
 * `src/theme/motion.js`. A second matchMedia read of this query anywhere else
 * is a forked boundary (核 §1.1) and fails here (ADR-065 named rule 2:
 * "matchMedia 呼び出しはちょうど 1 箇所 — grep 可能なテストで固定").
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'
import { prefersReducedMotion, onReducedMotionChange, REDUCED_MOTION_QUERY } from './motion.js'

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(js|jsx|ts|tsx)$/.test(name)) yield p
  }
}

// A matchMedia READ of the reduced-motion query: either the query inlined as a
// string, or the exported constant passed back in. Prose mentions in comments
// are fine — the rule pins the side-effect read, not the vocabulary.
const READ_PATTERN = /matchMedia\s*\(\s*(['"`][^'"`]*prefers-reduced-motion|REDUCED_MOTION_QUERY)/

test('the reduced-motion matchMedia read exists in exactly one src module', () => {
  const offenders = []
  let boundaryReads = 0
  for (const file of walk(srcRoot)) {
    const rel = relative(srcRoot, file)
    const hits = (readFileSync(file, 'utf8').match(new RegExp(READ_PATTERN, 'g')) ?? []).length
    if (rel === join('theme', 'motion.js')) { boundaryReads = hits; continue }
    if (rel === join('theme', 'motion.test.js')) continue
    if (hits > 0) offenders.push(rel)
  }
  assert.deepEqual(offenders, [],
    'reduced-motion must be read only through src/theme/motion.js (re-export it; never call matchMedia inline)')
  assert.ok(boundaryReads >= 1, 'the single boundary itself must perform the read')
})

test('non-browser environment degrades to motion-allowed with no-op unsubscribe', () => {
  assert.equal(prefersReducedMotion(), false)
  const unsub = onReducedMotionChange(() => {})
  assert.equal(typeof unsub, 'function')
  unsub() // must not throw
  assert.equal(REDUCED_MOTION_QUERY, '(prefers-reduced-motion: reduce)')
})
