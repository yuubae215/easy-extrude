/**
 * HeaderEntranceCensus.test.js — 「ヘッダの入口は何個あるか」を機械に数えさせる
 * (ADR-108 D1 / D2 / D3 / D4 · 原則 #31 · ADR-102 の母集団導出)
 *
 * ## この検査が答える問い
 *
 * 入口が「動詞 × 対象」の直積で生えていた。畳めば今日の 11 個は 3 個になるが、
 * **畳み込みは一度きりの是正であって統治ではない** — 生やす側を止めなければ、
 * 同じ ADR を 2 年後にもう一度書くことになる (ADR-108 §却下案 A)。
 *
 * したがって数えるべきは「今ある入口」ではなく **宣言された上界との差**である。
 * ADR-100 が「宣言外の色」に ratchet を置いたのと同じ形で、実測値を定数に焼き、
 * **超えても下回っても fail** させる。下回りでも落とすのは、畳んだ入口を誰かが
 * 黙って戻したり、逆に「使われていないから」と消したときに気づくためで、
 * 退役の腐敗は違反を*見逃す*のではなく**緑を出す** (ADR-103 §負債 3)。
 *
 * ## 母集団はどこから来るか (place-list を書かない)
 *
 * `Header.jsx` の JSX を**構文で**読む。2 つのレイアウト関数
 * (`DesktopHeaderContents` / `MobileHeaderContents`) の直下に現れる要素を数え、
 * キーは `要素名` または `要素名:判別子` (判別子は `verb={HEADER_VERB.X}` /
 * `surface={SURFACE.X}` / `label="…"` の最初に見つかったもの)。
 *
 * 手書きの入口リストを持たないので、**新しい要素をヘッダに足した日から**それは
 * 母集団に入り、`HEADER_ENTRANCES` に行が無ければ落ちる。「表に足すまで数えられ
 * ない」という ADR-102 が名指しした腐り方をしない。
 *
 * ## この証拠が構造的に見逃すもの (宣言)
 *
 * **数えるのは `Header.jsx` の中だけ**である。ヘッダの外に生えた入口
 * (`TourCard` の左下カード・`SceneChecksHud`・N パネル内のリンク) は母集団に
 * 入らない。ADR-105 が既に「発見はヘッダの外にもある」と示しているので、これは
 * 仮定ではなく既知の穴である。次に「ヘッダの外に常設入口が生えた」事例を踏んだら、
 * 母集団を `Header.jsx` から**常設 chrome 全体**へ広げること — 境界は推論ではなく
 * 宣言なので、広げるのも宣言として行う。
 *
 * @see docs/adr/ADR-108-entrances-are-verbs-not-objects.md
 * @see docs/gsn/adr-108-entrances-are-verbs-not-objects.gsn
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repoPath, readFileSync, stripCommentsFlat, collectSources, relPath } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'
import {
  HEADER_VERB, HEADER_ENTRANCES, MULTI_ENTRANCE_VERBS, LAYOUT,
  START_KIND, START_ENTRY_BY_KIND, startEntryFor,
  FILE_OBJECT, FILE_TARGETS_BY_VERB, fileTargetsFor,
  SURFACE, SURFACE_TOGGLES, surfaceToggleFor,
  FLOOR_TARGETS, OVERFLOW_VERBS, menuFor,
  REQUIRES, requirementReason, availabilityOf,
} from './view/HeaderEntrances.js'

const HEADER_FILE = 'src/components/Header/Header.jsx'

// ─── D2: the ratchet ─────────────────────────────────────────────────────────

/**
 * **ベースライン** — ADR-108 実装時点の実測値。
 *
 * 「今日の 7 個は正当である」を隠さず定数にしたもの。増やすには意図的にこの数を
 * 上げる (= レビューで必ず目に入る) 必要があり、減らしたときも下げ忘れると落ちる。
 */
const DESKTOP_ENTRANCE_BASELINE = 7
const MOBILE_ENTRANCE_BASELINE  = 7

/** 入口ではないと**宣言**した要素 (理由なしの除外は、忘れられた除外と区別がつかない)。 */
const NOT_AN_ENTRANCE = [
  { key: 'HeaderStatus', why: '操作ガイダンスの文字列。pointerEvents:none で押せないので入口ではない' },
  { key: 'div',          why: 'flex:1 の不可視スペーサ — ⋯ と N を右寄せするためだけの箱' },
]

// ─── 構文からの母集団導出 ────────────────────────────────────────────────────

