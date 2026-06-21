/**
 * Grasp search REST routes.
 *
 * Mounted at /api/grasp by the BFF entry point.
 *
 * Endpoint:
 *   POST /search — validate the request against the neutral contract schema,
 *                  delegate to the external grasp-search service, then validate
 *                  its response against the contract schema before returning.
 *
 * SCOPE BOUNDARY (CLAUDE.md "スコープ境界" / "BFF と契約"):
 *   - The contract (BFF <-> grasp-search I/O) is owned by
 *     @easy-extrude/grasp-contract. This route *derives* its checks from the
 *     schema; it never defines or extends the contract.
 *   - Constraint solving (IK / collision / reach / ranking) is delegated to the
 *     external service and is out of scope for this repository.
 *   - Drift is detected at BOTH ends: contractVersion is checked on the inbound
 *     request (400 on mismatch) and on the upstream response (502 on mismatch),
 *     and request/response payloads are validated against the schema.
 */
import { Router } from 'express'
import {
  CONTRACT_VERSION,
  validateRequest,
  validateResponse,
  checkContractVersion,
} from '../grasp/contract.js'
import { callGraspSearch, GraspServiceError } from '../grasp/graspClient.js'

export const graspRouter = Router()

// POST /api/grasp/search
graspRouter.post('/search', async (req, res) => {
  const body = req.body ?? {}

  // 1) Contract-version boundary (inbound). A present-but-mismatched version is
  //    rejected with 400; absent is allowed (the BFF stamps it below).
  const inbound = checkContractVersion(body.contractVersion)
  if (!inbound.ok) {
    return res.status(400).json({ error: 'Contract version mismatch', details: [inbound.message] })
  }

  // 2) Schema conformance (inbound). Derived from the neutral schema.
  const reqCheck = validateRequest(body)
  if (!reqCheck.valid) {
    return res.status(400).json({
      error:   'Request does not conform to grasp-search contract',
      details: reqCheck.errors,
    })
  }

  // 3) Delegate to the external grasp-search service. Stamp the canonical
  //    contractVersion (read from the package) so the far end can detect drift.
  const wireRequest = { ...body, contractVersion: CONTRACT_VERSION }

  let raw
  try {
    raw = await callGraspSearch(wireRequest)
  } catch (err) {
    if (err instanceof GraspServiceError) {
      return res.status(err.status).json({ error: 'grasp-search delegation failed', details: [err.message] })
    }
    return res.status(500).json({ error: 'Internal server error', details: [err.message] })
  }

  // 4) Contract-version boundary (outbound). Upstream drift -> 502.
  const outbound = checkContractVersion(raw?.contractVersion)
  if (!outbound.ok) {
    return res.status(502).json({
      error:   'grasp-search service returned a mismatched contract version',
      details: [outbound.message],
    })
  }

  // 5) Schema conformance (outbound). A response that violates the contract is
  //    a 502 (the upstream broke the contract) — never silently passed through.
  const resCheck = validateResponse(raw)
  if (!resCheck.valid) {
    return res.status(502).json({
      error:   'grasp-search response does not conform to contract',
      details: resCheck.errors,
    })
  }

  res.json(raw)
})
