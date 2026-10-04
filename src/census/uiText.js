/**
 * census/uiText.js — 「画面に出うる文字列」から開発者向けの散文を落とす道具
 * (ADR-161 — UI の言語は英語)。
 *
 * `stripComments` (sources.js) は行単位の正規表現で、文字列中の `//`
 * (`'https://…'`) を見ると行の残りを落とす。言語の検査では落とした残りに
 * UI 文言が居るかもしれないので、ここでは**文字列を知っている**字句走査で
 * コメントを潰す。行番号は保存する (空白で置き換える)。
 *
 * 画面に出ない散文は 2 種だけ、**構文で**落とす:
 *
 *   - `throw new X(…)` / `…Error(…)` の引数 — 開発者向けの文 (原則 #11 の文面は
 *     ユーザーへの提示ではなく、宣言漏れを書き手に知らせるもの)
 *   - `why:` の値 — 宣言表の設計理由。ユーザーに見せる理由は `reason` 等
 *     別の鍵で運ぶ (`why` を描く経路は `EntityScopeChecks` のみで、そこは英語)
 *
 * それ以外の鍵や呼び出しを「散文だから」と落とす経路は持たない — 落とす側の
 * 語彙が増えるほど、UI 文言が散文の顔をして素通りする。
 */

/** 日本語の文字 (かな・CJK 統合漢字・CJK 記号・全角形)。 */
export const JAPANESE = /[　-ヿ㐀-鿿＀-￯]/

/** 正規表現リテラルが始まりうる直前の文字 (それ以外の `/` は除算)。 */
const REGEX_PRECEDER = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '<', '>', '~', '^'])

const blank = s => s.replace(/[^\n]/g, ' ')

/**
 * 文字列・テンプレート・正規表現を知っている走査でコメントを空白に潰す。
 * `'` / `"` の文字列は行を跨がない (JSX テキストの `Don't` が次の行まで
 * 文字列を延ばす誤読を 1 行で止める)。
 *
 * @param {string} src
 * @returns {string} 同じ長さ・同じ改行位置の文字列
 */
export function blankComments(src) {
  let out = ''
  let i = 0
  let prev = ''          // 直前の非空白の文字 (正規表現の判定用)
  const n = src.length
  const readString = (q) => {
    let j = i + 1
    while (j < n && src[j] !== q && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1
    return Math.min(j + 1, n)
  }
  const readTemplate = (from) => {
    let j = from + 1
    while (j < n && src[j] !== '`') {
      if (src[j] === '\\') { j += 2; continue }
      if (src[j] === '$' && src[j + 1] === '{') {
        let depth = 1
        j += 2
        while (j < n && depth > 0) {
          if (src[j] === '`') { j = readTemplate(j); continue }
          if (src[j] === '{') depth++
          else if (src[j] === '}') depth--
          j++
        }
        continue
      }
      j++
    }
    return Math.min(j + 1, n)
  }
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      out += blank(src.slice(i, j)); i = j; continue
    }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2)
      const j = end === -1 ? n : end + 2
      out += blank(src.slice(i, j)); i = j; continue
    }
    if (c === '\'' || c === '"') {
      const j = readString(c)
      out += src.slice(i, j); i = j; prev = c; continue
    }
    if (c === '`') {
      const j = readTemplate(i)
      out += src.slice(i, j); i = j; prev = c; continue
    }
    if (c === '/' && REGEX_PRECEDER.has(prev)) {
      let j = i + 1
      let inClass = false
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') inClass = true
        else if (src[j] === ']') inClass = false
        else if (src[j] === '/' && !inClass) break
        j++
      }
      j = Math.min(j + 1, n)
      out += src.slice(i, j); i = j; prev = '/'; continue
    }
    out += c
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out
}

/**
 * `from` から式を読み進め、深さ 0 で `stops` のどれかに当たった位置を返す。
 * コメントは潰してある前提 (`blankComments` 済み)。
 */
function skipExpression(src, from, stops) {
  let depth = 0
  let i = from
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === '\'' || c === '"') {
      i++
      while (i < n && src[i] !== c && src[i] !== '\n') i += src[i] === '\\' ? 2 : 1
      i++; continue
    }
    if (c === '`') {
      i++
      while (i < n && src[i] !== '`') {
        if (src[i] === '\\') { i += 2; continue }
        if (src[i] === '$' && src[i + 1] === '{') { i = skipExpression(src, i + 2, '}') + 1; continue }
        i++
      }
      i++; continue
    }
    if (depth === 0 && stops.includes(c)) return i
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    i++
  }
  return n
}

/** `re` に当たった各位置の直後から、深さ 0 の `stops` までを空白に潰す。 */
function blankAfter(src, re, stops) {
  let out = src
  for (const m of src.matchAll(re)) {
    const start = m.index + m[0].length
    const end = skipExpression(src, start, stops)
    out = out.slice(0, start) + blank(out.slice(start, end)) + out.slice(end)
  }
  return out
}

/**
 * 画面に出うる部分だけを残したソース (行番号は保存)。
 *
 * @param {string} src  ファイルの中身
 * @returns {string}
 */
export function userFacingSource(src) {
  let code = blankComments(src)
  code = blankAfter(code, /(?:\bthrow\s+new\s+[\w$.]+|\b\w*Error)\s*\(/g, ')')
  code = blankAfter(code, /\bwhy\s*:/g, ',})]')
  return code
}

/**
 * 日本語が残っている行 (1 始まり) と、その行の抜粋。
 *
 * @param {string} src
 * @returns {{line: number, text: string}[]}
 */
export function japaneseLines(src) {
  return userFacingSource(src).split('\n')
    .map((text, i) => ({ line: i + 1, text: text.trim() }))
    .filter(l => JAPANESE.test(l.text))
}
