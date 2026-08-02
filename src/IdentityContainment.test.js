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
import { readFileSync } from 'node:fs'
import { collectSources, stripComments, relPath, repoPath } from './census/sources.js'

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
  {
    // ADR-094 §波及 が先行 PR として名指しした未移行分。ADR-090 が robot_base に対して
    // 閉じた欠陥 (同一性を呼び出し側で再導出する) が、Origin CF では 16 箇所 / 10 ファイルに
    // 残っていた。robot 規則と違い `all` が 1 本なのは、この名前には**正当な住所が
    // ちょうど一つ**しか無いため — 生成の種名も判定規則も同じ ORIGIN_FRAME_NAME に
    // 集約したので、src/ の他のどこかにリテラルが現れること自体が再導出のサイン。
    // 散文中の 'Origin frame cannot be…' 等はクォートが隣接しないので当たらない。
    name: 'Origin CF の同一性 (Solid の body frame の名前)',
    owners: ['src/domain/originFrame.js'],
    use: "isOriginFrame(obj) / findOriginFrame(objects, parentId) / ORIGIN_FRAME_NAME  — import from 'src/domain/originFrame.js'",
    all: [/['"`]Origin['"`]/],
    why: 'body frame の判定が散ると、Origin の扱いを一つ変えるたび 16 箇所を同時に直す必要が生まれ、漏れた箇所は黙って古い規則で編集ロックを外す (ADR-037 §4 / ADR-094 §波及)',
  },
  {
    // ADR-104 D2。所有者の **0 は 2 種類ある** — 宣言済みの 0 (正当) と未宣言の 0
    // (「本当にいない」「名乗り忘れ」「チキンレース」が潰れたもの)。値としては
    // どちらも「actor 名が無い」に見えるので、比較を呼び出し側で書き直すと、
    // いつか片方だけを見た判定が生まれる。それは落ちずに *片方の 0 を黙って
    // もう片方として扱う* ので、原則 #31 が名指しする「0 は状態に見えない」形。
    name: '所有者の 2 種類の 0 (未宣言 / 宣言済みの none)',
    owners: ['src/context/Ownership.js'],
    use: "isOwnerUndeclared(owner) / isOwnerlessDeclared(owner)  — import from 'src/context/Ownership.js'",
    all: [/owner/i, /[!=]==\s*(undefined|OWNER_NONE_DECLARED|['"`]none['"`])/],
    why: '未宣言の 0 と宣言済みの 0 を取り違えると、「誰も名乗っていない」が「誰のものでもない」として直接編集可になり、他人の主張が黙って書き換わる (ADR-104 D2)',
  },
  {
    // ADR-104 D3。「鍵を持っているか」の判定は権限そのもの。呼び出し側で
    // keys.has(owner) を書き直すと判定は複製できるが、**理由**は複製されない —
    // 無効フラグとその理由は同じ述語の返り値から来る必要がある (原則 #11)。
    name: '編集権限の判定 (鍵 × 所有者)',
    // 2 箇所あるのは階層が違うため: 鍵集合の素の所属判定は Keyring が持ち、
    // それを「編集できるか + 理由」へ翻訳するのは Ownership が持つ。
    owners: ['src/context/Ownership.js', 'src/context/Keyring.js'],
    use: "editPermission(keyring, ctx, target) → { permission, reason } / hasKey(keyring, actorRef)",
    all: [/keys?(?:ring)?\.(?:has|includes)\s*\(/, /owner/i],
    why: '判定だけ複製すると理由が失われ、無効化された操作が「押せないが why が言えない」状態になる。ADR-065 の disabled-as-quest はそこで壊れる',
  },
  {
    // ADR-104 U2。「この提案は古びているか」は *保存しない* と決めた導出値なので、
    // 導出規則そのものが唯一の住所になる。散ると「4 つ目の状態」が事実上復活する。
    name: '提案の陳腐化判定 (from === 現在値)',
    owners: ['src/context/Proposal.js'],
    use: "isStale(ctx, proposal) / approvalGuards(ctx, proposal, keyring)  — import from 'src/context/Proposal.js'",
    // `from` を **現在値と** 比べる形だけを狙う。`from` と `to` を比べる形
    // (差分の有無 — R11) は別の問いなので当てない。
    all: [/\.from\b/, /readClaim\s*\(/],
    why: '陳腐化を各所で導出し直すと、比較の仕方が場所ごとにずれ、「まだ有効な提案」と「古い提案」の境界が呼び出し側の数だけ生まれる (ADR-104 U2)',
  },
]

test('同一性の導出規則は所有モジュール 1 箇所にのみ存在する (§1.1)', () => {
  const files = collectSources({ jsx: false })
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const violations = []

  for (const rule of IDENTITY_RULES) {
    const owners = new Set(rule.owners)
    for (const abs of files) {
      const rel = relPath(abs)
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
      const lines = stripComments(readFileSync(repoPath(owner), 'utf8'))
      return lines.some(line => rule.all.every(re => re.test(line)))
    })
    assert.ok(found, `規則「${rule.name}」が所有モジュール (${rule.owners.join(', ')}) に見つからない — ` +
      'ガードが検査対象を失っている。IDENTITY_RULES の match か owners を更新すること。')
  }
})
