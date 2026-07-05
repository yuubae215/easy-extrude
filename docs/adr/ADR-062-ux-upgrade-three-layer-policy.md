# 062. UX アップグレード三層方針 — 証明は接続先、契約はカノニカル、体感はゲーム感覚

- Status: Accepted (Phase 1 + Phase 2 + Phase 3 実装済 2026-07-05; Phase 4 測定器 / Phase 5 テンプレート面は後続)
- Date: 2026-07-05
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- References: ADR-063（選択優先インテーク — 体感層の中核実装計画）,
  PHILOSOPHY #29（Rigor on the Wire, Play in the Client — 本 ADR はその全域展開）,
  #11（Silent Failures）, #3（純粋/副作用分離）, ADR-060（契約統治）, ADR-061（診断ファネル）,
  ADR-059（空間ゴースト）, ADR-058（fork & tweak + 遊びの入力面）, ADR-057（Grasp UI FSM）,
  ADR-054（BFF 素通し + エラーエンベロープ）, ADR-053（測定器）, ADR-050（Context-first）,
  ADR-051（要件入力の複数入口）

## Context — Goal（§1.2）

grasp スレッド（ADR-057 → 061）で、ひとつの UX パターンが繰り返し成立した:

> ユーザが入力する → **証明ロジック**（ソルバ / バリデータ / 測定器）が事実を決定する →
> 事実が**カノニカルな契約**でクライアントへ届く → クライアントが事実から**演出を導出**
> して即座に「効いた / 惜しい / ダメ」を返す → ユーザが自分で気づく（アハ体験）→ 次の入力。

このループが回る面（Grasp ファネル、seed tint、DualRange→3D バンド、保存フラッシュ）は
使われて早期にフィードバックを生み、回らない面（素の数値フォーム、無言の disabled、
結果一行表示）はデータ入力が「つらい作業」のままになる。要件・レイアウト・ロボティクス
KPI を扱う本アプリの価値はユーザが *入力してくれる* ことに全面依存するため、入力の
つらさはプロダクト全体のボトルネックである。

**Goal（解でなく性質で）**:

1. **入力が報われる** — どの入力面でも、操作の直後に「入力が世界を動かした」ことが
   視覚的に返る（感動・アハ体験は装飾ではなく学習速度の手段 — #29）。
2. **演出が嘘をつかない** — 画面上の「効いた感」は常に *決定された事実* からの導出で
   あり、クライアントが判定を捏造・推測しない（#11 / スコープ境界）。
3. **境界が成長で腐らない** — 演出の需要が契約スキーマへ optional として漏れ出さず、
   契約は閉じたカノニカルな決定記録であり続ける（ADR-060）。

**力学・制約**:

- 「証明」の座は既に二つある: **接続先**（grasp-search 等の外部ソルバ — スコープ境界
  「解法はここに書かない」）と、**リポジトリ内決定的 core**（`ContextValidator` /
  `PredicateEngine` / `CanonicalForm` / `RoboticsService` 測定器 — スキーマ/契約として
  in-scope）。どちらも *事実の決定者* であり、UI はどちらの判定も再実装しない。
- 契約の正本は upstream の JSON Schema パッケージ。本リポジトリは型を導出するだけ
  （CLAUDE.md「BFF と契約」）。
- 遊びの語彙は既に個別 ADR に散在して実証済みだが、**共有の設計標準として名指し
  されていない**ため、新しい入力面を作るたびに「素の数値フォーム」へ退行し得る
  （§1.1: 同じ価値が二箇所以上で暗黙に書かれている状態）。

本 ADR は新機能の決定ではなく、**三層の責務配置を全 UX 面の既定標準として確定し、
未適用面への展開順序を定める** プログラム決定である。

## Options considered

- A: **現状維持（機能ごとのアドホック適用）** — tradeoff: 実装コストゼロだが、
  パターンが ADR-057〜061 の文脈知識に閉じたままで、次の入力面（FormPanel、交渉
  マトリックス等）が素のフォームへ退行するのを防ぐ構造がない。#19（Documentation
  Drift）の温床。
- B: **本格ゲーミフィケーション基盤（ポイント / バッジ / レベル）を導入** — tradeoff:
  エンジニアリングツールに対して演出が事実から遊離する（バッジは *決定された事実* の
  導出ではない）。#29 の「play は学習の手段」という位置づけから逸脱し、契約への
  演出フィールド圧力（gamification state の永続化要求）を生む。過剰モデリング（核 §5）。
