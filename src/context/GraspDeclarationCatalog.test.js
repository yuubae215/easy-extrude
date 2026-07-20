/**
 * GraspDeclarationCatalog.test.js — presets, gap predicates, capture math
 * (ADR-081 Decision 5). Run via `pnpm test:context` (node --test, THREE-free).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CAMERA_PRESETS,
  GRIPPER_PRESETS,
  matchingPresetId,
  cameraDeclarationGaps,
  gripperDeclarationGaps,
  visionFromViewportCamera,
} from './GraspDeclarationCatalog.js'

// ── Presets ──────────────────────────────────────────────────────────────────

test('every camera preset passes its own gap predicate (seeds are always valid)', () => {
  assert.ok(CAMERA_PRESETS.length >= 1)
  for (const p of CAMERA_PRESETS) {
    assert.deepEqual(cameraDeclarationGaps(p.params), [], p.id)
  }
})

test('every gripper preset passes its own gap predicate', () => {
  assert.ok(GRIPPER_PRESETS.length >= 1)
  for (const p of GRIPPER_PRESETS) {
    assert.deepEqual(gripperDeclarationGaps(p.params), [], p.id)
  }
})

test('presets are frozen (a UI mutation cannot corrupt the catalog)', () => {
  assert.ok(Object.isFrozen(CAMERA_PRESETS))
  assert.ok(Object.isFrozen(CAMERA_PRESETS[0].params))
  assert.ok(Object.isFrozen(CAMERA_PRESETS[0].params.position))
  assert.ok(Object.isFrozen(GRIPPER_PRESETS))
  assert.ok(Object.isFrozen(GRIPPER_PRESETS[0].params))
})

// ── matchingPresetId (fork & tweak derivation) ──────────────────────────────

test('matchingPresetId round-trips every preset and forks on any tweak', () => {
  for (const p of GRIPPER_PRESETS) {
    assert.equal(matchingPresetId(GRIPPER_PRESETS, { ...p.params }), p.id)
  }
  for (const p of CAMERA_PRESETS) {
    const copy = { ...p.params, position: [...p.params.position], viewAxis: [...p.params.viewAxis] }
    assert.equal(matchingPresetId(CAMERA_PRESETS, copy), p.id)
    // Tweak one element → forked (no preset chip active).
    const forked = { ...copy, position: [copy.position[0] + 0.01, copy.position[1], copy.position[2]] }
    assert.equal(matchingPresetId(CAMERA_PRESETS, forked), null)
  }
  assert.equal(matchingPresetId(GRIPPER_PRESETS, { maxOpening: 0.06, fingerClearance: 0.02 }), null)
  assert.equal(matchingPresetId(GRIPPER_PRESETS, null), null)
})

// ── Gap predicates ───────────────────────────────────────────────────────────

test('cameraDeclarationGaps: valid shapes pass, malformed shapes name the gap', () => {
  assert.deepEqual(cameraDeclarationGaps({ position: [0, 0, 1] }), [])
  assert.deepEqual(cameraDeclarationGaps({ position: [0, 0, 1], viewAxis: [0, 0, -1] }), [])
  assert.ok(cameraDeclarationGaps(null).length > 0)
  assert.ok(cameraDeclarationGaps({}).length > 0)
  assert.ok(cameraDeclarationGaps({ position: [0, 0, NaN] }).length > 0)
  assert.ok(cameraDeclarationGaps({ position: [0, 0] }).length > 0)
  assert.ok(cameraDeclarationGaps({ position: [0, 0, 1], viewAxis: [0, 0, 0] }).length > 0)
  assert.ok(cameraDeclarationGaps({ position: [0, 0, 1], viewAxis: [0, 'x', -1] }).length > 0)
  assert.ok(cameraDeclarationGaps({ position: [0, 0, 1], viewAxis: [0, 0, -1], fovHalfAngle: -0.1 }).length > 0)
})

test('cameraDeclarationGaps: fov without a view axis is a gap (silently inert input — #11)', () => {
  const gaps = cameraDeclarationGaps({ position: [0, 0, 1], fovHalfAngle: 0.5 })
  assert.equal(gaps.length, 1)
  assert.match(gaps[0], /view axis/)
})

test('gripperDeclarationGaps: valid passes, missing/negative opening is a gap', () => {
  assert.deepEqual(gripperDeclarationGaps({ maxOpening: 0.06, fingerClearance: 0.01 }), [])
  assert.deepEqual(gripperDeclarationGaps({ maxOpening: 0 }), [])   // clearance optional
  assert.ok(gripperDeclarationGaps(null).length > 0)
  assert.ok(gripperDeclarationGaps({}).length > 0)
  assert.ok(gripperDeclarationGaps({ maxOpening: -0.01 }).length > 0)
  assert.ok(gripperDeclarationGaps({ maxOpening: NaN }).length > 0)
  assert.ok(gripperDeclarationGaps({ maxOpening: 0.06, fingerClearance: -1 }).length > 0)
})

// ── visionFromViewportCamera (capture math) ─────────────────────────────────

/** Column-major identity matrixWorld: camera at origin looking down −Z (world). */
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