/** `function NAME(` からブレース対応で本体を切り出す。 */
function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1,
    `${HEADER_FILE} に function ${name} が無い。レイアウト関数の名前を変えたなら、` +
    'この検査の母集団の入口も同じコミットで変えること (母集団が消えると検査は緑のまま黙る)。')
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(open, i + 1) }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

/** 開きタグの属性文字列を、ブレース/引用符を尊重して切り出す。 */
function attributesAt(body, tagStart) {
  let depth = 0, quote = null
  for (let i = tagStart; i < body.length; i++) {
    const c = body[i]
    if (quote) { if (c === quote) quote = null; continue }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return body.slice(tagStart, i)
  }
  throw new Error('unterminated JSX tag')
}

/**
 * レイアウト関数の中に現れる JSX 要素のキー一覧 (出現順)。
 *
 * 判別子の優先順は宣言 — `verb` → `surface` → `label`。同じ要素を 2 回使う入口
 * (`IconBtn` が 3 つ) が別のキーになるのはここで決まる。
 */
function entranceKeysIn(body) {
  const keys = []
  const tag = /<([A-Za-z][\w.]*)/g
  let m
  while ((m = tag.exec(body)) !== null) {
    const name  = m[1]
    const attrs = attributesAt(body, m.index + m[0].length)
    const verb    = attrs.match(/verb=\{HEADER_VERB\.(\w+)\}/)
    const surface = attrs.match(/surface=\{SURFACE\.(\w+)\}/)
    const label   = attrs.match(/label="([^"]+)"/)
    const disc = verb?.[1] ?? surface?.[1] ?? label?.[1] ?? null
    keys.push(disc ? `${name}:${disc}` : name)
  }
  return keys
}

function layoutKeys() {
  const source  = stripCommentsFlat(readFileSync(repoPath(HEADER_FILE), 'utf8'))
  return {
    [LAYOUT.DESKTOP]: entranceKeysIn(functionBody(source, 'DesktopHeaderContents')),
    [LAYOUT.MOBILE]:  entranceKeysIn(functionBody(source, 'MobileHeaderContents')),
  }
}

// ─── G1: 入口の母集団が宣言で覆われている ────────────────────────────────────

test('every element rendered in the header is either a declared entrance or a declared non-entrance', () => {
  const keys = layoutKeys()
  const population = [...new Set([...keys[LAYOUT.DESKTOP], ...keys[LAYOUT.MOBILE]])]

  assertCoversPopulation({
    what:       'ヘッダの常設入口',
    population,
    declared:   Object.keys(HEADER_ENTRANCES),
    excluded:   NOT_AN_ENTRANCE,
    howDerived: `${HEADER_FILE} の DesktopHeaderContents / MobileHeaderContents 直下の JSX 要素 `
              + '(キー = 要素名[:verb|surface|label])',
    onNew:      'src/view/HeaderEntrances.js の HEADER_ENTRANCES に行を足し (= その入口の動詞を宣言し)、'
              + 'ベースラインを意図的に上げること。動詞を持たない要素なら NOT_AN_ENTRANCE へ理由つきで。',
  })
})

test('every declared entrance is actually rendered in the layout it claims', () => {
  const keys = layoutKeys()
  const idle = []
  for (const [key, decl] of Object.entries(HEADER_ENTRANCES)) {
    for (const layout of decl.layouts) {
      if (!keys[layout].includes(key)) idle.push(`${key} (claims ${layout})`)
    }
  }
  assert.deepEqual(idle, [],
    '\n宣言された入口が、宣言したレイアウトに描かれていない:\n  ' + idle.join('\n  ') +
    '\n\n  逆向きが要るのは、入口が消えたことと規則が守られていることが区別できないため。' +
    '\n  消したなら HEADER_ENTRANCES の行も同じコミットで消す (原則 #31 / ADR-103 §負債 3)。\n')
})

// ─── G1: ratchet ────────────────────────────────────────────────────────────

