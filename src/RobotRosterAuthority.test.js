/**
 * RobotRosterAuthority.test.js — 「シーンの台数を決めるのは誰か」を機械に問わせる
 * (ADR-090 Decision 2 / 原則 #31 / 核 §1.1)
 *
 * ADR-090 が潰した欠陥の片方はコードの形ではなく **権威の位置**だった:
 * `ensureRobotFrames()` が全シーン入口で「1 台へ修復」していたため、ロボットが
 * 何台在るかの真実の源が scene ではなく seed 規則にあった。ユーザーが削除した
 * 0 台は、テンプレートを読み込むだけで黙って 1 台に戻る (§力学(4))。
 *
 * この規律は散文では守られない — 「なぜかロボットが消えている」という報告に対して
 * 入口で seed を復活させるのが最短の修正に見えるからである (それは 0 台という状態を
 * 再び表現不能にする)。だから *書く瞬間に問われる場所* をここに降ろす:
 * **seed してよいのは新規シーンを組み立てる 1 経路だけ**で、シーン入口
 * (importFromJson / loadScene) は upgrade のみを行う。
 *
 * 0 台が正当な状態であること自体の検査は `src/domain/robotFrames.test.js`
 * (resolveRobots → cardinality 'none') と e2e (削除 → テンプレ読込 → 復活しない)。
 * ここはその状態を壊しうる **書き手**を数える側。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT  = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SRC_ROOT, '..')

/** 定義そのものを置くモジュール (呼び出し検査の対象外)。 */
const DEFINITION = 'src/service/SceneService.js'

function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'engine') continue
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) { collectSources(abs, out); continue }
    if (!/\.jsx?$/.test(entry)) continue
    if (entry.endsWith('.test.js')) continue
    out.push(abs)
  }
  return out
}

/** コメントを潰す (散文中の言及で発火させない)。行番号は保存する。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
}

/** `ensureRobotFrames(` の呼び出し行を集める (定義行は除く)。 */
function seedCallSites() {
  const sites = []
  for (const abs of collectSources(SRC_ROOT)) {
    const rel = relative(REPO_ROOT, abs).split(sep).join('/')
    stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
      if (!/ensureRobotFrames\s*\(/.test(line)) return
      if (rel === DEFINITION && /^\s*ensureRobotFrames\s*\(/.test(line)) return   // 定義
      sites.push({ rel, line: i + 1, text: line.trim(), seeds: /seed\s*:\s*true/.test(line) })
    })
  }
  return sites
}

test('ロボットを seed する経路は 0 個 — 台数の権威は完全に scene にある (ADR-090 / ADR-132 D5)', () => {
  const sites   = seedCallSites()
  const seeding = sites.filter(s => s.seeds)

  assert.ok(sites.length >= 2, `ensureRobotFrames の呼び出しが見つからない (${sites.length} 件) — 検査が対象を失っている`)

  // **ADR-132 で 1 → 0 になった。** ADR-090 は seed を boot 1 箇所へ絞ったが、その 1 箇所が
  // 作るロボットは `explicit:false` (ADR-096 §Decision 3 —「1 本立つアームは雑然として
  // 読める」) だった。両方とも正しく、**合わせると欠陥**である: シーンは基数 1 を保持し
  // ながら基数 0 を提示していたので、見えない実体は「在る」と「無い」の区別を持たない
  // (原則 #31 — 0 に見える 1)。0 台は ADR-090 が既に一級市民にした状態なので、boot も
  // それに従う。ロボットは Shift+A ▸ Robot で生まれ、そちらは見える (原則 #11)。
  assert.deepEqual(
    seeding.map(s => `${s.rel}:${s.line}`), [],
    'ロボットを自動生成してよい経路は無い。\n' +
    `見つかった seed 呼び出し: ${seeding.map(s => `${s.rel}:${s.line}  ${s.text}`).join(' | ') || '(なし)'}\n` +
    '入口で seed すると台数の権威が scene から seed 規則へ戻り、ユーザーが削除した 0 台が\n' +
    '黙って 1 台に復活する (ADR-090 §力学(4))。boot で seed すると、見えないまま在る 1 台に\n' +
    'なる — 基数 1 を基数 0 として提示する形 (ADR-132 D5)。どちらも scene を権威から外す。',
  )

  // 逆向き: upgrade の呼びは残っていること (規則が対象ごと消えていない = 非空虚)。
  const upgrades = sites.filter(s => !s.seeds && s.rel === DEFINITION)
  assert.ok(
    upgrades.length >= 2,
    'シーン入口 (importFromJson / loadScene) の upgrade 呼びが消えている — ' +
    'seed を消したついでに legacy 昇格まで落ちると、古い .ctx.json のロボットが役割を失う。',
  )
})
