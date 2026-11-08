/**
 * ADR-170 S1 — a zone's plate stays at its declared height, and "one thing
 * stands on one height" (D5) is refused with the reason at every place a person
 * can break it.
 *
 * The pure layer proves the rule (`src/domain/zone.test.js`) and that every
 * caller asks it (`src/ZoneElevationOwnership.test.js`). What only the running
 * app shows is that a refusal reaches the person (a toast, never a silent stop
 * — 原則 #11) and that the plate really did not move. The scene is loaded
 * through `window.__easyExtrude.loadLayout` (the Home card path); heights are
 * read from `placementState()`, not pixels.
 *
 * S2 (the floor comes from belonging — D4): a thing's floor is its zone's
 * height, a thing that belongs to nothing has none, a floor that arrives above
 * a thing does not make it jump. Each gesture that could hide a one-frame-stale
 * read is run twice (the same request, twice).
 */
import { test, expect } from '@playwright/test'

async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ }
  })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect.poll(() => page.evaluate(() => typeof window.__easyExtrude?.loadLayout === 'function')).toBe(true)
  return errors
}

const zone = (ref, name, z, x0 = 0, placeType = 'Zone') => ({
  ref, type: 'AnnotatedRegion', name, ...(placeType ? { placeType } : {}),
  vertices: [{ x: x0, y: 0, z }, { x: x0 + 1000, y: 0, z }, { x: x0 + 1000, y: 1000, z }, { x: x0, y: 1000, z }],
})
const box = (ref, name, x, floor = 0) => ({
  ref, type: 'Solid', name, position: { x, y: 500, z: floor + 50 }, dimensions: { x: 100, y: 100, z: 100 },
})
const contains = (source, target) => ({ source, target, jointType: null, semanticType: 'contains' })

async function load(page, entities, constraints = []) {
  const ok = await page.evaluate(
    (dsl) => window.__easyExtrude.loadLayout(dsl),
    { version: 'layout/1.1', meta: { name: 'zones' }, entities, constraints })
  expect(ok).toBe(true)
}

const stateOf = (page, name) => page.evaluate(
  (n) => window.__easyExtrude.placementState().find(o => o.name === n), name)

async function select(page, name) {
  await page.getByText(name, { exact: true }).first().click()
  await expect.poll(() => page.evaluate(() => window.__easyExtrude.selectionState().activeName)).toBe(name)
}

async function typeKeys(page, keys) {
  for (const k of keys) await page.keyboard.press(k)
}

test('a zone is level: it stays at its declared height, even above or below the ground', async ({ page }) => {
  const errors = await boot(page)
  await load(page, [zone('m', 'Mezzanine', 4000), zone('p', 'Pit', -3000, 2000), box('w', 'Work', 500)])

  for (const [name, z] of [['Mezzanine', 4000], ['Pit', -3000]]) {
    const s = await stateOf(page, name)
    expect(s.placement).toBe('level')
    expect(s.bottomZ).toBeCloseTo(z, 3)
  }

  // A typed X move: the plate moves across, not down onto whatever is below.
  await select(page, 'Mezzanine')
  await page.mouse.move(600, 400)
  await typeKeys(page, ['g', 'x', '5', '0', '0', 'Enter'])
  await expect.poll(async () => (await stateOf(page, 'Mezzanine')).footprint.x).toBeCloseTo(1000, 0)
  expect((await stateOf(page, 'Mezzanine')).bottomZ).toBeCloseTo(4000, 3)

  expect(errors, errors.join(' | ')).toEqual([])
})

test('moving a zone to a second floor is refused with the reason; a zone alone may go anywhere', async ({ page }) => {
  const errors = await boot(page)
  await load(page,
    [zone('a', 'Assembly', 0), zone('b', 'Inspection', 0, 2000), zone('c', 'Store', 0, 4000),
      box('w', 'Work', 1500), box('v', 'Pallet', 4500)],
    [contains('a', 'w'), contains('b', 'w'), contains('c', 'v')])

  await select(page, 'Assembly')
  await page.mouse.move(600, 400)
  await typeKeys(page, ['g', 'z', '4', '0', '0', '0'])
  await expect(page.getByText(/would put it on two floors/).first()).toBeVisible()
  await page.keyboard.press('Enter')
  expect((await stateOf(page, 'Assembly')).bottomZ).toBeCloseTo(0, 3)

  // Store's only member belongs nowhere else: a basement is allowed.
  await select(page, 'Store')
  await page.mouse.move(600, 400)
  await typeKeys(page, ['g', 'z', '-', '3', '0', '0', '0', 'Enter'])
  await expect.poll(async () => (await stateOf(page, 'Store')).bottomZ).toBeCloseTo(-3000, 3)

  expect(errors, errors.join(' | ')).toEqual([])
})

test('a file that puts one thing on two floors is reported, not loaded silently', async ({ page }) => {
  const errors = await boot(page)
  const ok = await page.evaluate((dsl) => window.__easyExtrude.loadLayout(dsl), {
    version: 'layout/1.1', meta: { name: 'two floors' },
    entities: [zone('a', 'Assembly', 0), zone('m', 'Mezzanine', 4000, 2000), box('w', 'Work', 500)],
    constraints: [contains('a', 'w'), contains('m', 'w')],
  })
  expect(ok).toBe(false)
  await expect(page.getByText(/belongs to zones at more than one elevation/).first()).toBeVisible()
  expect(errors, errors.join(' | ')).toEqual([])
})

