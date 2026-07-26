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

**基数列は必ず埋める。** 理由の正本は **PHILOSOPHY #31**
(Zero Is a State That Does Not Look Like One — 不在は検査対象のノードを持たないので、
*在るもの*を辿る検査は必ず素通りする)。この列はその原則の累積器側の現れであり、
埋める行為そのものが「0 のとき何が起きるか」を問わせる装置。
`0` が正当なら 0 のときの挙動を、`N` が正当なら「どれのことか」をこの列で名指しする。
空欄で通した結果が ADR-090 (原点に立つ無限リーチの幽霊ロボット)。

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
| Map 注釈ビューの motion | ライフサイクル `entering` / `idle` (2) × **直交する修飾子** `urgent` (違反アラーム) / `reduced` (静止した手掛かり) — 平坦な 4 状態ではない (平坦化すると `entering` かつ `urgent` が表現不能になる) | **`0..N`** — 0 = 空のマップは正当 (tick される view が無い)。**N が問題の所在**: 各注釈は `phaseFor(entityId)` 由来の独立位相を持つ。位相が同一なら全個体が同一フレームで動く lockstep で、1 個で試すと絶対に見えない (原則 #31) | 各 `Annotated*View.tick(t)` が唯一の書き手 (曲線は純粋 `MapVisualMath`、id の所有者は `SceneService`、`reduced` は単一境界 `src/theme/motion.js` の購読) | **ADR-093** · STATE_TRANSITIONS §Map annotation motion · `src/view/MapVisualMath.test.js` |
| LINK NETWORK パネル (可視性) | **直交する 2 軸** — `forceHidden` (外部オーバーレイ所有: Context DSL デモが段階③の種明かしを守るため伏せる) × `collapsed` (ユーザー所有: ヘッダの −/+)。平坦な 3 状態ではない (平坦化すると「デモ中にユーザーが畳んだ」が表現不能になり、デモ終了時に畳んだ意思が失われる) | 1 | `LinkNetworkView._applyVisibility()` — **パネルと SVG の両方の display を書く唯一の場所** (原則 #4)。軸ごとに書き手が分かれていた分裂 (`_toggleCollapse()` が SVG の display を直接書いていた) は ADR-094 実装で解消済み。ハンドラは**軸**を所有し、ピクセルは所有しない | **ADR-094** · ADR-048 §2.3 · `src/view/LinkNetworkView.js` |
| LINK NETWORK グラフのノード | 各ノードの表示状態 `focused` / `neighbor` / `context` / 通常 (4) — focus 源は「パネル hover ∪ 3D 選択」の合併 | **`0..N`** — 0 = リンクが 1 本も無い (パネルごと非表示。`_hasContent`)。**1 と N は別世界**: 行の重なり・ラベル衝突・`_denseMode` (行スロット < 22px) は Solid が N 個あって初めて出るので、1 個の fixture では絶対に見えない (原則 #31 / ADR-093 と同じ構図)。ADR-094 以降は **Solid と その Origin CF が 1 ノードへ融合**するため、ノードの基数は「TF フレームの数」であって実体の数ではない (実体 2 個 → ノード 1 個。`nodeIdByEntity` が「どの実体がどのノードを光らせるか」を 1 箇所で持つ) | 純粋関数 `LinkNetworkLayout.computeLayout()` — 位置・行数・融合・辺の解決の唯一の決定者。`LinkNetworkView` は結果を描くだけ (ADR-094 E3 で `_runLayout()` の副作用を分離。**辺の列挙順も出力の一部** = 交差した弧の重なり順は入力リンク列の順序に依存してはならない) | **ADR-094** · ADR-048 · `src/view/LinkNetworkLayout.test.js` |
| grasp-search | `idle` / `no-layout` / **`no-robot`** / `compiling` / `solving` / `results` / `error` (7) | 1 | `GraspController` — `uiStore.context.grasp` を丸ごと置換 (判別 union) | ADR-057 · ADR-090 (`no-robot` の追加) · `src/store/uiStore.js` |
| ロボット (台数) | 基数そのものが状態: `none` / `single` / `multi` (3 — `ROBOT_CARDINALITY`) | **`0..N`**。0 = 正当かつ安定 (grasp は `no-robot` で停止し理由を出す / 入口通過で復活しない)。N = どれかは **明示選択**が必要 (`selectRobot`; 1 台なら暗黙、0 台なら null — 既定で 1 台目を選ばない) | **scene** (`objects` 内の base/tcp CF 対) — 解決は `domain/robotFrames.js: resolveRobots()` の 1 箇所。生成の入口は `SceneService.addRobot()` のみ、seed は boot 経路のみ (`ensureRobotFrames({ seed: true })`) | **ADR-090** · STATE_TRANSITIONS §Robot roster · `src/domain/robotFrames.test.js` / `src/RobotRosterAuthority.test.js` |
| ロボット CF の TF ロール | `base` / `tcp` / 不在 (3) | ロボット 1 台につき base ちょうど 1 + tcp `0..1` (tcp 不在も正当 — `tcpOrientation` は core/ の代替軸へフォールバック。ADR-084 §3) | `SceneService._setRobotRole()` (唯一の書き手、`robotRoleChanged` を発行) — 値の解釈は `isRobotRole()` の 1 箇所 | ADR-090 Decision 1 · `CoordinateFrame.robotRole` (scene JSON / Layout DSL に往復) |
| 誘導入力ウィザード | `step` / `review` (2) + 不在 | 0..1 | `ContextController` — `uiStore.context.wizard` を丸ごと置換 | ADR-063 Phase 3 / STATE_TRANSITIONS §context.wizard |
| オンボーディングツアー | `active` / `done` + `null` (3) | 0..1 | `AppController` (純粋遷移は `TourMath`) | ADR-065 Phase 6 / STATE_TRANSITIONS §tour |
| Home / 起動画面 | `open` + `null` (2) | 0..1 | `AppController` | ADR-089 / STATE_TRANSITIONS §home |
| CF 運動学ロール | fixed-joint 制約下のロール群 | 0..N | `SceneService._updateFastenedFrames()` | ADR-038 / STATE_TRANSITIONS §CF Kinematic Role |
| Origin CF ライフサイクル | Solid と原子的に生成・削除 (2) | **Solid 1 個につき ちょうど 1**。0 = ADR-037 以前の保存シーン (到達可能・不正)。`findOriginFrame()` が `null` を返し、修復は名前付きの明示手順 `_ensureOriginFrames()` — 既定値で埋めない。N = 1 Solid に Origin 2 個は不正状態。生成経路は作らず、**予約名ガード** (`isOriginFrameName`) が改名からの到達を塞ぐ | 生成/削除 = `SceneService` (Solid 生成/削除経路)。**同一性の判定 = `src/domain/originFrame.js` の 1 箇所** (`isOriginFrame` / `findOriginFrame` / `ORIGIN_FRAME_NAME`) — 再導出は `IDENTITY_RULES` が落とす。改名の権威は `SceneService.renameObject()` (原則 #1) | ADR-037 §1/§4 · ADR-094 §波及 · STATE_TRANSITIONS §Origin CF Lifecycle · `src/domain/originFrame.test.js` |
| `_worldPoseCache` | 有効 / 無効 (2) | 1 | `SceneService` — アクセサが鮮度を保証 (原則 #23) | STATE_TRANSITIONS §`_worldPoseCache` |
| 削除された実体 | 可視 / 不可視保持 / 実解放 (3) | 0..N | `CommandStack` が手放した時点で実解放 (原則 #10) | PHILOSOPHY #10 / `docs/code_contracts/memory_management.md` |
| コミットの観測メタデータ | `未刻印` / `刻印済` / `刻印不能` (3 — 最後は push 済みで amend 不可になった終端) | コミット 1 個につき **`0..1`**。0 = 人間のコミット (帰属として正しい) か、`commit && push` 連鎖で刻む隙間が無かったもの。後者は `report` の `with Model-Effort: N / 総数` で**母数に現れる** (隠さず数える — 原則 #31) | `.claude/hooks/commit-trailers.sh` (唯一の書き手。PostToolUse で `--amend --only`) — 導出規則の正本は `scripts/commit-meta.mjs` の純粋関数 | **ADR-092** · STATE_TRANSITIONS §Commit observation metadata · `scripts/commit-meta.test.mjs` |
| GSN goal の支え | `unexplored` / `exploring` / 支えあり (3) — 鮮度軸 `state` とは直交 | 支え = strategy `0..N` + solution `0..N` + 下位 goal `0..N`。**総和 0 は宣言必須** (無宣言の 0 は lint エラー) | `.gsn` の木構造 + 予約 `labels` — 検査は `gsn_tool.py lint` (CI `pnpm test:gsn`) | STATE_TRANSITIONS §GSN goal support / PHILOSOPHY #31 / `.claude/skills/gsn-meta-framework/references/dsl-output.md` |

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
2. ~~**ロボットの基数が未モデル。**~~ **閉じた (ADR-090 実装)。** 基数は
   `ROBOT_CARDINALITY` (`none`/`single`/`multi`) として明示状態になり、権威は
   seed 規則から scene へ移った。台帳の基数列が最初から存在していれば、`0..N` を
   埋める段で必ず問われていた欠陥 — 記録として残す (原則 #31 の初出事例)。
3. **退役した状態が enum に残る。** `DS_PENDING = 'pending'` は ADR-073 で
   廃止済みだが `src/core/editorStates.js:38` に生存し、参照は 0 件。
   状態集合に「退役時に消す」責任者がいないことの痕跡
   (原則 #19 — documentation drift is a bug の、コード側の同型)。
4. ~~**Origin CF の同一性が 22 箇所に散っている。**~~ **閉じた (述語 PR / ADR-094 §波及)。**
   実測 16 箇所の判定 + 5 箇所の生成種名が 10 ファイルに散っていたものを
   `src/domain/originFrame.js` の 1 箇所へ集約し、`IDENTITY_RULES` に登録した
   (以後 `'Origin'` リテラルが所有モジュールの外に現れると CI が落ちる)。

   **集約の過程で見つかった穴も同時に閉じた。** ADR-037 §4 の保護表は
   「Origin を改名できない」しか列挙しておらず、**他の CF を `Origin` へ改名する**
   逆向きが無防備だった — 実行すると Solid が「自分のものではない、編集ロックされた
   削除不能な 2 つ目の body frame」を得る (上表の不正状態 N が改名だけで到達可能だった)。
   予約名ガードを権威側 (`SceneService.renameObject`) に置いて塞いだ。
   *名前を同一性に使う設計は、その名前を誰も後から獲得できないときにだけ健全*
   — 表を埋める作業がこの前提の欠落を炙り出した。

   なお同一性を宣言フィールド (`frameRole: 'origin'`、ADR-090 と同形) へ昇格させる
   選択肢は**未実施のまま開いている**。`robot_base` と違い `Origin` は親スコープ内で
   一意なので名前は正当なキーであり、scene JSON / Layout DSL / schema / 移行パスに
   波及する版上げ行為を今回の Goal は要求しなかった (§5 過剰モデリング禁止)。
   昇格が要るときは述語 1 モジュールの変更で済む — それが集約の配当。
5. **CoordinateFrame 軸の可視性に書き手が 2 つあり、行は既定値の種を持つ。**
   `meshView` の可視性を書く経路が 2 本ある — 永続の eye
   (`AppController._setObjectVisible` → `SceneService.setObjectVisible`) と、選択駆動の
   `SelectionManager.showFrameChain` / `showGeometryFrameTree` / `hideFrameChain`。
   後者は eye を読みも書きもしないので、最後に走った方が勝つ (原則 #4)。加えて
   `OutlinerView._createRow` の行は `visible: true` を**ハードコードした種**として持ち、
   view (`CoordinateFrameView` は生成時 `_group.visible = false`) を一度も読まない。

   帰結として起動直後、`tcp` 行の eye は開いているのに軸は描かれていない
   — **行は最初から嘘をついている**。その eye を 1 回押しても `!visible` = `false` が
   送られるだけで何も起きない (原則 #11)。`robot_base` だけ閉じて見えるのは、ブート経路の
   `_hideRobotByDefault()` が base フレームにだけ手続き的に打っているから。

   ADR-087 が宣言した「可視性の所有者は Outliner の eye ちょうど 1 箇所」は、
   **スケルトンについてだけ**閉じており CF 軸については未達。**ADR-096 (Proposed)** が
   `explicit × contextual` の直交 2 軸 + 合成 1 箇所で閉じる予定。実装時にこの行を
   台帳本表 (基数 `0..N`、権威 = 合成関数) へ昇格させる。

   *boolean の既定値 `true` は「まだ誰も何も言っていない」を「見えている」と区別できない*
   — 基数の欄を空欄で通したのと同型の失敗が、真偽値の既定で起きている (原則 #31)。

6. **接地 (支持) が実体の状態ではなく、ジェスチャの副作用でしかない。**
   「地面より下に行かない」は不変条件ではなく `GrabOperationHandler._applyStackSnap()` の
   補助 (ADR-071) で、ジェスチャが終われば何も残らない。したがって経路が変わると消える —
   軸拘束 `z` では降ろされ (`stackApplies = stackMode && axis !== 'z'`)、非 Solid では
   冒頭で早期 return し、`mounts` の毎フレーム追従 (`_updateMountedAnnotations`) は
   ドラッグ中の座り直し (`_mapObjectPlateDelta`) を後から上書きする (原則 #4)。

   **不変条件は散文にしか無い**: `SceneService._isMapObject()` の JSDoc が
   「must stay pinned to the ground plane or a building roof, never floating」と書いて
   いるが、これを問う検査はどこにも存在しない (憲法 Q3 の答えが「誰も開かない散文」)。
   さらに `mounts` は SpatialLink なので端点が実体でなければならず、**地面は実体ではない**
   ため「地面の上」は語彙の外にある。

   **ADR-097 (Proposed)** が `placement` (`supported`/`grounded`/`free` — 生成時決定・不変) と
   `belowGradeIntent` (可変・基数 `0..N`) を宣言し、支持は幾何から導出 (保存しない)、
   強制は pose の唯一の入口へ集約する予定。実装時にこの 2 実体を台帳本表へ昇格させる。

   *この欠陥の blast radius は「実体種の集合」ではなく「pose を書ける入口の集合」だった*
   — 症状が種ごとに現れたのは入口ごとに実装したからで、種の問題に見えたのは症状の側。
   ゆえに検査も「支持を持つべき種を列挙して、支持を持たない個体の個数が 0 か」を問う形に
   なる (ADR-090 の 0 台・ADR-093 の N 個に続く原則 #31 の 3 例目)。
