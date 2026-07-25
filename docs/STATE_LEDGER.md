# State Ledger — 状態を持つ実体の累積台帳

核 §1.4 が要求する**累積器**。閾値判定 (「3 状態以上 or 不正遷移が事故になるなら
状態機械を設計する」) は *今回のプロンプトに現れた状態数* ではなく、**この表に
累積した状態数**で行う。累積器が実在しなければ判定はプロンプト単位に退化し、
指示は一度に少数の状態しか語らないため閾値は永遠に跨がれない — この台帳は
その退化を止めるためだけに存在する。

## この文書の位置づけ (§1.1 — 第二の源にしない)

**台帳は索引であって図ではない。** 遷移図・guard・不変条件の正本は
`docs/STATE_TRANSITIONS.md` (と各 ADR)。ここに複製しない。台帳が持つのは
**どの実体が状態を持つか / いくつか / 基数は / 権威は誰か / 詳細はどこか**
の 5 列だけ。図が要るときは「詳細」列を辿る。

## 更新規則 (必須)

status・flag・mode・lifecycle・**存在 (基数)** のいずれかに触る変更は、
コードと同じコミットで台帳の行を**追加または更新**する。閾値未満 (1〜2 状態) でも
記録する — 記録しない限り累積しないため。行を足した結果その実体が 3 状態以上に
なったら、クラスを書く前に状態機械を設計し `docs/STATE_TRANSITIONS.md` に節を起こす。

**基数列は必ず埋める。** `mode` や `status` という語はレビューでも AI でも
状態として認識されるが、**「0 個」「N 個」は状態に見えない** — 実際 ADR-090 が
見つけた欠陥 (0 台のロボットが到達可能・無言・不安定で、原点に立つ無限リーチの
幽霊ロボットを生む) は、基数が状態として一度も書き出されなかったことが原因。
`0` が正当なら「0 のとき何が起きるか」を、`N` が正当なら「どれのことか」を
この列で名指しする。

---

## 台帳

凡例 — 基数: `1` = 常にちょうど 1、`0..1` = 不在が正当、`0..N` = 複数が正当、
`⚠` = 到達可能だが未モデル化 (負債)。

| 実体 | 状態集合 | 基数 | 権威 (唯一の書き手) | 詳細 |
|------|---------|------|-------------------|------|
| 選択モード | `object` / `edit` (2) | 1 | `SceneModel._selectionMode` — 入口は `setMode()` のみ (原則 #1) | STATE_TRANSITIONS §Top-level Modes / ADR-008 |
| マップモード | `active` boolean (2) | 1 | `MapModeController.state.active` | STATE_TRANSITIONS §Map Mode / ADR-031 |
| ⚠ *上二つの合成* | 文書上は OBJECT / EDIT / MAP の 3 択だが、実装は **別々の所有者に載る 2 変数** | — | 権威が二つ = `edit` かつ `mapMode.active` が表現可能 (不正状態が表現可能・§1.1) | 未 ADR — 統合するなら状態機械化が先 |
| Object Mode 操作 | `S_OBJECT_IDLE` ほか 10 | 1 | `AppController._opState` (`StateMachine`) | STATE_TRANSITIONS §Formal FSM · `src/core/editorStates.js` |
| Edit Mode 操作 | `EO_IDLE` / `EO_1D_DRAG` / `EO_2D_SKETCH_DRAW` (3) | 1 | `AppController._editOpState` (`StateMachine`) | STATE_TRANSITIONS §Edit Mode — Operation States |
| Edit Mode 部分状態 | `3d` / `2d-sketch` / `2d-extrude` / `1d` (4) | 1 | `SceneModel._editSubstate` | STATE_TRANSITIONS §Edit Mode Substates |
| マップ描画 | `idle` / `drawing` (2) | 1 | `MapModeController.state.drawState` | ADR-031 §1 / ADR-073 (`pending` を廃止) |
| grasp-search | `idle` / `no-layout` / `compiling` / `solving` / `results` / `error` (6) | 1 | `GraspController` — `uiStore.context.grasp` を丸ごと置換 (判別 union) | ADR-057 · `src/store/uiStore.js` |
| ロボット | 実体としては未モデル (名前 `robot_base` + `parentId === null` の duck-type) | ⚠ 実装は `1` 固定・実際は `0..N` が到達可能 | `SceneService.ensureRobotFrames()` が全入口で「1 台へ修復」= 権威が scene ではなく seed 規則 | **ADR-090 (Proposed)** — 同一性を実体へ、0/1/N を明示状態に |
| 誘導入力ウィザード | `step` / `review` (2) + 不在 | 0..1 | `ContextController` — `uiStore.context.wizard` を丸ごと置換 | ADR-063 Phase 3 / STATE_TRANSITIONS §context.wizard |
| オンボーディングツアー | `active` / `done` + `null` (3) | 0..1 | `AppController` (純粋遷移は `TourMath`) | ADR-065 Phase 6 / STATE_TRANSITIONS §tour |
| Home / 起動画面 | `open` + `null` (2) | 0..1 | `AppController` | ADR-089 / STATE_TRANSITIONS §home |
| CF 運動学ロール | fixed-joint 制約下のロール群 | 0..N | `SceneService._updateFastenedFrames()` | ADR-038 / STATE_TRANSITIONS §CF Kinematic Role |
| Origin CF ライフサイクル | Solid と原子的に生成・削除 | Solid 1 個につき 1 | `SceneService` (Solid 生成/削除経路) | ADR-037 / STATE_TRANSITIONS §Origin CF Lifecycle |
| `_worldPoseCache` | 有効 / 無効 (2) | 1 | `SceneService` — アクセサが鮮度を保証 (原則 #23) | STATE_TRANSITIONS §`_worldPoseCache` |
| 削除された実体 | 可視 / 不可視保持 / 実解放 (3) | 0..N | `CommandStack` が手放した時点で実解放 (原則 #10) | PHILOSOPHY #10 / `docs/code_contracts/memory_management.md` |

---

## 既知の負債 (この台帳が可視化したもの)

台帳を埋めた副産物として、**表を作らなければ見えなかった** 3 点を記録する。
いずれもこのコミットでは直さない (設計変更のため ADR が先) — 台帳の目的は
「見えるようにする」ところまで。

1. **モードの権威が二つある。** `STATE_TRANSITIONS.md` §Top-level Modes は
   OBJECT / EDIT / MAP を対等な 3 モードとして描くが、実装は
   `SceneModel._selectionMode` (2 値) と `MapModeController.state.active`
   (boolean) の直積。`edit` かつ `mapMode.active` は型として表現可能で、
   これを禁じているのは遷移経路の慣習だけ。3 値の enum 一つに畳めば
   不正状態が表現不能になる (§1.4「make illegal states unrepresentable」)。
2. **ロボットの基数が未モデル。** ADR-090 (Proposed) の対象。台帳の基数列が
   最初から存在していれば、`0..N` を埋める段で必ず問われていた欠陥。
3. **退役した状態が enum に残る。** `DS_PENDING = 'pending'` は ADR-073 で
   廃止済みだが `src/core/editorStates.js:38` に生存し、参照は 0 件。
   状態集合に「退役時に消す」責任者がいないことの痕跡
   (原則 #19 — documentation drift is a bug の、コード側の同型)。
