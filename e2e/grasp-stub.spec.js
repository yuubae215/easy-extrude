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
 *
 * **ADR-132 changed what "cold boot" gives you, and the path got shorter.** It used
 * to lean on two things that are now gone: a robot the boot scene seeded (hidden —
 * cardinality 1 presenting as 0, D5) and the entrance auto-loading `cell_robotics`
 * when no document existed (which REPLACED the scene, D4). So the setup now builds
 * the cell the way a user would — add a robot, add a second solid — and the search
 * runs against that live scene with no document at all. That is the stronger
 * version of the claim this file exists to pin: no backend AND no document.
 *
 * The second box matters: with one solid the target roster is `single` and resolves
 * implicitly, so S2's "N objects, pick one" branch would never be entered and the
 * scenario would pass while asserting nothing (原則 #31 — a guard that is never
 * reached is not a guard).
 */
async function reachGraspPanel(page, scenario) {
  const errors = await boot(page, scenario)
  await page.locator('#canvas-container canvas').click()
  await page.getByRole('button', { name: /\+ Add/ }).click()   // a second graspable solid
  await page.locator('#canvas-container canvas').click()
  await page.keyboard.press('Shift+A')
  await page.getByText('Robot', { exact: true }).click()
  await selectRow(page, 'robot_base')
  await page.keyboard.press('n')
  await page.getByRole('button', { name: /Grasp candidates/ }).click()
  await expect(page.getByRole('button', { name: /Run grasp search/ })).toBeVisible({ timeout: 30_000 })
  return errors
}

/** Pick the first real option when the layout offers several graspable objects. */
/**
 * Take the robot's hand back to UNDECLARED through the Grasped card (ADR-152 D3).
 * A new robot is born with a declared default hand (a 60 mm jaw), so the grasp
 * gate is ON by default — and a 60 mm jaw honestly cannot close on the 1 m
 * default cube. Scenarios whose premise is "no gripper declared" (objective
 * presentation, arm preview) state that premise here instead of relying on the
 * old default, which was the panel's form switched off.
 */
