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

## Addendum — 洗練パス(同日・animation-fx ゲート適用)

品質ゲート(一斉動作禁止・境界の演出・停止状態を作らない)を #30 統治下で追加適用:
描画カーソルドットに **entry ポップ(easeOutBack) × 2 非整数比正弦の呼吸**(Tier A —
クロームのアクティブツール呼吸グローのビューポート兄弟)、スナップリングに **出現セトル**
(Tier A 境界 — transient な SnapFlash が*事象*を語り、ポップは*永続状態の入場*を語る =
重複でなく合成; retarget での再ポップはしない — 位置ジャンプ自体が事実)。曲線は純粋
`src/view/MapPreviewMath.js`(+5 テスト: reduced = 恒等スケール 1・malformed → 恒等・
有界性・非静止)。ロックインジケータは呼吸しない(脈動するロックは不安定の合図 = 主張の
逆)。tick は `AppController._animate` の既存 tick 列に合流。フライトのイージングは
ADR-068 の単一契約(easeOutCubic)を維持 — 面ごとの分岐は「導出は一つ」に反するため
見送り。

## Addendum — 視認性修正(2026-07-16・ユーザフィードバック)

ユーザ報告:「2D マップ(Top view)で Cube やマップオブジェクトが**黒く**見え、
どこに配置したか分からない」「マップオブジェクトは z=0 か天面に置くもので、空中に
浮くべきでない(今は Move すると浮く)」。二つの独立した不変条件をマップ面に追加した。

### A — 正射影マップカメラ稼働中は深度フォグを退避

「黒い」の根因は**シェーディングではなく `FogExp2` 深度フォグ**だった(トップ面は
むしろ最も明るい)。正射影カメラは z≈0 のマップ平面の**固定 100 単位上**に据わる
(`SceneView.useOrthoCamera`/`panOrthoCamera`)一方、フォグ密度は**透視カメラの短い
スタンドオフ用にチューニング**されている(`SceneStage`, 0.024)。深度 100 では
`1 − exp(−(0.024·100)²) ≈ 0.997` = ほぼ全材質がフォグ色 `0x15152a`(近黒)へ混合され、
ライト付き Cube も unlit の注釈フィルも黒く沈む。これは PHILOSOPHY #27 と同型の
「あるカメラ想定でチューニングした値が別投影で破綻する」バグ。

