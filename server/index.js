/**
 * easy-extrude BFF (Backend for Frontend) — Phase A
 *
 * Architecture: ADR-015 (BFF + Microservices)
 *
 * Responsibilities in Phase A:
 *   - JWT authentication gateway (permissive dev mode by default)
 *   - Scene CRUD REST API (/api/scenes)
 *   - Transform graph persistence inside scene payload (ADR-016)
 *
 * Phase B will add WebSocket session management and Geometry Service proxy.
 */
import express from 'express'
import cors    from 'cors'
import { jwtMiddleware } from './src/middleware/auth.js'
import { scenesRouter }  from './src/routes/scenes.js'
import { authRouter }    from './src/routes/auth.js'

const PORT = process.env.PORT ?? 3001
const app  = express()

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '10mb' }))

// ── Public routes (no auth required) ─────────────────────────────────────────

app.use('/api/auth', authRouter)

// ── Protected routes ──────────────────────────────────────────────────────────

app.use('/api/scenes', jwtMiddleware, scenesRouter)

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', phase: 'A', timestamp: new Date().toISOString() })
})

// ── 404 fallback ──────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`BFF running on http://localhost:${PORT}`)
  console.log(`  Phase A — Scene persistence REST API`)
  console.log(`  JWT_SECRET: ${process.env.JWT_SECRET ? 'env var' : 'dev default (unsafe)'}`)
})
