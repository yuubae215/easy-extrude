/**
 * Grasp contract conformance + contractVersion drift tests.
 *
 * Run: pnpm --filter easy-extrude-bff run test:contract  (node --test)
 *
 * These tests detect drift at BOTH ends (CLAUDE.md "BFF と契約"):
 *   - the BFF's enforced CONTRACT_VERSION must equal the canonical
 *     contract-version.json (code vs contract);
 *   - real request/response instances are matched against the same neutral
 *     schema the external service uses (instance vs contract);
 *   - the /api/grasp/search boundary rejects a mismatched inbound version (400)
 *     and a mismatched/non-conforming upstream response (502).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import express from 'express'

import {
  CONTRACT_VERSION,
  validateRequest,
  validateResponse,
  checkContractVersion,
} from '../src/grasp/contract.js'
import { graspRouter } from '../src/routes/grasp.js'

const require = createRequire(import.meta.url)
const contractVersionDoc = require('@easy-extrude/grasp-contract/contract-version.json')

// ── 1. contractVersion drift: code vs canonical contract ─────────────────────

test('BFF CONTRACT_VERSION matches the canonical contract-version.json', () => {
  assert.equal(CONTRACT_VERSION, contractVersionDoc.contractVersion)
})

test('checkContractVersion: match ok, absent ok, mismatch rejected', () => {
  assert.deepEqual(checkContractVersion(CONTRACT_VERSION), { ok: true })
  assert.deepEqual(checkContractVersion(undefined), { ok: true })
  assert.deepEqual(checkContractVersion(null), { ok: true })
  const bad = checkContractVersion(CONTRACT_VERSION + 1)
  assert.equal(bad.ok, false)
  assert.match(bad.message, /contractVersion mismatch/)
})

// ── 2. Schema conformance: real instances vs the neutral schema ──────────────

test('valid request instance conforms to the request schema', () => {
  const req = {
    contractVersion: CONTRACT_VERSION,
    layoutVersion: 'layout/1.0',
    graspSearch: { objectiveWeights: { reach: 0.6, clearance: 0.4 }, topN: 5 },
  }
  assert.deepEqual(validateRequest(req), { valid: true, errors: [] })
})

test('request missing required fields fails conformance', () => {
  const { valid, errors } = validateRequest({ graspSearch: {} }) // no layoutVersion
  assert.equal(valid, false)
  assert.ok(errors.length > 0)
})

test('request with an unknown top-level field fails (additionalProperties:false)', () => {
  const { valid } = validateRequest({
    layoutVersion: 'layout/1.0',
    graspSearch: {},
    solverHint: 'rrt', // not in the contract — must not be smuggled through
  })
  assert.equal(valid, false)
})

test('valid response instance conforms to the response schema (both pose kinds)', () => {
  const res = {
    contractVersion: CONTRACT_VERSION,
    candidates: [
      {
        rank: 1,
        pose: { kind: 'endEffector', frame: { position: [0.1, 0.2, 0.3], orientation: [0, 0, 0, 1] } },
        score: { withinReach: true, visible: true, ikSolvable: true, interferenceFree: true, graspable: true, totalScore: 0.92 },
      },
      {
        rank: 2,
        pose: { kind: 'jointSpace', chainRef: 'arm_left', joints: [0, 0.5, -0.5, 0, 1.2, 0] },
        score: { withinReach: true, visible: true, ikSolvable: true, interferenceFree: false, graspable: true, totalScore: 0.41 },
      },
    ],
    // v3 rejection funnel — invariant: generated = reach + ik + interference + feasible
    diagnostics: {
      candidatesGenerated: 5,
      rejectedByReach: 2,
      rejectedByVisibility: 0,
      rejectedByIk: 1,
      rejectedByInterference: 0,
      rejectedByGrasp: 0,
      feasible: 2,
      returned: 2,
      reachNearestMiss: 0.03,
      occlusionNearestMiss: null,
      openingNearestMiss: null,
    },
  }
  assert.deepEqual(validateResponse(res), { valid: true, errors: [] })
})

test('pre-union opaque pose shape is rejected (pose is a closed kind union since v2)', () => {
  const { valid } = validateResponse({
    candidates: [
      {
        rank: 1,
        pose: { joints: [0, 0, 0] }, // v1 opaque shape — no kind discriminator
        score: { withinReach: true, visible: true, ikSolvable: true, interferenceFree: true, graspable: true, totalScore: 0.92 },
      },
    ],
  })
  assert.equal(valid, false)
})

test('zero-candidate response conforms — the funnel explains the emptiness', () => {
  // candidates:[] is legal; diagnostics carries WHY (all generated poses were
  // rejected at reach). The UI reads this to render the funnel instead of a
  // blank list.
  const res = {
    contractVersion: CONTRACT_VERSION,
    candidates: [],
    diagnostics: {
      candidatesGenerated: 8,
      rejectedByReach: 8,
      rejectedByVisibility: 0,
      rejectedByIk: 0,
      rejectedByInterference: 0,
      rejectedByGrasp: 0,
      feasible: 0,
      returned: 0,
      reachNearestMiss: 0.12,
      occlusionNearestMiss: null,
      openingNearestMiss: null,
    },
  }
  assert.deepEqual(validateResponse(res), { valid: true, errors: [] })
})

test('pre-v3 response without diagnostics fails conformance (diagnostics is required)', () => {
  const { valid, errors } = validateResponse({
    contractVersion: CONTRACT_VERSION,
    candidates: [{ rank: 1, score: { withinReach: true, visible: true, ikSolvable: true, interferenceFree: true, graspable: true, totalScore: 0.5 } }],
  })
  assert.equal(valid, false)
  assert.match(errors.join(' '), /diagnostics/)
})

test('diagnostics with a smuggled presentation field fails (additionalProperties:false)', () => {
  const { valid } = validateResponse({
    candidates: [],
    diagnostics: {
      candidatesGenerated: 0,
      rejectedByReach: 0,
      rejectedByVisibility: 0,
      rejectedByIk: 0,
      rejectedByInterference: 0,
      rejectedByGrasp: 0,
      feasible: 0,
      returned: 0,
      reachNearestMiss: null,
      occlusionNearestMiss: null,
      openingNearestMiss: null,
      meterColor: '#f00', // presentation is derived client-side, never on the wire
    },
  })
  assert.equal(valid, false)
})

test('response missing a required score field fails conformance', () => {
  const { valid } = validateResponse({
    candidates: [{ rank: 1, score: { withinReach: true, ikSolvable: true /* no interferenceFree/totalScore */ } }],
  })
  assert.equal(valid, false)
})

