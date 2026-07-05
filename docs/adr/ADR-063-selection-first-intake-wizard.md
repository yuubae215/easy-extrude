# 063. 選択優先インテーク — ウィザード・パラメトリックアセット・KPI 式カタログ（白紙入力不能の前提）

- Status: Accepted (Phase 1 + Phase 2 + Phase 3 実装済 2026-07-05; Phase 4–5 パラメトリックビューワ/統合は後続)
- Date: 2026-07-05
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし（ADR-051 の入口カタログを拡張、ADR-058 の seed 系を包含する上位設計）
- References: ADR-062（三層方針 — 本 ADR は体感層の中核実装計画）, ADR-051（要件入力の複数入口）,
  ADR-058（fork & tweak / IntakeAssist）, ADR-050（正準 doc / シーンは導出）, ADR-049（KPI/クライテリア,
  RoleKpiCatalog R8）, ADR-045（Layout DSL）, ADR-047（ゴースト系譜）, PHILOSOPHY #1/#3/#11/#28/#29

## Context — Goal（§1.2）

実際にフロントを触った当事者フィードバック（2026-07-05, dogfooding）:

> フォームにいちいち考えて打ち込むのがつらい。フロントの検証自体もつらい。KPI も
> すぐには思い付かない — このフォームに対面したときに打ち込めない。

ADR-051（4 入口）と ADR-058（fork & tweak・seed chips・GapNote）は入力の**摩擦**を
下げたが、より根本の問題は摩擦ではなく **想起（recall）**である: 白紙のフィールドは
「何を書くべきか知っている」ユーザを前提にしており、KPI 式・許容区間・変数名は
対面した瞬間には思い付けない。seed chip は「手本を見ながら書く」を可能にしたが、
依然として *書く* ことをユーザに求めている。

**Goal（解でなく性質で）**:

1. **想起ゼロで開始できる** — ユーザは何も思い付けない前提で、すべての入力面が
   「選ぶ・調整する」から始まる（recognition over recall）。書く行為は常に
   「選んだものの改変」であって「白紙からの創作」ではない。
2. **表現は操作で、記録は値で** — ユーザの「言いたいこと」は 3D モデルの
   パラメトリック操作で表現でき、コミットされる成果物は常にそこから**変換された
   数値・テキスト**（正準 doc — ADR-050 の不変条件を崩さない）。
3. **専門家の全カスタマイズ経路は残る** — 既存の未記入フォームは廃止せず、
   自作 KPI・自由入力の**エキスパート脱出口**として段階開示の最深部に置く。

**力学・制約**:

- 正準は doc、シーンは導出（ADR-050）。3D 操作を入力面にしても第二の源を作らない。
- 既存資産の現状: `RoleKpiCatalog` は KPI **名のみ**（式・単位を持たない —
  `kpiCatalogChips` は名前を埋めるだけ）。`TemplateCatalog` は 4 doc テンプレート。
  パラメトリック 3D アセットの登録機構は存在しない。ウィザードも存在しない。
- ADR-062 の三層方針: 各ステップの検証は証明層（validator / 述語）の事実の表示で
  あり、演出は導出。ウィザードはそのループを **1 ステップ 1 周** で回す器になる。
- スコープ境界: アセットは**宣言的データ**（スキーマ/カタログ = in-scope）。
  アセットの推薦・類似検索は外部レコメンダの責務（ADR-056）。

## Options considered

- A: **現状維持（fork & tweak + seed chips の改良継続）** — tradeoff: 追加コスト最小
  だが、当事者の dogfooding が「それでも打ち込めない」と示した。想起の問題は
  摩擦低減の延長では解けない。
- B: **NL インテークを主経路に昇格（自由発話 → 抽出）** — tradeoff: 「KPI が思い
  付かない」ユーザは NL でも言語化できない。保守的抽出（ADR-051 Phase 4）は
  unknown を量産し、結局フォームでの確定作業に戻る。想起の問題が場所を変えるだけ。
- **C: 選択優先ウィザード + パラメトリック 3D アセット + KPI 式アセット【採用】** —
  tradeoff: アセット（ウィザード定義・式カタログ・パラメトリックアセット）の
  事前登録と保守という新しい継続コストを引き受ける。登録が貧しければ「選べるものが
  ない」に退行するため、カタログはカタログ自体が版管理資産（R8 と同じ運用ループ）。

## Decision — Strategy（§1.2）

**C** を採る。**「ユーザは最初からこのフォームに自分で入力できない」を開発前提**とし、
すべてのインテーク面を次の段階開示で設計する:

