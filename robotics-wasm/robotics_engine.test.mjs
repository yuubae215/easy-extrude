// Smoke test for the C++ (KDL + ruckig) → WASM measurement-instrument kernel
// (ADR-053 §4 / §11). Imports the COMMITTED build artifact under
// src/engine/robotics-wasm/ — so it runs in CI without the C++ toolchain,
// exactly mirroring the committed-artifact policy of the Rust engine (ADR-027).
//
// Run: node --test robotics-wasm/robotics_engine.test.mjs
// (kept OUT of `test:context`, which is the THREE-free pure-JS lane.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import createRoboticsEngine from '../src/engine/robotics-wasm/robotics_engine.mjs';

const m = await createRoboticsEngine();

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('KDL planar 2R FK — straight arm reaches (l1+l2, 0, 0)', () => {
  const p = m.planar2rFk(1, 1, 0, 0);
  assert.ok(near(p[0], 2) && near(p[1], 0) && near(p[2], 0), `got ${p}`);
});

test('KDL planar 2R FK — base joint at 90° reaches (0, 2, 0)', () => {
  const p = m.planar2rFk(1, 1, Math.PI / 2, 0);
  assert.ok(near(p[0], 0) && near(p[1], 2) && near(p[2], 0), `got ${p}`);
});

test('KDL planar 2R FK — elbow at 90° reaches (1, 1, 0)', () => {
  const p = m.planar2rFk(1, 1, 0, Math.PI / 2);
  assert.ok(near(p[0], 1) && near(p[1], 1) && near(p[2], 0), `got ${p}`);
});

test('KDL translation unit linked (version probe)', () => {
  assert.equal(m.kdlVersion(), '1.5.1');
});

test('ruckig — valid rest-to-rest move yields a finite positive duration', () => {
  const t = m.ruckigMoveDuration(1.0, 1.0, 2.0, 5.0);
  assert.ok(Number.isFinite(t) && t > 0, `got ${t}`);
});

test('ruckig — zero limits cannot reach target → -1 sentinel', () => {
  assert.equal(m.ruckigMoveDuration(1.0, 0, 0, 0), -1);
});