// ── 3. Route boundary: both-ends drift detection end to end ──────────────────

/** Start a stub grasp-search upstream returning `body` with `status`. */
function startStub(handler) {
  const srv = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => handler(JSON.parse(raw || '{}'), res))
  })
  return new Promise((resolve) => srv.listen(0, () => resolve(srv)))
}

/** Mount the grasp router on a throwaway express app and POST a body. */
async function postToRouter(body) {
  const app = express()
  app.use(express.json())
  app.use('/api/grasp', graspRouter)
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)) })
  const port = srv.address().port
  try {
    const res = await fetch(`http://localhost:${port}/api/grasp/search`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally {
    srv.close()
  }
}

test('inbound version mismatch is rejected with 400 (never delegated)', async () => {
  const { status, json } = await postToRouter({
    contractVersion: CONTRACT_VERSION + 99,
    layoutVersion: 'layout/1.0',
    graspSearch: {},
  })
  assert.equal(status, 400)
  assert.match(JSON.stringify(json), /mismatch/i)
})

test('non-conforming inbound request is rejected with 400', async () => {
  const { status } = await postToRouter({ graspSearch: {} }) // no layoutVersion
  assert.equal(status, 400)
})

test('valid request is delegated and a conforming upstream response passes through', async () => {
  const upstream = await startStub((reqBody, res) => {
    // The BFF must stamp the canonical contractVersion on the outbound request.
    assert.equal(reqBody.contractVersion, CONTRACT_VERSION)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      contractVersion: CONTRACT_VERSION,
      candidates: [{ rank: 1, score: { withinReach: true, visible: true, ikSolvable: true, interferenceFree: true, graspable: true, totalScore: 0.5 } }],
      diagnostics: {
        candidatesGenerated: 1,
        rejectedByReach: 0,
        rejectedByVisibility: 0,
        rejectedByIk: 0,
        rejectedByInterference: 0,
        rejectedByGrasp: 0,
        feasible: 1,
        returned: 1,
        reachNearestMiss: null,
        occlusionNearestMiss: null,
        openingNearestMiss: null,
      occlusionNearestMiss: null,
      openingNearestMiss: null,
      },
    }))
  })
  process.env.GRASP_SEARCH_URL = `http://localhost:${upstream.address().port}`
  try {
    const { status, json } = await postToRouter({ layoutVersion: 'layout/1.0', graspSearch: { topN: 1 } })
    assert.equal(status, 200)
    assert.equal(json.candidates[0].rank, 1)
    // The BFF is a thin window: diagnostics passes through verbatim (no
    // client-side judgment logic, no reshaping).
    assert.deepEqual(json.diagnostics, {
      candidatesGenerated: 1,
      rejectedByReach: 0,
      rejectedByVisibility: 0,
      rejectedByIk: 0,
      rejectedByInterference: 0,
      rejectedByGrasp: 0,
      feasible: 1,
      returned: 1,
      reachNearestMiss: null,
      occlusionNearestMiss: null,
      openingNearestMiss: null,
    })
  } finally {
    upstream.close()
    delete process.env.GRASP_SEARCH_URL
  }
})

test('upstream version drift is rejected with 502', async () => {
  const upstream = await startStub((_reqBody, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({
      contractVersion: CONTRACT_VERSION + 7,
      candidates: [{ rank: 1, score: { withinReach: true, visible: true, ikSolvable: true, interferenceFree: true, graspable: true, totalScore: 0.5 } }],
    }))
  })
  process.env.GRASP_SEARCH_URL = `http://localhost:${upstream.address().port}`
  try {
    const { status } = await postToRouter({ layoutVersion: 'layout/1.0', graspSearch: {} })
    assert.equal(status, 502)
  } finally {
    upstream.close()
    delete process.env.GRASP_SEARCH_URL
  }
})

test('non-conforming upstream response is rejected with 502', async () => {
  const upstream = await startStub((_reqBody, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ candidates: [{ rank: 1, score: { withinReach: true } }] })) // missing fields
  })
  process.env.GRASP_SEARCH_URL = `http://localhost:${upstream.address().port}`
  try {
    const { status } = await postToRouter({ layoutVersion: 'layout/1.0', graspSearch: {} })
    assert.equal(status, 502)
  } finally {
    upstream.close()
    delete process.env.GRASP_SEARCH_URL
  }
})
