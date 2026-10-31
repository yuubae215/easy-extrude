/**
 * BodyMountStacking.test.js — what a DOM element mounted straight on
 * `document.body` stacks against.
 *
 * ## Why this is asked here
 *
 * React panels live inside `#react-ui-root` (`position:fixed; z-index:100` —
 * index.html), which is its own stacking context: whatever z a panel writes
 * inside it, the whole root sits above the scene labels. An element appended to
 * `document.body` has no such shelter — it competes with the 3D labels
 * (`EntityLabel`, `Z.sceneLabel`) directly, and on a TIE the later DOM node wins.
 *
 * The LINK NETWORK panel wrote the literal `'50'` — the same number as
 * `Z.sceneLabel` — so every label whose 3D point projected under the panel drew
 * over it (2026-10-31, seen while checking ADR-168 S3: the `tcp` label printed
 * across the tree). The number looked like a tier; it was a neighbour's tier.
 *
 * So the population is derived (files that mount on `document.body`) and each
 * one declares the tier it stacks on, written as a `Z` token — an edge panel
 * must use `Z.edgePanel`, which the token table puts above `Z.sceneLabel`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, relPath, stripCommentsFlat } from '../census/sources.js'
import { assertCoversPopulation } from '../census/partition.js'
import { Z } from '../theme/tokens.js'

/** Files that mount on `document.body` and paint a layer — and the tier each declares. */
const BODY_MOUNT_TIERS = {
  'src/view/LinkNetworkView.js': 'edgePanel',   // a left-edge panel: above the scene labels
  'src/view/GizmoView.js':       'gizmo',       // the navigation gizmo canvas: below the labels by design
}

/** Files that mount on `document.body` but are not a layer this rule is about. */
const BODY_MOUNT_EXCLUDED = [
  { key: 'src/service/SceneExporter.js', why: 'a temporary <a download> clicked and removed in the same tick — never painted' },
  { key: 'src/controller/AppController.js', why: 'the rectangle-selection outline: a transient gesture over the canvas, drawn only while dragging there' },
]

const mounters = () => collectSources({ jsx: false })
  .filter(f => /document\.body\.appendChild\(/.test(stripCommentsFlat(readFileSync(f, 'utf8'))))

test('every file that mounts on document.body is classified (derived population)', () => {
  assertCoversPopulation({
    what: 'files that append to document.body',
    population: mounters().map(relPath),
    declared: Object.keys(BODY_MOUNT_TIERS),
    excluded: BODY_MOUNT_EXCLUDED,
    howDerived: 'non-test .js under src/ whose code contains `document.body.appendChild(`',
    onNew: 'declare its tier in BODY_MOUNT_TIERS (a Z token) — or exclude it with why it paints no layer',
  })
})

test('a body-mounted layer writes its tier as the declared Z token — never a literal number', () => {
  for (const [file, tier] of Object.entries(BODY_MOUNT_TIERS)) {
    assert.ok(tier in Z, `${file}: "${tier}" is not a Z tier`)
    const src = stripCommentsFlat(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'))
    const literals = [...src.matchAll(/zIndex:\s*['"]?\d+['"]?/g)].map(m => m[0])
    assert.deepEqual(literals, [], `${file} writes a literal z-index — use String(Z.${tier})`)
    assert.match(src, new RegExp(`zIndex:\\s*String\\(Z\\.${tier}\\)`), `${file} must stack on Z.${tier}`)
  }
})

test('an edge panel stacks above the scene labels — the tiers say so, not the DOM order', () => {
  assert.ok(Z.edgePanel > Z.sceneLabel)
  for (const [file, tier] of Object.entries(BODY_MOUNT_TIERS)) {
    if (tier === 'edgePanel') assert.ok(Z[tier] > Z.sceneLabel, file)
  }
})
