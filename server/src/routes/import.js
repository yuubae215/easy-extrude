/**
 * STEP import REST route (ADR-017, Phase B).
 *
 * Mounted at /api/import (protected by jwtMiddleware).
 *
 * Endpoints:
 *   POST /api/import/step   — upload a STEP file; returns jobId + parsed mesh data
 *
 * The endpoint accepts multipart/form-data with a `file` field.
 * Progress notifications are delivered via WebSocket (import.progress messages),
 * but the final mesh is also returned in the REST response for convenience.
 *
 * In Phase B, occt-import-js is loaded lazily; if unavailable a stub is returned.
 */
import { Router } from 'express'
import multer from 'multer'
import { v4 as uuidv4 } from 'uuid'

export const importRouter = Router()

// Use memory storage — files are passed directly to occt-import-js WASM
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB max
})

importRouter.post('/step', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use multipart field name "file".' })
  }

  const jobId   = `job_${uuidv4().replace(/-/g, '').slice(0, 12)}`
  const filename = req.file.originalname

  let occt
  try {
    const mod = await import('occt-import-js')
    occt = await mod.default()
  } catch {
    // occt-import-js not installed — return stub response
    return res.status(200).json({
      jobId,
      filename,
      status: 'stub',
      message: 'occt-import-js not installed — returning empty mesh',
      mesh: { positions: [], normals: [], indices: [] },
    })
  }

  try {
    const result = occt.ReadStepFile(new Uint8Array(req.file.buffer), null)

    if (!result.success) {
      return res.status(422).json({ error: 'STEP parsing failed', jobId })
    }

    // occt-import-js stores geometry at mesh level (mesh.attributes / mesh.index),
    // NOT at face level. mesh.faces is face-group metadata (color ranges only).
    const positions = [], normals = [], indices = []
    let vertexOffset = 0
    for (const mesh of result.meshes ?? []) {
      const pos = mesh.attributes?.position?.array ?? []
      const nrm = mesh.attributes?.normal?.array   ?? []
      const idx = mesh.index?.array                ?? []
      if (pos.length === 0) {
        console.warn(`[import] mesh has empty position array — skipping`)
        continue
      }
      if (pos.length % 3 !== 0) {
        console.warn(`[import] mesh position.length (${pos.length}) is not a multiple of 3 — skipping`)
        continue
      }
      for (let i = 0; i < pos.length; i++) positions.push(pos[i])
      for (let i = 0; i < nrm.length; i++) normals.push(nrm[i])
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset)
      vertexOffset += pos.length / 3
    }

    res.json({ jobId, filename, status: 'done', mesh: { positions, normals, indices } })
  } catch (err) {
    res.status(500).json({ error: err.message, jobId })
  }
})
