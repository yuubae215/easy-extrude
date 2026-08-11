/**
 * Grasp-stub scenarios — the states a UX session needs to visit (ADR-117).
 *
 * The stub's main value is NOT standing in for the solver's arithmetic; it is
 * reaching the states the real solver reaches rarely and non-deterministically.
 * A reviewer with a URL must be able to see the empty funnel, the thin result,
 * the all-rejected funnel and each error envelope on demand — not by hunting for
 * a scene that happens to produce one.
 *
 * Scenarios are selected with `?graspStub=<name>` on the page URL. An unknown
 * name THROWS rather than falling back to the default: a typo that silently
 * lands on `solve` would have the reviewer record "the empty state looks fine"
 * about a screen they never saw (原則 #31 — a defaults table that falls through
 * cannot distinguish a declared default from a case nobody considered).
 */

/**
 * The declared scenarios. `solve` is the only one that looks at the request;
 * the rest are fixed states.
 */
export const STUB_SCENARIO = Object.freeze({
  /** Coarse geometric stand-in that reacts to the request (the default). */
  SOLVE: 'solve',
  /** Candidates were generated, none survived: the all-rejected funnel. */
  ALL_REJECTED: 'allRejected',
  /** Exactly one survivor — the "thin result" layout, easy to get wrong. */
  THIN: 'thin',
  /** Nothing generated at all: the 0-generated input-guide branch. */
  EMPTY: 'empty',
  /** The solver is unreachable (BFF returns 503). */
  ERROR_503: 'error503',
  /** The solver answered but broke the contract (BFF returns 502). */
  ERROR_502: 'error502',
  /** The request itself was rejected (400). */
  ERROR_400: 'error400',
})

/** Every declared scenario — the enumeration a census counts against. */
export const DECLARED_SCENARIOS = Object.freeze(Object.values(STUB_SCENARIO))

/** The scenario used when the URL asks for none. */
export const DEFAULT_SCENARIO = STUB_SCENARIO.SOLVE

/**
 * Resolve a scenario name, throwing on anything undeclared.
 *
 * @param {string|null|undefined} name  absent → the default
 * @returns {string} a member of `STUB_SCENARIO`
 * @throws {Error} when `name` is present but not declared
 */
export function scenarioOrThrow(name) {
  if (name == null || name === '') return DEFAULT_SCENARIO
  if (!DECLARED_SCENARIOS.includes(name)) {
    throw new Error(
      `graspStub: unknown scenario "${name}". Declared: ${DECLARED_SCENARIOS.join(', ')}. ` +
      `Falling back silently would show you a different screen than the one you asked for.`,
    )
  }
  return name
}

/**
 * Read the scenario from a URL query string (`?graspStub=thin`).
 *
 * @param {string} search  e.g. `location.search`
 * @returns {string} a member of `STUB_SCENARIO`
 * @throws {Error} on an undeclared name
 */
export function scenarioFromSearch(search) {
  const params = new URLSearchParams(search ?? '')
  return scenarioOrThrow(params.get('graspStub'))
}