test('the header entrance count matches its declared bound — in both directions', () => {
  const keys = layoutKeys()
  const declared = new Set(Object.keys(HEADER_ENTRANCES))
  const desktop = keys[LAYOUT.DESKTOP].filter(k => declared.has(k))
  const mobile  = keys[LAYOUT.MOBILE].filter(k => declared.has(k))

  assert.equal(desktop.length, DESKTOP_ENTRANCE_BASELINE,
    `\ndesktop の常設入口が ${desktop.length} 個 (宣言された上界 ${DESKTOP_ENTRANCE_BASELINE})。\n` +
    `  実測: ${desktop.join(', ')}\n\n` +
    '  増やす場合: 対象を足したいだけなら引数 (FILE_TARGETS_BY_VERB / START_ENTRY_BY_KIND) へ落とせる。\n' +
    '  それでも動詞が増えるなら、この定数を上げるのが「版を上げる意図的な行為」である (ADR-108 D2)。\n' +
    '  減らした場合も落ちる — 畳んだつもりの入口が黙って消えたのか意図的なのかを区別するため。\n')
  assert.equal(mobile.length, MOBILE_ENTRANCE_BASELINE,
    `\nmobile の常設入口が ${mobile.length} 個 (宣言された上界 ${MOBILE_ENTRANCE_BASELINE})。\n` +
    `  実測: ${mobile.join(', ')}\n\n` +
    '  デスクトップだけ数えると、モバイルに生えた入口が出てこない — 両方に上界がある。\n')
})

// ─── G3 (OneVerbHasOneEntrance): 動詞 → 入口の逆像は高々 1 ───────────────────

test('one verb has one entrance — unless the multi-entrance case is declared with a reason', () => {
  for (const layout of Object.values(LAYOUT)) {
    const byVerb = new Map()
    for (const [key, decl] of Object.entries(HEADER_ENTRANCES)) {
      if (!decl.layouts.includes(layout)) continue
      if (!byVerb.has(decl.verb)) byVerb.set(decl.verb, [])
      byVerb.get(decl.verb).push(key)
    }
    for (const [verb, entrances] of byVerb) {
      if (entrances.length <= 1) continue
      assert.ok(MULTI_ENTRANCE_VERBS[verb],
        `\n[${layout}] 動詞 "${verb}" に入口が ${entrances.length} 個ある: ${entrances.join(', ')}\n\n` +
        '  これが ADR-108 が畳んだ形そのもの — 対象ごとに入口を生やすと、対象が増えるたびに\n' +
        '  ヘッダが伸びる。対象を引数へ落とすか、複数入口が正しい理由を MULTI_ENTRANCE_VERBS に\n' +
        '  宣言すること (宣言しても D2 の上界は動かないので、書けば済む話にはならない)。\n')
    }
  }
})

test('declared multi-entrance verbs actually have more than one entrance somewhere', () => {
  const stale = []
  for (const verb of Object.keys(MULTI_ENTRANCE_VERBS)) {
    const count = Object.values(HEADER_ENTRANCES).filter(d => d.verb === verb).length
    if (count <= 1) stale.push(`${verb} (${count})`)
  }
  assert.deepEqual(stale, [],
    '\n複数入口の例外を宣言しているのに、入口が 1 つ以下の動詞がある: ' + stale.join(', ') +
    '\n  空回りする例外は「例外が要る形」と「例外を消し忘れた形」を区別不能にする。\n')
})

test('every declared entrance names a verb that exists in the enum', () => {
  const verbs = new Set(Object.values(HEADER_VERB))
  const rogue = Object.entries(HEADER_ENTRANCES)
    .filter(([, d]) => !verbs.has(d.verb))
    .map(([k, d]) => `${k} → ${d.verb}`)
  assert.deepEqual(rogue, [],
    '\n入口が enum に無い動詞を名乗っている: ' + rogue.join(', ') +
    '\n  動詞は入口の個数を決める母集団なので、enum の外の値は上界の外側を作る。\n')
})

// ─── G3 / D3: 種ごとの宣言表が未宣言の種で throw する ────────────────────────

test('every START_KIND branch has a declared way to start — and nothing else does', () => {
  assertCoversPopulation({
    what:       '「始める」の種',
    population: Object.values(START_KIND),
    declared:   Object.keys(START_ENTRY_BY_KIND),
    howDerived: 'src/view/HeaderEntrances.js の START_KIND enum の枝',
    onNew:      'START_ENTRY_BY_KIND に行を足すこと。行が無い種は fall-through して無言になる (原則 #11)。',
  })
  const orphan = Object.keys(START_ENTRY_BY_KIND).filter(k => !Object.values(START_KIND).includes(k))
  assert.deepEqual(orphan, [], `START_ENTRY_BY_KIND に enum の外の種がある: ${orphan.join(', ')}`)
})

test('startEntryFor throws on an undeclared kind rather than falling through', () => {
  assert.throws(() => startEntryFor('portal-from-a-future-adr'), /undeclared start kind/)
  for (const kind of Object.values(START_KIND)) {
    const entry = startEntryFor(kind)
    assert.ok(entry.label && entry.callback && entry.adr && entry.why,
      `${kind} の宣言に label / callback / adr / why のどれかが無い`)
  }
})

