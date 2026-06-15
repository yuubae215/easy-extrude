# ADR-050 — Context-First Project Model: 要求/衝突/交渉 の PoC から本番機能化

**Status**: Proposed (Phase 1 implemented)
**Date**: 2026-06-14
**Related**: ADR-049 (Requirement/Conflict モデル), ADR-046 (Context DSL), ADR-047 (Context Demo Layer), ADR-045 (External Layout API), ADR-022 (Undo/Redo), ADR-013 (Domain Events), ADR-011 (SceneService)
**Implementation**: 段階導入(本 ADR §6)。新規: `src/service/ContextService.js`, `src/controller/ContextController.js`, `src/command/{ApproveDecision,EditAdmissible,AnswerQuestion}Command.js`, `src/components/Context/{ContextLayer,FormPanel}.jsx`。既存純粋層 `src/context/*`(94 テスト)は無改変で再利用。

> **進捗 (2026-06-15)** — **Phase 1 実装済**: `ContextService`(正準 doc 所有 + load パイプライン)+ `ContextService.test.js`(12 件、`importFromJson` モックで THREE-free)+ `AppController._onContextLoaded` 配線。純粋層は無改変。`demo`/PoC (`ContextDemoController`) は未改変 — §4.1 の `ContextController` 分割は Phase 2。残り: Phase 2(本番 Negotiation)/ 3(本番 Authoring + 3D pose/視覚)/ 4(動的フォーム + `.ctx.json` 永続化)/ 5(チュートリアル分離 + Accepted 昇格)。

---

## 1. Context — PoC は概念検証に成功したが、ユーザーの実プロジェクトに届かない

ADR-049 は要求/衝突/交渉モデルを実装し、ADR-047 のデモレイヤー上に **Demo(ストーリー)・
Author(領域オーサリング)・交渉(ペルソナ射影)** の 3 フローとして PoC 化した。概念検証は成功した
— 衝突が目で見え、交渉クラスターの解消順序が DSM として導出され、n-ary Decision の承認ゲートが
不変条件8 の体験を生んだ。

しかし PoC は**正式機能ではない**。探索で確認した 3 つの構造的限界:

1. **ハードコードされたシナリオ。** `ContextDemoController` は `examples/factory_context.json` /
   `cell_region_context.json` / `cell_conflict_context.json` を静的 import し、各フローはそのいずれか
   1 つを読む。「ユーザーが読み込んだ context」という概念が存在しない。
2. **`demo` 専用の一時状態。** すべてが uiStore の `demo` スライスに存在し、`demoStart` ごとにリセット、
   `exit()` で破棄される。**何も永続化されない。**
3. **シーン置換結合。** 各フローは `importFromJson(scene, vc, {clear:true})` の後 `_commandStack.clear()` を
   呼び、context を ephemeral なデモコンテンツとして扱う。scene DTO v1.3 には context フィールドがない。

PoC が効果的だった以上、次の問いは「これをユーザーの実プロジェクトでどう使えるようにするか」である。

---

## 2. Decision — プロジェクトの正準アーティファクトはテキスト context DSL、シーンは導出射影

ADR-049 **不変条件9**(契約の正準形はテキスト DSL、3D は入力デバイス + evidence)を、デモの設計原則から
**製品の永続化モデル**へ昇格させる。

> **プロジェクトの成果物は Context DSL ドキュメント(`context/0.3`)である。3D シーンは
> `compileContext()` → `compileLayout()` → `importFromJson()` の純粋連鎖で導出される出力射影にすぎない。
> 保存・読込・署名・diff はすべて context ドキュメントに対して行う。**

これは ADR-049 §1 観察と ADR-046 の思想の自然な帰結である。シーンは要求から導出できる(その逆ではない)
ため、context を正準とすればトレーサビリティ・baseline・緩和の定量化(ADR-049 §1 観察2)がすべて成立する。

### 2.1 採択した代替案と棄却した代替案

| 代替案 | 採否 | 理由 |
|---|---|---|
| **Context-first**(本決定) | ✅ 採択 | 不変条件9 に忠実。シーンは導出 = トレーサビリティが自動的に成立。保存対象が単一 |
| シーンに context を埋込/参照(DTO v1.4) | ❌ 棄却 | 正準が 2 つになる(geometry と context が独立に編集され乖離しうる)。導出関係を壊す |
| context を独立ワークスペースで import/export のみ | ❌ 棄却 | シーンと context の整合をユーザーが手で取る必要。導出の自動性が失われる |

