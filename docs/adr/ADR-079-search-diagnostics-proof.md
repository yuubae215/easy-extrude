# ADR-079: 判定の証明 (feasibility funnel + near-miss) を UX 資産として返す

- Status: Accepted, implemented (エンジンのファネル収集 + reach near-miss + wire 露出まで
  完了。上流 contract は v3 に版上げ済み、core は emit 追従済み = producer 側は完結。
  残るは BFF/UI 側の消費追従。
  実装: `core/easy_extrude_core/engine/pipeline.py` (search_report) + `feasibility.py` (reach_miss)
  + `contract/models.py` (SearchDiagnostics wire, contractVersion=3))
- Date: 2026-07-04
- 関連: ADR-074 (BFF <-> コアAPI 契約) / ADR-075 (段階0 判定エンジン) /
  ADR-076 (HTTP 境界) / 契約統治の先例:「ワイヤに載せてよいのは決定した事実だけ」

## Context — Goal と力学

### UX の役割分担 (本 ADR が従う上位方針)

プロダクトの UX を層で分担する:

| 層 | UX 上の役割 |
|---|---|
| コアAPI (`core/`) | **有用な「証明」API ロジック** = 判定結果に *根拠* を添えて返す |
| エディタ UI (`easy-extrude`) | **遊び心のあるゲーム感覚 UI** = データ入力を辛くさせない即時フィードバック |
| 契約スキーマ (`easy-extrude-contract`) | **カノニカルな契約スキーマ** = 両者が読む唯一の wire 正本 |

エディタの UI がゲーム感覚 (入力するたび即座に「効いた/惜しい/ダメ」が返る) であるためには、
コアAPI が **なぜその結果になったかの証明材料** を返せなければならない。
UI の演出力はコアAPI の説明力が上限になる — これが本 ADR の Goal:

> **Goal: 探索が空振り (候補ゼロ) でも「なぜダメか」「どれだけ惜しいか」を、
> ソルバが決定した事実として返せること。**

### 現状の欠落

段階0 エンジン (`engine.search`, ADR-075) は安い順フィルタ (リーチ -> IK -> 干渉) で
候補を短絡棄却し、**生き残った候補だけ** を返す。その結果:

- 候補ゼロのとき応答は空配列のみ。「リーチが足りない」のか「全部干渉」なのか
  「そもそも表面サンプルが無い」のか、UI は区別できない。
- `ScoreBreakdown` の 3 真偽値 (withinReach / ikSolvable / interferenceFree) は
  生存者に付くので **常に全部 true** = 情報量ゼロ (棄却された候補は載らないため)。
- ユーザのデータ入力ループが「パラメータを直す -> 空配列 -> 当てずっぽうで直す」になり、
  ゲーム感覚どころか苦行になる。

## Options considered

- **A: コア pydantic に diagnostics を足して即 wire に載せる**
  — tradeoff: 上流 Schema はトップレベル `additionalProperties:false` なので、消費側
  (BFF) の応答検証が **即座に壊れる**。契約は上流正本でしか変えない統治にも違反。却下。
- **B: エンジンにファネル収集を実装し、wire 追加は上流版上げの申し送りにする (採用)**
  — tradeoff: エンドユーザに届くのは contract v3 + BFF/UI 追従後。ただし壁の統治を守り、
  コア側は実装 + テスト済みの状態で版上げを待てる (先例: pose union v2 と同じ順序)。
- **C: UI/BFF 側で「なぜダメか」を推測させる**
  — tradeoff: 判定実装はコアAPI に閉じている (壁そのもの) ので原理的に不可能。
  推測実装をエディタ側に書けば判定ロジックの重複・ドリフトを招く。却下。
- **D: 何もしない** — tradeoff: 候補ゼロ UX が死んだまま。ゲーム感覚 UI の上限をコアAPI が
  塞ぎ続ける。却下。

## Decision — Strategy

### 1. 診断 = 「ソルバが決定した事実」だけ (包含テストを継承)

pose union の包含テスト (ワイヤに載せてよいのは *決定した事実* だけ / 演出はクライアント導出)
を診断にもそのまま適用する:

