import { test, expect } from '@playwright/test'

/**
 * World-scale parity E2E — ADR-137 (the check ADR-136 declared and deferred).
 *
 * ADR-136 made the Three.js world-unit millimetres and converted the five
 * robotics⇄scene boundaries. Its own verification table then wrote the one
 * claim that mattered to a person looking at the screen —
 *
 *   「ロボット骨格のワールド変換が mm で一貫する … (手動確認 — 専用ユニット
 *     テストは THREE 依存のため test:context レーンの対象外)」
 *
 * — as prose with a `PATH:e2e/robot-scale-parity.spec.js` maturity date, and
 * the manual check was never performed. Everything the `node --test` lanes
 * could see stayed green while the boot screen went black: the camera kept its
 * metre-era pose and far plane, so it sat inside the 100mm starter cube with
 * the robot 2.8m beyond the far plane. A lane that cannot see the screen
 * reports green about the screen.
 *
 * This file is that lane. It is deliberately NOT a rendering-pixel test: it
 * reads `window.__easyExtrude.worldScale()`, which enumerates the world-unit
 * bearing KINDS (solids, robot skeletons) and COUNTS the ones outside the live
 * camera frustum — because "present in the scene, absent from the screen" is a
 * cardinality with no field of its own (原則 #31), and the previous defect was
 * exactly cardinality 1 presenting as 0 (the shape ADR-090/096 already named).
 */

const worldScale = (page) => page.evaluate(() => window.__easyExtrude.worldScale())

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

test('boot: the starter cube is mm-sized, rests ON the ground, and is inside the view', async ({ page }) => {
  const errors = await boot(page)
  const w = await worldScale(page)

  // Cardinality first: the boot scene declares exactly one solid …
  expect(w.solids).toBe(1)
  // … and NONE of them may be outside the camera frustum. This is the
  // assertion the metre-era boot camera failed: the cube was there, selected,
  // named in the Outliner, and off-screen.
  expect(w.solidsOutsideView).toBe(0)

  // Rests ON z=0, not sunk through it (ADR-089's tidy, re-broken by ADR-136's
  // untouched `0.5` centroid and repaired in ADR-137). Tolerance is generous:
  // the claim is "on the ground", not a float identity.
  expect(Math.abs(w.minSolidZ)).toBeLessThan(0.5)

  // mm-scale: the camera must be OUTSIDE the 100mm cube it is framing. The
  // metre-era pose put it 7.81 units from the origin — inside.
  expect(w.camera.distToTarget).toBeGreaterThan(100)

  expect(errors).toEqual([])
})

test('Add ▸ Robot: the skeleton is mm-scaled and lands inside the view', async ({ page }) => {
  const errors = await boot(page)
  expect((await worldScale(page)).skeletons).toBe(0)   // ADR-132 D5: boot seeds none

  await addRobot(page)
  await expect.poll(async () => (await worldScale(page)).skeletons).toBe(1)
  // The URDF loads asynchronously; the span is null until it resolves.
  await expect.poll(async () => (await worldScale(page)).skeletonHeights[0] != null).toBe(true)

  const w = await worldScale(page)
  // The scale-parity claim itself. A UR5e standing at its rest pose is order
  // 1m tall; in a mm world that is hundreds of world units. Before ADR-136 the
  // same measurement came back ~0.9 — three orders of magnitude adrift from
  // the 300×300×120 pedestal it is meant to stand on.
  expect(w.skeletonHeights[0]).toBeGreaterThan(100)
  expect(w.skeletonHeights[0]).toBeLessThan(10_000)

  // And it must be on the screen, not merely in the scene: the robot seeds
  // 2.8m from the origin, which a view framed on a 100mm part does not reach
  // and a 100mm far plane clips outright (原則 #11).
  expect(w.camera.far).toBeGreaterThan(2_800)
  expect(w.solidsOutsideView).toBe(0)

  expect(errors).toEqual([])
})
