/**
 * SelectionOwnership.test.js — 「選択を書く入口を列挙して、所有者の外にあるものが
 * 0 個であること」を機械に問わせる (ADR-099 / 原則 #1 / 原則 #31)
 *
 * ## なぜ *在るもの* を辿る検査では足りないのか
 *
 * ADR-099 が消した欠陥は、**窓ごとに書かれた手続きの差**から生まれていた。
 * 選択できる窓は 5 つあり、どれも少しずつ違うことをしていた:
 *
 *   - ビューポート / ダブルクリック / 矩形選択 は事前に `clearObjectSelection()` を
 *     呼び、Outliner と LINK NETWORK は呼ばない
 *   - `edit → object` の mode 正規化を持っていたのは Outliner **だけ**
 *   - `_selectedIds` を書く行は `AppController` だけで 8 箇所、可視ハイライトの
 *     書き手は 3 つ
 *
 * 「今日ある 5 つの窓」を辿る検査は、次に足される 6 つ目を必ず素通りする —
 * 手続きの**欠落**は検査対象のノードを持たないからである (原則 #31)。だから
 * 検査は **「選択を書ける形」を列挙して、所有者の外にある個数を数える**形で
 * なければならない。ADR-090 (0 台) / ADR-093 (N 個) / ADR-097 (pose の入口) と
 * 同じ構図の 4 例目。
 *
 * ## 規則を足すとき
 *
 * `SELECTION_WRITE_RULES` に 1 エントリ足す。`match` は *呼び出しの形* に当たる
 * ものに保つ (コメントと散文は除去してから当てる)。
 *
 * 対象外: `*.test.js` (stub に生えたメソッドは書き手ではない)、
 * `src/view/*View.js` の `setObjectSelected` **定義**そのもの (呼び手ではない)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, stripComments, repoPath, relPath } from './census/sources.js'
import { assertDeclarationsExist } from './census/partition.js'

/** 選択という決定の唯一の入口を持つモジュール。 */
const SELECTION_ENTRY = 'src/controller/SelectionManager.js'
/** 選択集合の読み手 (getter) を持つモジュール。 */
const SELECTION_READER = 'src/controller/AppController.js'

/**
 * @typedef {object} SelectionWriteRule
 * @property {string}   name    人が読む規則名
 * @property {string[]} owners  この書き込みを書いてよい場所 (repo 相対)。空 = どこにも無いこと
 * @property {RegExp}   match   選択を書く呼び出しの形
 * @property {string}   use     違反時に案内する正しい経路
 * @property {string}   why     なぜ入口が 1 つでなければならないか
 */

