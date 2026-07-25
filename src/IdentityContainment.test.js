/**
 * IdentityContainment.test.js — 導出規則の複製ガード (§1.1 の機械化)
 *
 * SSOT 違反の多くは **データ**の二重化ではなく **導出規則**の再実装として生まれる。
 * 誰もデータをコピーしていないのに、「この実体はどれか」を決める述語が呼び出し側
 * ごとに 3 行ずつ書き直され、n 箇所に増える。データの重複は grep とレビューで
 * 見えるが、導出の重複は見えない — 各箇所は単体では妥当なローカル判断だから。
 * しかも参照すべき名前付き述語が無ければ、n+1 個目のコピーが常に最小抵抗経路になる。
 *
 * 実例 (ADR-090 §力学(1)): ロボットの同一性を `name === 'robot_base' &&
 * parentId === null` の duck-type で決める規則が 4 箇所に独立実装され、2 台目が
 * 入った瞬間に 4 箇所すべてが同時に壊れる状態にあった。
 *
 * このテストは各「同一性の導出規則」に**唯一の所有モジュール**を割り当て、
 * それ以外の場所で同じ規則が再実装されていないことを検査する。
 *
 * ## 規則を足すとき
 *
 * IDENTITY_RULES に 1 エントリ足す。`match` は *inline での再導出* にだけ当たる形に
 * 保つ (名前付き述語の呼び出しには当たらないこと)。コメントと文字列 CJK 説明文は
 * 除去してから当てるので、散文中の言及では発火しない。
 *
 * 対象外: `*.test.js` (述語に食わせる fixture は規則の再実装ではなくデータ)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT  = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SRC_ROOT, '..')

/**
 * @typedef {object} IdentityRule
 * @property {string}   name      人が読む規則名
 * @property {string[]} owners    この規則を書いてよい唯一の場所 (repo 相対)
 * @property {string}   use       違反時に案内する正しい呼び出し
 * @property {RegExp[]} all       すべてに当たった行を「規則の再導出」とみなす
 * @property {string}   why       なぜ 1 箇所でなければならないか (エラーメッセージ用)
 */

/** @type {IdentityRule[]} */
const IDENTITY_RULES = [
  {
    name: 'robot_base の同一性 (名前 + 親が null)',
    owners: ['src/domain/robotFrames.js'],
    use: "isRobotBaseFrame(obj)  — import { isRobotBaseFrame } from 'src/domain/robotFrames.js'",
    all: [/ROBOT_BASE_FRAME_NAME|['"`]robot_base['"`]/, /parentId/],
    why: 'ロボットの同一性が複数箇所で決まると、2 台目が入った瞬間にすべてが同時に壊れる (ADR-090 §力学(1))',
  },
  {
    // ADR-090 で同一性を名前から実体 (`robotRole`) へ移した。移した先で同じ
    // 再実装が始まらないよう、値の解釈もドメイン 1 箇所に閉じる。
    name: 'robot TF ロールの解釈 (robotRole の値比較)',
    owners: ['src/domain/robotFrames.js'],
    use: "isRobotBaseFrame(obj) / isRobotTcpFrame(obj) / isRobotRole(v) / resolveRobots(objects)",
    all: [/robotRole/, /===\s*(ROBOT_ROLE\.|['"`](base|tcp)['"`])/],
    why: 'ロール値の解釈が散ると、語彙を増やしたときに更新漏れの箇所が黙って古い判定を続ける (ADR-090 Decision 1)',
  },
]

/** src/ 配下の .js を列挙 (テストと生成物を除く)。 */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'engine') continue   // engine/ は生成物 (wasm glue)
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) { collectSources(abs, out); continue }
    if (!entry.endsWith('.js')) continue
    if (entry.endsWith('.test.js')) continue
    out.push(abs)
  }
  return out
}

/**
 * コメントを取り除く (純粋関数)。散文の説明文で発火させないため。
 * ブロックコメントを空行に潰して行番号を保存する。
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
}

test('同一性の導出規則は所有モジュール 1 箇所にのみ存在する (§1.1)', () => {
  const files = collectSources(SRC_ROOT)
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const violations = []

  for (const rule of IDENTITY_RULES) {
    const owners = new Set(rule.owners.map(p => p.split('/').join(sep)))
    for (const abs of files) {
      const rel = relative(REPO_ROOT, abs)
      if (owners.has(rel)) continue
      const lines = stripComments(readFileSync(abs, 'utf8'))
      lines.forEach((line, i) => {
        if (rule.all.every(re => re.test(line))) {
          violations.push(
            `${rel}:${i + 1}\n` +
            `      規則「${rule.name}」がここで再導出されている。\n` +
            `      → ${rule.use} を呼ぶこと (所有: ${rule.owners.join(', ')})\n` +
            `      なぜ: ${rule.why}\n` +
            `      該当行: ${line.trim()}`
          )
        }
      })
    }
  }

  assert.deepEqual(
    violations, [],
    `同一性の導出規則が所有モジュールの外で再実装されている:\n\n` +
    violations.map(v => `  • ${v}`).join('\n\n') + '\n'
  )
})

test('所有モジュール自身は規則を実装している (ガードが空振りしていない)', () => {
  // 所有側から規則が消えた (= リネーム等でガードが検査対象を失った) ことを検出する。
  // これが無いと、規則の実装が消えたときテストは「違反ゼロ」で緑になり続ける。
  for (const rule of IDENTITY_RULES) {
    const found = rule.owners.some(owner => {
      const lines = stripComments(readFileSync(join(REPO_ROOT, owner), 'utf8'))
      return lines.some(line => rule.all.every(re => re.test(line)))
    })
    assert.ok(found, `規則「${rule.name}」が所有モジュール (${rule.owners.join(', ')}) に見つからない — ` +
      'ガードが検査対象を失っている。IDENTITY_RULES の match か owners を更新すること。')
  }
})
