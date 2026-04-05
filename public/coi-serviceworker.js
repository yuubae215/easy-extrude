/**
 * coi-serviceworker.js — Cross-Origin Isolation Service Worker
 *
 * Injects the COOP/COEP HTTP headers required for SharedArrayBuffer access
 * (and therefore for Wasm shared memory).  GitHub Pages does not support
 * custom response headers, so this SW intercepts every fetch and rewrites
 * the response headers at the edge of the browser's fetch pipeline.
 *
 * Required headers:
 *   Cross-Origin-Opener-Policy:   same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 *
 * The Vite dev server already sets these (see vite.config.js `headers`),
 * so in development window.crossOriginIsolated is already true and this SW
 * is never registered.
 *
 * Reference: https://developer.chrome.com/blog/enabling-shared-array-buffer/
 * ADR-027 Phase 4.
 */

self.addEventListener('install', () => {
  // Activate immediately — no need to wait for the previous SW to unload.
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  // Take control of all open clients so that the very first page load after
  // SW installation already runs with COOP/COEP headers — no manual refresh
  // needed beyond the one triggered by index.html's registration handler.
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  // Pass through non-HTTP(S) requests (e.g. chrome-extension://, data:).
  if (!request.url.startsWith('http')) return

  event.respondWith(
    fetch(request)
      .then((response) => {
        // Headers are immutable on a Response; clone before modifying.
        const headers = new Headers(response.headers)
        headers.set('Cross-Origin-Opener-Policy',   'same-origin')
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp')

        return new Response(response.body, {
          status:     response.status,
          statusText: response.statusText,
          headers,
        })
      })
      // On fetch failure, fall back to the original request so that network
      // errors surface normally rather than being swallowed by the SW.
      .catch(() => fetch(request)),
  )
})
