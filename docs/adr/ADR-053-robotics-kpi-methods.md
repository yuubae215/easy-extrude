# ADR-053 — ロボティクス KPI メソッド: 測定器としての運動学/軌道/干渉計算と可視検証ループ

**Status**: Accepted (Phase 1+2+3 実装済 — 述語層 ＋ 測定器の純粋計算コア / ComputeBackend / RoboticsService ＋ C++→WASM ビルドレーン環境導入)
**Date**: 2026-06-20
**Related**: ADR-038 (URDF Link Taxonomy — jointType 予約), ADR-047 (Context Demo Layer — ゴースト/オーバーレイ系譜), ADR-049 (Requirement/Conflict — KPI/criterion/admissible/gap), ADR-050 (Context-First Project Model), ADR-051 (Requirement Intake), ADR-052 (5W1H ユビキタス言語), ADR-027 (Wasm Geometry Engine — WASM 前例), ADR-015 (BFF), ADR-017 (WebSocket / Geometry Service)
**Implementation**: **Phase 1 実装済** = 純粋述語層 `robot_reach` / `collision_free`（§9、`PredicateEngine` + `VALID_PREDICATE_KINDS` 追加 + `CONTEXT_DSL_VERSION` バンプ `context/0.3`→`context/0.4`）。**Phase 2 実装済** = 測定器の**純粋計算コア**（FK サンプリング到達性 ＋ AABB 干渉ベイク）＋ `ComputeBackend` シーム（`LocalComputeBackend`）＋ `RoboticsService`（測定値→doc ベイクの受け口、THREE-free・注入バックエンド）（§10、`src/robotics/*` + `src/service/RoboticsService.js`）。**Phase 3 実装済 = §4 の C++→Emscripten→WASM ビルドレーン環境導入**（§11、`robotics-wasm/`：KDL `v1.5.1` + ruckig `v0.9.2` + Eigen `3.4.0` を pinned submodule で vendor、`emcmake` ビルドで embind WASM モジュールを生成、成果物 `src/engine/robotics-wasm/` を git コミット、`scripts/setup-toolchain.sh` で再現可能化）。残（後続フェーズ）: WASM カーネルを `ComputeBackend` 裏に配線 / IK・特異点 Jacobian / 可動ソルバ / urdf-loader・three-mesh-bvh 実幾何 / `ServerComputeBackend`（BFF `/compute`）/ Ghost・Highlight ビュー / pending UX。

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

### 1.1 概念的補強 — ドメイン合流の代数構造(圏の不一致とユビキタス言語の縮退作用)

なぜ「測定器」と「形式検証」を分けると設計が綺麗になるのか。その根を、群論・圏論の
**メタファー**で導入し、続けて数理的に厳密化しておく(後者は誤読を防ぐための注記であり、
本 ADR は未証明の「群」構造を主張しない)。

**直感レイヤー(導入)** — ユーザーが見る世界とシステムが見る世界は、対象も射も異なる
**別の圏**である:

- **ユーザーの圏 𝒰**(タスク / ビジネス要求) — 対象は製品・作業ターゲット・要求
  サイクルタイム。KPI は「このラインは目標スループットを満たすか」。
- **システムの圏 𝒮**(構成空間 / 計算幾何) — 対象は URDF link・関節角ベクトル q・
  BVH ボックス・躍度限界式。KPI は IK 残差・`selfClearanceMin`[mm]・`cycleTime` の生データ。

TCP 教示は 𝒰 → 𝒮 への**疎で劣決定的(under-determined)**な写像で、隠れた自由度
(関節解・干渉)は計算後に初めて確定する。ゆえに両者の KPI は一致しない。ここで
**ユビキタス言語の KPI**(述語 `robot_reach` / `collision_free`、boolean 合成 `inputValid`)が、
システム側の「泥臭い物理的複雑さ」とユーザー側の「厳密さを欠く要求」のギャップを**相殺**し、
矛盾なき結合状態(= 単位元・合流)へ**縮退**させる。「群の逆元による相殺」のイメージで
捉えると、`selfClearanceMin = 2.3mm`(具体状態)に criterion `>= c` を掛けると
`self_collision_free == true` という純粋な論理値へ畳まれる、という直感が得られる。

