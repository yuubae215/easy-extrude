/**
 * Grasp contract binding — derives runtime validators + the canonical
 * contractVersion from the neutral JSON Schema package
 * (@easy-extrude/grasp-contract).
 *
 * SCOPE BOUNDARY (CLAUDE.md "BFF と契約"): the contract is owned upstream by
 * the schema package. This module only *derives* validators/types from it and
 * never *defines or extends* the contract. To change the contract, edit the
 * schema in the contract repo and bump contractVersion there.
 *
 * Side-effect-free at module scope except for reading the bundled JSON files
 * (resolved through the workspace package, not copied here).
 */
import { createRequire } from 'node:module'
import Ajv2020 from 'ajv/dist/2020.js'

const require = createRequire(import.meta.url)

// ── Load the contract artifacts straight from the neutral package ────────────
// These are the single source of truth; the BFF reads, never restates them.
const contractVersionDoc = require('@easy-extrude/grasp-contract/contract-version.json')
const requestSchema      = require('@easy-extrude/grasp-contract/schema/grasp-search-request.schema.json')
const responseSchema     = require('@easy-extrude/grasp-contract/schema/grasp-search-response.schema.json')

/**
 * Canonical contract version, read from the package — never hardcoded here.
 * @type {number}
 */
export const CONTRACT_VERSION = contractVersionDoc.contractVersion

/** @typedef {import('./contract.request').GraspSearchRequest}  GraspSearchRequest */
/** @typedef {import('./contract.response').GraspSearchResponse} GraspSearchResponse */

const ajv = new Ajv2020({ allErrors: true, strict: false })

const _validateRequest  = ajv.compile(requestSchema)
const _validateResponse = ajv.compile(responseSchema)

/**
 * Format ajv errors into a compact string array suitable for a JSON response.
 * @param {import('ajv').ErrorObject[] | null | undefined} errors
 * @returns {string[]}
 */
function formatErrors(errors) {
  if (!errors) return []
  return errors.map((e) => `${e.instancePath || '/'} ${e.message}`.trim())
}

/**
 * Validate a value against the GraspSearchRequest schema.
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateRequest(value) {
  const valid = _validateRequest(value)
  return { valid: Boolean(valid), errors: formatErrors(_validateRequest.errors) }
}

/**
 * Validate a value against the GraspSearchResponse schema.
 * @param {unknown} value
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateResponse(value) {
  const valid = _validateResponse(value)
  return { valid: Boolean(valid), errors: formatErrors(_validateResponse.errors) }
}

/**
 * Result of a contract-version check at the BFF boundary.
 * @typedef {{ ok: true } | { ok: false, message: string }} VersionCheck
 */

/**
 * Reject a contractVersion that does not match the canonical one.
 * `null`/`undefined` (field absent) is allowed — the field is optional in the
 * schema and the BFF stamps the outbound version itself. A *present* mismatch
 * is a hard boundary error (caller maps it to 400 inbound / 502 outbound).
 *
 * @param {number | null | undefined} version
 * @returns {VersionCheck}
 */
export function checkContractVersion(version) {
  if (version === undefined || version === null) return { ok: true }
  if (version === CONTRACT_VERSION) return { ok: true }
  return {
    ok: false,
    message: `contractVersion mismatch: got ${version}, expected ${CONTRACT_VERSION}`,
  }
}