// ── S2 — the floor comes from belonging (D4) ────────────────────────────────

test('S2: a member stands on its zone\'s floor — a Z grab stops there, and S declares it under (O3)', async ({ page }) => {
  // ADR-097 symptom 2 (a Z-constrained grab went through the floor) asked of a
  // thing that HAS a floor: since S2 that floor is the zone's height, not Z = 0.
  const errors = await boot(page)
  await load(page, [zone('m', 'Mezzanine', 4000), box('w', 'Work', 500, 4000)], [contains('m', 'w')])
  const at = await stateOf(page, 'Work')
  expect(at.placement).toBe('resting')
  expect(at.floorZ).toBeCloseTo(4000, 3)
  expect(at.bottomZ).toBeCloseTo(4000, 3)

  await select(page, 'Work')
  await page.mouse.move(600, 400)
  for (let i = 0; i < 2; i++) {   // the same request twice
    await typeKeys(page, ['g', 'z', '-', '5', '0', '0', 'Enter'])
    await expect.poll(async () => (await stateOf(page, 'Work')).bottomZ).toBeCloseTo(4000, 3)
  }
  expect((await stateOf(page, 'Work')).belowGradeIntent).toBe(false)

  // Belonging is declared, not derived from the footprint (D3): carried off the
  // zone's plate, the member keeps its floor — it does not drop to the ground.
  await typeKeys(page, ['g', 'x', '3', '0', '0', '0', 'Enter'])
  await expect.poll(async () => (await stateOf(page, 'Work')).footprint.x).toBeCloseTo(3500, 0)
  await typeKeys(page, ['g', 'z', '-', '5', '0', '0', 'Enter'])
  const outside = await stateOf(page, 'Work')
  expect(outside.floorZ, 'leaving the zone took the floor away').toBeCloseTo(4000, 3)
  expect(outside.bottomZ).toBeCloseTo(4000, 3)

  // S during the grab = "I mean it to be under its floor" — and that survives the gesture.
  await typeKeys(page, ['g', 's', 'z', '-', '5', '0', '0'])
  await expect(page.getByText(/Below its zone floor \(Z < 4000 mm\)/).first()).toBeVisible()
  await page.keyboard.press('Enter')
  const under = await stateOf(page, 'Work')
  expect(under.belowGradeIntent).toBe(true)
  expect(under.bottomZ).toBeCloseTo(3500, 3)
  await page.keyboard.press('g')
  await expect(page.getByText('Free (S: stack)')).toBeVisible()
  await page.keyboard.press('Escape')

  expect(errors, errors.join(' | ')).toEqual([])
})

test('S2: no zone, no floor — a thing that belongs to nothing goes under Z = 0, and the notice stays', async ({ page }) => {
  const errors = await boot(page)
  await load(page, [box('w', 'Work', 500)])
  expect((await stateOf(page, 'Work')).floorZ).toBeNull()
  await select(page, 'Work')
  await page.mouse.move(600, 400)
  await typeKeys(page, ['g', 'z', '-', '3', '0', '0'])
  await expect(page.getByText(/Below ground level \(Z < 0\)/).first()).toBeVisible()
  await page.keyboard.press('Enter')
  const s = await stateOf(page, 'Work')
  expect(s.bottomZ).toBeCloseTo(-300, 3)
  expect(s.belowGradeIntent, 'nothing to be under — nothing is declared').toBe(false)
  expect(errors, errors.join(' | ')).toEqual([])
})

test('S2 Q3: a floor that arrives above a member does not make it jump on the next grab — twice', async ({ page }) => {
  // Raising the zone puts the member's floor 4000 above it. The member is not
  // moved (no silent write), and the next grab must not pop it up to the floor
  // either — the ADR-169 symptom, now from a floor that moved instead of a body.
  const errors = await boot(page)
  await load(page, [zone('a', 'Assembly', 0), box('w', 'Work', 500)], [contains('a', 'w')])
  await select(page, 'Assembly')
  await page.mouse.move(600, 400)
  await typeKeys(page, ['g', 'z', '4', '0', '0', '0', 'Enter'])
  await expect.poll(async () => (await stateOf(page, 'Assembly')).bottomZ).toBeCloseTo(4000, 3)
  const raised = await stateOf(page, 'Work')
  expect(raised.floorZ).toBeCloseTo(4000, 3)
  expect(raised.bottomZ, 'raising the zone moved its member').toBeCloseTo(0, 3)

  await select(page, 'Work')
  await page.mouse.move(600, 400)
  for (let i = 1; i <= 2; i++) {
    await typeKeys(page, ['g', 'x', '1', '0', '0', 'Enter'])
    await expect.poll(async () => (await stateOf(page, 'Work')).footprint.x).toBeCloseTo(500 + 100 * i, 0)
    expect((await stateOf(page, 'Work')).bottomZ, `grab ${i} popped the member up to its new floor`).toBeCloseTo(0, 3)
  }
  expect(errors, errors.join(' | ')).toEqual([])
})

// Not driven here: a zone and its member grabbed TOGETHER. The code reads the
// member's floor from the zone's segment start + its delta (`_gestureElevationReader`,
// 原則 #24), but no window can select both today — a zone plate has no cuboid,
// so the rectangle selection skips it, and the Outliner has no add-to-selection.
// Declared in ADR-170 実装メモ (S2) rather than tested through a debug hook.