```
ガイド付き（ウィザード: 選ぶだけ）
  ⊃ 支援付き（フォーム + リスト/チップ/式アセット: 選んで改変）
    ⊃ エキスパート（既存の未記入フォーム: 自作 — 廃止しない）
```

### 1. 正規の入力順序（ウィザードの背骨 — BPMN 逐次）

ユーザ体験の正規ルートを次の 4 段に固定する（各段の成果物は常に doc エントリ）:

1. **ウィザード** — フォームに必要な情報を*順番に*埋める。各ステップは選択肢
   （テンプレート・リスト・アセット）を必ず提示し、白紙フィールドを先頭に出さない。
   ステップに必要な知識（何を訊くか・選択肢の出所・完了条件）は**ウィザード定義
   アセット**として事前登録する。
2. **表示テンプレート** — いくつかの完成形テンプレート（`TemplateCatalog` の拡張）
   から出発点を選ぶ。「空のプロジェクト」はエキスパート専用の位置づけへ。
3. **パラメトリックビューワ** — 選んだテンプレート/アセットを、ユーザが「言いたい
   もの」へ**パラメトリックに変形**する 3D 対面 UI。ハンドル・スライダで操作し、
   ライブでゴースト/バンドが応答する（ADR-047/051 の系譜）。**最終入力はそこから
   変換された数値・テキスト**であり、3D 状態そのものは決してコミットされない
   （楽観プレビュー + 悲観コミット — ADR-050 Phase 3 と同型）。
4. **KPI 評価** — 最後に KPI で評価を宣言する。**KPI は式アセット**（あらかじめ
   用意された式のカタログ）から選び、パラメータ（閾値・単位・対象変数）だけを
   改変して使う。全カスタマイズしたい人だけが既存の未記入フォームで自作する。

### 2. アセットレジストリ（宣言的データ — すべて純粋層・版付き）

| レジストリ | 現状 | 本 ADR での姿 |
|-----------|------|-------------|
| **ウィザード定義** | なし | 新設。ステップ列・各ステップの選択肢ソース（どのカタログを引くか）・完了述語（validator の gap 述語と同一参照 — ADR-058 の規律を継承）を宣言する純粋データ。 |
| **KPI 式アセット** | `RoleKpiCatalog`（名のみ, `role-kpi/1.0`） | 名 → **式アセット**へ拡張: `{name, discipline, unit, exprTemplate, params[], description}`。バージョンを `role-kpi/2.0` へ（additive: 1.0 の名前配列も受容）。`kpiCatalogChips` は式アセットチップへ育つ。R8（義務 KPI 検査）は同じカタログを読み続ける（§1.1 — 源はひとつ）。 |
| **表示テンプレート** | `TemplateCatalog`（4 doc） | 拡充 + 各テンプレートに「ウィザード開始点」「パラメトリック化された変数」のメタを追加。 |
| **パラメトリック 3D アセット** | なし | 新設。アセット = **Layout DSL 断片 + パラメータスキーマ**（例: セル寸法・コンベア長・ロボット台数）。パラメータ変更 → DSL 再コンパイル → シーン更新、コミット時はパラメータ値が doc の変数/事実として記録される。DSL は既存 `layout/1.0` のまま（アセットはデータであり言語拡張ではない）。 |
| **選択リスト（閉じた語彙）** | ADR-058 Phase 2 残課題 | discipline・domain・unit 等のフォーム語彙をリスト化（ウィザードと支援付きフォームが共有）。 |

登録が貧しいカタログは「選べない」へ退行するため、**カタログの行追加を正攻法の
拡張点**として運用する（`QUOTIENT_TABLE` / R8 カタログと同じループ）。

### 3. 二つの入力面と一つの正準

- **3D モデル改変 UI（パラメトリックビューワ）** — ユーザの表現意図を確認する面。
  入力デバイスであって源ではない: コミットは変換された数値/テキストのみ。
- **テキスト/数値フォーム** — 何も無しではユーザが入力できない前提を全フィールドに
  適用し、リスト・式アセット・seed chip のいずれかを常に添える（白紙で対面させない）。
- 両面とも既存の**単一権威経路**（`DocBuilder` → `createDocEditCommand` 系 →
  `ContextService.applyContextDoc`）へ合流する（#1）。ウィザードは新しい書き込み
  経路を作らない — 既存コマンドの**順序付きの器**である。

### 4. ウィザードの状態設計（§1.4 — クラスより先に）

