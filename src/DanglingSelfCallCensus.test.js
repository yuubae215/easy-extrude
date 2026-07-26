/**
 * DanglingSelfCallCensus.test.js — 「存在しない自メソッドを呼んでいる箇所を列挙して
 * 数える」(原則 #11 / 原則 #31 / 憲法 Q3)
 *
 * ## なぜこの検査が要るのか (発見の経緯)
 *
 * ADR-098 の回帰を書いているとき、数値 Grab の `1`/`2`/`3` が
 * `this._setSnapMode(...)` — **`src/` のどこにも存在しないメソッド** — を呼んで
 * いることが判明した。押すたびに TypeError を投げ、しかも数値入力の分岐より先に
 * `return` していたので、**1・2・3 を含む距離を打つとその桁が黙って消えていた**。
 * 入力は消費されたのに何も起きない = 原則 #11 が名指しする最悪の失敗形である。
 *
 * 直したあと憲法の三問を当てたところ:
 *
 *   - **Q1 (ルールの欠落?)** — 「呼ぶメソッドは在ること」は暗黙すぎて台帳に無い。
 *   - **Q2 (パターンの反復?)** — 走査したら **同じ形が他に 4 箇所**あった。
 *     grab の入力・ファイルメニューの Save/Load・STEP インポート・pivot 選択の確定
 *     という **互いに無関係な文脈**で、根本価値 (呼び先が在ること) の違反が反復して
 *     いる = 2 例目どころか 5 例目。
 *   - **Q3 (どこで問われる?)** — どこでも問われていなかった。controller / view 層は
 *     checkJs の対象外 (`tsconfig` の include が `src/domain` 等に限られる) なので
 *     `tsc` は見ない。e2e はその経路を通ったときだけ落ちるので、通らない経路は
 *     永遠に沈黙する。**成果物は散文ではなくこの検査**である。
 *
 * ## 形 (原則 #31)
 *
 * *在るメソッド*を辿るのではなく、**`this._x(` という呼び出しの形を列挙して、
 * 定義の無い個数を数える**。呼び先の不在は検査対象のノードを持たないので、
 * 定義側を辿る検査では必ず素通りする。
 *
 * 既知の欠落は `DECLARED_GAPS` に**宣言**して数える — 「例外が在ること」ではなく
 * 「例外が数えられていること」が要点 (`PosePolicyOwnership.test.js` と同じ規律)。
 * 宣言を消し忘れないよう、**もう存在しない宣言も落とす**(逆向き検査)。
 *
 * ## 対象外
 *
 * `*.test.js` (stub は呼び先を持たなくてよい)、`src/engine/` (wasm glue = 生成物)。
 * 検査するのは `this._x(...)` のみ — private 規約 (`_` 始まり) の自メソッド呼び出しに
 * 限ることで、動的ディスパッチや外部オブジェクト経由の呼び出しを巻き込まない。
 * 実測でこの範囲の誤検出は 0 件 (下の DECLARED_GAPS はすべて実在する欠落)。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC_ROOT  = fileURLToPath(new URL('.', import.meta.url))
const REPO_ROOT = join(SRC_ROOT, '..')

/**
 * **宣言された欠落** — 実在するが本 PR の範囲外の呼び先不在。
 *
 * ADR-098 の範囲は stack assist であり、下の 4 つはそれぞれ別の機能
 * (シーンの保存/読込・STEP インポート・pivot 選択) の未実装部分である。実装は
 * 「メソッドを 1 本足す」ではなく機能の設計判断を伴うので、ここでは**直さずに
 * 数える**。隠すのではなく宣言するのは、減点を承知で数える方が数えないより強いから
 * (ADR-100 の ratchet と同じ統治の形 — 所有者・予算・削減経路)。
 *
 * 1 つ直すたびにこの表から 1 行消える。表が空になったら `DECLARED_GAPS` ごと消す。
 */
const DECLARED_GAPS = [
  {
    file: 'src/controller/AppController.js',
    method: '_saveScene',
    why: 'BFF 接続後に有効化される Save ボタンの呼び先が未実装。押すと TypeError で、保存されないことがユーザーに伝わらない (原則 #11)。シーンのシリアライズ経路は SceneService 側に在るので、繋ぐこと自体は小さいが「何を保存の単位とするか」が未決',
  },
  {
    file: 'src/controller/AppController.js',
    method: '_loadScene',
    why: '同上 (Load ボタン)。読込は既存シーンの破棄を伴うので、確認ダイアログの有無を決めてからでないと繋げない',
  },
  {
    file: 'src/controller/AppController.js',
    method: '_triggerStepImport',
    why: 'Shift+A メニューの STEP インポート項目の呼び先が未実装。ImportedMesh 実体と wasm 側の経路は在るが、ファイル選択 UI と進捗表示 (_importProgressUnsub) の接続が未了',
  },
  {
    file: 'src/controller/AppController.js',
    method: '_confirmPivotSelect',
    why: 'Grab の pivot 選択モードで左クリック確定の呼び先が未実装。cancelPivotSelect は在るので、確定側だけが欠けている (対称でない = 原則 #9 の同型)',
  },
]

