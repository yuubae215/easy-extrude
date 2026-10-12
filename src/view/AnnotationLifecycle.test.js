/**
 * AnnotationLifecycle.test.js — where the ADR-166 M3b split is ASKED at write
 * time (CLAUDE.md「After fixing a bug」Q3).
 *
 * The pure state machine lives in `MapVisualMath` and is tested there. What a
 * pure test cannot see is whether the VIEWS hold to it — and the defect M3b
 * removes was in the views: one field (`mesh.visible`) answered both "does the
 * user still have this annotation" and "is it drawn", so hit-testing and the
 * exit animation could not disagree, and the exit could not exist.
 *
 * Population: every `Annotated*View.js` in this directory, derived by listing
 * the directory — not a list of names, so a fourth annotation view is asked
 * the day it is written (原則 #31).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const views = readdirSync(here)
  .filter(f => /^Annotated\w+View\.js$/.test(f))
  .map(f => ({ file: f, src: readFileSync(join(here, f), 'utf8') }))

/** Body of a method `name(...) {` up to the next method at the same indent. */
function methodBody(src, name) {
  const re = new RegExp(`\\n  ${name}\\([^)]*\\) \\{\\n([\\s\\S]*?)\\n  \\}\\n`)
  return src.match(re)?.[1] ?? null
}

test('the population is the three annotation views (a new one joins automatically)', () => {
  assert.deepEqual(views.map(v => v.file).sort(),
    ['AnnotatedLineView.js', 'AnnotatedPointView.js', 'AnnotatedRegionView.js'])
})

for (const { file, src } of views) {
  test(`${file}: \`visible\` is the logical fact — hit-testing never picks a leaving annotation`, () => {
    // HitTestService.hitAnyAnnotation filters on `meshView.visible`. If this
    // getter read a mesh again, an exiting (still drawn) annotation would be
    // pickable — the M3b completion condition, asked structurally.
    assert.match(src, /get visible\(\) \{ return this\._life\.present \}/)
    assert.match(src, /get drawn\(\) \{ return this\._drawn \}/)
  })

  test(`${file}: setVisible writes the lifecycle, never a mesh (one writer of drawn — #4)`, () => {
    const body = methodBody(src, 'setVisible')
    assert.ok(body, 'setVisible not found')
    assert.doesNotMatch(body, /\.visible\s*=/,
      'setVisible must go through the lifecycle reducers and _setDrawn, not write meshes')
    assert.match(body, /lifecycleShow\(this\._life\)\s*:\s*lifecycleHide\(this\._life\)/)
    assert.ok(methodBody(src, '_setDrawn'), '_setDrawn (the sole writer of the drawn state) is missing')
  })

  test(`${file}: no BoxHelper — selection is the light (ADR-166 M3b)`, () => {
    assert.doesNotMatch(src, /new THREE\.BoxHelper/)
    assert.doesNotMatch(src, /this\.boxHelper/)
    // The polymorphic method stays (#17 — commands call it on every view).
    assert.match(src, /updateBoxHelper\(\) \{\}/)
    // Selection is written once, as a request the tick lands.
    const sel = methodBody(src, 'setObjectSelected')
    assert.ok(sel)
    assert.match(sel, /this\._isSelected = sel/)
    assert.match(sel, /setHighlighted\(sel\)/)
  })

  test(`${file}: the tick derives drawn from the phase before drawing anything`, () => {
    const body = methodBody(src, 'tick')
    assert.ok(body)
    const stamp = body.indexOf('lifecycleStamp(')
    const drawn = body.indexOf('this._setDrawn(phaseTraits(lifecyclePhase(')
    const guard = body.indexOf('if (!this._drawn) return')
    assert.ok(stamp >= 0 && drawn > stamp && guard > drawn,
      'tick must stamp the clock, derive drawn from the phase, then return when not drawn')
  })
}
