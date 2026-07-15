# 072. 2D マップ研磨 — ADR-069 Phase 4: マップ面を 3D 層の統治に合流させる

- Status: Accepted
- Date: 2026-07-15
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし(ADR-069 Phase 4 の実施; ADR-031 の三状態描画モデル・
  ADR-068 の CameraFlight・ADR-022 のコマンドパターン・ADR-065 Phase 2 の
  SnapFeedbackMath/SnapFlash を無改変で再利用/拡張)

## Context — Goal と力学(§1.2 Goal)

ADR-069 の Goal(*3D 層が確立した品質基準 — イージング・中断可能・reduced-motion・
トークン・#30 Motion Tier — を取り残された面へ波及させる*)の最終 Phase。ユーザの
第 10 観察「2D マップが単純」を横断調査した結果、マップ面には **3 つの統治ギャップ**が
残っていた:

1. **カメラのカット**: Map Mode の出入り(`useOrthoCamera(true/false)`)は透視 ⇄
   正射影を **1 フレームで切り替える** — ADR-069 決定 1 がギズモから除去したのと
   同種の、モーション系を迂回する最後のカメラ面。
2. **undo 経路の欠落**: マップ配置(`_confirmDrawing` → `createAnnotated*`)は
   **CommandStack を通らない唯一の実体追加経路**。Ctrl+Z が効かず(3D の全 add 経路
   との非対称)、副作用として ADR-065 Phase 2 の materialize 演出も発火しない
   (landing listener は CommandStack 着地でのみ鳴る)。削除側は既に
   `createDeleteCommand` 経由 = 半分だけ統治下という歪み。
3. **スナップ係合の無音**: PC の端点スナップは静的リング表示のみ。3D グラブの同じ
   事象(ロック係合)は ADR-065 Phase 2 完結でフラッシュを得た — 同一事実・同一
   語彙(`fxSnap`)の面が片側だけ無音。

## Options considered

- **A: 三ギャップを既存部品の再利用で閉じる(採用)** — CameraFlight / コマンド
  パターン / SnapFeedbackMath をそのまま消費。新規の数学は透視⇔正射影の
  フレーミング一致 2 関数のみ。tradeoff: 投影スワップの振付に非自明な設計判断が要る。
- **B: 正射影カメラ自体を透視カメラの FSM に統合(単一カメラ + fov→0 ドリーズーム)** —
  カットが原理的に消えるが、OrbitControls・全ヒットテスト・HTML オーバーレイ投影の
  blast radius が過大。棄却。
- **C: 現状維持** — ADR-069 の Goal(パリティ)に反する。棄却。

## Decision — Strategy(§1.2 Strategy)

### 決定 1 — Map Mode の出入りは「一致ポーズでの投影スワップ + CameraFlight」

投影(透視⇔正射影)は補間できないが、**フレーミングが一致する瞬間のスワップは
カットとして知覚されない**。一致条件は純粋な相互逆関数として `CameraMath.js` に置く:

- `frustumForDistance(dist, fovDeg) = 2·dist·tan(fov/2)` — 距離 d の透視カメラが
  ターゲット平面で張る縦視野 = その ortho frustum 高。
- `distanceForFrustum(frustum, fovDeg)` — その逆。round-trip 恒等を machine-pin。

**入り(enter)**: モード状態は即時に active(§1.4 状態が先・演出は従)。透視カメラを
現ターゲット真上のステージングポーズ(`up=(0,1,0)` = ortho と同じ画面北; 離散適用 +
OrbitControls `_quat` 同期 — ADR-069 決定 1 と同じ「向きは motion でない」規約)へ
`AppController.flyToMapView` — `MotionGovernor.spawn(reduced => CameraFlight)` — で
飛ばし、**フライト終端で** `useOrthoCamera(true, frustumForDistance(dist))` にスワップ。
`CameraFlight` に加算的 `opts.onDone`(自然着地・`finish()`・stolen・dispose の
いずれでも**ちょうど 1 回**発火)を追加する — スワップはモードの終端状態なので、
フライトがどう終わっても必ず到達する(#11 半端状態の禁止)。exit 済みなら no-op
(controller が `state.active` を確認)。OrbitControls は enter 直後に無効化
(フライト中のオービット競合を封じる — 描画ハンドラは既に全イベントを consume)。

**出(exit)**: 現在の ortho 中心/ズームから一致する透視ステージングポーズを**即時に**
組み立て(1 フレーム完全一致のスワップ)、`useOrthoCamera(false)` 後、enter 時に保存した
元ポーズへ `flyToView`(up=(0,0,1) 復元は既存の離散適用)。**external-write ガード**:
スワップ後に透視カメラが第三者(scene ロードの `fitCameraToSphere` 等)に書かれて
いたら、再配置もフライトもせずスワップのみ — カメラの権威は最後に意図を持って
書いた者(CameraFlight `_cameraStolen` と同じ規約)。reduced motion は
CameraFlight 側で即着地 = 従来の即時切替に degrade(#30 静的キュー)。

### 決定 2 — マップ配置は CommandStack に合流し、演出パリティは語彙合流で無償化

新 `createAddAnnotationCommand(objRef, sceneService, onAfterUndo)`(ラベル
`Add "${name}"`) を `_confirmDrawing` が **post-hoc push** する(CommandStack
push() vs execute() 規則 — 生成は既に完了している)。undo = `detachObject` +
`setVisible(false)`(soft-delete 対称)、redo = `reattachObject` + `setVisible(true)`。
Annotated 実体は子 CF を持たないので children 走査は不要。`placeType` は実体 ref に
残るため detach/reattach を素通しで生存(1 ジェスチャ = 1 undo)。

**非自明な帰結**: ラベル `Add "…"` は `CommandFeedbackMath` の既存 lifecycle 行
`/^Add "/` に**そのまま合流**する — materialize(push/redo)・dissolve(undo)の
発火・anchor 捕捉(`objectAdded`/`objectRemoved` — Annotated 実体は `corners`
getter を持つ)・VoxelBurst の radial fallback(8 corners でないため)まで、
**演出側の変更ゼロ**で成立する。演出パリティを新コードでなく語彙の単一性(核 §1.1)
から得るのがこの決定の本体。

### 決定 3 — 端点スナップ係合フラッシュは既存の純粋層をそのまま消費

`MapModeController` は描画中 pointermove ごとに `snapCandidate` から
`geometrySnapshot` を作り、controller-local な `_snapFxPrev` と `snapTransition` で
engage/retarget を検出、`snapFlashDescriptor('geometry', …)` → `SnapFlash` を
`MotionGovernor.spawn` する。数式・ビュー・色(`fxSnap` オレンジ)・音量規律
(same-key hold と解除は無音)は ADR-065 Phase 2 完結のものを**一切複製せず**再利用。
半径は把持実体が無いので **frustum 比例**(`frustumSize × 0.075` — 画面比一定 #27)を
entityRadius として渡す。`_snapFxPrev` はツール変更・キャンセル・pending 遷移・exit で
リセット(presentation history は controller-local — ADR-059 と同規則)。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的: 最後のカメラカットが消える。マップ配置が全実体追加経路と同じ undo /
  materialize 統治下に入る。スナップ係合の語彙が 3D/2D で単一化。
- 受け入れるコスト: enter フライト中(≤620ms)は透視のまま描画開始できる(ray-plane
  ピッキングは投影非依存で正確 — 歪みは見た目のみ・一過性)。ステージング一致は
  フレーミングの一致であり視差の一致ではない(スワップ瞬間に僅かな平行視差の変化 —
  真上ビューでは実用上不可視)。
- 検証(証拠): CameraMath round-trip 恒等 + 単調性 unit テスト; 既存 unit 全 pass /
  `tsc` clean / `vite build` clean; E2E スモーク新規「map mode places a route and
  undo removes it」(Map 入場フライト → ツール → 描画 → confirm → undo の配線
  liveness — checkJs は controller 層除外ゆえ唯一のガード)。
- 波及(blast radius): `CameraMath.js`(+2 純関数)/`CameraFlight.js`(加算的
  `onDone`)/`AppController`(`flyToMapView`)/`MapModeController`(enter/exit/
  confirm/snap-fx)/新 `AddAnnotationCommand.js`。契約・schema・DSL 版・BFF は
  無改変(純クライアント体感層 — ADR-069 と同じ)。

## Lens notes

- 様態: Map Mode の三状態描画モデル(ADR-031 idle/drawing/pending)は不変 —
  カメラ振付はモード FSM の外側の presentation(状態が先、演出が従 §1.4)。
- 層 + 契約: `CameraFlight` の契約は加算的拡張のみ(`onDone`; 既存消費者
  focusSelection/flyToView は未指定 = 挙動不変)。

## Links
- ADR-069(Phase 4 の親・ギズモ = 同型の先行修正), ADR-068(CameraFlight 契約),
  ADR-031(マップ三状態), ADR-022(コマンドパターン), ADR-065 Phase 2(SnapFlash /
  landing lifecycle 語彙), PHILOSOPHY #11/#27/#30, 核 §1.1/§1.4
