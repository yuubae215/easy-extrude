/**
 * The front's objective vocabulary must be the solver's (ADR-117).
 *
 * ## Why this is a census, not a constant
 *
 * `graspSearch.objectiveWeights` is keyed by objective NAME, and `core/`'s
 * `evaluate_objectives` skips names it does not recognise without raising
 * (`objectives.py`: `if definition is None: continue`). So a name the front
 * invents does not fail — it evaporates. The panel shipped with the weights
 * `{ reach, clearance }`, neither of which the registry contains, and the wire
 * answer was `objectiveScores: {}` with `totalScore: 0.0` on every candidate:
 * five results tied at zero, ranked by insertion order, with blank score bars.
 * Nothing was red, because a dropped key leaves no evidence behind
 * (原則 #31 — the defect is in what is ABSENT from the response).
 *
 * ## The population is DERIVED, not remembered (ADR-102)
 *
 * The obvious check — "assert the front declares these three names" — is a
 * `place-list`: it makes the test author's memory the authority, so adding a
 * fourth objective in `core/` leaves this file green and the new objective
 * unreachable from the UI forever. Instead the population is read out of the
 * solver's own registry source. `core/` stays the single authority (§1.1); the
 * front only has to agree with it, and disagreement in EITHER direction is red.
 *
 * This is a source scan rather than an HTTP call on purpose: the check must run
 * in the dependency-free `test:context` lane with no Python and no server.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { DECLARED_OBJECTIVES, OBJECTIVE } from './GraspDeclarationCatalog.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REGISTRY_SOURCE = resolve(HERE, '../../core/easy_extrude_core/engine/objectives.py')

/**
 * The objective names `core/` actually registers, read from the registry literal.
 *
 * Anchored to the `OBJECTIVE_REGISTRY: dict[...] = {` opening and its closing
 * brace so unrelated dict literals in the file cannot leak in. If the literal is
 * ever restructured beyond this shape the extractor finds nothing — and finding
 * nothing FAILS below rather than passing vacuously, because an empty population
 * is the one result a census must never accept quietly (ADR-115).
 *
 * @returns {string[]}
 */
function registeredObjectives() {
  const src = readFileSync(REGISTRY_SOURCE, 'utf8')
  const open = src.indexOf('OBJECTIVE_REGISTRY')
  assert.notEqual(open, -1,
    `OBJECTIVE_REGISTRY not found in ${REGISTRY_SOURCE} — the registry moved; update this census.`)
  const braceStart = src.indexOf('{', open)
  const braceEnd   = src.indexOf('\n}', braceStart)
  assert.ok(braceStart !== -1 && braceEnd > braceStart,
    'could not delimit the OBJECTIVE_REGISTRY literal — update this census.')
  const body = src.slice(braceStart, braceEnd)
  // Keys are top-level `"name": ObjectiveDef(` entries.
  return [...body.matchAll(/^\s{4}"([a-z_]+)":\s*ObjectiveDef\(/gm)].map(m => m[1])
}

test('母集団そのものが空でないこと — 0 件の照合は緑に見えるが検査ではない', () => {
  const registered = registeredObjectives()
  assert.ok(registered.length > 0,
    'core/ の objective を 1 つも読み出せなかった。抽出が空のまま通ると、' +
    'このファイルは「一致した」ではなく「何も見ていない」を報告し続ける (ADR-115)')
})

test('フロントが宣言する objective 名は core/ の登録名と過不足なく一致する', () => {
  const registered = [...registeredObjectives()].sort()
  const declared   = [...DECLARED_OBJECTIVES].sort()
  assert.deepEqual(declared, registered,
    'objectiveWeights のキーが core/ の OBJECTIVE_REGISTRY と食い違っている。\n' +
    '未登録のキーはソルバが無言で捨てるので、スライダーは動くのにスコアは常に空になる。\n' +
    `core/ 側: ${registered.join(', ')}\nfront 側: ${declared.join(', ')}`)
})

test('OBJECTIVE の各値は登録名そのもの (ラベルを混ぜない)', () => {
  const registered = new Set(registeredObjectives())
  for (const [key, name] of Object.entries(OBJECTIVE)) {
    assert.ok(registered.has(name),
      `OBJECTIVE.${key} = "${name}" は core/ に登録が無い。これはワイヤのキーであって表示名ではない`)
  }
})
