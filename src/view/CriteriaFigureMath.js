/**
 * CriteriaFigureMath — the picture that checks what an expectation's word
 * points at (ADR-165 D3, flow v4 Step 3 — principle #33 (4): a word is
 * confirmed against the thing it names before anything runs).
 *
 * Pure: no DOM, no React. Returns shapes in a 150 × 110 box plus a caption;
 * `CriteriaFigure.jsx` draws them. Moving the expectation moves the picture —
 * "never touch a person" widens the ring between the robot and the person,
 * "position accuracy" shrinks the target circle.
 *
 * This is presentation derived on the client (principle #29) — it scores
 * nothing and decides nothing. The scale ranges below only map a number onto
 * the box; they are not judgements about what is a good value.
 *
 * **Every catalog element declares a figure** (`FIGURE_BY_ELEMENT`), and an
 * undeclared element throws (principle #31) — a fall-through picture would
 * show one word's meaning under another word's name.
 *
 * @module view/CriteriaFigureMath
 */

export const FIGURE_W = 150
export const FIGURE_H = 110

/** Where `v` sits in [lo, hi], clamped to [0, 1] (the box is finite). */
const unit = (v, lo, hi) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)))

/**
 * Per element: how the expectation becomes a picture.
 * `draw(v)` → `{shapes, caption}`; `tone` names a colour role, never a hex.
 */
const FIGURE_BY_ELEMENT = Object.freeze({
  takt: (v) => {
    const perMinute = Math.max(1, Math.round(60 / Math.max(v, 0.1)))
    const shapes = Array.from({ length: Math.min(perMinute, 20) }, (_, i) =>
      ({ kind: 'rect', x: 8 + i * 7, y: 40, w: 5, h: 16, tone: 'info', fill: true }))
    return { shapes, caption: `${perMinute} per minute — one every ${v} s` }
  },
  positionAccuracy: (v) => {
    const r = 4 + unit(v, 0, 2) * 36
    return {
      shapes: [
        { kind: 'circle', cx: 75, cy: 52, r: 42, tone: 'neutral' },
        { kind: 'line', x1: 75, y1: 6, x2: 75, y2: 98, tone: 'neutral' },
        { kind: 'line', x1: 29, y1: 52, x2: 121, y2: 52, tone: 'neutral' },
        { kind: 'circle', cx: 75, cy: 52, r, tone: 'success', fill: true },
      ],
      caption: `placed inside this circle: ±${v} mm`,
    }
  },
  holdMargin: (v) => {
    const h = 10 + unit(v, 0, 5) * 70
    return {
      shapes: [
        { kind: 'rect', x: 62, y: 20, w: 26, h: 12, tone: 'neutral', fill: true },  // gripper
        { kind: 'rect', x: 62, y: 34, w: 26, h: 14, tone: 'neutral' },              // part
        { kind: 'rect', x: 100, y: 92 - h, w: 14, h, tone: 'success', fill: true }, // holding force
        { kind: 'line', x1: 96, y1: 78, x2: 118, y2: 78, tone: 'neutral', dash: true }, // the part's weight
      ],
      caption: `held with ${v}× its weight`,
    }
  },
  equipmentCost: (v) => ({
    shapes: [{ kind: 'rect', x: 10, y: 44, w: 10 + unit(v, 0, 20_000_000) * 120, h: 16, tone: 'reveal', fill: true }],
    caption: `up to ${Math.round(v).toLocaleString('en-US')} JPY`,
  }),
  maintainability: (v) => {
    const m = Math.min(120, Math.max(0, v))
    const a = (m / 120) * 2 * Math.PI
    return {
      shapes: [
        { kind: 'circle', cx: 75, cy: 50, r: 32, tone: 'neutral', width: 6 },
        { kind: 'arc', cx: 75, cy: 50, r: 32, end: a, large: m > 60, tone: 'reveal', width: 6 },
      ],
      caption: `a part swapped in ${v} min`,
    }
  },
  humanClearance: (v) => {
    const r = 14 + unit(v, 0, 1500) * 38
    return {
      shapes: [
        { kind: 'circle', cx: 58, cy: 55, r, tone: 'danger', fill: true, dash: true }, // the margin
        { kind: 'circle', cx: 58, cy: 55, r: 12, tone: 'neutral', fill: true },        // robot
        { kind: 'circle', cx: 58 + r + 16, cy: 47, r: 5, tone: 'neutral' },            // person's head
        { kind: 'line', x1: 58 + r + 16, y1: 52, x2: 58 + r + 16, y2: 68, tone: 'neutral' },
      ],
      caption: `kept ${v} mm away from a person`,
    }
  },
  stoppingDistance: (v) => {
    const d = 10 + unit(v, 0, 400) * 110
    return {
      shapes: [
        { kind: 'rect', x: 8, y: 44, w: 14, h: 14, tone: 'neutral', fill: true },
        { kind: 'line', x1: 22, y1: 51, x2: 22 + d, y2: 51, tone: 'danger', width: 2 },
        { kind: 'rect', x: 22 + d, y: 44, w: 4, h: 14, tone: 'danger', fill: true },
      ],
      caption: `stops within ${v} mm of an emergency stop`,
    }
  },
})

/** The element keys that have a figure — for the census against the catalog. */
export const FIGURED_ELEMENTS = Object.freeze(Object.keys(FIGURE_BY_ELEMENT))

/**
 * The figure for one element at one expectation value. A blank value draws
 * nothing and says so — the picture never invents a number (principle #31).
 *
 * @param {string} elementKey — a CRITERIA_ELEMENTS key
 * @param {number|null|undefined} value
 * @returns {{shapes: object[], caption: string, blank: boolean}}
 */
export function criteriaFigure(elementKey, value) {
  const draw = FIGURE_BY_ELEMENT[elementKey]
  if (!draw) throw new Error(`[CriteriaFigureMath] no figure declared for element "${elementKey}"`)
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { shapes: [], caption: 'not answered yet — type an expectation to see it', blank: true }
  }
  return { ...draw(value), blank: false }
}

/** SVG path for an arc from 12 o'clock clockwise by `end` radians. */
export function arcPath({ cx, cy, r, end, large }) {
  const x = cx + r * Math.sin(end)
  const y = cy - r * Math.cos(end)
  return `M${cx} ${cy - r} A${r} ${r} 0 ${large ? 1 : 0} 1 ${x} ${y}`
}
