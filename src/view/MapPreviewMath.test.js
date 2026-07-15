import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cursorFrame, ringFrame, CURSOR_POP, RING_POP } from './MapPreviewMath.js'

// ── reduced motion: EXACTLY the static cue (scale 1), never a skip ──────────

test('reduced motion yields identity scale for both cues', () => {
  assert.equal(cursorFrame(12.3, 10, true).scale, 1)
  assert.equal(ringFrame(12.3, 10, true).scale, 1)
})

// ── malformed clocks: honest stillness (#11), never NaN ─────────────────────

test('malformed clocks degrade to identity scale, never NaN', () => {
  for (const [t, born] of [[NaN, 0], [0, NaN], [Infinity, 0], [0, undefined]]) {
    assert.equal(cursorFrame(t, born).scale, 1)
    assert.equal(ringFrame(t, born).scale, 1)
  }
})

// ── entry pop: starts near zero, overshoots (easeOutBack), settles ──────────

test('cursor pop starts small and reaches the breathe envelope after CURSOR_POP', () => {
  const born = 5
  const start = cursorFrame(born, born).scale
  assert.ok(start < 0.1, `birth-frame scale should be tiny, got ${start}`)
  const settled = cursorFrame(born + CURSOR_POP + 1, born).scale
  // After the pop only the bounded breathe remains: 1 ± (0.06 + 0.035)
  assert.ok(settled > 0.9 && settled < 1.1, `settled ${settled} outside breathe band`)
})

test('ring pop settles to exactly 1 after RING_POP (a lock does not breathe)', () => {
  const born = 2
  assert.ok(ringFrame(born, born).scale < 0.1)
  assert.equal(ringFrame(born + RING_POP, born).scale, 1)
  assert.equal(ringFrame(born + 100, born).scale, 1)
})

// ── breathe: bounded and non-static (two non-integer-ratio sines) ───────────

test('cursor breathe stays bounded and actually moves', () => {
  const born = 0
  let min = Infinity, max = -Infinity
  for (let t = 1; t < 20; t += 0.05) {
    const s = cursorFrame(t, born).scale
    assert.ok(s > 0.85 && s < 1.15, `breathe out of band at t=${t}: ${s}`)
    if (s < min) min = s
    if (s > max) max = s
  }
  assert.ok(max - min > 0.02, 'idle motion must not be static under normal motion')
})
