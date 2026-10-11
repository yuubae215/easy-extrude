/**
 * GraspDeclarationCatalog.test.js — presets and gap predicates (ADR-081 Decision 5;
 * the vision camera moved to `domain/visionCamera.test.js` with ADR-164 D3). Run via `pnpm test:context` (node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  GRIPPER_KIND,
  DECLARED_GRIPPER_KINDS,
  gripperPresetsFor,
  GRIPPER_PRESETS_BY_KIND,
  matchingPresetId,
  gripperDeclarationGaps,
} from './GraspDeclarationCatalog.js'

// ── Presets ──────────────────────────────────────────────────────────────────

test('every gripper preset passes its own gap predicate', () => {
  for (const kind of DECLARED_GRIPPER_KINDS) {
    const presets = gripperPresetsFor(kind)
    assert.ok(presets.length >= 1, kind)
    for (const p of presets) {
      assert.deepEqual(gripperDeclarationGaps(p.params), [], `${kind}/${p.id}`)
    }
  }
})

test('presets are frozen (a UI mutation cannot corrupt the catalog)', () => {
  assert.ok(Object.isFrozen(GRIPPER_PRESETS_BY_KIND))
  for (const kind of DECLARED_GRIPPER_KINDS) {
    assert.ok(Object.isFrozen(gripperPresetsFor(kind)))
    assert.ok(Object.isFrozen(gripperPresetsFor(kind)[0].params))
  }
})

// ── matchingPresetId (fork & tweak derivation) ──────────────────────────────

test('matchingPresetId round-trips every preset and forks on any tweak', () => {
  for (const kind of DECLARED_GRIPPER_KINDS) {
    const presets = gripperPresetsFor(kind)
    for (const p of presets) {
      assert.equal(matchingPresetId(presets, { ...p.params }), p.id)
    }
  }
  const jaws = gripperPresetsFor(GRIPPER_KIND.PARALLEL_JAW)
  assert.equal(matchingPresetId(jaws, { kind: GRIPPER_KIND.PARALLEL_JAW, maxOpening: 0.06, fingerClearance: 0.02 }), null)
  assert.equal(matchingPresetId(jaws, null), null)
})

// ── Gap predicates ───────────────────────────────────────────────────────────

test('gripperDeclarationGaps: valid passes, missing/negative opening is a gap', () => {
  const jaw = (o) => ({ kind: GRIPPER_KIND.PARALLEL_JAW, ...o })
  assert.deepEqual(gripperDeclarationGaps(jaw({ maxOpening: 0.06, fingerClearance: 0.01 })), [])
  assert.deepEqual(gripperDeclarationGaps(jaw({ maxOpening: 0 })), [])   // clearance optional
  assert.ok(gripperDeclarationGaps(null).length > 0)
  assert.ok(gripperDeclarationGaps({}).length > 0)
  assert.ok(gripperDeclarationGaps(jaw({ maxOpening: -0.01 })).length > 0)
  assert.ok(gripperDeclarationGaps(jaw({ maxOpening: NaN })).length > 0)
  assert.ok(gripperDeclarationGaps(jaw({ maxOpening: 0.06, fingerClearance: -1 })).length > 0)

  // ADR-118: 種別が言われていなければ、それ自体が gap。平行ジョーへ倒さない。
  assert.ok(gripperDeclarationGaps({ maxOpening: 0.06 }).length > 0)
  assert.ok(gripperDeclarationGaps({ kind: 'magnet', maxOpening: 0.06 }).length > 0)

  // 吸引はカップ径で判定され、開口幅は読まれない。
  const cup = (o) => ({ kind: GRIPPER_KIND.SUCTION, ...o })
  assert.deepEqual(gripperDeclarationGaps(cup({ cupDiameter: 0.04 })), [])
  assert.ok(gripperDeclarationGaps(cup({ cupDiameter: 0 })).length > 0)
  assert.ok(gripperDeclarationGaps(cup({ maxOpening: 0.06 })).length > 0)
})

test('gripperPresetsFor: 未宣言の種別は既定へ倒さず throw する (原則 #31)', () => {
  assert.throws(() => gripperPresetsFor('magnet'), /未宣言のハンド種別/)
  assert.throws(() => gripperPresetsFor(undefined), /未宣言のハンド種別/)
})
