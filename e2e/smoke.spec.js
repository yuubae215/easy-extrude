import { test, expect } from '@playwright/test'

/**
 * Smoke E2E — ADR-064 Phase 4.
 *
 * The minimal round-trip described in the ADR: boot → box add → undo →
 * template load → negotiate tab. The goal is only to prove the experience
 * layer's wiring is live end-to-end (React overlay + Three.js scene + command
 * stack + Context overlay), NOT to cover behaviour (PHILOSOPHY #20 — a narrow
 * smoke, not a coverage net). Assertions lean on user-visible text / roles
 * rather than internal ids.
 */

const deleteButtons = (page) => page.locator('[aria-label="Delete"]')

async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/easy-extrude/')
  // 3D scene mounted (canvas appended to #canvas-container by SceneView) …
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  // … and the React overlay booted (Outliner is always present on desktop).
  await expect(page.getByText('Scene Collection')).toBeVisible()
  // The controller finished wiring (exposes its console API).
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude === 'object' && window.__easyExtrude !== null))
    .toBe(true)
  return errors
}

// Context ▾ → New Project → pick an example template. Selecting an example
// loads its canonical doc and enters negotiate mode (ADR-051 Phase 2), so the
// production ContextLayer (Matrix / Cluster tabs, where the Phase-4 flashes
// live) mounts. Shared by the plain and the reduced-motion test.
async function loadTemplateIntoNegotiate(page) {
  await page.getByRole('button', { name: /Context/ }).click()
  await page.getByText('New Project', { exact: true }).click()
  await expect(page.getByText(/Start from a blank project/)).toBeVisible()
  await page.getByRole('button', { name: 'Robot Cell — Simple' }).click()
  // ContextLayer negotiate header + its Matrix tab.
  await expect(page.getByText('Negotiate', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Matrix' })).toBeVisible()
}

test('boots the 3D scene and the React overlay without a page error', async ({ page }) => {
  const errors = await boot(page)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('box add then undo round-trips through the command stack', async ({ page }) => {
  await boot(page)

  const before = await deleteButtons(page).count()

  // The Outliner footer "+ Add" adds a Box directly (_addObject defaults to
  // 'box'); the Shift+A menu is the alternative path.
  await page.getByRole('button', { name: /\+ Add/ }).click()

  await expect.poll(() => deleteButtons(page).count()).toBeGreaterThan(before)

  // Undo (Ctrl+Z) removes the just-added entity/entities.
  await page.keyboard.press('Control+z')
  await expect.poll(() => deleteButtons(page).count()).toBe(before)
})

test('template load opens the negotiate tab (production Context overlay)', async ({ page }) => {
  await boot(page)
  await loadTemplateIntoNegotiate(page)
})

test('experience layer renders under prefers-reduced-motion (degraded, not dead)', async ({ page }) => {
  // Emulate the OS motion-reduction preference for the whole page.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors = await boot(page)
  // The preference is actually seen by the page …
  expect(await page.evaluate(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )).toBe(true)
  // … and the play layer (landing flashes / badge pulses degrade to static cues
  // rather than disappearing — the exact static shape is unit-tested on
  // FeedbackMath.flashStyle) still mounts and works.
  await loadTemplateIntoNegotiate(page)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})
