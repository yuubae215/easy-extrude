/**
 * Scene contract conformance + route-boundary tests (ADR-064 Phase 3).
 *
 * Run: pnpm --filter easy-extrude-bff run test:contract  (node --test glob)
 *
 * /api/scenes is a rigor-scoped wire: the BFF validates the graph skeleton
 * against schema/scene-1.3.schema.json on write and rejects a non-conforming
 * payload with 400 instead of letting the DB become garbage (PHILOSOPHY #11/#29).
 * The BFF stamps the scene version, exactly as it stamps the grasp
 * contractVersion.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'

import { validateSceneData, SCENE_VERSION } from '../src/scenes/sceneContract.js'
import { scenesRouter } from '../src/routes/scenes.js'

// ── 1. Contract unit: the shape validator derived from the in-repo schema ─────

test('SCENE_VERSION is read from the schema, not hardcoded', () => {
  assert.equal(SCENE_VERSION, '1.3')
})

test('a valid graph skeleton conforms; an unknown field is rejected', () => {
  assert.deepEqual(validateSceneData({ version: '1.3', objects: [] }), { valid: true, errors: [] })
  const bad = validateSceneData({ version: '1.3', objects: [], rogue: 1 })
  assert.equal(bad.valid, false)
  assert.ok(bad.errors.length > 0)
})

test('a Solid missing its primary triple is rejected (skeleton is closed)', () => {
  const r = validateSceneData({ version: '1.3', objects: [{ type: 'Solid', id: 's' }] })
  assert.equal(r.valid, false)
})

test('an ImportedMesh base64 buffer passes as an opaque blob leaf', () => {
  const r = validateSceneData({
    version: '1.3',
    objects: [{ type: 'ImportedMesh', id: 'im', positions: 'AAAA', normals: null, indices: null, offset: { x: 0, y: 0, z: 0 } }],
  })
  assert.equal(r.valid, true, JSON.stringify(r.errors))
})

// ── 2. Route boundary: write validation end to end ───────────────────────────

/** Mount the scenes router on a throwaway express app and issue a request. */
async function req(method, path, body) {
  const app = express()
  app.use(express.json())
  app.use('/api/scenes', scenesRouter)
  const srv = await new Promise((r) => { const s = app.listen(0, () => r(s)) })
  const port = srv.address().port
  try {
    const res = await fetch(`http://localhost:${port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  } finally {
    srv.close()
  }
}

test('POST with a non-conforming skeleton is rejected with 400 (never persisted)', async () => {
  const { status, json } = await req('POST', '/api/scenes', {
    name: 'bad', data: { objects: [{ type: 'Torus', id: 't' }] },
  })
  assert.equal(status, 400)
  assert.match(JSON.stringify(json), /scene-1\.3/)
})

test('POST with a smuggled top-level field is rejected with 400', async () => {
  const { status } = await req('POST', '/api/scenes', {
    name: 'bad', data: { objects: [], rogue: 1 },
  })
  assert.equal(status, 400)
})

test('POST valid data is persisted and the BFF stamps version 1.3', async () => {
  const { status, json } = await req('POST', '/api/scenes', {
    name: 'test-scene-adr064', data: { objects: [], links: [], transformGraph: { nodes: [], edges: [] } },
  })
  assert.equal(status, 201)
  assert.equal(json.data.version, '1.3')
  await req('DELETE', `/api/scenes/${json.id}`) // clean up the local DB row
})
