// Recorder — the impure half. Drives a real browser on VIRTUAL time: the page
// clock (Date, timers, requestAnimationFrame) advances exactly 1/fps per frame,
// so a software-rendered WebGL page that needs 900ms to draw still yields a
// perfectly smooth 30fps capture. Everything drawn on top comes from the pure
// frameState(); this file only resolves targets, presses keys and takes pictures.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { plan, frameState } from './plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const OVERLAY_SRC = readFileSync(join(here, 'overlay.browser.js'), 'utf8')
const EPOCH = Date.parse('2026-01-01T09:00:00Z')   // fixed: Date-derived UI is reproducible

const reachable = async url => { try { const r = await fetch(url); return r.status < 500 } catch { return false } }
const sleep = ms => new Promise(r => setTimeout(r, ms))

function findRepoRoot(dir) {
  // The scenario's nearest ancestor holding a pnpm/npm workspace root.
  let d = dir
  for (;;) {
    try { readFileSync(join(d, 'pnpm-workspace.yaml')); return d } catch { /* keep climbing */ }
    const up = dirname(d)
    if (up === d) return dir
    d = up
  }
}

async function ensureServer(app, baseDir, log) {
  if (await reachable(app.url)) return null
  if (!app.server) throw new Error(`${app.url} is not reachable and the scenario declares no app.server`)
  const cwd = app.server.cwd ? resolvePath(baseDir, app.server.cwd) : findRepoRoot(baseDir)
  log(`starting server: ${app.server.command} (cwd ${cwd})`)
  const child = spawn(app.server.command, { cwd, shell: true, detached: true, stdio: 'ignore' })
  const until = Date.now() + (app.server.timeoutMs ?? 90_000)
  while (Date.now() < until) {
    if (await reachable(app.url)) return child
    await sleep(500)
  }
  try { process.kill(-child.pid) } catch { /* already gone */ }
  throw new Error(`server did not answer at ${app.url} within ${app.server.timeoutMs ?? 90_000}ms`)
}

/**
 * Record a loaded scenario into a directory of frames.
 * @returns {Promise<{ frames: string[], fps: number, totalMs: number, size: {width,height} }>}
 */
export async function record({ program, actions, baseDir }, opts = {}) {
  const log = opts.log ?? (() => {})
  const fps = opts.fps ?? program.capture.fps
  const dt = 1000 / fps
  const vp = program.app.viewport
  const p = plan(program.steps, actions, program.style, opts.pace ?? program.capture.pace)
  const frameCount = Math.ceil(p.totalMs / dt) + 1
  const stills = opts.stills ? new Set(opts.stills.map(ms => Math.round(ms / dt))) : null
  const framesDir = opts.framesDir
  mkdirSync(framesDir, { recursive: true })

  const server = await ensureServer(program.app, baseDir, log)
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--font-render-hinting=none'],
  })
  try {
    const context = await browser.newContext({ viewport: vp, deviceScaleFactor: program.app.deviceScaleFactor })
    const page = await context.newPage()
    const storage = program.app.storage
    await page.addInitScript(entries => { for (const [k, v] of Object.entries(entries)) { try { localStorage.setItem(k, v) } catch { /* denied */ } } }, storage)
    await page.clock.install({ time: EPOCH })
    await page.goto(program.app.url)

    let cursor = { x: vp.width / 2, y: vp.height * 0.62 }
    const home = { ...cursor }
    const rt = {
      page,
      cursor: () => ({ ...cursor }),
      resolve: (target, origin) => resolveTarget(page, program, target, origin ?? cursor),
    }

    // Boot on virtual time: alternate real waits (network, React's scheduler,
    // which is not on the faked clock) with virtual advances until `ready`.
    const bootUntil = Date.now() + 60_000
    for (;;) {
      await sleep(40)
      await page.clock.runFor(50)
      if (!program.app.ready) break
      if (await tryResolve(page, program, program.app.ready)) break
      if (Date.now() > bootUntil) throw new Error(`app.ready never resolved: ${JSON.stringify(program.app.ready)}`)
    }
    if (program.app.css) await page.addStyleTag({ content: program.app.css })
    await page.addScriptTag({ content: OVERLAY_SRC.replace('__STYLE__', JSON.stringify(program.style)) })
    await page.mouse.move(cursor.x, cursor.y)
    await page.clock.runFor(program.app.settleMs)

    const cdp = await context.newCDPSession(page)
    const resolved = new Map()
    const begun = new Set()
    let down = null
    const frames = []
    const t0 = Date.now()

    for (let f = 0; f < frameCount; f++) {
      const t = f * dt
      for (const it of p.items) {
        if (it.start > t || begun.has(it.index)) continue
        begun.add(it.index)
        try {
          resolved.set(it.index, it.action.begin ? await it.action.begin(rt, it.step) : {})
        } catch (e) {
          throw new Error(`step ${it.step.origin.join('.')} (${it.step.do}) at ${Math.round(it.start)}ms: ${e.message}`)
        }
      }
      for (const it of p.items) {
        if (it.action.tick && begun.has(it.index) && t <= it.end) await it.action.tick(rt, it.step, resolved.get(it.index), Math.min(t - it.start, it.dur))
      }

      const state = frameState(t, p, resolved, { style: program.style, viewport: vp, home })
      const c = state.cursor
      if (c.x !== cursor.x || c.y !== cursor.y) { await page.mouse.move(c.x, c.y); cursor = { x: c.x, y: c.y } }
      const want = c.down ? (pointerButton(p, t) ?? 'left') : null
      if (want !== down) {
        if (down) await page.mouse.up({ button: down })
        if (want) await page.mouse.down({ button: want })
        down = want
      }

      await page.clock.runFor(dt)
      await page.evaluate(s => window.__screencast.render(s), state)

      if (!stills || stills.has(f)) {
        const cam = state.camera
        const shot = await cdp.send('Page.captureScreenshot', {
          format: program.capture.format, ...(program.capture.format === 'jpeg' ? { quality: 94 } : {}),
          clip: { x: cam.x, y: cam.y, width: cam.w, height: cam.h, scale: vp.width / cam.w },
          captureBeyondViewport: false,
        })
        const file = join(framesDir, `${stills ? `still-${Math.round(t)}ms` : String(f).padStart(5, '0')}.${program.capture.format === 'jpeg' ? 'jpg' : 'png'}`)
        writeFileSync(file, Buffer.from(shot.data, 'base64'))
        frames.push(file)
      }
      if (f % fps === 0) log(`frame ${f}/${frameCount - 1}  t=${(t / 1000).toFixed(1)}s  ${((Date.now() - t0) / Math.max(1, f)).toFixed(0)}ms/frame`)
    }
    if (down) await page.mouse.up({ button: down })
    return { frames, fps, totalMs: p.totalMs, size: vp, plan: p }
  } finally {
    await browser.close()
    if (server) { try { process.kill(-server.pid) } catch { /* already gone */ } }
  }
}

