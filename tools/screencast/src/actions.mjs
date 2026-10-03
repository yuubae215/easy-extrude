// Core action registry for screencast/1.0. Each ActionDef splits cleanly into
//   PURE   duration / pointer / overlay  — a function of (step, resolved, time)
//   IMPURE begin / tick                  — touches the page (resolve, press)
// so the whole picture of a frame is reproducible from the plan plus what
// `begin` resolved (principle #3). Plugins add `x-*` kinds with the same shape.
//
// ActionDef = {
//   kind, async?: boolean (default false = blocking),
//   duration(step, style) → ms,
//   begin?(rt, step) → Promise<resolved>,        // impure: resolve targets / fire keys
//   tick?(rt, step, resolved, ms) → Promise,     // impure, every frame while active
//   pointer?(step, resolved, ms, dur) → {x, y, down, button, hidden} | null,   // pure
//   overlay?(step, resolved, ms, dur, ctx) → Partial<Layers> | null,          // pure
// }
import { Ease, clamp01, lerp, prog } from './ease.mjs'

/** Quadratic bezier from a→b bowed sideways by `arc` (fraction of length). Pure. */
export function arcPoint(a, b, u, arc = 0.12) {
  const dx = b.x - a.x, dy = b.y - a.y
  const c = { x: (a.x + b.x) / 2 - dy * arc, y: (a.y + b.y) / 2 + dx * arc }
  const v = 1 - u
  return { x: v * v * a.x + 2 * v * u * c.x + u * u * b.x, y: v * v * a.y + 2 * v * u * c.y + u * u * b.y }
}

const PRESS_MS = 90     // button held for a click
const SETTLE_MS = 110   // stillness after release before the step ends

const KEY_GLYPH = {
  Shift: '⇧ Shift', Control: 'Ctrl', Meta: '⌘', Alt: '⌥ Alt', Enter: '↵ Enter', Escape: 'Esc',
  Tab: '⇥ Tab', Backspace: '⌫', Delete: 'Del', Space: 'Space', ' ': 'Space',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
}
export const keyCaps = chord => chord.split('+').filter(Boolean).map(k => KEY_GLYPH[k] ?? (k.length === 1 ? k.toUpperCase() : k))

const chip = (step, caps, style) => ({ chips: [{ caps, holdMs: style.keys.holdMs }] })

const move = {
  kind: 'move',
  duration: s => s.duration ?? 650,
  async begin(rt, s) { return { from: rt.cursor(), to: await rt.resolve(s.to) } },
  pointer(s, r, ms, dur) {
    const p = arcPoint(r.from, r.to, Ease[s.ease ?? 'inOutCubic'](clamp01(ms / dur)), s.arc ?? 0.1)
    return { ...p, down: false }
  },
  overlay: (s, r, ms, dur, ctx) => (s.label ? chip(s, [s.label], ctx.style) : null),
}

const click = {
  kind: 'click',
  duration: s => s.duration ?? 700,
  async begin(rt, s) { return { from: rt.cursor(), to: await rt.resolve(s.target) } },
  pointer(s, r, ms, dur) {
    const travel = Math.max(1, dur - PRESS_MS - SETTLE_MS)
    const p = arcPoint(r.from, r.to, Ease[s.ease ?? 'inOutCubic'](clamp01(ms / travel)), s.arc ?? 0.1)
    return { ...p, down: ms >= travel && ms < travel + PRESS_MS, button: s.button ?? 'left' }
  },
  overlay(s, r, ms, dur, ctx) {
    const travel = Math.max(1, dur - PRESS_MS - SETTLE_MS)
    const out = s.label ? chip(s, [s.label], ctx.style) : {}
    if (ms >= travel) out.ripples = [{ x: r.to.x, y: r.to.y, ageMs: ms - travel }]
    return out
  },
}

