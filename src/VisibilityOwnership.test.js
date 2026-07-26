/**
 * VisibilityOwnership.test.js — 「可視性のピクセルを書くのは 1 箇所」の機械化 (ADR-096)
 *
 * ADR-096 が消したのは *機能* ではなく **書き手の重複**である。CF 軸の可視性には
 * `meshView.showFull()/showDimmed()/hide()/setParentSelected()` という 4 つの公開扉が
 * あり、どれも Outliner の eye を読まずに同じピクセルへ書けた。結果:
 *
 *   - 起動直後、`tcp` の行は eye が開いているのに軸は描かれない (行は種の既定値)
 *   - その eye を 1 回押しても何も起きない (既に非表示のものを非表示にする — 原則 #11)
 *   - eye を開けても、別の実体を選択した瞬間に軸が消え、eye は開いたまま残る
 *
 * 散文で「直接叩かないこと」と書いても、n+1 個目の呼び出しは常に最小抵抗経路になる
 * (IdentityContainment.test.js と同じ構図 — 導出/権限の重複はレビューで見えない)。
 * よってここで**書く瞬間に問う**: 合成に触れてよいファイルを列挙し、それ以外での
 * 呼び出しを落とす。
 *
 * 対象外: `*.test.js` (stub に生えたメソッドは書き手ではない)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT  = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SRC_ROOT, '..')

/**
 * @typedef {object} OwnershipRule
 * @property {string}   name    人が読む規則名
 * @property {string[]} owners  この呼び出しを書いてよい唯一の場所 (repo 相対)。空 = どこにも無いこと
 * @property {RegExp}   match   違反とみなす呼び出しの形
 * @property {string}   use     違反時に案内する正しい経路
 * @property {string}   why     なぜ 1 箇所でなければならないか
 */

