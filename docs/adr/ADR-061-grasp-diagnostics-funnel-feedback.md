# 061. Grasp Diagnostics ファネル — 棄却の集計事実を「効いた感」フィードバックへ導出する

- Status: Accepted（実装済 2026-07-04）
- Date: 2026-07-04
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- References: ADR-060（契約統治 — ワイヤは決定事実のみ）, ADR-057（Grasp UI FSM）, ADR-059（空間ゴースト — 同じ「純粋導出 + 正直な degrade」パターン）, ADR-054（BFF 素通し + エラーエンベロープ）, PHILOSOPHY #29（Rigor on the Wire, Play in the Client）, #11（Silent Failures）, 上流 ADR-0007（diagnostics 棄却ファネル, contractVersion 3）

## Context — Goal（§1.2）

上流契約 v3 が grasp-search 応答に **必須・閉じた `diagnostics`**（棄却ファネル:
`candidatesGenerated / rejectedByReach / rejectedByIk / rejectedByInterference /
feasible / returned / reachNearestMiss`、不変条件 `generated = reach + ik +
interference + feasible`）を追加した。従来の UI は候補ゼロのとき「No candidates
returned」の一行だけで、ユーザは *何を直せば効くのか* を知る手掛かりが無かった。

**Goal**: 入力（重み・レイアウト）を変えるたびに「効いた / 惜しい / ダメ」が即座に
返るフィードバック面を、**判定ロジックを一切クライアントへ持ち込まずに**作る。

**力学・制約**:
- 契約は上流所有。消費側は Schema から型を導出するだけ（CLAUDE.md「BFF と契約」）。
- BFF は薄い窓口のまま: 検証して素通し、判定・整形の意味論を持たない。
- 演出（棒の幅・支配段の強調・差分チップ・メーター曲線・文言）は全て UI 所有の
  導出であり、ワイヤに新フィールドを要求しない（PHILOSOPHY #29 / ADR-060）。

## Options considered

- A: 候補リストだけ更新し diagnostics は無視 — tradeoff: v3 追従は最小だが、候補ゼロが
  無言のまま（#11 違反に近い）。せっかくソルバが決定した説明事実を捨てる。
- B: UI/BFF に簡易リーチ計算等の推測ロジックを足して提案を作る — tradeoff: 委譲先の
  実装を推測する越境（スコープ境界違反）。ワイヤ事実と食い違う「嘘の理由」を作り得る。
- **C: 純粋導出層 + FSM 載せ替え + 差分キャリー【採用】** — ワイヤ事実の表示に徹し、
  演出はすべてクライアント導出。tradeoff: reachNearestMiss のメーター充填はスケール
  基準を持たない表示曲線（後述）に留まる。

## Decision — Strategy（§1.2）

**C** を採る。層ごとの責務:

1. **BFF（変更なしの素通し）** — ルートは v3 スキーマで両端検証して body を verbatim
   で返すだけ。submodule pin → v3、`gen:contract-types` で `.d.ts` 再生成のみ。
   pre-v3 応答（diagnostics 欠落）は既存の適合検査が 502 で弾く（ドリフト検出が
   そのまま働く — 新分岐なし）。
2. **純粋導出層 `src/view/GraspFunnelMath.js`**（THREE-free・入力不変・`node --test`）:
   - `funnelStages(d)` — 契約の段順（reach → ik → interference）で entered/rejected/
     remaining/fraction を逐次計算（棒の幅）。generated=0 でも NaN を出さない。
   - `dominantStage(d)` — 最大棄却段（同数は先に濾した段）。「何を直せば効くか」を
     ユーザが *自分で* 発見する強調シグナルで、提案文は作らない。
   - `funnelDelta(prev, cur)` — 単純減算。符号の意味付け（棄却減=緑）は表示側。
   - `nearMissCloseness(miss)` — `1/(1+miss)` の単調表示曲線。**数値そのもの**
     （ジオメトリ長さ単位）を必ず併記し、曲線は「惜しさ」の演出のみを担う。
   - 型は BFF が Schema から生成した `.d.ts` を JSDoc import で参照（契約の再定義なし）。
   - malformed / 欠落 diagnostics は `null` へ degrade（ファネルを捏造しない — #11）。
3. **`GraspController`（FSM 唯一の writer — ADR-057）** — `results` 状態に
   `diagnostics`（ワイヤ事実 verbatim）と `prevDiagnostics`（直前 results の
   diagnostics の明示キャリー）を載せる。キャリーは第二の源ではなく「差分表示の
   ための導出」と註記（§1.1）。error 状態には載せない（不正状態の表現不能を維持）。
4. **`GraspSearchPanel`** — results で `DiagnosticsFunnel` を描画:
   - ファネル棒 + 段ごとの `−n` + 支配段の琥珀ハイライト「← biggest filter」。
   - `candidatesGenerated === 0` → 棒ではなく **入力ガイド**（表面サンプル空 =
     把持可能なジオメトリの有無を確認する誘導）。
   - `reachNearestMiss != null` → 惜しさメーター（充填=closeness、文言 so close /
     almost / out of reach）+ 生の数値。
   - `prevDiagnostics` があれば段ごとの差分チップ（▼棄却減=緑 / ▲増=赤、0 は無表示）。
   - diagnostics 不在（旧レスポンス想定）はファネル非表示で従来表示に degrade。

## 非目標（やらないこと）

- 契約フィールドの追加・変形（Schema 側でしか変えない — ADR-060）。
- クライアント側のリーチ/IK/干渉の再計算・推測に基づく修正提案の生成。表示する
  理由は常に *ソルバが決定した集計事実* のみ。

## Evidence（§1.2）

- `server/test/grasp.contract.test.js` **16 件**: v3 適合（候補あり + reachNearestMiss
  数値 / 候補ゼロ + ファネル / null）、pre-v3（diagnostics 欠落）拒否、演出フィールド
  密輸（`meterColor`）拒否、素通し（diagnostics が verbatim でクライアントへ）。
- `src/view/GraspFunnelMath.test.js` **9 件**: 段順・逐次残余・generated=0 の NaN 回避・
  malformed→null・入力不変・支配段タイブレーク・差分・メーター単調性。
- `src/controller/GraspController.test.js` +**5 件**: results が diagnostics を verbatim
  で運ぶ / 2 回目 run の prevDiagnostics キャリー / 候補ゼロ + ファネルは合法 results /
  pre-v3 は null degrade / error 状態に diagnostics 非漏出。
- `test:context` 367/367、`test:contract` 16/16、`tsc --noEmit`・`vite build` クリーン。
