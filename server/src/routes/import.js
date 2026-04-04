/**
 * STEP import REST route (ADR-017, Phase B).
 *
 * Mounted at /api/import (protected by jwtMiddleware).
 *
 * Endpoints:
 *   POST /api/import/step   — upload a STEP file; returns jobId + parsed mesh data
 *
 * The endpoint accepts multipart/form-data with fields:
 *   file      — the STEP file
 *   scale     — optional unit scale factor (default 1)
 *   sessionId — optional WS session id; enables import.progress notifications
 *
 * Parsing runs in a worker_threads Worker so the main event loop is never
 * blocked and large files do not crash the process with OOM.
 */
import { Router }  from 'express'
import multer      from 'multer'
import { v4 as uuidv4 } from 'uuid'
import { sendToSession, applyStepImportToSession } from '../ws/sessionManager.js'
import { runStepWorker } from '../workers/runStepWorker.js'

export const importRouter = Router()

// Use memory storage — buffer is transferred zero-copy to the worker
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
})

importRouter.post('/step', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use multipart field name "file".' })
  }

  const jobId     = `job_${uuidv4().replace(/-/g, '').slice(0, 12)}`
  const filename  = req.file.originalname
  const sessionId = req.body?.sessionId ?? null
  const scale     = parseFloat(req.body?.scale ?? '1')

  const progress = (percent, status) => {
    if (sessionId) sendToSession(sessionId, 'import.progress', { jobId, percent, status })
  }

  // Extract an independent ArrayBuffer from the Node.js Buffer so it can be
  // transferred to the worker without copying (zero-copy transfer).
  const nodeBuf     = req.file.buffer
  const arrayBuffer = nodeBuf.buffer.slice(
    nodeBuf.byteOffset,
    nodeBuf.byteOffset + nodeBuf.byteLength,
  )

  try {
    const { positions, normals, indices } = await runStepWorker(
      arrayBuffer,
      isFinite(scale) ? scale : 1,
      progress,
    )

    progress(95, 'sending')

    if (sessionId) {
      applyStepImportToSession(sessionId, { filename, positions, normals, indices })
    }

    // Geometry is delivered to the client via WebSocket (geometry.update).
    // The REST response only signals completion — no mesh data here.
    res.json({ jobId, filename, status: 'done' })
    progress(100, 'done')
  } catch (err) {
    console.error('[import] STEP parse error:', err.message)
    if (!res.headersSent) {
      res.status(err.status ?? 500).json({ error: err.message, jobId })
    }
  }
})

