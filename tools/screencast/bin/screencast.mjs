#!/usr/bin/env node
// screencast — record a declarative scenario (screencast/1.0) to GIF/MP4/WebM.
//
//   screencast validate <scenario.json>             shape + macro expansion + plugin payloads
//   screencast plan     <scenario.json>             print the (pure) timeline, no browser
//   screencast record   <scenario.json> [options]   render frames on virtual time, encode outputs
//
// record options:
//   --stills 1200,3400   capture only these instants (ms) as PNGs — fast design review
//   --fps N  --pace X    override capture.fps / capture.pace
//   --frames-dir DIR     where frames go (default: a fresh temp dir)
//   --keep-frames        do not delete the frames after encoding
//   --only gif|mp4|webm  encode just one output lane
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadScenario } from '../src/load.mjs'
import { plan } from '../src/plan.mjs'

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    stills: { type: 'string' }, fps: { type: 'string' }, pace: { type: 'string' },
    'frames-dir': { type: 'string' }, 'keep-frames': { type: 'boolean' }, only: { type: 'string' },
  },
})
const [cmd, file] = positionals
const log = msg => process.stderr.write(`[screencast] ${msg}\n`)

if (!cmd || !file || !['validate', 'plan', 'record'].includes(cmd)) {
  console.error('usage: screencast <validate|plan|record> <scenario.json> [--stills ms,ms] [--fps N] [--pace X] [--frames-dir DIR] [--keep-frames] [--only FORMAT]')
  process.exit(2)
}

try {
  const loaded = await loadScenario(file)
  const { program, actions, baseDir } = loaded
  const pace = o.pace ? Number(o.pace) : program.capture.pace
  const p = plan(program.steps, actions, program.style, pace)

  if (cmd === 'validate') {
    console.log(`ok  ${program.meta.id}: ${program.steps.length} steps, ${(p.totalMs / 1000).toFixed(2)}s`)
  } else if (cmd === 'plan') {
    console.log(`${program.meta.id} — ${(p.totalMs / 1000).toFixed(2)}s @ ${program.capture.fps}fps (pace ${pace})`)
    for (const it of p.items) {
      const s = it.step
      const what = s.text === null ? '(clear)' : s.text ?? s.keys ?? s.macro ?? JSON.stringify(s.target ?? s.to ?? s.zoom ?? s.duration ?? '')
      console.log(`${String(it.start).padStart(6)}ms ${String(it.dur).padStart(5)}ms ${(s.async ?? it.action.async) ? '∥' : '→'} ${s.do.padEnd(8)} ${what}   [${s.origin.join('.')}]`)
    }
  } else {
    const framesDir = o['frames-dir'] ? resolve(o['frames-dir']) : mkdtempSync(join(tmpdir(), `screencast-${program.meta.id}-`))
    const stills = o.stills ? o.stills.split(',').map(Number) : null
    const t0 = Date.now()
    const res = await record(loaded, { framesDir, stills, fps: o.fps ? Number(o.fps) : undefined, pace, log })
    log(`captured ${res.frames.length} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${framesDir}`)
    if (stills) {
      res.frames.forEach(f => console.log(f))
    } else {
      const outputs = program.outputs
        .filter(out => !o.only || out.format === o.only)
        .map(out => ({ ...out, path: resolve(baseDir, out.path) }))
      const ext = program.capture.format === 'jpeg' ? 'jpg' : 'png'
      const { encode } = await import('../src/encode.mjs')
      encode(outputs, { framesDir, ext, fps: res.fps, srcWidth: res.size.width }, log)
      if (!o['keep-frames'] && !o['frames-dir']) rmSync(framesDir, { recursive: true, force: true })
    }
  }
} catch (e) {
  console.error(`screencast: ${e.message}`)
  process.exit(1)
}

async function record(loaded, opts) {
  const { record: rec } = await import('../src/runner.mjs')
  return rec(loaded, opts)
}
