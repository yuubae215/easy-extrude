/**
 * Layout REST routes.
 *
 * Mounted at /api/layout by the BFF entry point.
 *
 * Endpoints:
 *   POST /compile          — compile Layout DSL → SceneSerializer v1.3 JSON (stateless)
 *   POST /scenes           — compile + persist → new scene in DB
 */
import { Router } from 'express'
import { compileLayout, compileAndSaveLayout } from '../services/LayoutService.js'

export const layoutRouter = Router()

// POST /api/layout/compile
layoutRouter.post('/compile', (req, res) => {
  const { dsl } = req.body ?? {}

  if (!dsl || typeof dsl !== 'object') {
    return res.status(400).json({ error: '`dsl` (object) is required' })
  }

  try {
    const sceneJson = compileLayout(dsl)
    res.json(sceneJson)
  } catch (err) {
    res.status(400).json({
      error:   'Layout DSL compilation failed',
      details: err.errors ?? [err.message],
    })
  }
})

// POST /api/layout/scenes
layoutRouter.post('/scenes', async (req, res) => {
  const { name, dsl } = req.body ?? {}

  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: '`name` (string) is required' })
  }
  if (!dsl || typeof dsl !== 'object') {
    return res.status(400).json({ error: '`dsl` (object) is required' })
  }

  try {
    const result = await compileAndSaveLayout(name, dsl)
    res.status(201).json(result)
  } catch (err) {
    const status = err.errors ? 400 : 500
    res.status(status).json({
      error:   err.errors ? 'Layout DSL compilation failed' : 'Internal server error',
      details: err.errors ?? [err.message],
    })
  }
})