/** src/ 配下の .js を列挙 (テストと生成物を除く)。 */
function collectSources(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'engine') continue   // engine/ は生成物 (wasm glue)
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) { collectSources(abs, out); continue }
    if (!/\.jsx?$/.test(entry)) continue
    if (entry.endsWith('.test.js')) continue
    out.push(abs)
  }
  return out
}

/** コメントと文字列を潰す (散文・ログ文字列中の言及で発火させない)。 */
function stripNonCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

/**
 * そのファイルが `this.` で持ちうる名前の集合。
 * メソッド定義 / コンストラクタ等での代入 / トップレベル関数 の 3 形。
 */
function definedNames(code) {
  const names = new Set()
  for (const m of code.matchAll(/^\s{2,}(?:async\s+|\*\s*|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/gm)) names.add(m[1])
  for (const m of code.matchAll(/this\.([\w$]+)\s*=/g)) names.add(m[1])
  for (const m of code.matchAll(/^\s*(?:async\s+)?function\s+([\w$]+)/gm)) names.add(m[1])
  return names
}

/** そのファイルが呼んでいる private 自メソッド名。 */
function calledSelfMethods(code) {
  const names = new Set()
  for (const m of code.matchAll(/this\.(_[\w$]+)\s*\(/g)) names.add(m[1])
  return names
}

/** @returns {{file: string, method: string}[]} 呼んでいるのに定義の無いもの */
function censusDanglingCalls() {
  const found = []
  for (const abs of collectSources(SRC_ROOT)) {
    const rel  = relative(REPO_ROOT, abs).split(sep).join('/')
    const code = stripNonCode(readFileSync(abs, 'utf8'))
    const defs = definedNames(code)
    for (const name of [...calledSelfMethods(code)].sort()) {
      if (!defs.has(name)) found.push({ file: rel, method: name })
    }
  }
  return found
}

test('存在しない自メソッドの呼び出しは、宣言されたもの以外 0 個 (原則 #11 / #31)', () => {
  const declared = new Set(DECLARED_GAPS.map(g => `${g.file}::${g.method}`))
  const undeclared = censusDanglingCalls()
    .filter(d => !declared.has(`${d.file}::${d.method}`))
    .map(d =>
      `${d.file}: this.${d.method}(...) を呼んでいるが、そのメソッドはどこにも定義されていない。\n` +
      '      → メソッドを実装するか、呼び出し側の分岐ごと削除する。\n' +
      '      なぜ: 呼んだ瞬間に TypeError で、ハンドラはそこで中断する。' +
      '入力は消費されたのに何も起きない状態になり、しかも同じキーの後続分岐 (数値入力など) へ' +
      '到達しなくなる — ADR-098 実装中に見つかった _setSnapMode がまさにこれで、' +
      '1・2・3 を含む Grab 距離が黙って桁落ちしていた (原則 #11)。\n' +
      '      直せない (別機能の未実装) なら DECLARED_GAPS に理由付きで宣言すること — ' +
      '隠すのではなく数える。')

  assert.deepEqual(undeclared, [], `\n${undeclared.join('\n\n')}\n`)
})

test('宣言された欠落は実在する — 直したら宣言も消す (逆向き)', () => {
  // 宣言が残り続けると「予算」が減らない。埋めたのに宣言が残っている状態を落とす。
  const actual = new Set(censusDanglingCalls().map(d => `${d.file}::${d.method}`))
  const stale  = DECLARED_GAPS
    .filter(g => !actual.has(`${g.file}::${g.method}`))
    .map(g => `${g.file}: 宣言された欠落 ${g.method} は既に埋まっている — DECLARED_GAPS から行を消すこと\n      理由: ${g.why}`)

  assert.deepEqual(stale, [], `\n${stale.join('\n\n')}\n`)
})

test('走査そのものが空回りしていない (母数の liveness)', () => {
  // 対象が 0 個であることは、規則が守られていることと区別がつかない (原則 #31)。
  const files = collectSources(SRC_ROOT)
  assert.ok(files.length > 50, `src/ の走査に失敗している (${files.length} files)`)

  // 実在する自メソッド呼び出しを数え、走査が本当にコードを読めていることを示す。
  const controller = stripNonCode(
    readFileSync(join(REPO_ROOT, 'src/controller/AppController.js'), 'utf8'))
  assert.ok(calledSelfMethods(controller).size > 30,
    'AppController の自メソッド呼び出しが見つからない — 正規表現が壊れている')
  assert.ok(definedNames(controller).has('_updateNPanel'),
    '既知のメソッド定義を検出できていない — 定義側の正規表現が壊れている')
})
