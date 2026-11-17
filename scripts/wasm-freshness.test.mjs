/**
 * wasm-freshness の問い方そのものを問う — 検査が空回りしていないこと (変異で落ちること)。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { compareStamp, snapshot, writeStamp, readStamp, LANES, STAMP_NAME } from './wasm-freshness.mjs'

const lane = { name: 'demo', rebuild: 'pnpm build:demo' }
const now = { sources: { 'a.rs': '1', 'b.rs': '2' }, artifacts: { 'out.wasm': '9' } }

test('一致していれば問題は 0 件', () => {
  assert.deepEqual(compareStamp({ ...now }, now, lane), [])
})

test('元コードが変わった・増えた・消えた — どれも名指しで落ち、再生成の手順を言う', () => {
  const p = compareStamp({ sources: { 'a.rs': '0', 'gone.rs': '3' }, artifacts: now.artifacts }, now, lane)
  assert.equal(p.length, 1)
  assert.match(p[0], /Q1 SOURCES \[demo\]/)
  assert.match(p[0], /a\.rs \(変わった\)/)
  assert.match(p[0], /b\.rs \(増えた\)/)
  assert.match(p[0], /gone\.rs \(消えた\)/)
  assert.match(p[0], /pnpm build:demo/)
})

test('成果物だけが置き換わった', () => {
  const p = compareStamp({ sources: now.sources, artifacts: { 'out.wasm': '8' } }, now, lane)
  assert.equal(p.length, 1)
  assert.match(p[0], /Q2 ARTIFACTS \[demo\].*out\.wasm \(変わった\)/)
})

test('0 個は緑にしない — 刻印なし・元コード 0 個・成果物 0 個はそれぞれ落ちる (原則 #31)', () => {
  assert.match(compareStamp(null, now, lane).join('\n'), /刻印 .* が無い/)
  const empty = compareStamp({ sources: {}, artifacts: {} }, { sources: {}, artifacts: {} }, lane)
  assert.equal(empty.length, 2)
  assert.match(empty.join('\n'), /元コードが 0 個/)
  assert.match(empty.join('\n'), /成果物が 0 個/)
})

test('実物で往復: 刻む → 一致 → 元コードを 1 文字変える → 落ちる → 成果物を変える → 落ちる', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wasm-fresh-'))
  const git = (...a) => execFileSync('git', a, { cwd: root, stdio: 'pipe' })
  git('init', '-q')
  fs.mkdirSync(path.join(root, 'eng/src'), { recursive: true })
  fs.mkdirSync(path.join(root, 'out'), { recursive: true })
  fs.writeFileSync(path.join(root, 'eng/src/lib.rs'), 'fn a() {}\n')
  fs.writeFileSync(path.join(root, 'out/x.wasm'), 'BIN')
  fs.writeFileSync(path.join(root, 'out/.gitignore'), '# kept\n')
  git('add', '-A')
  const l = { name: 'tmp', rebuild: 'rebuild', sources: ['eng'], artifactDir: 'out' }
  writeStamp(l, root)
  git('add', '-A')
  assert.deepEqual(Object.keys(readStamp(l, root).artifacts), ['out/x.wasm'], '刻印自身と .gitignore は成果物に数えない')
  assert.deepEqual(compareStamp(readStamp(l, root), snapshot(l, root), l), [])

  fs.writeFileSync(path.join(root, 'eng/src/lib.rs'), 'fn b() {}\n')   // 未コミットの編集も見える
  assert.match(compareStamp(readStamp(l, root), snapshot(l, root), l).join('\n'), /Q1 SOURCES.*eng\/src\/lib\.rs \(変わった\)/)
  fs.writeFileSync(path.join(root, 'eng/src/lib.rs'), 'fn a() {}\n')

  fs.writeFileSync(path.join(root, 'eng/src/new.rs'), '')
  git('add', '-A')
  assert.match(compareStamp(readStamp(l, root), snapshot(l, root), l).join('\n'), /new\.rs \(増えた\)/, '表を直さなくても、足したこと自体が差分になる')
  git('rm', '-q', '-f', 'eng/src/new.rs')

  fs.writeFileSync(path.join(root, 'out/x.wasm'), 'BIN2')
  assert.match(compareStamp(readStamp(l, root), snapshot(l, root), l).join('\n'), /Q2 ARTIFACTS.*out\/x\.wasm/)
  fs.rmSync(root, { recursive: true, force: true })
})

test('このリポジトリの 2 レーンは刻印どおり (CI の gate と同じ問い)', () => {
  assert.equal(LANES.length, 2)
  for (const l of LANES) {
    const s = snapshot(l)
    assert.ok(Object.keys(s.sources).length > 0, `${l.name}: 元コード`)
    assert.ok(Object.keys(s.artifacts).some(f => f.endsWith('.wasm')), `${l.name}: .wasm が成果物に在る`)
    assert.deepEqual(compareStamp(readStamp(l), s, l), [], `${l.name} (${STAMP_NAME})`)
  }
})