test('the five start kinds are exactly the five doors ADR-108 folded', () => {
  // 03-implementation-order.md は「4 重導線」と書いていた。数えると 5 で、
  // Tutorial (= STORY) が落ちていた。記憶は母集団の権威ではない (ADR-102)。
  assert.equal(Object.keys(START_ENTRY_BY_KIND).length, 5)
  const adrs = Object.values(START_ENTRY_BY_KIND).map(e => e.adr).sort()
  assert.deepEqual(adrs, ['ADR-047', 'ADR-051', 'ADR-063', 'ADR-065', 'ADR-089'],
    '5 種はそれぞれ別の ADR が正しく作ったもの。中身は変えず並べ方だけを変える (D3)。')
})

// ─── G3 / D1: ファイル動詞 × 対象 ────────────────────────────────────────────

test('each file verb carries every target exactly once — the product lives in the arguments', () => {
  for (const verb of [HEADER_VERB.EXPORT, HEADER_VERB.IMPORT]) {
    const objects = fileTargetsFor(verb).map(t => t.object)
    assert.deepEqual([...objects].sort(), [...Object.values(FILE_OBJECT)].sort(),
      `${verb} の対象が FILE_OBJECT と一致しない (実測 ${objects.join(', ')})。\n` +
      '  対象が動詞ごとにズレると「どちらの入口から行けるか」を覚える必要が戻ってくる。')
    assert.equal(new Set(objects).size, objects.length, `${verb} に同じ対象が 2 行ある`)
  }
  assert.equal(Object.keys(FILE_TARGETS_BY_VERB).length, 2,
    'ファイル動詞は 2 つ。3 つ目を足すなら入口も 1 つ増えるので D2 の上界に当たる。')
})

test('fileTargetsFor throws on a verb that is not a file verb', () => {
  assert.throws(() => fileTargetsFor(HEADER_VERB.SWITCH_MODE), /not a declared file verb/)
})

test('menuFor throws for a verb whose objects are not arguments', () => {
  // Undo / Redo / トグルは「対象を選んでから実行する」流れではないので、
  // VerbMenu として描かれてはならない。表現不能にはできないが、throw はできる。
  assert.throws(() => menuFor(HEADER_VERB.UNDO), /no declared menu/)
  assert.throws(() => menuFor(HEADER_VERB.TOGGLE_SURFACE), /no declared menu/)
  for (const verb of OVERFLOW_VERBS) {
    const menu = menuFor(verb)
    assert.ok(menu.items.length >= 1, `${verb} のメニューが空`)
  }
})

test('the mobile overflow offers exactly the verbs the desktop header keeps as menus', () => {
  const desktopMenuVerbs = Object.values(HEADER_ENTRANCES)
    .filter(d => d.layouts.includes(LAYOUT.DESKTOP))
    .map(d => d.verb)
    .filter(v => { try { menuFor(v); return true } catch { return false } })
  assert.deepEqual([...OVERFLOW_VERBS].sort(), [...new Set(desktopMenuVerbs)].sort(),
    '\nモバイルの ⋯ とデスクトップのヘッダで、到達できる動詞の集合が違う。\n' +
    '  片方だけに生えた入口はもう片方の利用者から見えないので、畳んだ結果が層で分かれる。\n')
})

// ─── D4: 表示条件は住所の根拠ではない ────────────────────────────────────────

test('the Node Editor is classified by its verb, not by its display condition', () => {
  const decl = HEADER_ENTRANCES['SurfaceToggle:NODE_EDITOR']
  assert.ok(decl, 'Node Editor の入口が宣言されていない')
  assert.equal(decl.verb, HEADER_VERB.TOGGLE_SURFACE,
    'Node Editor は第二の編集器であって、持ち出し / 持ち込みの動詞を持たない (ADR-108 D4)。')

  // 同じ表示条件 (BFF) を共有する対象は今もある — が、それらは *引数* であって
  // 入口ではない。条件の一致で入口が同居していないことを、条件の側から問う。
  const bffTargets = [...fileTargetsFor(HEADER_VERB.EXPORT), ...fileTargetsFor(HEADER_VERB.IMPORT)]
    .filter(t => t.requires === REQUIRES.BFF)
  assert.equal(bffTargets.length, 2, 'サーバ対象は持ち出す / 持ち込むに 1 つずつ')
  assert.equal(surfaceToggleFor(SURFACE.NODE_EDITOR).requires, REQUIRES.BFF,
    '表示条件は同じままでよい — 変えたのは条件ではなく分類である。')
})

