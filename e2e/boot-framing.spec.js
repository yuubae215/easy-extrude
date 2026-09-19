import { test, expect } from '@playwright/test'

/**
 * Boot framing E2E — ADR-137 D5.
 *
 * ## なぜ e2e なのか (Q3: その規律は書く瞬間にどこで問われるか)
 *
 * ADR-136 は world-unit を mm へ寄せ、その 4 つの変換点は正しかった。にもかかわらず
 * **起動直後の既定シーンが画面から消えた** — カメラが 50 mm の starter cube の内側
 * (原点から √61 ≈ 7.81 mm) に居り、far = 100 が可視域を 100 mm で打ち切っていた。
 * Outliner は `Cube selected` と表示し、`pnpm test` は 1293/1293 green だった。
 *
 * 見た目は `node --test` レーンが**構造的に見えない** (`SceneView` / `RobotStage` は
 * THREE.js 依存でレーンに乗らない)。ADR-136 は `docs/CODE_CONTRACTS.md` に規律を
 * 1 行足したが、**その行が在る状態でこの欠陥が commit された** — 散文は書く瞬間に
 * 問われない。だから問い所をここへ降ろす。
 *
 * ## 何を assert するか — 定数ではなく**関係**
 *
 * 「カメラ距離が 65 である」と焼くと、次に既定サイズが変わった日に嘘になる。
 * 代わりに framing が成り立つ条件そのものを問う:
 *
 *     distance > sceneRadius            カメラが中身の外に居る      ← 今回の欠陥
 *     far      > distance + sceneRadius 奥がクリップされない        ← 今回の欠陥
 *     near     < distance − sceneRadius 手前がクリップされない
 *     0 ≪ coverage ≪ 1                  点でもなく画面を埋めもしない
 *
 * これは尺度に依存しないので、m 系アセットを読む日が来ても意味を保つ。
 */

/** Boot into the editor, skipping the launch Home overlay (same escape as smoke). */
async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ } })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude?.framingState === 'function'))
    .toBe(true)
  return errors
}

const framing = (page) => page.evaluate(() => window.__easyExtrude.framingState())

test('起動直後の既定シーンが画面に収まっている (ADR-137 D5)', async ({ page }) => {
  const errors = await boot(page)

  // BootReveal (ADR-067) は既定 pose へ着地するので、着地後の値を読む。
  await expect.poll(() => framing(page).then(f => f.empty), { timeout: 15_000 }).toBe(false)
  const f = await framing(page)

  // シーンに中身がある (boot の starter solid)。0 個なら以下の比はすべて無意味 —
  // 「空だから通った」と「framing が正しいから通った」を区別する (原則 #31)。
  expect(f.sceneRadius).toBeGreaterThan(0)

  // ── 今回の欠陥そのもの ────────────────────────────────────────────────
  // カメラが中身の内側に居ない。ADR-136 後は distance 7.81 < radius 25 だった。
  expect(f.distance).toBeGreaterThan(f.sceneRadius)
  // 奥がクリップされない。ADR-136 後は far = 100 でシーンごと切られていた。
  expect(f.far).toBeGreaterThan(f.distance + f.sceneRadius)
  // 手前もクリップされない。
  expect(f.near).toBeLessThan(f.distance - f.sceneRadius)

  // ── 「写っている」の下限と上限 (原則 #27 の対と同じ形) ────────────────
  // 点として消えていない / 画面を埋め尽くしてもいない。
  //
  // **下限は 0.05 では足りない**。この検査を書いた初版は 0.05 を置いたが、
  // `_frameStarterScene()` を外して試すと**通ってしまった** — SceneView の
  // 宣言された seed 半径 (500 mm) だけでも 50 mm の starter は coverage ≈ 0.058 に
  // なり、「見えなくはない点」が下限を跨いでいた。D3 は 2 つの半分 (導出された
  // seed と、実シーンへの再フィット) から成り、0.05 は前者しか問えない。
  // 実シーンへフィットすれば coverage は 2r / (2·2.6r·tan30°) ≈ 0.67 に収束する
  // ので、下限を 0.3 に置くと「framing が中身に追従している」ことが問われる。
  expect(f.coverage).toBeGreaterThan(0.3)
  expect(f.coverage).toBeLessThan(1.5)

  expect(errors).toEqual([])
})

test('Add した既定ソリッドも画面の中に留まる (ADR-136 の起点だった症状)', async ({ page }) => {
  const errors = await boot(page)
  await expect.poll(() => framing(page).then(f => f.empty), { timeout: 15_000 }).toBe(false)
  const before = await framing(page)

  // ユーザー自身の入口で 2 つ目を足す。ユーザー報告の起点は「Add のキューブの
  // 縮尺が他と違う」— 既定キューブが小さすぎる/大きすぎると、ここで coverage が
  // 壊れる。framing は Add では動かない (fit しない) ので、既定サイズが
  // シーンの尺度と釣り合っていることがそのまま問われる。
  await page.getByText('+ Add', { exact: false }).first().click()

  await expect.poll(() => framing(page).then(f => f.sceneRadius))
    .toBeGreaterThan(before.sceneRadius)
  const after = await framing(page)

  expect(after.distance).toBeGreaterThan(after.sceneRadius * 0.5)
  expect(after.far).toBeGreaterThan(after.distance)
  expect(after.coverage).toBeGreaterThan(0.05)
  expect(after.coverage).toBeLessThan(3)

  expect(errors).toEqual([])
})
