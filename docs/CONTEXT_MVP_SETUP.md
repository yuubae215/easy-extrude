# Context DSL MVP — 検証環境構築・実行手順

> **📦 凍結アーカイブ (2026-07-19)** — 本手順は ADR-046 ドラフト時点の MVP
> 検証用で、現在は**役目を終えている**。`src/context/` は本体に取り込み済みで
> zip 展開は不要。Context DSL は v0.4 (`schema/context-0.4.schema.json`) まで
> 進化し、本番機能化されている (ADR-050)。現行の実行方法は `pnpm test:context`。
> 入口は `docs/NAVIGATION.md` の Context 系トリガ行を参照。以下は歴史的記録。

ADR-046 ドラフトのゴールデンテスト MVP。本手順は easy-extrude リポジトリ (main, Node ≥ 18) を前提とし、**当方のクリーン環境 (Node v22) で 8/8 パス済み**。既存コードへの変更はゼロで、追加のみです。

---

## 1. 成果物の配置

同梱の zip をリポジトリルートで展開するだけで、以下に配置されます:

```
easy-extrude/
├── examples/
│   └── factory_context.json          ← テストデータ (context/0.1)
└── src/
    └── context/                      ← 新設 (src/layout/ と同格の純粋計算層)
        ├── ContextDslSchema.js       ← 定数・不変条件の定義
        ├── ContextValidator.js       ← R1〜R5 ルール = OpenQuestion 生成器
        ├── ContextCompiler.js        ← $fact / $decision / $expr 解決 → layout/1.0
        └── ContextCompiler.test.js   ← ゴールデンテスト (node:test, 8件)
```

依存パッケージの追加は**なし**(node:test / node:assert のみ)。pnpm install も不要。

## 2. 実行手順

```bash
git checkout -b feat/context-dsl-mvp
unzip context-dsl-mvp.zip            # リポジトリルートで展開
node --test src/context/ContextCompiler.test.js
```

期待結果:

```
ok 1 - golden: factory_context compiles to exactly factory_layout
ok 2 - chain: compiled layout is valid layout/1.0 and yields the same scene as the golden file
ok 3 - validator emits the expected OpenQuestions for the scenario
ok 4 - acceptance checks depending on unknown/assumed facts are blocked
ok 5 - removing a TraceLink makes the context invalid (no orphan spec)
ok 6 - referencing an interval fact directly via $fact throws
ok 7 - referencing an "unknown" attribute via $fact throws
ok 8 - a trace.from pointing at a nonexistent requirement is rejected
# pass 8 / fail 0
```

CI に載せる場合は package.json scripts に追加:

```json
"test:context": "node --test src/context/ContextCompiler.test.js"
```

注意: `node --test src/context/`(ディレクトリ指定)は Node 22 ではファイル発見に失敗するため、**ファイルパス指定**を使ってください。

## 3. ゴールデン契約の中身

```
compileContext(factory_context.json)
  → { layoutDsl, openQuestions, blockedChecks, trace }

assert: layoutDsl ≡ examples/factory_layout.json          (test 1, deepStrictEqual)
assert: compileLayout(layoutDsl) ≡ compileLayout(golden)  (test 2, 既存コンパイラ経由の全鎖)
```

つまり「**要件文脈から出発しても、手書き仕様と bit 単位で同じシーンに到達する**」ことが合格条件です。test 2 は既存の `validateLayoutDsl` / `compileLayout` を import して実行するため、layout/1.0 側のリグレッション検知も兼ねます。

## 4. テストデータ設計の要点 (factory_context.json)

齟齬対策の設計判断がそのままデータに現れている箇所:

**(a) 「3m弱」は interval のまま保持し、Decision で確定**
```jsonc
"given":     { "ref": "f_outlet_to_bench", "quantity": { "interval": [2700, 3000] }, "status": "asserted" }
"decisions": { "ref": "d_bench_distance", "resolves": "f_outlet_to_bench", "nominal": 2800,
               "decidedBy": "sier", "status": "proposed", "rationale": "..." }
```
仕様側は `{ "$decision": "d_bench_distance" }` でのみ 2800 を参照できます。`$fact` で interval を直接引くとコンパイルエラー(test 6)。**誰が・なぜ 2800 に決めたかが必ず残る**のが invariant 2 の実装です。

**(b) 数値の出自を式で残す**
```jsonc
"position": { "z": { "$expr": "f_bench.attrs.height.value + f_plate.attrs.thickness.value / 2" } }  // → 815
```
「815 はどこから来たのか」が顧客の発話 (800, 30) まで遡れます。eval は使わず約 60 行の再帰下降パーサで `+ - * / ( )` のみ。

**(c) unknown は値として一級**
コンセント定格電流・回路共有・作業台耐荷重・専有面積実測値は `"unknown"` のまま入力。バリデータ R1 が OpenQuestion を機械生成し、`$fact` で仕様に流そうとするとエラー(test 7)。

**(d) 責任未合意も一級**
`o_power.responsible: "unassigned"` → R4 が「請求確定をブロックする」OpenQuestion を生成。

**(e) 検収ブロック**
`a_torque.requires: ["f_bolt"]` で、ボルト仕様が `status: assumed` のため自動ブロック(invariant 3、test 4)。

## 5. 効果検証の観点(MVP の評価軸として提案)

1. **再現性**: `compileContext` は決定的か — 同入力で常に同出力(test 1/2 が担保)
2. **検出力**: シナリオ原文から人手レビューで拾えるギャップのうち、R1/R4/R5 が機械検出した割合 — 今回は 定格電流・回路共有・耐荷重・面積実測・給電区分・ボルト仕様 の 6 件
3. **誤検出**: OpenQuestion のノイズ率(今回の 5 OQ + 2 blocked に不要なものがないか、Yuki さんの実務目線での判定をお願いします)
4. **記述コスト**: factory_context.json は golden の約 2.2 倍の行数。トレースと出自の対価として許容か

## 6. 既知のスコープ外 (Phase 2)

- static 述語 (`footprint_within` 等) の**実行**エンジン — 現状は宣言とブロック判定のみ
- baseline スナップショット・署名イベント・diff (瑕疵境界の運用)
- `interpret --ai` の生成先を context/0.1 に切替
- CLI サブコマンド `pnpm context check`

## 7. トラブルシュート

- `ERR_MODULE_NOT_FOUND` → 展開先がリポジトリルートか確認(test は `../layout/LayoutCompiler.js` を相対 import)
- test 1 だけ落ちる → examples/factory_layout.json がローカルで改変されていないか `git diff examples/` を確認(1mm の差分でも落ちることを検証済み)
