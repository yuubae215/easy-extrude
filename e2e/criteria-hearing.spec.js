import { test, expect } from '@playwright/test'

/**
 * Criteria hearing — ADR-165 D3 / D4 (PR3), pressed in the real app.
 *
 * PR1 and PR2 each found a defect only when a person pressed the buttons
 * (R0' refused the answers; the agreement had no button on import). This
 * walks the flow the way the stakeholder described it: declare an end user,
 * answer the ratio and every expectation, open "Try it", go back and loosen
 * safety, try again — and the screen says "safety was cut, after trial 1".
 *
 * Two looks, not one: with a single trial an overwriting second trial would
 * still pass (the whiteboard's declared blind spot).
 */

const ELEMENTS = [
  ['takt', '6'], ['positionAccuracy', '0.5'], ['holdMargin', '2'], ['equipmentCost', '8000000'],
  ['maintainability', '30'], ['humanClearance', '500'], ['stoppingDistance', '100'],
]

test('the hearing is walked step by step and a change after a trial is kept', async ({ page }) => {
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  // Skip the launch Home overlay (ADR-089), as the smoke suite does.
  await page.addInitScript(() => { try { localStorage.setItem('ee_home', 'skip') } catch { /* storage denied */ } })
  await page.goto('/easy-extrude/')
  await expect(page.locator('#canvas-container canvas')).toBeVisible()

  // A blank document (the hearing writes into a document).
  await page.getByRole('button', { name: 'Start ▾' }).click()
  await page.getByText('From a context template (New Project)', { exact: true }).click()
  await page.getByRole('button', { name: /^Empty Project/ }).click()
  const replace = page.locator('button:text-is("Replace")')
  if (await replace.waitFor({ state: 'visible', timeout: 2000 }).then(() => true).catch(() => false)) await replace.click()

  // The hearing's own door (ADR-165 D3).
  await page.getByRole('button', { name: 'Start ▾' }).click()
  await page.getByText('Hear the criteria (end users)', { exact: true }).click()
  await expect(page.getByText('Who is asked?', { exact: true })).toBeVisible()
  await expect(page.getByText(/at least one person who stands as an end user/)).toBeVisible()

  // Step 1 — one end user.
  await page.getByLabel('end user name').fill('Sato')
  await page.getByLabel('job function').selectOption('ehs')
  await page.getByRole('button', { name: 'add end user' }).click()
  await expect(page.getByTestId('hearing-respondents')).toContainText('Sato')
  await page.getByRole('button', { name: 'Next →' }).click()

  // Step 2 — all four, safety included; the gate names what is blank.
  await expect(page.getByText(/still blank: D, Q, C, S/)).toBeVisible()
  for (const [c, v] of [['D', '40'], ['Q', '25'], ['C', '15'], ['S', '20']]) await page.getByLabel(`ratio ${c}`).fill(v)
  await page.getByRole('button', { name: 'Save ratio' }).click()
  await expect(page.getByText(/still blank: D, Q, C, S/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Next →' }).click()

  // Step 3 — every element as expectation + weight.
  await expect(page.getByText(/14 answers still blank/)).toBeVisible()
  for (const [k, v] of ELEMENTS) {
    await page.getByLabel(`${k} expectation`).fill(v)
    await page.getByLabel(`${k} weight`).fill('1')
  }
  await page.getByRole('button', { name: 'Save expectations' }).click()
  await expect(page.getByText(/answers still blank/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Review →' }).isVisible()
  await page.getByRole('button', { name: 'Next →' }).click()

  // Step 4 — the look is recorded.
  await expect(page.getByTestId('trial-candidates')).toContainText('recorded as trial 1')
  // Found in this run: the intake's "added in this document" list fell through
  // to the requirements for any unknown step kind and drew 7 empty cards here.
  await expect(page.getByText('added in this document', { exact: false })).toHaveCount(0)

  // Back, loosen "never touch a person", look again.
  await page.getByRole('button', { name: '← Back' }).click()
  await page.getByLabel('humanClearance expectation').fill('300')
  await page.getByRole('button', { name: 'Save expectations' }).click()
  await page.getByRole('button', { name: 'Next →' }).click()
  await expect(page.getByTestId('trial-candidates')).toContainText('recorded as trial 2')
  const history = page.getByTestId('hearing-history')
  await expect(history).toContainText('safety was cut')
  await expect(history).toContainText('after trial 1')
  await expect(history).toContainText('Never touch a person (margin) loosened (>= 500 → >= 300)')

  // Step 5 — the review names who still has to agree, and why they cannot yet press it.
  await page.getByRole('button', { name: 'Review →' }).click()
  await expect(page.getByTestId('hearing-review')).toContainText('Everything is heard')
  await expect(page.getByTestId('hearing-review')).toContainText('safety was cut')

  expect(errors).toEqual([])
})
