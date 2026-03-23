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
import { Worker }  from 'worker_threads'
import { v4 as uuidv4 } from 'uuid'
import { fileURLToPath } from 'url'
import { sendToSession, applyStepImportToSession } from '../ws/sessionManager.js'

export const importRouter = Router()

const WORKER_PATH = fileURLToPath(new URL('../workers/stepParser.js', import.meta.url))

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
    const { positions, normals, indices } = await _runStepWorker(
      arrayBuffer,
      isFinite(scale) ? scale : 1,
      progress,
    )

    progress(95, 'sending')

    if (sessionId) {
      applyStepImportToSession(sessionId, { filename, positions, normals, indices })
    }

    // Return plain arrays in the REST response for convenience
    res.json({
      jobId,
      filename,
      status: 'done',
      mesh: {
        positions: Array.from(positions),
        normals:   Array.from(normals),
        indices:   Array.from(indices),
      },
    })
    progress(100, 'done')
  } catch (err) {
    console.error('[import] STEP parse error:', err.message)
    if (!res.headersSent) {
      res.status(err.status ?? 500).json({ error: err.message, jobId })
    }
  }
})

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Spawns a stepParser Worker and resolves with the typed array geometry.
 * Progress callbacks are forwarded to the caller.
 *
 * @param {ArrayBuffer} arrayBuffer  Transferred to the worker (zero-copy)
 * @param {number}      scale
 * @param {Function}    onProgress   (percent, status) => void
 * @returns {Promise<{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }>}
 */
/** Maximum time (ms) allowed for STEP parsing before the worker is killed. */
const PARSE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

/**
 * How often (ms) to nudge the progress bar while the worker is blocked in
 * synchronous WASM (ReadStepFile cannot send messages during execution).
 * Keeps the UI alive so the user knows the server is still working.
 */
const HEARTBEAT_MS = 10_000 // every 10 s

function _runStepWorker(arrayBuffer, scale, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { buffer: arrayBuffer, scale },
      transferList: [arrayBuffer],
    })

    let settled      = false
    let heartbeatPct = 30  // start where the worker's last progress left off

    // Heartbeat: the worker is blocked in synchronous WASM and cannot send
    // messages. The main thread is free, so we nudge the progress bar here.
    const heartbeat = setInterval(() => {
      // Slow drift 30→75% over ~75 s, then hold at 75 until done.
      if (heartbeatPct < 75) heartbeatPct += 5
      onProgress(heartbeatPct, 'Parsing (large file — please wait)…')
    }, HEARTBEAT_MS)

    const timeout = setTimeout(() => {
      if (settled) return
      worker.terminate()
      const err = new Error('STEP parsing timed out (15 min). The file may be too large for the current server.')
      err.status = 504
      _settle(null, err)
    }, PARSE_TIMEOUT_MS)

    function _settle(value, error) {
      if (settled) return
      settled = true
      clearInterval(heartbeat)
      clearTimeout(timeout)
      error ? reject(error) : resolve(value)
    }

    worker.on('message', (msg) => {
      switch (msg.type) {
        case 'progress':
          // Update heartbeat baseline so it doesn't go backwards
          if (msg.percent > heartbeatPct) heartbeatPct = msg.percent
          onProgress(msg.percent, msg.status)
          break
        case 'result':
          _settle({ positions: msg.positions, normals: msg.normals, indices: msg.indices })
          break
        case 'error': {
          const err = new Error(msg.message)
          err.status = 422
          _settle(null, err)
          break
        }
      }
    })

    worker.on('error', (err) => _settle(null, err))
    worker.on('exit',  (code) => {
      if (code !== 0) _settle(null, new Error(`Step parser worker exited with code ${code}`))
    })
  })
}
