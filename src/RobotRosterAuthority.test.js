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

/** seed を許された唯一の呼び出し元 (新規シーンを組み立てる boot 経路)。 */
const SEED_OWNER = 'src/controller/AppController.js'

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

test('ロボットを seed してよい経路はちょうど 1 つ (ADR-090 Decision 2)', () => {
  const sites   = seedCallSites()
  const seeding = sites.filter(s => s.seeds)

  assert.ok(sites.length >= 2, `ensureRobotFrames の呼び出しが見つからない (${sites.length} 件) — 検査が対象を失っている`)

  assert.deepEqual(
    seeding.map(s => `${s.rel}:${s.line}`),
    seeding.length === 1 && seeding[0].rel === SEED_OWNER ? [`${seeding[0].rel}:${seeding[0].line}`] : ['(exactly one call in ' + SEED_OWNER + ')'],
    'seed:true を渡してよいのは新規シーンを組み立てる boot 経路 1 箇所だけ。\n' +
    `見つかった seed 呼び出し: ${seeding.map(s => `${s.rel}:${s.line}  ${s.text}`).join(' | ') || '(なし)'}\n` +
    'シーン入口 (importFromJson / loadScene) で seed すると、台数の権威が scene から seed 規則へ戻り、\n' +
    'ユーザーが削除した 0 台がテンプレ読込で黙って 1 台に復活する (ADR-090 §力学(4))。',
  )

  const entrySeeds = sites.filter(s => s.seeds && s.rel === DEFINITION)
  assert.deepEqual(
    entrySeeds, [],
    'シーン入口 (SceneService の importFromJson / loadScene) は upgrade のみ — seed してはならない。',
  )
})