- **C: 三層方針の成文化 + 証明フィードバックループの標準化 + 段階展開【採用】** —
  tradeoff: 新しい実行コードは最小（演出プリミティブの抽出と未適用面への配線のみ）
  だが、各フェーズで「事実の出所」を毎回明示する設計コストを引き受ける。

## Decision — Strategy（§1.2）

**C** を採る。三層の責務を全 UX 面の既定として確定する:

| 層 | 所有するもの | 所有しないもの |
|----|------------|--------------|
| **接続先（証明層）** — 外部ソルバ + リポジトリ内決定的 core | 事実の決定: 解法・検証・測定・正規形・述語評価 | 演出・提案の言語化・UI 都合の整形 |
| **契約（カノニカル層）** — upstream Schema / Context DSL / validator 戻り値 | 決定事実の閉じた版付き記録（`additionalProperties:false`、kind 判別 union、`contractVersion`/`CONTEXT_DSL_VERSION`） | 演出フィールド（色・アニメ・メーター値・「惜しさ」スコア） |
| **フロント（体感層）** | 事実からの**純粋導出**による演出（ファネル・メーター・フラッシュ・ゴースト・差分チップ）と、その配線 | 判定の再実装・事実の捏造・契約の拡張 |

### 1. 証明フィードバックループを UX の標準形として名指しする

新しい入力面・結果面を設計するときの既定形:

```
入力（遊びの面） → 証明（外部ソルバ or 決定的 core） → 事実（契約/validator 結果）
   ↑                                                        ↓
   └──── アハ体験（自分で気づく） ← 演出（純粋導出層 + presentational） ┘
```

規律（すべて既存原則の適用であり新規則ではない）:

- 演出の入力は常に *事実*。純粋導出層（`GraspFunnelMath` 型の THREE-free モジュール）
  が事実→表示値を計算し、malformed / 欠落は `null` へ degrade（捏造しない — #11）。
- 「何を直せば効くか」は**強調で示し、提案文は作らない**（ADR-061 `dominantStage` の
  一般化）。提案・ランキングの言語化は外部レコメンダの責務（ADR-056 スコープ境界）。
- 無言の disabled / 無言の no-op を禁止し、不足理由の列挙 = submit 述語をゲート関数と
  同一参照で共有する（ADR-058「堅い検証境界」の一般化）。

### 2. 演出プリミティブの共有語彙（Phase 1）

grasp / intake スレッドで実証済みの演出を、名前付きの再利用可能プリミティブとして
抽出する（挙動変更なしのリファクタ。純粋導出と presentational を分離 — #3）:

| プリミティブ | 実証元 | 意味 |
|------------|--------|------|
| **着地フラッシュ**（緑→透明フェード） | ADR-058 保存フラッシュ | コミットが受理された事実の確認 |
| **差分チップ**（▼緑 / ▲赤、0 は無表示） | ADR-061 `funnelDelta` | 前回比で「効いた」方向の事実 |
| **惜しさメーター**（単調曲線 + 生数値併記） | ADR-061 `nearMissCloseness` | 連続量の近さの演出。数値が正、曲線は演出 |
| **段階ファネル**（棒 + 支配段強調） | ADR-061 `funnelStages` | 多段棄却の説明。ゼロ件は入力ガイドへ |
| **ライブバンド/ゴースト**（入力中の 3D 即応） | ADR-051 Phase 3 / ADR-059 | テキスト⇄3D の同時性 = 世界が動く実感 |
| **seed tint / アンカー併置** | ADR-058 | 手本との差分の気づき（fork & tweak） |
| **ライブ recolor → コミットで 1 回確定** | ADR-050 Phase 3 | 楽観プレビュー + 悲観コミット（#7） |

配置: 純粋導出は `src/view/*Math.js` / `src/context/IntakeAssist.js` の系譜、
presentational は `src/components/` 内の共有プリミティブ。**演出状態は uiStore の
判別共用体に載せない**（hover が controller ローカルであるのと同じ規律 — ADR-059）。

### 3. 未適用面への段階展開（Phase 2 以降のバックログ）

事実の供給源が既に存在する面から順に配線する（証明層・契約層は無改変が既定）:

