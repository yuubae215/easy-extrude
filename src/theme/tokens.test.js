/**
 * tokens.test.js — drift test pinning `COLOR` (src/theme/tokens.js) equal to
 * the palette table in docs/LAYOUT_DESIGN.md § Color Palette (ADR-065 Phase 0).
 *
 * Same mechanism as the ADR-064 schema/constant drift tests (§1.1 single
 * source): the doc table and the token module must never diverge — a token
 * added to one side without the other fails CI. The doc is the human-readable
 * projection; the module is the consumable source. Neither may grow alone.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { COLOR, DURATION, EASING, Z, hexNumber, rgba } from './tokens.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Parse the § Color Palette table: rows shaped `| usage | \`token\` | \`#hex\` |`. */
function paletteFromDoc() {
  const md = readFileSync(join(repoRoot, 'docs', 'LAYOUT_DESIGN.md'), 'utf8')
  const section = md.split('## Color Palette')[1]?.split('\n## ')[0]
  assert.ok(section, 'LAYOUT_DESIGN.md must contain a "## Color Palette" section')
  const entries = {}
  for (const line of section.split('\n')) {
    const m = line.match(/^\|[^|]*\|\s*`([A-Za-z0-9]+)`\s*\|\s*`(#[0-9a-fA-F]{6})`\s*\|/)
    if (m) entries[m[1]] = m[2].toLowerCase()
  }
  return entries
}

test('every LAYOUT_DESIGN palette token exists in COLOR with the same hex', () => {
  const doc = paletteFromDoc()
  assert.ok(Object.keys(doc).length >= 10, 'palette table should parse (found too few token rows)')
  for (const [token, hex] of Object.entries(doc)) {
    assert.equal(COLOR[token], hex, `COLOR.${token} must equal the doc palette (${hex})`)
  }
})

test('every COLOR token appears in the LAYOUT_DESIGN palette table (no silent growth)', () => {
  const doc = paletteFromDoc()
  for (const token of Object.keys(COLOR)) {
    assert.ok(token in doc, `COLOR.${token} is missing from docs/LAYOUT_DESIGN.md § Color Palette`)
  }
})

test('token groups are frozen (single source cannot be mutated at runtime)', () => {
  for (const group of [COLOR, DURATION, EASING, Z]) {
    assert.ok(Object.isFrozen(group))
  }
})

test('hexNumber / rgba derive THREE and CSS forms from one token', () => {
  assert.equal(hexNumber('#22c55e'), 0x22c55e)
  assert.equal(rgba('#22c55e', 0.28), 'rgba(34,197,94,0.28)')
  assert.equal(rgba(COLOR.fxAmber, 0.3), 'rgba(213,162,58,0.3)')
})
