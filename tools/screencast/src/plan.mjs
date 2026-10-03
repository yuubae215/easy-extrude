// Planner and frame compositor. PURE — the schedule depends only on declared
// durations (never on where a target turns out to be), so the whole timeline
// is known before the browser starts and `screencast plan` can print it.
import { Ease, clamp01, prog } from './ease.mjs'

/**
 * @returns {{ items: PlanItem[], totalMs: number }}
 * PlanItem = { index, step, action, start, end, dur, untilMs }
 *   untilMs — ms after `start` at which the next step of the SAME kind begins
 *             (caption hand-over, chip replacement); null when none follows.
 */
export function plan(steps, actions, style, pace = 1) {
  let cursor = 0
  const items = steps.map((step, index) => {
    const action = actions.get(step.do)
    if (!action) throw new Error(`no action for "${step.do}"`)
    const dur = Math.round(action.duration(step, style) * pace)
    const start = cursor
    if (!(step.async ?? action.async ?? false)) cursor = start + dur
    return { index, step, action, start, end: start + dur, dur, untilMs: null }
  })
  items.forEach((it, i) => {
    const next = items.slice(i + 1).find(o => o.step.do === it.step.do)
    if (next) it.untilMs = next.start - it.start
  })
  return { items, totalMs: Math.max(cursor, ...items.map(i => i.end)) }
}

// Visual-only idle drift: the cursor never freezes while nothing happens, but
// stays within ~2px so it never reads as a gesture. Two incommensurate sines.
const drift = t => ({ x: Math.sin(t * 0.0011) * 1.4 + Math.sin(t * 0.00037 + 1) * 0.9, y: Math.sin(t * 0.0009 + 2) * 1.1 + Math.sin(t * 0.00053) * 0.7 })

/**
 * Where the pointer is at time t, from the plan and what `begin` resolved.
 * Between pointer steps the cursor rests at the last point plus idle drift
 * (eased in so it never jumps).
 */
export function pointerAt(t, p, resolved, home) {
  let last = null
  for (const it of p.items) {
    if (!it.action.pointer || it.start > t || !resolved.has(it.index)) continue
    last = it
  }
  if (!last) return { ...home, down: false, hidden: false }
  const ms = Math.min(t - last.start, last.dur)
  const at = last.action.pointer(last.step, resolved.get(last.index), ms, last.dur)
  if (t <= last.end) return at
  const env = prog(t, last.end, 500, 'inOutSine')
  const d = drift(t), d0 = drift(last.end)
  return { ...at, x: at.x + (d.x - d0.x) * env, y: at.y + (d.y - d0.y) * env, down: false }
}

/** Virtual camera at time t: fold every begun focus step over the full frame. */
export function cameraAt(t, p, resolved, vp) {
  let clip = { x: 0, y: 0, w: vp.width, h: vp.height }
  const focus = p.items.filter(it => it.action.camera && resolved.has(it.index) && it.start <= t)
  focus.forEach((it, k) => {
    const next = focus[k + 1]
    const ms = Math.min(t, next ? next.start : t) - it.start
    clip = it.action.camera(it.step, resolved.get(it.index), ms, it.dur, clip, vp)
  })
  return clip
}

/**
 * Everything the overlay draws at time t. Pure: (t, plan, resolved, ctx) → state.
 * The browser view only applies numbers; it decides nothing.
 */
export function frameState(t, p, resolved, ctx) {
  const { style, viewport, home } = ctx
  const state = { t, cursor: null, trail: [], ripples: [], chips: [], caption: null, title: null, camera: cameraAt(t, p, resolved, viewport) }

  const ptr = pointerAt(t, p, resolved, home)
  // Press squash: 0 → 1 while down, springing back over 260ms after release.
  let press = 0
  for (const it of p.items) {
    if (!it.action.pointer || it.start > t || !resolved.has(it.index)) continue
    const r = resolved.get(it.index)
    for (let s = Math.max(it.start, t - 400); s <= Math.min(t, it.end); s += 1000 / 120) {
      if (it.action.pointer(it.step, r, s - it.start, it.dur).down) press = Math.max(press, 1 - clamp01((t - s) / 260))
    }
  }
  state.cursor = { x: ptr.x, y: ptr.y, down: !!ptr.down, press: Ease.outCubic(press), hidden: !!ptr.hidden, visible: style.cursor.visible }
  if (style.cursor.trail) {
    for (let k = 1; k <= 5; k++) {
      const q = pointerAt(t - k * 14, p, resolved, home)
      state.trail.push({ x: q.x, y: q.y, k })
    }
  }

  // Overlay contributions, oldest first.
  const chipItems = []
  for (const it of p.items) {
    if (!it.action.overlay || it.start > t) continue
    const ms = t - it.start
    const o = it.action.overlay(it.step, resolved.get(it.index) ?? {}, ms, it.dur, { style, untilMs: it.untilMs })
    if (!o) continue
    if (o.ripples) state.ripples.push(...o.ripples.filter(r => r.ageMs < 700).map(r => ({ x: r.x, y: r.y, p: Ease.outExpo(clamp01(r.ageMs / 700)) })))
    if (o.chips) o.chips.forEach(c => chipItems.push({ ...c, start: it.start, id: `${it.index}` }))
    if (o.caption) state.caption = o.caption
    if (o.title) state.title = o.title
  }
  // Chips: each lives holdMs, but a newer chip retires the older at once — the
  // HUD shows the last gesture, never a queue.
  chipItems.forEach((c, i) => {
    const next = chipItems[i + 1]
    const exitAt = Math.min(c.start + c.holdMs, next ? next.start : Infinity)
    const outP = prog(t, exitAt, 220, 'inCubic')
    if (outP >= 1) return
    state.chips.push({ id: c.id, caps: c.caps, inP: prog(t, c.start, 420, 'outBack'), fadeP: prog(t, c.start, 160, 'outQuad'), outP, caps_p: c.caps.map((_, k) => prog(t, c.start + k * 55, 380, 'outBack')) })
  })
  return state
}