- **feasibility funnel (棄却ファネル)**: 生成 N 件 -> リーチで n1 棄却 -> IK で n2 棄却 ->
  干渉で n3 棄却 -> 生存 k 件 -> 返却 min(k, topN) 件。各段の棄却数は判定の決定事実。
  短絡フィルタなので「IK で棄却」= リーチは通った候補、と段が排他に定まる。
- **reach near-miss**: リーチ棄却候補のうち、到達殻 [reachMin, reachMax] までの
  最小不足距離 (幾何の決定事実)。「あと 0.05m 届けば」を UI が言える材料。
- **載せないもの**: 「惜しい!」の文言・色・メーター演出・改善提案文 (クライアント所有)。
  IK / 干渉の near-miss (後述 3)。

### 2. 収集は同一ループ内で純粋に (二度走らせない)

ファネル計数と reach near-miss は `pipeline.search` の既存ループで incidental に収集する
(候補ごとの追加コストは距離比較 1 回分)。診断のための再探索・第二パスは作らない。
数値的安定性・計算時間の方針 (CLAUDE.md) を崩さない。

### 3. 注入ソルバ / チェッカは黒箱のまま (IK・干渉の near-miss は作らない)

`IkSolver` / `CollisionChecker` は Protocol (bool/Optional を返す黒箱, ADR-075)。
near-miss を求めて Protocol に「どれだけ惜しいか」を足すのは黒箱契約の変更であり、
naive 実装にしか意味のある値を返せない (実ソルバは「解なし」しか知らない)。
実需が立つまで作らない (YAGNI)。reach は純粋関数 (Protocol 外) なので例外的に取れる。

### 4. wire 統治: 上流 contract v3 で `diagnostics` を追加、core は emit 追従済み

- 契約の実改変は上流 `easy-extrude-contract` のみ (統治の再確認)。応答トップレベルに
  閉じた `diagnostics` オブジェクトが追加され contractVersion 2 -> 3 に版上げ済み。
- 適用順序 (先例と同じ): **契約 repo で版上げ (完了) -> core (producer) が emit 追従
  (完了) -> BFF/UI (consumer) が消費追従 (未着手)**。逆順は additionalProperties:false で
  即壊れるため守った。
- コア側は `contract/models.py` に wire 型 `SearchDiagnostics` を追加し `GraspSearchResponse`
  の必須フィールドにした。ドメイン型 (engine の `SearchDiagnostics`, 同名だが別モジュール) から
  1:1 で変換して emit する。`search()` (契約応答) は diagnostics を含めて返すようになった。

## Consequences — Evidence と tradeoff

- 肯定的: 候補ゼロの応答が「何が起きたか」を語れるようになり、エディタのゲーム感覚 UI が
  即時フィードバック (ファネル可視化 / 惜しいメーター) を演出できる。判定の *説明力* が
  UI 側の表現力の上限を押し上げる (出るのは集計値のみで、判定実装そのものは wire に出ない)。
- 受け入れるコスト: エンドユーザに届くまで 2 段 (contract 版上げ + BFF/UI 追従) の
  リードタイム。diagnostics 分だけ応答が数十バイト太る。IK / 干渉の惜しさは説明できない
  (黒箱維持の代償。実需が立ったら Protocol 拡張を別 ADR で)。
- 検証 (証拠): `core/tests/test_engine.py` にファネル計数の排他性 (棄却数 + 生存数 = 生成数) /
  reach near-miss の幾何値 / 候補ゼロ各パターン (サンプル無し・全リーチ外・全干渉) の
  ユニットテスト。既存 conformance テスト (v2 emission 無変更) が green のまま。
- 波及 (blast radius): `engine/pipeline.py` (ループ内収集 + search_report 新設) /
  `engine/feasibility.py` (reach_miss 純粋ヘルパ) / `engine/__init__.py` (export) /
  テスト。契約 pydantic・API 層・scene/recommendation レーンは無変更。

## Lens notes

- 層 + 契約: 変えるのは engine 層の *内部* とドメイン出力のみ。wire 契約境界は
  上流の版上げイベントまで凍結 (契約に依存し実装に依存させない)。
- 黒箱: IkSolver / CollisionChecker の入出力契約を保った (near-miss を求めて内側へ
  手を伸ばさない)。
- 真実の源: ファネルは探索ループの導出値であり、正本は探索そのもの。第二の源に
  ならないよう診断は毎回ループから導出する (キャッシュ・別計算経路を作らない)。
