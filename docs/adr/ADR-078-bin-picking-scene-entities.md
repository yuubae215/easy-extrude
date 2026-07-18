# ADR-078: bin-picking シーンのエンティティモデル (障害物ロール属性 / 許容角 vs 進入角) + UI 申し送り

- Status: Accepted (設計方針を固定 + scene 層を実装 + HTTP 境界 `POST /pick-sequence` を配線。
  実装: `core/easy_extrude_core/scene/` + `contract/scene_models.py` + `api/app.py`。
  templates/bin-picking-thin-container の運用検討から派生)
- Date: 2026-06-27
- 関連: ADR-074 (BFF <-> コアAPI 契約) / ADR-075 (段階0 判定エンジン: pure/副作用・正規化・球近似 deferred) /
  ADR-076 (HTTP 境界) /
  `templates/bin-picking-thin-container/` (素朴テンプレ = 本 ADR の出発点)

## Context

薄型コンテナ + ランダム平置きワークの grasp search テンプレ
(`templates/bin-picking-thin-container/`) を素朴版エンジン (ADR-075) で動かす過程で、
段階0 の **フラットな `obstacles[]` 手書きリスト** が現実のビンピッキングを表しきれない
ことが分かった。設計討議で 2 つの論点が立った。本 ADR はその確定方針を記録する
(実装は本セッションでは行わない = 素朴テンプレを足場にした申し送り)。

## Decision 1: 「障害物かどうか」はジオメトリ固定の性質ではなく、エンティティの属性

ビンピッキングでは「何が障害物か」は文脈依存で、ピックの進行とともに変わる:

- **壁 (wall)**: static。状態変化なし。常に障害物、対象にはならない。
- **ワーク (workpiece)**: dynamic かつ二役。(a) ある回の **対象 (target)** になり得る、
  (b) 他のワークの把持に対する **障害物** になる、(c) ピックされると **シーンから消える**。
  -> ピックごとに障害物集合が変わる。

罠 (ADR-075 の素朴干渉に由来): 対象ワーク自身を障害物に入れると、進入線分の終点が対象中心と
一致して線分-球距離 0 -> **必ず自己干渉** (`engine/feasibility.NaiveSphereCollisionChecker`)。
現テンプレはこれを「対象を手で除外 + 隣接ワークを手で列挙」で回避しているが、多ピックの
シーケンスに乗らず、毎ピックで `obstacles[]` を手書き再構築する必要がある。

### 確定方針

シーンを **属性付きエンティティの集合** で表す。各エンティティに最低限:

- `kind`: `wall` | `workpiece` | `fixture` ...
- 永続性 (static / dynamic): `wall` = static (常時障害物)、`workpiece` = dynamic
  (ピックで除去され得る)。

ある 1 ピック要求に対する障害物集合を **属性から導出** する (手書きしない):

```
obstacles(pick) = {全 static エンティティ}
               + {全 dynamic エンティティ} - {今回の target} - {既にピック済み}
```

これで「対象除外」「壁は常時障害物」「ピックでシーンが縮む」が属性から自動的に出る。
「最上面から取る」順序は: feasible かつ collision-free な把持を持つ dynamic エンティティの
うち z 最大を選び、ピック後に scene から除去して再評価する反復ポリシ。

## Decision 2: seam (どこに置くか) — 壁の規律を守る

- **エンジン 1 リクエストの契約 (`target` + `obstacles[]`) は不変に保つ** (ADR-075 の
  adapter 規律 / 契約は public 正本)。エンジンは「1 対象に対する把持ランキング」を返す純粋計算。
- その上に **scene/entity 層** を新設し、エンティティ属性 + ピック履歴から
  「per-pick の target / obstacles」を導出する。ADR-075 の pure/副作用境界を踏襲し、
  **導出は純粋関数 / ピック列の進行 (除去・再評価) は副作用境界** に分ける。これは `core/` (レイヤ B)。
- DSL 側 (器): エンティティの `kind` / static-dynamic / target マーカは **宣言の属性**
  = Layout DSL スキーマ (layout/1.x) の語彙。**参照名のみ**。障害物集合の導出・把持判定
  という「解く処理」は `core/`。ADR-077 の decide/propose と同じ動詞境界:
  DSL は「これは dynamic な workpiece だ」と **宣言する器**、`core/` は「ではこのピックの
  障害物集合はこれ、把持はこれ」と **判定する**。

