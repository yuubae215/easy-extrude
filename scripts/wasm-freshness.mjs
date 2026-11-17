#!/usr/bin/env node
/**
 * wasm-freshness.mjs — コミット済み WASM 成果物が、元コードとずれていないかを問う (DEF-024 を決着)
 *
 * ## なぜ必要か
 *
 * `pnpm build` は vite だけを走らせ、Rust / C++ の 2 つの WASM レーンは**コミット済みの
 * 成果物**を使う (ADR-064 Phase 1 / ADR-053 §11 — CI にツールチェーンを入れない)。その形の
 * 代償: 元コードを編集して再生成を忘れても、どの検査も落ちない。成果物は古いまま出荷される。
 *
 * ## どう問うか (当事者合意 2026-11-10: 再生成はせず、記録を照合する)
 *
 * 成果物の隣に**刻印** (`SOURCE_STAMP.json`) を置く。刻印は「この成果物はこの元コードから
 * 作った」という記録で、元コードと成果物それぞれのファイルごとの sha256 を持つ。ビルド
 * スクリプトが最後に刻む。検査は 3 つを問う:
 *
 *   Q1 SOURCES   — 元コードの集合と中身が刻印と同じか (編集して再生成を忘れた)
 *   Q2 ARTIFACTS — 成果物が刻印と同じか (成果物だけを差し替えた / 刻み忘れた)
 *   Q3 POPULATION— レーンの元コード・成果物・刻印が実在するか。**0 個は緑にしない**
 *                  (空の母集団は「全件一致」と見分けがつかない — 原則 #31)
 *
 * ## 見ないもの (推論させない)
 *
 * - **刻印が正しいこと。** 刻印は主張であって証明ではない — 元コードを変えて、再生成せずに
 *   `stamp` だけ走らせれば緑になる。防ぐのは*忘れること*で、*偽ること*ではない。
 * - **成果物が動くこと。** `test:wasm` (cargo) は今も CI に無い。`test:robotics-wasm` は
 *   成果物を読み込むだけなのでツールチェーン無しで走る。
 * - ツールチェーンの版 (同じ元コードでも rustc / emcc が変われば成果物は変わる)。
 *
 * 純粋 / 副作用の分離 (原則 #3): `compareStamp` は値 → 値。git とファイルを触るのは下段だけ。
 *
 * 使い方:
 *   node scripts/wasm-freshness.mjs            # 検査 (CI の gate)
 *   node scripts/wasm-freshness.mjs stamp wasm # 刻む (ビルドスクリプトが呼ぶ)
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const STAMP_NAME = 'SOURCE_STAMP.json'

/**
 * WASM レーン。元コードは**追跡されているファイル**を dir から導出する (列挙しない —
 * ファイルを足した日に表を直し忘れても、足されたこと自体が差分になる)。
 */
export const LANES = Object.freeze([
  {
    name: 'wasm',
    rebuild: 'pnpm build:wasm',
    sources: ['wasm-engine'],
    artifactDir: 'src/engine/wasm',
  },
  {
    name: 'robotics-wasm',
    rebuild: 'pnpm build:robotics-wasm',
    // vendor の 3 つは submodule (gitlink) — 中身ではなく固定されたコミットを刻む。
    // ビルドスクリプトはフラグを持つので元コードに数える。テストと README は成果物を変えない。
    sources: ['robotics-wasm/CMakeLists.txt', 'robotics-wasm/src', 'robotics-wasm/vendor', 'scripts/build-robotics-wasm.sh'],
    artifactDir: 'src/engine/robotics-wasm',
  },
])

/** 成果物の隣にあるが成果物ではないもの。 */
const NOT_ARTIFACTS = new Set([STAMP_NAME, '.gitignore'])

// ── 純粋 ─────────────────────────────────────────────────────────────────────

/**
 * 刻印と現在を比べる。返すのは問題の一覧 (空 = 一致)。
 *
 * @param {{sources: Record<string,string>, artifacts: Record<string,string>}|null} stamp
 * @param {{sources: Record<string,string>, artifacts: Record<string,string>}} now
 * @param {{name: string, rebuild: string}} lane
 * @returns {string[]}
 */
