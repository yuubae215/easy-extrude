/**
 * ADR-168 S1b — a declared relation is shown where its words point, and a
 * mismatch is on screen without selecting anything (D4).
 *
 * The pure layer (`ArrangementConfirmation.test.js`) proves every word has a
 * picture and that the picture sits where the word points. What only a running
 * app can show is that a Context document's `arrangements` actually reach the
 * Relations section and the viewport, and that the selection moves the focus.
 * The picture is read through `window.__easyExtrude.arrangements()`, not pixels.
 *
 * The document is the single-arm pick & place template turned into a context
 * document (the same `docFromLayout` the Home card uses), plus two actors, a
 * declared viewer and three relations — one holding, one broken, and two people
 * disagreeing — imported through the File → Import path a person uses.
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
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude?.arrangements === 'function'))
    .toBe(true)
  return errors
}

async function importDoc(page) {
  const doc = await page.evaluate(async () => {
    const { useUIStore } = await import('/easy-extrude/src/store/uiStore.js')
    window.__ui = useUIStore
    const { docFromLayout } = await import('/easy-extrude/src/context/DocBuilder.js')
    const layout = (await import('/easy-extrude/examples/layout_pick_place_cell.json')).default
    const withViewer = JSON.parse(JSON.stringify(layout))
    // Added BEFORE the document is built, so the viewer gets its trace like every
    // other template entity (an untraced entity is an orphan spec — ADR-046).
    withViewer.entities.push({
      ref: 'operator', type: 'CoordinateFrame', name: 'Operator', frameRole: 'viewer',
      position: { x: -1500, y: 0, z: 1600 },
    })
    const d = docFromLayout(withViewer, 'Relations e2e')
    d.actors = [{ ref: 'ann' }, { ref: 'ben' }]
    d.arrangements = [
      { ref: 'bin_on_bench', by: 'ann', subject: 'part_bin', sides: [{ of: 'worktable', contact: 'touching', toward: '+z' }] },
      { ref: 'bin_left',     by: 'ann', subject: 'part_bin', sides: [{ of: 'output_tray', contact: 'apart', toward: { dir: 'right', viewer: 'operator' } }] },
      { ref: 'work_ann',     by: 'ann', subject: 'work_1',   sides: [{ of: 'part_bin', contact: 'touching' }] },
      { ref: 'work_ben',     by: 'ben', subject: 'work_1',   sides: [{ of: 'part_bin', contact: 'apart' }] },
    ]
    return d
  })
  const chooser = page.waitForEvent('filechooser')
  await page.evaluate(() => window.__ui.getState().callbacks.onImportCtxJson())
  await (await chooser).setFiles({ name: 'relations.ctx.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) })
  await expect.poll(() => page.evaluate(() => window.__easyExtrude.arrangements()?.model?.kind)).toBe('listed')
}

const snap = (page) => page.evaluate(() => window.__easyExtrude.arrangements())

test('関係の宣言が画面に出る — 不一致は何も選ばなくても見え、選ぶとその物の関係が語の指す先に描かれる (ADR-168 S1b)', async ({ page }) => {
  const errors = await boot(page)
  await importDoc(page)

  // Nothing selected: the counts, and only the broken / disputed relations drawn.
  let s = await snap(page)
  expect(s.focusRefs).toEqual([])
  expect(s.model.summary).toEqual({ relations: 4, mismatched: 2, conflicts: 1 })
  const kinds = s.picture.items.map(i => i.kind)
  expect(kinds).toContain('caption')
  expect(s.picture.items.some(i => i.kind === 'caption' && /^conflict on contact/.test(i.text))).toBe(true)
  // `bin_left` says RIGHT, but seen from the operator the bin is on the tray's left.
  // The picture stays neutral (C4); the caption's mark carries the mismatch.
  expect(s.picture.items.some(i => i.kind === 'viewerAxes' && i.tone === 'entityDefault')).toBe(true)
  expect(s.picture.items.some(i => i.kind === 'caption' && /direction ✗/.test(i.text)
    && i.segments.some(g => g.text === '✗' && g.tone === 'cautionTone')
    && i.segments.every(g => g.text === '✗' || g.tone !== 'cautionTone'))).toBe(true)

  // Select the workpiece through the section's own name link.
  await page.evaluate(() => window.__ui.getState().callbacks.onSelectRelationEntity('work_1'))
  await expect.poll(async () => (await snap(page)).focusRefs).toEqual(['work_1'])
  s = await snap(page)
  expect(s.model.rows.map(r => r.ref)).toEqual(['work_ann', 'work_ben'])
  // `touching` points at the bin's inner floor: the patch is under the workpiece.
  const patch = s.picture.items.find(i => i.kind === 'contactPatch')
  expect(patch).toBeTruthy()
  for (const c of patch.corners) expect(c[2]).toBeCloseTo(810, 3)

  // Select the bin: the holding relation's face is painted on the bench top.
  await page.evaluate(() => window.__ui.getState().callbacks.onSelectRelationEntity('part_bin'))
  await expect.poll(async () => (await snap(page)).focusRefs).toEqual(['part_bin'])
  s = await snap(page)
  const face = s.picture.items.find(i => i.kind === 'facePaint')
  expect(face.tone).toBe('entityDefault')
  for (const c of face.corners) expect(c[2]).toBeCloseTo(800, 3)

  // The section is on screen and says the counts in words.
  if (!(await page.evaluate(() => window.__ui.getState().nPanelVisible))) await page.keyboard.press('n')
  await expect(page.getByText('4 relations · 2 mismatched · 1 conflict')).toBeVisible()

  await expect(page.getByText('Relations (part_bin)')).toBeVisible()
  if (process.env.SHOT) {
    // A person's view of it: framed on the bin, the section scrolled into view.
    await page.keyboard.press('f')
    await page.waitForTimeout(1500)
    await page.getByText('Relations (part_bin)').scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.SHOT })
  }

  expect(errors).toEqual([])
})

test('動かした物の関係は、話している人の名前でだけ差し出され、受けると文書に主張として入る (ADR-168 S2-1)', async ({ page }) => {
  const errors = await boot(page)
  await importDoc(page)
  if (!(await page.evaluate(() => window.__ui.getState().nPanelVisible))) await page.keyboard.press('n')

  // The tray stands on the bench (the template's old "above"); nobody claims it yet.
  await page.evaluate(() => window.__ui.getState().callbacks.onSelectRelationEntity('output_tray'))
  await expect.poll(async () => (await snap(page)).focusRefs).toEqual(['output_tray'])
  const speaker = page.getByTestId('relation-speaker')
  await expect(speaker).toHaveValue('')
  await expect(page.getByText(/Nobody is speaking/)).toBeVisible()

  const box = await page.locator('#canvas-container canvas').boundingBox()
  const grabAndDrop = async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.keyboard.press('g')
    await page.keyboard.press('Enter')
  }

  // Nobody speaking: a drop offers no relation (a claim needs a claimant — D5).
  await grabAndDrop()
  await page.waitForTimeout(300)
  await expect(page.getByRole('button', { name: /^Claim as/ })).toHaveCount(0)

  // Ann speaks: the same drop offers "resting on" in her name.
  await speaker.selectOption('ann')
  await expect.poll(async () => (await snap(page)).speaker).toBe('ann')
  await grabAndDrop()
  const claim = page.getByRole('button', { name: 'Claim as ann' })
  await expect(claim).toBeVisible()
  await expect(page.getByText(/resting on/)).toBeVisible()
  await claim.click()

  // The claim is in the document, read back by the Relations section as holding.
  await expect.poll(async () => (await snap(page)).model.rows.map(r => `${r.by}:${r.subject}`)).toContain('ann:output_tray')
  const row = (await snap(page)).model.rows.find(r => r.by === 'ann' && r.subject === 'output_tray')
  expect(row.sides[0].of).toBe('worktable')
  expect(row.sides[0].contact).toMatchObject({ declared: 'touching', status: 'match' })
  expect(row.sides[0].toward).toMatchObject({ declared: '+z', status: 'match' })

  // Undo takes the claim back out — it went through the one doc-edit command.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await snap(page)).model.rows.some(r => r.by === 'ann' && r.subject === 'output_tray')).toBe(false)

  expect(errors).toEqual([])
})
