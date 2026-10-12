/**
 * CriteriaFigureMath — every expectation word has a picture that moves with it
 * (ADR-165 D3, principle #33 (4)). The population is the catalog, not the
 * figures that happen to exist (principle #31).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { criteriaFigure, FIGURED_ELEMENTS, FIGURE_W, FIGURE_H } from './CriteriaFigureMath.js'
import { CRITERIA_ELEMENTS } from '../context/CriteriaCatalog.js'

const circles = (f) => f.shapes.filter(s => s.kind === 'circle')

test('every catalog element has a figure, and nothing else does', () => {
  assert.deepEqual([...FIGURED_ELEMENTS].sort(), CRITERIA_ELEMENTS.map(e => e.key).sort())
})

test('an undeclared element throws instead of borrowing another word\'s picture', () => {
  assert.throws(() => criteriaFigure('nope', 1), /no figure declared/)
})

test('a blank expectation draws nothing and says so — the picture never invents a number', () => {
  for (const e of CRITERIA_ELEMENTS) {
    const f = criteriaFigure(e.key, null)
    assert.equal(f.blank, true)
    assert.deepEqual(f.shapes, [])
  }
})

test('the picture moves with the word: more clearance widens the ring, tighter accuracy shrinks the target', () => {
  const ring = (v) => circles(criteriaFigure('humanClearance', v))[0].r
  assert.ok(ring(900) > ring(300))
  const target = (v) => circles(criteriaFigure('positionAccuracy', v)).at(-1).r
  assert.ok(target(0.1) < target(1.0))
  assert.match(criteriaFigure('humanClearance', 500).caption, /500 mm/)
})

test('every figure stays inside its box, even for an extreme value', () => {
  for (const e of CRITERIA_ELEMENTS) {
    for (const v of [0, 1e9]) {
      for (const s of criteriaFigure(e.key, v).shapes) {
        const xs = s.kind === 'circle' || s.kind === 'arc' ? [s.cx - s.r, s.cx + s.r]
          : s.kind === 'rect' ? [s.x, s.x + s.w] : [s.x1, s.x2]
        for (const x of xs) assert.ok(x >= 0 && x <= FIGURE_W, `${e.key}@${v}: x=${x}`)
        const ys = s.kind === 'circle' || s.kind === 'arc' ? [s.cy - s.r, s.cy + s.r]
          : s.kind === 'rect' ? [s.y, s.y + s.h] : [s.y1, s.y2]
        for (const y of ys) assert.ok(y >= 0 && y <= FIGURE_H, `${e.key}@${v}: y=${y}`)
      }
    }
  }
})
