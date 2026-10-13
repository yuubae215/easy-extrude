/**
 * IdleMotionMath — the governed idle loop (ADR-166 M4d1).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  IDLE_PERIOD, idleBreath, idleLevel, DASH_MARCH_SPEED, dashMarch,
} from './IdleMotionMath.js'
import { BREACH_PERIOD, breachPulse } from './LinkMotionMath.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

test('every declared idle period lies in the idle band (2–6 s), urgency shortest', () => {
  for (const [name, p] of Object.entries(IDLE_PERIOD)) {
    assert.ok(p >= 2 && p <= 6, `${name} = ${p} s is outside the idle band`)
  }
  assert.ok(IDLE_PERIOD.breach < IDLE_PERIOD.draft && IDLE_PERIOD.draft < IDLE_PERIOD.unresolved)
})

test('the link breach is one row of the same table — one source for the breath', () => {
  assert.equal(BREACH_PERIOD, IDLE_PERIOD.breach)
  for (const t of [0, 0.37, 1.9, 12.5]) {
    assert.equal(breachPulse(t, 'link-7'), idleBreath(t, 'link-7', IDLE_PERIOD.breach))
  }
})

test('the breath is periodic and bounded', () => {
  const P = IDLE_PERIOD.draft
  for (const t of [0, 0.4, 1.3, 2.9]) {
    const b = idleBreath(t, 'a', P)
    assert.ok(b >= 0 && b <= 1)
    assert.ok(close(b, idleBreath(t + P, 'a', P), 1e-9))
  }
})

test('N waiting things do not breathe in lockstep — phase comes from identity', () => {
  const keys = ['pedestal_base', 'pedestal_column', 'conveyor_bed', 'req_zone_a', 'intake']
  const t = 1.234
  const values = new Set(keys.map(k => idleBreath(t, k, IDLE_PERIOD.draft).toFixed(6)))
  assert.equal(values.size, keys.length)
  // Same identity → same frame (deterministic, no hidden state).
  assert.equal(idleBreath(t, 'req_zone_a', 3), idleBreath(t, 'req_zone_a', 3))
})

test('reduced motion rests at the middle of the range — not an extreme', () => {
  for (const t of [0, 0.7, 2.2]) {
    assert.equal(idleLevel(t, 'x', IDLE_PERIOD.unresolved, 0.08, 0.16, true), 0.12)
    assert.equal(idleBreath(t, 'x', IDLE_PERIOD.unresolved, true), 0)
  }
  // An unknown clock is the same rest.
  assert.equal(idleLevel(NaN, 'x', 3, 0.12, 0.24), 0.18)
})

test('the level stays within [lo, hi] and spans it over a period', () => {
  const P = IDLE_PERIOD.draft
  let min = Infinity, max = -Infinity
  for (let i = 0; i <= 600; i++) {
    const v = idleLevel((i / 600) * P, 'k', P, 0.12, 0.24)
    min = Math.min(min, v); max = Math.max(max, v)
  }
  assert.ok(min >= 0.12 - 1e-12 && max <= 0.24 + 1e-12)
  assert.ok(min < 0.121 && max > 0.239)
})

// ── The marching ants ────────────────────────────────────────────────────────

test('the march is a function of elapsed time — asking twice at the same instant does not step it', () => {
  // The defect it replaces: `+= 0.018` per CALL — an extra off-loop call moved the dashes,
  // and the speed was the frame rate. Same request, twice → same value.
  assert.equal(dashMarch(0.5), dashMarch(0.5))
  // 30 fps and 144 fps sampling land on the same offset at the same time.
  const at30 = Array.from({ length: 31 }, (_, i) => dashMarch(i / 30)).at(-1)
  const at144 = Array.from({ length: 145 }, (_, i) => dashMarch(i / 144)).at(-1)
  assert.ok(close(at30, at144))
  assert.ok(close(dashMarch(1), -DASH_MARCH_SPEED))
})

test('the march scrolls source → target (negative) and holds under reduced motion or before the clock', () => {
  assert.ok(dashMarch(0.25) < 0)
  assert.equal(dashMarch(0.25, true), 0)
  assert.equal(dashMarch(NaN), 0)
  assert.equal(dashMarch(0), 0)
  assert.equal(dashMarch(-1), 0)
})