export function compareStamp(stamp, now, lane) {
  const problems = []
  const nSources = Object.keys(now.sources).length
  const nArtifacts = Object.keys(now.artifacts).length
  if (nSources === 0) problems.push(`Q3 POPULATION [${lane.name}]: 元コードが 0 個 — レーンの定義が実物を指していない`)
  if (nArtifacts === 0) problems.push(`Q3 POPULATION [${lane.name}]: 成果物が 0 個 — レーンの定義が実物を指していない`)
  if (!stamp) {
    problems.push(`Q3 POPULATION [${lane.name}]: 刻印 (${STAMP_NAME}) が無い — ${lane.rebuild} で再生成すれば刻まれる`)
    return problems
  }
  const diff = (was, is) => {
    const out = []
    for (const k of new Set([...Object.keys(was ?? {}), ...Object.keys(is)])) {
      if (!(k in is)) out.push(`${k} (消えた)`)
      else if (!(k in (was ?? {}))) out.push(`${k} (増えた)`)
      else if (was[k] !== is[k]) out.push(`${k} (変わった)`)
    }
    return out.sort()
  }
  const src = diff(stamp.sources, now.sources)
  if (src.length) {
    problems.push(`Q1 SOURCES [${lane.name}]: 成果物を作った後に元コードが動いた — ${src.join(', ')}。${lane.rebuild} で再生成すること (再生成が刻印を更新する)`)
  }
  const art = diff(stamp.artifacts, now.artifacts)
  if (art.length) {
    problems.push(`Q2 ARTIFACTS [${lane.name}]: 成果物が刻印と違う — ${art.join(', ')}。${lane.rebuild} を通さずに成果物が置き換わった`)
  }
  return problems
}

// ── 副作用 (git / fs) ────────────────────────────────────────────────────────

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

/** 追跡されているファイルを列挙する: [{mode, sha, path}]。 */
function tracked(paths, root) {
  const out = execFileSync('git', ['ls-files', '-s', '-z', '--', ...paths], { cwd: root, encoding: 'utf8' })
  return out.split('\0').filter(Boolean).map(line => {
    const [meta, file] = line.split('\t')
    const [mode, sha] = meta.split(' ')
    return { mode, sha, path: file }
  })
}

/** レーンの現在: 元コードと成果物のファイルごとの sha256 (作業ツリーの中身)。 */
export function snapshot(lane, root = ROOT) {
  const sources = {}
  for (const f of tracked(lane.sources, root)) {
    if (f.mode === '160000') { sources[f.path] = `gitlink:${f.sha}`; continue }
    const abs = path.join(root, f.path)
    if (fs.existsSync(abs)) sources[f.path] = sha256(fs.readFileSync(abs))
  }
  const artifacts = {}
  for (const f of tracked([lane.artifactDir], root)) {
    if (NOT_ARTIFACTS.has(path.basename(f.path))) continue
    const abs = path.join(root, f.path)
    if (fs.existsSync(abs)) artifacts[f.path] = sha256(fs.readFileSync(abs))
  }
  return { sources, artifacts }
}

const stampPath = (lane, root) => path.join(root, lane.artifactDir, STAMP_NAME)

export function readStamp(lane, root = ROOT) {
  const p = stampPath(lane, root)
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}

export function writeStamp(lane, root = ROOT) {
  const now = snapshot(lane, root)
  const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map(k => [k, o[k]]))
  const body = {
    $comment: `この成果物を作った元コードの記録。${lane.rebuild} が刻む — 手で書かない (scripts/wasm-freshness.mjs)。`,
    lane: lane.name,
    sources: sorted(now.sources),
    artifacts: sorted(now.artifacts),
  }
  fs.writeFileSync(stampPath(lane, root), JSON.stringify(body, null, 2) + '\n')
  return body
}

function main(argv) {
  const [cmd, laneName] = argv
  if (cmd === 'stamp') {
    const lanes = laneName ? LANES.filter(l => l.name === laneName) : [...LANES]
    if (lanes.length === 0) { console.error(`wasm-freshness: 未宣言のレーン "${laneName}" (${LANES.map(l => l.name).join(' / ')})`); return 1 }
    for (const lane of lanes) {
      const body = writeStamp(lane)
      console.log(`wasm-freshness: ${lane.name} を刻んだ — 元コード ${Object.keys(body.sources).length} 個 / 成果物 ${Object.keys(body.artifacts).length} 個`)
    }
    return 0
  }
  if (cmd && cmd !== 'check') { console.error(`wasm-freshness: 未知のコマンド "${cmd}" (check / stamp [lane])`); return 1 }
  const problems = LANES.flatMap(lane => compareStamp(readStamp(lane), snapshot(lane), lane))
  if (problems.length) {
    console.error(`wasm-freshness: ${problems.length} 件\n`)
    for (const p of problems) console.error(`  • ${p}`)
    return 1
  }
  const counts = LANES.map(l => { const s = snapshot(l); return `${l.name} (元コード ${Object.keys(s.sources).length} · 成果物 ${Object.keys(s.artifacts).length})` })
  console.log(`wasm-freshness: OK — ${LANES.length} レーンとも成果物は刻印どおりの元コードから作られている: ${counts.join(' / ')}`)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
