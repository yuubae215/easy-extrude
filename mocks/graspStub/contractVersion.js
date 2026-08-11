/**
 * The contract version the stub stamps (ADR-117).
 *
 * Read from the contract package rather than written down here. The stub is a
 * second producer of the response contract, and a hard-coded version is exactly
 * how a second producer drifts: the day `contract-version.json` is bumped, a
 * literal here would keep stamping the old number and the stubbed demo would
 * start disagreeing with the product it is demonstrating — silently, because
 * nothing in a static page checks versions the way the BFF does (502 on drift).
 *
 * Importing the JSON keeps `packages/grasp-contract` the single authority
 * (§1.1). Both Vite and Node resolve this; the conformance suite asserts the
 * stamped value matches the package.
 */
import contractVersion from '../../packages/grasp-contract/contract-version.json' with { type: 'json' }

/** @type {number} */
export const CONTRACT_VERSION = contractVersion.contractVersion
