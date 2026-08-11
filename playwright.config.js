import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright smoke config — ADR-064 Phase 4.
 *
 * A minimal round-trip that verifies the experience layer's wiring is not
 * silently dead (boot → box add → undo → demo context → negotiation-capable
 * inspector). It is NOT a coverage suite (PHILOSOPHY #20) — the CI `e2e` job is
 * separate from the unit `gate` so its flakiness never blocks the type/contract
 * gate.
 *
 * Server: `pnpm dev`. The dev server sets the COOP/COEP headers
 * (vite.config.js), so `crossOriginIsolated` is true and the coi-serviceworker
 * self-skips — no registration/reload loop under headless Chromium.
 *
 * Browser: default Playwright resolution (CI runs `playwright install
 * chromium`). A sandbox with a pre-installed Chromium can point at it via
 * `PW_CHROMIUM` without a download.
 */
const BASE = 'http://localhost:5173/easy-extrude/'
const executablePath = process.env.PW_CHROMIUM || undefined

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['list'], ['html', { open: 'never' }]]
    : 'list',
  use: {
    baseURL: BASE,
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'pnpm dev --port 5173',
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Forwarded so `VITE_GRASP_STUB=1 pnpm test:e2e` boots the dev server in the
    // stub lane and `e2e/grasp-stub.spec.js` becomes runnable (ADR-117). Without
    // the passthrough the spec would silently skip forever — a suite that can
    // never run is indistinguishable from one that always passes.
    env: { VITE_GRASP_STUB: process.env.VITE_GRASP_STUB ?? '' },
  },
})
