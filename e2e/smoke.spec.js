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
  // exact: the tour card's quest text also mentions "Scene Collection".
  await expect(page.getByText('Scene Collection', { exact: true })).toBeVisible()
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

test('sketch add auto-enters draw mode, drag draws the rect, Enter extrudes', async ({ page }) => {
  // Regression guard: _addObject('sketch') called a method that did not exist,
  // so the Add-menu Sketch entry threw and the user stayed in Object Mode —
  // where a touch drag orbits instead of drawing. typecheck does not cover the
  // controller layer (tsconfig include is scoped to types/domain), so this
  // wiring has no static guard; the smoke is its only liveness check (ADR-064).
  await boot(page)

  await page.keyboard.press('Shift+A')
  await page.locator('div').filter({ hasText: /^Sketch$/ }).last().click()
  // Adding a Sketch lands directly in Edit Mode 2D ready to draw.
  await expect(page.getByText('Click and drag to draw rectangle')).toBeVisible()

  // Drag out the rectangle on the ground plane (input-agnostic wiring: the
  // same _onPointerDown path serves mouse and touch).
  const canvas = await page.locator('#canvas-container canvas').boundingBox()
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2
  await page.mouse.move(cx - 60, cy - 40)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy + 40, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText(/Press Enter to extrude/)).toBeVisible()

  // Enter → extrude phase, Enter → confirm (lands in Edit Mode 3D:
  // the sub-element status line "1 Vertex  2 Edge  3 Face" appears).
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(page.getByText(/1 Vertex\s+2 Edge\s+3 Face/)).toBeVisible()

  // Undo chain: extrude → add; the scene returns to its boot state.
  const before = await deleteButtons(page).count()
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(() => deleteButtons(page).count()).toBeLessThan(before)
})

test('desktop onboarding tour derives its quest from scene facts', async ({ page }) => {
  // Fresh browser context = no ee_tour flag → the first quest opens at boot
  // (ADR-065 Phase 6; the tour never blocks input — it is a corner card).
  await boot(page)
  await expect(page.getByText('Getting started · 1/5')).toBeVisible()
  await expect(page.getByText('Add a box')).toBeVisible()

  // Completing the quest through the real affordance advances the trail:
  // the added box is auto-selected, so "select" is skipped and "grab" opens.
  await page.getByRole('button', { name: /\+ Add/ }).click()
  await expect(page.getByText('Move it')).toBeVisible()

  // Skip hides the card and persists the dismissal as a display setting
  // (Widening 3) — a reload does not re-seed the tour.
  await page.getByRole('button', { name: 'Skip tour' }).click()
  await expect(page.getByText('Move it')).not.toBeVisible()
  await page.reload()
  await expect(page.getByText('Scene Collection', { exact: true })).toBeVisible()
  await expect(page.getByText(/Getting started/)).not.toBeVisible()
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
