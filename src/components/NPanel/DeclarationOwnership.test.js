/**
 * DeclarationOwnership census — every declaration editor sits on the panel of the
 * entity that owns the fact (ADR-164 D1).
 *
 * The population is the six-row table `DECLARATION_OWNERS`; what is counted is
 * the editors found in the components (`data-declaration="…"`, or the
 * `declaration="…"` prop of the grasp panel's domain cards). Three failure shapes,
 * each with its own assertion:
 *
 *   1. an editor for a declaration NO row owns (an ownerless declaration),
 *   2. an editor on a panel that is not its owner's home (the defect ADR-164
 *      removes: a workpiece's mass on the panel opened from the robot),
 *   3. a declaration in the table with NO editor anywhere — counted from the
 *      table, because walking the editors that exist can never find the one
 *      that does not (原則 #31).
 *
 * Rows still waiting for their owner on screen are pinned by name (ratchet): the
 * set may only shrink, and only together with the change that moves the row.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DECLARATION_OWNERS, DECLARATION_HOME, DECLARATION_DOMAIN, ownerOfDeclaration,
} from '../../view/DeclarationOwnership.js'
import { DECLARATION_KEYS } from '../../domain/searchGeometry.js'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const COMPONENTS = join(ROOT, 'src/components')

/** The ONE file allowed to hold each home's editors. */
const HOME_FILE = Object.freeze({
  [DECLARATION_HOME.WORK_PANEL]:  'src/components/NPanel/declarations/WorkDeclarations.jsx',
  [DECLARATION_HOME.TCP_PANEL]:   'src/components/NPanel/declarations/HandDeclarations.jsx',
  [DECLARATION_HOME.ROBOT_PANEL]: 'src/components/NPanel/declarations/ArmDeclarations.jsx',
  [DECLARATION_HOME.RELATION_PANEL]: 'src/components/NPanel/declarations/GraspDeclarations.jsx',
  [DECLARATION_HOME.GRASP_PANEL]: 'src/components/Grasp/GraspSearchPanel.jsx',
})

/**
 * Domains whose owner is not on screen yet (ADR-164 D2/D3, ADR-165). Shrinks
 * only: the PR that gives an owner its row removes the domain here AND drops its
 * `movesWith` in the table.
 */
const NOT_YET_MOVED = Object.freeze([DECLARATION_DOMAIN.VISION, DECLARATION_DOMAIN.USER])

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    if (statSync(abs).isDirectory()) out.push(...walk(abs))
    else if (/\.jsx?$/.test(name) && !/\.test\.jsx?$/.test(name)) out.push(abs)
  }
  return out
}

/** @returns {{key:string, file:string}[]} every declaration editor in the components */
function editorsOnScreen() {
  const found = []
  for (const abs of walk(COMPONENTS)) {
    const src = readFileSync(abs, 'utf8')
    for (const m of src.matchAll(/(?:data-)?declaration="([^"]+)"/g)) {
      found.push({ key: m[1], file: relative(ROOT, abs).split('\\').join('/') })
    }
  }
  return found
}

test('the table has exactly the six domains of ADR-164 D1, each key owned once', () => {
  assert.deepEqual(DECLARATION_OWNERS.map(r => r.domain).sort(), Object.values(DECLARATION_DOMAIN).sort())
  const keys = DECLARATION_OWNERS.flatMap(r => r.declarations)
  assert.equal(new Set(keys).size, keys.length, 'a declaration key appears under two owners')
  for (const row of DECLARATION_OWNERS) {
    assert.ok(HOME_FILE[row.home], `row "${row.domain}" names a home with no file: ${row.home}`)
  }
})

test('an editor for a declaration no row owns is 0 (no ownerless declaration)', () => {
  const ownerless = editorsOnScreen().filter(e => {
    try { ownerOfDeclaration(e.key); return false } catch { return true }
  })
  assert.deepEqual(ownerless, [], 'add a row to DECLARATION_OWNERS (decide the owner) before adding the editor')
})

test('every editor sits on its owner\'s panel — misplaced editors are 0', () => {
  const misplaced = editorsOnScreen()
    .filter(e => HOME_FILE[ownerOfDeclaration(e.key).home] !== e.file)
    .map(e => `${e.key} in ${e.file} (home: ${HOME_FILE[ownerOfDeclaration(e.key).home]})`)
  assert.deepEqual(misplaced, [])
})

test('every declaration in the table has an editor on screen — declarations with no editor are 0', () => {
  const onScreen = new Set(editorsOnScreen().map(e => e.key))
  const missing = DECLARATION_OWNERS.flatMap(r => r.declarations).filter(k => !onScreen.has(k))
  assert.deepEqual(missing, [], 'a declaration nobody can reach from its owner is the defect ADR-164 removes')
})

test('the robot\'s panel and the tcp\'s panel carry no workpiece declaration (Phase 7 完了条件)', () => {
  const work = new Set(DECLARATION_OWNERS.find(r => r.domain === DECLARATION_DOMAIN.WORK).declarations)
  const elsewhere = editorsOnScreen().filter(e => work.has(e.key) && e.file !== HOME_FILE[DECLARATION_HOME.WORK_PANEL])
  assert.deepEqual(elsewhere, [])
})

test('the document\'s own declaration fields are all owned (population from searchGeometry)', () => {
  // The population is the fields the document joins onto a body — not the
  // table: a new document declaration must find an owner before it ships.
  for (const key of DECLARATION_KEYS) assert.doesNotThrow(() => ownerOfDeclaration(key), key)
})

test('rows not moved yet are exactly the pinned set, each naming the decision that moves it', () => {
  const pending = DECLARATION_OWNERS.filter(r => r.movesWith !== null)
  assert.deepEqual(pending.map(r => r.domain).sort(), [...NOT_YET_MOVED].sort())
  for (const row of pending) {
    assert.equal(row.home, DECLARATION_HOME.GRASP_PANEL, `${row.domain}: only the grasp panel may hold a row that has not moved`)
    assert.match(row.movesWith, /^ADR-\d+/)
  }
  for (const row of DECLARATION_OWNERS.filter(r => r.movesWith === null)) {
    assert.notEqual(row.home, DECLARATION_HOME.GRASP_PANEL, `${row.domain} has moved, so it must not live in the grasp panel`)
  }
})
