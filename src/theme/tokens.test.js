/**
 * tokens.test.js — the palette's machine questions (ADR-065 Phase 0, ADR-100).
 *
 * ## Two guarantees, not one
 *
 * ADR-065 Phase 0 gave the VOCABULARY a check: `COLOR` and the table in
 * `docs/LAYOUT_DESIGN.md` § Color Palette are pinned to each other, so neither
 * grows alone. It gave USAGE only a sentence — "migrate any line you touch".
 *
 * That asymmetry is measurable and it lost: at ADR-100's writing the repo had
 * ~150 distinct colours in `src/**` and 21 of them were declared. A rule nobody
 * is asked at the moment of writing does not run, and "any line you TOUCH" is
 * asked only of lines somebody happened to touch — the other 400 were never
 * going to move (憲法 Q3: if the answer to "where is this asked?" is prose, the
 * deliverable is a check).
 *
 * So this file now asks four more questions, all of them numbers:
 *
 *   1. RATCHET — how many hex literals live OUTSIDE the vocabulary? It may fall,
 *      never rise. What is counted is the count of things NOT declared, because
 *      a check that walks *what exists* (the tokens) can never see what doesn't
 *      (原則 #31). Legitimately-excluded vocabularies are named, not inferred.
 *   2. ONE MEANING, ONE COLOUR — the painters of "this is what you are
 *      operating on" are ENUMERATED, and the retired selection colours must
 *      appear zero times. Enumerating the kinds is the point: a seventh painter
 *      added tomorrow reaches for a hex, and the zero-count catches it even
 *      though no listed painter changed.
 *   3. HUE SEPARATION — no two state meanings share a hue.
 *   4. NEUTRALITY + CONTRAST — the entity default carries no hue, and is still
 *      separable from the ground it sits on.
 *
 * ## Baselines are declarations, not achievements
 *
 * The ratchet baseline says "today we tolerate 790 undeclared literals". That is
 * an ugly number and it is stated rather than hidden: counting while dirty beats
 * not counting (ADR-100 Consequences). When you migrate a file, LOWER the
 * baseline in the same commit — the test tells you the new number.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  COLOR, DURATION, EASING, Z, hexNumber, rgba, dim,
  STATE_TOKENS, COLOR_RULES, CONTRAST_PAIRINGS, SCENE_GROUNDS,
} from './tokens.js'
import { hslOf, hueDistance, contrastRatio, isNeutral } from './colorMath.js'
import { assertCoversPopulation, assertDeclarationsExist } from '../census/partition.js'
import { collectSources, stripComments, relPath } from '../census/sources.js'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')


// ─── ADR-065 Phase 0: the vocabulary is pinned to the doc, both ways ─────────

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

test('hexNumber / rgba / dim derive THREE and CSS forms from one token', () => {
  assert.equal(hexNumber('#22c55e'), 0x22c55e)
  assert.equal(rgba('#22c55e', 0.28), 'rgba(34,197,94,0.28)')
  assert.equal(rgba(COLOR.factTone, 0.3), 'rgba(34,197,94,0.3)')
  // `dim` exists so "a faint accent" stays a FUNCTION of accent rather than a
  // second hex that stops tracking it (MeshView's emissive cues were three such
  // literals, still pointing at the retired cyan long after it had moved).
  assert.equal(dim('#ffffff', 0.5), '#808080')
  assert.equal(dim('#ff7d2e', 1), '#ff7d2e')
  assert.equal(dim('#ff7d2e', 0), '#000000')
})

// ─── ADR-100 G1: the entity default is neutral, and still separable ──────────

test('entityDefault carries no hue — saturation is spent on state, not on defaults (G1)', () => {
  const { saturation } = hslOf(COLOR.entityDefault)
  assert.ok(
    isNeutral(COLOR.entityDefault, COLOR_RULES.neutralMaxSaturation),
    `COLOR.entityDefault (${COLOR.entityDefault}) has saturation ${(saturation * 100).toFixed(1)}%, ` +
    `above the neutral budget of ${(COLOR_RULES.neutralMaxSaturation * 100).toFixed(0)}%. ` +
    'An entity with nothing to report must not compete with one that has something to report — ' +
    'that competition is what made every screen colourful and nothing legible (ADR-100 §力学 1).',
  )
})

test('the chrome ground is neutral too (nothing that reports no state may carry hue)', () => {
  for (const token of ['surface', 'surfaceSunken', 'surfaceRaised', 'border', 'textPrimary', 'textSecondary']) {
    const { saturation } = hslOf(COLOR[token])
    assert.ok(isNeutral(COLOR[token], COLOR_RULES.neutralMaxSaturation),
      `COLOR.${token} (${COLOR[token]}) is ${(saturation * 100).toFixed(1)}% saturated — chrome reports no state`)
  }
})

test('the entity body stays separable from every scene ground it sits on (G1)', () => {
  // ADR-100 recorded "contrast not yet measured" as a falsifiable assumption.
  // This is where it stops being an assumption. Figure/ground separation moved
  // to LIGHTNESS once the figure went neutral — so it has to be measured, not
  // assumed from "grey is obviously different from navy".
  for (const ground of SCENE_GROUNDS) {
    const ratio = contrastRatio(COLOR.entityDefault, COLOR[ground])
    assert.ok(ratio >= COLOR_RULES.minEntityContrast,
      `entityDefault vs ${ground}: ${ratio.toFixed(2)} : 1, below ${COLOR_RULES.minEntityContrast} : 1. ` +
      'A neutral body over a dark backdrop is the failure mode this ADR was warned about.')
  }
})

test('text and accent clear WCAG AA on the grounds they are actually drawn on', () => {
  // Declared PAIRINGS, not a cross product: `textSecondary` never lands on
  // `surfaceRaised`, and asserting it would force secondary text light enough
  // to stop being secondary. Name the real pairings rather than lower the bar
  // for everyone (原則 #31 — declare the exception, don't dilute the rule).
  for (const [fg, grounds] of Object.entries(CONTRAST_PAIRINGS)) {
    for (const ground of grounds) {
      const ratio = contrastRatio(COLOR[fg], COLOR[ground])
      assert.ok(ratio >= COLOR_RULES.minTextContrast,
        `${fg} on ${ground}: ${ratio.toFixed(2)} : 1, below WCAG AA ${COLOR_RULES.minTextContrast} : 1`)
    }
  }
})

// ─── ADR-100 G2 / Decision 3: one meaning, one colour ────────────────────────

test('no two state meanings share a hue (G2, reverse direction)', () => {
  const hues = STATE_TOKENS.map(t => {
    const { hue, saturation } = hslOf(COLOR[t])
    assert.ok(hue !== null,
      `COLOR.${t} is listed in STATE_TOKENS but is neutral (${COLOR[t]}) — a state colour needs a hue to separate`)
    assert.ok(saturation > COLOR_RULES.neutralMaxSaturation,
      `COLOR.${t} is a state token but only ${(saturation * 100).toFixed(1)}% saturated`)
    return [t, hue]
  })

  let tightest = { pair: null, gap: Infinity }
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      const gap = hueDistance(hues[i][1], hues[j][1])
      if (gap < tightest.gap) tightest = { pair: `${hues[i][0]} ↔ ${hues[j][0]}`, gap }
    }
  }
  assert.ok(tightest.gap >= COLOR_RULES.minHueSeparationDeg,
    `${tightest.pair} are only ${tightest.gap.toFixed(1)}° apart (budget ${COLOR_RULES.minHueSeparationDeg}°). ` +
    'Two meanings sharing a hue is how "selected", "measured" and "snapped" became one warm blur. ' +
    'Move one of them hue-wise, or displace a meaning — do not lower the budget.')
})

test('STATE_TOKENS names real tokens, and every non-listed token has a stated reason', () => {
  // The exclusion list is the load-bearing half: an unlisted token would make
  // the hue rule quietly weaker with nothing to show for it (原則 #29 — every
  // entry is either governed or explicitly out of scope).
  const EXCLUDED_WITH_REASON = {
    surface:       'chrome ground — reports no state',
    surfaceSunken: 'chrome ground — reports no state',
    surfaceRaised: 'chrome ground — reports no state',
    border:        'chrome ground — reports no state',
    textPrimary:   'neutral — no hue to separate',
    textSecondary: 'neutral — no hue to separate',
    backdropTop:   'the ground (ADR-067) — G1 says the ground reports no state',
    backdropMid:   'the ground (ADR-067)',
    backdropDeep:  'the ground (ADR-067)',
    gridMajor:     'the ground (ADR-067)',
    gridMinor:     'the ground (ADR-067)',
    entityDefault: 'neutral by construction (G1)',
    accentSoft:    'the SAME meaning as accent at lower strength — shares its hue on purpose',
    axisX:         'reserved by external convention (ROS REP-103)',
    axisY:         'reserved by external convention (ROS REP-103)',
    axisZ:         'reserved by external convention (ROS REP-103)',
    stageGlow:     'atmosphere, not state (ADR-067 boot stage)',
  }
  for (const t of STATE_TOKENS) {
    assert.ok(t in COLOR, `STATE_TOKENS lists ${t}, which is not a COLOR token`)
  }
  const unaccounted = Object.keys(COLOR)
    .filter(t => !STATE_TOKENS.includes(t) && !(t in EXCLUDED_WITH_REASON))
  assert.deepEqual(unaccounted, [],
    `these tokens are neither governed by the hue rule nor declared out of it: ${unaccounted.join(', ')}. ` +
    'Add them to STATE_TOKENS, or to EXCLUDED_WITH_REASON with the reason spelled out.')
})

/**
 * Every window that paints "this is what you are operating on".
 *
 * ENUMERATED, not discovered: ADR-100 counted four colours for this one meaning
 * (Outliner salmon, `accent` blue-violet, indicator cyan, CF origin gold), and a
 * check that walks the code looking for selection painters would only ever find
 * the ones that already exist. The rubber band below was NOT in ADR-100's
 * blast-radius table — it turned up while collapsing the other six, the same way
 * ADR-096 turned up a third writer its own ADR had missed.
 *
 * ADR-102 gave the list a DENOMINATOR. On its own this table can only be checked
 * one way — "does each listed painter still reach for the token?" — which is
 * silent about the tenth painter nobody listed. The population is derivable:
 * every `src/**` file that references `COLOR.accent` is either a selection
 * painter (here) or declared to use the accent for something else
 * (`ACCENT_NON_PAINTERS`). Unclassified must be zero.
 */
