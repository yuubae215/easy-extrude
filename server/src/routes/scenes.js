/**
 * Scene REST routes.
 *
 * Mounted at /api/scenes by the BFF entry point.
 *
 * Endpoints:
 *   GET    /             — list all scenes (id, name, timestamps)
 *   POST   /             — create a new scene
 *   GET    /:id          — get full scene (objects + transformGraph)
 *   PUT    /:id          — update scene (full replace of data payload)
 *   DELETE /:id          — delete scene
 */
import { Router }  from 'express'
import { v4 as uuidv4 } from 'uuid'
import { listScenes, getScene, createScene, updateScene, deleteScene } from '../services/sceneStore.js'

export const scenesRouter = Router()

// GET /api/scenes
scenesRouter.get('/', (_req, res) => {
  res.json(listScenes())
})

// POST /api/scenes
scenesRouter.post('/', (req, res) => {
  const { name, data } = req.body ?? {}

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '`name` (string) is required' })
  }
  if (data == null || typeof data !== 'object') {
    return res.status(400).json({ error: '`data` (object) is required' })
  }

  // Ensure transformGraph is always present (ADR-016)
  if (!data.transformGraph) {
    data.transformGraph = { nodes: [], edges: [] }
  }
  if (!Array.isArray(data.objects)) {
    data.objects = []
  }

  const id = `scene_${uuidv4().replace(/-/g, '').slice(0, 16)}`
  const meta = createScene({ id, name: name.trim(), data })
  res.status(201).json({ ...meta, data })
})

// GET /api/scenes/:id
scenesRouter.get('/:id', (req, res) => {
  const scene = getScene(req.params.id)
  if (!scene) return res.status(404).json({ error: 'Scene not found' })
  res.json(scene)
})

// PUT /api/scenes/:id
scenesRouter.put('/:id', (req, res) => {
  const { name, data } = req.body ?? {}
  const patch = {}

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: '`name` must be a non-empty string' })
    }
    patch.name = name.trim()
  }
  if (data !== undefined) {
    if (typeof data !== 'object' || data === null) {
      return res.status(400).json({ error: '`data` must be an object' })
    }
    if (!data.transformGraph) data.transformGraph = { nodes: [], edges: [] }
    if (!Array.isArray(data.objects)) data.objects = []
    patch.data = data
  }

  const result = updateScene(req.params.id, patch)
  if (!result) return res.status(404).json({ error: 'Scene not found' })
  res.json(result)
})

// DELETE /api/scenes/:id
scenesRouter.delete('/:id', (req, res) => {
  const deleted = deleteScene(req.params.id)
  if (!deleted) return res.status(404).json({ error: 'Scene not found' })
  res.status(204).end()
})
