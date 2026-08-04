/**
 * ScreenClaimCensus.test.js — 「画面を占める面は何枚あり、順序は誰が決めるか」を
 * 機械に数えさせる (ADR-113 · 原則 #31 · ADR-102 の母集団導出)
 *
 * ## この検査が答える問い
 *
 * 全画面オーバーレイは 4 つ在ったが、**枚数**を持つ欄はどこにも無かった。個々の
 * flag (`home` / `templateGalleryOpen` / `modal` / `onboardingVisible`) は値を持つ
 * ので状態として認識されるのに、「同時に何枚立ちうるか」には欄が無い — 原則 #31
 * が名指しする形そのもの。実費も出た: 起動ホームと New Project は**どちらも
 * z-index 300 を自分で選んで**おり、両方立ったときの勝者は `UIShell.jsx` の
 * マウント順という、どちらのファイルにも書かれていない事実が決めていた。
 *
 * したがってここで数えるのは 2 つ:
 *
 *   1. **宣言を持たない全画面オーバーレイの個数** (= 誰も枚数に入れていない面)
 *   2. **自分で z を選んでいる全画面オーバーレイの個数** (= 順序の第二の源)
 *
 * 2 が要るのは、1 だけでは元の欠陥を捕まえられないからである: ADR-113 以前も
 * 4 面は「宣言」に相当するもの (それぞれの flag) を持っていた。壊れていたのは
 * *面の存在*ではなく **面どうしの順序**で、それは各ファイルの `zIndex: 300` と
 * いうリテラルに散っていた。在るものを辿る数え方 (面を並べる) では出てこない。
 *
 * ## 母集団はどこから来るか (place-list を書かない)
 *
 * `src/components/**` を走査し、**`position:'fixed'` と `inset:0` を同じ style
 * オブジェクトに持つ**箇所を全画面オーバーレイとみなす。手書きの面リストを
 * 持たないので、新しい全画面オーバーレイを描いた日からそのファイルは母集団に
 * 入り、`CLAIM_DECLARATION` に行が無ければ落ちる。
 *
 * ## この証拠が構造的に見逃すもの (宣言)
 *
 * - **`inset:0` を使わない全画面**(`top/left/right/bottom:0` を 4 行で書く、
 *   `width:'100vw'` 等) は母集団に入らない。今日 `src/` にその形は無いが、
 *   書けてしまう — 次にその形を踏んだら、母集団の導出をそこへ広げること。
 *   境界は推論ではなく宣言なので、広げるのも宣言として行う。
 * - **段の中の順序**は問わない。同じ段に 2 面を宣言すれば z は同じになり、
 *   そこはマウント順に戻る。今日 `STAGE` 段は 1 欄なので同時に立てず、
 *   `DIALOG` 段は `uiStore.modal` が判別 union なので同時に立たない —
 *   つまり「同段の同時 2 枚」は**構造で**不可能であって、検査で防いではいない。
 *   3 枚目の面を同じ段に足す変更は、この不可能性を壊しうる。
 *
 * @see docs/adr/ADR-113-one-claim-on-the-screen.md
 * @see docs/gsn/adr-113-one-claim-on-the-screen.gsn
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { collectSources, relPath, stripCommentsFlat } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'
import {
  SCREEN_CLAIM, SCREEN_TIER, CLAIM_DECLARATION, DECLARED_CLAIMS,
  claimDeclaration, claimsInTier, tierZIndex,
  claimStage, releaseStage, stageClaim, stageIs, NO_STAGE_CLAIM,
} from './view/ScreenClaim.js'

/** 全画面オーバーレイの style オブジェクトを 1 つ切り出す窓の大きさ (文字)。 */
const STYLE_WINDOW = 420

/**
 * ファイル内の「全画面固定オーバーレイ」の style 窓を返す。
 *
 * @param {string} flat コメント除去済みのソース
 * @returns {string[]} 該当する style 断片
 */
function fullScreenOverlayWindows(flat) {
  const windows = []
  const fixed = /position:\s*'fixed'/g
  let m
  while ((m = fixed.exec(flat)) !== null) {
    const w = flat.slice(m.index, m.index + STYLE_WINDOW)
    if (/inset:\s*0\b/.test(w)) windows.push(w)
  }
  return windows
}

/** 母集団 = 全画面オーバーレイを描いているファイル (repo 相対)。 */
function overlayFiles() {
  const found = []
  for (const abs of collectSources({ jsx: true })) {
    const rel = relPath(abs)
    if (!rel.startsWith('src/components/')) continue
    const flat = stripCommentsFlat(readFileSync(abs, 'utf8'))
    if (fullScreenOverlayWindows(flat).length > 0) found.push(rel)
  }
  return found.sort()
}

/**
 * **対象外として宣言した**全画面オーバーレイ。理由なしの除外は、忘れられた
 * 除外と区別がつかない (だから空でも配列は残す — 0 は宣言させる)。
 */
const NOT_A_SCREEN_CLAIM = []

// ─── 1. 宣言を持たない面の個数 ───────────────────────────────────────────────