状態: `inactive` / `step(k)`（k = 定義アセットのステップ index、ステップ内 draft を
保持）/ `review`（最終確認）。遷移: `next` は完了述語（= validator gap 述語）が空の
ときのみ許可（不足理由は GapNote で常時表示 — 無言 disabled 禁止, #11）、`back` は
常時可、`exit` は任意時点で可。**各ステップの確定は即座に CommandStack を通る doc
コミット**とし、途中離脱しても doc は常に妥当な作業状態（all-or-nothing の巨大
モーダルコミットを禁止 — 部分進捗が成果物）。禁止遷移: 完了述語が偽のままの
`next`、`review` を経ない一括確定。draft はステップローカルの transient で
uiStore の doc スライスへ載せない（第二の源にしない — §1.1）。

### 5. ADR-062 ループとの接続

各ウィザードステップ・各パラメータ操作が ADR-062 の証明フィードバックループを
1 周する: 選択/操作 → 決定的 core の検証（validator / 述語 / 再コンパイル）→
事実 → 演出（ライブバンド・着地フラッシュ・差分チップ）→ 気づき → 次のステップ。
ウィザードは「ループを順番に並べた通路」であり、演出プリミティブ（ADR-062
Phase 1）をそのまま消費する。

## 非目標（やらないこと）

- 既存の未記入フォーム・4 入口（ADR-051）・fork & tweak（ADR-058）の廃止。
  すべて段階開示の中の層として残る。
- アセットの自動推薦・類似検索・embedding によるマッチング（外部レコメンダの責務
  — ADR-056。カタログの決定的な列挙と選択のみが in-scope）。
- Layout DSL / Context DSL / 契約スキーマの版上げを伴う言語拡張。パラメトリック
  アセットは既存 DSL の上の**データ**である。
- ウィザードによる入力の強制（正規ルートの提示であって、他入口の封鎖ではない）。

## Consequences — Evidence と tradeoff（§1.2）

- **肯定的**: 「何を書くべきか知らない」ユーザが最初の 1 doc を完成できる — 本アプリ
  の価値仮説（入力してもらえること）の最大障壁が外れる。3D 操作 → 数値変換の設計に
  より、doc 正準の不変条件（ADR-050）を保ったまま「モデルを触って要件を言う」体験が
  成立する。エキスパート経路が無傷なので既存ユーザの回帰リスクがない。
- **受け入れるコスト**: ウィザード定義・式アセット・パラメトリックアセットの
  **コンテンツ制作と保守**という継続的コスト。カタログが貧しい間は体験が
  「選べるものが少ない」に留まる（初期リリースはロボットセルドメインに絞って
  密度を確保する）。パラメトリックビューワは新規の相応の実装面。
- **検証（証拠）**:
  - 動機の証拠: 当事者 dogfooding の一次報告（本 Context 冒頭）。ADR-058 実装後も
    なお入力不能 — 摩擦低減アプローチの限界の実証。
  - 受け入れ基準（各フェーズ）: 純粋層（ウィザード定義スキーマ・式アセット・
    パラメータ→DSL 変換）は `node --test`; 完了述語が validator 述語と同一関数参照
    であることの参照同一性テスト（ADR-058 `isInterval` と同型）; パラメトリック
    コミット後の doc が `validateContext` を通過し、`compileContext→compileLayout`
    でシーン再現（scene fixpoint の精神 — #28）; 既存 `test:context` 全件無回帰。
  - ユーザ検証: 「白紙で対面しない」の走査 — 全インテークフィールドに選択ソースが
    添えられていることを SCREEN_DESIGN のチェック表で棚卸し。
- **波及（blast radius）**: `src/context/`（ウィザード定義・式アセット・パラメータ
  変換の純粋層、`RoleKpiCatalog` の 2.0 拡張）、`src/components/Context/`（Wizard
  パネル・ビューワ UI・フォームのリスト化）、`src/controller/ContextController.js`
  （ウィザード FSM とビューワ配線）、`TemplateCatalog` 拡充、`docs/SCREEN_DESIGN.md`
  / `LAYOUT_DESIGN.md` / `EVENTS.md` / `STATE_TRANSITIONS.md`（ウィザード FSM）。
  **契約 / BFF / ドメイン実体 / DSL スキーマ版は無改変**。

## 実装フェーズ（順序 = 事実の供給源が既にある度合いの降順）

1. **Phase 1 — KPI 式アセットカタログ**: `RoleKpiCatalog` を式アセットへ拡張
   （`role-kpi/2.0`、1.0 受容）。要件フォームの KPI チップを「選ぶ → パラメータだけ
   改変」フォームへ。最小コストで「KPI が思い付かない」への直接回答。
