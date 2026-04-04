/**
 * Shared helper: spawns a stepParser Worker and resolves with typed-array geometry.
 *
 * Used by both the REST import route and the WebSocket session manager so that
 * occt.ReadStepFile() always runs off the main event loop.
 *
 * @param {ArrayBuffer} arrayBuffer  Transferred zero-copy to the worker.
 * @param {number}      scale        Unit scale factor (e.g. 0.001 for mm->m).
 * @param {Function}    onProgress   (percent: number, status: string) => void
 * @returns {Promise<{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }>}
 */

import { Worker }        from 'worker_threads'
import { fileURLToPath } from 'url'

const WORKER_PATH = fileURLToPath(new URL('./stepParser.js', import.meta.url))

/** Maximum time (ms) allowed for STEP parsing before the worker is killed. */
const PARSE_TIMEOUT_MS = 15 * 60 * 1000 // 15 minutes

/**
 * How often (ms) to nudge the progress bar while the worker is blocked in
 * synchronous WASM (ReadStepFile cannot send messages during execution).
 */
const HEARTBEAT_MS = 10_000

export function runStepWorker(arrayBuffer, scale, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, {
      workerData: { buffer: arrayBuffer, scale },
      transferList: [arrayBuffer],
    })

    let settled      = false
    let heartbeatPct = 30

    const heartbeat = setInterval(() => {
      if (heartbeatPct < 75) heartbeatPct += 5
      onProgress(heartbeatPct, 'Parsing (large file - please wait)...')
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