## Decision 3: cone (許容角) と approach (進入角) は別軸 — 用語を分ける

混同が起きたので docs / UI で用語を固定する:

- **許容角 (cone)** = `robot.wristConeHalfAngle`: ロボット手首が向けられる向きの上限。
  **IK 可解性の判定パラメータ** (`engine/feasibility.NaiveIkSolver`)。「届く向き」。
- **進入角 (approach angle)** = `sampling.approachTiltAngles` / `rollAngles`: 候補生成で
  「試す進入の向き」の刻み (`engine/candidates.generate_candidates`)。「試す向き」。

2 つは別レイヤ・別目的。「試す向き」が「届く向き」の外なら候補は IK で落ちる。UI でも別物として
見せ、混ぜない。

## UI アイデア (エディタ側への申し送り)

エディタ / DSL スキーマ / バリデータ側が用意すべき affordance。判定の中身 (衝突集合
導出・把持判定・スコア式) は出さず、**参照名のみ**:

- **シーン編集**: 薄型コンテナをパラメトリックな箱 (内寸 / 壁高) で配置。壁 = static エンティティ。
- **ワーク配置**: 個数・ランダム配置 (シード / 分布) でワークを撒く。各ワーク = dynamic
  エンティティ。kind / static-dynamic は属性として編集可、既定は wall=static / workpiece=dynamic。
- **target / 順序ポリシ**: 「この回の対象」を明示するか、「最上面から自動」を選ぶ。
- **把持サンプリング (進入角)**: tilt / roll の刻みを編集 = 「試す向き」。
- **ロボット許容角 (cone)**: wrist cone を別 UI で = 「届く向き」。「試す向き ⊄ 届く向き」だと
  候補が IK で落ちる旨を UI ヒントで示す。
- **制約**: `reachable` / `ik_solvable` / `collision_free` を参照名トグル/ラベルで。解く実装・
  スコア式は出さない。
- **出力プレビュー**: 上位N把持のランキング (score 内訳) を読み取り専用で表示。

申し送りの形: これらは Layout DSL スキーマ拡張 (entity kind / static-dynamic 属性 /
container box / placement) と エディタ UI の話。`core/` はその宣言を消費して
per-pick 導出 + 判定を実装する。**スキーマ属性 = 器 (DSL) / 導出・判定 = 判定 (core)**
の境界を死守する。

## Implementation (本セッションで実装)

scene 層を `core/easy_extrude_core/scene/` に新設した。ADR-075 の pure/副作用境界と
「エンジン契約は不変」(Decision 2) を踏襲し、recommendation lane と同形に組む:

- `scene/types.py` (純粋ドメイン型): `SceneEntity` (`entity_id` / `kind` /
  `collision_spheres` = 障害物役の球 / `surface_samples` = 対象役の把持点 / `persistence`)
  と `Scene`。`EntityKind` (wall/workpiece/fixture) と `Persistence` (static/dynamic)。
  永続性は kind から既定を解決し、明示で上書きも可 (UI 申し送りの「属性編集」)。
  `is_targetable` (dynamic かつ把持点あり) と `top_z` (最上面順の代表 z) を持つ。
- `scene/settings.py` (純粋): `GraspSettings` = per-entity でない設定 (robot / objective 重み /
  サンプリング / top_n)。Decision 3 の用語境界 (cone=robot の許容角 / approach=サンプリングの
  進入角) を型レベルで別軸に保つ。
- `scene/derivation.py` (純粋): `derive_obstacles` が Decision 2 の式
  `{static} + {dynamic} - {target} - {picked}` を実装 (= 対象自身を障害物に入れない構造で
  自己干渉の罠を回避)。`order_by_topmost` (z 降順, 同値は id で決定的)、`build_request`
  (scene -> エンジン契約 `GraspSearchRequest` の adapter = seam)。
- `scene/orchestration.py` (副作用境界): `run_pick_sequence` が「最上面順に feasible な
  dynamic を選び、ピック後に除去して再評価」する反復ポリシ。1 ピックは **エンジン契約の往復**
  (`pipeline.search`) を通し、IK ソルバ / 干渉チェッカは engine と同じ Protocol 注入。

