# 069. UX パリティ・パス Phase 1 — 3D が磨いた基準を周辺面へ

- Status: Accepted (Phase 1 実装済; Phase 2 = ADR-070・Phase 3 = ADR-071 として 2026-07-15 Accepted・実装済; Phase 4 = 2D マップ研磨のみ未着手)
- Date: 2026-07-14
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし(ADR-068 の CameraFlight・ADR-048 の Link Network・
  ADR-030/038 の SpatialLink・ADR-037 の命名を再利用/拡張; ADR-065/066 の Motion 統治を無改変継承)

## Context — Goal と力学(§1.2 Goal)

ユーザ指示(2026-07-14): 「ここまでの UI/UX を評価。いきなり実装せず、一段上げて
ゴールを観測してから計画を」。10 点の観察を横断調査した結果、これらは 10 個の無関係な
バグではなく **一つの根本原因の症状**と判明した: **ADR-065/067/068 の 3D 層が周囲の面より
一段先に進み、取り残された面が一段低く読める/振る舞う。**

**Goal**: *3D が最近確立した品質基準(イージング・中断可能・reduced-motion 対応・
トークン化・#30 Motion Tier)を、その周辺の面 — カメラ・ナビゲーション、関係グラフ、
エンティティ同一性、配置既定 — へ波及させる。*

本 ADR は Phase 1(ナビゲーション & 凡例性 + 命名バグ)を記録する。Phase 2–4
(エンティティ同一性・物理既定・2D マップ研磨)は計画済(`/root/.claude/plans/…`)で
未着手 — ユーザ確認待ち。

決定した非自明な設計判断は 2 つ:

## 決定 1 — ワールドギズモは CameraFlight の第三の消費者(自前ポーズ導出・グリッド不変)

**問題**: `GizmoView._onClick` は軸クリック時にカメラを **1 フレームで直書き**(`position.copy`
+ `up.set` + `lookAt`)していた。ADR-068 が全カメラ移動に与えた基準(620ms `easeOutCubic`・
`MotionGovernor` 経由・中断可能・reduced-motion 対応)を**唯一逸脱する面**であり、ユーザの
「急に視点が飛ぶ/どこに飛んだか分からない」の直接原因。

**判断**:
- `GizmoView._onClick` は宛先ポーズ `{position, target, up}` を**導出するだけ**にし、
  `onRequestView` コールバックへ渡す。AppController が `flyToView` をそこへ配線。
- `flyToView` は離散的な向き変更(`camera.up` + OrbitControls の極軸 `_quat` 同期 —
  これは *motion* ではないので reduced-motion でも適用)を先に行い、位置/target のみを
  `MotionGovernor.spawn(reduced => new CameraFlight(...))` でイージング。ADR-068 の
  `focusSelection` と同型・同契約(BootReveal 系譜 / `_finishCameraFlight` で中断)。
- **フレーミング導出は一つ、だが軸ビューは `focusPose` を使わない**: ADR-068 の
  「Framing Has ONE Derivation」は *scene/selection framing* が `CameraMath.focusPose`
  (現軌道方向を保持)を共有する規則。ギズモの軸ビューは**軌道方向を変える**のが目的
  なので `focusPose` は不適 — ギズモは自前の軸ジオメトリでポーズを導出し、`CameraFlight`
  は位置/target のイージングだけを担う。ギズモは第三の framing 入口だが `fitCameraToSphere`
  を経由せず、**グリッドを再スケールしない**(selection flight と同じく scene framing 専属の
  `_updateGridScale` は触らない — PHILOSOPHY #27)。
- 配線が外れても**沈黙の no-op にしない**(#11): コールバック未設定時は
  `GizmoView._applyInstant`(旧・即時直書きロジックを一箇所に集約)へ graceful fallback。

## 決定 2 — Link Network の凡例性は「動き」でなく「状態」で担う

**問題**: `LinkNetworkView` は全 SpatialLink エッジを**同時にマーチングアント animation**
していた。220px の箱の中で全方向へ動く点線 = ユーザの「線があちこちに飛んで見づらい」の
literal な原因。加えて直線の交差が多く、方向/重要度の区別が 7px の矢印のみ。

**判断(PHILOSOPHY #30 / #26 準拠)**:
- **常時アニメーションを全廃**。全エッジが一斉に動く動きは per-firing の情報を持たない =
  #30 の一文テスト(「止まったら何が分からなくなる?」)に「何も」= ノイズ。凡例性は
  *状態*で担う。
- **Focus+context**: ノードをホバー/選択すると、その隣接エッジが前面化し残りが後退する。
  「このエンティティに何が繋がっているか」が一目で読める(Tier A affordance)。ホバーは
  パネル内 presentation 状態(`_hoveredId`)— 3D 選択を変異させない。
- **交差の緩和**: 交差レイヤ間エッジを進行方向の右へ緩く湾曲。A→B と B→A が重ならず分離。
- **重み付け**: 運動学リンク(`jointType ≠ null`)は太く実線、位相リンク(annotation)は
  細く点線 — 実制約と概念的関係を静的に区別。
- **密モードでも焦点ノードとその隣接ラベルは残す** — パネルを**広げずに**(左端占有契約
  #26 / 測定済み寸法を維持)局所近傍を読めるようにする。パネル拡大/リサイズは Phase 後送り。

## 付随する修正(バグ級・ADR 本体でなく CODE_CONTRACTS 管轄)

- **位相リンクの切断アフォーダンス**(#4): `adjacent` 等 `jointType === null` のリンクは
  Unfasten 経路を持たないが `detachSpatialLink` は普遍的に外せる。唯一の導線が N パネル
  埋没だったため「切れない」と誤認された = **凡例性ギャップ**(ハードブロックではない)。
  長押しメニューに位相リンク 1 本ごとの「Disconnect」項目を追加(N パネルと同じ
  undoable な `createDeleteSpatialLinkCommand` 経路)。
- **Frame 自動命名の統一**(#9): モバイル長押しの `promptAddFrame` は literal `'Frame'` を
  override 渡ししており、ビューポート/N パネル経路が使う `_nextEntityName('Frame')` の
  衝突連番を回避 → 重複 `'Frame'` を量産していた。全経路が同じ命名源(新規 public
  `SceneService.nextEntityName`)から既定を導出するよう統一。

## Consequences

- ギズモがアプリの他全カメラ面と同じ統治下に入る。「飛ぶ」感覚が消える。
- Link Network が「常時動く web」から「静かで、触れると応える」図へ。#30 の実適用が
  DOM 2D 面にも及ぶ。
- 契約・schema・DSL 版・BFF は無改変(この Phase は純クライアント体感層)。
- Evidence: unit 640 pass / typecheck clean / build clean / E2E **9 pass**(新規:
  ギズモ軸クリック → flyToView 配線 liveness)。

## Links
- ADR-068(CameraFlight・framing 一導出), ADR-048(Link Network layered layout),
  ADR-030/038(SpatialLink taxonomy), ADR-037(auto origin frame 命名)
- PHILOSOPHY #30(Motion Tier), #26(端は共有資源), #11(沈黙の失敗禁止), #4(視覚状態の単一所有者)