test('全画面オーバーレイはすべて宣言された面である (未宣言 0 枚)', () => {
  assertCoversPopulation({
    what: '全画面固定オーバーレイを描くファイル',
    population: overlayFiles(),
    declared: DECLARED_CLAIMS.map(c => CLAIM_DECLARATION[c].component),
    excluded: NOT_A_SCREEN_CLAIM,
    howDerived: "src/components/** を走査し、position:'fixed' と inset:0 を同じ style に持つ箇所",
    onNew: 'view/ScreenClaim.js の CLAIM_DECLARATION に段つきで行を足すこと。' +
           '宣言の無い全画面オーバーレイは「対象外」ではなく、誰も枚数を数えていない面になる (原則 #31)',
  })
})

test('宣言した面の住所は実在する (逆向き — 宣言の空回りを止める)', () => {
  const files = new Set(overlayFiles())
  for (const claim of DECLARED_CLAIMS) {
    const { component } = claimDeclaration(claim)
    assert.ok(
      files.has(component),
      `${claim} が名指す ${component} に全画面オーバーレイが無い。面を消したなら ` +
      'CLAIM_DECLARATION の行も同じコミットで消すこと — 退役の腐敗は違反を見逃すのではなく緑を出す (ADR-103)',
    )
  }
})

// ─── 2. 自分で z を選んでいる面の個数 (元の欠陥の形) ────────────────────────

test('全画面オーバーレイは z-index を自分で選ばない (順序の所有者は 1 つ)', () => {
  const offenders = []
  for (const rel of overlayFiles()) {
    const flat = stripCommentsFlat(readFileSync(`${process.cwd()}/${rel}`, 'utf8'))
    for (const w of fullScreenOverlayWindows(flat)) {
      const z = w.match(/zIndex:\s*([^,\n]+)/)
      if (!z) continue
      if (!z[1].includes('tierZIndex(')) offenders.push(`${rel}: zIndex: ${z[1].trim()}`)
    }
  }
  assert.deepEqual(
    offenders, [],
    '全画面オーバーレイが z-index リテラルを自分で選んでいる。tierZIndex(SCREEN_TIER.X) から取ること — ' +
    '起動ホームと New Project がどちらも 300 を選んだ結果、勝者は UIShell のマウント順という ' +
    'どちらのファイルにも書かれていない事実が決めていた (ADR-113 §力学 2)。',
  )
})

test('段の z は厳密に増加し、未宣言の段で throw する', () => {
  const order = [SCREEN_TIER.STAGE, SCREEN_TIER.COACH, SCREEN_TIER.DIALOG]
  for (let i = 1; i < order.length; i++) {
    assert.ok(
      tierZIndex(order[i]) > tierZIndex(order[i - 1]),
      `${order[i]} は ${order[i - 1]} より前面でなければならない`,
    )
  }
  assert.throws(() => tierZIndex('toast'), /undeclared tier/)
})

// ─── 3. STAGE 段の基数は 0..1 (構造で保証されていること) ────────────────────

test('stage は 1 欄 — 2 枚同時が表現不能', () => {
  const home    = claimStage(SCREEN_CLAIM.LAUNCH_HOME)
  const gallery = claimStage(SCREEN_CLAIM.CONTEXT_TEMPLATE_GALLERY)

  assert.equal(stageClaim(home), SCREEN_CLAIM.LAUNCH_HOME)
  // 起動ホームが立っている上から New Project を主張する = 報告された経路。
  // 「両方立っている」状態は作れないので、無言で背後に開くことがない。
  assert.equal(stageClaim(gallery), SCREEN_CLAIM.CONTEXT_TEMPLATE_GALLERY)
  assert.equal(stageIs(gallery, SCREEN_CLAIM.LAUNCH_HOME), false)

  // 0 は既定値ではなく値。
  assert.equal(stageClaim(NO_STAGE_CLAIM), null)
  assert.equal(stageIs(NO_STAGE_CLAIM, SCREEN_CLAIM.LAUNCH_HOME), false)
})

test('解放は自分の主張に対してだけ効く (遅れて来た close が他人を消さない)', () => {
  const gallery = claimStage(SCREEN_CLAIM.CONTEXT_TEMPLATE_GALLERY)
  // 起動ホームの「閉じる」が、後から立った New Project を消してはならない。
  assert.deepEqual(releaseStage(gallery, SCREEN_CLAIM.LAUNCH_HOME), gallery)
  assert.equal(releaseStage(gallery, SCREEN_CLAIM.CONTEXT_TEMPLATE_GALLERY), NO_STAGE_CLAIM)
})

test('stage 段でない面を stage スロットに入れられない', () => {
  assert.throws(() => claimStage(SCREEN_CLAIM.DIALOG), /段の面なので stage スロットに入らない/)
  assert.throws(() => claimStage(SCREEN_CLAIM.GESTURE_HINT), /段の面なので stage スロットに入らない/)
  assert.throws(() => claimStage('splash'), /undeclared screen claim/)
})

test('宣言表は SCREEN_CLAIM の全枝を覆い、各面はちょうど 1 段に属する', () => {
  assert.deepEqual([...DECLARED_CLAIMS].sort(), Object.values(SCREEN_CLAIM).sort())
  const byTier = Object.values(SCREEN_TIER).flatMap(t => claimsInTier(t))
  assert.deepEqual([...byTier].sort(), [...DECLARED_CLAIMS].sort(),
    '面はちょうど 1 段に属すること (段を持たない面は順序を持たない = 元の欠陥)')
  for (const claim of DECLARED_CLAIMS) {
    assert.ok(claimDeclaration(claim).why.length > 0, `${claim} に why が要る`)
  }
})
