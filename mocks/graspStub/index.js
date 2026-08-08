/**
 * Grasp stub entry point (ADR-117) — the only symbol `src/` is allowed to reach.
 *
 * Imported dynamically, behind the build-time `VITE_GRASP_STUB` flag, so a normal
 * build never pulls this tree in. See `AppController._initBff` for the call site
 * and `mocks/graspStub/mocks-excluded-from-build.test.js` for the proof that the
 * exclusion actually holds in `dist/`.
 */
import { createStubFetch, createRefusingFetch } from './transport.js'
import { scenarioFromSearch } from './scenarios.js'

export { createStubFetch } from './transport.js'
export { STUB_SCENARIO, DECLARED_SCENARIOS, scenarioFromSearch, scenarioOrThrow } from './scenarios.js'
export { CONTRACT_VERSION } from './contractVersion.js'

/**
 * Build the transport for a page URL, resolving `?graspStub=<name>` itself.
 *
 * A mistyped scenario must not fall through to the default — a reviewer who
 * asked for `?graspStub=emtpy` and got the solve screen would write notes about
 * a state they never saw (原則 #31). But throwing out of the app's async boot is
 * not the answer either: that rejection is swallowed by the boot chain and shows
 * up only in a console nobody has open, which is the same silent failure wearing
 * different clothes (原則 #11). The first attempt here did exactly that, and the
 * e2e case for it is what caught it.
 *
 * So the refusal is made VISIBLE: every grasp request answers 400 with the
 * reason, which the panel already knows how to display ("Failed — …"), and the
 * console keeps its message for whoever does have devtools open.
 *
 * @param {string} search  e.g. `location.search`
 * @returns {{ fetchImpl: typeof fetch, scenario: string|null, error: string|null }}
 */
export function stubTransportForSearch(search) {
  try {
    const scenario = scenarioFromSearch(search)
    return { fetchImpl: createStubFetch({ scenario }), scenario, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { fetchImpl: createRefusingFetch(message), scenario: null, error: message }
  }
}
