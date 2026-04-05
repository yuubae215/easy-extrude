import { defineConfig } from 'vite'

export default defineConfig({
  base: '/easy-extrude/',

  server: {
    // Proxy /api requests to the BFF in development.
    // The BFF runs on port 3001 (see server/index.js).
    proxy: {
      // REST API
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
      // WebSocket (Geometry Service — ADR-017)
      '/api/ws': {
        target:  'ws://localhost:3001',
        ws:      true,
        changeOrigin: true,
      },
    },

    // Required headers for SharedArrayBuffer access (ADR-027 §Future Work).
    // When these are set, Wasm memory can be declared as `shared: true` and
    // the Web Worker can read Wasm output without any copying at all.
    // Currently gated here for the dev server; production requires the same
    // headers in the hosting environment (GitHub Pages / nginx / Cloudflare).
    headers: {
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },

  // Tell Vite to process .wasm files as assets so that the `new URL(…, import.meta.url)`
  // pattern inside the wasm-bindgen generated JS (wasm_engine.js) resolves correctly
  // both during `vite dev` and `vite build`.
  assetsInclude: ['**/*.wasm'],

  build: {
    // Ensure the wasm-engine pkg output (src/engine/wasm/) is included in the build.
    // Vite's default asset handling copies any .wasm referenced via `new URL(…)`.
    rollupOptions: {
      // Web Workers are bundled automatically when referenced with
      //   new Worker(new URL('./workers/geometry.worker.js', import.meta.url), { type: 'module' })
      // No extra config is needed; this section is reserved for future split-chunk tuning.
    },
  },
})