entity 属性は **public Layout DSL 宣言をドメイン型として消費** する形に留め、wire スキーマの
**中立化 (正本 JSON Schema)** は後続にdefer する (recommendation lane と同じ「不透明消費」)。
テストは `core/tests/test_scene.py` (永続性解決 / 導出式 / 自己干渉回避 / 最上面順 / 反復ピックの
縮小・終了・上限)。

### HTTP 境界 (pick-sequence エンドポイント) — 追加実装

scene 層を「BFF が呼べる外部サービス」にする薄い HTTP 境界を足した (ADR-076 / ADR-077 と同形)。
recommendation lane が踏んだ「wire スキーマ中立化 deferred」の前例どおり、**pydantic を
暫定の正本**にし、中立化は後続にdefer する:

- `contract/scene_models.py` (pydantic, 暫定正本): `PickSequenceRequest` (= scene 宣言
  `SceneWire` + `GraspSettingsWire` + contractVersion/layoutVersion + maxPicks) と
  `PickSequenceResponse` (`PickStepWire` の並び)。pose/score は grasp 契約の `PoseCandidate` /
  `ScoreBreakdown` を **再利用** (二重定義しない)。pick-sequence は新規契約なので
  **contractVersion は上げない** (ADR-074、grasp/recommendation と共有)。
- `scene/orchestration.py::pick_sequence` (wire adapter): wire の属性宣言をドメイン
  (`Scene`/`GraspSettings`) に写し、`run_pick_sequence` を回し、各 `PickResult` を `PickStepWire`
  に戻す。`run_pick_sequence` = ドメイン I/O / `pick_sequence` = wire I/O の対は recommendation の
  `propose`/`recommend` と同形。
- `api/app.py::POST /pick-sequence`: grasp-search と同じ HTTP 境界の作法 (contractVersion 検証
  -> 400 / 形違い -> 422 / 認証 -> 401 / threadpool + 実行時間ガード / envelope)。ソルバ/チェッカは
  grasp-search と同じ DI 注入点を共有。
- 壁の規律 (Decision 2): wire **入力は属性の宣言 (器) のみ** — 「障害物集合」や「これは障害物だ」の
  判定は wire に置かない (障害物導出は `derive_obstacles`)。**出力**は per-pick の把持
  ランキング。`derivedObstacleCount` は導出の *個数* だけ (どの球か = 判定は出さない)。
- テスト: `core/tests/test_scene_contract.py` (wire round-trip / 属性宣言のみ / 縮小) +
  `core/tests/test_scene_api.py` (最上面順 / 400/422/401 / DI 注入が naive を上書き)。
- 中立化 (正本 JSON Schema 追加 -> conformance -> BFF 配線) は後続の申し送り事項。

## Still deferred (方針は決めたが本セッションでは実装しない)

- entity / scene の **中立 wire スキーマ** (正本 JSON Schema) と BFF(TS) 配線・両側 drift 検知。
  現状は pydantic (`contract/scene_models.py`) が暫定正本 (recommendation の中立化と束ねてよい)。
- 箱 / 半空間 (平面) 障害物 = 薄型壁の厳密干渉 (ADR-075 の球近似 deferred と同根)。
- 本物の wrench cone 把持安定性 (ADR-075 既出)。

## Consequences

- 現テンプレ (`templates/bin-picking-thin-container/`) は「1 リクエスト 1 対象・隣接ワーク球・
  壁球」の素朴例として有効なまま。本 ADR は、それを「属性付きエンティティ + per-pick 導出 +
  最上面順」へ育てる道筋を固定する。
- エンジンの契約 (`target` + `obstacles`) は不変。新しい scene 層が上に乗る (ADR-075/003 と非競合)。
- scene 層は HTTP 境界 (`POST /pick-sequence`) まで配線済み = BFF が呼べる外部サービスになった。
  wire 契約は pydantic が暫定正本で、中立化 (正本 JSON Schema 化 + BFF 配線) は
  recommendation と同じく後続にdefer (壁を保ったまま段階移行)。
- 用語統一: **cone = 許容角 (届く向き) / approach = 進入角 (試す向き)** を docs / UI で徹底。
- エディタ側への UI / スキーマ申し送りは別 ADR で受ける。本 ADR は `core/` 側の受け皿と
  seam (接合面) を固定する申し送り。