---

## 3. Architecture — ContextService が正準 doc を所有し、シーン再生成を駆動

### 3.1 ContextService(新設、`SceneService` と並列)

`EventEmitter` を継承する副作用コーディネータ。**純粋ロジックを持たず** `src/context/*`(検証・コンパイル・
射影)と `SceneService.importFromJson`(再描画)に委譲する(PHILOSOPHY #3)。

所有する状態:
- `_doc` — 正準 Context DSL。**全変更が新しい doc を生む**(入力不変、PHILOSOPHY #6 — 純粋
  `applyAdmissibleEdit` と同型)。
- `_validatorResult` — `validateContext(_doc)` の出力(`{valid, errors, openQuestions, blockedChecks,
  conflicts, negotiationClusters, promoted, checkResults}`)。
- `_compiled` — `compileContext(_doc)` の出力。
- `_refToId` / `_traceByFrom` / `_constraintToLinkId` / `_linkIds` — 現状 `ContextDemoController._start` に
  インラインの導出簿記。「コンパイル済み context」に属するためサービスへ移す。

主要メソッド(すべて副作用、シーンに触れるものは async):

- `async loadContext(doc, viewContext)` — **doc 採用の単一権威入口**(PHILOSOPHY #1)。validate + compile
  (失敗は try/catch → toast、PHILOSOPHY #11)、`importFromJson({clear:true})`、ref マップ再構築、
  `_doc/_validatorResult/_compiled` 格納、`contextLoaded` emit。
- `getDoc()` / `getValidatorResult()` / `getCompiled()` — **freshness を所有するアクセサ**(PHILOSOPHY #23)。
- `async applyContextDoc(newDoc, vc, {regenerate})` — 再導出プリミティブ。再 validate し、`regenerate` 時は
  再 compile + `importFromJson` + ref マップ再構築、`contextChanged` + `conflictsChanged` emit。
- `applyAdmissible(reqRef, admissible, vc)` — 純粋 `applyAdmissibleEdit(_doc, ...)` → `applyContextDoc`。
- `approveDecision(ref, vc)` — 対象 Decision の `status` を `agreed` にした**新 doc** へ変異 →
  `applyContextDoc({regenerate})`。
- `projectMatrix/Order/Ghosts()` / `projectForm()` — `PersonaProjection` / `FormProjection` の薄いラッパ。
  `{approvedRefs}` は doc の agreed Decision 群から導出する。

### 3.2 承認は doc 変異であって一時セットではない(PoC との決定的な差)

PoC の `approveNegotiationDecision` は**再検証せず再射影のみ**を行い、承認状態を uiStore の一時
`approvedDecisions` Map に置いた(交渉ビューを開いた瞬間に全件 `resolved` 表示になるのを避けるためだった)。

本番では承認は**正準 doc の本物の変異**である: `decision.status: proposed → agreed`。`agreed` になると
validator の Decision 解消パスが `resolvedBy` を立て、衝突マトリックスのセル状態は**一時セットではなく
doc 由来**で `resolved` になる。`projectConflictMatrix(..., {approvedRefs})` の `approvedRefs` は doc の
agreed Decision 集合から導出するため、純粋射影 API は無改変で動く(ADR-049 Phase 4 の後方互換シーム)。

これにより承認は **CommandStack でアンドゥ可能**(§3.5)になる。

### 3.3 新ドメインイベント(ADR-013 系譜、PHILOSOPHY #5)

| イベント | 発火 | 購読側 |
|---|---|---|
| `contextLoaded` | 新 doc を採用 | ContextLayer 表示、Outliner、トレース UI |
| `contextChanged` | doc 変異(承認/領域編集/フォーム回答)→ 再導出 | Inspector、3D |
| `conflictsChanged` | `validatorResult.conflicts` 変化 | Matrix / Ghost / Conflict タブ |
| `decisionApproved` | Decision が `agreed` へ | toast、Matrix 遷移 |

### 3.4 シーン再生成フロー(`_start` で実証済みの連鎖を再利用)

```
newDoc → compileContext(純粋) → {layoutDsl,...} → compileLayout(純粋) → sceneDTO v1.3
       → sceneService.importFromJson(sceneDTO, vc, {clear:true})   [async・副作用]
       → _refToId/_traceByFrom/_constraintToLinkId/_linkIds 再構築
       → emit contextChanged
```

CODE_CONTRACTS「importFromJson Solid v1.3 Coverage」/ ADR-047 §3 に従い、`compileLayout → importFromJson`
の往復は既に end-to-end 検証済みのため、新規 deserialization パスは不要。

### 3.5 Undo/Redo — context 編集をコマンド化(`createXCommand` 規約、ADR-022)

- `createApproveDecisionCommand(ctxService, ref, vc)` — execute=`approveDecision`(→agreed)、
  undo=`unapproveDecision`(→proposed)。`_commandStack.push()`(post-hoc 記録)。
- `createEditAdmissibleCommand(ctxService, reqRef, before, after, vc)` — 完了した領域ドラッグ 1 件。
  before=pointerdown 時の admissible、after=pointerup 時。
- `createAnswerQuestionCommand(ctxService, qRef, beforeDoc, afterDoc, vc)` — doc は小さい JSON のため
  before/after スナップショット。

`loadContext` は project-open 境界なのでスタックを clear する。context 編集とジオメトリ undo/redo は
単一の履歴で交錯する。

---

## 4. Controller / UI — demo→production 分離、永続オーバーレイ(非 setMode)

### 4.1 ContextDemoController を分割する

**`ContextController`(新設)へ移す**(loaded doc で動作、編集は `ContextService` 経由):
領域オーサリング(`enterAuthoring`/`onAuthor*`/`_revalidate`)、交渉(`enterNegotiation`/承認)、
許容領域ゴースト(`enterRegionGhost`)、要求→3D トレース(`selectItem`)。`RegionAuthoringWidget` /
`RegionGhostView` の所有も移す(PHILOSOPHY #4/#9)。

**`ContextDemoController` に残す**(チュートリアル story のみ): `enter`/`_start`/`setStep`/段階リビール/
不確実性ゴースト collapse/`DEMO_STEPS`。`factoryContext` import と `demo` スライスは温存。
これにより本番機能化が demo のハードコード story 機構に依存しない。

### 4.2 永続サイドパネルオーバーレイ、`setMode('context')` にはしない

ADR-047 §2.1 は「context オーバーレイは意図的に setMode 状態にしない」を確立済み(orbit/select/grab を
生かし、fastened guardrail を実演するため)。本番でもこの根拠は保たれる: authoring はカメラを要し、
交渉は 3D 非依存のデータオーバーレイである。`setMode()` はジオメトリ編集の FSM であり、context を載せると
要求状態とジオメトリ編集サブ状態が無益に絡み、PHILOSOPHY #1(遷移ごとに単一入口)の精神に反する。

したがって `ContextController` は `MapModeController` 同様の永続オーバーレイコーディネータ。
`isAuthoring`/`isNegotiation`/`isRegionGhost`/`tick(t)` を公開し、AppController の既存 pointer 委譲
パターン(CODE_CONTRACTS「Context Authoring Pointer Delegation」)を新コントローラへ向けるだけで配線できる。

### 4.3 uiStore — 永続 `context` スライス(`demo` と並列)

`context: { loaded, docMeta, form, conflicts, conflictMatrix, negotiationClusters, resolutionOrder,
personaFilter, inspectorTab, selectedItemRef, mode }`。アクションは `demo` を鏡映するが**新ペイロードで
自動リセットしない**(永続)。`demo` スライスはチュートリアル用に無改変で温存。承認は doc 変異 + validator
由来のため一時 `approvedDecisions` は不要。

### 4.4 React UI — `src/components/ContextDemo/` → `src/components/Context/`

`ConflictMatrix.jsx` / `NegotiationClusterView.jsx` を **prop 駆動**(`{matrix, filter, onSetFilter,
onApprove}`)へ変えスライス非依存に。`ContextInspector` を presentational + `DemoInspectorContainer`
(reads `demo`) + `ContextInspectorContainer`(reads `context`)に分割。新 `ContextLayer.jsx`
(`context.loaded` で表示)と `FormPanel.jsx`(§5.1、`projectForm()` 駆動、`answerKind` で widget 切替、
回答ごとに質問が 1 つ減り完了が機械判定可能)。Header の 4 デモボタンを**単一「Context」メニュー**へ:
`Import Context…` / `Save·Export` / (loaded 時のみ)`Author Regions` / `Negotiate` / `Region Ghosts` /
別エントリ `Tutorial`(既存 story)。

### 4.5 3D authoring の役割 — 領域に限らない高次元/視覚的入力射影

§2 の Context-first(テキスト DSL = 正準)の **系**として、3D の役割を明確化する: 3D は
「**テキストフォームで答えにくい入力**」の authoring 射影である。フォームは「カメラの分解能要求は何 px/mm か」
のようなスカラー Q&A には強いが、**3次元データ(座標系・座標・姿勢)** や **テキストで Q&A しづらい視覚的情報**
(リーチ包絡・クリアランス・視線)には次元数的に答えられない。これらは描かせる(ADR-049 §5.2「高次元の
回答は描かせる」)。3D は **3 種の authoring 射影**を担う:

1. **領域フットプリント**(Phase 3 実装済)— `RegionAuthoringWidget`、`admissible.region`(AABB)。
2. **姿勢/座標系**(座標・姿勢)— KPI が pose の関数である要求(取付向き・TCP アプローチ角・CF 相対オフセット)を、
   **既存の CF 操作インフラを再利用**して 3D 操作で著す: `GrabOperationHandler` / `RotationHandler`
   (`src/controller/handler/`)、`CoordinateFrame.move()` / `rotate()`、`SceneService.applyPreviewTranslation()` /
   `applyPreviewRotation()`、TC ギズモ(ADR-034/037/042)。
3. **視覚的インジケータ**(リーチ包絡・クリアランス・swept volume・視線)— `PredicateEngine` の幾何
   (`reach_covers` / `no_overlap` / `swept_volume`、ADR-049 Phase 3)を 3D ハンドルで著す。

**用語**: 本コードベースに「インジケータ」という独立エンティティは無い。**インジケータ = KPI(評価関数)**、
**クライテリア = criterion(合格条件)**(ADR-049 §1 観察2)。3D が担うのは「**KPI を定義する幾何/姿勢**」であり、
**criterion(閾値)はテキストへ一問だけ差し戻す**(ADR-049 §5.2): 3D で描かれるのは KPI を成す幾何であって
合格ラインではないため、R9 がスケッチ/姿勢由来の `stated` 入力に OpenQuestion を立て、KPI が与えられたら
`AdmissiblePromotion` が `stated → derived` 昇格する。**契約物はあくまで変換後のテキスト Requirement**
(不変条件9): 3D で著した evidence(姿勢・スケッチ)は **scene バイナリに保存せず**、必ず
`kpi` / `criterion` / `evidence` を持つテキスト Requirement へ変換してから署名・baseline・diff の対象になる。

**additive 拡張**(ADR-049 の Variable / admissible / predicate モデルの自然な延長 scalar → region → **pose**。
各拡張は Phase 3「本番 Authoring」で設計し、純粋層へ追加):
- Variable に **pose 型**を追加(scalar interval / region AABB に加え)。
- `applyAdmissibleEdit(ctx, reqRef, admissible)`(`ContextEditModel.js:28`)の `admissible` を
  `{interval}|{region}|{pose}` の一族へ拡張(**単一の不変書き戻しの形は不変** — PHILOSOPHY #6)。
- `PredicateEngine` に **姿勢述語**(orientation bounds / relative pose)を additive 追加。
- evidence の `Source.kind` に **`"pose"` / `"measurement"`** を追加(既存 `"sketch"` に並ぶ — additive)。

**Controller / Service の汎化**: `ContextService.applyAdmissible` を「authoring 入力 → `applyAdmissibleEdit` →
`applyContextDoc`」の一族とし、`RegionAuthoringWidget` と同じ所有 / `startDrag` / `dragTo` / `setConflict` /
`dispose` パターン(PHILOSOPHY #4/#9)で **`PoseAuthoringWidget`** を追加。`createEditAdmissibleCommand`(§3.5)は
pose 入力にも流用する(before/after が pose admissible)。フォーム(§5.1)・3D 領域・3D 姿勢・3D 視覚インジケータは
すべて **同一 context ドキュメントへの authoring 射影**であり、データは分けない(ADR-049 §5.2)。

---

## 5. 永続化 — `.ctx.json` がプロジェクトファイル

保存対象は **Context DSL JSON(`context/0.3`)**。拡張子 `.ctx.json`(scene `.json` と区別し import
ルーティングを明確化)。Save/Export は `getDoc()` を JSON ダウンロード(変換不要 — doc が成果物)。
Load/Import は parse → `loadContext(doc, vc)`。**context 読込はシーンを再生成する**(正しい・不変条件9)。
既存 scene Export/Import は context 無背景の raw ジオメトリ(STEP 取込メッシュ等)用に共存する。

往復検証(CODE_CONTRACTS / ADR-047 §3): 各 example を load → `imported>0 && skipped===0`、再 export して
doc の深さ等価をテストする。BFF 永続化(`SceneService.saveScene/loadScene` に context 列追加)は後フェーズ。

---

## 6. 段階導入(各フェーズ独立にテスト可能)

1. **ContextService + load パイプライン(UI 無変更)** — サービス新設、ref マップ簿記を移管、AppController 配線。
   テストは `importFromJson` をモックし THREE-free 可(イベント・新 doc 生成・再 validate を検証)。
2. **本番 Negotiation(データのみ・最低リスク)** — `ContextController` の交渉、承認を
   `createApproveDecisionCommand` 経由、`context` スライス、Matrix/Cluster を prop 駆動化 + `ContextLayer`、
   Header の Context メニュー。
3. **本番 Authoring + region ghosts(3D)** — オーサリング/ゴーストを移管、再生成をドラッグ終了に遅延、
   `createEditAdmissibleCommand`、AppController に `_ctxCtrl.isAuthoring` 委譲分岐。**§4.5 の 3D authoring
   3 種**(領域 / 姿勢・座標系 / 視覚的インジケータ)をここで設計 — 姿勢は既存 CF 操作インフラ再利用 +
   `PoseAuthoringWidget`、視覚インジケータは `PredicateEngine` 幾何、いずれも pose 型 Variable / admissible /
   姿勢述語 / evidence kind を additive 追加(scalar → region → pose)。
4. **動的フォーム + 永続化** — `FormPanel` + `createAnswerQuestionCommand`、`.ctx.json` import/save、往復テスト。
5. **チュートリアル分離 + ドキュメント** — `ContextDemoController` から Phase3/4 コード/import を除去、
   本 ADR を Accepted へ、Design change impact 表の ✅ 群を更新。

---

## 7. Consequences

**正の帰結**:
- 純粋層(94 テスト)が無改変で再利用される — 本番化作業の大半は service/controller/UI の配線。
- context が正準 + シーンが導出 = トレーサビリティ・baseline・緩和定量化が製品レベルで成立(不変条件9)。
- 承認/領域編集/フォーム回答がすべて undoable(単一履歴)。
- demo(チュートリアル)と本番機能が疎結合 — どちらも独立に進化できる。

**負の帰結 / リスク**:
- doc 変異ごとにフル再 compile + `importFromJson` が走る。大規模シーンでは遅延しうる → ライブドラッグは
  recolor のみに留め、フル再生成をドラッグ終了に遅延(§4.2 B.3)。
- scene `.json` と context `.ctx.json` の 2 系統が共存 — どちらが正準かをユーザーが理解する必要。Context-first
  プロジェクトでは `.ctx.json` が正準、raw ジオメトリでは `.json`。Header の動線で区別を明示する。

### Design change impact(CLAUDE.md 表に従う更新対象)

本変更は「新しい UI 画面/パネルを追加」+「新しいドメインイベントを追加」+(実質)「新モード相当」に該当:
- **SCREEN_DESIGN** ✅ — Context レイヤー画面 ID、Form パネル、Import/Save 動線
- **LAYOUT_DESIGN** ✅ — 280px Inspector + `_updateGizmoOffset` 右オフセット(CODE_CONTRACTS「Edge-Anchored Panels」)
- **EVENTS** ✅ — domain events(§3.3)+ UI events
- **CODE_CONTRACTS** ✅ — ContextService 所有権(doc 不変・承認=doc 変異・再生成往復)、ContextController 委譲行
- **ADR** ✅ — 本 ADR-050 + `docs/adr/README.md` index、ADR-049/047/046 の References に追記
- **CLAUDE.md** ✅ — Document navigation 表に ADR-050 / ContextService / ContextController 行
- **PHILOSOPHY** — ⚠️ 不要(additive 構造、同一価値の 2 文脈違反なし)