2. **Phase 2 — 選択リスト + フォームの白紙撲滅**: 閉じた語彙リスト（discipline /
   domain / unit）を導入し、全インテークフィールドに選択ソースを添える。
3. **Phase 3 — ウィザード**: ウィザード定義アセット + FSM + WizardPanel。既存
   DocBuilder コマンドの順序付きの器として実装（新しい書き込み経路なし）。
4. **Phase 4 — パラメトリック 3D アセット + ビューワ**: アセットレジストリ
   （DSL 断片 + パラメータスキーマ）、ハンドル/スライダ操作 → ライブゴースト →
   コミットで数値/テキスト変換（ADR-050 Phase 3 のコミット規律を再利用）。
5. **Phase 5 — 統合**: ウィザードステップへのビューワ埋め込み、TemplateGallery を
   ウィザード開始点へ接続。「Empty Project」カードをエキスパート棚へ移設。

## 実装（Phase 1 + Phase 2, 2026-07-05）

**Phase 1 — KPI 式アセットカタログ（`role-kpi/2.0`）**

- `src/context/RoleKpiCatalog.js`: `ROLE_KPI_CATALOG` の各エントリを式アセット
  `{name, unit, exprTemplate, params[], suggestedOp, description}` へ拡張し
  `ROLE_KPI_CATALOG_VERSION` を `role-kpi/2.0` に。アセット**名**は 1.0 の必須
  リストと同一（R8 の意味論不変 — カタログ行は依然「その discipline の必須期待」
  であり閲覧ライブラリではない）。`exprTemplate` は拘束変数を `{var}`、調整
  パラメータを `{param.key}` で持ち、`instantiateKpiExpr(asset, varRef)` が
  置換可能なものだけ置換し**未解決プレースホルダは逐語で残す**（#11 — 不完全な
  式は見た目にも不完全のまま）。式形は昇格可能性に正直: 閉形式単調
  （resolution / clearance 系）は promoteAdmissible が導出領域へ昇格、ソルバ
  関数（`wrist_margin` / `motion_time`）は意図的に opaque（R9 が criterion を
  問い続ける）で、description にそれを明記。
- **R8 追従（additive）**: `requiredKpis` は `kpiEntryName`（string→そのまま、
  object→`.name`）で正規化し、**1.0 の名前配列 override（`ctx.kpiCatalog`）を
  受容し続ける**。`ContextValidator` は無改変。
- `src/context/IntakeAssist.js`: `kpiCatalogChips` は 2.0 アセットを丸ごと通す
  （1.0 名前チップには何も捏造しない）。`kpiCardLines(chip)` 新設 = チップ hover
  ミニカードの純粋射影（unit / expr テンプレート / tweak パラメータ / suggested
  op / description — 持っているフィールドのみ）。`requirementGaps` に
  「`kpiExpr` に `{…}` プレースホルダ残存」の gap を追加（コミットすると無言で
  非昇格式になるのを、無言 disabled でなく理由文で塞ぐ）。
- `IntakePanel.jsx` RequirementForm: `KpiAssetChips`（hover ミニカードで
  **選ぶ前に閲覧**）→ クリックで name/unit/expr/op を一括充填し、以降ユーザは
  パラメータ（閾値・対象変数）だけ改変。式が**前回選択に対する手つかずの
  インスタンス**である間だけ、変数選択の変更で `{var}` を自動追従（ユーザ編集は
  決して書き換えない — seed tint と同じ所有権規律）。

**Phase 2 — 選択リスト + フォームの白紙撲滅**

- `src/context/IntakeVocabulary.js` 新設（純粋・THREE-free）: `ROLES` /
  `NEGOTIABILITY` は **スキーマ enum の同一配列参照**（`VALID_ROLES` /
  `VALID_NEGOTIABILITY` — 参照同一性テストで担保、ADR-058 §B-2 と同型）、
  `DISCIPLINES` は `ROLE_KPI_CATALOG` キー（R8 義務を持つ discipline は必ず
  選択可能 — 旧インライン UI リストは `eoat` を欠いていた実バグを構造的に修正）
  ＋キュレーション extras、`UNITS` はカタログ宣言単位＋幾何/時間 extras、
  `CRITERION_OPS` は AdmissiblePromotion が反転/評価できる演算子集合そのもの。
- `IntakePanel.jsx`: ローカル語彙定数を削除し vocabulary import へ一本化
  （§1.1）。unit フィールド（variable / KPI）は共有 `<datalist>` で提案 —
  **提案であって拘束ではない**（エキスパート自由入力の脱出口を保つ — Goal 3）。

