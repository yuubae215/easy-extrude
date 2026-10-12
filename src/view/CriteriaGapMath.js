/**
 * CriteriaGapMath — the gap between one person's expectation and a
 * candidate's actual value, as a face (ADR-165 D3 — ☺ ○ ☹).
 *
 * Pure: no DOM, no React. **Closed form** over `op`, the expectation and the
 * actual value (CLAUDE.md §AI 向けガード 軸 3): "is 4 s within <= 6 s?" is not an
 * idea. It reads **no weight and no ratio** — how much a margin is worth, and
 * how margins combine, are core/'s (軸 1). `src/CriteriaIndicatorCensus.test.js`
 * holds this file to that.
 *
 * The face is presentation derived on the client (principle #29) and never
 * rides the wire:
 *
 *   ☺ meets   — met with room to spare
 *   ○ tight   — met, but by less than TIGHT_FRACTION of the expectation
 *   ☹ misses  — not met
 *   ? unsure  — the actual's range straddles the expectation: the nominal value
 *               cannot say, a measured or quoted one could (basis `nominal`)
 *
 * `TIGHT_FRACTION` is a drawing threshold (when to grey the smile), not a
 * judgement of a good value.
 *
 * @module view/CriteriaGapMath
 */

export const GAP = Object.freeze({
  MEETS:  'meets',
  TIGHT:  'tight',
  MISSES: 'misses',
  UNSURE: 'unsure',
})

export const GAP_FACE = Object.freeze({
  [GAP.MEETS]:  '☺',
  [GAP.TIGHT]:  '○',
  [GAP.MISSES]: '☹',
  [GAP.UNSURE]: '?',
})

/** Below this share of the expectation, a met expectation reads "tight". */
export const TIGHT_FRACTION = 0.1

/** Signed room in the expectation's direction (>= 0 ⇔ met, `<`/`>` strict at 0). */
function room(op, expectation, actual) {
  switch (op) {
    case '<=': case '<': return expectation - actual
    case '>=': case '>': return actual - expectation
    case '==':           return -Math.abs(actual - expectation)
    default: throw new Error(`[CriteriaGapMath] no gap declared for comparison "${op}"`)
  }
}

function met(op, r) {
  return (op === '<' || op === '>') ? r > 0 : r >= 0
}

/**
 * The face of one cell for one expectation.
 *
 * @param {{op: string, value: number}} criterion — the person's expectation
 * @param {{value: number, range?: [number, number]}} actual — core/'s actual
 * @returns {string} a GAP value
 */
export function gapOf(criterion, actual) {
  const { op, value } = criterion
  const r = room(op, value, actual.value)
  if (actual.range) {
    const [lo, hi] = actual.range
    if (met(op, room(op, value, lo)) !== met(op, room(op, value, hi))) return GAP.UNSURE
    if (op === '==' && lo <= value && value <= hi && lo !== hi) return GAP.UNSURE
  }
  if (!met(op, r)) return GAP.MISSES
  if (op === '==') return GAP.MEETS
  return r < Math.abs(value) * TIGHT_FRACTION ? GAP.TIGHT : GAP.MEETS
}
