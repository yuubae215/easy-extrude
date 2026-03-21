import { defineConfig } from 'vite'

export default defineConfig({
  base: '/easy-extrude/',
  server: {
    // Proxy /api requests to the BFF in development.
    // The BFF runs on port 3001 (see server/index.js).
    proxy: {
      '/api': {
        target:       'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
