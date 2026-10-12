/**
 * MotionIdentity.test.js — モーション・アイデンティティを「書く瞬間に問われる」形にする
 * (ADR-166 M2 / 憲法 Q3 / 原則 #31)
 *
 * ## なぜ数えるのか
 *
 * 方向性は CLAUDE.md の「モーション・アイデンティティ」節に 1 か所で固定した。だが節は
 * 誰も開かない散文になりうる — 演出が古びた原因は「方向が一度も決まらず、演出ごとに
 * 選ばれてきた」ことだった (ADR-166 §力学)。だから節の 5 軸のうち機械が読める部分を
 * ここで問う:
 *
 *   1. 節が在り、5 軸がすべて埋まっている (GSN `MotionIdentityIsFixedInOnePlace` の満期)
 *   2. イージング族: `EASING` は役割の名前で引く明示の曲線だけを持つ (CSS の既定キーワードを
 *      語彙に置かない — 既定の曲線は「誰も選ばなかった曲線」)
 *   3. 基盤の外で CSS の既定キーワードを使って動く箇所の **個数** (ratchet)。M1 の census
 *      (`MotionInventoryCoverage.test.js`) が「構造的に見逃す」と宣言していた欠陥 —
 *      基盤を通らず `transition` だけで動く部品 — を、ここで数える。
 *
 * ## この証拠が構造的に見逃すもの (宣言)
 *
 * 曲線の *名前* は数えるが、曲線が役割に合っているか (位置に fade を使っていないか) は
 * 見ない — それは採点表 (`docs/motion/inventory.md`) とレビューの仕事。ratchet は
 * `transition` / `animation` を名指す行だけを読むので、別の行に組み立てた文字列は
 * 数えない。
 *
 * @see docs/adr/ADR-166-motion-is-renewed-to-the-current-standard-and-map-annotations-become-light-on-the-floor.md
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectSources, relPath, repoPath, readFileSync, stripComments } from './census/sources.js'
import { EASING } from './theme/tokens.js'

const SECTION_HEADING = '## モーション・アイデンティティ'

/**
 * The axes are NOT listed here: their population is the method that defines
 * them — `.claude/skills/animation-fx/SKILL.md` Step 1.5 ("5軸を明示的に選ぶ —
 * A / B / … 。"). A hand-written list beside it would be the place-list
 * ADR-102 removed from the vocabulary; derived, a sixth axis added to the
 * method fails here the day it is added.
 */
function axesFromSkill() {
  const skill = readFileSync(repoPath('.claude/skills/animation-fx/SKILL.md'), 'utf8')
  const m = /5軸を明示的に選ぶ —([\s\S]*?)。/.exec(skill)
  assert.ok(m, 'animation-fx Step 1.5 no longer states the axes in the form this check reads')
  return m[1].replace(/\([^)]*\)/g, '').split('/').map(a => a.trim()).filter(Boolean)
}

test('CLAUDE.md fixes the motion identity in one section — every axis of the method, filled, and no other', () => {
  const md = readFileSync(repoPath('CLAUDE.md'), 'utf8')
  const at = md.indexOf(SECTION_HEADING)
  assert.ok(at >= 0, `CLAUDE.md has no "${SECTION_HEADING}" section (ADR-166 M2)`)
  assert.equal(md.indexOf(SECTION_HEADING, at + 1), -1, 'the identity lives in ONE section')
  const next = md.indexOf('\n## ', at + SECTION_HEADING.length)
  const rows = md.slice(at, next < 0 ? undefined : next).split('\n')
    .map(l => /^\| \*\*(.+?)\*\* \|(.*)$/.exec(l))
    .filter(Boolean)
    .map(([, axis, rest]) => ({ axis, decision: rest.split('|')[0].trim() }))

  const axes = axesFromSkill()
  assert.equal(axes.length, 5, `the method names ${axes.length} axes: ${axes.join(', ')}`)
  assert.deepEqual(rows.map(r => r.axis).sort(), [...axes].sort(),
    'one row per axis of the method — no axis missing, none invented')
  for (const { axis, decision } of rows) assert.ok(decision.length > 0, `axis "${axis}" is declared but empty`)
})

test('EASING carries only explicit curves, named by role — never a CSS default keyword', () => {
  for (const [role, curve] of Object.entries(EASING)) {
    assert.match(curve, /^cubic-bezier\(/,
      `EASING.${role} = '${curve}' — a CSS keyword is the browser's curve, not a chosen one`)
  }
  assert.deepEqual(Object.keys(EASING).sort(), ['exit', 'fade', 'land', 'loop', 'spring'],
    'the easing family is the five roles of the identity — add a role in CLAUDE.md first')
})

// The CSS default easings. `(?<![\w-])…(?![\w-])` keeps `linear-gradient`,
// `easeOutCubic` and friends out.
const CSS_KEYWORD_EASING = /(?<![\w-])(ease-in-out|ease-out|ease-in|ease|linear)(?![\w-])/g
const MOTION_PROPERTY = /\b(transition|animation)\b/

/**
 * Today's count of CSS default easings driving motion outside the vocabulary.
 * A stated budget, not a target (ADR-100's ratchet): it fails when the count
 * rises AND when it falls without the baseline being lowered — a ratchet
 * nobody turns is not a ratchet. M4 lowers it row by row.
 * 2026-10-12 (ADR-166 M2): 16 occurrences on 13 lines.
 */
const KEYWORD_EASING_BASELINE = 16

test('CSS default easings outside the vocabulary never increase (ratchet)', () => {
  const hits = []
  for (const file of collectSources()) {
    const lines = stripComments(readFileSync(file, 'utf8'))
    lines.forEach((line, i) => {
      if (!MOTION_PROPERTY.test(line)) return
      for (const m of line.matchAll(CSS_KEYWORD_EASING)) hits.push(`${relPath(file)}:${i + 1} ${m[1]}`)
    })
  }
  assert.ok(hits.length <= KEYWORD_EASING_BASELINE,
    `CSS default easings rose to ${hits.length} (baseline ${KEYWORD_EASING_BASELINE}). ` +
    `Use EASING.<role> from src/theme/tokens.js:\n  ${hits.join('\n  ')}`)
  assert.equal(hits.length, KEYWORD_EASING_BASELINE,
    `CSS default easings are down to ${hits.length} — lower KEYWORD_EASING_BASELINE to ${hits.length}.`)
})