- **Phase 2 — FormPanel / OpenQuestion 消化**: 回答→再 validate→質問が消える既存
  ループに、残数の前回比差分チップと消化フラッシュを重ねる。事実の出所は
  `projectForm()`（validator 所有）のみ。
- **Phase 3 — 交渉マトリックス / クラスター**: 承認・領域編集で conflicts が減った
  事実（`validateContext().conflicts` の署名差分 — `conflictsChanged` は既存イベント）
  を差分チップ + 解消フラッシュへ。マトリックスのセルが「消える」瞬間を演出する。
- **Phase 4 — 測定器（ロボティクス）**: `RoboticsService.measureReach/measureCollision`
  のベイク→述語 pass への遷移を、blocked→pass の状態変化フラッシュ + margin の
  惜しさメーターで返す（事実 = ベイク済みオペランド、ADR-053 §9）。
- **Phase 5（任意）— テンプレート/fork 面の拡充**: TemplateGallery のカードに
  正準形シグネチャ由来の構造プレビュー（`CanonicalForm` — 事実）を演出として導出。

各フェーズは独立に着手・打ち切り可能で、順序は「事実が既に契約/validator に存在する
度合い」の降順。**どのフェーズも契約スキーマ・Context DSL バージョンを変更しない**。
証明層が *新しい種類の事実* を決定するようになったときだけ、Schema 側で kind を足して
版を上げる（ADR-060 の統治をそのまま継承）。

## 非目標（やらないこと）

- ポイント・バッジ・レベル等、事実から導出されない gamification 状態の導入と永続化。
- 契約・Context DSL への演出フィールド追加（`meterColor` 型の密輸は契約テストが弾く）。
- クライアント側での判定再実装（リーチ/IK/干渉/衝突/正規形の解き直し・推測提案）。
- 音・ハプティクス等の新モダリティ（将来の別 ADR。本 ADR は視覚導出に限定）。

## Consequences — Evidence と tradeoff（§1.2）

- **肯定的**: 新しい入力面の設計が「三層のどこに何を置くか」の穴埋めになり、素の
  数値フォームへの退行が構造的に防がれる。演出プリミティブの共有で、grasp スレッドで
  払った設計コスト（純粋導出 + 正直 degrade + テスト形）が全面で再利用される。
- **受け入れるコスト**: 演出の追加は毎回「事実の出所はどこか」の確認を要する
  （アドホックに CSS を足すより遅い）。共有プリミティブ抽出は既存 3 実装
  （IntakePanel / GraspSearchPanel / ContextLayer）のリファクタを伴う。
- **検証（証拠）**:
  - 既存実証: ADR-058（`IntakeAssist` 11 テスト + validator 述語の同一関数参照
    テスト）、ADR-061（`GraspFunnelMath` 9 テスト + 契約テストの演出密輸拒否 +
    verbatim 素通し 16 件）、ADR-059（能力ゲート同一関数のキャプション）— 本方針の
    3 文脈での成立証拠。
  - Phase 1 以降の受け入れ基準: 各プリミティブは純粋導出層に `node --test` を持つ /
    演出フィールドの契約混入は `test:contract` が拒否し続ける / 各フェーズの配線後も
    `test:context` 全件 green + `tsc --noEmit` + `vite build` クリーン。
- **波及（blast radius）**: `src/components/`（共有プリミティブ）、
  `src/view/*Math.js`（純粋導出）、Phase 2–4 で `FormPanel` / `ConflictMatrix` /
  `NegotiationClusterView` / robotics 系ビュー。**契約 / BFF / ドメイン / スキーマは
  全フェーズ無改変**。PHILOSOPHY #29 は本 ADR 受理時に「grasp スレッド」から
  「全 UX 面」へ適用範囲を広げる追記を行う（原則の文言変更なし、scope の明確化のみ）。

## 実装（Phase 1 + Phase 2 + Phase 3, 2026-07-05）

**Phase 1 — 演出プリミティブの共有語彙（挙動不変のリファクタ + 純粋導出層）**

- `src/view/FeedbackMath.js` 新設（純粋・THREE-free・`node --test` 9 件）:
  事実スナップショット 2 つの比較だけを行う — `refsSignature`（再射影の配列
  identity churn を「変化」と誤読しないための安定署名; key 不能なエントリは
  署名ごと `null` へ degrade = 推測 identity 禁止 #11）/ `listDelta`（件数差 —
  符号の意味論は呼び手が持つ）/ `settledRefs`（前回あって今回ない ref =
  直前の変化が**閉じたもの**の列挙）。判定の再実装は一切なし（事実は常に
  validator / 契約の所有 — #29）。