`SceneStage` が `scene.fog` の唯一の所有者(ADR-067 / PHILOSOPHY #4)なので退避も
そこに置く: 新 `SceneStage.setFogSuspended(bool)` は `scene.fog` を `this._fog`⇄`null`
で切り替えるだけ(`this._fog` は所有オブジェクトのまま — 密度は `setScale` が維持)。
`SceneView.useOrthoCamera(enable)` が enable/disable 両分岐でこれを呼ぶ = 不変条件
「フォグ off ⇔ 正射影トップダウンカメラ稼働」を単一の場所で保証(正射影はマップ面
専用ゆえ MapModeController の改変は不要)。

### B — マップオブジェクトは max(建物天面, 0) に着く平板 — 配置も Move も浮かせない

マップオブジェクト(注釈 = AnnotatedPoint/Line/Region)は**全頂点が同一 Z を共有する
平板**とし、その Z = `max(フットプリント直下の最も高い Solid 天面, 0)`。これで「z=0 か
建物天面、決して空中」を配置と Move の両方で満たす。全頂点同一 Z ゆえ既存の単一デルタ
`move(startCorners, delta)` API で表現でき、新ドメイン API も頂点 Z 直書きも不要
(PHILOSOPHY #1)。

- 下向きレイキャストの単一源: `SceneService.highestSurfaceZAt(samples2D, excludeIds)`
  — `GrabOperationHandler._applyStackSnap` に埋まっていた「z=10000 から下向き →
  最高ヒット → `max(hit, 0)`」を抽出(核 §1.1)。`_applyStackSnap` はこれを消費するよう
  リファクタ(挙動不変)。
- 配置: `MapModeController._confirmDrawing` が実体生成直前に共通 Z を計算し全頂点へ
  適用(`_pickPoint` は正射影プレビュー用に z=0 を返し続ける — Z はトップ視で不可視)。
- Move: `SceneService.applyPreviewTranslation` の注釈分岐が **XY のみ**移動し、
  `_mapObjectPlateDelta` で平板全体を新 XY 直下の `max(天面, 0)` へ再着地させる。
  `worldDelta` の Z 成分は破棄 = 自由ドラッグや G→Z でもマップオブジェクトは浮かない。

検証: unit **648 pass** / `tsc` clean / `vite build` clean / E2E **11 pass**(map テストに
配置済みアンカーの G グラブ移動を追加 — `_mapObjectPlateDelta` 配線の liveness ガード)。
視覚確認: マップ面で Cube が黒でなく基調色で描画(スクリーンショット確認)。契約・
schema・DSL 版・BFF は無改変。

## Addendum — カメラ復帰 + 配置粒度(2026-07-16・ユーザフィードバック)

ユーザ報告:「マップモードから戻る時にカメラがリセットされない。動ける姿勢範囲が
マップモードに入る前と異なる」「マップオブジェクトの配置グリッドが粗い(3D canvas 上
での配置操作がかなり粗い)」。二つの独立した修正。

### C — CameraFlight の `onDone` は着地(終端カメラ書き込み)の**後**に発火する

決定 1 の出口 `exit()` は「external-write ガード」(`_stagedPos` と現透視カメラ位置の
一致判定)で `stolen` を検知し、盗まれていれば復帰フライトをスキップする。この
`_stagedPos` は enter フライトの `onDone`(`_completeEnterSwap`)が `camera.position` を
読んで捕捉する。しかし `CameraFlight` は `onDone` を **`_land()` より前**に発火して
いた(`_markDone(); _land()` の順)。結果、フライトが**中断**されたとき(ユーザーが
ツールを選んで即クリック → `_finishCameraFlight` → `finish()`)や **reduced motion**
時、`_stagedPos` はフライト途中(または開始時)のポーズを捕捉し、`_land()` が直後に
カメラをステージングポーズへジャンプさせる → `_stagedPos ≠ 実カメラ位置`。exit の
`stolen` 判定が**誤発火**し、`flyToView(saved)` が呼ばれず**カメラが復帰しない**。
これがユーザーの「戻ってもリセットされない/姿勢範囲が変わる」の根因。

修正は `CameraFlight` の順序だけ:三経路すべてで `onDone`(= `_markDone`)を**終端
カメラ書き込みの後**に発火する(`constructor` reduced、`tick` の `p≥1`、`finish` の
非 stolen 分岐で `_land(); _markDone()`)。盗まれている `finish`/`tick` 分岐では着地せず
`onDone` は最後に発火(external writer がカメラを所有する終端状態を尊重)。**契約の
明文化**(`onDone` は終端ポーズ確定後に発火 — 消費者が `camera.position` を読める)を
docstring に固定。既存消費者(focusSelection/gizmo `flyToView`)は `onDone` 未指定ゆえ
挙動不変。自然着地は easeOutCubic が最終フレーム差を極小にするため fix 前でも通って
いた(= 中断/reduced のみで顕在化)ので、E2E は enter フライトを**待たずに中断**して
配置する経路に変更(= 現実的な操作かつバグ顕在化経路)し、fix なしで fail・fix ありで
pass する真のガードにした。

### D — マップ配置グリッドはズーム適応(粗さの解消)

`_pickPoint` は固定 `GRID = 1.0` でスナップしていた。正射影フラスタムは 2〜500 の間で
可変(ホイールズーム)なので、ズームインしても 1.0 単位のまま = 可視高さに対し極端に
粗い(frustum 2 なら視野の半分がグリッド 1 セル)。新しい純関数
`MapPreviewMath.mapGridStep(frustumSize)` が `frustumSize / 50` 以下で最大の「きれいな
数」(1/2/5 × 10^k)を返す:default frustum 50 → 1.0(回帰なし)、frustum 2 → 0.02
(細かく配置可)、frustum 500 → 10(広域は丸座標)。ズームインで粒度が上がる = 地面
グリッドの power-of-10 スケール(#27)と同じ「可視範囲から導出・丸座標に着地」規律。
`MapModeController._pickPoint` が `this.state.frustumSize` からこれを引く。数値指定配置
(ユーザーが「最終的には」と述べた)は別 ADR 候補として据え置き — 本修正は canvas 上の
粒度を直接改善する。

検証: unit **653 pass**(`mapGridStep` +5)/ `tsc` clean / `vite build` clean /
E2E **11 pass**(map テストに enter フライト中断 → 配置 → 退出後のカメラ復帰 assert を
追加 — `window.__easyExtrude.cameraState()` 読み出し, fix なしで fail 実証済)。契約・
schema・DSL 版・BFF は無改変。

## Lens notes

- 様態: Map Mode の三状態描画モデル(ADR-031 idle/drawing/pending)は不変 —
  カメラ振付はモード FSM の外側の presentation(状態が先、演出が従 §1.4)。
- 層 + 契約: `CameraFlight` の契約は加算的拡張のみ(`onDone`; 既存消費者
  focusSelection/flyToView は未指定 = 挙動不変)。

## Links
- ADR-069(Phase 4 の親・ギズモ = 同型の先行修正), ADR-068(CameraFlight 契約),
  ADR-031(マップ三状態), ADR-022(コマンドパターン), ADR-065 Phase 2(SnapFlash /
  landing lifecycle 語彙), PHILOSOPHY #11/#27/#30, 核 §1.1/§1.4
