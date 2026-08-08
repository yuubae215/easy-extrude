/**
 * DocIntakeAddressCensus.test.js — 「覆ってよい面の規則は、面の名前ではなく
 * 役割で書かれているか」を機械に問わせる (ADR-112 D2 / 原則 #31 / 原則 #26)
 *
 * ## この検査が答える問い
 *
 * 文書の入力オーバーレイは左側にドックし、左の常設ドックの上に立つ。その規則は
 * 初版で「Outliner を覆う」と**面の名前**で書かれていた。それが安全だったのは
 * Outliner が幾何の木であり、入力中の文書と関係が無かったからである。
 *
 * ADR-111 が意味側を置いた日にその前提は崩れた — 同じ Outliner の中で、幾何側は
 * 覆ってよく、意味側 (いま入力している文書の共有変数を映す面) は覆えない。
 * **面の名前では規則を表せない。**
 *
 * したがって数えるのは「覆っている面が何枚か」ではなく
 *
 *   **役割を宣言していない面の個数** と **規則を自分で決めている描き手の個数** (どちらも 0)
 *
 * である。前者は 3 面目が生まれた日に既定へ落ちるのを止め、後者は原則 #26 が
 * 端で禁じた「呼び出し箇所ごとのパッチ」を*重なり*の側で禁じる。
 *
 * ## 決着前の宣言が 0 個であることは、ここでは数えない (§1.1)
 *
 * `scripts/check-deferrals.mjs` が既に repo 全体でそれを数えている (ADR-109 D4 の
 * 逆向き検査 + Q1 の ratchet)。同じ事実を 2 箇所で数えると、片方だけが直る形に
 * なる — 数える側にも第二の源を作らない。**境界は宣言であって推論ではない。**
 *
 * @see docs/adr/ADR-112-the-document-intake-address-becomes-permanent.md
 * @see docs/gsn/adr-112-the-document-intake-address-becomes-permanent.gsn
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectSources, relPath, stripCommentsFlat, repoPath, readFileSync } from './census/sources.js'
import { assertCoversPopulation } from './census/partition.js'
import { mayCoverRole, DECLARED_COVERAGE_ROLES, docIntakeTabOrThrow, DOC_INTAKE_TAB } from './view/DocIntake.js'
import {
  SURFACE_ROLE, NAVIGATOR_SIDE, NAVIGATOR_SIDES, DECLARED_NAVIGATOR_SIDES,
  NAVIGATOR_ROLES, navigatorSideDeclaration,
} from './view/NavigatorSides.js'
import { transientOverlayLeft, leftEdgeOffset } from './view/EdgeOccupancy.js'

/** 一時オーバーレイの描き手 (規則を使う側であって、決める側ではない)。 */
const OVERLAY_FILE = 'src/components/Doc/DocIntakeLayer.jsx'
/** 覆う規則の唯一の所有者。 */
const RULE_OWNER = 'src/view/DocIntake.js'

/**
 * 覆う規則の対象外として宣言した役割。
 *
 * 今日は空。**空であることの宣言も宣言である** (原則 #31) — 除外を書ける場所が
 * 無いと、次の人は役割表のほうを黙って歪める。
 */
const ROLES_WITHOUT_A_RULE = []

// ─── G1: 役割はすべて規則を持つ ─────────────────────────────────────────────

test('面の役割はすべて覆う規則を持つ — 規則の無い役割は 0 個 (ADR-112 D2)', () => {
  assertCoversPopulation({
    what:       '面の役割',
    population: Object.values(SURFACE_ROLE),
    declared:   [...DECLARED_COVERAGE_ROLES],
    excluded:   ROLES_WITHOUT_A_RULE,
    howDerived: 'src/view/NavigatorSides.js の SURFACE_ROLE の値',
    onNew:      `${RULE_OWNER} の OVERLAY_COVERAGE_BY_ROLE に行を足すこと — `
              + '規則を持たない役割は「覆ってよいと決めた面」と「誰も考えなかった面」を '
              + '区別不能にする (原則 #31 / ADR-096 の既定表の規律)',
  })
})

test('未宣言の役割では throw する — 既定へ落ちない', () => {
  assert.throws(() => mayCoverRole('vibes'), /未宣言の面の役割/)
  for (const role of Object.values(SURFACE_ROLE)) {
    assert.equal(typeof mayCoverRole(role), 'boolean', `${role} の規則が真偽値でない`)
  }
})

// ─── G2: 規則が実際に 2 つの側を分けている ──────────────────────────────────

test('覆う可否は器が**見せうる**役割で決まる — 今どちらを向いているかではない', () => {
  // 実装で分かったこと (ADR-112 §実装で変わったこと): 側を切り替えるスイッチ自体が
  // 覆われる側に住んでいる。いま幾何側だからと覆うと、切替が押せなくなり意味側へは
  // 二度と行けない — 規則が「覆ってよい」と言った瞬間に、規則を発動させる手段が
  // 消える (原則 #16)。だから可否は器の性質として問う。
  assert.ok(NAVIGATOR_ROLES.some(role => !mayCoverRole(role)),
    'ナビゲータが覆えない役割を 1 つも見せない = 意味側が役割を失っている')

  const overlay = stripCommentsFlat(readFileSync(repoPath(OVERLAY_FILE), 'utf8'))
  assert.ok(!/outlinerSide/.test(overlay),
    `${OVERLAY_FILE} が現在の側を読んでいる — 覆う可否は器の性質であって向きではない`)
})

