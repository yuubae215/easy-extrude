# 058. Context オーサリング UX — 例を土台に編集する（fork & tweak）

- Status: Accepted (Phase 1 実装済 — fork + seed-anchor)
- Date: 2026-06-30
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- References: ADR-051（Requirement Intake / テンプレートギャラリー）, ADR-050（Context-first / 単一権威入口）, ADR-046（Context DSL / OpenQuestion・FormProjection）, ADR-049（KPI/criterion/admissible/RoleKpiCatalog）, ADR-052（Why / 同義語商）, ADR-057（Grasp UI — API 価値の出口）

## Context — Goal と力学（§1.2 Goal）

要件は解の形（「もっと良い設定 UI」）で来た。§1.2 で *性質* へ持ち上げる。

観測された痛み（ユーザ報告 + 実コード `IntakePanel.jsx` / `examples/*.json`）:
要件をひとつ書くだけで `kpi.expr`（`fov_cover(v_base_footprint)` のような **関数呼び出し
ミニ言語**）、`criterion.value`（妥当値はドメイン知識）、`admissible.region`（座標範囲）、
`constrains`/`by`（先に ref が必要）を埋めねばならず、**どの KPI 関数が在るか・何を意味するか
が UI から発見できない**。ユーザの言葉で言えば「何を設定するか分からない項目が多い」
「サンプルがないと埋められない」。

**Goal**: Context doc のオーサリングの活性化エネルギーを下げる。具体的には、
**白紙のスキーマに対峙させる代わりに、埋まった具体例を複製し、元の値を *アンカー* として
見せながらフィールド単位で上書き（類推オーサリング）できるようにする。** API（grasp-search,
ADR-057）が返す価値は高いが、その入口の doc を作れなければ価値に到達できない — 入口の
摩擦を消すのが Goal。

**力学・制約**:
1. **単一権威入口（§1.1 / PHILOSOPHY #1）**: doc の採用・変更は `ContextService`
   （`adoptDoc`/`loadContext`/`applyContextDoc`）と純粋ビルダ（`DocBuilder`）+ コマンド
   （`AddDocEntryCommand` 系の before/after スナップショット）を通る。fork も per-field 編集も
   この経路に乗せ、直接変異させない。
2. **閉じた語彙は別に正本がある（§1.1）**: KPI 関数名・演算子・単位は自由テキストの対象では
   なく、カタログ（ADR-049 `RoleKpiCatalog`、ADR-052 同義語商）由来の *選択肢* であるべき。
3. **既存資産**: ADR-051 のギャラリー（`TemplateCatalog`/`TemplateGallery.jsx`）は例を
   *丸ごと開く* が、フィールド単位の **生きたテンプレート**ではない。`DocBuilder` の純粋
   ビルダ群と undo 可能コマンドは既にある。
4. **入力は契約に触れない**: 本 ADR はフロントのオーサリング UX のみ。grasp-contract や
   Context DSL スキーマは変えない（拡張が要れば別 ADR）。

**様態の判定（§1.3）**: オーサリングは「Q1→Q2→…」の決め打ち逐次ではなく、
**任意順でどのフィールドも触る裁量編集** = CMMN 的（事象・状態駆動）。よって逐次ウィザード
（BPMN）より、いつでも任意フィールドを上書きできる **生きたテンプレート**が様態に合う。
これが spine C（ウィザード）を退け B（fork & tweak）を採る構造的根拠。

## Options considered

- **A: 注釈付きフォーム + カタログ** — 各フィールドに what/why + 例チップ + 閉じた語彙の
  ピッカー + progressive disclosure。tradeoff: 低リスクだが「白紙＋ヒント」の域で、
  *埋まった全体像* は見えない。「サンプルがないと埋められない」を間接的にしか潰さない。
- **B: 例を土台に編集（fork & tweak）【採用】** — 最も近い埋まったサンプルを複製し、元の値を
  藄字アンカーに見せつつフィールド単位で上書き。tradeoff: 「近い例が無い」と弱い（→ 例の
  キュレーションが前提資産になる）。
- C: ガイド付きウィザード（interview） — 平語 Q&A で doc を組む。tradeoff: 初見に最優しいが
  最重量・上級者に遅い・様態が BPMN で裁量編集に合わない。
- D: 現状維持（ギャラリーは丸ごと開くだけ） — tradeoff: 痛みが残る。

## Decision — Strategy（§1.2 Strategy）

**B（fork & tweak）** を背骨に、A の field-level 補助を *従* として取り込む。

