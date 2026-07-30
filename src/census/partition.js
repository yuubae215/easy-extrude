/**
 * census/partition.js — 「列挙表が母集団を覆っているか」を問う 2 つの述語。
 *
 * ## なぜ表ごとに手で書かないのか (ADR-102)
 *
 * 原則 #31 の道具は「必要な種別を列挙して個数を検査する」形をとる。ところが
 * *列挙する側*も表であり、表それ自体は古びる — 8 つ目のプローブ、6 つ目の窓、
 * 10 個目の描き手は、誰かが手で足すまで表に載らない。載っていないものは
 * 検査対象のノードを持たないので、検査は**緑のまま素通りする**。
 *
 * 塞ぎ方は原則 #31 が既に言っている: *在るもの* (表の行) を辿るのをやめ、
 * **母集団を機械に数えさせて、分類されていない個数を問う**。表は「発見の結果」
 * ではなく「分類の宣言」になる。
 *
 * この module はその形を 1 度だけ書いた場所である。表ごとに手で書くと、
 * 逆向き検査を持つ表と持たない表が生まれる — 検査の側の非対称が、まさに
 * ADR-096/098/101 で潰してきた欠陥の形。
 */

import assert from 'node:assert/strict'

/**
 * **母集団分割** — コードから導出した母集団が、宣言 (対象 / 対象外) で
 * 覆われていることを両方向に問う。
 *
 * - 未分類が 0 個か (母集団に増えたのに表に無い = 表が古びた)
 * - 宣言が空回りしていないか (表に在るのに母集団に無い = 対象が消えた)
 *
 * 逆向きが要るのは、対象が 0 個になったことと規則が守られていることが
 * 区別できないため (原則 #31 の同型)。
 *
 * @param {object} spec
 * @param {string}   spec.what        人が読む母集団の名前 (エラー用)
 * @param {string[]} spec.population  **コードから導出した**母集団のキー
 * @param {string[]} spec.declared    規則の対象として宣言したキー
 * @param {{key: string, why: string}[]} [spec.excluded]  対象外として宣言したキーと理由
 * @param {string}   spec.howDerived  母集団の導出方法 (エラーメッセージで案内する)
 * @param {string}   spec.onNew       未分類が出たときに何をすべきか
 */
export function assertCoversPopulation({
  what, population, declared, excluded = [], howDerived, onNew,
}) {
  const declaredSet = new Set(declared)
  const excludedMap = new Map(excluded.map(e => [e.key, e.why]))

  const noReason = excluded.filter(e => !e.why || !e.why.trim()).map(e => e.key)
  assert.deepEqual(noReason, [],
    `\n[${what}] 対象外の宣言に理由が無い: ${noReason.join(', ')}\n` +
    '  正当な除外は「推論させず宣言させる」— 理由の無い除外は、忘れられた除外と区別がつかない (原則 #31)。\n')

  const unaccounted = population
    .filter(k => !declaredSet.has(k) && !excludedMap.has(k))
    .map(k => `  ${k}`)
  assert.deepEqual(unaccounted, [],
    `\n[${what}] 母集団に在るのに分類されていないものがある:\n${unaccounted.join('\n')}\n\n` +
    `  母集団の導出: ${howDerived}\n` +
    `  → ${onNew}\n` +
    '  なぜ: 表が「今日在るもの」の写しだと、明日足された 1 個は検査対象のノードを持たない。\n' +
    '  母集団を機械が数え、分類されていない個数を 0 に保つ形だけが古びない (原則 #31 / ADR-102)。\n')

  const populationSet = new Set(population)
  const stale = [...declaredSet, ...excludedMap.keys()]
    .filter(k => !populationSet.has(k))
    .map(k => `  ${k}${excludedMap.has(k) ? `  (対象外の宣言: ${excludedMap.get(k)})` : ''}`)
  assert.deepEqual(stale, [],
    `\n[${what}] 宣言されているのに母集団に存在しないものがある:\n${stale.join('\n')}\n\n` +
    `  母集団の導出: ${howDerived}\n` +
    '  → 表から行を消すか、名前が変わったなら追うこと。\n' +
    '  なぜ: 対象が消えたことは、規則が守られていることと区別がつかない — 空回りする\n' +
    '  規則は「緑」を出し続けるので、消えたことに誰も気づかない (原則 #31 の同型)。\n')
}

/**
 * **宣言の実在** — 例外・欠落として宣言した行が、いまも実在することを問う
 * (逆向きだけの検査)。
 *
 * 例外が在ること自体は正常。問題は**数えられていない例外**なので、
 * 「宣言された形が実在するか」を問い、直したのに宣言が残る状態を落とす
 * (予算が減らない = ratchet が回らない)。
 *
 * @param {object} spec
 * @param {string} spec.what
 * @param {{key: string, why: string}[]} spec.declarations
 * @param {(key: string) => boolean} spec.exists  そのキーが実在するか
 * @param {string} spec.onStale
 */
export function assertDeclarationsExist({ what, declarations, exists, onStale }) {
  const noReason = declarations.filter(d => !d.why || !d.why.trim()).map(d => d.key)
  assert.deepEqual(noReason, [],
    `\n[${what}] 理由の無い宣言: ${noReason.join(', ')}\n` +
    '  宣言は「数えるために書く」ものなので、理由が無ければ数える意味が無い。\n')

  const stale = declarations
    .filter(d => !exists(d.key))
    .map(d => `  ${d.key}\n      理由: ${d.why}`)
  assert.deepEqual(stale, [],
    `\n[${what}] 宣言された行が実在しない:\n${stale.join('\n')}\n\n  → ${onStale}\n`)
}
