/**
 * easy-extrude BFF (Backend for Frontend) — Phase B
 *
 * Architecture: ADR-015 (BFF + Microservices), ADR-017 (WebSocket + Geometry Service)
 *
 * Responsibilities:
 *   Phase A: JWT authentication, Scene CRUD REST API (/api/scenes)
 *   Phase B: WebSocket session management (/api/ws), Geometry Service (in-process),
 *            STEP file import via REST (/api/import/step)
 */
import http   from 'node:http'
import express from 'express'
import cors    from 'cors'
import { WebSocketServer } from 'ws'
import swaggerUi from 'swagger-ui-express'
import { jwtMiddleware }  from './src/middleware/auth.js'
import { scenesRouter }   from './src/routes/scenes.js'
import { authRouter }     from './src/routes/auth.js'
import { importRouter }   from './src/routes/import.js'
import { openApiSpec }    from './src/openapi.js'
import { createSession, removeSession, handleMessage } from './src/ws/sessionManager.js'

const PORT = process.env.PORT ?? 3001
const app  = express()

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '50mb' }))

// ── Swagger UI (no auth required) ────────────────────────────────────────────

app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec))

// ── Public routes (no auth required) ─────────────────────────────────────────

app.use('/api/auth',   authRouter)

// ── Protected routes ──────────────────────────────────────────────────────────

app.use('/api/scenes', jwtMiddleware, scenesRouter)
app.use('/api/import', jwtMiddleware, importRouter)

// ── Health check ──────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', phase: 'B', timestamp: new Date().toISOString() })
})

// ── 404 fallback ──────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

// ── HTTP server + WebSocket ───────────────────────────────────────────────────

const server = http.createServer(app)

const wss = new WebSocketServer({ noServer: true })

/**
 * Handle WebSocket upgrade at /api/ws.
 * Phase B does not require auth on upgrade (dev mode); add token check in Phase C.
 */
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname !== '/api/ws') {
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req)
  })
})

wss.on('connection', (ws) => {
  const session = createSession(ws)
  console.log(`[WS] Session opened: ${session.sessionId}`)

  ws.on('message', (data) => {
    handleMessage(session, data.toString())
  })

  ws.on('close', () => {
    removeSession(session.sessionId)
    console.log(`[WS] Session closed: ${session.sessionId}`)
  })

  ws.on('error', (err) => {
    console.error(`[WS] Error in ${session.sessionId}:`, err.message)
  })
})

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`BFF running on http://localhost:${PORT}`)
  console.log(`  Phase B — Geometry Service + WebSocket (/api/ws) + STEP import`)
  console.log(`  JWT_SECRET: ${process.env.JWT_SECRET ? 'env var' : 'dev default (unsafe)'}`)
})
