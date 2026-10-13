/**
 * LinkMotionMath — the link's bind / strain / break, in the motion identity's
 * vocabulary (ADR-166 M4b).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BIND_TRAVEL, BIND_AFTERGLOW, BIND_TOTAL, BREACH_PERIOD, LINK_TONES,
  bindFrame, breachPulse, linkLineFrame, rippleFrame, hexToRgb,
} from './LinkMotionMath.js'
import { SELECT_LAND } from './CueFollowMath.js'
import { easeOutExpo } from './MotionMath.js'
import { COLOR } from '../theme/tokens.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

// ── Bound ────────────────────────────────────────────────────────────────────

test('the binding light lives in the response band and shares the selection tempo', () => {
  assert.equal(BIND_TRAVEL, SELECT_LAND)
  assert.ok(BIND_TRAVEL <= 0.3 && BIND_AFTERGLOW <= 0.3)
  assert.ok(close(BIND_TOTAL, BIND_TRAVEL + BIND_AFTERGLOW))
})

test('both beads reach the midpoint at the same instant — the meeting is the travel end', () => {
  // One progress drives both beads (src→mid and tgt→mid), so they meet by construction.
  assert.equal(bindFrame(0).travel, 0)
  assert.equal(bindFrame(BIND_TRAVEL).travel, 1)
  // The flash begins exactly at the meeting, not before.
  assert.equal(bindFrame(BIND_TRAVEL * 0.99).flashOpacity, 0)
  assert.equal(bindFrame(BIND_TRAVEL).flashOpacity, 1)
  assert.equal(bindFrame(BIND_TRAVEL).beadOpacity, 0)
})

test('the travel lands (outExpo) — never linear', () => {
  const mid = bindFrame(BIND_TRAVEL / 2).travel
  assert.ok(close(mid, easeOutExpo(0.5)))
  assert.ok(mid > 0.9, 'a landing launches near-instantly')
})

test('the afterglow fades (outQuad) and the flash grows on land; it ends', () => {
  const a = bindFrame(BIND_TRAVEL + BIND_AFTERGLOW * 0.25)
  const b = bindFrame(BIND_TRAVEL + BIND_AFTERGLOW * 0.75)
  assert.ok(a.lineGlow > b.lineGlow && b.lineGlow > 0)
  assert.ok(close(a.lineGlow, 1 - (1 - (1 - 0.25) ** 2)))   // 1 − outQuad(0.25)
  assert.ok(b.flashScale > a.flashScale && a.flashScale > 1)
  assert.equal(bindFrame(BIND_TOTAL).done, true)
  assert.equal(bindFrame(BIND_TOTAL - 0.01).done, false)
})

test('a clock that steps back is the start, not the end', () => {
  const f = bindFrame(-0.2)
  assert.equal(f.done, false)
  assert.equal(f.travel, 0)
})

test('reduced motion: a static lit cue for the same duration', () => {
  const frames = [0, 0.1, 0.3, 0.5].map(e => bindFrame(e, true))
  for (const f of frames) assert.deepEqual({ ...f, done: false }, { ...frames[0], done: false })
  assert.ok(frames[0].flashOpacity > 0 && frames[0].lineGlow > 0, 'the fact is still shown')
  assert.equal(bindFrame(BIND_TOTAL, true).done, true)
})

// ── Broken ───────────────────────────────────────────────────────────────────

test('the breach breathes inside the idle band', () => {
  assert.ok(BREACH_PERIOD >= 2 && BREACH_PERIOD <= 6)
  const id = 'link-a'
  for (const t of [0, 0.37, 1.1, 7.9]) {
    assert.ok(close(breachPulse(t, id), breachPulse(t + BREACH_PERIOD, id), 1e-6), 'periodic')
    const p = breachPulse(t, id)
    assert.ok(p >= 0 && p <= 1)
  }
})

test('N violated links never breathe in lockstep — the phase is the identity (原則 #31)', () => {
  const ids = Array.from({ length: 25 }, (_, i) => `link-${i}`)
  const at = ids.map(id => breachPulse(3.3, id).toFixed(4))
  assert.ok(new Set(at).size >= 20, `25 links share too few phases: ${new Set(at).size}`)
  // Same identity → same phase (a re-created view does not jump).
  assert.equal(breachPulse(3.3, 'link-7'), breachPulse(3.3, 'link-7'))
})

test('reduced motion and a malformed clock hold the breach still', () => {
  for (const t of [0, 0.5, 1.3]) assert.equal(breachPulse(t, 'x', true), 0)
  assert.equal(breachPulse(NaN, 'x'), 0)
})

// ── The line ─────────────────────────────────────────────────────────────────

const BASE = 0x22c55e

test('every tone is declared — the line draws no colour outside the tokens', () => {
  const declared = new Set(Object.values(COLOR).map(h => parseInt(h.slice(1), 16)))
  assert.ok(declared.has(LINK_TONES.strain))
  assert.ok(declared.has(LINK_TONES.breach))
  assert.ok(declared.has(LINK_TONES.unknown))
  assert.equal(LINK_TONES.strain, parseInt(COLOR.cautionTone.slice(1), 16))
  assert.equal(LINK_TONES.breach, parseInt(COLOR.dangerTone.slice(1), 16))
  // breachLit is the breach lit by the stage light: brighter, red still dominant.
  const lit = hexToRgb(LINK_TONES.breachLit), br = hexToRgb(LINK_TONES.breach)
  assert.ok(lit[0] + lit[1] + lit[2] > br[0] + br[1] + br[2])
  assert.ok(lit[0] >= lit[1] && lit[0] >= lit[2])
})

test('idle and highlight are the two ends of one followed level', () => {
  const idle = linkLineFrame({ base: BASE })
  const lit  = linkLineFrame({ base: BASE, highlight: 1 })
  const half = linkLineFrame({ base: BASE, highlight: 0.5 })
  assert.equal(idle.opacity, 0.4)
  assert.equal(lit.opacity, 1)
  assert.ok(half.opacity > idle.opacity && half.opacity < lit.opacity, 'continuous in between')
  assert.ok(lit.dashSize > idle.dashSize)
  assert.deepEqual(idle.rgb, hexToRgb(BASE))
})

test('broken outranks highlighted at full level, and the breath only brightens', () => {
  const f0 = linkLineFrame({ base: BASE, highlight: 1, violation: 1, pulse: 0 })
  const f1 = linkLineFrame({ base: BASE, highlight: 1, violation: 1, pulse: 1 })
  assert.deepEqual(f0.rgb.map(v => v.toFixed(6)), hexToRgb(LINK_TONES.breach).map(v => v.toFixed(6)))
  assert.ok(f1.rgb[0] + f1.rgb[1] + f1.rgb[2] > f0.rgb[0] + f0.rgb[1] + f0.rgb[2])
  assert.ok(f0.opacity >= 0.8)
})

test('the violation afterglow is continuous between broken and calm', () => {
  const calm = linkLineFrame({ base: BASE })
  const half = linkLineFrame({ base: BASE, violation: 0.5 })
  const full = linkLineFrame({ base: BASE, violation: 1 })
  assert.ok(half.opacity > calm.opacity && half.opacity < full.opacity)
  assert.ok(half.dashSize < calm.dashSize && half.dashSize > full.dashSize)
})

test('strain and severity are distances mapped to declared tones', () => {
  const s = linkLineFrame({ base: BASE, tension: 1 })
  assert.deepEqual(s.rgb.map(v => v.toFixed(6)), hexToRgb(LINK_TONES.strain).map(v => v.toFixed(6)))
  const mid = linkLineFrame({ base: BASE, severity: 0.5 })
  assert.deepEqual(mid.rgb.map(v => v.toFixed(6)), hexToRgb(LINK_TONES.strain).map(v => v.toFixed(6)))
  const max = linkLineFrame({ base: BASE, severity: 1, pulse: 0 })
  assert.deepEqual(max.rgb.map(v => v.toFixed(6)), hexToRgb(LINK_TONES.breach).map(v => v.toFixed(6)))
  // A highlighted line nearing its limit does not dim (severity never lowers the opacity).
  const hl = linkLineFrame({ base: BASE, highlight: 1, severity: 0.2 })
  assert.equal(hl.opacity, 1)
})

// ── Arrived ──────────────────────────────────────────────────────────────────

test('the point ripple swells on land and fades on fade — never linear', () => {
  const half = rippleFrame(0.5)
  assert.ok(half.scale > 1 + 3 * 0.5, 'size lands ahead of a linear ramp')
  assert.ok(half.opacity < 0.8 * 0.5, 'opacity falls ahead of a linear ramp')
  assert.deepEqual(rippleFrame(0), { scale: 1, opacity: 0.8 })
  assert.equal(rippleFrame(1).opacity, 0)
  assert.deepEqual(rippleFrame(0.3, true), rippleFrame(0.9, true))
})

// ── Wiring (source-level — the view has no THREE-free lane) ──────────────────

import { readFileSync } from 'node:fs'

test('the link line reads the loop clock and the reduced boundary — never a wall clock of its own', () => {
  const src = readFileSync(new URL('./SpatialLinkView.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(src, /Date\.now\(|performance\.now\(/, 'a private clock makes N lines share a phase')
  assert.match(src, /from '\.\.\/theme\/motion\.js'/)
  assert.doesNotMatch(src, /triggerFlash|_flashStart/, 'the line\'s own flash is retired — LinkBindEffect binds')
  const svc = readFileSync(new URL('../service/SceneService.js', import.meta.url), 'utf8')
  assert.match(svc, /new SpatialLinkView\([^)]*\{\s*id:\s*link\.id\s*\}/, 'the breath\'s phase is the link id')
  assert.match(svc, /view\.update\([^)]*this\._linkClock\)/)
})

test('the bead is sized by the link\'s span — a mm scene and a metre scene look the same (原則 #27)', async () => {
  const { bindRadius } = await import('./LinkMotionMath.js')
  assert.ok(close(bindRadius(150) / 150, bindRadius(0.15) / 0.15))
  assert.ok(bindRadius(150) > 1, 'visible in the default mm scene (the old fixed 0.15 was 0.15 mm)')
  assert.ok(bindRadius(0) > 0 && bindRadius(NaN) > 0)
})
