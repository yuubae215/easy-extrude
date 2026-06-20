# ADR-053 — ロボティクス KPI メソッド: 測定器としての運動学/軌道/干渉計算と可視検証ループ

**Status**: Proposed
**Date**: 2026-06-20
**Related**: ADR-038 (URDF Link Taxonomy — jointType 予約), ADR-047 (Context Demo Layer — ゴースト/オーバーレイ系譜), ADR-049 (Requirement/Conflict — KPI/criterion/admissible/gap), ADR-050 (Context-First Project Model), ADR-051 (Requirement Intake), ADR-052 (5W1H ユビキタス言語), ADR-027 (Wasm Geometry Engine — WASM 前例), ADR-015 (BFF), ADR-017 (WebSocket / Geometry Service)
**Implementation**: なし（本 ADR は境界・表現・ビルド方針・KPI 形式化の設計確定のみ。パーサ / WASM 化 / ソルバ / 述語追加 / Ghost・Highlight ビュー / pending UX は後続フェーズ）

---

## 1. Context — 「見ただけでは検証できない KPI」を測定で埋める

ADR-046/049 が築いた要件モデルは、KPI(評価関数)とクライテリア(合格条件)で要求を
表現し、`validateContext` が欠落・矛盾・許容領域を形式的に検証する。だが KPI の**項**
(`kpi.expr` 内の `f_robot.attrs.cycleTime` のようなドット参照)を**誰が埋めるか**は
モデルの外にある。設計者が手で入れられる項(寸法・質量・コスト)もあるが、ロボットセル
設計の本質的な KPI の多くは **計算しないと値が存在しない**:

| KPI | なぜ目視で検証できないか | 測定に要る計算 |
|---|---|---|
| リーチ到達性 | TCP を教示しても IK 解(関節組合せ)は計算後にしか分からない | FK/IK、特異点マージン |
| 自己干渉 | 関節姿勢が決まって初めて link 同士の交差が判定できる | メッシュ間交差(BVH) |
| ロボット×障害物干渉(経路) | 経路全体を掃引しないと「どの姿勢で当たるか」が出ない | 経路サンプリング × 障害物 BVH |
| パフォーマンスタイム(サイクルタイム) | 配置・順序の最適は総当たりでしか詰められない | 躍度制限軌道生成 + スイープ |

ここで採用したい外部技術は次の 4 つ。いずれも **面白さではなく KPI を埋める測定器**
として位置づける(ruckig のリアルタイム性は不要、静的な経路・軌道生成とアニメーション
再生まで):

- **urdf-loader** (gkjohnson, 純 JS) — URDF パース + Three.js シーン化。
- **Orocos KDL** (C++) — FK/IK・ヤコビアン・特異点解析。
- **ruckig** (C++) — 躍度制限のオフライン時間最適軌道生成。
- **three-mesh-bvh** (gkjohnson, 純 JS) — メッシュ交差・近接の高速判定。

---

## 2. Decision — 測定器 / 形式検証の分離(境界はコンピュートされた Fact)

**ロボティクス = 測定器、KPI システム = 形式的検証**。両者の唯一の接続点は
**論理式に入力可能な形式**(`status:'measured'` の Fact、または事前ベイク済みの
述語オペランド)である。

```
[副作用層]  RoboticsService (THREE / WASM 依存)        [形式層] 純粋 KPI/検証 (THREE-free)
  URDF load (urdf-loader) ─┐
  FK/IK (KDL-WASM)         ├─→ スカラ/真偽値 ──→ computed Fact (status:'measured') ──→ validateContext
  軌道 (ruckig-WASM,offline)│   (到達余裕・最小クリアランス・                          evaluatePredicate
  干渉 (three-mesh-bvh)    ─┘    干渉数・サイクルタイム)                              (kpi.expr の項解決)
```

