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
| LINK NETWORK グラフのノード | 各ノードの表示状態 `focused` / `neighbor` / `context` / 通常 (4) — focus 源は「パネル hover ∪ 3D 選択」の合併。**`denseMode` は ADR-095 で廃止** (返り値から消滅 — 退役した状態を enum に残さない。台帳 §既知の負債 3 の同型を作らない) | **`0..N`** — 0 = リンクが 1 本も無い (パネルごと非表示。`_hasContent`)。**1 と N は別世界**: レーン衝突・行あふれ (スクロールへの移行)・インデント飽和は N でしか出ないので、1 個の fixture では絶対に見えない (原則 #31 / ADR-093 と同じ構図)。ADR-094 以降は **Solid と その Origin CF が 1 ノードへ融合**するため、ノードの基数は「TF フレームの数」であって実体の数ではない (実体 2 個 → ノード 1 個。`nodeIdByEntity` が「どの実体がどのノードを光らせるか」を 1 箇所で持つ)。ADR-095 以降は **1 ノード = 1 行**で、基数はそのまま行数 | 純粋関数 `LinkNetworkLayout.computeLayout()` — 行順・インデント・レーン・ラベル幅・パネル高の唯一の決定者。`LinkNetworkView` は結果を描くだけで座標を 1 つも計算しない (ADR-094 E3 で `_runLayout()` の副作用を分離。**辺の列挙順も出力の一部** = 交差した弧の重なり順とレーン割当は入力リンク列の順序に依存してはならない) | **ADR-095** · ADR-094 · ADR-048 · `src/view/LinkNetworkLayout.test.js` |
| LINK NETWORK 余木辺 (SpatialLink) のレーン | `lane 0..MAX_LANES-1` に載る / `dropped` (レーン枯渇で描かれない) の 2 種 | **`0..N`** — **0 = 余木辺が 1 本も無い → ガター幅 0** (不在のものを既定サイズで先取りしない。埋めるとラベルが払う — Yellow Card「必須入力の欠落に既定値を与えない」の同型)。1 = レーン 1 本。N = 行区間が重なる本数ぶんレーンが増え、`MAX_LANES` を超えた分は両端の行の `+N` バッジへ縮退 (無言で消さない — 原則 #11) | `LinkNetworkLayout.computeLayout()` — 辺の正準順 `(source, target, id)` を走査する決定的な区間彩色。View は `lane` を読むだけで再導出しない | **ADR-095** · `src/view/LinkNetworkLayout.test.js` |
| LINK NETWORK ノードのインデント飽和 | `depthSaturated` true / false (2) — 真のとき行頭に実深さのバッジが出る | **`0..N`** ノード。0 = 深さ `MAX_INDENT_DEPTH` 以下のシーン (通常)。N = 深い CF 連鎖。x も有限資源なので、可変量 (深さ) を無制限に流し込まない — y 側で犯した過ちを x 側で繰り返さないための状態 | `LinkNetworkLayout.computeLayout()` | **ADR-095** · `src/view/LinkNetworkLayout.test.js` |
| LINK NETWORK パネル (スクロール位置) | 連続値 (`scrollTop`)。`scrollable` (内容が表示域を超えたか) は導出 | **1** — パネルは 1 つ。**0 は無い**: 内容が短くてもコンテナは在り `scrollTop = 0` を持つ (「スクロールできない」は状態の不在ではなく `scrollable === false`) | **DOM 要素 `LinkNetworkView._scrollEl.scrollTop` ただ 1 箇所。JS 側に鏡像を持たない** — 再描画は SVG の子要素を作り直すがコンテナには触らないので hover でスクロールが飛ばない。鏡像を持てば第二の源 (§1.1) であり、それはスクロール機能の要件ではない | **ADR-095** · ADR-048 §2.3 · `src/view/LinkNetworkView.js` |
| grasp-search | `idle` / `no-layout` / **`no-robot`** / `compiling` / `solving` / `results` / `error` (7) | 1 | `GraspController` — `uiStore.context.grasp` を丸ごと置換 (判別 union) | ADR-057 · ADR-090 (`no-robot` の追加) · `src/store/uiStore.js` |
| ロボット (台数) | 基数そのものが状態: `none` / `single` / `multi` (3 — `ROBOT_CARDINALITY`) | **`0..N`**。0 = 正当かつ安定 (grasp は `no-robot` で停止し理由を出す / 入口通過で復活しない)。N = どれかは **明示選択**が必要 (`selectRobot`; 1 台なら暗黙、0 台なら null — 既定で 1 台目を選ばない) | **scene** (`objects` 内の base/tcp CF 対) — 解決は `domain/robotFrames.js: resolveRobots()` の 1 箇所。生成の入口は `SceneService.addRobot()` のみ、seed は boot 経路のみ (`ensureRobotFrames({ seed: true })`) | **ADR-090** · STATE_TRANSITIONS §Robot roster · `src/domain/robotFrames.test.js` / `src/RobotRosterAuthority.test.js` |
| ロボット CF の TF ロール | `base` / `tcp` / 不在 (3) | ロボット 1 台につき base ちょうど 1 + tcp `0..1` (tcp 不在も正当 — `tcpOrientation` は core/ の代替軸へフォールバック。ADR-084 §3) | `SceneService._setRobotRole()` (唯一の書き手、`robotRoleChanged` を発行) — 値の解釈は `isRobotRole()` の 1 箇所 | ADR-090 Decision 1 · `CoordinateFrame.robotRole` (scene JSON / Layout DSL に往復) |
| 誘導入力ウィザード | `step` / `review` (2) + 不在 | 0..1 | `ContextController` — `uiStore.context.wizard` を丸ごと置換 | ADR-063 Phase 3 / STATE_TRANSITIONS §context.wizard |
| オンボーディングツアー | `active` / `done` + `null` (3) | 0..1 | `AppController` (純粋遷移は `TourMath`) | ADR-065 Phase 6 / STATE_TRANSITIONS §tour |
| Home / 起動画面 | `open` + `null` (2) | 0..1 | `AppController` | ADR-089 / STATE_TRANSITIONS §home |
| CF 運動学ロール | fixed-joint 制約下のロール群 | 0..N | `SceneService._updateFastenedFrames()` | ADR-038 / STATE_TRANSITIONS §CF Kinematic Role |
| Origin CF ライフサイクル | Solid と原子的に生成・削除 (2) | **Solid 1 個につき ちょうど 1**。0 = ADR-037 以前の保存シーン (到達可能・不正)。`findOriginFrame()` が `null` を返し、修復は名前付きの明示手順 `_ensureOriginFrames()` — 既定値で埋めない。N = 1 Solid に Origin 2 個は不正状態。生成経路は作らず、**予約名ガード** (`isOriginFrameName`) が改名からの到達を塞ぐ | 生成/削除 = `SceneService` (Solid 生成/削除経路)。**同一性の判定 = `src/domain/originFrame.js` の 1 箇所** (`isOriginFrame` / `findOriginFrame` / `ORIGIN_FRAME_NAME`) — 再導出は `IDENTITY_RULES` が落とす。改名の権威は `SceneService.renameObject()` (原則 #1) | ADR-037 §1/§4 · ADR-094 §波及 · STATE_TRANSITIONS §Origin CF Lifecycle · `src/domain/originFrame.test.js` |
| 実体の可視性 | **直交する 2 軸** — `explicit` boolean (ユーザー所有・永続: Outliner の eye が「常に見せろ」と言ったか) × `contextual` `full`/`dimmed`/不在 (選択所有・一時: 選択や link mode がその場だけ見せたい強さ)。平坦な 3 状態ではない (平坦化すると「文脈表示中にユーザーが常時表示を要求した」が表現不能になり、選択を変えた瞬間にユーザーの意思が消える — ADR-094 の `forceHidden × collapsed` を平坦化できなかったのと同型)。遷移に guard は無く不正遷移も存在しないので状態機械の節は起こさない (§1.4 の発動条件は「3 状態以上 **かつ/または** 不正遷移が事故」の論理和で、後者が立たない) | **`0..N`** — 0 = 実体が 1 つも無いシーン (合成が呼ばれない = 正当)。**`explicit` は「未宣言」を持たない**: 種ごとに**宣言**された既定 (`EXPLICIT_DEFAULTS`) が答え、未宣言の種は `defaultExplicit()` が throw する (既定値で埋めない — 原則 #31)。`robot_base` だけは既定が**種ではなく生まれた入口**で決まる (seed = 伏せる / `addRobot()` = 見せる)。**永続化しない** — presentation 状態はワイヤに載せない (原則 #29)、要件が立てば別 ADR | 合成 = `SceneService.applyEntityVisibility()` **ただ 1 箇所** (原則 #4)。`explicit` の書き手は `setExplicitVisible()` / `declareExplicitVisible()`、`contextual` の書き手は `setContextualFrames()` (**丸ごと置換のみ** — 個別削除を許さないので「文脈から外れたのに消し忘れた 1 個」が書けない)。Outliner の行・robot skeleton は軸を**表示**するだけで写しを持たない | **ADR-096** · ADR-087 · `src/view/VisibilityAxes.test.js` / `src/VisibilityOwnership.test.js` / `src/controller/SelectionManager.test.js` |
| 実体の配置方針 (`placement`) | `supported` (必ず何かの上) / `grounded` (床下は宣言が要る) / `free` (支持の概念なし) の 3。**生成時に種で決まり遷移しない**ので分類であって lifecycle ではない — §1.4 の「3 状態以上」は形式的に立つが「不正遷移が事故」が立たないため遷移図は起こさない。代わりに効くのは **不正状態を表現不能にする**方: `supported` かつ支持なしは*組み合わせとして*到達可能なので、それを書けない API 形状 (入口 1 つ + 支持は導出) にするのが ADR-097 の決定そのもの | 実体 1 個につき **ちょうど 1**。**「未宣言」を持たない** — 種ごとに**宣言**された表 (`PLACEMENT_BY_KIND`) が答え、未宣言の種は `placementFor()` が throw する (既定値で埋めない — 原則 #31。ADR-096 の `EXPLICIT_DEFAULTS` と同じ形)。`robot_base` CF だけは同じ `CoordinateFrame` の中でロールで分かれる (base = `grounded` / tcp = `free`) | **保存しない。種の関数**。`src/domain/placement.js` の `placementOf()` ただ 1 箇所が `instanceof` の連鎖を持ち、呼び出し側での再導出は `src/PosePolicyOwnership.test.js` が落とす | **ADR-097** · ADR-071 · `src/domain/placement.test.js` |
| 床下の宣言 (`belowGradeIntent`) | `true` (基礎・杭・ピットとして意図的) / `false` (誰も宣言していない) の 2 | **`0..N`** — 0 = 誰も宣言していないシーン (通常)。**既定 `false` は「宣言されていない」の意味であり、潜れない側に倒す** (「気づいたら潜っていた」と「潜ると決めた」を区別するのが目的なので、既定で潜れると区別が消える)。`grounded` 実体だけが持ち、`supported` には逃げ道が無い (支持の無いマップオブジェクトは意味を持たない) | `SceneService.setBelowGradeIntent()` ただ 1 箇所。入口は Grab 中の S (Free) と import 時の `_adoptBelowGradeIntent()`。**永続化しない** — 幾何が既に事実を持つので、読み込み時に幾何から再導出する (第二の源を作らない・scene schema を上げない — §1.1) | **ADR-097** §Decision 6 · `e2e/smoke.spec.js` (宣言がジェスチャを越えて残る) |
| 実体の支持 (`support`) | `{kind:'ground'}` / `{kind:'entity', id}` / `null` (浮いている) の 3 | 実体 1 個につき **`0..1`**。**`null` は `supported` 実体では不正状態** — 散文にしか無かった「never floating」がこの欄の述語になった。検査は *在るもの* を辿らず「支持を要する種を**列挙して**、支持を持たない個体の**個数**が 0 か」を問う形 (ADR-090 / ADR-093 と同じ構図の 3 例目)。`free` 実体では `null` が正当 | **導出のみ・保存しない**。`SceneService.supportOf(id)` が毎回幾何から計算する (保存すると「動かしたが支持が古い」ドリフトが生まれ、それは `mounts` の Z 二重書き込みと同型の事故になる)。**水平支持面のみ** — 下向きレイに依存するので壁面・天井・傾斜面は表現できない (要件が立てば別 ADR) | **ADR-097** §Decision 2 · `src/domain/placement.test.js` · `e2e/smoke.spec.js` |
| 支持プローブ (`SUPPORT_PROBE_BY_KIND`) | 種ごとの `{footprint, bottom}` の対 — `bottomFaceAndCentroid`×`minCornerZ` (幾何実体) / `originPoint`×`originZ` (CF) / `none`×`none` (底を持たない)。**状態ではなく宣言**なので遷移しない | **`PLACEMENT_KIND` と 1:1 でちょうど 7 行**。欠落 0・余り 0 を両向きに数える (`placement.test.js`)。**`none` は「持たない」の宣言であって未記入ではない** — 未宣言の種は `supportProbeFor()` が throw する。ここが空欄で通ると、その種は黙って `corners=[]` → `null` を返して「支持なし」に**見える** (原則 #31 — 方針表は throw するのにプローブは黙る、という非対称が ADR-098 の欠陥だった) | `src/domain/placement.js` の宣言表 ただ 1 箇所。`SceneService` は宣言を読んで幾何を渡すだけの実行系で、種分岐を持たない (`PosePolicyOwnership.test.js` が名指しした 7 メソッド内の `instanceof` を 0 個に数える) | **ADR-098** · ADR-097 · ADR-085 · `src/domain/placement.test.js` · `src/PosePolicyOwnership.test.js` |
| stack assist の適用範囲 | 実体ごとに `適用する` / `適用しない` の 2 — **方針の関数** (`stackAssistApplies(placement)` = `supported` ∪ `grounded`) | 動く実体のうち適用対象は **`0..N`**。0 = `free` だけを動かしている (補助は何もしない = 正当)。**除外の理由は種ではなく方針**であることが要点 — かつて `instanceof Solid` の門が 2 枚在り、その結果 `grounded` が種によって 2 つの意味を持っていた (Solid = 床を割らない**かつ**面に載る / robot_base = 床を割らない**だけ**) | `src/domain/placement.js` の `stackAssistApplies()` ただ 1 箇所 (`hasGroundInvariant` へ委譲 — 同じ述語を 2 本書かない)。適用は `SceneService._applyStackAssist()` | **ADR-098** §Decision 1 · ADR-071 · `e2e/smoke.spec.js` (ロボットが載る / S で載らない / free な CF は載らない の 3 本) |
| pose 計算の入力の鮮度 | **状態ではなく規律** — 読める幾何が 2 種類ある: `描画済み` (live プローブ / `_worldPoseCache` 由来、rAF ごとに更新) と `要求` (セグメント開始の写し + 適用済み delta)。writer が前者を 読むと自分の出力が入力に戻る (原則 #24)。**基数が状態に見えない典型** — どの実体にも「この値はいつのものか」を書く欄が無いので、*在るもの*を読む限り永久に見えない (原則 #31) | pose を計算するメソッドのうち **live プローブを読むものが 0 個**。逆向きに、補助がスナップショット入力を引いている箇所が **1 以上**。0/1 の両方を数えないと、経路ごと消えたときに規則が空回りしていることと区別がつかない。**鮮度は種で割れる** — `corners` で測る実体 (Solid) は同期的に新鮮、原点で測る実体 (robot_base / CF) だけが 1 フレーム古い。同じコードがキューブでは安定しロボットでは周期 2 で振動した | 分離の宣言 = `SceneService` の live プローブ JSDoc (query 専用) + `docs/code_contracts/architecture.md`。機械側の問い所 = `src/PosePolicyOwnership.test.js` の `POSE_COMPUTING_METHODS` × `LIVE_PROBES` | **ADR-101** · ADR-098 · 原則 #24 / #23 · `e2e/smoke.spec.js` (同じ要求を 5 回通して pose が 1 種類 — ロボットと箱の両方) |
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
5. ~~**CoordinateFrame 軸の可視性に書き手が 2 つあり、行は既定値の種を持つ。**~~
   **閉じた (ADR-096 実装)。** 本表「実体の可視性」の行へ昇格した。書き手は
   `explicit` / `contextual` の 2 軸に分かれ、ピクセルを書くのは合成
   `SceneService.applyEntityVisibility()` ただ 1 箇所。行の `visible: true` の種は
   消え、既定は種ごとの**宣言** (`EXPLICIT_DEFAULTS`) になった
   (`_hideRobotByDefault()` はその宣言に吸収されて削除)。

   *boolean の既定値 `true` は「まだ誰も何も言っていない」を「見えている」と区別できない*
   — 基数の欄を空欄で通したのと同型の失敗が、真偽値の既定で起きていた (原則 #31)。
   **未宣言の種を `defaultExplicit()` が throw する**のが、その同型を再発させないための
   機械側の問い所 (`src/view/VisibilityAxes.test.js`)。**発見された 3 人目の書き手**:
   `LinkCreationHandler` が link mode 中に全 CF を直接塗っており、ADR 起票時の波及表には
   無かった (探索で出た — 俯瞰は書き手を 2 つと見積もっていた)。

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
