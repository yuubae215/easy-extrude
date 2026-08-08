/**
 * The grasp stub's `fetch` double (ADR-117).
 *
 * ## Why the seam is the transport, not a service worker
 *
 * The requirement is a STATIC page someone can be handed as a URL — GitHub
 * Pages, no server of any kind. That rules out the Vite dev middleware (gone in
 * a static build). A service worker would work, but it adds a dependency, a
 * registration race on first load, and a scope that has to be kept in step with
 * the deploy's base path. Replacing the `fetch` the BffClient was constructed
 * with achieves the same interception with none of that, and keeps every byte of
 * it out of a normal build (the import is behind a build-time flag, so Rollup
 * drops the whole tree — `mocks-excluded-from-build.test.js` is what proves it).
 *
 * ## It returns real `Response` objects on purpose
 *
 * `BffClient` reads `res.ok`, `res.status` and `res.json()`, and maps 4xx/5xx
 * onto the panel's error states. Handing it a hand-rolled `{ ok, json }` shape
 * would exercise a client the product does not have; a genuine `Response` means
 * the code path under a reviewer's eyes is the shipped one, minus the network.
 */
import { CONTRACT_VERSION } from './contractVersion.js'
import { responseFor } from './responses.js'
import { STUB_SCENARIO } from './scenarios.js'

/** JSON `Response`, the same shape the BFF would put on the wire. */
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      // Stated on every stubbed response so the fiction is visible in devtools,
      // not only in the UI badge.
      'x-grasp-stub': 'true',
    },
  })
}

/**
 * The BFF routes the app actually calls while a reviewer walks the grasp path.
 * Anything not listed is answered with a 501 naming the gap rather than a
 * plausible-looking empty success — an unstubbed route that quietly returns
 * `{}` is how a demo develops behaviour nobody can explain (原則 #11).
 */
const ROUTES = Object.freeze({
  /** `connectBff` fetches a dev token before anything else; without it `bff` is null. */
  'GET /auth/token': () => json({ token: 'grasp-stub-token' }),
  'GET /health':     () => json({ status: 'ok', stub: true }),
  /** Round-trip verify step. The stub reports back what the DSL declared. */
  'POST /layout/compile': (body) => json({
    version:        body?.dsl?.version ?? 'layout/1.0',
    objects:        (body?.dsl?.entities ?? []).map(e => ({ id: e.ref, name: e.name })),
    links:          [],
    transformGraph: {},
  }),
})

/**
 * A transport that refuses every grasp request with one stated reason.
 *
 * Used when the requested scenario cannot be resolved. Auth and health still
 * succeed, so the app boots normally and the reviewer lands in the grasp panel
 * where the refusal is legible — rather than a dead white page or, worse, the
 * default scenario silently standing in for the one they asked for.
 *
 * @param {string} reason
 * @returns {(input: RequestInfo|URL, init?: RequestInit) => Promise<Response>}
 */
export function createRefusingFetch(reason) {
  return async function refusingFetch(input, init = {}) {
    const url    = typeof input === 'string' ? input : String(input?.url ?? input)
    const method = (init.method ?? 'GET').toUpperCase()
    const path   = url.replace(/^.*\/api/, '') || '/'
    const handler = ROUTES[`${method} ${path}`]
    if (handler) return handler(null)
    return json({ error: 'grasp stub misconfigured', details: [reason] }, 400)
  }
}

/**
 * Create the `fetch`-shaped function a stubbed `BffClient` is built with.
 *
 * @param {object} [opts]
 * @param {string} [opts.scenario]  a member of `STUB_SCENARIO`
 * @param {number} [opts.latencyMs] artificial delay, so the `compiling` /
 *        `solving` transitions are actually visible. A stub that answers in zero
 *        milliseconds hides two of the FSM's seven states from every reviewer.
 * @returns {(input: RequestInfo|URL, init?: RequestInit) => Promise<Response>}
 */
export function createStubFetch({ scenario = STUB_SCENARIO.SOLVE, latencyMs = 350 } = {}) {
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

  return async function stubFetch(input, init = {}) {
    const url    = typeof input === 'string' ? input : String(input?.url ?? input)
    const method = (init.method ?? 'GET').toUpperCase()
    const path   = url.replace(/^.*\/api/, '') || '/'

    let body = null
    if (init.body) {
      try { body = JSON.parse(String(init.body)) } catch { body = null }
    }

    await sleep(latencyMs)

    if (method === 'POST' && path === '/grasp/search') {
      const { status, body: payload } = responseFor(scenario, body, CONTRACT_VERSION)
      return json(payload, status)
    }

    const handler = ROUTES[`${method} ${path}`]
    if (handler) return handler(body)

    return json({
      error:   'Not stubbed',
      details: [`${method} ${path} has no grasp-stub handler. Add one in mocks/graspStub/transport.js.`],
    }, 501)
  }
}