1. **「例を土台に編集」エントリ（ギャラリー拡張）**: `TemplateGallery` の各 example カードに
   *この例を土台に編集* アクションを追加。選択で `ContextService.adoptDoc(deepClone(exampleDoc))`
   を呼び、**元の example doc（不変）を読み取り専用シードとして保持**する。シードは
   *第二の真実源ではない* — それは example ファイルの内容そのもので、表示用アンカーに過ぎない
   （§1.1）。働く doc は従来どおり `ContextService` が所有。

2. **シード・ゴースト（藄字アンカー）**: 各編集フィールドは、働く doc の現在値を入力に、
   シード doc の対応値（同一 `ref` + フィールドパスで引く）を **藄字プレースホルダ**として
   並置する。対応が無い（ユーザが新規追加した）フィールドはゴースト無し（誇張しない —
   PHILOSOPHY #11）。シード値＝類推の手本、現在値＝上書き結果、の差が一目で分かる。

3. **フィールド単位編集 = スナップショットコマンド**: フィールド変更は純粋な
   `DocBuilder` 系編集関数で *新 doc* を作り（入力不変 — PHILOSOPHY #6）、
   before/after スナップショットコマンドで push（`AddDocEntryCommand`/`EditAdmissibleCommand`/
   `AnswerQuestionCommand` と同じ族）→ `applyContextDoc({regenerate})` でシーン再生成。
   *実装メモ*: 3 つの既存コマンドは同形なので、汎用 `createDocEditCommand(ctxService,
   before, after, label, vc)` へ一般化して各々を特殊化する余地（別タスク・任意）。

4. **従の field-level 補助（A の取り込み）**: 閉じた語彙（KPI 関数名・演算子・単位）は
   自由テキストでなく **カタログ選択**に（`RoleKpiCatalog` / 同義語商 由来 — §1.1/§1.3）。
   advanced フィールド（`negotiability`/`source` 等）は progressive disclosure で折りたたみ。
   これらは *spine ではなく補助* — fork が主、注釈/ピッカーが従。

5. **例ライブラリのキュレーション（前提資産）**: B は「近い例」に依存するので、
   シナリオ別に *よく注釈された* example doc 群を整備し `TemplateCatalog` で索引するのを
   **本 ADR の明示的成果物**とする（例が貧弱なら背骨が折れる — §5 証拠なき完了禁止の予防）。

**変える/新設する契約**: なし（フロント UX のみ）。新設はフロント内部の UI 状態
（`context.authorSeed` = 読み取り専用シード参照）と編集コマンドのみ。

## State machine（§1.4 の適用判定）

§1.4 の発動条件（実体が 3 状態以上、または不正遷移が事故）を **満たさない**。
オーサリングは reactive な裁量編集で、フィールドを任意順に上書きするだけ、不正遷移で
データ破損は起きない（コマンド経路が doc 不変条件を `compileContext` で守る）。
よって重い状態機械は **起こさない**（§5 過剰モデリング禁止）。唯一の弱い状態差は
*forked（シードあり）* か *blank（シードなし）* かで、これは `context.authorSeed` の
有無で導出される単一ブール相当（§1.4 の「2 状態・無害なら boolean のまま」）。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

**肯定的**:
- 「サンプルがないと埋められない」を直接解消 — 全フィールドが実在値で seed 済み、
  ユーザは類推で上書きするだけ。
- 「何を設定するか分からない」も、埋まった例を見ること自体が説明になる（＋従のカタログ/
  注釈で補完）。
- 既存資産に直接乗る（ギャラリー ADR-051 / `DocBuilder` / コマンド族）。契約・スキーマ無改変。

**受け入れるコスト / 否定的**:
- 「近い例が無い」ケースに弱い → 例ライブラリのキュレーションが継続コスト。フォールバックは
  blank + 注釈（A の最小形）。
- シードと働く doc の乖離表示に端ケース（ref リネーム時に対応が切れる → ゴースト消失。
  正直に消すのが正解、PHILOSOPHY #11）。
- フィールド編集ごとの再生成コスト（`EditAdmissibleCommand` で既に受容済の水準）。

**検証（証拠）**:
- 純粋層は単体テスト可能（THREE-free）: `DocBuilder` 21 件 + コマンド族テストが既存。
  per-field 編集関数とシード対応引きは純粋関数として追加テスト可能。
- 採用経路は既存テスト下: `adoptDoc`/`applyContextDoc` は `ContextService.test.js` で担保。
- **未充足（正直に明示, §5）**: シード・ゴースト UX と例ライブラリの十分性は未構築・未計測。
  よって本 ADR は Proposed。採択時は「Phase 1: fork + seed-ghost（最小例 1–2 本）」で
  小さく出して計測 → 例拡充、の順を推奨。

**波及（blast radius）**:
- `src/components/Context/TemplateGallery.jsx`（*土台に編集* アクション追加）。
- `src/components/Context/IntakePanel.jsx`（RequirementForm 等に seed-placeholder + per-field
  編集 + progressive disclosure）。