const SELECTION_PAINTERS = [
  { kind: 'Outliner row (colour derivation)', file: 'src/view/OutlinerRowMath.js' },
  { kind: 'Outliner row (DOM view)',          file: 'src/view/OutlinerView.js' },
  { kind: 'Outliner row (React panel)',       file: 'src/components/Outliner/Outliner.jsx' },
  { kind: '3D body highlight + outline',      file: 'src/view/MeshView.js' },
  { kind: 'CoordinateFrame origin sphere',    file: 'src/view/CoordinateFrameView.js' },
  { kind: 'LINK NETWORK focus',               file: 'src/view/LinkNetworkView.js' },
  { kind: 'Mobile toolbar active tool',       file: 'src/components/Toolbar/ToolbarButton.jsx' },
  { kind: 'Entity floating label',            file: 'src/view/EntityLabel.js' },
  { kind: 'Rubber-band rectangle select',     file: 'src/controller/SelectionManager.js' },
  // Found by ADR-102's denominator, not by reading: the selection "tap" cue
  // (ADR-068) paints exactly this meaning — "this is the thing you just picked"
  // — and was missing from the nine ADR-100 enumerated. A list with no
  // population to check against cannot report what is absent from it.
  { kind: 'Selection tap pulse (Tier A/F)',   file: 'src/view/SelectPulse.js' },
]

