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

test('F frames the selection via the camera flight without a page error', async ({ page }) => {
  const errors = await boot(page)
  // The boot scene already has one selected Solid; F spawns the focus flight
  // (ADR-068). checkJs excludes the controller, so this is the wiring guard for
  // the key → focusSelection → CameraFlight path. Click the canvas centre first
  // so key events land on the viewport (not a chrome control).
  await page.locator('#canvas-container canvas').click()
  await page.keyboard.press('f')
  // Let the flight tick a few frames (it lands within DURATION.cameraFocus).
  await page.waitForTimeout(800)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('world gizmo axis click flies the camera without a page error', async ({ page }) => {
  const errors = await boot(page)
  // Finish the boot fly-in so the camera rests at its default pose (the gizmo
  // dot projection is computed from it): a click on the viewport pre-empts it.
  await page.locator('#canvas-container canvas').click()
  // The gizmo is a separate fixed canvas (aria-labelled). Clicking the +Z dot
  // (top-centre at canvas 64,23 for the default camera) routes through
  // GizmoView._onClick → AppController.flyToView → CameraFlight. checkJs
  // excludes the controller, so this is the wiring guard for that path — the
  // gizmo used to teleport the camera in one frame (ADR-068).
  const gizmo = page.getByRole('img', { name: /World orientation gizmo/ })
  await expect(gizmo).toBeVisible()
  await gizmo.click({ position: { x: 64, y: 23 } })
  await page.waitForTimeout(700)          // let the flight land (DURATION.cameraFocus)
  // Clicking the same axis again flies back (toggle path).
  await gizmo.click({ position: { x: 64, y: 23 } })
  await page.waitForTimeout(700)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('map mode enter flight, anchor placement, and undo round-trip (ADR-072)', async ({ page }) => {
  const errors = await boot(page)
  const before = await deleteButtons(page).count()

  // Let the boot fly-in settle, then snapshot the perspective camera pose. Map
  // Mode must return the camera here on exit (ADR-072) so the reachable orbit
  // range is unchanged — the user-reported regression was the camera staying
  // stuck at the map staging pose because the exit "stolen" guard mis-fired.
  await page.waitForTimeout(700)
  const preMap = await page.evaluate(() => window.__easyExtrude.cameraState())

  // Header "Map" enters Map Mode: the enter flies the camera to the top-down
  // staging pose (flyToView → CameraFlight) and swaps to the ortho camera when
  // the flight ends. checkJs excludes the controller layer, so this is the
  // wiring liveness guard for the whole choreography.
  await page.getByRole('button', { name: 'Map' }).click()
  await expect(page.locator('button[title="Anchor"]')).toBeVisible()

  // Place an Anchor WITHOUT waiting for the enter flight to land: the canvas
  // click interrupts the flight (finish() lands it, then the projection swaps).
  // This is the realistic path and the one that exposed the reset bug — the
  // interrupted flight captured a mid-flight staging pose, so on exit the
  // "stolen" guard mis-fired and the return flight was skipped.
  await page.locator('button[title="Anchor"]').click()
  await page.locator('#canvas-container canvas').click({ position: { x: 480, y: 320 } })
  await page.locator('button[title="Confirm (Enter)"]').click()
  await expect.poll(() => deleteButtons(page).count()).toBeGreaterThan(before)

  // Exit flies back to the saved perspective pose …
  await page.locator('button[title="Exit Map Mode"]').click()
  await page.waitForTimeout(800)

  // … and the camera is back at its pre-map pose (position, orbit target, up),
  // not stuck at the top-down map staging pose (the reported bug).
  const postMap = await page.evaluate(() => window.__easyExtrude.cameraState())
  const near = (a, b, tol = 0.5) => expect(Math.abs(a - b)).toBeLessThan(tol)
  near(postMap.position.x, preMap.position.x)
  near(postMap.position.y, preMap.position.y)
  near(postMap.position.z, preMap.position.z)
  near(postMap.target.x, preMap.target.x)
  near(postMap.target.y, preMap.target.y)
  near(postMap.target.z, preMap.target.z)
  near(postMap.up.x, preMap.up.x, 0.01)
  near(postMap.up.y, preMap.up.y, 0.01)
  near(postMap.up.z, preMap.up.z, 0.01)

  // Moving the placed anchor guards the map-object clamp wiring: a map object
  // is a flat plate pinned to max(building top, 0), never floating — annotations
  // route through `_mapObjectPlateDelta` in applyPreviewTranslation (SceneService,
  // excluded from checkJs). Select via the Outliner, G-grab, sweep, then cancel;
  // a dangling method throws in the pointermove handler → the pageerror fires.
  await page.getByText('Anchor', { exact: true }).first().click()
  const box = await page.locator('#canvas-container canvas').boundingBox()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2)
  await page.keyboard.press('g')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 10 })
  await page.keyboard.press('Escape') // cancel — the placement command is untouched

  // … and the placement is now on the CommandStack: undo removes it.
  await page.keyboard.press('Control+z')
  await expect.poll(() => deleteButtons(page).count()).toBe(before)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
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

test('grab + stack mode engages the snap and its flash wiring stays live', async ({ page }) => {
  // Liveness guard for the snap engagement flash (ADR-065 Phase 2, last
  // candidate): `apply()` → `_syncSnapFx()` → `ctrl._spawnSnapFx()` crosses
  // the controller layer, which checkJs does not cover. If any link in that
  // chain dangles, the pointermove handler throws before `updateStatus()`
  // runs, so "Stack: ON" never renders and the pageerror listener fires.
  // ADR-071: stack assist is now ON by default — no S press needed to engage;
  // S is the escape hatch and must surface the "Free" state (#11).
  const errors = await boot(page)

  // Add a second box (auto-selected) so the initial cube is a stack target.
  await page.getByRole('button', { name: /\+ Add/ }).click()
  await expect.poll(() => deleteButtons(page).count()).toBeGreaterThan(1)

  // G grab (stack default ON), then sweep across the initial cube at centre.
  const canvas = await page.locator('#canvas-container canvas').boundingBox()
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2
  await page.mouse.move(cx + 100, cy)
  await page.keyboard.press('g')
  await page.mouse.move(cx, cy, { steps: 12 })
  await expect(page.getByText('Stack: ON')).toBeVisible()

  // S now DISABLES the assist (ADR-071) — the escaped state is visible.
  await page.keyboard.press('s')
  await expect(page.getByText('Free (S: stack)')).toBeVisible()

  await page.keyboard.press('Escape') // cancel — scene state untouched
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the selected entity shows its floating identity label (ADR-070)', async ({ page }) => {
  // Wiring liveness only: SceneService._syncIdentityVisuals → MeshView label →
  // AppController animation loop updateLabelPosition crosses the controller
  // layer (no checkJs). The boot Solid is auto-selected, so its label div
  // must render with the entity name.
  const errors = await boot(page)
  await expect(page.locator('.ee-entity-label', { hasText: 'Cube' }).first()).toBeVisible()
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
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
