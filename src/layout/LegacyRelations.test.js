/**
 * LegacyRelations — the retired relation words and where their data goes
 * (ADR-168 S2-2).
 *
 * Asks, in order: the reading table (every retired word has a declarable cell,
 * anything else throws); each of the three migrations (layout, scene, document)
 * moves without loss and refuses a link that also has a joint; the moved data
 * survives every round trip the app makes (compile ⇄ decompile, parse); and
 * the census — no retired word is left anywhere a link can be written.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

import {
  LEGACY_CELL_BY_WORD, RETIRED_RELATION_WORDS, isRetiredRelationWord, legacyCellOf,
  RetiredRelationError, unclaimedKey, isSameUnclaimed, unclaimedRef, unclaimedIssues,
  migrateLayoutRelations, migrateSceneRelations, migrateDocRelations,
} from './LegacyRelations.js'
import { cellById } from '../domain/relationCells.js'
import { SEMANTIC_TYPES } from '../domain/SpatialLink.js'
import { compileLayout } from './LayoutCompiler.js'
import { decompileLayout } from './LayoutDecompiler.js'
import { validateLayoutDsl } from './LayoutValidator.js'
import { parseImportJson } from '../service/SceneImporter.js'
import { collectSources, stripComments, relPath, repoPath } from '../census/sources.js'

const box = (ref, z = 50) => ({ ref, type: 'Solid', name: ref, dimensions: { x: 100, y: 100, z: 100 }, position: { x: 0, y: 0, z } })

const legacyLayout = () => ({
  version: 'layout/1.0',
  strategy: 'manual',
  entities: [box('table'), box('bin', 150), box('lamp', 400)],
  constraints: [
    { source: 'bin', target: 'table', jointType: null, semanticType: 'above', properties: { note: 'on the top' } },
    { source: 'lamp', target: 'table', jointType: null, semanticType: 'adjacent' },
    { source: 'bin', target: 'table', jointType: null, semanticType: 'connects', properties: {} },
  ],
})

// ── the reading table ────────────────────────────────────────────────────────

test('every retired word reads as a declarable cell that says no more than the word did', () => {
  assert.deepEqual([...RETIRED_RELATION_WORDS].sort(), ['above', 'adjacent'])
  for (const word of RETIRED_RELATION_WORDS) {
    const cell = cellById(legacyCellOf(word))
    assert.equal(cell.declarable, true, word)
    assert.equal(cell.contact, '_', `${word}: contact was never said by the old word`)
  }
  assert.equal(LEGACY_CELL_BY_WORD.above, '_:above')
  assert.equal(LEGACY_CELL_BY_WORD.adjacent, '_:_')
})

test('a word the table does not declare is not read as anything (原則 #31)', () => {
  assert.throws(() => legacyCellOf('beside'), /not a retired relation word/)
  assert.throws(() => legacyCellOf('contains'), /not a retired relation word/)
  assert.equal(isRetiredRelationWord('toString'), false, 'no prototype key passes as a word')
})

test('no retired word is still a semanticType', () => {
  for (const word of RETIRED_RELATION_WORDS) assert.ok(!SEMANTIC_TYPES.includes(word), word)
})

// ── layout ───────────────────────────────────────────────────────────────────

test('layout: the retired constraints move, their properties kept; the rest stay in order', () => {
  const src = legacyLayout()
  const before = structuredClone(src)
  const { dsl, moved } = migrateLayoutRelations(src, 'layout/1.1')
  assert.deepEqual(src, before, 'input-immutable')
  assert.equal(dsl.version, 'layout/1.1')
  assert.deepEqual(dsl.constraints.map(c => c.semanticType), ['connects'])
  assert.deepEqual(dsl.unclaimedRelations, [
    { subject: 'bin', of: 'table', cell: '_:above', was: 'above', properties: { note: 'on the top' } },
    { subject: 'lamp', of: 'table', cell: '_:_', was: 'adjacent' },
  ])
  assert.equal(moved.length, 2)
  assert.deepEqual(validateLayoutDsl(dsl), { valid: true, errors: [] })
})

test('layout: nothing to move returns the same object (no version relabel)', () => {
  const src = { version: 'layout/1.0', entities: [box('a')], constraints: [] }
  const r = migrateLayoutRelations(src, 'layout/1.1')
  assert.equal(r.dsl, src)
  assert.deepEqual(r.moved, [])
})

test('layout: a retired word with a joint is refused with the pair named, not invented around', () => {
  const src = legacyLayout()
  src.constraints[0].jointType = 'fixed'
  assert.throws(() => migrateLayoutRelations(src, 'layout/1.1'),
    (err) => err instanceof RetiredRelationError && /"bin" → "table"/.test(err.message) && /fixed/.test(err.message))
  assert.throws(() => compileLayout(src), RetiredRelationError, 'the compiler is a loader too')
})

test('layout: the validator names a retired word that reached it unmoved', () => {
  const dsl = { version: 'layout/1.1', entities: [box('a'), box('b')],
    constraints: [{ source: 'a', target: 'b', jointType: null, semanticType: 'above' }] }
  const r = validateLayoutDsl(dsl)
  assert.equal(r.valid, false)
  assert.match(r.errors.join('\n'), /retired \(ADR-168\)/)
})

test('layout: an unclaimed relation must name things of the layout and a cell it can say', () => {
  const base = { version: 'layout/1.1', entities: [box('a'), box('b')] }
  const ok = { subject: 'a', of: 'b', cell: '_:above', was: 'above' }
  assert.equal(validateLayoutDsl({ ...base, unclaimedRelations: [ok] }).valid, true)
  for (const bad of [
    { ...ok, of: 'ghost' },
    { ...ok, cell: 'touching:above' },          // ✗ cell: touching cannot be above
    { ...ok, cell: 'apart:front' },             // relative — needs a viewer
    { ...ok, cell: 'sideways' },
    { ...ok, was: 'beside' },
    { ...ok, by: 'ann' },
  ]) {
    assert.equal(validateLayoutDsl({ ...base, unclaimedRelations: [bad] }).valid, false, JSON.stringify(bad))
  }
})

test('layout ⇄ scene: unclaimed relations survive compile and decompile (ids and back to refs)', () => {
  const scene = compileLayout(legacyLayout())
  assert.equal(scene.version, '1.4')
  assert.ok(scene.links.every(l => !isRetiredRelationWord(l.semanticType)))
  assert.equal(scene.unclaimedRelations.length, 2)
  const ids = new Set(scene.objects.map(o => o.id))
  for (const u of scene.unclaimedRelations) assert.ok(ids.has(u.subject) && ids.has(u.of), 'scene ids')
  const { dsl, warnings } = decompileLayout(scene)
  assert.deepEqual(warnings, [])
  assert.deepEqual(dsl.unclaimedRelations.map(unclaimedKey), ['bin|table|_:above', 'lamp|table|_:_'])
  assert.deepEqual(dsl.unclaimedRelations[0].properties, { note: 'on the top' })
  const again = compileLayout(dsl)
  assert.deepEqual(again.unclaimedRelations, scene.unclaimedRelations, 'fixpoint')
})

// ── scene ────────────────────────────────────────────────────────────────────

test('scene: v1.3 semanticType and v1.2 linkType retired links both move, by id', () => {
  const scene = {
    version: '1.3', objects: [],
    links: [
      { id: 'l1', sourceId: 's1', targetId: 's2', jointType: null, semanticType: 'above', properties: { note: 'n' } },
      { id: 'l2', sourceId: 's3', targetId: 's2', linkType: 'adjacent' },
      { id: 'l3', sourceId: 's1', targetId: 's2', jointType: 'fixed', semanticType: 'fastened', properties: {} },
    ],
  }
  const { scene: next, moved } = migrateSceneRelations(scene, '1.4')
  assert.equal(next.version, '1.4')
  assert.deepEqual(next.links.map(l => l.id), ['l3'])
  assert.deepEqual(next.unclaimedRelations, [
    { subject: 's1', of: 's2', cell: '_:above', was: 'above', properties: { note: 'n' } },
    { subject: 's3', of: 's2', cell: '_:_', was: 'adjacent' },
  ])
  assert.equal(moved.length, 2)
})

test('scene file: parseImportJson moves retired words, reads unclaimed relations, refuses a joint', () => {
  const file = (links, extra = {}) => JSON.stringify({ version: '1.3', objects: [], links, ...extra })
  const parsed = parseImportJson(file([{ id: 'l1', sourceId: 'a', targetId: 'b', jointType: null, semanticType: 'above' }]))
  assert.deepEqual(parsed.links, [])
  assert.deepEqual(parsed.unclaimedRelations, [{ subject: 'a', of: 'b', cell: '_:above', was: 'above' }])
  assert.throws(() => parseImportJson(file([{ id: 'l1', sourceId: 'a', targetId: 'b', jointType: 'revolute', semanticType: 'adjacent' }])),
    RetiredRelationError)
  assert.throws(() => parseImportJson(file([], { unclaimedRelations: [{ subject: 'a', of: 'b', cell: '_:_', was: 'nope' }] })),
    /unclaimedRelations\[0\]/)
  assert.throws(() => parseImportJson(JSON.stringify({ version: '9.9', objects: [], links: [{ semanticType: 'above' }] })),
    /Unsupported version/, 'an unknown version is not relabelled by the move')
})

// ── document ─────────────────────────────────────────────────────────────────

test('document: the layout moves and every trace that named a moved constraint follows it', () => {
  const doc = {
    version: 'context/0.7', actors: [],
    specification: {
      layout: legacyLayout(),
      trace: [
        { from: 'g', to: 'constraint:bin→table', kind: 'derives' },
        { from: 'g', to: 'constraint:lamp→table', kind: 'derives' },
        { from: 'g', to: 'table', kind: 'derives' },
      ],
    },
  }
  const { doc: next, moved } = migrateDocRelations(doc, 'layout/1.1')
  assert.equal(moved.length, 2)
  assert.equal(next.specification.layout.version, 'layout/1.1')
  assert.deepEqual(next.specification.trace.map(t => t.to), [
    // bin→table still has a `connects` constraint, so that trace keeps naming it
    'constraint:bin→table',
    'unclaimed:lamp→table',
    'table',
  ])
  assert.equal(unclaimedRef({ subject: 'lamp', of: 'table' }), 'unclaimed:lamp→table')
  const plain = { version: 'context/0.7', specification: { layout: { version: 'layout/1.1', entities: [] } } }
  assert.equal(migrateDocRelations(plain, 'layout/1.1').doc, plain)
})

test('the identity of an unclaimed relation is the pair and the cell, not the old word', () => {
  const a = { subject: 'x', of: 'y', cell: '_:above', was: 'above' }
  assert.equal(isSameUnclaimed(a, { ...a, properties: { note: 'other' } }), true)
  assert.equal(isSameUnclaimed(a, { ...a, cell: '_:_' }), false)
  assert.equal(isSameUnclaimed(a, { ...a, subject: 'y', of: 'x' }), false)
  assert.deepEqual(unclaimedIssues(a), [])
})

// ── the bundled examples ─────────────────────────────────────────────────────

test('every bundled example is free of retired words and its unclaimed relations are well-formed', () => {
  for (const f of readdirSync(repoPath('examples')).filter(n => n.endsWith('.json'))) {
    const json = JSON.parse(readFileSync(repoPath(`examples/${f}`), 'utf8'))
    const layout = json.specification?.layout ?? json
    for (const c of layout.constraints ?? []) assert.ok(!isRetiredRelationWord(c.semanticType), `${f}: ${c.source}→${c.target}`)
    for (const u of layout.unclaimedRelations ?? []) assert.deepEqual(unclaimedIssues(u), [], `${f}: ${JSON.stringify(u)}`)
  }
})

// ── census: no place left that writes a retired word as a link ──────────────

test('census: no source writes a retired word as a semanticType (menus, defaults, colours, styles)', () => {
  const offenders = []
  // The direction `above` (ADR-168 D1 — an Arrangement's `toward`) is a
  // different word that shares the spelling; its one table is exempt by line.
  const DIRECTION_TABLE = /^\s*above\s*:\s*\{\s*picture:/
  const word = /(semanticType\s*:\s*['"`](above|adjacent)['"`])|(^\s*(above|adjacent)\s*:\s*(0x|\{|\[|['"`]#))/
  for (const abs of collectSources()) {
    const rel = relPath(abs)
    if (rel === 'src/layout/LegacyRelations.js') continue
    stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
      if (word.test(line) && !DIRECTION_TABLE.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`)
    })
  }
  assert.deepEqual(offenders, [], `retired relation words still written as link words:\n${offenders.join('\n')}`)
})
