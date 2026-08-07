import { test, expect, devices } from '@playwright/test'
import { TOP_EDGE_OCCUPANTS } from '../src/view/EdgeOccupancy.js'
import { MIN_SUPPORTED_WIDTH } from '../src/view/Viewport.js'
import { CAMERA_DOF } from '../src/view/CameraGestures.js'

/**
 * Mobile reachability E2E — ADR-114.
 *
 * ## What this lane exists to catch that the unit lane cannot
 *
 * `EdgeOccupancy.test.js` and `HeaderEntranceCensus.test.js` count the
 * **declared** width of each header resident. A declaration cannot see the
 * rendered result: font metrics, locale, a `padding` someone tightened without
 * touching the table, or a browser's own minimum for a `<button>`. So the
 * declaration can be green while the pixel is off-screen — which is exactly the
 * shape of the defect ADR-114 closed.
 *
 * Therefore this lane measures **bounding boxes at the narrowest supported
 * width**, and counts the residents that are NOT fully inside the viewport.
 * The expected count is 0.
 *
 * ## Why the narrowest width specifically
 *
 * At 393px only the N-panel toggle fell off; at 320px the `⋯` menu went with
 * it. A test written at the default device width would have shown one failure
 * and hidden the other — the budget has to be asked where it is tightest, not
 * where it is convenient (the same reason ADR-100 ratchets the baseline rather
 * than sampling).
 */

const NARROW = { width: MIN_SUPPORTED_WIDTH, height: 720 }

async function bootNarrow(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  // Same escape the smoke lane uses: skip the launch Home surface so the
  // editor chrome (and its header) is what we are measuring.
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* denied */ } })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude === 'object' && window.__easyExtrude !== null))
    .toBe(true)
  return errors
}

// Touch + the narrowest supported width. `test.use` has to be file-level:
// `defaultBrowserType` inside a describe would force a new worker.
test.use({ ...devices['Pixel 5'], viewport: NARROW })

test.describe('mobile reachability', () => {
  test('every header resident is fully inside the narrowest supported viewport', async ({ page }) => {
    await bootNarrow(page)

    const report = await page.evaluate(() => {
      const header = document.querySelector('header')
      const vw = window.innerWidth
      // 数える対象は header の**直接の子**ではなく、実際に押せるコントロール
      // (`<button>`) である。ModeDropdown は `position:relative` のラッパ div に
      // 包まれており、ラッパは flex-shrink できるので、中のボタンが画面外へ
      // 出てもラッパの矩形は viewport 内に留まる — 直接の子を測る版はこの形を
      // 素通りした (この検査自体の最初の版がそうだった)。
      // 「指が届くか」を問うなら、測るのは指が触れる箱でなければならない。
      return {
        vw,
        scrollWidth: header.scrollWidth,
        clientWidth: header.clientWidth,
        residents: [...header.querySelectorAll('button')].map(el => {
          const r = el.getBoundingClientRect()
          return {
            name: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24) || el.tagName,
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            inside: r.left >= 0 && r.right <= vw,
          }
        }),
      }
    })

    // ボタンが 1 つも見つからないなら、検査は「0 個が画面外」で緑を出す —
    // 母集団が消えたことと規則が守られたことを区別する (原則 #31)。
    expect(report.residents.length).toBeGreaterThanOrEqual(5)

    // 「在る住人」ではなく「**画面外へ出た住人**」を数える (原則 #31)。
    const offscreen = report.residents.filter(r => !r.inside)
    expect(offscreen, `\n画面外の住人 ${offscreen.length} 個 (viewport ${report.vw}px):\n` +
      report.residents.map(r => `  ${r.inside ? '✓' : '✗'} ${String(r.width).padStart(4)}px  ` +
        `[${r.left}..${r.right}]  ${r.name}`).join('\n') +
      '\n\n  ヘッダは overflow:hidden なので、これらは DOM に在ったまま**押せない**。\n' +
      '  入口の個数を数える census は緑のままになる (ADR-114)。\n').toEqual([])

    // 溢れていないこと自体も直接問う (住人が 1 人でも縮んで見えなくなった場合の逆向き)。
    expect(report.scrollWidth).toBeLessThanOrEqual(report.clientWidth)
  })

  test('the N-panel toggle opens AND closes the drawer at the narrowest width', async ({ page }) => {
    await bootNarrow(page)
    const toggle = page.getByRole('button', { name: 'Toggle properties panel' })

    // 届くこと自体が主張の半分 — tap() は画面外の要素で失敗する。
    await expect(toggle).toBeVisible()
    await toggle.tap()
    await expect.poll(() => page.evaluate(() => {
      const p = [...document.querySelectorAll('#react-ui-root div')]
        .find(d => d.style.width === '200px' && d.style.position === 'fixed')
      return p ? getComputedStyle(p).transform : null
    })).toBe('matrix(1, 0, 0, 1, 0, 0)')   // translateX(0) = 開いている

    // **しまえること** — これが報告された症状そのもの。
    await toggle.tap()
    await expect.poll(() => page.evaluate(() => {
      const p = [...document.querySelectorAll('#react-ui-root div')]
        .find(d => d.style.width === '200px' && d.style.position === 'fixed')
      return p ? getComputedStyle(p).transform : null
    })).toBe('matrix(1, 0, 0, 1, 200, 0)')  // translateX(100%) = しまわれている
  })

  test('the dimmed scene closes the drawer too — a drawer always has a way out', async ({ page }) => {
    await bootNarrow(page)
    await page.getByRole('button', { name: 'Toggle properties panel' }).tap()

    const backdrop = page.locator('#react-ui-root div').filter({ hasNot: page.locator('*') })
      .locator('css=[style*="z-index: 80"], css=[style*="zIndex: 80"]')
    // 位置で叩く (backdrop は空 div なので role も text も持たない)。
    await page.touchscreen.tap(60, 400)
    await expect.poll(() => page.evaluate(() => {
      const p = [...document.querySelectorAll('#react-ui-root div')]
        .find(d => d.style.width === '200px' && d.style.position === 'fixed')
      return p ? getComputedStyle(p).transform : null
    })).toBe('matrix(1, 0, 0, 1, 200, 0)')
    void backdrop
  })

  test('every camera degree of freedom is reachable by touch — pan included', async ({ page }) => {
    await bootNarrow(page)
    const gestures = await page.evaluate(() => window.__easyExtrude.touchGestures())

    // 割当を持たない自由度を数える (0 であるべき)。pan はアプリの出荷から
    // ADR-114 まで、まさにこれが 1 だった。
    const unreachable = Object.values(CAMERA_DOF).filter(dof => !gestures.assignment[dof])
    expect(unreachable, `触れないカメラ自由度: ${unreachable.join(', ')}`).toEqual([])

    // 走っているアプリの OrbitControls が実際に DOLLY_PAN を握っていること —
    // 宣言表が正しくても、SceneView がそれを読んでいなければ画面は変わらない。
    expect(gestures.one).toBe('ROTATE')
    expect(gestures.two).toBe('DOLLY_PAN')
  })
})