**検証**: `RoleKpiCatalog.test.js` 8 件 + `IntakeVocabulary.test.js` 4 件 +
`IntakeAssist.test.js` +2 件（プレースホルダ gap / 2.0 チップ / カード行）、
`test:context` **381/381**、`tsc --noEmit`・`vite build` クリーン。
契約 / BFF / ドメイン実体 / Context DSL 版は無改変。

## 実装（Phase 3 — ウィザード, 2026-07-05）

**純粋層 — `src/context/WizardCatalog.js`（ウィザード定義アセット + FSM）**

- 定義アセット `CELL_INTAKE_WIZARD`（`wizard/1.0`、`WIZARD_CATALOG` に登録）:
  ステップ列（actors → variables → requirements — ADR-051 の Why-first 順を宣言
  データ化、§1.1: 順序はコンポーネントに散らさず定義に置く）。各ステップは
  `formGaps`（埋め込みフォームの submit 述語 — **IntakeAssist の同一関数参照**、
  参照同一性テストで担保 = ADR-058 §B-2 と同型）と `minEntries`（`next` ゲート）
  を持つ。
- 純粋 FSM（§1.4 — コンポーネントより先に確定）: 状態は
  `null（inactive）/ {status:'step', index} / {status:'review'}`。
  `wizardStepGaps` はコミット済み doc エントリだけを読む段完了述語（理由文を返す
  — 無言 disabled 禁止 #11、ステップ内 draft は影響しない = 第二の源にしない）。
  `nextWizardState` はゲート不成立時に**同一 state を返す**（不正遷移は例外でなく
  表現不能）。`prevWizardState` は常時可・アンダーフローなし。`wizardTrail` は
  done/current/todo の進捗射影（通過後にエントリを消した段は正直に todo へ戻る）。

**配線 — 器であって新経路ではない（§3）**

- uiStore: `context.wizard`（丸ごと置換、`contextSetWizard`）。sole writer は
  `ContextController`（grasp FSM — ADR-057 と同じ規律）; panel は読むだけ。
  `contextStart` / `contextEnd` でリセット。
- `ContextController`: `startWizard` / `wizardNext`（**正本 doc** に対して同じ純粋
  述語でゲート — panel は射影スライスから同じ述語で表示、一述語二射影）/
  `wizardBack` / `finishWizard`（review → matrix タブ + toast — コミットではなく
  ビュー遷移; 各段が既に CommandStack 経由でコミット済みのため all-or-nothing
  なし）/ `exitWizard`（任意時点、部分進捗が成果物）。callbacks:
  `onWizardStart/Next/Back/Finish/Exit`。
- `WizardPanel.jsx` = ContextLayer negotiate の `'wizard'` タブ（新規エッジ
  パネルなし — #26）。IntakePanel の **同一フォーム**（`ActorForm` /
  `VariableForm` / `RequirementForm` を export して埋め込み — 共有 submit 述語・
  seed chips・KPI 式チップ・DualRange→3D バンドがそのまま乗る）。コミットは
  既存 `onAddDocEntry` のみ。白紙 doc の初期タブは `'wizard'` へ（開始画面 =
  想起ゼロの入口; エキスパート Intake タブは 1 タブ隣に無傷 — Goal 3）。

**検証**: `WizardCatalog.test.js` 11 件（FSM 遷移 / 参照同一性 / 入力不変）、
`test:context` **392/392**、`tsc --noEmit`・`vite build` クリーン。
契約 / BFF / ドメイン実体 / Context DSL 版は無改変。

**残（後続フェーズ）**: Phase 4 パラメトリック 3D アセット + ビューワ、
Phase 5 統合（TemplateGallery からのウィザード開始接続・Empty Project の
エキスパート棚移設・ウィザードステップへのビューワ埋め込み）。

## Lens notes

- **様態判定**: ウィザード本体は BPMN（決め打ち逐次 — 定義アセットがフローを宣言）、
  各ステップ内部の検証応答は CMMN（事象駆動 — ADR-062 ループ）。二様態の入れ子で
  あることを設計上明示し、ステップ順序をコードに散らさず定義アセットに置く（§1.1）。
- **§1.4 発動**: ウィザードは 3 状態以上 + 不正遷移（未完了 next / review 抜き確定）
  が doc 品質事故になるため、状態機械を §4 で先に確定した。
- **§1.2 Goal 持ち上げ**: 要望は「ウィザード」「テンプレート」「ビューワ」という解の
  列で来たが、Goal は「想起ゼロで開始できる」。この持ち上げにより、白紙フォームの
  *装飾*（プレースホルダ・ツールチップ追加など、より安いが Goal を満たさない解）を
  検討から正しく除外できた。
