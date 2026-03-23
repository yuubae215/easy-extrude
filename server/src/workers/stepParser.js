/**
 * Worker thread: STEP file parsing.
 *
 * Runs occt.ReadStepFile() off the main event loop so large files do not
 * block Express or crash the process with OOM.
 *
 * Protocol (workerData → parentPort messages):
 *   Input:  { buffer: ArrayBuffer, scale: number }   (buffer is transferred)
 *   Output: one of
 *     { type: 'progress', percent: number, status: string }
 *     { type: 'result',   positions: Float32Array, normals: Float32Array, indices: Uint32Array }
 *     { type: 'error',    message: string }
 */

import { workerData, parentPort } from 'worker_threads'

const { buffer, scale } = workerData

const progress = (percent, status) =>
  parentPort.postMessage({ type: 'progress', percent, status })

progress(5, 'loading')

let occt
try {
  const mod = await import('occt-import-js')
  occt = await mod.default()
} catch (err) {
  parentPort.postMessage({ type: 'error', message: `occt-import-js unavailable: ${err.message}` })
  process.exit(0)
}

try {
  progress(30, 'parsing')
  const result = occt.ReadStepFile(new Uint8Array(buffer), null)

  if (!result.success) {
    parentPort.postMessage({ type: 'error', message: 'STEP parsing failed' })
    process.exit(0)
  }

  progress(75, 'converting')

  // Extract geometry at mesh level (not face level — see MENTAL_MODEL §3.5)
  const positions = [], normals = [], indices = []
  let vertexOffset = 0
  for (const mesh of result.meshes ?? []) {
    const pos = mesh.attributes?.position?.array ?? []
    const nrm = mesh.attributes?.normal?.array   ?? []
    const idx = mesh.index?.array                ?? []
    if (pos.length === 0 || pos.length % 3 !== 0) continue
    for (let i = 0; i < pos.length; i++) positions.push(pos[i])
    for (let i = 0; i < nrm.length; i++) normals.push(nrm[i])
    for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset)
    vertexOffset += pos.length / 3
  }

  if (isFinite(scale) && scale !== 1) {
    for (let i = 0; i < positions.length; i++) positions[i] *= scale
  }

  progress(95, 'sending')

  // Use TypedArrays and transfer their buffers to avoid V8 serialization overhead
  const posArr = new Float32Array(positions)
  const nrmArr = new Float32Array(normals)
  const idxArr = new Uint32Array(indices)

  parentPort.postMessage(
    { type: 'result', positions: posArr, normals: nrmArr, indices: idxArr },
    [posArr.buffer, nrmArr.buffer, idxArr.buffer],
  )
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message })
}