const drag = {
  kind: 'drag',
  duration: s => s.duration ?? 1400,
  async begin(rt, s) {
    const here = rt.cursor()
    const from = s.from ? await rt.resolve(s.from) : here
    // `relative` in `to` is measured from the drag's own start, not the cursor.
    const to = await rt.resolve(s.to, from)
    return { here, from, to, approach: s.from ? 0.3 : 0 }
  },
  pointer(s, r, ms, dur) {
    const u = clamp01(ms / dur)
    const hidden = !!s.hideCursor
    if (u < r.approach) {
      const p = arcPoint(r.here, r.from, Ease.inOutCubic(u / r.approach), 0.08)
      return { ...p, down: false, hidden }
    }
    // Press lands, the body carries the stroke, release only after a beat of
    // stillness — a human drag, and the app sees the final position settle.
    const body = (u - r.approach) / (1 - r.approach)
    const t = clamp01((body - 0.06) / 0.86)
    const p = arcPoint(r.from, r.to, Ease[s.ease ?? 'inOutCubic'](t), s.arc ?? 0)
    return { ...p, down: body > 0.02 && body < 0.97, button: s.button ?? 'left', hidden }
  },
  overlay: (s, r, ms, dur, ctx) => (s.label ? chip(s, [s.label], ctx.style) : null),
}

const key = {
  kind: 'key',
  duration: s => s.duration ?? 500,
  async begin(rt, s) { await rt.page.keyboard.press(s.keys); return {} },
  overlay: (s, r, ms, dur, ctx) => ((s.show ?? ctx.style.keys.visible) ? chip(s, s.label ? [s.label] : keyCaps(s.keys), ctx.style) : null),
}

const type = {
  kind: 'type',
  duration: s => (s.perCharMs ?? 85) * s.text.length + 250,
  async begin() { return { sent: 0 } },
  async tick(rt, s, r, ms) {
    const due = Math.min(s.text.length, Math.floor(ms / (s.perCharMs ?? 85)) + 1)
    while (r.sent < due) await rt.page.keyboard.type(s.text[r.sent++])
  },
  overlay: (s, r, ms, dur, ctx) => ((s.show ?? ctx.style.keys.visible) ? chip(s, [s.text.slice(0, Math.min(s.text.length, Math.floor(ms / (s.perCharMs ?? 85)) + 1))], ctx.style) : null),
}

const wait = { kind: 'wait', duration: s => s.duration }

const title = {
  kind: 'title',
  duration: s => s.duration ?? 2000,
  overlay(s, r, ms, dur) {
    const IN = 700, OUT = 450
    // enter:false shifts the clock past the entrance; exit:false never starts the exit.
    const m = s.enter === false ? ms + 5000 : ms
    const outP = s.exit === false ? 0 : prog(ms, dur - OUT, OUT, 'inCubic')
    return { title: { text: s.text, sub: s.sub ?? '', backdrop: s.backdrop ?? 'blur', inMs: m, outP, letters: [...s.text].map((_, i) => prog(m, 120 + i * 28, IN, 'outBack')), subP: prog(m, 380, 600, 'outExpo') } }
  },
}

const caption = {
  kind: 'caption',
  async: true,
  duration: s => s.duration ?? 0,
  overlay(s, r, ms, dur, ctx) {
    if (s.text == null) return null
    // Lives until the next caption begins (ctx.untilMs), then hands over.
    const exitAt = ctx.untilMs ?? Infinity
    if (ms > exitAt + 400) return null
    return { caption: { text: s.text, index: s.index == null ? '' : String(s.index).padStart(2, '0'), inP: prog(ms, 0, 650, 'outExpo'), barP: prog(ms, 0, 900, 'outExpo'), outP: prog(ms, exitAt, 320, 'inCubic') } }
  },
}

const focus = {
  kind: 'focus',
  async: true,
  duration: s => s.duration ?? 1000,
  async begin(rt, s) { return { center: s.target ? await rt.resolve(s.target) : null } },
  camera(s, r, ms, dur, from, vp) {
    const z = s.zoom
    const w = vp.width / z, h = vp.height / z
    const cx = r.center ? r.center.x : vp.width / 2, cy = r.center ? r.center.y : vp.height / 2
    const to = { x: Math.min(Math.max(cx - w / 2, 0), vp.width - w), y: Math.min(Math.max(cy - h / 2, 0), vp.height - h), w, h }
    const u = Ease[s.ease ?? 'inOutQuint'](clamp01(ms / Math.max(1, dur)))
    return { x: lerp(from.x, to.x, u), y: lerp(from.y, to.y, u), w: lerp(from.w, to.w, u), h: lerp(from.h, to.h, u) }
  },
}

export const CORE_ACTIONS = new Map([move, click, drag, key, type, wait, title, caption, focus].map(a => [a.kind, a]))