この境界は PHILOSOPHY #3(純粋計算と副作用の分離)の直接適用である。`src/context/*`
(214 テスト)は **一切変更しない**。既存の `numericFact()` が `kpi.expr` のドット参照
(`f_robot.attrs.cycleTime`)を数値解決する経路がそのまま測定値の受け口になる
(`RoleKpiCatalog.robot = ['singularityMargin','cycleTime']` も既存)。`RoboticsService`
は副作用コーディネータであり**純粋ロジックを持たない**(`ContextService` と同じ作法、
PHILOSOPHY #3)。測定結果から新しい doc を作る際は入力不変(PHILOSOPHY #6)。

> 非目標: ロボティクス計算が KPI の合否を直接判定することはない。測定器は**項を埋める**
> だけで、合否はあくまで `criterion(kpi(x))` の形式評価が下す。

---

## 3. Decision — ComputeBackend 抽象(dual-target WASM)

同一の WASM コアを 2 つの実行環境から呼べる**単一インターフェイス** `ComputeBackend`
を置く。呼び出し側はバックエンドを意識しない:

- **(a) ブラウザ worker** — `src/workers/geometry.worker.js` と同系。GitHub Pages 単体
  (静的ホスティング)で検証できる。**初期形はこれ**(ブラウザ環境しか持てない場合も有効)。
- **(b) BFF 計算 API** — ADR-015/017 の BFF 経由。**総当たり / Monte-Carlo はサーバが
  圧倒的有利**なので、サイクルタイムスイープ・経路探索の本命はこちら。

```
caller ──ComputeBackend.run(job)──▶ { backend: 'local' | 'server' }
                                       ├─ local  → Worker(postMessage) → WASM
                                       └─ server → fetch(BFF /compute) → worker_threads → WASM
```

切替は `backend` フラグのみで呼び出し側非依存。将来 **Tauri** へ移行しても
(GitHub Pages 構成と topology はほぼ同一)この抽象を保てば呼び出し側は不変。
ジョブは冪等な値オブジェクト(URDF + 関節値 or ターゲット + 障害物セット → 結果)とし、
重い計算はキャッシュ可能にする。

---

## 4. Decision — ライブラリ採用とビルドレーン

| 用途 | ライブラリ | 言語 | ビルドレーン |
|---|---|---|---|
| URDF パース + シーン化 | urdf-loader | 純 JS | npm そのまま(ビルド不要) |
| FK/IK・特異点 | Orocos KDL | C++ (Eigen 依存) | **Emscripten → WASM**(新 CI レーン) |
| 躍度制限軌道(offline) | ruckig | C++ | **Emscripten → WASM**(offline 一括) |
| メッシュ干渉・近接 | three-mesh-bvh | 純 JS (gkjohnson 製) | npm そのまま(`urdf-loader` と同系) |

既存の WASM 前例は **Rust → `wasm-pack`**(ADR-027 `wasm-engine`)であり、`vite-plugin-wasm`
と COOP/COEP ヘッダは既に整備済み。KDL/ruckig は **C++** なので、Rust レーンとは別に
**Emscripten レーン**を CI に追加する必要がある(本 ADR では方針を明記、実 CI 設定とビルド
スクリプトは後続フェーズ)。WASM 成果物は ComputeBackend 抽象(§3)の下でブラウザ worker /
BFF の双方から同一バイナリを共有する。

---

## 5. Decision — URDF → シーン表現(ADR-038 の予約を活用)

URDF は既存ドメインモデルへ自然対応する。ADR-038 が `SpatialLink.jointType` に予約済みの
`revolute` / `prismatic` / `continuous`(実装は `fixed` のみ)をここで活かす:

| URDF | ドメインエンティティ | 備考 |
|---|---|---|
| link | `Solid` + Origin `CoordinateFrame` + `ImportedMesh` | ADR-037 の body-frame 構造に一致 |
| joint | `SpatialLink` (`jointType: revolute\|prismatic`, `properties: {axis, limits, effort, velocity}`) | ADR-038 二層分類の kinematic 層 |
| visual/collision mesh | `ImportedMesh` | 干渉判定の入力 |

FK は既存 `SceneService._updateWorldPoses()`(ROS-TF 順運動学、+X fwd/+Y left/+Z up は
URDF と一致)を流用する。**revolute/prismatic の関節値を反映する可動ソルバは本 ADR の
スコープ外**(後続 ADR/フェーズ)。本 ADR は**表現契約のみ確定**する。将来 DSL に述語を
足す際は `VALID_PREDICATE_KINDS` への追加と `CONTEXT_DSL_VERSION` バンプを伴う。

---

## 6. Decision — 入力 → 計算 → 可視化 → 入力データの検証ループ(劣決定入力の可視検証)

本 ADR の中核 UX 原則。**ロボティクス入力は疎で劣決定的(under-determined)**である:
TCP を教示しても与えるのは tool pose だけで、妥当性を決める全状態(IK の関節解・自己干渉・
障害物干渉)は**計算後に初めて存在する**。ゆえに計算結果は単なるスカラではなく、
**派生 3D 状態**でもあり、**2 つの消費者**を持つ:

```
                                                ┌─→ computed Fact (status:'measured')
  RoboticsService ─→ 派生3D状態 ────────────────┤      → 形式的検証 (validateContext / evaluatePredicate)
                     (IK 関節姿勢 / 軌道掃引体  │
                      / 干渉接点・侵入)         └─→ 可視化オーバーレイ (ADR-047 ゴースト系譜)
                                                       → 人間の検証(疎な入力の妥当性を「見て」理解)
```

「**入力 → 計算 → 可視化 → 入力したデータの検証**」が 1 つのループであり、可視化は
presentation の飾りではなく **検証の一級要素**である。

### (a) 可視化対象(ADR-047 ゴースト系譜の踏襲)

ADR-047 の `UncertaintyGhostView` / `RegionGhostView` と同じ**読取専用オーバーレイ**
として、派生状態を提示する。命名・実装は後続だが役割を確定する:

- **`RobotPoseGhost`** — IK 関節解の姿勢。複数解 / 到達不能を明示し、到達余裕を色分け。
- 軌道**掃引体** — `ruckig` のオフライン軌道に沿った robot の掃引。
- **`CollisionHighlightView`** — 自己 / 障害物干渉の接触点・侵入を赤ハイライト。

これらは派生状態の**出力射影**(読取専用)であり、ADR-049 §5.2 の編集可能な
`RegionAuthoringWidget`(入力射影)とは系譜が異なる(ADR-047 のゴースト系譜)。

### (b) 遅延 UX(検証可能になるまでが長い問題)

計算(特にサーバ総当たり)は遅延しうるので、**「入力から検証可能になるまでが長い」こと
自体を UX 設計対象**とする。pending/computing 状態を提示し、確定後に関節姿勢・干渉
ハイライトを reveal する。`isProcessing`(PHILOSOPHY #7・`docs/CONCURRENCY.md`)の
pessimistic / optimistic 区別を本計算へ適用する:

| 計算 | 戦略 | UX |
|---|---|---|
| 軽量 FK プレビュー | optimistic | 即時反映・ブロックなし |
| IK / 軌道生成 / 総当たり | pessimistic | `isProcessing=true` + スピナー + 入力無効化 |

### (c) 二重出力の対応と再接続(可視検証 → boolean KPI 項)

同一計算が形式検証用 Fact と人間検証用可視化を**同時に**生む(派生状態という単一の真実から
両者を射影する。PHILOSOPHY #3 の純粋/副作用境界は侵さない)。ただし両者は**完全には
分離しない**: **可視化が可能にした入力バリデーション結果**(「この計算後の IK/干渉を
踏まえ、入力は妥当か」)は、**他の入力条件を含む論理値(boolean)の KPI 項**として
形式論理式へ**再投入**できる。

```
例)  inputValid = reach_ok ∧ self_collision_free ∧ within_workspace      criterion: == true
```

すなわち可視検証の帰結を `criterion == true` の boolean KPI 項に符号化することで、
形式検証器と人間検証が**同一論理式上で合流**する。複数 Fact/述語の論理結合は不透明な
関数結合なので `promoteAdmissible` の対象外(stated のまま、§7)。

---

## 7. KPI Feasibility Study — 論理式の項を埋める設計(論理のみ・コードなし)

各 KPI を **(形式)どの Fact/述語で論理式に入るか** と **(人間)どの可視化が検証ループを
閉じるか** の対で形式化する。blocked セマンティクス・`promoteAdmissible` 関係も併記。

### 7.1 リーチ到達性

- **形式**: KPI 項 `reachMargin = f_robot.attrs.reachMargin`(IK 成功 + 特異点余裕[deg])、
  criterion `>= θ`。述語案 `robot_reach`(pass/fail + 未到達ターゲットを violations に列挙)。
  ターゲット未知時は `status:'blocked'`(到達余裕は未知寸法に対して評価不能、PHILOSOPHY #11)。
  Fact 参照なので数値解決され `promoteAdmissible` 昇格可(単調性が立てば admissible 反転可)。
  FK サンプリングで到達点群を作りターゲット内包を判定する総当たり = **サーバ向き**。
- **可視化**: IK 関節解の姿勢(複数解 / 到達不能を明示)、到達余裕の色分け。疎な TCP 入力の
  妥当性を即視できる。

### 7.2 自己干渉

- **形式**: KPI 項 `selfCollisionCount` / `selfClearanceMin = f_robot.attrs.*`、
  criterion `== 0` / `>= c`。three-mesh-bvh の link 間メッシュ交差。述語案
  `collision_free(scope:'self')`。
- **可視化**: 干渉 link ペアの接触点・侵入ハイライト。

### 7.3 ロボット × 障害物干渉(経路)

- **形式**: 既存 `swept_volume` 述語の上位化、または `collision_free(scope:'env', path)`。
  経路サンプリング × 障害物 BVH。総当たり経路探索 = **サーバ向き**。
- **可視化**: 軌道掃引体 + 干渉区間ハイライト(どの姿勢で当たるかを reveal)。

### 7.4 パフォーマンスタイム(サイクルタイム)

- **形式**: KPI 項 `cycleTime = f_robot.attrs.cycleTime`(ruckig offline で躍度制限軌道の
  総時間)、criterion `<= T`。`RoleKpiCatalog.robot` の既存項に合致。配置 / 順序スイープの
  総当たり = **サーバ優位**。
- **可視化**: 軌道アニメーション再生(ruckig のリアルタイム性は不要、offline 生成 → 再生のみ)。

### 7.5 boolean 合成項

§6(c) の `inputValid` のような boolean 合成項は、複数の Fact/述語の論理結合
(`∧` / `∨` / `¬`)として `kpi.expr` に入り criterion `== true` を取る。論理結合は
不透明な関数結合なので **`promoteAdmissible` 非対象**(stated のまま、R9 が支配)。

| KPI | 形式(Fact/述語) | criterion | blocked 条件 | promote |
|---|---|---|---|---|
| リーチ到達性 | `reachMargin` / `robot_reach` | `>= θ` | ターゲット未知 | 可(単調なら反転) |
| 自己干渉 | `selfCollisionCount` / `collision_free(self)` | `== 0` / `>= c` | 関節姿勢未確定 | 述語は不可 |
| 障害物干渉(経路) | `swept_volume` / `collision_free(env)` | pass | 経路 / 障害物未確定 | 述語は不可 |
| サイクルタイム | `cycleTime` | `<= T` | 配置 / 軌道未確定 | Fact 参照なら可 |
| boolean 合成 | `inputValid = a ∧ b ∧ …` | `== true` | 構成項のいずれか blocked | 不可(不透明結合) |

---

## 8. Consequences / 非目標

**本 ADR が確定するもの**: 測定器 / 形式検証の境界、ComputeBackend 抽象(dual-target WASM)、
ライブラリ採用とビルドレーン方針、URDF → シーン表現契約、入力 → 計算 → 可視化 → 検証
ループの設計原則、4 KPI + boolean 合成項の形式化。

**非目標(後続フェーズ)**: URDF パーサ実装、KDL/ruckig の Emscripten → WASM 化、
revolute/prismatic 可動ソルバ、述語(`robot_reach` / `collision_free`)の DSL 追加
(`VALID_PREDICATE_KINDS` + `CONTEXT_DSL_VERSION` バンプ)、`RobotPoseGhost` /
`CollisionHighlightView` の実装、pending/computing UX、BFF `/compute` エンドポイント。

`src/context/*`(純粋 KPI/述語層、214 テスト)は本 ADR では**一切変更しない**。
コード非改変につき回帰なし。

---

## 9. References

- 内部: ADR-038(jointType 予約), ADR-047(ゴースト/オーバーレイ系譜), ADR-049
  (KPI/criterion/admissible/gap), ADR-050(Context-First 本番化), ADR-051(要件入力),
  ADR-052(5W1H), ADR-027(Wasm Geometry Engine), ADR-015(BFF), ADR-017(WebSocket /
  Geometry Service), `docs/CONCURRENCY.md`, PHILOSOPHY #3/#6/#7/#11。
- コード参照(本文の引用元、変更しない): `src/context/PredicateEngine.js`,
  `ContextValidator.js`, `AdmissiblePromotion.js`, `RoleKpiCatalog.js`,
  `RequirementGraph.js`; `src/service/SceneService.js`(`_updateWorldPoses` / `importFromJson`);
  `src/domain/{Solid,CoordinateFrame,ImportedMesh,SpatialLink}.js`;
  `src/workers/geometry.worker.js`; `vite.config.js`; `examples/cell_region_context.json`。
- 外部: gkjohnson/urdf-loaders, orocos/orocos_kinematics_dynamics (KDL),
  pantor/ruckig, gkjohnson/three-mesh-bvh。