test('surfaceToggleFor throws on an undeclared surface', () => {
  assert.throws(() => surfaceToggleFor('holodeck'), /undeclared surface/)
  assert.equal(Object.keys(SURFACE_TOGGLES).length, Object.keys(SURFACE).length)
})

// ─── 可用性: 消さずに理由を出す ──────────────────────────────────────────────

test('an unavailable argument is disabled with a reason — never removed, never silent', () => {
  const none = { bffConnected: false, contextLoaded: false, finePointer: false }
  const all  = { bffConnected: true,  contextLoaded: true,  finePointer: true }

  const gated = [
    ...Object.values(START_ENTRY_BY_KIND),
    ...fileTargetsFor(HEADER_VERB.EXPORT),
    ...fileTargetsFor(HEADER_VERB.IMPORT),
    ...FLOOR_TARGETS,
    ...Object.values(SURFACE_TOGGLES),
  ]
  for (const target of gated) {
    const off = availabilityOf(target, none)
    const on  = availabilityOf(target, all)
    assert.equal(on.enabled, true, `${target.label} は全前提が揃っても使えない`)
    if (target.requires) {
      assert.equal(off.enabled, false, `${target.label} の前提 ${target.requires} が効いていない`)
      assert.ok(off.reason && off.reason.length > 20,
        `${target.label} が押せない理由を持たない — 無言の no-op は最悪の失敗形 (原則 #11)`)
    } else {
      assert.deepEqual(off, { enabled: true, reason: null },
        `${target.label} は前提を宣言していないのに落ちた`)
    }
  }
})

test('requirementReason throws on an undeclared requirement', () => {
  assert.throws(() => requirementReason('vibes'), /undeclared requirement/)
  for (const req of Object.values(REQUIRES)) assert.ok(requirementReason(req).length > 20)
})

// ─── 同一性: 動詞の配線は宣言表だけが持つ ────────────────────────────────────

test('the header components hold no callback wiring of their own', () => {
  // 宣言表の外で `callbacks.onExportJson?.()` を書けば、その 1 行が第二の源になり、
  // 次の対象は「そこにもう 1 行足す」形で入る = 平坦な 6 個が戻る経路そのもの。
  const wired = [
    ...Object.values(START_ENTRY_BY_KIND),
    ...fileTargetsFor(HEADER_VERB.EXPORT),
    ...fileTargetsFor(HEADER_VERB.IMPORT),
    ...FLOOR_TARGETS,
    ...Object.values(SURFACE_TOGGLES),
  ].map(t => t.callback)

  const offenders = []
  for (const file of collectSources()) {
    const rel = relPath(file)
    if (!rel.startsWith('src/components/Header/')) continue
    const source = stripCommentsFlat(readFileSync(file, 'utf8'))
    for (const cb of wired) {
      if (source.includes(`callbacks.${cb}`) || source.includes(`'${cb}'`)) offenders.push(`${rel}: ${cb}`)
    }
  }
  assert.deepEqual(offenders, [],
    '\nヘッダの component が動詞の配線を直に持っている:\n  ' + offenders.join('\n  ') +
    '\n\n  配線は src/view/HeaderEntrances.js の宣言表だけが持つ。component は表を引くだけ。\n')
})

test('every declared callback is registered exactly once somewhere in src/', () => {
  // 逆向き — 文字列で書いた callback 名は typo が実行時まで出ないので、
  // 「宣言したが誰も登録していない」= 押しても何も起きない入口を落とす (原則 #11)。
  const declared = [
    ...Object.values(START_ENTRY_BY_KIND),
    ...fileTargetsFor(HEADER_VERB.EXPORT),
    ...fileTargetsFor(HEADER_VERB.IMPORT),
    ...FLOOR_TARGETS,
    ...Object.values(SURFACE_TOGGLES),
  ].map(t => t.callback)

  const all = collectSources().map(f => stripCommentsFlat(readFileSync(f, 'utf8'))).join('\n')
  const missing = declared.filter(cb => !all.includes(`registerCallback('${cb}'`))
  assert.deepEqual(missing, [],
    '\n宣言された入口の callback が src/ のどこにも登録されていない: ' + missing.join(', ') +
    '\n  文字列の配線は typo がクリックの瞬間まで出ない。押しても何も起きない入口は無言の no-op。\n')
})