/** @type {SelectionWriteRule[]} */
const SELECTION_WRITE_RULES = [
  {
    name: '選択集合への書き込み (_selectedIds の変異)',
    owners: [SELECTION_ENTRY],
    match: /_selectedIds\s*(=[^=]|\.add\s*\(|\.delete\s*\(|\.clear\s*\()/,
    use: 'selMgr.selectOnly(id) / selectMany(ids, {activeId}) / clearSelection() / activateWithinSelection(id) / forget(id)',
    why: '集合を直接触れる窓が在ると、その窓だけが可視ハイライトや文脈可視性を書き忘れる。'
       + '書き忘れた部分がそのまま症状になる — LINK NETWORK が最小の部分集合を持っていた (ADR-099 §力学 2)',
  },
  {
    name: '選択フラグへの代入 (_objSelected)',
    owners: [],
    match: /_objSelected\s*=[^=]/,
    use: '読むのは getter (`_selMgr.count > 0`)。書くのは選択集合であって、その導出値ではない',
    why: '`_objSelected` と `_selectedIds` が別々に書けたので '
       + '`_objSelected === true && _selectedIds.size === 0` が表現可能かつ到達可能だった。'
       + '導出にした今、代入は TypeError で落ちる = 不正状態が書けない (ADR-099 §基数 / 原則 #31)',
  },
  {
    name: '可視ハイライトの書き込み (meshView.setObjectSelected)',
    owners: [SELECTION_ENTRY],
    match: /meshView\s*[?]?\.\s*setObjectSelected\s*\(/,
    use: 'selMgr.selectOnly(...) — メッシュを作り直した直後なら selMgr.reassertHighlight()',
    why: '書き手が 3 つに分かれていた (直接呼び / setObjectSelected / clearObjectSelection)。'
       + '表示フラグの書き手はちょうど一箇所でなければ最後の書き込み勝ちの競合になる (原則 #4)',
  },
  {
    name: '退役した選択の入口 (_switchActiveObject)',
    owners: [],
    match: /_switchActiveObject\s*\(/,
    use: 'selMgr.selectOnly(id)',
    why: '「active を切り替える」と「選択する」が 1 つの関数に同居し、'
       + '`select` 引数で意味が変わっていた。呼び出し 12 箇所のうち 1 箇所だけが '
       + '`false` を渡しており、その窓では選べたのに何も起きなかった (ADR-099 §2)',
  },
  {
    name: '退役した選択 API (clearObjectSelection / setObjectSelected on the manager)',
    owners: [],
    match: /_selMgr\s*\.\s*(clearObjectSelection|setObjectSelected)\s*\(/,
    use: 'selMgr.clearSelection() / selectOnly(id)',
    why: '2 つ呼んで初めて 1 つの決定になる API は、片方だけ呼ぶ窓を必ず生む '
       + '(実際 `clearObjectSelection()` だけを呼ぶ経路と両方呼ぶ経路が併存していた)',
  },
  {
    name: '退役した文脈可視性の直接操作 (showFrameChain / setChildFramesVisible ほか)',
    owners: [],
    match: /\.(showFrameChain|hideFrameChain|setChildFramesVisible|showGeometryFrameTree)\s*\(/,
    use: '文脈の主張は選択から導出される — 選択を書けば claim は再計算される (selMgr._claimContext)',
    why: '「どのフレームを見せるか」を呼び出し側が決めると、選択と文脈がずれる。'
       + 'per-entity に丸ごと置換していたので、N 個選ぶと最後の 1 個の文脈しか出なかった (ADR-099 §3)',
  },
]

/**
 * 例外として選択を書いてよい場所と、その**宣言された理由**。
 *
 * 「例外が在ること」ではなく「例外が数えられていること」が要点 — 宣言されて
 * いない例外は 0 個でなければならない。今日は 1 つも無い、という 0 の宣言そのもの
 * (空欄で通すのが原則 #31 が名指しする失敗の形なので、空である旨を書いておく)。
 *
 * @type {{file: string, match: RegExp, why: string}[]}
 */
const DECLARED_EXCEPTIONS = []

/**
 * `setObjectSelected(sel) {` のような **定義**行か。view はこのメソッドを持つ
 * 実装側であって、選択を決める呼び手ではない (原則 #17 — 多態的に呼ばれる
 * メソッドは全実装型に在ること、が別に要求している)。
 */
const isMethodDefinition = line => /^\s*setObjectSelected\s*\([^)]*\)\s*\{/.test(line)

test('選択を書く入口のうち、所有者の外にあるものは 0 個 (ADR-099 / 原則 #1 / #31)', () => {
  const files = collectSources()
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  /** @type {string[]} */
  const violations = []

  for (const rule of SELECTION_WRITE_RULES) {
    const owners = new Set(rule.owners)
    for (const abs of files) {
      const rel = relPath(abs)
      if (owners.has(rel)) continue
      stripComments(readFileSync(abs, 'utf8')).forEach((line, i) => {
        if (!rule.match.test(line)) return
        if (isMethodDefinition(line)) return
        violations.push(
          `${rel}:${i + 1}\n` +
          `      規則「${rule.name}」に反する選択の書き込みがここにある。\n` +
          `      → ${rule.use}\n` +
          `      なぜ: ${rule.why}\n` +
          `      所有: ${rule.owners.length ? rule.owners.join(', ') : '(どこにも無いこと — 退役した経路)'}`,
        )
      })
    }
  }

  assert.deepEqual(violations, [], `\n${violations.join('\n\n')}\n`)
})

test('入口は実在し、5 つの verb を実際に持っている (規則が空回りしていない)', () => {
  // 対象が 0 個になったことは、規則が守られていることと区別がつかない
  // (原則 #31 の同型) — 所有者側が消えたら落とす。
  const mgr = readFileSync(repoPath(SELECTION_ENTRY), 'utf8')
  for (const needle of [
    'selectOnly(', 'selectMany(', 'clearSelection(', 'activateWithinSelection(', 'forget(',
    '_apply(',            // 唯一の遷移
    '_claimContext(',     // 文脈可視性を選択から導出する場所
    '_normalizeMode(',    // 全窓に効く mode 正規化
    'reassertHighlight(', // メッシュ再生成のための再主張 (状態は書かない)
  ]) {
    assert.ok(mgr.includes(needle), `${SELECTION_ENTRY} に ${needle} が無い — 選択の所有者が失われている`)
  }
})

test('_apply がひとつの遷移で 3 つの書き込み先すべてを書く', () => {
  // ADR-099 の欠陥は「窓ごとに部分集合」だった。所有者の中でさえ 3 つが別々の
  // メソッドに分かれていたら、同じ形が内側で再発する。
  const mgr  = readFileSync(repoPath(SELECTION_ENTRY), 'utf8')
  const body = mgr.slice(mgr.indexOf('_apply(ids, activeId'))
  const end  = body.indexOf('\n  _normalizeMode(')
  const apply = body.slice(0, end === -1 ? undefined : end)

  for (const [needle, what] of [
    ['setObjectSelected(true)',            '可視ハイライト'],
    ['_claimContext()',                    '文脈可視性の主張'],
    ['updateLinkSelectionHighlight(',      'リンク強調'],
    ['_linkNetworkView?.setSelection(',    'LINK NETWORK パネル'],
    ['this._ids = next',                   '選択集合そのもの'],
  ]) {
    assert.ok(apply.includes(needle),
      `_apply() が ${what} (${needle}) を書いていない — 遷移が分割されると窓ごとの部分集合が戻る`)
  }
})

test('_objSelected / _selectedIds は getter であって欄ではない (不正状態が書けない)', () => {
  // 基数 (0/1/N) の権威は集合ただ 1 つ。boolean が別に在ると
  // 「選択されているが 0 個」が書けてしまう — mode/status と違い、基数には
  // 欄が無いので、欄を作った瞬間にそれが第二の源になる (原則 #31)。
  const app = readFileSync(repoPath(SELECTION_READER), 'utf8')
  assert.match(app, /get _objSelected\(\)\s*\{\s*return this\._selMgr\.count > 0/,
    'AppController._objSelected が集合からの導出でなくなっている')
  assert.match(app, /get _selectedIds\(\)\s*\{\s*return this\._selMgr\.ids/,
    'AppController._selectedIds が SelectionManager の集合を指していない')
  // setter が生えたら「導出だから書けない」が嘘になる。
  assert.ok(!/set _objSelected\s*\(/.test(app), '_objSelected に setter が生えている')
  assert.ok(!/set _selectedIds\s*\(/.test(app), '_selectedIds に setter が生えている')
})

test('宣言されていない例外は 0 個 (今日の宣言は空である、という宣言)', () => {
  assertDeclarationsExist({
    what: '選択を書く例外',
    declarations: DECLARED_EXCEPTIONS.map(ex => ({ key: ex.file, why: ex.why })),
    exists: key => {
      const ex = DECLARED_EXCEPTIONS.find(e => e.file === key)
      return stripComments(readFileSync(repoPath(key), 'utf8')).some(l => ex.match.test(l))
    },
    onStale: '宣言を削るか、経路を確認すること',
  })
  assert.equal(DECLARED_EXCEPTIONS.length, 0,
    '例外が増えたのに件数の宣言が更新されていない — 例外は在ってよいが、数えられていなければならない')
})

test('パネルは選択の「写し」であって権威ではない (名前が概念を 1 つに保つ)', () => {
  // 同じ名前で違うものを指すと、grep も規則も両方を撃つ。表示側の写しは
  // イベント payload の複製 (原則 #5) なので、別の名前を持つ。
  const view = readFileSync(repoPath('src/view/LinkNetworkView.js'), 'utf8')
  assert.ok(!/this\._selectedIds/.test(view),
    'LinkNetworkView が `_selectedIds` を名乗っている — 権威 (SelectionManager._ids) と同名の写しは §1.1 違反')
  assert.ok(view.includes('this._selectionEntityIds'),
    'パネルの表示用の写しが失われている')
})
