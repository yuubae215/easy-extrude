/**
 * BffClient grasp/layout walkthrough tests (ADR-054).
 *
 * Run via `pnpm test:context` (node --test). Pure: global `fetch` is stubbed —
 * no real BFF. Covers the happy paths and that the contract-error envelope
 * (status + details) reaches the caller for 400 / 502 / 503 (PHILOSOPHY #11),
 * while a genuine BFF network failure throws BffUnavailableError.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { BffClient, BffUnavailableError } from './BffClient.js'

/** Install a fake `fetch` for the duration of `fn`, then restore. */
async function withFetch(fake, fn) {
  const original = global.fetch
  global.fetch = fake
  try { await fn() } finally { global.fetch = original }
}

/** Build a Response-like object the client consumes (ok + json()). */
function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

test('compileLayout posts the DSL and returns the scene JSON', async () => {
  let seen = null
  await withFetch(async (url, init) => {
    seen = { url, init }
    return jsonResponse(200, { version: '1.3', objects: [{}, {}], links: [], transformGraph: {} })
  }, async () => {
    const client = new BffClient('/api')
    const scene = await client.compileLayout({ version: 'layout/1.0', entities: [{}] })
    assert.equal(scene.version, '1.3')
    assert.equal(scene.objects.length, 2)
    assert.equal(seen.url, '/api/layout/compile')
    assert.equal(seen.init.method, 'POST')
    assert.deepEqual(JSON.parse(seen.init.body), { dsl: { version: 'layout/1.0', entities: [{}] } })
  })
})

test('graspSearch posts the request verbatim and returns candidates', async () => {
  let body = null
  await withFetch(async (_url, init) => {
    body = JSON.parse(init.body)
    return jsonResponse(200, {
      contractVersion: 1,
      candidates: [{ rank: 1, pose: { joints: [0, 0] }, score: { withinReach: true, ikSolvable: true, interferenceFree: true, totalScore: 0.9 } }],
    })
  }, async () => {
    const client = new BffClient('/api')
    const req = { layoutVersion: 'layout/1.0', graspSearch: { objectiveWeights: { reach: 0.6 }, topN: 3 } }
    const res = await client.graspSearch(req)
    assert.equal(res.candidates[0].rank, 1)
    // The client must NOT inject a contractVersion — the BFF stamps it.
    assert.equal('contractVersion' in body, false)
    assert.deepEqual(body, req)
  })
})

test('400 contract mismatch surfaces status + details', async () => {
  await withFetch(async () => jsonResponse(400, { error: 'Contract version mismatch', details: ['got 99, expected 1'] }), async () => {
    const client = new BffClient('/api')
    await assert.rejects(
      client.graspSearch({ layoutVersion: 'layout/1.0', graspSearch: {} }),
      (err) => {
        assert.equal(err.status, 400)
        assert.equal(err.message, 'Contract version mismatch')
        assert.deepEqual(err.details, ['got 99, expected 1'])
        return true
      },
    )
  })
})

test('502 upstream drift surfaces status + details (not collapsed to BffUnavailable)', async () => {
  await withFetch(async () => jsonResponse(502, { error: 'grasp-search response does not conform to contract', details: ['/candidates/0 missing'] }), async () => {
    const client = new BffClient('/api')
    await assert.rejects(
      client.graspSearch({ layoutVersion: 'layout/1.0', graspSearch: {} }),
      (err) => {
        assert.ok(!(err instanceof BffUnavailableError))
        assert.equal(err.status, 502)
        assert.equal(err.details.length, 1)
        return true
      },
    )
  })
})

test('503 unreachable upstream surfaces status 503', async () => {
  await withFetch(async () => jsonResponse(503, { error: 'grasp-search delegation failed', details: ['grasp-search service unreachable'] }), async () => {
    const client = new BffClient('/api')
    await assert.rejects(
      client.graspSearch({ layoutVersion: 'layout/1.0', graspSearch: {} }),
      (err) => { assert.equal(err.status, 503); return true },
    )
  })
})

test('a genuine BFF network failure throws BffUnavailableError', async () => {
  await withFetch(async () => { throw new Error('ECONNREFUSED') }, async () => {
    const client = new BffClient('/api')
    await assert.rejects(client.compileLayout({}), (err) => err instanceof BffUnavailableError)
  })
})
