/**
 * Criteria-trial contract conformance + route boundary (ADR-165 D6).
 *
 * Run: pnpm --filter easy-extrude-bff run test:contract  (node --test)
 *
 * Same two-ended drift rules as /api/grasp/search: the canonical examples
 * conform; an inbound version mismatch is 400 and never delegated; the BFF
 * stamps the canonical version and forwards to the core API's /criteria-trial
 * (derived from GRASP_SEARCH_URL — one env var names the core API); an upstream
 * that drifts or breaks the schema is 502; a 4xx from the core keeps its reason.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { createRequire } from 'node:module'
import express from 'express'

import {
  CONTRACT_VERSION,
  validateCriteriaRequest,
  validateCriteriaResponse,
} from '../src/grasp/contract.js'
import { criteriaTrialUrl } from '../src/grasp/graspClient.js'
import { criteriaRouter } from '../src/routes/criteria.js'

const require = createRequire(import.meta.url)
const exampleRequest  = require('@easy-extrude/grasp-contract/examples/criteria-trial-request.json')
const exampleResponse = require('@easy-extrude/grasp-contract/examples/criteria-trial-response.json')

test('the canonical criteria-trial examples conform to their schemas', () => {
  assert.deepEqual(validateCriteriaRequest(exampleRequest), { valid: true, errors: [] })
  assert.deepEqual(validateCriteriaResponse(exampleResponse), { valid: true, errors: [] })
})

test('a total score smuggled onto the response is rejected (only solver facts ride the wire)', () => {
  assert.equal(validateCriteriaResponse({ ...exampleResponse, totalScore: 0.4 }).valid, false)
})

test('the criteria-trial URL is the core API named by GRASP_SEARCH_URL', () => {
  process.env.GRASP_SEARCH_URL = 'http://core.internal:4001/grasp-search'
  try {
    assert.equal(criteriaTrialUrl(), 'http://core.internal:4001/criteria-trial')
  } finally {
    delete process.env.GRASP_SEARCH_URL
  }
})

function startStub(handler) {
  const srv = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => handler(req, JSON.parse(raw || '{}'), res))
  })
  return new Promise((resolve) => srv.listen(0, () => resolve(srv)))
}

async function postToRouter(body) {
  const app = express()
  app.use(express.json())
  app.use('/api/criteria', criteriaRouter)
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)) })
  try {
    const res = await fetch(`http://localhost:${srv.address().port}/api/criteria/trial`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally {
    srv.close()
  }
}

async function withUpstream(handler, fn) {
  const upstream = await startStub(handler)
  process.env.GRASP_SEARCH_URL = `http://localhost:${upstream.address().port}/grasp-search`
  try { return await fn() } finally {
    upstream.close()
    delete process.env.GRASP_SEARCH_URL
  }
}

const { contractVersion: _omit, ...request } = exampleRequest

test('inbound version mismatch is 400 and never delegated', async () => {
  const { status, json } = await postToRouter({ ...request, contractVersion: CONTRACT_VERSION + 1 })
  assert.equal(status, 400)
  assert.match(JSON.stringify(json), /mismatch/i)
})

test('a line with no end user is 400 (the schema asks for at least one)', async () => {
  const { status } = await postToRouter({ line: { endUsers: [] } })
  assert.equal(status, 400)
})

test('a valid request is stamped, sent to /criteria-trial, and a conforming answer passes through verbatim', async () => {
  await withUpstream((req, body, res) => {
    assert.equal(req.url, '/criteria-trial')
    assert.equal(body.contractVersion, CONTRACT_VERSION)
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify(exampleResponse))
  }, async () => {
    const { status, json } = await postToRouter(request)
    assert.equal(status, 200)
    assert.deepEqual(json, exampleResponse)
  })
})

test('upstream drift (version or shape) is 502', async () => {
  await withUpstream((_r, _b, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...exampleResponse, contractVersion: CONTRACT_VERSION + 3 }))
  }, async () => assert.equal((await postToRouter(request)).status, 502))
  await withUpstream((_r, _b, res) => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ...exampleResponse, interest: undefined }))
  }, async () => assert.equal((await postToRouter(request)).status, 502))
})

test("a 400 from the core keeps the core's reason (a line it cannot judge)", async () => {
  await withUpstream((_r, _b, res) => {
    res.writeHead(400, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { code: 'invalid_declaration', message: "end user 'x' has a ratio of all zeros" } }))
  }, async () => {
    const { status, json } = await postToRouter(request)
    assert.equal(status, 400)
    assert.match(json.details[0], /ratio of all zeros/)
  })
})
