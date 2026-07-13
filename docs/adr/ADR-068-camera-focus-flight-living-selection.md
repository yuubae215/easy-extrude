# 068. カメラ・フォーカスフライト + 生きた選択 — ナビゲーションの Tier D と実体の Tier A/F

- Status: Accepted
- Date: 2026-07-13
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし(ADR-067 の BootReveal 系譜を再利用; ADR-065/066 の統治を無改変で継承)

## Context — Goal と力学(§1.2 Goal)

ユーザ指示(2026-07-13): 「ADR-067 に留まらず、リポジトリ横断で UX 向上のアイデアを
募集。堅いルールに縛られず全振りしてよい」。ギャップ分析(既存演出の棚卸し)で、
ADR-065–067 が深く磨いた面(起動・実体化/消滅・スナップ・ゴースト・セレブレーション・
クローム)の**隙間**に残る具体的な穴を特定した:

**Goal**: *ナビゲーションと選択という最も高頻度のモデリング操作が、飛ぶのではなく
旅をし、触れたものが応える — 画面がユーザの操作に生きて反応すること。* ただし
ADR-065/066 の統治(単一 reduced-motion 境界・transient 単一所有者 `MotionGovernor`・
judgment 偽装禁止・予算)を 1 mm も逸脱しないこと。ユーザ選択は「フレームワーク内に
留まる」。

特定した 3 つの穴:
1. **カメラは旅でなくジャンプ**: `fitCameraToSphere` は即時カット。選択物へ寄る
   "focus/frame selected"(F/Home キー・ダブルクリック)が**存在しない** — Blender/
   Shapr ユーザの反射操作。
2. **選択が無反応**: コマンドは voxel バーストを得るのに、エンティティ選択は
   `setObjectSelected` の emissive 即時フリップのみ。3D 実体にホバー afford なし
   (クロームにはある)。
3. **DOM の端が未研磨**: トーストはフェードインするがポップアウト、Grasp バーは
   データが豊富なのに静止、Outliner 行は瞬時切替でキャンバス選択に追従しない。

力学(保つべき不変条件):
- カメラフライトは非命題的な Tier D delight(ADR-066)— 機能的ジャンプに対する
  中断可能な演出。ホバー/選択パルスは Tier A/F(実体が「操作できる/選ばれた」)。
- フレーミング導出は**一つ**(核 §1.1): 「シーンを枠取る」と「選択を枠取る」で
  同じ距離計算を共有しつつ、後者はグリッドスケールを触らない(PHILOSOPHY #27 の
  `_updateGridScale` は scene framing 専属)。
- ユーザが常に勝つ: フライト中の任意の pointerdown/wheel は即着地(BootReveal と
  同一契約)。外部カメラ書き込み(fitCameraToSphere)にはフライトが譲る。

## Options considered

- **A: BootReveal 系譜を一般化した `CameraFlight` transient + `SelectPulse`/hover を
  統治内で実装(採用)** — 純粋 `CameraMath.focusPose` を単一導出源とし、位置と
  target の両方を eased 補間。tradeoff: transient を 1 種増やす(予算内)。
- **B: `OrbitControls` の `enableDamping` を有効化して慣性で寄せる** — tradeoff:
  減衰は毎フレーム `controls.update()` を要し、BootReveal と SnapFlash が依存する
  「ループで update() を呼ばない」前提(直接カメラ書き込みが安全)を破壊し blast
  radius が過大。中断契約も自前で作れない。
- **C: TWEEN.js 等のライブラリ導入** — tradeoff: 依存 0 の予算方針(ADR-065)違反。
  既存 `MotionMath` イージング + RippleEffect 系譜で十分。
- **D: 現状維持(即時ジャンプのまま)** — tradeoff: 最も高頻度の穴が残る。

## Decision — Strategy(§1.2 Strategy)

**A を採用。** 3 面を一つの ADR にまとめる(すべて「操作への即応」という同一 Goal)。

**§1 カメラ・フォーカスフライト(Tier D)**
- 純粋層 `src/view/CameraMath.js`(`focusPose`/`lerpVec`、THREE-free・テスト付)を
  新設。`focusPose` は旧 `fitCameraToSphere` の距離計算(halfFov→dist、軌道方向維持)
  を THREE-free 化した**唯一の導出源**。`SceneView.focusPose()` がこれを THREE に
  適用し、`fitCameraToSphere`(scene framing = グリッドスケール込み)と `CameraFlight`
  (selection framing = グリッド不変)の両方が同じ pose を消費する。
- `src/view/CameraFlight.js`: BootReveal と同契約の transient(`tick(t)→done`/
  `dispose()`、`MotionGovernor.spawn` 経由のみ)。位置**と** target を捕捉した開始
  pose から end pose へ `easeOutCubic` 補間。reduced = end pose に即着地。中断は
  `_cameraStolen()` 外部書き込みガード + pointerdown/wheel の `_finishCameraFlight()`。
  着地時のみ `controls.update()` を 1 回呼び、次のオービットが新 target を軸に回る。
