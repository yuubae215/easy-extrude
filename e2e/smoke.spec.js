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
  // Skip the launch Home overlay (ADR-089) so these tests boot straight into the
  // interactive editor — the same escape the Blender-style "don't show on
  // startup" checkbox persists. Runs on every navigation (incl. reload), like
  // the ee_tour flag the tour test relies on. The Home surface itself is
  // covered by its own test below.
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ } })
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
  // ADR-073: the click creates the Anchor immediately — no name form / Confirm.
  await page.locator('button[title="Anchor"]').click()
  await page.locator('#canvas-container canvas').click({ position: { x: 480, y: 320 } })
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

test('map mode two-finger pinch zooms the ortho camera (ADR-072)', async ({ page }) => {
  // Touch devices have no wheel and OrbitControls' pinch is disabled in Map
  // Mode, so pinch-zoom is wired in MapModeController. Playwright has no native
  // pinch and checkJs excludes the controller layer — synthetic touch pointer
  // events are the only liveness guard for the multi-touch wiring.
  const errors = await boot(page)

  await page.getByRole('button', { name: 'Map' }).click()
  await expect(page.locator('button[title="Anchor"]')).toBeVisible()
  // A mouse click finishes the enter flight and swaps to the ortho camera.
  await page.locator('#canvas-container canvas').click({ position: { x: 400, y: 300 } })
  await expect.poll(() => page.evaluate(() => window.__easyExtrude.mapState().useOrtho)).toBe(true)

  const before = await page.evaluate(() => window.__easyExtrude.mapState().frustumSize)

  const box = await page.locator('#canvas-container canvas').boundingBox()
  const cx = Math.round(box.x + box.width / 2)
  const cy = Math.round(box.y + box.height / 2)
  // Two fingers spread apart → zoom in (smaller ortho frustum).
  await page.evaluate(({ cx, cy }) => {
    const el = document.querySelector('#canvas-container canvas')
    const fire = (type, id, x, y, buttons) => el.dispatchEvent(new PointerEvent(type, {
      pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: y,
      button: 0, buttons, bubbles: true, cancelable: true,
    }))
    fire('pointerdown', 1, cx - 30, cy, 1)
    fire('pointerdown', 2, cx + 30, cy, 1)
    for (let h = 40; h <= 170; h += 15) { fire('pointermove', 1, cx - h, cy, 1); fire('pointermove', 2, cx + h, cy, 1) }
    fire('pointerup', 1, cx - 170, cy, 0)
    fire('pointerup', 2, cx + 170, cy, 0)
  }, { cx, cy })

  const after = await page.evaluate(() => window.__easyExtrude.mapState().frustumSize)
  expect(after, `pinch-out should shrink the frustum (before ${before}, after ${after})`).toBeLessThan(before)

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

test('launch Home screen loads a process-layout template (ADR-089)', async ({ page }) => {
  // Deliberately does NOT use boot() — a fresh context has no ee_home flag, so
  // the launch overlay opens over the boot stage (the feature under test).
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/easy-extrude/')
  // The launch overlay is up (its subtitle is unique to HomeScreen).
  await expect(page.getByText('工程レイアウトを選んで始める')).toBeVisible()

  // Selecting a layout card replaces the scene through compileLayout →
  // importFromJson and closes Home; the conveyor's stations land in the Outliner.
  await page.getByText('直線コンベアライン', { exact: true }).click()
  await expect(page.getByText('工程レイアウトを選んで始める')).not.toBeVisible()
  await expect(page.getByText('投入ステーション', { exact: true }).first()).toBeVisible()

  // The header "Layouts" slot reopens Home after it has closed.
  await page.getByRole('button', { name: /Layouts/ }).click()
  await expect(page.getByText('工程レイアウトを選んで始める')).toBeVisible()

  // Checking "起動時に表示しない" persists the skip flag → Home stays down on reload.
  await page.getByText('起動時に表示しない').click()
  await page.reload()
  await expect(page.getByText('Scene Collection', { exact: true })).toBeVisible()
  await expect(page.getByText('工程レイアウトを選んで始める')).not.toBeVisible()

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
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

test('deleting the robot asks first, and a template load does not resurrect it (ADR-090)', async ({ page }) => {
  // The two defects ADR-090 measured, in one flow. Before: the ✕ took the robot
  // (and its tcp child) away with NO dialog and no toast (§力学(2)), and the very
  // next scene entry re-seeded it because `ensureRobotFrames` "repaired" every
  // entry path — the seed rule outranked the user's scene (§力学(4)).
  const errors = await boot(page)

  const robotRow = page.getByText('robot_base', { exact: true }).locator('..')
  await robotRow.hover()
  await robotRow.locator('[aria-label="Delete"]').click()

  // 1. It asks, and the question names what is being removed and what remains.
  await expect(page.getByText('Delete Robot', { exact: true })).toBeVisible()
  await expect(page.getByText(/The scene will have no robot/)).toBeVisible()
  // The dialog's confirm button carries the label as TEXT; the Outliner rows' ✕
  // buttons only carry it as aria-label, so text-is disambiguates.
  await page.locator('button:text-is("Delete")').click()

  // 2. Zero robots is a state the scene can actually hold: both frames are gone.
  await expect(page.getByText('robot_base', { exact: true })).toHaveCount(0)
  await expect(page.getByText('tcp', { exact: true })).toHaveCount(0)

  // 3. …and it survives a scene entry (loading a template) instead of springing back.
  await loadTemplateIntoNegotiate(page)
  await expect(page.getByText('robot_base', { exact: true })).toHaveCount(0)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a second robot can be added and is a distinct entity (ADR-090 G1)', async ({ page }) => {
  const errors = await boot(page)

  // Shift+A → Robot. The entry is unconditional (it is the way OUT of 0 robots),
  // unlike "Coordinate Frame", which needs a selected parent.
  await page.locator('#canvas-container canvas').click()
  await page.keyboard.press('Shift+A')
  await page.getByText('Robot', { exact: true }).click()

  // Two robots now: distinct rows, each wearing the ROBOT badge that is keyed off
  // the DECLARED role (a name-keyed badge would have missed this second base).
  // (the active-object header echoes the name too, hence first())
  await expect(page.getByText('robot_base_2', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('tcp_2', { exact: true }).first()).toBeVisible()
  expect(await page.getByText('ROBOT', { exact: true }).count()).toBe(4)

  // One eye moves ONE arm (ADR-090): the boot robot ships hidden, the just-added
  // one is drawn. A single shared RobotStage could not even express this — and the
  // aria-label assertions below/above cannot see it, since they read the row, not
  // the scene.
  const roster = await page.evaluate(() => window.__easyExtrude.robotState())
  expect(roster.map(r => r.label)).toEqual(['robot_base', 'robot_base_2'])
  expect(roster.map(r => r.skeletonVisible)).toEqual([false, true])
  expect(roster.every(r => r.hasTcp)).toBe(true)

  // Revealing the first robot leaves the second one alone (per-robot keying).
  const firstRow = page.getByText('robot_base', { exact: true }).locator('..')
  await firstRow.hover()
  await firstRow.getByRole('button', { name: 'Show' }).click()
  await expect
    .poll(async () => (await page.evaluate(() => window.__easyExtrude.robotState()))
      .map(r => r.skeletonVisible))
    .toEqual([true, true])

  // Undo removes the pair together (one command owns the base + tcp pairing).
  await page.locator('#canvas-container canvas').click()
  await page.keyboard.press('Control+z')
  await expect(page.getByText('robot_base_2', { exact: true })).toHaveCount(0)
  await expect(page.getByText('tcp_2', { exact: true })).toHaveCount(0)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the Outliner eye round-trips an entity between hidden and shown (ADR-087)', async ({ page }) => {
  // The controller layer is outside checkJs, so this is the only net for the
  // eye's wiring. It regresses a real one-way bug: `_setObjectVisible` drove
  // the meshes and the robot skeleton but never the Outliner row, so the row's
  // `visible` flag stayed frozen at its seeded value and the toggle kept
  // sending the same argument — the robot could be revealed once and then never
  // hidden again, with the click consumed and nothing happening (#11).
  const errors = await boot(page)

  // robot_base ships HIDDEN on the default scene (ADR-089 follow-up), so its
  // eye offers the "Show" action and is visible without hover.
  const row = page.getByText('robot_base', { exact: true }).locator('..')
  const eye = row.getByRole('button').first()
  await expect(eye).toHaveAttribute('aria-label', 'Show')

  // Show → the eye flips to the "Hide" action …
  await row.hover()
  await eye.click()
  await expect(eye).toHaveAttribute('aria-label', 'Hide')

  // … and hiding again works, which the frozen flag made impossible.
  await eye.click()
  await expect(eye).toHaveAttribute('aria-label', 'Show')

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the row never lies: no CF ships shown, one click reveals, and the selection cannot take it back (ADR-096)', async ({ page }) => {
  // The four symptoms ADR-096 opens with, asked of the live app. The unit lane
  // cannot ask them: SceneService goes through vite-only imports (`?url` /
  // `?worker`) so it does not construct under `node --test`, and the pure lane
  // can only prove the composition, not that the boot path routes through it.
  const errors = await boot(page)
  const state = () => page.evaluate(() => window.__easyExtrude.visibilityState())

  // 症状 1/3 — at boot, the number of CoordinateFrames claiming to be shown is
  // ZERO. Counted over an enumerated kind, not eyeballed off the rows: the old
  // defect was `tcp` sitting there with an open eye and nothing drawn, and a
  // check that walks what is visible would never have visited it (原則 #31).
  const atBoot = await state()
  const framesShown = atBoot.filter(o => o.isFrame && o.explicit)
  expect(framesShown.map(o => o.name), 'ブート直後に explicit が真の CF').toEqual([])
  // …and no entity is drawn while its row says otherwise, in either direction.
  for (const o of atBoot) {
    expect(o.drawn, `${o.name}: 行が語る値と描画が食い違う`).toBe(o.explicit || o.contextual !== null)
  }

  // 症状 2 — ONE click on the tcp eye changes something. It used to send
  // "hide" to something already hidden: the input was consumed, nothing moved.
  // Scoped to the Outliner row: once tcp is drawn it also owns a floating 3D
  // label with the same text, so a bare text lookup stops being unique.
  const tcpRow = page.locator('[draggable="true"]').filter({ hasText: 'tcp' }).first()
  await tcpRow.click()                      // select it → the CONTEXT draws it …
  await expect.poll(async () => (await state()).find(o => o.name === 'tcp')?.drawn).toBe(true)
  await tcpRow.hover()
  const tcpEye = tcpRow.getByRole('button').first()
  // … while the eye still reads "Show", because the eye is the persistent axis,
  // not the pixel. One click must move that axis.
  await expect(tcpEye).toHaveAttribute('aria-label', 'Show')
  await tcpEye.click()
  await expect.poll(async () => (await state()).find(o => o.name === 'tcp')?.explicit).toBe(true)

  // 症状 4 — selecting another entity does not take it back. The context axis
  // moves; the axis the user wrote does not.
  const outliner = page.getByText('Scene Collection', { exact: true }).locator('..')
  await outliner.getByText('Cube', { exact: true }).click()
  await expect.poll(async () => (await state()).find(o => o.name === 'tcp')?.contextual).toBe(null)
  const afterSelect = (await state()).find(o => o.name === 'tcp')
  expect(afterSelect.explicit, 'eye で開けた軸が選択変更で落ちている').toBe(true)
  expect(afterSelect.drawn, '別の実体を選んだ瞬間に軸が消えている (症状 4)').toBe(true)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

// ── ADR-097: 接地は実体の状態であってジェスチャの副作用ではない ────────────────
//
// 当事者の報告に 1:1 対応する回帰。症状はすべて「入口ごとに実装していた」ことの
// 直接の結果だったので、検査も入口ごとに置く — 1 本でも落ちたら、その入口が方針を
// 迂回し始めたということ。
//
// SceneService は vite 専用 import を持ち `node --test` では構築できないため、
// シーンを要する不変条件はここでしか問えない (ADR-096 の visibilityState と同じ
// 理由)。純粋な決定 (3 方針 × 支持有無 × Z 成分有無) は src/domain/placement.test.js。

const placementRows = (page) => page.evaluate(() => window.__easyExtrude.placementState())
const byName = (rows, name) => rows.find(r => r.name === name)

test('Z 拘束の Grab で床を抜けない (ADR-097 症状 2)', async ({ page }) => {
  // 「キューブも Z 拘束するとなぜか突き抜ける」— 軸拘束は「垂直方向の意図」として
  // stack assist を降ろす設計で、降ろした先に床が無かった。床は補助ではなく方針が
  // 持つようになったので、もう一緒には降りない。
  const errors = await boot(page)
  const canvas = await page.locator('#canvas-container canvas').boundingBox()
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2

  await page.mouse.move(cx, cy)
  await page.keyboard.press('g')
  await page.keyboard.press('z')                       // 垂直方向の意図 = 補助は退く
  await page.mouse.move(cx, cy + 400, { steps: 15 })   // 画面下 = 世界の下へ
  await page.keyboard.press('Enter')

  const cube = byName(await placementRows(page), 'Cube')
  expect(cube.placement).toBe('grounded')
  expect(cube.belowGradeIntent, '宣言していないのに床下の意図が立っている').toBe(false)
  expect(cube.bottomZ, `Z 拘束のドラッグで床を抜けた (bottomZ=${cube.bottomZ})`).toBeGreaterThan(-0.001)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S が床下を「宣言」にし、宣言はジェスチャを越えて残る (ADR-097 G3)', async ({ page }) => {
  // 今日の「Grab 中に S を押して stack assist を切る」はジェスチャ局所で、シーンに
  // 何も残らなかった — だから次に触ったときにまた潜る/戻るが再現しない。宣言に
  // 昇格させると、基礎・杭は「そう宣言された実体」になる。
  const errors = await boot(page)
  const canvas = await page.locator('#canvas-container canvas').boundingBox()
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2

  await page.mouse.move(cx, cy)
  await page.keyboard.press('g')
  await page.keyboard.press('s')                       // Free = 床下を宣言する
  await expect(page.getByText('Free (S: stack)')).toBeVisible()
  await page.keyboard.press('z')
  await page.mouse.move(cx, cy + 400, { steps: 15 })
  await page.keyboard.press('Enter')                   // ジェスチャ終了

  const cube = byName(await placementRows(page), 'Cube')
  expect(cube.belowGradeIntent, '宣言がジェスチャ終了で消えている (今日の stackMode と同じ失敗)').toBe(true)
  expect(cube.bottomZ, '宣言したのに潜れていない — 逃げ道が塞がっている (G3)').toBeLessThan(-0.001)

  // 宣言は次のジェスチャにも効く: 掴み直しただけで補助が復活し、宣言された基礎が
  // ピットから黙って持ち上げられる、ということが起きない。
  await page.mouse.move(cx, cy)
  await page.keyboard.press('g')
  await expect(page.getByText('Free (S: stack)')).toBeVisible()
  await page.keyboard.press('Escape')

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('接地した実体のドラッグ結果がカメラの向きに依存しない (ADR-097 症状 4)', async ({ page }) => {
  // 「Grab は突き抜けても良い前提で設計されているので、すごく動かしづらい」の
  // 機構的な原因: 自由ドラッグ平面がカメラ正対面だったので、カメラを回すと同じ
  // マウス操作が違う Z を生み、そこへ stack snap が Z を引き戻していた。
  //
  // 「動かしやすい」自体は主観なのでテストでは閉じない (証拠は当事者の dogfooding
  // 記録)。ここで閉じるのは *機構* の方だけであり、そう宣言する。
  const errors = await boot(page)
  const canvas = await page.locator('#canvas-container canvas').boundingBox()
  const cx = canvas.x + canvas.width / 2
  const cy = canvas.y + canvas.height / 2

  // カメラを大きく回してから、同じ形のクイックドラッグを行う。
  await page.mouse.move(cx + 200, cy + 150)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx + 340, cy - 60, { steps: 12 })
  await page.mouse.up({ button: 'middle' })
  await page.waitForTimeout(200)

  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 60, cy + 90, { steps: 12 })
  await page.mouse.up()

  const cube = byName(await placementRows(page), 'Cube')
  expect(cube.bottomZ, `カメラ姿勢由来の Z がドラッグに漏れている (bottomZ=${cube.bottomZ})`).toBeGreaterThan(-0.001)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('supported な実体で支持を持たないものは 0 個 (ADR-097 / 原則 #31)', async ({ page }) => {
  // 散文にしか無かった不変条件 ("must stay pinned to the ground plane or a
  // building roof, never floating") を述語で問う。
  //
  // 形が重要: *在るもの* を辿るのではなく「支持を要する種を列挙して、支持を持たない
  // 個体の**個数**が 0 か」を問う。支持が **無い** 状態は検査対象のノードを持たない
  // ので、前者の形では必ず素通りする (ADR-090 / ADR-093 と同じ構図の 3 例目)。
  const errors = await boot(page)

  // マップオブジェクトを 1 個置いて母数が 0 でないことを先に確かめる — 対象が
  // 0 個であることは、不変条件が成り立っていることと区別がつかない。
  await page.getByRole('button', { name: 'Map' }).click()
  await expect(page.locator('button[title="Anchor"]')).toBeVisible()
  await page.locator('button[title="Anchor"]').click()
  await page.locator('#canvas-container canvas').click({ position: { x: 480, y: 320 } })
  await page.waitForTimeout(400)

  const rows = await placementRows(page)
  const supported = rows.filter(r => r.placement === 'supported')
  expect(supported.length, 'supported な実体が 1 個も無い — 検査が空回りしている').toBeGreaterThan(0)

  const floating = supported.filter(r => r.support === null)
  expect(floating.map(r => `${r.name} (bottomZ=${r.bottomZ})`), '浮いている supported 実体').toEqual([])

  // grounded 側の対の不変条件: 宣言していない実体は床下に居ない。
  const sunk = rows.filter(r => r.placement === 'grounded' && !r.belowGradeIntent && r.bottomZ < -0.001)
  expect(sunk.map(r => `${r.name} (bottomZ=${r.bottomZ})`), '宣言なしで床下に居る grounded 実体').toEqual([])

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

// ── ADR-098: 「何の上に載れるか」は種ではなく方針の帰結 ─────────────────────────
//
// 当事者の報告「キューブはスタックするのにロボットはスタックしない」への 1:1 の
// 回帰。ADR-097 が pose の入口を 1 つにした後も、その入口の**中**に
// `instanceof Solid` の門が 2 枚残っており、方針語 `grounded` が種によって
// 2 つの意味を持っていた。
//
// ジェスチャは**数値 Grab** (`G` → 軸 → 距離 → Enter) を使う。画面座標を経由しない
// ので、カメラ姿勢にも実体の投影位置にも依存せず、「たまたま届いた」と
// 「方針どおりに効いた」を取り違えない。数値 Grab は軸が `z` でない限り
// stack assist を通る経路なので、補助そのものを問うている。

/** 選択中の実体を数値 Grab で 1 軸だけ動かす (画面座標に依存しないジェスチャ)。 */
async function numericGrab(page, axis, distance) {
  await page.keyboard.press('g')
  await page.keyboard.press(axis)
  for (const ch of distance.toFixed(3)) {
    await page.keyboard.press(ch === '-' ? 'Minus' : ch === '.' ? 'Period' : ch)
  }
  await page.keyboard.press('Enter')
}

/**
 * Outliner の行から実体を選ぶ (3D ラベルとテキストが衝突しないよう行に限定)。
 *
 * セレクタは `[draggable]` — 値ではなく属性の有無で引く。行の `draggable` は
 * **再親子化できるか** (CF だけ true) を表しており、選べるかどうかではない。
 * `[draggable="true"]` で引くと geometry の行が静かに 0 件になり、テストは
 * 「何も起きなかった」ではなく「見つからない」で落ちる (ADR-099 実装時に踏んだ)。
 */
async function selectRow(page, name) {
  await page.locator('[draggable]').filter({ hasText: name }).first().click()
}

/** robot_base をキューブの真上へ運び、その後の placement 行を返す。 */
async function carryRobotOverCube(page, { escapeAssist = false } = {}) {
  const rows  = await page.evaluate(() => window.__easyExtrude.placementState())
  const robot = rows.find(r => r.name === 'robot_base')
  const cube  = rows.find(r => r.name === 'Cube')
  await selectRow(page, 'robot_base')
  // S は Grab 中に補助を降ろすトグル (ADR-071)。X の移動でだけ押して、
  // 「同じジェスチャで補助だけが違う」差分ペアにする。
  await page.keyboard.press('g')
  await page.keyboard.press('x')
  if (escapeAssist) await page.keyboard.press('s')
  for (const ch of (cube.footprint.x - robot.footprint.x).toFixed(3)) {
    await page.keyboard.press(ch === '-' ? 'Minus' : ch === '.' ? 'Period' : ch)
  }
  await page.keyboard.press('Enter')
  await numericGrab(page, 'y', cube.footprint.y - robot.footprint.y)
  return { cube, after: await page.evaluate(() => window.__easyExtrude.placementState()) }
}

test('ロボットもキューブと同じ規則で面に載る (ADR-098 G1/G2 — 当事者の報告に 1:1)', async ({ page }) => {
  const errors = await boot(page)

  // 前提: 両者は同じ方針を宣言している。症状が方針の差でないことを先に固定する
  // — ここが違っていたら、以下の差は「正しく違う」であって欠陥ではない。
  const atBoot = await placementRows(page)
  expect(byName(atBoot, 'Cube').placement, 'キューブの方針').toBe('grounded')
  expect(byName(atBoot, 'robot_base').placement, 'ロボットの方針').toBe('grounded')
  expect(byName(atBoot, 'robot_base').footprint, 'ロボットの足跡が宣言されていない').not.toBeNull()

  const { cube, after } = await carryRobotOverCube(page)
  const seated = byName(after, 'robot_base')

  expect(seated.support, 'ロボットが支持を持たない (載っていない)').not.toBeNull()
  expect(seated.support.kind, `ロボットが床のまま (support=${JSON.stringify(seated.support)})`).toBe('entity')
  expect(seated.support.id, '載った先がキューブでない').toBe(cube.id)
  expect(seated.bottomZ, 'キューブの天面に届いていない').toBeGreaterThan(0.001)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('同じジェスチャで S を押すとロボットは載らない (ADR-098 — 差分ペア)', async ({ page }) => {
  // 片方だけでは「ジェスチャがそもそも効いていない」可能性を排除できない
  // (ADR-097 の回帰が採った形)。逃げ道が効くことも同時に示す。
  const errors = await boot(page)

  const { after } = await carryRobotOverCube(page, { escapeAssist: true })
  const robot = byName(after, 'robot_base')

  expect(robot.bottomZ, 'S を押したのに天面へ吸い付いた (補助が降りていない)').toBeLessThan(0.001)
  expect(robot.bottomZ, '床を割った (方針は補助と一緒に降りてはいけない)').toBeGreaterThan(-0.001)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('free と宣言された CF は同じジェスチャで載らない (ADR-098 — 逆向きの回帰)', async ({ page }) => {
  // 「全部に効かせた」ことと「方針どおりに効いた」ことを区別する。tcp は free
  // なので、キューブの真上へ運んでも天面へは吸い付かない (アームの先端は
  // 空中に在ってよい)。
  const errors = await boot(page)

  const atBoot = await placementRows(page)
  const tcp  = byName(atBoot, 'tcp')
  const cube = byName(atBoot, 'Cube')
  expect(tcp.placement, 'tcp の方針').toBe('free')

  const z0 = tcp.bottomZ
  await selectRow(page, 'tcp')
  await numericGrab(page, 'x', cube.footprint.x - tcp.footprint.x)
  await numericGrab(page, 'y', cube.footprint.y - tcp.footprint.y)

  const moved = byName(await placementRows(page), 'tcp')
  expect(moved.bottomZ, 'free な CF が支持面へ吸い付いた (方針が無視されている)').toBeCloseTo(z0, 3)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

// ── ADR-101: 同じ要求は同じ pose を生む (補助が自分の出力を読まない) ──────────
//
// 当事者の報告「Grab でキューブのところまで運ぶと、スタックしたり戻ったりする /
// 分身しているように見える」への 1:1 の回帰。ADR-098 でロボットは載るように
// なったが、載せる補助が**自分が今書いた pose を測り直して**次の判断をしていた。
// frame 由来の実体の world 原点は rAF ごとにしか再計算されないので、補助は前
// フレームの結果を読む → 載った → 「もう載っている」→ 補助を降ろす → 落ちる →
// 載せる … と 2 周期で振動する。
//
// 検査の形は「同じ要求を繰り返して、同じ pose になるか」。ジェスチャの途中で
// 数字を打ち足す (`2.500` → `2.5000`) と parseFloat は同じ値なので、**同一の要求**
// が何度も入口を通る。前フレームの結果が入力に混ざっていれば値が交互に変わり、
// 要求だけの関数なら変わらない。画面座標を経由しないので、カメラ姿勢にも依存
// しない (ADR-098 の数値 Grab と同じ理由)。

/** 1 セグメントの Grab でキューブの上へ到達し、同じ要求を n 回繰り返した pose 列。 */
async function samplesUnderRepeatedRequest(page, name, { select = true, repeats = 5 } = {}) {
  const cube  = byName(await placementRows(page), 'Cube')
  const start = byName(await placementRows(page), name)

  // Y を先に合わせて確定する (別セグメント)。残る 1 軸の移動でキューブへ「到達」
  // させたいので、到達がセグメントの途中で起きることがこの検査の前提になる。
  // Outliner の行を持つのは frame だけなので、既に選択済みの実体は選び直さない。
  if (select) await selectRow(page, name)
  await numericGrab(page, 'y', cube.footprint.y - start.footprint.y)

  const aligned = byName(await placementRows(page), name)
  await page.keyboard.press('g')
  await page.keyboard.press('x')
  for (const ch of (cube.footprint.x - aligned.footprint.x).toFixed(3)) {
    await page.keyboard.press(ch === '-' ? 'Minus' : ch === '.' ? 'Period' : ch)
  }

  const samples = []
  for (let i = 0; i < repeats; i++) {
    // 直前の要求が描画まで反映されてから読む (キャッシュ更新は rAF ごと)。
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))
    samples.push(byName(await placementRows(page), name))
    await page.keyboard.press('0')   // 末尾 0 = parseFloat は同値 = 同一の要求
  }
  await page.keyboard.press('Escape')
  return samples
}

test('同じ要求を繰り返してもロボットの pose は変わらない (ADR-101 — 当事者の報告に 1:1)', async ({ page }) => {
  const errors = await boot(page)

  const samples = await samplesUnderRepeatedRequest(page, 'robot_base')
  const zs = samples.map(s => Number(s.bottomZ.toFixed(6)))

  // 振動の形をそのまま落とす: 欠陥時は [0, 1, 0, 1, 0] のように交互になる。
  expect(new Set(zs).size,
    `同じ要求が違う pose を生んでいる (bottomZ の列 = ${JSON.stringify(zs)}) — ` +
    '補助が前フレームの結果を読んでいる').toBe(1)

  // 「動かないこと」だけでは、そもそも載っていない場合と区別がつかない。
  expect(samples[0].support, 'ロボットが載っていない (検査が空回りしている)').not.toBeNull()
  expect(samples[0].support.kind, 'ロボットが床のまま').toBe('entity')
  expect(zs[0], 'キューブの天面に届いていない').toBeGreaterThan(0.001)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('同じ不変条件が corners で測る実体にも成り立つ (ADR-101 — 種に依らない)', async ({ page }) => {
  // 欠陥が長く見えなかったのは、Solid が corners を同期的に書くので live 読みでも
  // たまたま新鮮だったから。片方だけを固定すると「キューブでは前から通っていた」
  // ことが記録されず、次に鮮度の軸で壊れたときに同じ非対称が再発する。
  const errors = await boot(page)

  await page.getByRole('button', { name: /\+ Add/ }).click()
  await expect.poll(() => deleteButtons(page).count()).toBeGreaterThan(1)
  // 追加ボタンにフォーカスが残ると Grab のキー入力がボタンへ行く (新しい箱は
  // 追加時点で選択済みなので、選び直す必要はない)。
  await page.evaluate(() => document.activeElement?.blur())

  const added = (await placementRows(page)).filter(r => r.placement === 'grounded' && r.footprint).at(-1)
  const samples = await samplesUnderRepeatedRequest(page, added.name, { select: false })
  const zs = samples.map(s => Number(s.bottomZ.toFixed(6)))

  expect(new Set(zs).size,
    `同じ要求が違う pose を生んでいる (bottomZ の列 = ${JSON.stringify(zs)})`).toBe(1)
  expect(samples[0].support?.kind, 'キューブが載っていない (検査が空回りしている)').toBe('entity')

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

// ── ADR-099: 選択の往復は 1 つの決定 ─────────────────────────────────────────
//
// 当事者の報告「LINK NETWORK の項目を選択してもビューポート側がハイライトされない。
// 逆は有効なのに」への 1:1 の回帰。診断は実測だった: パネル行にポインタを置くと
// mouseover が 76 件、SVG 子要素の変異が 114〜120 件 (実行ごとに揺れる = 有界でない)
// 出る一方で、mousedown / mouseup / click は **0 件**。hover のたびに DOM を全部
// 作り直していたので、押下と離上が同じ要素に届かず click が合成されなかった
// (原則 #24 の DOM 版 — 導出値 hover が hit target の生成に戻る閉路)。
//
// テストは**差分ペア**にする。片方向だけ通ると「テストが何も動かしていない」状態と
// 区別できない — ADR-097 の回帰が採った形。

/** LINK NETWORK パネルの行を、ラベルと focus 状態の対で読む。 */
async function linkNetworkRows(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('[aria-label="Link Network panel"]')
    if (!panel) return null
    const graph = panel.querySelector('svg > g')
    if (!graph) return []
    return [...graph.querySelectorAll(':scope > g')].map(g => ({
      label:   g.querySelector('text')?.textContent ?? '',
      // focus は hit 矩形の塗りで表される (透明 = 非 focus)。
      focused: (g.querySelector('rect')?.getAttribute('fill') ?? 'transparent') !== 'transparent',
    }))
  })
}

/** Cube → robot_base の Adjacent リンクを張り、LINK NETWORK パネルを開かせる。 */
async function openLinkNetwork(page) {
  await selectRow(page, 'Cube')
  await page.keyboard.press('l')
  await selectRow(page, 'robot_base')             // link mode ではこれが「相手」
  await page.getByText('Adjacent', { exact: true }).click()
  await expect(page.getByRole('region', { name: 'Link Network panel' })).toBeVisible()
}

test('LINK NETWORK ↔ ビューポートの選択は同じ 1 つの事実 (ADR-099 G1 — 差分ペア)', async ({ page }) => {
  const errors = await boot(page)
  await openLinkNetwork(page)

  // ── 向き 1: パネル → 3D。当事者が「効かない」と報告した側。
  const panelRow = page.locator('[aria-label="Link Network panel"] svg > g > g')
    .filter({ hasText: 'robot_base' })
  await panelRow.click()

  const afterPanelClick = await page.evaluate(() => window.__easyExtrude.selectionState())
  expect(afterPanelClick.names, 'パネルの行をクリックしても選択が動かない').toEqual(['robot_base'])
  expect(afterPanelClick.activeName).toBe('robot_base')
  expect(afterPanelClick.count, '基数 1').toBe(1)

  // ── 向き 2: 3D (Outliner) → パネル。既に効いていた側。両方を同じ 1 本で見ないと、
  //    片方向だけ通って「テストが何も動かしていない」ことに気づけない。
  await selectRow(page, 'Cube')
  const afterOutliner = await page.evaluate(() => window.__easyExtrude.selectionState())
  expect(afterOutliner.names).toEqual(['Cube'])

  const rows = await linkNetworkRows(page)
  const focused = rows.filter(r => r.focused).map(r => r.label)
  expect(focused, 'ビューポートで選んだ実体がパネルで光っていない').toEqual(['Cube'])

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('パネル行に触れ続けても仕事が増え続けない (ADR-099 G3 — 実測手順そのまま)', async ({ page }) => {
  const errors = await boot(page)
  await openLinkNetwork(page)

  // 実測と同じ計測器を仕掛ける: 行の DOM が作り直されるたびに childList が動く。
  await page.evaluate(() => {
    const graph = document.querySelector('[aria-label="Link Network panel"] svg > g')
    window.__lnv = { child: 0, attr: 0 }
    new MutationObserver(recs => {
      for (const r of recs) {
        if (r.type === 'childList') window.__lnv.child += r.addedNodes.length + r.removedNodes.length
        else                        window.__lnv.attr += 1
      }
    }).observe(graph, { childList: true, subtree: true, attributes: true })
  })

  const row = page.locator('[aria-label="Link Network panel"] svg > g > g')
    .filter({ hasText: 'robot_base' })
  await row.hover()
  await page.waitForTimeout(300)
  const resting = await page.evaluate(() => ({ ...window.__lnv }))
  await page.waitForTimeout(300)
  const later = await page.evaluate(() => ({ ...window.__lnv }))

  // 有界性は「閾値以下」ではなく「増えない」で問う。閾値だと、閉路が遅くなっただけの
  // 修正が通ってしまう (実測値は 114〜120 で実行ごとに揺れていた = 有界でない)。
  expect(resting.child, 'hover が行の DOM を作り直している — 閉路が戻っている').toBe(0)
  expect(later.attr, 'ポインタを止めているのに描画が走り続けている')
    .toBe(resting.attr)

  // 閉路が断たれた結果として click が合成されること (計測の主目的はこちら)。
  await row.click()
  expect((await page.evaluate(() => window.__easyExtrude.selectionState())).names)
    .toEqual(['robot_base'])

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('eye を閉じた実体をパネルから選ぶと、選択中だけ現れる (ADR-099 G2 — 原則 #11)', async ({ page }) => {
  // 力学 3 は ADR 起票時「CF を選んでも軸が描かれていなければ画面が沈黙する」と
  // 予測していたが、実装時の計測でその予測は **CF については外れて**いた:
  // showFrameChain は選ばれた当人を FULL で主張済みだったので、robot_base を
  // 選べば軸は出る。実際に沈黙していたのは **eye で伏せた geometry** で、
  // 文脈の主張の宛先が「フレーム」に限られていたからである。
  //
  // よってこのテストは差分が出る側 = Cube を eye で伏せてからパネルで選ぶ、を問う。
  // (GSN assumption ClickReachingIsNotSufficient が「予測のまま 3 つ同時に入れず
  //  実装時に再計測せよ」と言っていた、その再計測の結果がこれ。)
  const errors = await boot(page)
  await openLinkNetwork(page)

  const drawn = async (name) => (await page.evaluate(() => window.__easyExtrude.visibilityState()))
    .find(v => v.name === name)

  // 先に選択を Cube から外す — 選択中は文脈がそれを見せているので、
  // 「伏せたのに見えている」が前提として成立しない (それ自体が本 ADR の効果)。
  await selectRow(page, 'robot_base')

  // Outliner の eye で Cube を伏せる (explicit 軸の所有者はこのボタンだけ — ADR-096)。
  const cubeRow = page.locator('[draggable]').filter({ hasText: 'Cube' }).first()
  await cubeRow.hover()
  await cubeRow.getByRole('button', { name: 'Hide' }).click()

  const hidden = await drawn('Cube')
  expect(hidden.explicit, '前提: eye を閉じた').toBe(false)
  expect(hidden.drawn,    '前提: 伏せた実体は描かれていない').toBe(false)

  // パネルの行から選ぶ。選択という決定は「その結果が見えるところまで」を含む。
  await page.locator('[aria-label="Link Network panel"] svg > g > g')
    .filter({ hasText: 'Cube' }).click()

  const selected = await drawn('Cube')
  expect(selected.drawn, '選べたのに画面が沈黙する = 入力を消費して何も起きない').toBe(true)
  expect(selected.explicit, '選択が explicit 軸を書き換えている — eye の所有者は Outliner (ADR-096)')
    .toBe(false)

  // 選択を外すと eye の宣言どおりへ戻る (文脈は一時的な主張であって上書きではない)。
  await selectRow(page, 'robot_base')
  expect((await drawn('Cube')).drawn, '選択を外したのに文脈が残っている').toBe(false)

  // 報告者のシーンそのもの (CF) も往復すること — こちらは frame chain の主張で
  // 既に成立していた側で、上の geometry と対にして初めて「宛先が実体である」が言える。
  await page.locator('[aria-label="Link Network panel"] svg > g > g')
    .filter({ hasText: 'robot_base' }).click()
  expect((await drawn('robot_base')).drawn, 'CF 側の往復が壊れた').toBe(true)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('選択の基数 0·1·N が 1 つの表現で持たれる (ADR-099 §基数 / 原則 #31)', async ({ page }) => {
  // `_objSelected` と `_selectedIds` が別々の欄だったころ、
  // 「選択されているが 0 個」が表現可能かつ到達可能だった。導出にした今、
  // 両者が食い違う状態は書けない — その不可能性をシーン越しに 1 回問う。
  const errors = await boot(page)

  const snap = () => page.evaluate(() => window.__easyExtrude.selectionState())
  const agrees = (s) => s.objSelected === (s.count > 0) && s.count === s.names.length

  await selectRow(page, 'Cube')
  const one = await snap()
  expect(one.count, '1 個').toBe(1)
  expect(agrees(one), `基数と集合が食い違っている: ${JSON.stringify(one)}`).toBe(true)

  // 0 個 — 空きスペースのクリックで解除。0 は「状態の不在」ではなく状態である。
  await page.locator('#canvas-container canvas').click({ position: { x: 1000, y: 200 } })
  const zero = await snap()
  expect(zero.count, '0 個').toBe(0)
  expect(zero.objSelected, '0 個なのに「選択されている」').toBe(false)
  expect(agrees(zero), `基数と集合が食い違っている: ${JSON.stringify(zero)}`).toBe(true)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})
