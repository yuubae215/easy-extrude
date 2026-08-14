/**
 * Grasp stub lane — the UX scenarios, executed (ADR-117).
 *
 * Run with the lane enabled:
 *
 *   VITE_GRASP_STUB=1 pnpm test:e2e -- grasp-stub
 *
 * ## What these are for
 *
 * `docs/dogfooding/ux-scenarios.md` names the states a reviewer must be able to
 * reach. This file is the machine-checked half of that document: each scenario
 * below drives the real UI to the state the document promises, so the document
 * cannot rot into a description of a screen that no longer exists (原則 #19 Q3 —
 * the deliverable is a check, not a paragraph).
 *
 * They also pin the thing the stub exists to guarantee: that the whole path from
 * a cold boot to a ranked candidate runs with **no backend of any kind**. If
 * `pnpm dev` alone stops being enough, these go red.
 *
 * The suite SKIPS (not passes) when the lane is off, and the skip says why.
 */
import { test, expect } from '@playwright/test'

const STUB_ON = process.env.VITE_GRASP_STUB === '1'

test.skip(!STUB_ON,
  'grasp stub lane is off — run with VITE_GRASP_STUB=1 (see docs/dogfooding/ux-scenarios.md)')

/** Boot into the editor, skipping the launch Home overlay (same escape as smoke). */
async function boot(page, scenario) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* denied */ } })
  await page.goto(`/easy-extrude/${scenario ? `?graspStub=${scenario}` : ''}`)
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect(page.getByText('Scene Collection', { exact: true })).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude === 'object' && window.__easyExtrude !== null))
    .toBe(true)
  return errors
}

async function selectRow(page, name) {
  await page.locator('[draggable]').filter({ hasText: name }).first().click()
}

/**
 * The fast path the whole exercise is about: cold boot → the grasp panel, with
 * no forms and no server. Leaves the panel open, ready to Run.
 */
async function reachGraspPanel(page, scenario) {
  const errors = await boot(page, scenario)
  await selectRow(page, 'robot_base')
  await page.keyboard.press('n')
  await page.getByRole('button', { name: /Grasp candidates/ }).click()
  await expect(page.getByRole('button', { name: /Run grasp search/ })).toBeVisible({ timeout: 30_000 })
  return errors
}

/** Pick the first real option when the layout offers several graspable objects. */
async function pickAnObjectIfAsked(page) {
  const picker = page.locator('select').filter({ hasText: /pick one of/ })
  if (await picker.count() === 0) return null
  const values = await picker.first().locator('option').evaluateAll(
    opts => opts.map(o => o.value).filter(Boolean))
  if (values.length === 0) return null
  await picker.first().selectOption(values[0])
  return values[0]
}