- `AppController`: `focusSelection()`(選択の sphere、無選択は全シーン)+ `_focusSphere()`。
  F/Home キー・エンティティ ダブルクリックで起動。`DURATION.cameraFocus` 追加。

**§2 生きた選択(Tier A/F)**
- `src/view/SelectPulse.js`: 選択された Solid の OBB を象る一瞬のアウトライン
  (MeshView と同じ `buildGeometry`+`EdgesGeometry` 経路 = 回転一致)がポップして
  フェード。RippleEffect 系譜・overlay 専用(実体 emissive 不可侵 #4)。**選択への
  遷移時のみ**発火(`_lastSelectFxId` ガード、再選択チャーンでは無発火 = #30 音量規律)。
- `MeshView._syncEmissive` に第 3 の合成フラグ `_hovered` を追加(`setHovered()` が
  唯一の書き手 #4; 優先度 violation > selected > hover)。`AppController` が
  object モードの pointermove ヒットテストから設定、fine ポインタ限定(touch は
  hover を通さない #13)。

**§3 研磨掃引(Tier A / 純プレゼン)**
- `ChromeMath.exitMotion` + `eaChromeExit` キーフレーム追加 → `UIShell` トーストが
  退場フェード(mount-during-exit パターン; reduced は即消滅)。
- `GraspSearchPanel` の funnel/objective/near-miss バーに `transition: width`
  (reduced で無効)。契約 diagnostics は verbatim のまま(#29 — ワイヤ不変)。
- `Outliner` 行の背景/opacity/アイコン opacity にトランジション + アクティブ行の
  `scrollIntoView`(キャンバス選択に追従)。すべて単一境界の reduced を尊重。

## Consequences — Evidence と tradeoff(§1.2 Evidence)

- 肯定的: 最高頻度の 2 操作(ナビ・選択)が即応的になり、F/ダブルクリックの
  Blender パリティを獲得。フレーミング導出が一本化され scene/selection framing が
  ドリフト不能に。研磨掃引で DOM の端が滑らかに。
- 受け入れるコスト: transient を 2 種(CameraFlight/SelectPulse)追加。pointermove の
  object モードで hover ヒットテストを 1 回(既存の cursor 用ヒットテストを再利用し
  増分ゼロ)。
- 検証(証拠):
  - unit **635→640 pass**(CameraMath 5 本新規: focusPose 距離/方向/中心オフセット/
    ゼロ半径/lerp 端点恒等 — フライトが end pose に厳密着地する不変条件を machine-pin)
    / typecheck clean。
  - E2E smoke **8 pass**(新規「F frames the selection via the camera flight without a
    page error」= key→focusSelection→CameraFlight 配線の liveness ガード; checkJs は
    controller 層を除外するため — Yellow Card 規則)。
  - `pnpm build` clean(gz delta 予算内、依存追加 0)。
  - 実機目視(dev): F/ダブルクリックで滑らかに寄って枠に着地・フライト中オービットで
    クリーン中断・hover でエッジが温まる(デスクトップのみ)・選択でアウトライン
    パルス・トースト退場フェード・Grasp バー滑走・Outliner がキャンバス選択に追従。
    reduced-motion ON で全キューが静的キューに degrade(消滅せず)・pageerror 0。
- 波及(blast radius): `SceneView.fitCameraToSphere`(内部リファクタ、外部契約不変)/
  `MeshView._syncEmissive`(1 フラグ追加、既存 2 状態の見え不変)/ AppController の
  pointer/key/animate 配線 / 3 DOM コンポーネントのプレゼン。契約・schema・DSL 版・
  BFF・wire は無改変(#29)。

## Lens notes

- **黒箱 / 契約**: `focusPose` を単一導出源にすることで、`fitCameraToSphere`(scene)と
  `CameraFlight`(selection)は同じ入力→出力に従い、片方の変更が他方に自動追従する
  (核 §1.1)。グリッドスケールだけを scene framing 側に残すことで「シーンを枠取る/
  選択を枠取る」を別 API として明示的に分離(既存 CODE_CONTRACTS「Ground Grid Scales
  With Scene Radius」の "any framing entry must route through fitCameraToSphere" が
  selection framing に誤適用されないよう ADR + CODE_CONTRACTS で線引き)。
- **状態機械 / 所有権**: CameraFlight は BootReveal と同じ RippleEffect 系譜の
  transient で `MotionGovernor` が唯一の所有者。ユーザ勝利の中断契約(finish/
  external-write ガード)を BootReveal から複写し、位置のみ→位置+target に一般化。
- **音量規律(#30 corollary)**: SelectPulse は選択遷移時のみ発火(再選択で無音)。
  hover は Tier A affordance(判定を偽装しない色でなく emissive 弱化)。両者とも
  reduced で静的キューに degrade。
