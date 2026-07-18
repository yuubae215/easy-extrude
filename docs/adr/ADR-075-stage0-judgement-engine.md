# ADR-075: 段階0 判定エンジンの設計方針 (次セッション着手)

- Status: Accepted (高レベル方針 + 詳細設計を確定し、段階0 素朴版を実装)
- Date: 2026-06-21 (Proposed) / 2026-06-21 詳細設計確定 + 実装
- 関連: ADR-074 (BFF <-> コアAPI 契約) / `core/README.md` /
  実装 `core/easy_extrude_core/engine/`

## Context

コア (レイヤ B) の判定エンジンの最初の実装 = 段階0。本セッションでは契約 (ADR-074) と
中立スキーマパッケージ (`packages/grasp-contract/`) まで整備し、Python 配線と conformance
テストを通した。**判定の実装 (解く処理) は意図的に未着手**。この ADR は次セッションで
段階0エンジンの設計に入るための申し送りとして、確定済みの方針と詰めるべき論点を記録する。

実装言語は **Python** (選定済み)。出力は契約 `GraspSearchResponse` (上位N件 + スコア内訳)
を満たす。

## Decision (確定済みの高レベル方針)

### 1. アルゴリズムの形

```
離散候補生成  ->  安い順フィルタ (リーチ -> IK 可解 -> 干渉)  ->  加重和スコア  ->  上位N件
```

- **最適化ソルバではなく「評価関数つき全探索」**。数百〜数千候補なら一瞬で回る規模を想定。
- **安い順フィルタ**: 計算コストの安い判定から順に当てて短絡する
  (リーチ = 最も安い -> IK 可解 -> 干渉 = 最も高い)。高い判定に到達する候補を減らす。

### 2. 素朴版が先 (規律)

- まず **総当たりで正しい順位が出る素朴版** を作る。最適化・高速化は *後*。
- 順序: **動く素朴版 -> テスト -> 必要なら高速化**。聞かれていない最適化を先に入れない。

### 3. 設計規律 (グローバル / CLAUDE.md 準拠)

- **純粋関数** (制約判定・スコア計算) と **副作用ありメソッド** を分離する。
- **数値的安定性を最優先**、その次に計算時間。
- objectives は **絶対基準で 0-1 正規化** してから重み付け
  (テンプレ間の比較可能性 = 商品価値。正規化済みであることは契約 ADR-074 でも強制済み)。
- スコア = 正規化済み objective 値の **加重和** (重みは `graspSearch` 宣言の objectiveWeights)。

### 4. 契約との接続

- 入力: `GraspSearchRequest` (graspSearch 宣言 + layoutVersion + contractVersion)。
- 出力: `GraspSearchResponse` (rank 昇順の上位N件、各 `ScoreBreakdown` に
  withinReach / ikSolvable / interferenceFree / objectiveScores (0-1) / totalScore)。
- `contractVersion` 検証ガード (`check_contract_version`, ADR-074) はエンジンの外、
  エンドポイント層で 400 に写す。エンジン自体は検証済みの宣言を受け取る純粋な計算に徹する。

## Decision (詳細設計, 本セッション確定)

ADR の高レベル方針を起点に Open の論点を詰め、段階0 素朴版を `core/easy_extrude_core/engine/`
に実装した。各論点の確定内容と実装位置:

- **候補生成** (`engine/candidates.py`, 純粋): 対象を「表面サンプル (点 + 外向き法線)」の
  集合で受け、各サンプルで進入方向の基準を法線の逆向き (正対進入) とし、approach 傾け角と
  ロール角の直積で離散候補を列挙する。順序は (サンプル, 傾け, ロール) で決定的 (再現性 =
  テスト容易性)。傾けは数値的に頑健な Rodrigues 回転、退化 (ゼロ長軸/法線) はガード。
- **リーチ判定** (`engine/feasibility.within_reach`, 純粋): base 中心の球殻 [reach_min,
  reach_max] への距離比較のみ。最安なので安い順フィルタの先頭で短絡に使う。