- `src/controller/ContextController.js`（`forkExample`/`editDocField`、シード保持）。
- `uiStore`: 読み取り専用 `context.authorSeed`（+ リセットは `contextEnd`）。
- 任意: `src/command/` に汎用 `createDocEditCommand`（既存 3 コマンドの一般化）。
- `examples/` + `src/context/TemplateCatalog.js`（注釈付き例ライブラリのキュレーション）。
- 従: 閉じた語彙ピッカー（`RoleKpiCatalog`/同義語商 を読むだけ — 正本は変えない）。
- Docs: README index, CLAUDE.md ナビ/履歴, CODE_CONTRACTS, SCREEN_DESIGN, EVENTS。
  ADR-051 の Related に本 ADR を相互リンク。

## 実装 (Phase 1 — fork + seed-anchor)

採択時の推奨どおり、最小の Phase 1（fork エントリ + シード・アンカー）を実装した。
add-only な `IntakePanel` の現実に合わせ、**シードは「埋まった手本」として要件フォームに
*編集可能なアンカー*を供給する**形を採った（藄字プレースホルダの上位互換 = クリックで実値を
流し込み、その場で tweak）。フィールド単位での *既存エントリ in-place 編集* は Phase 2 へ送る
（add-only フォームで同一 ref を再追加すると重複になるため、コピー時に ref を `_copy` 接尾辞化
して新規 ref を促す — §3 の「フィールド単位編集 = スナップショットコマンド」の完全形は後続）。

- **純粋層** `src/context/SeedAnchor.js`（THREE-free・入力不変・bare `node --test`）:
  `buildSeedIndex(seedDoc)`（kind×ref で索引、ref 無しエントリは無視 = 偽アンカー非捏造、
  PHILOSOPHY #11）/ `seedEntry` / `seedIsEmpty` / `describeSeedRequirement`（chip ラベル）。
  シードは読み取り専用ミラーで **第二の真実源ではない**（§1.1）。10 テスト（`SeedAnchor.test.js`）。
- **エントリ** `TemplateGallery.jsx`: example カードに「✎ Use as a starting point (fork & edit)」
  を追加 → `onForkTemplate(id)`。blank カードは対象外（アンカーする実値が無い）。
- **コントローラ** `ContextController.forkExample(id)`: example doc を **deep-clone** して
  working doc 化（モジュールを触らない）→ `_loadThen`（シーン再生成、単一権威入口）→
  `_startNegotiation` 後に `contextSetSeed(deepClone(seed))` + intake タブを開く。シードを
  `_startNegotiation` の **後**に設定するのは `contextStart` が `authorSeed` を null へ戻すため。
- **uiStore**: `context.authorSeed`（読み取り専用シード参照）+ `contextSetSeed`。`contextStart` /
  `contextEnd` でリセット（fork 以外の negotiate には stale シードが残らない）。
- **`IntakePanel`**: `buildSeedIndex(ctx.authorSeed)` を `useMemo` で索引し、シード名バナー +
  `RequirementForm` のシード requirement chip 群（クリックで `fillFromSeed` = 全フィールドに
  実値を流し込み、ref を `_copy` 接尾辞化）を描画。シードが無ければ何も出さない（誇張しない）。

検証: `test:context` **310/310**（SeedAnchor +10）、`tsc --noEmit` クリーン、`vite build`
クリーン。契約・スキーマ・BFF・ドメイン無改変（フロント UX のみ — スコープ境界）。
**残（Phase 2 任意）**: 既存エントリの in-place per-field 編集（汎用 `createDocEditCommand`）、
actor/variable へのシード chip 拡張、閉じた語彙ピッカー（`RoleKpiCatalog`/同義語商）、
注釈付き例ライブラリのキュレーション拡充。

## Lens notes

- **§1.3 様態（BPMN vs CMMN）**: 裁量編集 = CMMN → 生きたテンプレート（任意フィールドを
  いつでも上書き）が適合。ウィザード（BPMN 逐次）を退けた根拠。
- **§1.1 真実の源は一つ**: 働く doc の権威は `ContextService` 一点。シードは example ファイル
  の読み取り専用ミラーで第二源ではない。閉じた語彙はカタログ/商に正本を持つ → 自由テキストを
  ピッカーへ。
- **§1.4 適用判定**: 発動条件を満たさず重い FSM を起こさない（§5 過剰モデリング禁止の実践）。
- **§1.2 Goal と解の分離**: 「良い設定 UI」→「白紙でなく埋まった例を類推で上書き」へ。
  spine を 1 つに絞り、A を従に降格、C/D を退けた。