- `src/components/Feedback/FeedbackPrimitives.jsx` 新設（presentational）:
  `FeedbackDefs`（green/amber フラッシュ keyframes）、`flashAnim(tone)`、
  `LandingFlash`（`tick` 変化で replay する着地フラッシュ、`active` 偽なら無演出）、
  `DeltaChip`（ADR-061 実装から**移設** — 0/null は無表示）、`usePrevOnChange`
  （直前スナップショットの component-local 保持 — **演出状態は uiStore に
  載せない**規律の構造化。grasp `prevDiagnostics` と同じキャリー意味論:
  差分は次の変化まで読める）。
- 既存実装の付け替え（挙動不変）: `GraspSearchPanel` の `DeltaChip` を共有版
  import へ、`IntakePanel` の `eaIntakeFlash` keyframe を共有 defs の amber へ
  （`flashAnim('amber')` — seed flood / save-landed の見た目は不変）。

**Phase 2 — FormPanel / OpenQuestion 消化**

- 事実の出所は従来どおり `projectForm()`（`context.form`）のみ。パネルは
  `usePrevOnChange(form)` で直前スナップショットを保持し、(a) open 件数の
  前回比 `DeltaChip`（fewer = good）、(b) 直前の回答が閉じた質問 ref を名指す
  緑の着地フラッシュ（`settledRefs`）、(c) 全消化時は「✓ No questions」自体が
  フラッシュ + 「last answer closed …」を表示。回答→再 validate→質問消滅の
  既存ループ（ADR-050 Phase 4）に演出を重ねただけで、コミット経路・validator・
  store スライスは無改変。

**Phase 3 — 交渉マトリックス / クラスター / ヘッダ**

- `ConflictMatrix`: 未解決変数集合（`variableSummary[v].inConflict && !approved`）
  の前回比 `DeltaChip` + 直前の承認/領域編集で**集合から抜けた変数のサマリカード**
  が緑フラッシュ（「セルが消える瞬間」の演出）。demo / 本番の両方が同じ
  prop-driven コンポーネントで恩恵を受ける（ADR-050 §4.4 のまま）。
- `NegotiationClusterView`: 未承認ステップの前回比チップ + 新規承認ステップの
  カードフラッシュ + 「All Decisions settled」バナーの着地フラッシュ。
- `ContextLayer` ヘッダ: 未解消 conflict 行に前回比チップ + 解消時フラッシュ。
  `FeedbackDefs` は `ContextLayer` / `ContextInspector`（demo）/
  `IntakeSharedDefs` がマウント（重複マウントは同一 keyframes で無害）。

**検証**: `FeedbackMath.test.js` 9 件、`test:context` **401/401**（+9）、
`tsc --noEmit`・`vite build` クリーン。契約 / BFF / Context DSL 版は無改変
（受け入れ基準どおり — 演出フィールドの契約混入なし）。PHILOSOPHY #29 に
適用範囲の追記（grasp スレッド → 全 UX 面; 文言変更なし）。

**残（後続フェーズ）**: Phase 4 — 測定器（`RoboticsService` ベイク → blocked→pass
遷移フラッシュ + margin 惜しさメーター）、Phase 5（任意）— TemplateGallery の
`CanonicalForm` 由来構造プレビュー。

## Lens notes

- **様態判定**: 証明フィードバックループは CMMN（事象駆動 — 入力イベント→検証→表示）
  であり、フェーズ展開計画のみ BPMN（逐次）。ループ自体に新しい状態機械は不要
  （既存の `context.grasp` FSM / `_mode` がそのまま各面の権威 — §1.4 のトリガ不成立）。
- **§1.1（真実の源）**: 「効いた感」の表示値はすべて導出と明示（`prevDiagnostics`
  キャリーの註記と同型）。演出プリミティブが状態を持たないことがこの規律の構造化。
- **§1.2（Goal への持ち上げ）**: ユーザ要望は「ゲーム感覚 UI」という解の形で来たが、
  Goal は「入力が報われる = 学習ループが速く回る」。よってバッジ型 gamification（B 案）
  ではなく証明駆動フィードバック（C 案）が最小の正しい解。