**厳密レイヤー(数理注記)** — ただしこれは数学的には両側逆元を持つ「群」ではない。
正確には次の 2 つの既存構造である:

1. **同義語商上のセクション σ(片側逆元)** — ADR-052 は正準 doc を**同義語商**として捉え、
   φ(NL → doc)を準同型、φ⁻¹ を「代表を 1 つ選ぶ」**セクション(右逆)**と定義した。
   ユビキタス言語の KPI 名は、システム側の生データとユーザー側の要求語の双方を**同一の商**へ
   着地させる σ である(両側逆元ではない)。
2. **criterion による前像 / 引き戻し(pullback)** — ADR-049 の許容領域は前像
   `{ x | criterion(kpi(x)) }`(`AdmissiblePromotion.invertCriterion`)。criterion は性質を
   KPI 写像に沿って**引き戻す**。`evaluatePredicate` の `Boolean == true` 判定は、その
   **許容可能集合の定義関数(特性関数)を計算点で評価したもの**として形式化できる。

つまり ADR-052(関心の分離・商空間・φ/φ⁻¹)→ ADR-049(invertCriterion の pullback)→
本 ADR-053(劣決定入力の可視検証ループ)は、**1 つのレンズ**——「正準 / ユビキタス層が
商空間のセクション σ と criterion 前像によって 2 つのドメインを合流させる」——に統合される。
この縮退作用が**最も鮮明**なのが**リーチ到達性**(§7.1): TCP 教示 → 多数の IK 解という
最大の劣決定(ファイバー構造)を、σ で代表化し criterion で許容領域へ引き戻し、
特性関数 boolean へ畳む。

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

### 7.1 リーチ到達性(代数レンズの主役)

本 KPI は §1.1 の縮退作用が**最も鮮明**な題材であり、ここを最も手厚く展開する。他 3 KPI
(§7.2–7.4)は同型の縮退として簡潔に従う。

