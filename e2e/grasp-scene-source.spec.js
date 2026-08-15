import { test, expect } from '@playwright/test'

/**
 * ADR-132 — 実機で 2 つの主張を確かめる。
 *
 *  1. **入口はシーンを消さない。** 文書が無い状態で grasp search を開いても、
 *     ユーザーが置いた実体は 1 つも消えない (旧: `cell_robotics` が読み込まれ、
 *     シーンがまるごと入れ替わって「TCP 教示点 pick / place」が現れていた)。
 *  2. **初期シーンにロボットは居ない。** かつては居たが `explicit:false` で
 *     見えなかった — 基数 1 を基数 0 として提示する形 (ADR-132 D5)。
 *
 * 数え方の注意: 消滅には状態が無い (ADR-131) ので、「消えなかったこと」は
 * **消えてよかったものの個数**で書く — 開く前後の実体を集合として比べ、差が空である
 * ことを問う。個数だけを比べると、同数の別物に入れ替わった場合に緑を出す。
 */

async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ }
  })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude?.graspSource === 'function'))
    .toBe(true)
  return errors
}

const graspSource = (page) => page.evaluate(() => window.__easyExtrude.graspSource())

test('初期シーンにロボットは居ない — 見えない 1 台を置かない (ADR-132 D5)', async ({ page }) => {
  const errors = await boot(page)
  const snap = await graspSource(page)
  expect(snap.robots, '起動時のロボット台数は 0 — ADR-090 が一級市民にした状態に boot も従う').toBe(0)
  expect(errors).toEqual([])
})

test('grasp search を開いてもシーンの実体は 1 つも消えない (ADR-132 D1/D4)', async ({ page }) => {
  const errors = await boot(page)

  // ユーザーの作業を模す: ロボットを 1 台足す (Add ▸ Robot と同じ経路)。
  await page.evaluate(() => window.__easyExtrude.addRobot())
  const before = await graspSource(page)
  expect(before.robots).toBe(1)
  expect(before.entities.length, 'ロボット (base + tcp) + 起動時の箱').toBeGreaterThanOrEqual(3)

  // 入口を開く。旧実装はここで `cell_robotics` を読み込み、全消ししていた。
  await page.evaluate(() => window.__easyExtrude.openGrasp())
  await page.waitForTimeout(800)   // 旧実装の非同期ロードが走り切る余地を与える

  const after = await graspSource(page)
  const lost  = before.entities.filter(e => !after.entities.includes(e))
  expect(lost, '入口を開くことで消えてよい実体は 0 個').toEqual([])
  expect(after.robots, '選んでいない文書の読み込みでロボットが差し替わらない').toBe(1)

  // 探索は文書が無くても生きている — 幾何は live scene から来る (D1)。
  expect(after.geometrySource).toBe('scene')
  expect(after.declarationSource, '文書が無い = 「誰も宣言していない」という状態').toBe('none')

  expect(errors).toEqual([])
})
