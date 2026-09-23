import { test, expect } from '@playwright/test'

/**
 * The TCP is the robot/gripper interface, derived from the tool mount — ADR-151.
 *
 * WHY THIS LANE: every claim here meets THREE and `SceneService` in one place.
 * `SceneService` does not construct under `node --test` (vite-only imports) and
 * `RobotStage` needs a DOM to parse its URDF, so the unit lane can prove the pure
 * pieces (`robotTool.test.js`, `robotFrames.test.js`) but not that the app routes
 * through them. The accessor `tcpState()` reads the marker's position back off
 * THREE's composed matrices, so intent alone cannot pass.
 *
 * The two positions compared are computed by INDEPENDENT paths:
 *   - `sceneTcp` — SceneService's TF composition: base ∘ flange-at-rest (the
 *     pure URDF FK in `robotics/UrdfChain.js`) ∘ the stored mount;
 *   - `marker`   — the marker RobotStage hung on `wrist_3_link` of the arm
 *     URDFLoader built, at the mount, read back from THREE.
 * They agree only if the one mount is the one source both read.
 *
 * What this cannot see (declared, not inferred): whether the marker is legible
 * (size, occlusion) — only where it stands. The preview-pose half (the marker
 * rides the arm into a candidate) needs the stub lane: grasp-stub.spec.js S12.
 */

const tcpState = (page) => page.evaluate(() => window.__easyExtrude.tcpState())
const visState = (page) => page.evaluate(() => window.__easyExtrude.visibilityState())

/** Euclidean distance between two {x,y,z} (mm). */
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
/** Sub-millimetre: both are exact compositions of the same numbers, in float32/64. */
const TOL_MM = 0.5

async function boot(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ } })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => typeof window.__easyExtrude === 'object' && window.__easyExtrude !== null))
    .toBe(true)
  return errors
}

async function addRobot(page) {
  await page.locator('#canvas-container canvas').click()
  await page.keyboard.press('Shift+A')
  await page.getByText('Robot', { exact: true }).click()
  await expect.poll(async () => (await tcpState(page)).robots.filter(r => r.marker).length).toBeGreaterThan(0)
}

function outlinerRow(page, name) {
  return page.locator('[draggable="true"]').filter({ has: page.getByText(name, { exact: true }) }).first()
}

/** 選択中の実体を数値 Grab で 1 軸だけ動かす (画面座標に依存しないジェスチャ — smoke と同じ)。 */
async function numericGrab(page, axis, distance) {
  await page.keyboard.press('g')
  await page.keyboard.press(axis)
  for (const ch of distance.toFixed(3)) {
    await page.keyboard.press(ch === '-' ? 'Minus' : ch === '.' ? 'Period' : ch)
  }
  await page.keyboard.press('Enter')
}

/** Every robot's marker stands on the scene's tcp — and the population is not empty. */
function expectMarkersOnTcp(state, expectedRobots) {
  expect(state.robots.length, 'ロボットの母集団が期待と違う — 検査が何も見ていない可能性').toBe(expectedRobots)
  for (const r of state.robots) {
    expect(r.marker, `${r.id}: TCP の印が描かれていない`).not.toBeNull()
    expect(r.sceneTcp, `${r.id}: シーンが tcp を解決できない`).not.toBeNull()
    expect(dist(r.marker, r.sceneTcp), `${r.id}: 印 ${JSON.stringify(r.marker)} とシーンの tcp ${JSON.stringify(r.sceneTcp)} が離れている`)
      .toBeLessThan(TOL_MM)
  }
}