/**
 * Files that consume `COLOR.accent` for something that is NOT entity selection,
 * with the meaning they paint instead.
 *
 * The accent means "what you are operating on" (ADR-100 G2), and that meaning is
 * wider than *entity* selection: the focused input, the current mode, the step
 * you are on. These are declared rather than inferred so that the count of
 * unclassified accent users stays zero — an omission here reads exactly like a
 * deliberate exclusion if nobody writes one down (原則 #29 / ADR-102).
 */
const ACCENT_NON_PAINTERS = [
  { key: 'src/components/NPanel/NPanelFrame.jsx',   why: 'keyboard focus ring on a numeric input (DOM focus, not entity selection)' },
  { key: 'src/components/NPanel/NPanelGeneric.jsx', why: 'keyboard focus ring on a numeric input' },
  { key: 'src/components/NPanel/npanelShared.jsx',  why: 'keyboard focus ring shared by the N-panel field primitives' },
  { key: 'src/components/Header/ModeDropdown.jsx',  why: 'the currently active MODE in the dropdown — a mode is not an entity' },
  { key: 'src/components/Onboarding/TourCard.jsx',  why: 'the onboarding step you are on (ADR-063 tour), paired with factTone for done steps' },
  { key: 'src/view/ChromeMath.js',                  why: 'the breathing glow that marks an affordance asking for attention (ADR-065/080) — an invitation, not a selection' },
]

