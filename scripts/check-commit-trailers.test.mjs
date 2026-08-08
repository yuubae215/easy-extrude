// check-commit-trailers.test.mjs — 欠測の数え方そのものを固定する (ADR-115)
//
// この検査が守るのは「欠測が増えていないこと」だが、**数え方が静かに緩むと
// 緑を出したまま守らなくなる**。退役の腐敗と同じ形 (ADR-103) なので、
// 分類規則には負の対照を含めて焼いておく。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  classifyCommit,
  declarationAgrees,
  summarize,
  populationVerdict,
  CLAUDE_AUTHOR_EMAIL,
} from './check-commit-trailers.mjs'

const claude = (over = {}) => ({
  authorEmail: CLAUDE_AUTHOR_EMAIL,
  modelEffort: 'claude-opus-5/high',
  taskClass: 'feat/front',
  coAuthor: 'Claude Opus 5 <noreply@anthropic.com>',
  ...over,
})

test('刻印済みのコミットは stamped', () => {
  assert.equal(classifyCommit(claude()), 'stamped')
})

test('Claude 製でトレーラが両方無ければ missing', () => {
  assert.equal(classifyCommit(claude({ modelEffort: '', taskClass: '' })), 'missing')
})

test('人間のコミットは missing ではなく foreign', () => {
  // 負の対照。hook は人間のコミットに意図的に刻まない (帰属 — ADR-092 §2) ので、
  // これを欠測に数えると人がコミットするたび ratchet が壊れて意味を失う。
  assert.equal(
    classifyCommit({ authorEmail: 'someone@example.com', modelEffort: '', taskClass: '' }),
    'foreign')
})

test('片翼だけのトレーラは stamped ではなく degraded', () => {
  assert.equal(classifyCommit(claude({ taskClass: '' })), 'degraded')
  assert.equal(classifyCommit(claude({ modelEffort: '' })), 'degraded')
})

test('unknown/unknown は刻印済みに見えるが degraded', () => {
  // transcript が読めなくても hook は unknown/unknown を**宣言**する (ADR-092)。
  // 被覆率の上では 100% のままなので、被覆だけを見ると緑のまま空洞化する。
  assert.equal(classifyCommit(claude({ modelEffort: 'unknown/unknown' })), 'degraded')
})

test('model/effort の形をしていない値は degraded', () => {
  assert.equal(classifyCommit(claude({ modelEffort: 'claude-opus-5' })), 'degraded')
  assert.equal(classifyCommit(claude({ modelEffort: 'claude opus 5 / high' })), 'degraded')
})

test('申告と根拠は表記が違っても一致とみなす', () => {
  assert.equal(declarationAgrees('Claude Opus 5 <x@y>', 'claude-opus-5/high'), true)
  assert.equal(declarationAgrees('Claude Sonnet 4.6 <x@y>', 'claude-sonnet-4-6/high'), true)
})

test('別モデルの申告は drift として検出する', () => {
  assert.equal(declarationAgrees('Claude Sonnet 5 <x@y>', 'claude-opus-5/high'), false)
})

test('申告そのものが無いことは drift ではない', () => {
  // Co-Authored-By はモデルが散文で書く申告なので、無いことは「食い違い」ではない。
  assert.equal(declarationAgrees('', 'claude-opus-5/high'), true)
})

test('summarize は母集団から foreign を除く', () => {
  const { counts, population, missing } = summarize([
    claude(),
    claude({ modelEffort: '', taskClass: '' }),
    { authorEmail: 'human@example.com', modelEffort: '', taskClass: '' },
  ])
  assert.deepEqual(counts, { stamped: 1, missing: 1, degraded: 0, foreign: 1 })
  assert.equal(population, 2, '母集団は Claude 製のみ — 人間のコミットは分母にも入らない')
  assert.equal(missing.length, 1)
})

// ── Q2 母集団の境界 ────────────────────────────────────────────────────────
// この節は**この検査自身が一度素通りした**記録である。初版は「境界が見つかったか」
// だけを問うており、`--depth 1` のクローンで境界が HEAD 自身に化けた (親が無いので
// あらゆるファイルがそこで追加されたように見える)。母集団 1 件・欠測 0 件になり、
// Q1 が「MISSING_BASELINE を 0 に下げろ」と**指示した** — 従えば検査は永久に
// 無力化される。落ちてはいたが、落ち方が嘘だった。

test('shallow clone では母集団を決定できない', () => {
  const v = populationVerdict({ shallow: true, boundary: 'abc123', hasParent: false, isRoot: true })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'shallow')
})

test('境界が見つからなければ落ちる', () => {
  const v = populationVerdict({ shallow: false, boundary: null, hasParent: false, isRoot: false })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'not-found')
})

test('親を持たない境界は、本物の root でなければ切り詰めとみなす', () => {
  // 「見つかった」は「正しい」ではない。ここが初版の穴だった。
  const v = populationVerdict({ shallow: false, boundary: 'abc123', hasParent: false, isRoot: false })
  assert.equal(v.ok, false)
  assert.equal(v.reason, 'truncated')
})

test('親を持たない境界でも、本物の root コミットなら正当', () => {
  const v = populationVerdict({ shallow: false, boundary: 'abc123', hasParent: false, isRoot: true })
  assert.equal(v.ok, true)
})

test('親を持つ境界は正当', () => {
  const v = populationVerdict({ shallow: false, boundary: 'abc123', hasParent: true, isRoot: false })
  assert.equal(v.ok, true)
})

test('summarize は drift を stamped の中からだけ拾う', () => {
  // 欠測コミットは根拠を持たないので「食い違い」を主張できない。
  // 両方に数えると同じ 1 件が 2 度罰せられ、どちらの予算も読めなくなる。
  const { drift } = summarize([
    claude({ coAuthor: 'Claude Sonnet 5 <x@y>' }),
    claude({ modelEffort: '', taskClass: '', coAuthor: 'Claude Sonnet 5 <x@y>' }),
  ])
  assert.equal(drift.length, 1)
})