- **形式**: KPI 項 `reachMargin = f_robot.attrs.reachMargin`(IK 成功 + 特異点余裕[deg])、
  criterion `>= θ`。述語案 `robot_reach`(pass/fail + 未到達ターゲットを violations に列挙)。
  ターゲット未知時は `status:'blocked'`(到達余裕は未知寸法に対して評価不能、PHILOSOPHY #11)。
  Fact 参照なので数値解決され `promoteAdmissible` 昇格可(単調性が立てば admissible 反転可)。
  FK サンプリングで到達点群を作りターゲット内包を判定する総当たり = **サーバ向き**。
- **代数レンズ(§1.1 の具体化)**: TCP 教示は劣決定で、1 つの tool pose に対し IK 解は
  **ファイバー**(多数の関節解 q)を成す。ユビキタス言語 `robot_reach` はこのファイバーを
  **セクション σ** で代表化(到達可能な代表解を 1 つ選ぶ片側逆元)し、criterion `>= θ` で
  許容領域へ**引き戻す(pullback)** `{ TCP | reachMargin(IK(TCP)) >= θ }`。
  `robot_reach == true` はこの許容可能集合の**特性関数を計算点で評価**したもの——
  劣決定の複雑さが純粋な論理値へ**縮退**する。
- **可視化**: IK 関節解の姿勢(複数解 / 到達不能を明示)、到達余裕の色分け。疎な TCP 入力の
  妥当性を即視できる(= ファイバーの可視化と、劣決定の可視的解消)。

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

## 9. Phase 1 実装 — `robot_reach` / `collision_free` 述語（純粋層のみ）

§7 で「述語案」止まりだった `robot_reach` / `collision_free` を**具体オブジェクト形状**として確定し、
純粋述語エンジン（`src/context/PredicateEngine.js`）へ実装する。これは §8 が非目標に挙げた
「述語の DSL 追加（`VALID_PREDICATE_KINDS` + `CONTEXT_DSL_VERSION` バンプ）」の最初の実体化であり、
**測定器（RoboticsService / WASM）には一切触れない**。§2 の境界どおり、述語は**事前ベイク済みの
スカラ/真偽値オペランド**を受け取り、`{ pass, violations }` を返す**形式評価**に徹する
（IK・BVH の重い幾何は将来フェーズの測定器が担い、本述語は「畳まれた論理値」を計算するだけ）。

### 9.1 設計上の位置づけ — §1.1 の縮退作用の実体化

`robot_reach` の入力 `targets[].reachable`/`margin` は、TCP 教示（劣決定）に対して測定器が IK
ファイバーを**セクション σ で代表化**して得た値である。述語はそれを criterion 相当の閾値
（`marginMin`）で**引き戻し**、`pass:boolean`（許容可能集合の**特性関数**を計算点で評価したもの）へ
**縮退**させる。`collision_free` も同様に、ベイク済み接触ペアのクリアランスを閾値で畳む。
両者とも純粋・入力不変・THREE-free で、`src/context/*` 全体が bare `node --test` で読み込める制約を保つ。

### 9.2 述語オブジェクト形状（確定）

```jsonc
// robot_reach — 全ターゲットが到達可能で、かつ（任意の）特異点/到達余裕が閾値以上か
{
  "kind": "robot_reach",
  "targets": [
    { "ref": "pick",  "reachable": true,  "margin": 12.5 },  // margin[deg] は任意
    { "ref": "place", "reachable": false }
  ],
  "marginMin": 5          // 任意。指定時、reachable でも margin<marginMin は low_margin 違反
}
// violations: { kind:'unreachable', target } / { kind:'low_margin', target, margin, required }

// collision_free — ベイク済み接触ペアが必要クリアランスを下回らないか（scope は self|env）
{
  "kind": "collision_free",
  "scope": "self",        // 'self'(自己干渉) | 'env'(障害物干渉)
  "clearance": 0,         // 任意。必要最小クリアランス（既定 0 = 接触/侵入のみ違反）
  "contacts": [
    { "a": "link3", "b": "link5", "clearance": -1.2 },  // 負 = 侵入
    { "a": "link2", "b": "table", "clearance": 8.0 }
  ]
}
// violations: { kind:'contact', a, b, clearance, required }
```

- **blocked セマンティクス**は既存のまま（§6(b)・ADR-049 R5）: `acceptance.requires` が
  assumed/unknown の Fact を指す間、検査は `status:'blocked'` で**述語を走らせない**
  （到達余裕や接触を未確定寸法に対して評価できない — PHILOSOPHY #11）。
- **空配列**: `robot_reach` の `targets` が空、`collision_free` の `contacts` 構造が不正 →
  `MalformedPredicate`（構造不正のみ throw、`pass:false` では決して throw しない）。
  `contacts: []`（接触なし）は**正当な pass**。
- これらは boolean 述語なので `promoteAdmissible` 非対象（§7.5、不透明結合、stated のまま R9 が支配）。

### 9.3 バージョニング

新述語 2 種は additive。`VALID_PREDICATE_KINDS` に `'robot_reach'`/`'collision_free'` を追加し、
`PredicateEngine.PREDICATE_KINDS`・`evaluatePredicate` の switch を同期。`CONTEXT_DSL_VERSION` を
`context/0.3` → `context/0.4` にバンプ（`SUPPORTED_VERSIONS` に 0.4 を追加、0.1–0.3 は後方互換で維持）。
バリデータ側のコードは無改変（`VALID_PREDICATE_KINDS` のリスト参照だけで新 kind を受理し、
ディスパッチは `evaluatePredicate` に委譲済み）。

### 9.4 非目標（本フェーズも据え置き）

測定器（`RoboticsService` / `ComputeBackend` / WASM / urdf-loader / three-mesh-bvh）、
`targets[].reachable`/`contacts[].clearance` を**実際に生成**する FK/IK/BVH 計算、Ghost/Highlight
ビュー、pending UX、BFF `/compute` は本フェーズでも実装しない。本フェーズは「測定値が来たら
論理式に入れられる形」を純粋層で先に用意することに尽きる（§2 の受け口を完成させる）。

---

## 10. Phase 2 実装 — 測定器の純粋計算コア ＋ ComputeBackend ＋ RoboticsService

§9 の純粋述語層が消費する**事前ベイク済みオペランド**（`targets[].reachable`/`margin`・
`contacts[].clearance`）を、**実際に生成する測定器**の最初の実体を実装する。§2 の境界の
副作用側を、**WASM/IK を導入せず**に純粋計算で立ち上げる。

### 10.1 設計との乖離と、その埋め方（§4 の KDL/ruckig-WASM → 純-JS 初期形）

§4 は FK/IK を **KDL（C++）→ Emscripten→WASM**、軌道を ruckig-WASM、干渉を three-mesh-bvh
と定めた。本フェーズは**それらを実装しない**。理由と整合の取り方:

- **環境制約**: 当リポジトリの WASM レーンは Rust→`wasm-pack`（ADR-027）のみで、KDL/ruckig の
  Emscripten レーンは未整備（`wasm-pack` 自体も当 CI 環境では不在）。§4 のレーン追加は後続。
- **§3 の明示的許容**: ComputeBackend の「**初期形はブラウザ worker / 純-JS**（ブラウザ環境
  しか持てない場合も有効）」をそのまま採る。本フェーズの `LocalComputeBackend` は純-JS 同期
  カーネルを `async run(job)` 契約で包み、将来の Worker/WASM・BFF バックエンドと**差し替え互換**。
- **§7.1 が名指しした手法**: 到達性は **FK サンプリングで到達点群を作りターゲット内包を判定する
  総当たり**（§7.1）で計算する。IK ソルバ（KDL）は使わない。`margin` は**長さ単位の到達余裕**
  （外側ワークスペース境界への余裕）であり、§7.1 の**特異点マージン[deg]ではない**（特異点は
  Jacobian を要し KDL-WASM 後続）。干渉は **AABB クリアランス**（`RegionGeometry.aabbClearance`）で
  近似し、three-mesh-bvh の厳密メッシュ距離は後続。

つまり乖離は「測定の**精度モデル**を初期形に落としただけ」で、**シーム（ComputeBackend.run(job)）と
オペランド形状（§9.2）は不変**。KDL/ruckig-WASM・BVH はこのシームの裏で後から差し込み、
`RoboticsService` 呼び出し側は不変。この整合をもって §4 の方針を破棄せず「初期形 → 本実装」の
段階化として扱う。

### 10.2 純粋計算コア（`src/robotics/*`、THREE-free・bare `node --test`）

- **`Kinematics.js`** — 自前の最小 SE(3) クォータニオン/ベクトル演算（`THREE` 非依存、
  `RegionGeometry` と同方針）。`forwardKinematics(chain, q)`（ROS +X/+Y/+Z・URDF RPY=Rz·Ry·Rx）、
  `sampleConfigs`（可動関節を limit 範囲でグリッドサンプル、`MAX_SAMPLE_CONFIGS` で総当たり爆発を
  ガード — ハングさせない）、`reachTargets`（到達点群への最近傍 ≤ tolerance で `reachable`、
  境界余裕で `margin`）。fixed 関節は q を消費しない（`movableJoints`）。
- **`Collision.js`** — `bakeContacts({links, obstacles?, scope, ignore?})`。scope `self` は links 内
  全ペア、`env` は links×obstacles。クリアランスは共有の `aabbClearance`（符号付き＝侵入は負）を
  再利用（`lo<hi` 等の単一の真実を二重実装しない）。`ignore` は順不同でペアを除外（関節隣接 link）。

両モジュールとも純粋・入力不変。オペランド形状は §9.2 の述語入力にそのまま一致する。

### 10.3 ComputeBackend シーム（`src/robotics/ComputeBackend.js`）

`ComputeBackend` = `run(job): Promise<result>` の単一インターフェイス（§3）。ジョブは冪等な値
オブジェクト（`{kind:'reach', chain, targets, options?}` / `{kind:'collision', links, …}`）でキャッシュ可能。
Phase 2 は `LocalComputeBackend`（純-JS カーネルを in-process 実行、`backend:'local'` タグ）のみ。
`ServerComputeBackend`（BFF `/compute`）・KDL/ruckig-WASM・three-mesh-bvh カーネルは**同一の
`run(job)` シームの裏で後続差し替え**（呼び出し側不変）。

### 10.4 RoboticsService（`src/service/RoboticsService.js` — 受け口、§2）

測定器の副作用コーディネータ（`EventEmitter`、**純粋ロジックを持たない** — PHILOSOPHY #3、
`ContextService` と同作法）。バックエンドを**注入**（THREE-free にユニットテスト可、fake backend）。
`measureReach`/`measureCollision` は backend を走らせ、結果オペランドを acceptance チェックの
`robot_reach`/`collision_free` 述語へ**新しい doc としてベイク**（入力不変 — PHILOSOPHY #6）、
`measured` イベントを emit。`applyMeasuredFact` は scalar 値を `status:'measured'` Fact へ
（`numericFact` 受け口、`cycleTime`/`reachMargin` 等。measured は依存 acceptance を block しない —
ADR-046 不変条件 3）。チェック欠落/述語種別不一致は throw（測定値の silent 喪失を防ぐ —
PHILOSOPHY #11）。ベイク後の doc は `validateContext`/`evaluatePredicate` が boolean へ縮退
（§1.1・§2 のループが形式側で閉じる）。

### 10.5 テストと非目標

`src/robotics/Robotics.test.js`（FK 正当性・到達 pass/fail・干渉ベイク・backend ディスパッチ・
純粋性）＋ `src/service/RoboticsService.test.js`（doc ベイクの入力不変・述語種別ガード・measured
Fact・イベント・**ベイク済述語が `validateContext` を通る end-to-end**、fake backend で THREE-free）。
計 **258/258**、`tsc --noEmit`・`vite build` クリーン（`wasm-pack` 不在は環境要因、ADR-027 成果物は
git コミット済）。**非目標（据え置き）**: KDL/ruckig Emscripten→WASM、IK/特異点 Jacobian、可動
ソルバ、urdf-loader/three-mesh-bvh の実幾何、`ServerComputeBackend`/BFF `/compute`、`RobotPoseGhost`/
`CollisionHighlightView`、pending/computing UX。可視化ループ（§6）の**人間検証側オーバーレイ**は
本フェーズも未実装（形式検証側の受け口のみ完成）。

---

## 11. Phase 3 実装 — C++→Emscripten→WASM ビルドレーンの環境導入

§4 が「方針を明記、実 CI 設定とビルドスクリプトは後続フェーズ」とした **C++（KDL/ruckig）→
Emscripten→WASM レーン**を実際に立ち上げる。§10.1 で「当 CI 環境に `wasm-pack`/Emscripten レーンが
不在」だったため Phase 2 を純-JS 初期形に落としたが、本フェーズで**両ツールチェーンを導入**し、
KDL/ruckig が WASM へコンパイル・リンク・実行できることを end-to-end で実証する。これは
**測定の精度モデルを本実装へ引き上げる前段**（環境整備）であり、§3 のシーム（`ComputeBackend.run(job)`）と
§9.2 のオペランド形状は依然不変——WASM カーネルはこのシームの裏に**後続フェーズで配線**する。

### 11.1 ツールチェーン（再現可能化）

ephemeral コンテナ前提のため、ツールチェーンは**コミット済みスクリプトで再現可能**にする
（`scripts/setup-toolchain.sh`、`pnpm setup:toolchain`）。冪等・再実行可能:

- **Rust レーン**（既存 ADR-027 の再確立）: `rustup target add wasm32-unknown-unknown` ＋
  `wasm-pack`（GitHub Pages の公式インストーラ URL が網羅ポリシーで遮断される場合があるため、
  `github.com` のリリースアセット `wasm-pack-vX-x86_64-unknown-linux-musl.tar.gz` を直接取得、
  失敗時 `cargo install` フォールバック）。`pnpm build:wasm` が通ることを確認済。
- **C++ レーン**（新規）: Emscripten SDK（`emsdk`、既定 `/opt/emsdk`、`install/activate latest`、
  `emcc 6.0.0`）。`source $EMSDK_DIR/emsdk_env.sh` で PATH 化。
- **vendor**: `git submodule update --init --recursive robotics-wasm/vendor`。

### 11.2 ライブラリの vendor（pinned submodule）

`robotics-wasm/vendor/` 配下に pinned git submodule として導入（リポジトリ肥大を避ける；
Eigen はヘッダのみで大きい）:

| submodule | バージョン | 依存 |
|---|---|---|
| `ruckig` | `v0.9.2` | なし（core のみ、python/cloud client は除外） |
| `orocos_kdl` | `v1.5.1` | Eigen |
| `eigen` | `3.4.0` | ヘッダオンリー |

### 11.3 ビルド構成（`robotics-wasm/`）

単一の最上位 `CMakeLists.txt` が **3 ライブラリを 1 つの embind WASM モジュール**へまとめる
（各ライブラリの install/pkg-config/python 機構を駆動せず、必要ソースを直接コンパイル）:

- **ruckig**: core 5 ソース（`brake` / `position-step1,2` / `velocity-step1,2`）のみ。`python.cpp`・
  cloud client は除外。外部依存なし。
- **KDL**: `src/*.cpp` ＋ `utilities/*.{cpp,cxx}` を全コンパイル。`kinfam_io.hpp → tree.hpp →
  config.h` が Chain 系ソースからも推移的に include されるため `config.h` を `configure_file` で生成
  （**旧 Tree インターフェイス** = `KDL_USE_NEW_TREE_INTERFACE` 未定義 → **Boost 不要**；直列ロボットの
  運動学は Tree を使わず、emscripten libc++ は旧インターフェイスの incomplete-type コンテナを支持）。
- **Eigen**: include パスのみ。
- リンクフラグ: `-lembind -O3 -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web,worker,node
  -s ALLOW_MEMORY_GROWTH=1 -s EXPORT_NAME=createRoboticsEngine`、出力 `.mjs`（Vite バンドル ＋
  `node --test` の双方で import 可能）。

ビルドは `scripts/build-robotics-wasm.sh`（`pnpm build:robotics-wasm`）が `emcmake`/`emmake` を包み、
成果物 `robotics_engine.mjs` + `.wasm` を `src/engine/robotics-wasm/` へ publish。**成果物は git に
コミット**（ADR-027 と同方針 — `vite build`/GitHub Pages CI は C++ ツールチェーン不要）。
`build:robotics-wasm` は重いため `pnpm build` には**組み込まない**（明示的 opt-in）。

### 11.4 初期 embind サーフェス（initial introduction）

`src/bindings.cpp` は各ライブラリが正しくコンパイル・リンク・実行することを**最小だが実物**で実証
（純粋関数 — PHILOSOPHY #3）:

- `ruckigMoveDuration(distance, vMax, aMax, jMax)` → 1-DoF rest-to-rest 移動の総時間[s]（不能なら -1）。
  サイクルタイム測定（§7.4）が動作計画上で総和する核。
- `planar2rFk(l1, l2, th1, th2)` → 平面 2R アームの TCP 位置 `[x,y,z]`（`KDL::Chain` /
  `ChainFkSolverPos_recursive` の実経路、Eigen を推移的に駆動）。リーチ測定（§7.1）の FK 核。
- `kdlVersion()` → リンク確認プローブ。

### 11.5 検証と非目標

`robotics-wasm/robotics_engine.test.mjs`（`pnpm test:robotics-wasm`、`node --test`）が**コミット済み
成果物を import**して数値正当性を検証: FK（(0,0)→(2,0,0) / (90°,0)→(0,2,0) / (0,90°)→(1,1,0)）、
ruckig（妥当な移動は有限正の時間、ゼロ限界は -1）。`test:context`（THREE-free 純-JS レーン）とは別建て
（WASM 成果物を要するため）。既存の純粋層（`src/context/*` 258 テスト）・Phase 2（`src/robotics/*`）は
**無改変**。

**非目標（後続フェーズ、据え置き）**: WASM カーネルを `ComputeBackend` 裏へ配線（現状は
`LocalComputeBackend` 純-JS が既定のまま、§10）、IK/特異点 Jacobian、可動ソルバ、urdf-loader/
three-mesh-bvh 実幾何、`ServerComputeBackend`（BFF `/compute`）、`RobotPoseGhost`/
`CollisionHighlightView`、pending/computing UX。本フェーズは**ビルドレーンの環境導入に尽きる**——
「KDL/ruckig を WASM へ運べる経路」を再現可能な形で確立し、最小サーフェスで実証する。

---

## 12. References

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
- §1.1 の代数レンズは ADR-052(同義語商・φ/φ⁻¹ = セクション σ)と ADR-049
  (`AdmissiblePromotion.invertCriterion` / 許容領域前像 = pullback)に明示的に接地する。
  関連コード参照: `src/context/SynonymQuotient.js`(同義語商), `src/context/AdmissiblePromotion.js`
  (`invertCriterion`)。
