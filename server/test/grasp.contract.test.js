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

test('valid response instance conforms to the response schema', () => {
  const res = {
    contractVersion: CONTRACT_VERSION,
    candidates: [
      {
        rank: 1,
        pose: { joints: [0, 0, 0] },
        score: { withinReach: true, ikSolvable: true, interferenceFree: true, totalScore: 0.92 },
      },
    ],
  }
  assert.deepEqual(validateResponse(res), { valid: true, errors: [] })
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
      candidates: [{ rank: 1, score: { withinReach: true, ikSolvable: true, interferenceFree: true, totalScore: 0.5 } }],
    }))
  })
  process.env.GRASP_SEARCH_URL = `http://localhost:${upstream.address().port}`
  try {
    const { status, json } = await postToRouter({ layoutVersion: 'layout/1.0', graspSearch: { topN: 1 } })
    assert.equal(status, 200)
    assert.equal(json.candidates[0].rank, 1)
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
      candidates: [{ rank: 1, score: { withinReach: true, ikSolvable: true, interferenceFree: true, totalScore: 0.5 } }],
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
