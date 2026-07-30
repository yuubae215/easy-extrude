/**
 * census/sources.js — 列挙検査 (原則 #31) が母集団を数えるための primitives。
 *
 * この modules は**検査の道具**であって検査対象ではない。`collectSources()` が
 * `src/census/` 自身を除くのはそのため — 道具が母集団に入ると、規則の *説明* が
 * 規則違反として数えられる (`engine/` を除くのと同じ理由)。
 *
 * ## なぜ 1 箇所に集めたか (§1.1)
 *
 * `collectSources` / `stripComments` は 6 つの census ファイルに写しで存在して
 * いた。走査の対象範囲が第二の源を持つと、ある検査だけが `.jsx` を見ていない・
 * ある検査だけが生成物を数える、といったズレが**検査の側**に生まれる。
 * 「数える道具が数え漏らす」のは、この PR (ADR-102) が閉じている欠陥そのもの。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** `src/` の絶対パス。 */
export const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url))
/** repo ルートの絶対パス。 */
export const REPO_ROOT = join(SRC_ROOT, '..')

/** repo 相対パスを OS 依存の絶対パスへ (`'src/a/b.js'` 形式を受ける)。 */
export const repoPath = rel => join(REPO_ROOT, rel.split('/').join(sep))

/** 絶対パスを `'src/a/b.js'` 形式へ (OS 非依存)。 */
export const relPath = abs => relative(REPO_ROOT, abs).split(sep).join('/')

/**
 * `src/**` のソースを列挙する (検査の母集団)。
 *
 * 除外と理由:
 *   - `*.test.js`  — 検査そのもの。stub は書き手ではない
 *   - `src/engine/` — wasm glue = 生成物
 *   - `src/census/` — 検査の道具 (この module 群)
 *
 * @param {object} [opts]
 * @param {boolean} [opts.jsx=true]  `.jsx` を含めるか
 * @returns {string[]} 絶対パス
 */
export function collectSources({ jsx = true } = {}) {
  const out = []
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'engine' || entry === 'census') continue
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) { walk(abs); continue }
      if (entry.endsWith('.test.js')) continue
      if (!(jsx ? /\.jsx?$/ : /\.js$/).test(entry)) continue
      out.push(abs)
    }
  }
  walk(SRC_ROOT)
  return out
}

/** `src/**` の test ファイルを列挙する。 */
export function collectTests() {
  const out = []
  const walk = dir => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === 'engine') continue
      const abs = join(dir, entry)
      if (statSync(abs).isDirectory()) { walk(abs); continue }
      if (entry.endsWith('.test.js')) out.push(abs)
    }
  }
  walk(SRC_ROOT)
  return out
}

/**
 * コメントを潰す (散文中の言及で発火させない)。**行番号は保存する。**
 * @param {string} source
 * @returns {string[]} 行の配列
 */
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map(line => line.replace(/\/\/.*$/, ''))
}

/** 行番号を保存せずコメントだけ落とした 1 本の文字列 (走査用)。 */
export const stripCommentsFlat = source => stripComments(source).join('\n')

/**
 * クラスメソッドを本体ごと切り出す。検査の単位をファイルより狭く・行より広く
 * 取るための道具 — ファイル全体では広すぎ (無関係な正当形を巻き込む)、1 行では
 * 狭すぎる (分岐は複数行に散る)。
 *
 * インデント 2 の `name(` から次の同レベル `}` まで。
 *
 * @param {string} source  ファイルの中身 (コメント除去前でよい)
 * @returns {Map<string, {name: string, start: number, body: string[]}>} 最初の定義を採る
 */
export function methodsOf(source) {
  const lines = stripComments(source)
  const methods = new Map()
  let cur = null
  lines.forEach((line, i) => {
    const m = /^ {2}(?:async\s+|\*\s*|get\s+|set\s+)?([A-Za-z_$][\w$]*)\s*\(/.exec(line)
    if (m) {
      cur = { name: m[1], start: i, body: [line] }
      if (!methods.has(m[1])) methods.set(m[1], cur)
      return
    }
    if (cur) cur.body.push(line)
  })
  return methods
}

/**
 * 1 本のメソッド本体を切り出す (`methodsOf` の単発版・行番号つき)。
 * @param {string[]} lines  stripComments 済みの行
 * @param {string} method
 * @returns {{start: number, body: string[]}|null}
 */
export function extractMethodBody(lines, method) {
  const head = new RegExp(`^ {2}${method}\\s*\\(`)
  const start = lines.findIndex(l => head.test(l))
  if (start === -1) return null
  let end = start + 1
  while (end < lines.length && lines[end].trimEnd() !== '  }') end++
  return { start, body: lines.slice(start, Math.min(end + 1, lines.length)) }
}

/**
 * **呼び出し閉包** — ある入口から `this._x()` 辺を辿って到達できるメソッド集合。
 *
 * 原則 #31 の道具にとってこれが要 (ADR-102): 「pose を決める側のメソッド」を
 * *手で並べる* と、8 つ目が足された日に表が黙って古びる。閉包は**コードから
 * 導出される**ので、新しいメソッドが入口から呼ばれた瞬間に母集団へ入る。
 * 呼ばれなくなれば出る。人の記憶が母集団の権威でなくなることが要点。
 *
 * 同一ファイル内の `this.` 呼び出しのみを辺とする (動的ディスパッチや他
 * オブジェクト経由は辿らない — 広げると母集団がファイル全体に膨らみ、
 * 「無視される規則」になる)。
 *
 * @param {Map<string, {body: string[]}>} methods  `methodsOf()` の結果
 * @param {string} entry  入口のメソッド名
 * @returns {Set<string>} 入口自身を含む到達集合
 */
export function callClosure(methods, entry) {
  const seen = new Set()
  const stack = [entry]
  while (stack.length) {
    const name = stack.pop()
    if (seen.has(name) || !methods.has(name)) continue
    seen.add(name)
    for (const line of methods.get(name).body) {
      for (const m of line.matchAll(/this\.(_?[A-Za-z][\w$]*)\s*\(/g)) {
        if (!seen.has(m[1])) stack.push(m[1])
      }
    }
  }
  return seen
}

export { readFileSync }