- **IK 可解性** (`engine/feasibility.IkSolver` Protocol + `NaiveIkSolver`): ソルバは
  **Protocol で注入**する (コストが高く将来は外部ライブラリ/サービス = 副作用になり得る)。
  素朴な既定の「可解」定義 = リーチ内 かつ base->把持点 方向と進入方向のなす角が手首コーン
  以内。実ソルバ (関節限界/特異点) は差し替えで対応、契約境界は不変。
- **干渉判定** (`engine/feasibility.CollisionChecker` Protocol + `NaiveSphereCollisionChecker`):
  同じく **注入**。最高コストなので安い順フィルタの最後段。素朴な形状表現は球障害物のみで、
  進入経路 (pre_grasp -> 把持点) の線分との最短距離で判定。メッシュ/凸包は将来差し替え。
- **把持安定性** (`engine/objectives._raw_grasp_stability`): 段階0 は wrench cone の代理として
  「進入方向と表面法線の逆向きの整合 (dot)」を使い 0-1 化する。本物の wrench cone 計算は
  後で raw 計算だけ差し替える (契約に出るのは 0-1 正規化値なので境界は不変)。
- **objective 正規化** (`engine/objectives.NormSpec` + `OBJECTIVE_REGISTRY`): 各指標は
  raw 計算 -> 絶対基準 NormSpec(lo,hi) でクランプ線形写像、の 2 段。基準は指標ごとに固定値で
  明示 (reach_margin = 到達域の半幅、grasp_stability = [0,1]、approach_clearance =
  clearance_reference)。**その回の候補集合に依存する相対正規化は禁止** (テンプレ間比較可能性)。
- **純粋/副作用の境界**: 候補生成・判定述語・objective 正規化・スコア計算は **純粋関数**。
  副作用 (注入された IK ソルバ / 干渉チェッカの呼び出し) は orchestration の
  `engine/pipeline.search` **だけ**が持つ。純粋コアは Protocol にしか依存しない。
- **総合スコア** (`engine/scoring.weighted_sum`): 正規化済み objective 値を **重み総和で割った
  加重平均** (0-1)。素の加重和だと重み構成でスケールが動きテンプレ間比較が崩れるため。
- **性能目標**: 素朴版は数百〜数千候補で sub-second を目安に許容。全探索 + 安い順短絡のまま、
  実測で予算超過したときに初めて高速化に着手する (聞かれていない最適化を先に入れない規律)。

### 契約宣言 -> ドメインの adapter
`engine/pipeline.problem_from_declaration` が graspSearch 宣言 (open payload) の既知 wire キー
(robot / target.surfaceSamples / obstacles / sampling) を寛容に読み `Problem` を組む。Layout DSL の
厳密な形は Layout DSL 正本に属するためエンジン側で二重定義しない (欠損は素朴な既定値に落とす)。

## Still deferred (段階0 では素朴版に留め、後で差し替える)

- 実 IK ソルバ (関節限界・特異点・複数解の扱い) — `IkSolver` 差し替えで対応。
- メッシュ/凸包ベースの干渉 (グリッパ形状込み) — `CollisionChecker` 差し替えで対応。
- 本物の wrench cone による把持安定性 — `grasp_stability` の raw 計算差し替えで対応。
- サイクルタイム objective — 軌道モデルが要るため段階0 のレジストリには未登録。
- 高速化 (空間分割・候補枝刈り・並列) — 実測で予算超過するまで着手しない。

## Consequences

- 次セッションは本 ADR の Decision (素朴版優先・安い順フィルタ・加重和・上位N件) を起点に、
  Open の論点を詰めてから実装に入る。
- 実装は契約 (`packages/grasp-contract/` の JSON Schema / core の pydantic) を満たすこと。
  契約を変える必要が出たら ADR-074 側で `contractVersion` を上げる。
- エンジンの実装は `core/` に閉じる。Layout DSL には参照名のみ (解く処理は DSL 側に出さない)。
