import { test } from 'node:test'
import assert from 'node:assert/strict'
import { visibilityAffordance } from './OutlinerRowMath.js'

// ── The glyph is the state ───────────────────────────────────────────────────

test('a visible row reports an open eye, a hidden row a closed one', () => {
  assert.equal(visibilityAffordance({ visible: true }).eyeOpen, true)
  assert.equal(visibilityAffordance({ visible: false }).eyeOpen, false)
})

test('the eye title names the ACTION, not the current state', () => {
  assert.equal(visibilityAffordance({ visible: true }).eyeTitle,  'Hide')
  assert.equal(visibilityAffordance({ visible: false }).eyeTitle, 'Show')
})

// ── #11: a hidden row must announce itself WITHOUT hover ─────────────────────

test('a hidden row pins its eye on even when not hovered', () => {
  assert.equal(visibilityAffordance({ visible: false, hovered: false }).eyeOpacity, 1)
})

test('a visible row keeps the eye hover-revealed (chrome quiet at rest)', () => {
  assert.equal(visibilityAffordance({ visible: true, hovered: false }).eyeOpacity, 0)
  assert.equal(visibilityAffordance({ visible: true, hovered: true }).eyeOpacity, 1)
})

// ── Grey-out ─────────────────────────────────────────────────────────────────

test('hidden rows dim their content, visible rows do not', () => {
  assert.ok(visibilityAffordance({ visible: false }).contentOpacity < 1)
  assert.equal(visibilityAffordance({ visible: true }).contentOpacity, 1)
})

test('hidden state rides three independent channels (glyph, colour, slant)', () => {
  const hid = visibilityAffordance({ visible: false })
  const vis = visibilityAffordance({ visible: true })
  assert.notEqual(hid.eyeOpen,   vis.eyeOpen)
  assert.notEqual(hid.nameColor, vis.nameColor)
  assert.notEqual(hid.nameStyle, vis.nameStyle)
  assert.equal(hid.nameStyle, 'italic')
  assert.equal(vis.nameStyle, 'normal')
})

// ── Active beats hidden on the name colour ───────────────────────────────────

test('the active row keeps its selection colour while hidden', () => {
  const activeVisible = visibilityAffordance({ visible: true,  active: true })
  const activeHidden  = visibilityAffordance({ visible: false, active: true })
  assert.equal(activeHidden.nameColor, activeVisible.nameColor)
  // ...but the other two channels still report hidden.
  assert.equal(activeHidden.eyeOpen, false)
  assert.equal(activeHidden.nameStyle, 'italic')
})

// ── Totality ─────────────────────────────────────────────────────────────────

test('defaults to a visible, unhovered, inactive row', () => {
  assert.deepEqual(visibilityAffordance(), visibilityAffordance({
    visible: true, hovered: false, active: false,
  }))
})

test('every field is populated for all 8 input combinations', () => {
  for (const visible of [true, false]) {
    for (const hovered of [true, false]) {
      for (const active of [true, false]) {
        const a = visibilityAffordance({ visible, hovered, active })
        assert.equal(typeof a.hidden, 'boolean')
        assert.equal(typeof a.eyeOpen, 'boolean')
        assert.equal(typeof a.eyeOpacity, 'number')
        assert.match(a.eyeColor, /^#[0-9a-f]{6}$/i)
        assert.ok(a.eyeTitle.length > 0)
        assert.ok(a.contentOpacity > 0 && a.contentOpacity <= 1)
        assert.match(a.nameColor, /^#[0-9a-f]{6}$/i)
        assert.ok(a.nameStyle === 'italic' || a.nameStyle === 'normal')
      }
    }
  }
})
