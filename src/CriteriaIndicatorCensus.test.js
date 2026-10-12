/**
 * CriteriaIndicatorCensus — the front produces none of the criteria solver's
 * values (ADR-165 D6, PR4).
 *
 * The candidates' actual values, everyone's interest per category and what a
 * change to the agreed line gives up are core/'s cost function — an idea
 * (CLAUDE.md §AI 向けガード 軸 1). The front draws them; it computes none of
 * them from the weights. "None" is not something you can see by reading the
 * files that exist — a second cost function would arrive as a new file — so
 * this census enumerates:
 *
 *   1. the **vocabulary** is the contract's: the front's value tree
 *      (`CriteriaCatalog`) is exactly the contract's `elementKey` / `category`
 *      enums (core/'s catalog is held to the same enums by
 *      core/tests/test_criteria_contract.py — one set, two derivations);
 *   2. the **writers**: every place in src/ that writes an `interest`,
 *      `offerings` or `margin` value is one of the declared carriers below,
 *      each of which copies core/'s answer rather than producing one. A new
 *      writer is red until someone declares why it is a carrier; a declared
 *      carrier that stopped writing is red too (a stale row is a place-list —
 *      ADR-102);
 *   3. the **face** reads no weight: the ☺ ○ ☹ gap is closed form over the
 *      expectation and the actual (軸 3) — the moment it reads a weight or a
 *      ratio it has become a scoring function.
 *
 * This file is the maturity PATH of DEF-062 / DEF-064 and of the GSN goal
 * IndicatorValuesComeOnlyFromCore (docs/gsn/adr-165-…gsn).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, stripCommentsFlat, relPath, repoPath } from './census/sources.js'
import { CRITERIA_CATEGORIES, CRITERIA_ELEMENTS } from './context/CriteriaCatalog.js'

const schema = (name) => JSON.parse(readFileSync(repoPath(`packages/grasp-contract/schema/${name}.schema.json`), 'utf8'))

test('the front value tree is exactly the contract vocabulary (elements and categories)', () => {
  const req = schema('criteria-trial-request')
  const res = schema('criteria-trial-response')
  assert.deepEqual(CRITERIA_ELEMENTS.map(e => e.key), req.$defs.elementKey.enum,
    'CriteriaCatalog and the contract name the same elements in the same order')
  assert.deepEqual(res.$defs.elementKey.enum, req.$defs.elementKey.enum)
  assert.deepEqual([...CRITERIA_CATEGORIES], res.$defs.category.enum)
  assert.deepEqual(Object.keys(req.$defs.mix.properties), [...CRITERIA_CATEGORIES])
})

/**
 * Files allowed to write a solver value, and why each is a carrier rather
 * than a producer. Keyed by repo-relative path.
 */
const CARRIERS = Object.freeze({
  'src/controller/ContextController.js':
    "copies the wire `interest` into the store, and records `unassessed` when the solver could not be asked (never a value)",
  'src/context/CriteriaTrialWire.js':
    "marginOf copies the wire proposal assessment (`offerings`) into the proposal's margin record",
})

/**
 * A write of a solver value: an object key `interest:` / `offerings:`, or a
 * margin record built from its kinds (`kind: MARGIN_KIND.…`). The bare word
 * `margin` is not used — it is also CSS and the reach margin of kinematics.
 */
const WRITE = /\b(?:interest|offerings)\s*:|\bkind\s*:\s*MARGIN_KIND\./

test('every writer of interest / offerings / a margin record in src/ is a declared carrier', () => {
  const writers = new Set()
  for (const abs of collectSources()) {
    if (WRITE.test(stripCommentsFlat(readFileSync(abs, 'utf8')))) writers.add(relPath(abs))
  }
  const undeclared = [...writers].filter(f => !(f in CARRIERS))
  assert.deepEqual(undeclared, [],
    'a new place writes a criteria solver value — core/ computes these (軸 1). If it only copies the wire, declare it in CARRIERS with why')
  const stale = Object.keys(CARRIERS).filter(f => !writers.has(f))
  assert.deepEqual(stale, [], 'a declared carrier no longer writes — delete its row (a stale row hides the next writer)')
})

test('the ☺ ○ ☹ gap reads no weight and no ratio (closed form, 軸 3)', () => {
  const src = stripCommentsFlat(readFileSync(repoPath('src/view/CriteriaGapMath.js'), 'utf8'))
  assert.doesNotMatch(src, /\bweight|\bmix\b|\binterest\b/)
})

test('no src/ file names the solver\'s private vocabulary (its scales, probes or score)', () => {
  // core/'s catalog columns and the cost function's name. If one of these
  // appears in src/, the front has started to reproduce the idea.
  const PRIVATE = /\b(?:probe|eqTolerance|eq_tolerance|totalScore)\b|\bsatisfaction\s*\(/
  const hits = collectSources()
    .filter(abs => /criteria/i.test(abs) || /Criteria/.test(readFileSync(abs, 'utf8')))
    .filter(abs => PRIVATE.test(stripCommentsFlat(readFileSync(abs, 'utf8'))))
    .map(relPath)
  assert.deepEqual(hits, [])
})