async function undeclareHand(page) {
  const toggle = page.getByText('Grasped', { exact: true }).locator('..').getByRole('checkbox')
  await expect(toggle).toBeChecked()
  await toggle.uncheck()
  await expect(page.getByText(/no hand declared on this robot's tcp/)).toBeVisible()
}

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
  await undeclareHand(page)
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
  await undeclareHand(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  // 測れた側: バーが出て、「測っていない」の断り書きは消える。
  await expect(page.getByText('reach_margin').first()).toBeVisible()
  await expect(page.getByText(/not measured: reach_margin/)).toHaveCount(0)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S11 — core/ が居なくても腕は動き、かつ「解いた腕」を名乗らない (ADR-144)', async ({ page }) => {
  // ADR-144 の Goal そのもの。スタブは IK を解かないので `reachSolution` は常に
  // `undeclared` — ADR-135 の配線だけでは、GitHub Pages の腕は永久に rest のまま
  // だった。ここで問うのは 2 つで、**どちらか片方では足りない**:
  //   (a) 腕が実際に動いたか (動かないなら Goal 未達)
  //   (b) 動いた腕が「未検証」と名乗っているか (名乗らないなら、権威の無い近似が
  //       権威のふりをしている = ADR-144 が払うと決めたコストの踏み倒し)
  // 関節角は THREE に書かれた**後**の値を読み戻す (RobotStage.previewState) ので、
  // 「渡したつもり」では緑にならない。
  // **どのシーンで問うかがこの検査の半分である。** `reachGraspPanel` が組む場面は
  // ロボットを Shift+A で足すので、台座は既定の原点から 2.8 m (ADR-083) に立つ。
  // UR5e の到達は 0.9 m なので、そこでは近似は正直に「無い」を返し腕は rest の
  // まま — それは欠陥ではなく仕様 (原則 #11) だが、Goal の証拠にはならない。
  // だから Home の単腕ピック&プレイスセル (台座と対象が同じセルの中にある実在の
  // 配置) で問う。**届かない場合の rest は S11b が別に焼く。**
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/easy-extrude/?graspStub=solve')
  await expect(page.getByText('工程レイアウトを選んで始める')).toBeVisible()
  await page.getByText('単腕ピック&プレイスセル', { exact: true }).click()
  await expect(page.getByText('工程レイアウトを選んで始める')).not.toBeVisible()
  await expect
    .poll(async () => (await page.evaluate(() => window.__easyExtrude.robotState())).length)
    .toBe(1)

  await selectRow(page, 'robot_base')
  await page.keyboard.press('n')
  await page.getByRole('button', { name: /Grasp candidates/ }).click()
  await expect(page.getByRole('button', { name: /Run grasp search/ })).toBeVisible({ timeout: 30_000 })
  await pickAnObjectIfAsked(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  const snapshot = () => page.evaluate(() => window.__easyExtrude.armPreview())
  const before = await snapshot()
  const ids = Object.keys(before)
  expect(ids.length, '腕が 1 台も観測できていない — 母集団が痩せたこと自体で落とす').toBe(1)
  expect(before[ids[0]].unverified, '何も選んでいないのに未検証の腕が出ている').toBe(false)

  // 候補を選ぶ = 探索の主語の腕がその候補の配置を取る。
  await page.getByText(/^#1$/).click()

  await expect.poll(async () => (await snapshot())[ids[0]].unverified,
    { timeout: 10_000 }).toBe(true)
  const after = await snapshot()
  const moved = Object.keys(after[ids[0]].joints)
    .filter(name => Math.abs(after[ids[0]].joints[name] - before[ids[0]].joints[name]) > 1e-6)
  expect(moved.length, `腕が rest のまま動いていない: ${JSON.stringify(after[ids[0]].joints)}`)
    .toBeGreaterThan(0)

  // 画面側の名乗り: 行は「ワイヤに解は無い」と言い、近似であることを述べる。
  await expect(page.getByText(/solved by this\s+browser and checked against nothing/).first()).toBeVisible()

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S11b — 腕が届かない配置では、近似は出さず rest のまま (ADR-144 / 原則 #11)', async ({ page }) => {
  // S11 の対照。ここでは台座が既定位置 (原点から 2.8 m) に立つので、対象は
  // 0.9 m の腕の作業領域の外にある。**近い配置は存在する**ので、「一番近いもの」を
  // 出す実装ならここで腕が動いてしまう — 動かないことが主張であり、S11 だけでは
  // この区別は焼けない (常に何か出す実装も S11 なら緑になる)。
  const errors = await reachGraspPanel(page, 'solve')
  await pickAnObjectIfAsked(page)
  await undeclareHand(page)
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  const snapshot = () => page.evaluate(() => window.__easyExtrude.armPreview())
  const before = await snapshot()
  const ids = Object.keys(before)
  expect(ids.length).toBe(1)
  await page.getByText(/^#1$/).click()
  await page.waitForTimeout(500)

  const after = await snapshot()
  expect(after[ids[0]].unverified, '届かない候補に未検証の腕が出ている').toBe(false)
  expect(after[ids[0]].joints, '届かない候補で腕が動いた — 一番近い配置を出している')
    .toEqual(before[ids[0]].joints)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S12 — TCP の印は腕と一緒にプレビュー姿勢へ行き、候補の点に立つ (ADR-151 D2)', async ({ page }) => {
  // 当事者の報告「tcp のラベルとロボットゴーストの tcp が離れている」への 1:1 の回帰。
  // 以前の印はシーンの tcp 実体で、辺 robot_base → tcp に休止姿勢の FK を焼き込んで
  // いたので、腕が候補の姿勢を取っても動かなかった。いまの印は腕の wrist_3_link の子で、
  // 取付け (tool0 → tcp) に立つ — だから候補を解いた腕なら、印はその候補の点に居る。
  //
  // **同じ要求を 2 回通す** (#1 → #2 → #1)。入力が毎回変わる検査は 1 フレーム古い状態を
  // 読む欠陥を隠す (ADR-098 → ADR-101)。最後に探索をやり直して rest へ戻ることも問う。
  // 読むのは THREE が合成した行列から取った印の世界位置 (tcpState) で、意図では緑にならない。
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/easy-extrude/?graspStub=solve')
  await expect(page.getByText('工程レイアウトを選んで始める')).toBeVisible()
  await page.getByText('単腕ピック&プレイスセル', { exact: true }).click()
  await expect(page.getByText('工程レイアウトを選んで始める')).not.toBeVisible()
  await expect
    .poll(async () => (await page.evaluate(() => window.__easyExtrude.robotState())).length)
    .toBe(1)
  await selectRow(page, 'robot_base')
  await page.keyboard.press('n')
  await page.getByRole('button', { name: /Grasp candidates/ }).click()
  await expect(page.getByRole('button', { name: /Run grasp search/ })).toBeVisible({ timeout: 30_000 })
  // The part bin, by name — not "the first option": the first is the whole
  // worktable, whose candidates stand beside the pedestal where no UR5e pose
  // exists, and a check whose arm never moves asks nothing (see `posed` below).
  await page.locator('select').filter({ hasText: /pick one of/ }).first().selectOption('part_bin')
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  const tcp = () => page.evaluate(() => window.__easyExtrude.tcpState())
  const arm = () => page.evaluate(() => window.__easyExtrude.armPreview())
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
  const TOL_MM = 1   // the client's closed form realises the candidate pose exactly (ADR-147)

  const rest = (await tcp()).robots[0]
  expect(dist(rest.marker, rest.sceneTcp), '休止姿勢で印とシーンの tcp が離れている').toBeLessThan(TOL_MM)

  let posed = 0
  for (const rank of [1, 2, 1]) {
    await page.getByText(new RegExp(`^#${rank}$`)).click()
    await expect.poll(async () => (await tcp()).selectedCandidateTcp !== null).toBe(true)
    const ids = Object.keys(await arm())
    // Whether THIS candidate poses the arm is the client solver's answer, not ours.
    // Posed → the marker must be on the candidate; rested → it must be at rest.
    await page.waitForTimeout(300)
    const unverified = (await arm())[ids[0]].unverified
    if (unverified) {
      posed++
      await expect.poll(async () => {
        const s = await tcp()
        return dist(s.robots[0].marker, s.selectedCandidateTcp)
      }, { message: `#${rank}: 腕は候補を取ったのに印が候補の点に居ない` }).toBeLessThan(TOL_MM)
    } else {
      const s = await tcp()
      expect(dist(s.robots[0].marker, s.robots[0].sceneTcp), `#${rank}: 腕は rest なのに印が rest に居ない`)
        .toBeLessThan(TOL_MM)
    }
  }
  expect(posed, '腕が一度も候補を取らなかった — この検査は何も問えていない (母集団 0)').toBeGreaterThanOrEqual(2)

  // A new run clears the preview (ADR-059 §B-5): the arm rests, and the marker with it.
  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => {
    const s = (await tcp()).robots[0]
    return dist(s.marker, s.sceneTcp)
  }, { message: '探索をやり直しても印が rest に戻らない' }).toBeLessThan(TOL_MM)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S10 — 掴む場所は「言っていない」が画面に出て、文書が無ければ宣言できない理由が出る (ADR-128 / ADR-119 D2 / 原則 #11)', async ({ page }) => {
  // 沈黙には欄が無い (原則 #31)。導出に落ちたことが画面に出ていなければ、ユーザーは
  // 自分が「どこを掴むか」を一度も言っていないことに気づけない。宣言と沈黙が *同じ*
  // サンプルを出す以上、区別を運ぶのはこの文だけなので、文そのものを焼く。
  const errors = await reachGraspPanel(page, 'solve')
  await pickAnObjectIfAsked(page)

  // 既定 = 何も宣言していない。「導出に落ちた」と書いてあること。
  await expect(page.getByText(/not declared — sampling/)).toBeVisible()

  // 把持仕様の宣言は**文書**に書かれる (ADR-119)。このシナリオは文書を採用していない
  // ので書く場所が無い — 以前はこの押下が何も起こさず消えていた (原則 #11)。いまは
  // 理由が出て、宣言していない状態が保たれる。文書無しで宣言できる経路は DEF-049。
  await page.getByRole('button', { name: '+ grasp spec', exact: true }).click()
  await expect(page.getByText(/Grasp specs are saved in a context document/)).toBeVisible()
  await expect(page.getByText(/not declared — sampling/)).toBeVisible()

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('S13 — フロントだけで ADR-152 を評価できる: 仕様・戦略・手の形が答えを分ける (スタブ)', async ({ page }) => {
  // バックエンド無し (GitHub Pages と同じレーン) で、宣言の違いが答えの違いになることを
  // 焼く。cell_robotics のワーク (80×40×60 mm) に 3 つの仕様を並べる:
  //   across x — x で挟む: 80 + clearance 10 > 開口 60 → 把持性で落ちる
  //   across y — y で挟む: 40 + 10 ≤ 60 → 取れる (priority なのでこれだけが返る)
  //   too deep — 深さ 70 mm: 開いた爪の先がテーブルの天面より下 → 干渉で落ちる
  // スタブの判定は粗い写しだが、core/ が「取れない」と言う宣言を「取れる」とは言わない。
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* denied */ } })
  await page.goto('/easy-extrude/?graspStub=solve')
  await expect.poll(() => page.evaluate(() => typeof window.__easyExtrude?.openGrasp === 'function')).toBe(true)
  await page.evaluate(async () => {
    const { useUIStore } = await import('/easy-extrude/src/store/uiStore.js')
    window.__ui = useUIStore
    await useUIStore.getState().callbacks.onForkTemplate('cell_robotics')
  })
  await expect.poll(() => page.evaluate(() => window.__easyExtrude.graspSource().robots)).toBe(1)
  const cb = (name, ...args) => page.evaluate(([n, a]) => window.__ui.getState().callbacks[n](...a), [name, args])

  await page.evaluate(() => window.__easyExtrude.openGrasp())
  await cb('onSelectGraspTarget', 'workpiece')
  await cb('onSetRobotHand', null, {
    kind: 'parallelJaw', maxOpening: 60, fingerClearance: 10,
    body: { kind: 'cylinder', radius: 32, length: 78 },
    fingers: { length: 72, thickness: 12, width: 21 },
  })
  await expect.poll(() => page.evaluate(() => window.__ui.getState().context.robots?.hand?.state)).toBe('declared')
  await cb('onSetGraspFeature', 'workpiece', {
    kind: 'specs',
    specs: [
      { name: 'across x', hand: 'parallelJaw', approach: { from: '+z' }, closing: 'x', depth: 20 },
      { name: 'across y', hand: 'parallelJaw', approach: { from: '+z' }, closing: 'y', depth: 20 },
      { name: 'too deep', hand: 'parallelJaw', approach: { from: '+z' }, closing: 'y', depth: 70 },
    ],
  })
  await expect.poll(() => page.evaluate(() => window.__ui.getState().context.graspTargets?.feature?.state)).toBe('declared-specs')

  await page.getByRole('button', { name: /Run grasp search/ }).click()
  await expect(page.getByText(/Done —/)).toBeVisible({ timeout: 30_000 })

  const g = await page.evaluate(() => window.__ui.getState().context.grasp)
  const rows = Object.fromEntries(g.diagnostics.graspSpecs.map(r => [r.id, r]))
  expect(rows['across x'].feasible, 'x across an 80 mm part with a 60 mm opening').toBe(0)
  expect(rows['across y'].feasible).toBeGreaterThan(0)
  expect(rows['too deep'].feasible, 'fingers below the table top').toBe(0)
  expect(g.diagnostics.rejectedByGrasp).toBeGreaterThan(0)
  expect(g.diagnostics.rejectedByInterference).toBeGreaterThan(0)
  expect(new Set(g.candidates.map(c => c.graspSpecId))).toEqual(new Set(['across y']))
  // The panel says it too: per-spec rows and "via <spec>" on each candidate.
  await expect(page.getByText(/by grasp spec/)).toBeVisible()
  await expect(page.getByText('via across y').first()).toBeVisible()

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})
