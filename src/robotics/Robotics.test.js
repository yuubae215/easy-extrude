/**
 * Robotics.test.js — ADR-053 Phase 2: the pure measurement kernels (FK + FK-
 * sampling reach, AABB collision baking) and the LocalComputeBackend seam.
 *
 * THREE-free; runs under bare `node --test`.  Run with:  pnpm test:context
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  forwardKinematics,
  reachTargets,
  sampleConfigs,
  movableJoints,
  quatFromAxisAngle,
  MalformedChain,
} from './Kinematics.js'
import { bakeContacts, MalformedCollisionJob } from './Collision.js'
import { LocalComputeBackend, UnknownJob } from './ComputeBackend.js'

const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps

// ── forward kinematics ────────────────────────────────────────────────────────

test('FK: a single z-revolute at 90° rotates a +X tcp offset onto +Y', () => {
  const chain = {
    joints: [{ type: 'revolute', axis: [0, 0, 1] }],
    tcp: { xyz: [1, 0, 0] },
  }
  const { position } = forwardKinematics(chain, [Math.PI / 2])
  assert.ok(close(position.x, 0), `x=${position.x}`)
  assert.ok(close(position.y, 1), `y=${position.y}`)
  assert.ok(close(position.z, 0), `z=${position.z}`)
})

test('FK: a prismatic joint translates the tcp along its axis', () => {
  const chain = { joints: [{ type: 'prismatic', axis: [1, 0, 0] }], tcp: { xyz: [0, 0, 0] } }
  const { position } = forwardKinematics(chain, [5])
  assert.ok(close(position.x, 5))
})

test('FK: fixed joints consume no q value and apply their origin offset', () => {
  const chain = {
    joints: [
      { type: 'fixed', origin: { xyz: [0, 0, 2] } },
      { type: 'revolute', axis: [0, 0, 1], origin: { xyz: [1, 0, 0] } },
    ],
    tcp: { xyz: [0, 0, 0] },
  }
  assert.equal(movableJoints(chain).length, 1)        // only the revolute is movable
  const { position } = forwardKinematics(chain, [0])  // q has ONE entry, not two
  assert.ok(close(position.x, 1) && close(position.z, 2))
})

test('quatFromAxisAngle is normalised (unit quaternion)', () => {
  const q = quatFromAxisAngle([0, 0, 3], 1.234)       // non-unit axis
  const n = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  assert.ok(close(n, 1))
})

// ── FK-sampling reach ─────────────────────────────────────────────────────────

const planarArm = {
  // 2-link planar arm in the XY plane, both joints about +Z, reach ≈ 2.
  joints: [
    { type: 'revolute', axis: [0, 0, 1], limit: { lower: -Math.PI, upper: Math.PI } },
    { type: 'revolute', axis: [0, 0, 1], origin: { xyz: [1, 0, 0] }, limit: { lower: -Math.PI, upper: Math.PI } },
  ],
  tcp: { xyz: [1, 0, 0] },
}

test('reach: a target inside the workspace is reachable with a positive margin', () => {
  // Tolerance is matched to the discrete FK-sample grid density (a 2-DOF arm
  // reaches a 2-D point at isolated configs, so a grid point rarely lands exactly).
  const [r] = reachTargets(planarArm, [{ ref: 'pick', x: 1.5, y: 0, z: 0 }], { samples: 25, tolerance: 0.6 })
  assert.equal(r.ref, 'pick')
  assert.equal(r.reachable, true)
  assert.ok(r.margin > 0, `margin=${r.margin}`)       // inside the outer reach boundary
})

test('reach: a target beyond the arm length is unreachable with a negative margin', () => {
  const [r] = reachTargets(planarArm, [{ ref: 'far', x: 5, y: 0, z: 0 }], { samples: 25, tolerance: 0.6 })
  assert.equal(r.reachable, false)
  assert.ok(r.margin < 0, `margin=${r.margin}`)
})

test('reach output feeds robot_reach: shape matches the predicate operand', () => {
  const out = reachTargets(planarArm, [{ ref: 'pick', x: 1.5, y: 0, z: 0 }], { samples: 8 })
  for (const t of out) {
    assert.equal(typeof t.ref, 'string')
    assert.equal(typeof t.reachable, 'boolean')
    assert.equal(typeof t.margin, 'number')
  }
})

test('sampleConfigs grid explodes are capped, not hung', () => {
  const sixAxis = { joints: Array.from({ length: 6 }, () => ({ type: 'revolute', axis: [0, 0, 1] })) }
  assert.throws(() => sampleConfigs(sixAxis, 20), MalformedChain)   // 20^6 ≫ cap
  assert.equal(sampleConfigs(sixAxis, 3).length, 3 ** 6)            // 729 ok
})

test('reachTargets rejects an empty target list', () => {
  assert.throws(() => reachTargets(planarArm, []), MalformedChain)
})

// ── AABB collision baking ─────────────────────────────────────────────────────

test('collision self: overlapping links bake a negative (penetration) clearance', () => {
  const contacts = bakeContacts({
    scope: 'self',
    links: [
      { ref: 'link1', box: { x: [0, 2], y: [0, 1] } },
      { ref: 'link2', box: { x: [1, 3], y: [0, 1] } },   // overlaps link1 on x
    ],
  })
  assert.equal(contacts.length, 1)
  assert.ok(contacts[0].clearance < 0, `clearance=${contacts[0].clearance}`)
})

test('collision self: separated links bake a positive clearance', () => {
  const contacts = bakeContacts({
    scope: 'self',
    links: [
      { ref: 'link1', box: { x: [0, 1], y: [0, 1] } },
      { ref: 'link2', box: { x: [4, 5], y: [0, 1] } },   // 3 apart on x
    ],
  })
  assert.ok(close(contacts[0].clearance, 3), `clearance=${contacts[0].clearance}`)
})

test('collision self: ignored pairs are dropped order-insensitively', () => {
  const links = [
    { ref: 'a', box: { x: [0, 2], y: [0, 1] } },
    { ref: 'b', box: { x: [1, 3], y: [0, 1] } },
  ]
  assert.equal(bakeContacts({ scope: 'self', links, ignore: [['b', 'a']] }).length, 0)
})

test('collision env: bakes every link × obstacle pair', () => {
  const contacts = bakeContacts({
    scope: 'env',
    links: [{ ref: 'wrist', box: { x: [0, 1], y: [0, 1] } }],
    obstacles: [
      { ref: 'table', box: { x: [0, 1], y: [2, 3] } },
      { ref: 'fence', box: { x: [5, 6], y: [0, 1] } },
    ],
  })
  assert.equal(contacts.length, 2)
  assert.deepEqual(contacts.map(c => c.b).sort(), ['fence', 'table'])
})

test('collision: malformed jobs throw MalformedCollisionJob', () => {
  assert.throws(() => bakeContacts({ scope: 'sideways', links: [] }), MalformedCollisionJob)
  assert.throws(() => bakeContacts({ scope: 'self', links: [{ box: { x: [0, 1] } }] }), MalformedCollisionJob)
})

// ── ComputeBackend seam ───────────────────────────────────────────────────────

test('LocalComputeBackend dispatches a reach job and tags backend:local', async () => {
  const backend = new LocalComputeBackend()
  const res = await backend.run({ kind: 'reach', chain: planarArm, targets: [{ ref: 'pick', x: 1.5, y: 0 }], options: { samples: 8 } })
  assert.equal(res.backend, 'local')
  assert.equal(res.kind, 'reach')
  assert.equal(res.targets[0].reachable, true)
})

test('LocalComputeBackend dispatches a collision job', async () => {
  const backend = new LocalComputeBackend()
  const res = await backend.run({
    kind: 'collision',
    scope: 'self',
    links: [{ ref: 'a', box: { x: [0, 2], y: [0, 1] } }, { ref: 'b', box: { x: [1, 3], y: [0, 1] } }],
  })
  assert.equal(res.kind, 'collision')
  assert.equal(res.contacts.length, 1)
})

test('LocalComputeBackend throws UnknownJob for an unrecognised kind', async () => {
  const backend = new LocalComputeBackend()
  await assert.rejects(() => backend.run({ kind: 'teleport' }), UnknownJob)
})

// ── purity ────────────────────────────────────────────────────────────────────

test('the kernels do not mutate their inputs', () => {
  const chain = Object.freeze({ joints: Object.freeze([Object.freeze({ type: 'revolute', axis: [0, 0, 1] })]), tcp: { xyz: [1, 0, 0] } })
  const targets = Object.freeze([Object.freeze({ ref: 'pick', x: 0.5, y: 0 })])
  assert.doesNotThrow(() => reachTargets(chain, targets, { samples: 6 }))
  const links = Object.freeze([Object.freeze({ ref: 'a', box: Object.freeze({ x: [0, 1], y: [0, 1] }) })])
  assert.doesNotThrow(() => bakeContacts({ scope: 'self', links }))
})