test('入力を映す面は覆えず、在るものの構造は覆える (ADR-112 D2 / ADR-111)', () => {
  // これが「面の名前では書けない」ことの実体 — 同じ 1 つのウィジェットの中で
  // 答えが割れる。名前で書いた規則はここで必ず嘘になる。
  const geometry = navigatorSideDeclaration(NAVIGATOR_SIDE.GEOMETRY)
  const semantic = navigatorSideDeclaration(NAVIGATOR_SIDE.SEMANTIC)

  assert.equal(mayCoverRole(geometry.role), true,
    '幾何側が覆えない — フォームを埋めているあいだ「在るものの構造」は要らない')
  assert.equal(mayCoverRole(semantic.role), false,
    '意味側が覆える — いま入力している文書の変数が隠れる (3D のゴーストを覆うのと同じ欠陥)')

  // 覆えない側では左端を空ける。空けないなら規則は宣言だけで効いていない。
  assert.ok(transientOverlayLeft({ isMobile: false, clearLeftDock: true }) > 0,
    '覆えない面が在るのにオーバーレイが左端に張り付いている')
  assert.equal(transientOverlayLeft({ isMobile: false, clearLeftDock: false }), 0)
  // mobile の Outliner はドロワーなので、覆う覆わない以前に端に居ない。
  assert.equal(transientOverlayLeft({ isMobile: true, clearLeftDock: true }), 0)
})

test('空ける幅は左端の所有者が持つ — オーバーレイは幅を知らない (原則 #26)', () => {
  // 幅の literal がオーバーレイ側へ写ると、Outliner の幅が変わった日に片方だけが
  // 直る。所有者は 1 つで、ここが答えるのは「空けるなら何 px か」だけである。
  const cleared = transientOverlayLeft({ isMobile: false, clearLeftDock: true })
  const beside  = leftEdgeOffset({ isMobile: false })
  assert.ok(cleared < beside && beside - cleared <= 16,
    `空ける幅 (${cleared}) が左端の占有 (${beside}) と同じ定数から出ていない`)

  const overlay = stripCommentsFlat(readFileSync(repoPath(OVERLAY_FILE), 'utf8'))
  assert.ok(overlay.includes('transientOverlayLeft('),
    `${OVERLAY_FILE} が左端の所有者を引いていない`)
  assert.ok(!/left:\s*['"`]?\d/.test(overlay),
    `${OVERLAY_FILE} が left に literal を書いている — 呼び出し箇所ごとのパッチ (原則 #26)`)
})

// ─── G3: 規則の所有者は 1 つ ────────────────────────────────────────────────

test('覆う規則を持つファイルが 1 個 — 描き手は答えを使うだけ (原則 #4)', () => {
  const owners = []
  for (const abs of collectSources()) {
    const rel  = relPath(abs)
    const body = stripCommentsFlat(readFileSync(abs, 'utf8'))
    // 規則を「持つ」= 役割ごとの可否を自分で書いている形。
    if (/mayCover\s*:/.test(body)) owners.push(rel)
  }
  assert.deepEqual(owners, [RULE_OWNER],
    `\n覆う規則を持つファイル: ${owners.join(', ')}\n` +
    `  所有者は ${RULE_OWNER} ただ 1 つ。描き手が自分で可否を決め始めると、\n` +
    '  3 面目が生まれた日に直る箇所と直らない箇所ができる (§1.1)。\n')
})

test('描き手は面の名前で分岐していない — 役割で引いている (ADR-112 D2)', () => {
  const overlay = stripCommentsFlat(readFileSync(repoPath(OVERLAY_FILE), 'utf8'))
  assert.ok(overlay.includes('mayCoverRole('),
    `${OVERLAY_FILE} が役割表を引いていない`)
  // 面の名前 (`NAVIGATOR_SIDE.SEMANTIC` との直接比較) で分岐すると、規則が
  // 描き手の中へ写る。側 → 役割の写像は宣言表が持ち、可否は規則が持つ。
  assert.ok(!/NAVIGATOR_SIDE\./.test(overlay),
    `${OVERLAY_FILE} が面の名前で分岐している — 規則が描き手へ写っている`)
})

// ─── G4: 器の値域は恒久化しても有界のまま ───────────────────────────────────

test('文書の入口の面の値域は有界で、未宣言の面は throw する', () => {
  for (const id of Object.values(DOC_INTAKE_TAB)) assert.equal(docIntakeTabOrThrow(id), id)
  assert.throws(() => docIntakeTabOrThrow('checks'), /未宣言の文書入口の面/)
})

test('走査が空回りしていない (母数の liveness)', () => {
  assert.ok(DECLARED_NAVIGATOR_SIDES.length === 2, 'ナビゲータの側の導出が壊れている')
  assert.ok(Object.values(SURFACE_ROLE).length >= 2, '役割の導出が壊れている')
  assert.ok(Object.values(NAVIGATOR_SIDES).every(s => s.role), '側が役割を持たない')
  assert.ok(collectSources().length > 50, 'src/ の走査に失敗している')
})