test('capture: identity matrix → viewAxis (0,0,-1); position maps verbatim', () => {
  const snap = visionFromViewportCamera({
    position: { x: 1, y: 2, z: 3 },
    matrixWorldElements: IDENTITY,
    fovDeg: null,
  })
  assert.deepEqual(snap, { position: [1, 2, 3], viewAxis: [0, 0, -1], fovHalfAngle: null })
})

test('capture: viewAxis is the negated normalised third matrix column', () => {
  // Third column (elements 8..10) = (0, -1, 0) → looking along +Y; length 2 exercises normalisation.
  const m = [...IDENTITY]
  m[8] = 0; m[9] = -2; m[10] = 0
  const snap = visionFromViewportCamera({ position: { x: 0, y: 0, z: 1 }, matrixWorldElements: m })
  assert.deepEqual(snap.viewAxis, [0, 1, 0])
})

test('capture: perspective fov 60° → half angle π/6 rad; ortho (no fov) → null', () => {
  const withFov = visionFromViewportCamera({ position: { x: 0, y: 0, z: 1 }, matrixWorldElements: IDENTITY, fovDeg: 60 })
  assert.ok(Math.abs(withFov.fovHalfAngle - Math.PI / 6) < 1e-3)
  const ortho = visionFromViewportCamera({ position: { x: 0, y: 0, z: 1 }, matrixWorldElements: IDENTITY })
  assert.equal(ortho.fovHalfAngle, null)
})

test('capture: malformed snapshots return null, never a guessed declaration (#11)', () => {
  assert.equal(visionFromViewportCamera(null), null)
  assert.equal(visionFromViewportCamera({}), null)
  assert.equal(visionFromViewportCamera({ position: { x: NaN, y: 0, z: 0 }, matrixWorldElements: IDENTITY }), null)
  assert.equal(visionFromViewportCamera({ position: { x: 0, y: 0, z: 0 }, matrixWorldElements: [1, 2, 3] }), null)
  const zeroCol = [...IDENTITY]; zeroCol[8] = 0; zeroCol[9] = 0; zeroCol[10] = 0
  assert.equal(visionFromViewportCamera({ position: { x: 0, y: 0, z: 0 }, matrixWorldElements: zeroCol }), null)
})

test('capture: values round to 4 decimals for clean form display', () => {
  const snap = visionFromViewportCamera({
    position: { x: 1.00004999, y: 0, z: 0 },
    matrixWorldElements: IDENTITY,
    fovDeg: 50,
  })
  assert.equal(snap.position[0], 1)
  assert.equal(String(snap.fovHalfAngle).length <= 6, true)
})

test('captured declarations pass the camera gap predicate end-to-end', () => {
  const snap = visionFromViewportCamera({ position: { x: 0.5, y: -0.2, z: 1.1 }, matrixWorldElements: IDENTITY, fovDeg: 45 })
  assert.deepEqual(cameraDeclarationGaps(snap), [])
})
