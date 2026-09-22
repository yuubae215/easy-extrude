import { test, expect } from '@playwright/test'

/**
 * Render-style appearance E2E — ADR-148.
 *
 * WHY THIS LANE AND NOT A UNIT TEST: `RobotStage` parses its URDF through
 * `URDFLoader.parse`, which needs a `DOMParser`; no `node --test` lane can
 * construct one. The style swap shipped (957b06b / 6483b09) with every line of
 * its async lifecycle uncovered, and two defects lived in exactly that blind
 * spot — both reproduced in this browser before the fix:
 *
 *   B: switch to realistic, then Add ▸ Robot  →  ["realistic","skeleton"]
 *   C: request realistic then skeleton        →  ["realistic"]  (the LOSER won)
 *
 * The assertions below read `window.__easyExtrude.robotAppearance()`, which
 * reports the scene's DECLARATION and each arm's actual style as two separate
 * numbers. A snapshot of intent alone would have been green for both defects,
 * which is the whole reason the read-back exists (ADR-137 `worldSpan()`,
 * ADR-144 `armPreview()` — same move).
 */

const appearance = (page) => page.evaluate(() => window.__easyExtrude.robotAppearance())
const drawnStyles = async (page) => Object.values((await appearance(page)).drawn)

async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // Same launch-overlay escape the smoke suite uses (ADR-089).
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ } })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude === 'object' && window.__easyExtrude !== null))
    .toBe(true)
  return errors
}

async function addRobot(page) {
  await page.locator('#canvas-container canvas').click()
  await page.keyboard.press('Shift+A')
  await page.getByText('Robot', { exact: true }).click()
}

test('boot declares the realistic UR5e mesh — the first-look default, with 0 arms', async ({ page }) => {
  await boot(page)
  const a = await appearance(page)
  // Cardinality 0 is legitimate and the declaration still exists: this is the
  // case a fan-out over live stages cannot express at all (原則 #31).
  // Default flipped skeleton → realistic in ADR-149 so the first look shows
  // the real UR5e mesh with no user action; `skeleton` is now the explicit
  // lightweight opt-out reached via `RobotAppearanceToggle`.
  expect(a.declared).toBe('realistic')
  expect(Object.keys(a.drawn)).toHaveLength(0)
})

test('the RobotAppearanceToggle switches realistic ⇄ skeleton, round trip (ADR-149)', async ({ page }) => {
  await boot(page)
  await addRobot(page)
  await expect.poll(async () => (await drawnStyles(page)).length).toBe(1)
  // Default is realistic (ADR-149), so the toggle boots showing "REAL".
  await expect(page.getByText('REAL', { exact: true })).toBeVisible()

  await page.getByText('REAL', { exact: true }).click()
  await expect.poll(async () => (await appearance(page)).declared, { timeout: 30_000 }).toBe('skeleton')
  expect(await drawnStyles(page)).toEqual(['skeleton'])
  await expect(page.getByText('LITE', { exact: true })).toBeVisible()

  await page.getByText('LITE', { exact: true }).click()
  await expect.poll(async () => (await appearance(page)).declared, { timeout: 30_000 }).toBe('realistic')
  expect(await drawnStyles(page)).toEqual(['realistic'])
  await expect(page.getByText('REAL', { exact: true })).toBeVisible()
})

test('switching styles moves the arm AND the declaration together', async ({ page }) => {
  const errors = await boot(page)
  await addRobot(page)
  await expect.poll(async () => (await drawnStyles(page)).length).toBe(1)

  await page.evaluate(() => window.__easyExtrude.setRobotAppearance('realistic'))
  const a = await appearance(page)
  expect(a.declared).toBe('realistic')
  expect(Object.values(a.drawn)).toEqual(['realistic'])

  // The realistic asset must land in the SAME mm world the skeleton does
  // (ADR-136/137) — a ~9 MB swap that silently reverts to metres would draw a
  // 0.9-unit arm on a 300mm pedestal.
  const w = await page.evaluate(() => window.__easyExtrude.worldScale())
  expect(w.skeletonHeights[0]).toBeGreaterThan(100)
  expect(w.skeletonHeights[0]).toBeLessThan(10_000)

  await page.evaluate(() => window.__easyExtrude.setRobotAppearance('skeleton'))
  expect(await drawnStyles(page)).toEqual(['skeleton'])
  expect(errors).toEqual([])
})

test('a robot added AFTER the switch adopts the style the scene declared', async ({ page }) => {
  await boot(page)
  await addRobot(page)
  await expect.poll(async () => (await drawnStyles(page)).length).toBe(1)
  await page.evaluate(() => window.__easyExtrude.setRobotAppearance('realistic'))
  expect(await drawnStyles(page)).toEqual(['realistic'])

  // N=2 is the smallest scene that can tell "the set declares a style" from
  // "setRenderStyle happened to touch the stages alive at the time". Before
  // ADR-148 this came back ["realistic","skeleton"] — two arms of the same
  // UR5e, drawn differently, with nothing saying which was right.
  await addRobot(page)
  await expect.poll(async () => (await drawnStyles(page)).length).toBe(2)
  await expect.poll(async () => (await drawnStyles(page)).join(),
    { timeout: 30_000 }).toBe('realistic,realistic')
  expect((await appearance(page)).declared).toBe('realistic')
})

test('two requests back to back: the LAST one wins, not the one that loaded first', async ({ page }) => {
  await boot(page)
  await addRobot(page)
  await expect.poll(async () => (await drawnStyles(page)).length).toBe(1)

  // Fire both without awaiting the first, so the second lands while the ~9 MB
  // realistic load is still in the air. Before ADR-148 the second call matched
  // the DRAWN style ('skeleton', since nothing had committed yet), returned
  // early without bumping the supersession token, and the realistic geometry
  // it was meant to cancel landed and stayed.
  await page.evaluate(() => {
    window.__easyExtrude.setRobotAppearance('realistic').catch(() => {})
    window.__easyExtrude.setRobotAppearance('skeleton').catch(() => {})
  })
  await expect.poll(async () => (await drawnStyles(page)).join(), { timeout: 30_000 })
    .toBe('skeleton')
  expect((await appearance(page)).declared).toBe('skeleton')

  // Give the superseded load time to land, then assert it did NOT clobber.
  await page.waitForTimeout(3000)
  expect(await drawnStyles(page)).toEqual(['skeleton'])
})

test('an undeclared style is refused, not silently drawn as the skeleton', async ({ page }) => {
  await boot(page)
  await addRobot(page)
  await expect.poll(async () => (await drawnStyles(page)).length).toBe(1)
  await page.evaluate(() => window.__easyExtrude.setRobotAppearance('realistic'))
  expect(await drawnStyles(page)).toEqual(['realistic'])

  // `setRobotAppearance` is async, so the vocabulary guard surfaces as a
  // REJECTION rather than a synchronous throw — the caller still cannot miss
  // it, which is the point (原則 #11), but it has to be awaited.
  const rejected = await page.evaluate(() =>
    window.__easyExtrude.setRobotAppearance('realstic').then(() => null, (e) => e.message))
  expect(rejected).toMatch(/undeclared render style/)
  // The typo must change nothing — neither the drawn geometry nor, crucially,
  // the declaration (which previously recorded the typo verbatim).
  const a = await appearance(page)
  expect(a.declared).toBe('realistic')
  expect(Object.values(a.drawn)).toEqual(['realistic'])
})
