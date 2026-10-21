/**
 * LabelSelectionCensus.test.js — 名札を持つ実体は、選ばれたとき名札でもそう言う
 *
 * 当事者 (2026-10-21): 「Zone とかのマップオブジェクトは選択するとラベルがハイライト
 * されるけど、他のオブジェクトはハイライトされないのはなんで？」
 *
 * 名札の仕組みは `EntityLabel` 1 つ (ADR-155 D1 / ADR-166 M3a) なのに、選択を名札に
 * 載せるかどうかは view ごとに決まっていた。マップ注釈と座標フレームは
 * `setHighlighted(sel)` を呼び、Solid と輸入メッシュは呼んでいなかった — 名札は
 * 「選択中かホバー中」に出るだけで、選ばれた名札とホバーされた名札が同じ絵だった。
 *
 * 欠陥は呼ぶ側ではなく**呼ばない側**に在るので、呼ぶ view を読んでも見えない
 * (原則 #31)。ここでは母集団を構文から導出する: `new EntityLabel(` を書くファイル。
 * そのうち `setHighlighted(` を書かないものは、理由つきで宣言しない限り落ちる。
 */

import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { collectSources, relPath, stripCommentsFlat } from '../census/sources.js'
import { assertCoversPopulation } from '../census/partition.js'

/** 名札を作るが、選択を名札に載せない — その理由。 */
const LABELS_WITHOUT_SELECTION = [
  { key: 'src/view/SceneView.js',
    why: 'ロボットの tcp の名札の factory (ADR-155)。tcp の名札は選べる実体の名前ではなく、'
       + '腕の先の印に添えた文字 — 選択はロボット本体が自分の view で運ぶ' },
]

test('名札を作る view のうち、選択を名札に載せないものは宣言されたものだけ', () => {
  const sources = collectSources().map(abs => ({
    rel: relPath(abs), code: stripCommentsFlat(readFileSync(abs, 'utf8')),
  }))
  const population = sources.filter(s => s.code.includes('new EntityLabel(')).map(s => s.rel)
  const highlighting = sources
    .filter(s => population.includes(s.rel) && s.code.includes('setHighlighted('))
    .map(s => s.rel)

  assertCoversPopulation({
    what:       '名札の選択強調',
    population,
    declared:   highlighting,
    excluded:   LABELS_WITHOUT_SELECTION,
    howDerived: 'src/** の非テストファイルのうち `new EntityLabel(` を書くもの',
    onNew:      '選択を受け取る所で `this._label.setHighlighted(selected)` を呼ぶこと。'
              + '呼ばないのが正しいなら、理由を LABELS_WITHOUT_SELECTION に書く',
  })
})