/** @type {OwnershipRule[]} */
const OWNERSHIP_RULES = [
  {
    name: '合成の適用 (meshView.applyVisibility)',
    // 定義側 (CoordinateFrameView) は自分の lifecycle primitive `setVisible` から
    // 自メソッドを呼ぶので所有側に含める — 呼び手ではなく実装。
    owners: ['src/service/SceneService.js', 'src/view/CoordinateFrameView.js'],
    match: /\.applyVisibility\s*\(/,
    use: 'SceneService.setExplicitVisible(id, v) / setContextualFrames(map) — 軸を書き、合成は所有者に任せる',
    why: '2 軸の合成が複数箇所にあると、片方の軸しか読まない経路が生まれ、eye と描画がずれる (ADR-096 §Decision 2 / 原則 #4)',
  },
  {
    name: '退役した可視性の扉 (showFull / showDimmed / setParentSelected)',
    owners: [],
    match: /\.(showFull|showDimmed|setParentSelected)\s*\(/,
    use: 'SceneService.setContextualFrames(map) に「どのフレームをどの強さで見せたいか」を渡す',
    why: '扉が 4 つあったこと自体が欠陥だった。1 つでも残すと、eye を読まない経路がそこから戻る (ADR-096)',
  },
  {
    name: '文脈軸の書き込み (_contextualFrames への代入)',
    owners: ['src/service/SceneService.js'],
    match: /_contextualFrames\s*(=|\.set\(|\.delete\(|\.clear\()/,
    use: 'SceneService.setContextualFrames(map) — 丸ごと置換だけを入口にする',
    why: '個別の追加・削除を許すと「文脈から外れたのに消し忘れた 1 個」が書けてしまう。丸ごと置換はその状態を表現不能にする (ADR-096 §Decision 2)',
  },
  {
    name: '明示軸の書き込み (_explicitVisible への代入)',
    owners: ['src/service/SceneService.js'],
    match: /_explicitVisible\s*(=|\.set\()/,
    use: 'SceneService.setExplicitVisible(id, v) / declareExplicitVisible(obj, entry)',
    why: 'eye が語る値の権威は 1 箇所。行や skeleton が自前の写しを持つと、起動直後から食い違う (ADR-096 §G1)',
  },
  {
    name: 'ブート時にロボットを伏せる手続き (_hideRobotByDefault)',
    owners: [],
    match: /_hideRobotByDefault/,
    use: "SceneService.addRobot({ entry: VISIBILITY_ENTRY.SEED }) — 既定は入口で宣言する",
    why: '手続きは対象を列挙して回るので、列挙から漏れたもの (tcp) を黙って取りこぼす。宣言は漏れようがない (ADR-096 §Decision 3/4)',
  },
]

/** src/ 配下の .js を列挙 (テストと生成物を除く)。 */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'engine') continue   // engine/ は生成物 (wasm glue)
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) { collectSources(abs, out); continue }
    if (!entry.endsWith('.js') && !entry.endsWith('.jsx')) continue
    if (entry.endsWith('.test.js')) continue
    out.push(abs)
  }
  return out
}

/** コメントを取り除く (純粋関数)。散文の説明で発火させないため。行番号は保存する。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
}

test('可視性のピクセルを書くのは合成 1 箇所だけ (ADR-096 / 原則 #4)', () => {
  const files = collectSources(SRC_ROOT)
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const violations = []

  for (const rule of OWNERSHIP_RULES) {
    const owners = new Set(rule.owners.map(p => p.split('/').join(sep)))
    for (const abs of files) {
      const rel = relative(REPO_ROOT, abs)
      if (owners.has(rel)) continue
      stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
        if (!rule.match.test(line)) return
        violations.push(
          `${rel}:${i + 1}\n` +
          `      規則「${rule.name}」に反する書き込みがここにある。\n` +
          `      → ${rule.use}\n` +
          `      なぜ: ${rule.why}\n` +
          `      所有: ${rule.owners.length ? rule.owners.join(', ') : '(どこにも無いこと — 退役した経路)'}`,
        )
      })
    }
  }

  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('合成の所有者は実在し、両方の軸を読んでいる', () => {
  // 所有者が消えた / 名前が変わったときに、上のルールが「誰も違反していない」で
  // 空回りするのを防ぐ (規則の対象が 0 個になったことは、規則が守られていることと
  // 区別がつかない — 原則 #31 の同型)。
  const svc = readFileSync(join(REPO_ROOT, 'src/service/SceneService.js'), 'utf8')
  for (const needle of [
    'applyEntityVisibility(',
    'composeVisibility(',
    'setContextualFrames(',
    'setExplicitVisible(',
    'declareExplicitVisible(',
  ]) {
    assert.ok(svc.includes(needle), `SceneService に ${needle} が無い — 合成の所有者が失われている`)
  }
})

test('可視性はワイヤに載らない — シリアライザに explicit 軸が現れない (原則 #29)', () => {
  // ADR-096 は「往復させない」を**決めた**。決めたことが黙って崩れるのを落とす:
  // presentation 状態が scene JSON に生え始めたら、それは別 ADR で行う版上げ行為
  // であって、フィールドが 1 つ増える偶発ではない。
  const ser = readFileSync(join(REPO_ROOT, 'src/service/SceneSerializer.js'), 'utf8')
  for (const needle of ['explicitVisible', 'contextualFrames', 'applyEntityVisibility']) {
    assert.ok(!ser.includes(needle),
      `SceneSerializer に ${needle} が現れた — セッション内の presentation 状態をワイヤに載せない (ADR-096 §Consequences)`)
  }
})

test('Outliner の行は eye の初期値を自分で決めない (ADR-096 §G1)', () => {
  // 行の `visible: true` が「誰も何も言っていない」と「見せろと言われた」を
  // 区別できなかったのが、起動直後に行が嘘をついた原因 (原則 #31)。
  const store = readFileSync(join(REPO_ROOT, 'src/store/uiStore.js'), 'utf8')
  const addItem = store.slice(store.indexOf('outlinerAddItem:'))
  const body = addItem.slice(0, addItem.indexOf('outlinerRemoveItem:'))
  assert.ok(
    /outlinerAddItem:\s*\(id,\s*name,\s*type,\s*parentId,\s*visible\)/.test(body),
    'outlinerAddItem は visible を引数で受け取ること (行が自分で種を持たない)',
  )
  assert.ok(
    !/visible:\s*true/.test(body),
    'outlinerAddItem に `visible: true` の直書きが戻っている — 宣言されていない既定は ADR-096 が消した欠陥そのもの',
  )
})
