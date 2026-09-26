/**
 * ADR-152 D2/D6 — "+x — where is that?" is answered ON THE OBJECT, before
 * anything is run.
 *
 * The pure layer (`GraspDeclarationConfirmation.test.js`, `graspFeature.test.js`)
 * proves the words and the geometry. What only a running app can show is that the
 * panel's inputs actually reach the viewport: a declared spec, a focused spec and
 * a hovered face chip each change what is drawn. This spec reads the picture
 * through `window.__easyExtrude.graspDeclaration()` rather than pixels.
 *
 * The declaration lives in a Context document (ADR-119: the document owns it), so
 * the test forks the bundled `cell_robotics` example through the same callback the
 * template gallery uses.
 */
import { test, expect } from '@playwright/test'

async function bootWithCell(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ }
  })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude?.graspDeclaration === 'function'))
    .toBe(true)
  await page.evaluate(async () => {
    const { useUIStore } = await import('/easy-extrude/src/store/uiStore.js')
    window.__ui = useUIStore
    await useUIStore.getState().callbacks.onForkTemplate('cell_robotics')
  })
  await expect.poll(() => page.evaluate(() => window.__easyExtrude.graspSource().robots)).toBe(1)
  return errors
}

const cb = (page, name, ...args) =>
  page.evaluate(([n, a]) => window.__ui.getState().callbacks[n](...a), [name, args])
const picture = (page) => page.evaluate(() => window.__easyExtrude.graspDeclaration())

test('宣言した仕様・ホバーした面・手が、走らせる前に物体の上に出る (ADR-152 D2/D6)', async ({ page }) => {
  const errors = await bootWithCell(page)
  await page.evaluate(() => window.__easyExtrude.openGrasp())
  await cb(page, 'onSelectGraspTarget', 'pick_table')
  await cb(page, 'onSetRobotHand', null, {
    kind: 'parallelJaw', maxOpening: 60, fingerClearance: 10,
    body: { kind: 'cylinder', radius: 32, length: 78 },
    fingers: { length: 72, thickness: 12, width: 21 },
  })
  await expect.poll(() => page.evaluate(() => window.__ui.getState().context.robots?.hand?.state)).toBe('declared')
  await cb(page, 'onSetGraspFeature', 'pick_table', {
    kind: 'specs',
    specs: [{ name: 'top pinch', hand: 'parallelJaw', approach: { from: '+z' }, closing: 'x', depth: 20 }],
  })
  await expect.poll(() => page.evaluate(() => window.__ui.getState().context.graspTargets?.feature?.state)).toBe('declared-specs')

  await cb(page, 'onPreviewGraspSamples')
  await cb(page, 'onFocusGraspSpec', 0)
  let pic = await picture(page)
  // Six face labels, each carrying the world word for the table as it stands.
  expect(pic.labels).toHaveLength(6)
  expect(pic.labels).toContain('+z · top')
  expect(pic.labels).toContain('+x · front')
  // The focused spec: region, arrow, the two contact faces, the depth plane, the
  // open fingers and the declared hand in place.
  for (const k of ['region', 'arrow', 'contact', 'closingArrow', 'depthPlane', 'fingers', 'preview']) {
    expect(pic.focused, k).toContain(k)
  }
  expect(pic.hover).toBe(false)

  // "指す前に光る": hovering a chip paints that face; leaving clears it.
  await cb(page, 'onHoverGraspFace', '+x')
  pic = await picture(page)
  expect(pic.hover).toBe(true)
  await cb(page, 'onHoverGraspFace', null)
  pic = await picture(page)
  expect(pic.hover).toBe(false)

  expect(errors).toEqual([])
})