test('the TCP marker stands where the scene composes the tcp — in both drawing styles (ADR-151 D1/D2)', async ({ page }) => {
  const errors = await boot(page)
  await addRobot(page)

  const s = await tcpState(page)
  // The census the unit lane cannot run: counted over the ROLE, so a second tcp
  // or a leftover base-relative one would show here even if it resolved to no robot.
  expect(s.tcpFrames, 'tcp ロールの実体の個数').toBe(1)
  expect(s.legacyTcpFrames, 'base 相対の旧形式 tcp が生まれた').toBe(0)
  expect(s.robots[0].mountedOn).toBe('flange')
  expect(s.robots[0].mount).toEqual({ translation: { x: 0, y: 0, z: 150 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })
  expectMarkersOnTcp(s, 1)

  // The same claim through the other geometry (ADR-149's standing toggle). The
  // marker rides whichever URDF tree is drawn, so each swap is a fresh attach.
  for (const style of ['skeleton', 'realistic', 'skeleton']) {
    await page.evaluate((st) => window.__easyExtrude.setRobotAppearance(st), style)
    expectMarkersOnTcp(await tcpState(page), 1)
  }

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('moving the robot carries the TCP — the same request twice, both times on the tool tip', async ({ page }) => {
  // The shape ADR-098 → ADR-101 taught: an input that changes every time hides a
  // one-frame-stale read. Repeat the SAME move and ask after each one.
  const errors = await boot(page)
  await addRobot(page)
  await outlinerRow(page, 'robot_base').click()

  let prev = (await tcpState(page)).robots[0]
  for (let i = 0; i < 2; i++) {
    await numericGrab(page, 'x', 300)
    await expect.poll(async () => (await tcpState(page)).robots[0].sceneTcp.x - prev.sceneTcp.x,
      { message: `move ${i + 1}: tcp did not follow its base` }).toBeCloseTo(300, 1)
    const now = await tcpState(page)
    expectMarkersOnTcp(now, 1)
    prev = now.robots[0]
  }

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the mount cannot be moved by hand yet, and every entrance says why (ADR-151 stage 1, 原則 #11)', async ({ page }) => {
  const errors = await boot(page)
  await addRobot(page)
  const before = (await tcpState(page)).robots[0]

  await outlinerRow(page, 'tcp').click()
  for (const key of ['g', 'r']) {
    await page.keyboard.press(key)
    await expect(page.getByText(/Editing the mount is not supported yet/).first(),
      `${key}: the refusal must be SAID, not swallowed`).toBeVisible()
    await page.keyboard.press('Escape')
  }
  const after = (await tcpState(page)).robots[0]
  expect(after.mount, 'the mount moved although the edit was refused').toEqual(before.mount)
  expect(dist(after.marker, before.marker)).toBeLessThan(TOL_MM)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('the tcp row mirrors its ARM — the row never says "hidden" over a drawn marker (ADR-096 G1 × ADR-151)', async ({ page }) => {
  const errors = await boot(page)
  await addRobot(page)
  const tcpRow = () => visState(page).then(v => v.find(o => o.name === 'tcp'))

  // Shown with the arm, from the moment the robot is added (the row seeds before
  // the mount exists — the ADR-132 shape, announced rather than reordered).
  await expect.poll(async () => (await tcpRow()).explicit).toBe(true)
  expect((await tcpRow()).drawn).toBe(true)

  // Its own eye moves nothing and points at the switch that does.
  const row = outlinerRow(page, 'tcp')
  await row.hover()
  await row.getByRole('button').first().click()
  await expect(page.getByText(/drawn with its arm/).first()).toBeVisible()
  expect((await tcpRow()).explicit).toBe(true)

  // The robot's eye moves both, together — one owner of the arm's pixels.
  const baseRow = outlinerRow(page, 'robot_base')
  await baseRow.hover()
  await baseRow.locator('[aria-label="Hide"]').click()
  await expect.poll(async () => (await tcpRow()).explicit).toBe(false)
  expect((await tcpRow()).drawn).toBe(false)
  await baseRow.hover()
  await baseRow.locator('[aria-label="Show"]').click()
  await expect.poll(async () => (await tcpRow()).drawn).toBe(true)

  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

/** A layout written before ADR-151: the tcp's position is the base-relative rest flange. */
function legacyLayout(robots) {
  const entities = [
    { ref: 'box', type: 'Solid', name: 'Box',
      dimensions: { x: 400, y: 400, z: 400 }, position: { x: 0, y: 0, z: 200 } },
  ]
  for (let i = 0; i < robots; i++) {
    const suffix = i === 0 ? '' : `_${i + 1}`
    entities.push(
      { ref: `rb${i}`, type: 'CoordinateFrame', name: `robot_base${suffix}`, robotRole: 'base',
        position: { x: -1500, y: 1500 - 1500 * i, z: 0 } },
      { ref: `tcp${i}`, type: 'CoordinateFrame', name: `tcp${suffix}`, robotRole: 'tcp', parentRef: `rb${i}`,
        position: { x: -716.58, y: -133.3, z: 345.56 } },
    )
  }
  return { version: 'layout/1.0', strategy: 'manual', entities }
}

for (const n of [1, 2]) {
  test(`a pre-ADR-151 file with ${n} tcp${n > 1 ? 's' : ''}: reset to the default mount and SAID so, with the count (原則 #11/#31)`, async ({ page }) => {
    // N=2 is not decoration: a count written for 1 and a loop written for 1 agree
    // at N=1 (the ADR-093/099 shape), so the message must be asked at N as well.
    const errors = await boot(page)
    const ok = await page.evaluate((dsl) => window.__easyExtrude.loadLayout(dsl), legacyLayout(n))
    expect(ok).toBe(true)

    const said = n === 1 ? /1 TCP frame from an older file was reset/ : new RegExp(`${n} TCP frames from an older file were reset`)
    await expect(page.getByText(said).first()).toBeVisible()

    await expect.poll(async () => (await tcpState(page)).robots.filter(r => r.marker).length).toBe(n)
    const s = await tcpState(page)
    expect(s.tcpFrames).toBe(n)
    expect(s.legacyTcpFrames, 'the upgrade left a base-relative tcp behind').toBe(0)
    for (const r of s.robots) {
      expect(r.mount).toEqual({ translation: { x: 0, y: 0, z: 150 }, rotation: { x: 0, y: 0, z: 0, w: 1 } })
    }
    expectMarkersOnTcp(s, n)

    expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
  })
}

test('the oldest shape — a world-parented tcp known only by name — is re-homed AND reset (ADR-085 + ADR-151)', async ({ page }) => {
  // Two upgrades meet in one entity: no roles (pre-ADR-090, name path), no parent
  // (pre-ADR-085) and a base-relative value (pre-ADR-151). The re-home must go
  // through the one re-parent entry BEFORE the mount is declared, because a
  // declared mount refuses re-parenting — this case is where that order matters.
  const errors = await boot(page)
  const dsl = {
    version: 'layout/1.0', strategy: 'manual',
    entities: [
      { ref: 'box', type: 'Solid', name: 'Box',
        dimensions: { x: 400, y: 400, z: 400 }, position: { x: 0, y: 0, z: 200 } },
      { ref: 'rb', type: 'CoordinateFrame', name: 'robot_base', position: { x: -1500, y: 1500, z: 0 } },
      { ref: 'tcp', type: 'CoordinateFrame', name: 'tcp', position: { x: -2216, y: 1366, z: 345 } },
    ],
  }
  expect(await page.evaluate((d) => window.__easyExtrude.loadLayout(d), dsl)).toBe(true)
  await expect(page.getByText(/1 TCP frame from an older file was reset/).first()).toBeVisible()
  await expect.poll(async () => (await tcpState(page)).robots.filter(r => r.marker).length).toBe(1)
  const s = await tcpState(page)
  expect(s.robots[0].tcpId, 'the tcp was not paired with its robot').not.toBeNull()
  expect(s.legacyTcpFrames).toBe(0)
  expectMarkersOnTcp(s, 1)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})

test('a current file is NOT announced — 0 resets is a silent, legitimate 0', async ({ page }) => {
  const errors = await boot(page)
  const dsl = legacyLayout(1)
  dsl.entities[2] = { ...dsl.entities[2], mountedOn: 'flange', position: { x: 0, y: 0, z: 180 } }
  expect(await page.evaluate((d) => window.__easyExtrude.loadLayout(d), dsl)).toBe(true)
  await expect.poll(async () => (await tcpState(page)).robots.filter(r => r.marker).length).toBe(1)
  const s = await tcpState(page)
  // The DECLARED mount survived the load — it was not mistaken for a legacy value.
  expect(s.robots[0].mount.translation).toEqual({ x: 0, y: 0, z: 180 })
  await expect(page.getByText(/from an older file/)).toHaveCount(0)
  expectMarkersOnTcp(s, 1)
  expect(errors, `unexpected page errors: ${errors.join(' | ')}`).toEqual([])
})