function pointerButton(p, t) {
  let b = null
  for (const it of p.items) if (it.action.pointer && it.start <= t) b = it.step.button ?? 'left'
  return b
}

function locatorFor(page, target) {
  let loc
  if (target.text != null) loc = (target.within ? page.locator(target.within) : page).getByText(target.text, { exact: !!target.exact })
  else if (target.role) loc = page.getByRole(target.role, target.name ? { name: target.name } : {})
  else if (target.selector && !target.canvas) loc = page.locator(target.selector)
  return loc ? loc.filter({ visible: true }).nth(target.nth ?? 0) : null
}

async function tryResolve(page, program, target) {
  try { return await resolveTarget(page, program, target, { x: 0, y: 0 }, 0) } catch { return null }
}

/** Target → viewport point (CSS px). Retries in REAL time only: the virtual clock is the plan's. */
async function resolveTarget(page, program, target, origin, patienceMs = 3000) {
  const off = target.offset ?? [0, 0]
  const vp = program.app.viewport
  const until = Date.now() + patienceMs
  for (;;) {
    let pt = null
    if (target.viewport) pt = { x: target.viewport[0] * vp.width, y: target.viewport[1] * vp.height }
    else if (target.relative) pt = { x: origin.x + target.relative[0], y: origin.y + target.relative[1] }
    else if (target.world) {
      const expr = program.app.probes.worldToScreen
      if (!expr) throw new Error('{world} target needs app.probes.worldToScreen')
      pt = await page.evaluate(([e, w]) => { const fn = (0, eval)(e); return fn(...w) }, [expr, target.world])
    } else if (target.canvas) {
      const box = await page.locator(target.selector ?? 'canvas').filter({ visible: true }).first().boundingBox()
      if (box) pt = { x: box.x + target.canvas[0] * box.width, y: box.y + target.canvas[1] * box.height }
    } else {
      const loc = locatorFor(page, target)
      const box = (await loc.count()) ? await loc.boundingBox() : null
      if (box) pt = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    if (pt) return { x: pt.x + off[0], y: pt.y + off[1] }
    if (Date.now() > until) throw new Error(`target not found: ${JSON.stringify(target)}`)
    await sleep(40)
  }
}
