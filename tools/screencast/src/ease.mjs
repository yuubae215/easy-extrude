// Easing catalog (easings.net forms). Pure. The DSL's `ease` enum is pinned to
// these keys by test/schema.test.mjs — one vocabulary, two representations.
const PI = Math.PI, c1 = 1.70158, c3 = c1 + 1, c4 = (2 * PI) / 3

export const Ease = {
  linear:     x => x,
  outQuad:    x => 1 - (1 - x) * (1 - x),
  outCubic:   x => 1 - Math.pow(1 - x, 3),
  outQuint:   x => 1 - Math.pow(1 - x, 5),
  outExpo:    x => (x === 1 ? 1 : 1 - Math.pow(2, -10 * x)),
  inCubic:    x => x * x * x,
  inExpo:     x => (x === 0 ? 0 : Math.pow(2, 10 * x - 10)),
  inOutCubic: x => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
  inOutQuint: x => (x < 0.5 ? 16 * x ** 5 : 1 - Math.pow(-2 * x + 2, 5) / 2),
  inOutSine:  x => -(Math.cos(PI * x) - 1) / 2,
  inOutExpo:  x => (x === 0 ? 0 : x === 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
  outBack:    x => 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2),
  outElastic: x => (x === 0 ? 0 : x === 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * c4) + 1),
  // Critically-under-damped spring settling at 1 (ζ≈0.55): one soft overshoot.
  spring:     x => (x >= 1 ? 1 : 1 - Math.exp(-6 * x) * Math.cos(9 * x)),
}

export const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x)

/** Local progress of `t` inside [start, start+dur], clamped, eased. */
export function prog(t, start, dur, ease = 'outCubic') {
  if (dur <= 0) return t >= start ? 1 : 0
  return Ease[ease](clamp01((t - start) / dur))
}

export const lerp = (a, b, u) => a + (b - a) * u