/**
 * Colours that used to mean "selected" somewhere, plus their rgba forms.
 * Their required count anywhere in `src/**` is ZERO.
 */
const RETIRED_SELECTION_COLORS = [
  { pattern: /#ff8c69/i,                        was: 'Outliner active row name (salmon)' },
  { pattern: /rgba\(\s*255\s*,\s*112\s*,\s*67/, was: 'Outliner active row background' },
  { pattern: /#5c5cff/i,                        was: 'the declared `accent` (blue-violet) nothing consumed' },
  { pattern: /#3d3d6b/i,                        was: 'the declared `accentSoft` nothing consumed' },
  { pattern: /(#|0x)ffcc00/i,                   was: 'CoordinateFrame selected origin sphere (gold)' },
  { pattern: /(#|0x)112244/i,                   was: 'MeshView selected emissive (a dimmed cyan by hand)' },
  { pattern: /(#|0x)0a1522/i,                   was: 'MeshView hovered emissive (a dimmer cyan by hand)' },
]

test('every accent consumer is classified — painter or declared otherwise (ADR-102)', () => {
  // The denominator the enumeration was missing. Walking the painters can only
  // ever confirm the painters; the tenth one is invisible to it (原則 #31).
  const population = collectSources()
    .filter(abs => /COLOR\.accent\b/.test(stripComments(readFileSync(abs, 'utf8')).join('\n')))
    .map(abs => relPath(abs))

  assertCoversPopulation({
    what: 'COLOR.accent の消費者',
    population,
    declared: SELECTION_PAINTERS.map(p => p.file),
    excluded: ACCENT_NON_PAINTERS,
    howDerived: 'src/** のうち COLOR.accent を参照するファイル (コメントは除去済み)',
    onNew: 'それが「操作対象の実体」を塗るなら SELECTION_PAINTERS へ、'
         + '別の意味 (focus / mode / step / 誘目) を塗るなら ACCENT_NON_PAINTERS へ理由付きで足す',
  })
})

test('every enumerated selection painter consumes the accent token (G2)', () => {
  const missing = []
  for (const { kind, file } of SELECTION_PAINTERS) {
    const src = readFileSync(join(repoRoot, file), 'utf8')
    if (!/COLOR\.accent\b/.test(src)) missing.push(`${kind} — ${file}`)
  }
  assert.deepEqual(missing, [],
    '\nthese selection painters no longer reference COLOR.accent:\n  ' + missing.join('\n  ') +
    '\nEither they stopped painting selection (then remove the entry deliberately) or they ' +
    'reached for a literal again. "Selected" must look the same in every window.\n')
})

test('retired selection colours appear zero times in src/** (G2)', () => {
  const found = []
  for (const abs of collectSources()) {
    const rel = relPath(abs)
    stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
      for (const { pattern, was } of RETIRED_SELECTION_COLORS) {
        if (pattern.test(line)) found.push(`${rel}:${i + 1} — ${was}`)
      }
    })
  }
  assert.deepEqual(found, [],
    `\n${found.join('\n')}\n\nUse COLOR.accent (or dim(COLOR.accent, f) for a faint form).\n`)
})

// ─── ADR-100 G3: the ratchet ─────────────────────────────────────────────────

/**
 * Modules that own a DATA-meaning colour vocabulary, declared out of scope for
 * the state palette (ADR-100 Decision 5) and therefore out of the ratchet's
 * denominator.
 *
 * Writing this list down is the whole mechanism. Without it these ~40 hexes
 * count as undeclared, the baseline absorbs them, and the number stops meaning
 * "colours nobody has claimed" (原則 #29 — governed or explicitly excluded; an
 * omission reads exactly like a declaration if you never write one down).
 */
const DECLARED_VOCABULARIES = {
  'src/theme/tokens.js':            'the state palette itself',
  'src/theme/semantic.js':          'link types, personas, node types, sub-element kinds (ADR-100 §5)',
  'src/domain/IFCClassRegistry.js': 'IFC classification tints — owned by the domain, which must not '
                                  + 'depend on theme/ (核 §1.1 dependency direction)',
}

/**
 * Undeclared hex literals in `src/**`, as of ADR-100's implementation.
 *
 * Measured by `scanUndeclared()` below, so the numbers and the check cannot
 * drift apart. LOWER THEM when you migrate a file — the failure message prints
 * the current count.
 *
 *   lane                     before ADR-100        after
 *   `.js` only               333 occ / 111 hues    257 occ /  85 hues
 *   `.js` + `.jsx` (this)    878 occ / 225 hues    790 occ / 206 hues
 *
 * Both columns use THIS function — same exclusions, same comment stripping —
 * because a before/after pair measured two ways proves nothing. ADR-100's own
 * headline figure ("420 occurrences / 150 colours") came from a raw grep of
 * `.js` that counted colours named inside comments; it is the right order of
 * magnitude and the wrong number to ratchet against.
 *
 * The `.jsx` half was never in the ADR's figure and is the larger half — the
 * React panels are where most of the colour lives. Counting it is not a
 * regression against the ADR; NOT counting it would have been.
 */
const UNDECLARED_OCCURRENCE_BASELINE = 790
const UNDECLARED_DISTINCT_BASELINE   = 206

const HEX_LITERAL = /#[0-9a-fA-F]{6}\b|\b0x[0-9a-fA-F]{6}\b/g

function scanUndeclared() {
  let occurrences = 0
  const distinct = new Set()
  const byFile = []
  for (const abs of collectSources()) {
    const rel = relPath(abs)
    if (rel in DECLARED_VOCABULARIES) continue
    const hits = stripComments(readFileSync(abs, 'utf8')).join('\n').match(HEX_LITERAL) ?? []
    if (hits.length) byFile.push([rel, hits.length])
    occurrences += hits.length
    for (const h of hits) distinct.add(h.toLowerCase().replace(/^0x/, '#'))
  }
  byFile.sort((a, b) => b[1] - a[1])
  return { occurrences, distinct: distinct.size, byFile }
}

test('undeclared colour literals never increase — and the baseline is stated (G3)', () => {
  const { occurrences, distinct, byFile } = scanUndeclared()
  const worst = byFile.slice(0, 8).map(([f, n]) => `    ${String(n).padStart(3)}  ${f}`).join('\n')

  assert.ok(occurrences <= UNDECLARED_OCCURRENCE_BASELINE,
    `undeclared hex literals rose to ${occurrences} (baseline ${UNDECLARED_OCCURRENCE_BASELINE}).\n` +
    '  A new colour belongs in src/theme/tokens.js as a ROLE, or — if it carries DATA meaning\n' +
    `  rather than state — in src/theme/semantic.js. Heaviest files right now:\n${worst}\n`)

  assert.ok(distinct <= UNDECLARED_DISTINCT_BASELINE,
    `distinct undeclared colours rose to ${distinct} (baseline ${UNDECLARED_DISTINCT_BASELINE}).\n` +
    '  A near-duplicate of an existing colour is the exact defect ADR-100 was written about:\n' +
    '  COLOR.measure was declared #f5a623 while 13 call sites drew #f9a825.\n')

  // A ratchet that never tightens is a ratchet nobody turns. If the real count
  // has dropped, the baseline is stale and must come down in the same commit —
  // otherwise the budget silently re-opens room for the colours just removed.
  assert.equal(occurrences, UNDECLARED_OCCURRENCE_BASELINE,
    `undeclared literals are down to ${occurrences} — lower UNDECLARED_OCCURRENCE_BASELINE to ${occurrences}.`)
  assert.equal(distinct, UNDECLARED_DISTINCT_BASELINE,
    `distinct undeclared colours are down to ${distinct} — lower UNDECLARED_DISTINCT_BASELINE to ${distinct}.`)
})

test('the declared vocabularies exist and actually hold colours (the exclusions are not idle)', () => {
  // An exclusion whose file has no colours in it is indistinguishable from an
  // exclusion that is wrong. Same shape as ADR-099's "the entry point is real"
  // test: a rule whose subject vanished passes for the wrong reason.
  assertDeclarationsExist({
    what: 'ratchet の分母から外した色語彙',
    declarations: Object.entries(DECLARED_VOCABULARIES).map(([key, why]) => ({ key, why })),
    exists: (file) => {
      const src = readFileSync(join(repoRoot, file), 'utf8')
      HEX_LITERAL.lastIndex = 0
      const hit = HEX_LITERAL.test(src)
      HEX_LITERAL.lastIndex = 0
      return hit
    },
    onStale: 'that file holds no colour literals any more — drop the exclusion, '
           + 'otherwise the ratchet quietly stops counting a file that could refill with hexes',
  })
})
