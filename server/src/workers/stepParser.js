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

  // First pass: collect valid meshes and sum buffer sizes to pre-allocate TypedArrays.
  // Avoids intermediate JS arrays and repeated push() reallocations.
  let totalPos = 0, totalNrm = 0, totalIdx = 0
  const validMeshes = []
  for (const mesh of result.meshes ?? []) {
    const pos = mesh.attributes?.position?.array ?? []
    if (pos.length === 0 || pos.length % 3 !== 0) continue
    const nrm = mesh.attributes?.normal?.array ?? []
    const idx = mesh.index?.array              ?? []
    validMeshes.push({ pos, nrm, idx })
    totalPos += pos.length
    totalNrm += nrm.length
    totalIdx += idx.length
  }

  // Second pass: fill pre-allocated TypedArrays directly.
  const posArr = new Float32Array(totalPos)
  const nrmArr = new Float32Array(totalNrm)
  const idxArr = new Uint32Array(totalIdx)
  let posOff = 0, nrmOff = 0, idxOff = 0, vertOff = 0

  for (const { pos, nrm, idx } of validMeshes) {
    posArr.set(pos, posOff)
    nrmArr.set(nrm, nrmOff)
    for (let i = 0; i < idx.length; i++) idxArr[idxOff + i] = idx[i] + vertOff
    posOff  += pos.length
    nrmOff  += nrm.length
    idxOff  += idx.length
    vertOff += pos.length / 3
  }

  if (isFinite(scale) && scale !== 1) {
    for (let i = 0; i < posArr.length; i++) posArr[i] *= scale
  }

  progress(95, 'sending')

  parentPort.postMessage(
    { type: 'result', positions: posArr, normals: nrmArr, indices: idxArr },
    [posArr.buffer, nrmArr.buffer, idxArr.buffer],
  )
} catch (err) {
  parentPort.postMessage({ type: 'error', message: err.message })
}