test('S1 — バックエンド無しで、起動から候補まで到達する', async ({ page }) => {
  // これが成立しない限り他のシナリオは意味を持たない。ADR-117 以前は、
  // ここまで来ても答えは常に「0 件生成」だった。
  const errors = await reachGraspPanel(page, 'solve')

  // スタブであることが画面に出ていること — 記録が虚構を実測として拾わないための条件。
  await expect(page.getByText(/Stubbed results/)).toBeVisible()

  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()

  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/0 candidate poses generated/)).toHaveCount(0,
    { timeout: 5_000 })

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S2 — 掴む対象を選ぶまで Run は理由つきで閉じている (ADR-117)', async ({ page }) => {
  // 無言の disabled を作らない (原則 #11)。starter は複数のソリッドを持つので
  // ここは N 個・未選択の分岐に入る。
  const errors = await reachGraspPanel(page, 'solve')
  const picker = page.locator('select').filter({ hasText: /pick one of/ })
  if (await picker.count() > 0) {
    await expect(page.getByText(/pick which one to grasp/)).toBeVisible()
    await expect(page.getByRole('button', { name: /Run grasp search/ })).toBeDisabled()
    await pickAnObjectIfAsked(page)
    await expect(page.getByRole('button', { name: /Run grasp search/ })).toBeEnabled()
  }
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S3 — 全棄却のファネルが 5 段そろって描ける', async ({ page }) => {
  const errors = await reachGraspPanel(page, 'allRejected')
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })
  // 0 件でも「入力を直せ」ではなく、どの段で落ちたかが出ること。
  await expect(page.getByText(/0 candidate poses generated/)).toHaveCount(0)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S4 — 生成 0 件のときは段の説明ではなく入力の案内が出る', async ({ page }) => {
  const errors = await reachGraspPanel(page, 'empty')
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/0 candidate poses generated/)).toBeVisible({ timeout: 30_000 })
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S5 — 候補 1 件の thin 結果が壊れずに描ける', async ({ page }) => {
  const errors = await reachGraspPanel(page, 'thin')
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done — 1 candidate/)).toBeVisible({ timeout: 30_000 })
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S6 — 503 / 502 / 400 が理由つきで画面に出る (無言の失敗が無い)', async ({ page }) => {
  for (const scenario of ['error503', 'error502', 'error400']) {
    const errors = await reachGraspPanel(page, scenario)
    await pickAnObjectIfAsked(page)
    await page.getByRole('button', { name: /Run grasp search/ }).click()
    await expect(page.getByText(/Failed —/)).toBeVisible({ timeout: 30_000 })
    expect(errors, `${scenario}: unexpected page errors: ${errors.join(' | ')}`).toEqual([])
  }
})

test('未宣言のシナリオ名は既定へ倒れず、画面上で拒否される (原則 #31 + #11)', async ({ page }) => {
  // `?graspStub=emtpy` のような打ち間違いで solve 画面を見せられると、レビュアーは
  // 「見ていない画面」について所見を書くことになる。かといって boot 中に throw する
  // だけでは、その拒否は devtools を開いている人にしか届かない — 静かな失敗の
  // 着替えでしかない。**画面に出ること**までがこの検査の対象。
  await reachGraspPanel(page, 'emtpy')
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Failed —/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/unknown scenario "emtpy"/)).toBeVisible()
})

test('S8 — 測っていない objective は 0 のバーではなく「測っていない」と出る (ADR-120)', async ({ page }) => {
  // フロントはリーチ範囲 (plan{}) を集めていないので、`reach_margin` は
  // **評価できない** objective である。これを 0 のバーで描くと「余裕ゼロ」に読め、
  // 候補が実際より悪く見える。0 と未測定は画面上で別物でなければならない。
  const errors = await reachGraspPanel(page, 'solve')
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  // 重み付けした名前は消えず (無言の省略をしない — 原則 #11)、測れなかったことが
  // 言葉で出る。測れた objective のバーは今までどおり出ている。
  await expect(page.getByText(/not measured: reach_margin/).first()).toBeVisible()
  await expect(page.getByText('approach_clearance').first()).toBeVisible()

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S9 — 宣言すれば同じ objective が測れる: 不在の正の対照 (ADR-120)', async ({ page }) => {
  // S8 は「測れなかった」側しか見せない。**現れさせられない不在は証拠にならない** —
  // このスタブがそもそも `reach_margin` を出せないだけ、と読めてしまうため。
  // `reachDeclared` は同じ solve 経路にリーチ範囲を宣言した request を通すので、
  // 差は宣言だけ。GitHub Pages にはフォームも curl も無いので、この 2 つの URL を
  // 行き来することが唯一の対照になる (原則 #31 — 負の対照だけでは何も示さない)。
  const errors = await reachGraspPanel(page, 'reachDeclared')
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  // 測れた側: バーが出て、「測っていない」の断り書きは消える。
  await expect(page.getByText('reach_margin').first()).toBeVisible()
  await expect(page.getByText(/not measured: reach_margin/)).toHaveCount(0)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})
