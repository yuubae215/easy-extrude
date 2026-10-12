/**
 * Criteria hearing routes (ADR-165 D3 / D6).
 *
 * Mounted at /api/criteria by the BFF entry point.
 *
 * Endpoint:
 *   POST /trial — validate the request against the neutral contract schema,
 *                 delegate to the core API (`/criteria-trial`), then validate its
 *                 response against the contract schema before returning.
 *
 * SCOPE BOUNDARY (CLAUDE.md "BFF と契約" / §AI 向けガード 軸 1): the candidates,
 * the interest indicators and what a change gives up are the core API's cost
 * function — an idea. The BFF derives its checks from the schema and forwards;
 * it computes nothing from the weights. Same drift rules as /api/grasp/search:
 * inbound version mismatch 400, upstream drift / non-conformance 502.
 */
import { Router } from 'express'
import {
  CONTRACT_VERSION,
  validateCriteriaRequest,
  validateCriteriaResponse,
  checkContractVersion,
} from '../grasp/contract.js'
import { callCriteriaTrial, GraspServiceError } from '../grasp/graspClient.js'

export const criteriaRouter = Router()

// POST /api/criteria/trial
criteriaRouter.post('/trial', async (req, res) => {
  const body = req.body ?? {}

  const inbound = checkContractVersion(body.contractVersion)
  if (!inbound.ok) {
    return res.status(400).json({ error: 'Contract version mismatch', details: [inbound.message] })
  }

  const reqCheck = validateCriteriaRequest(body)
  if (!reqCheck.valid) {
    return res.status(400).json({
      error:   'Request does not conform to criteria-trial contract',
      details: reqCheck.errors,
    })
  }

  let raw
  try {
    raw = await callCriteriaTrial({ ...body, contractVersion: CONTRACT_VERSION })
  } catch (err) {
    if (err instanceof GraspServiceError) {
      return res.status(err.status).json({ error: 'criteria-trial delegation failed', details: [err.message] })
    }
    return res.status(500).json({ error: 'Internal server error', details: [err.message] })
  }

  const outbound = checkContractVersion(raw?.contractVersion)
  if (!outbound.ok) {
    return res.status(502).json({
      error:   'criteria-trial service returned a mismatched contract version',
      details: [outbound.message],
    })
  }

  const resCheck = validateCriteriaResponse(raw)
  if (!resCheck.valid) {
    return res.status(502).json({
      error:   'criteria-trial response does not conform to contract',
      details: resCheck.errors,
    })
  }

  res.json(raw)
})
