# ADR-077: 推薦/類似レーン (recommendation/similarity lane) の設計方針

- Status: Accepted (方針確定 + propose-only core + 契約 wire + HTTP `/recommendation` を実装。実 embeddings / 中立スキーマ / NormSpec 基準確定は引き続き defer)
- Date: 2026-06-23 (Proposed) / 2026-06-23 (propose-only core + HTTP 境界 実装)
- 関連: ADR-074 (BFF <-> コアAPI 契約) / ADR-075 (段階0 判定エンジンの pure/副作用・正規化規律) /
  ADR-076 (HTTP 境界 / contractVersion ガード / エラー envelope) /
  ADR-052 (5W1H ユビキタス言語: 正準ツリー / SynonymQuotient) /
  ADR-056 (DSL canonical form / diff / reconcile) /
  実装 `core/easy_extrude_core/recommendation/`

## Context

ADR-056 (DSL canonical form / WL color refinement / diff / reconcile) の中核 = **「DSL
という契約そのものを、機械可読な不変条件として閉じる器」**であり、判定エンジン (コア) では
ない。よって canonical form・diff・reconcile・curated dictionary (QUOTIENT_TABLE 拡張) は
**DSL の正本 (public スキーマ) 側に置く**のが正しい (契約は見えるからこそ信用になる =
PHILOSOPHY の「スキーマ = 信用の広告塔」)。

その ADR-056 の議論で、上に乗る **recommendation/similarity layer** が「スコープ外責務」として
切り出された。これは embeddings / 外部サービスを使い「あなたの要件文は X と言うが、構造は Y を
示唆する」と **対応づけ候補をランキング・提案**する層であり、曖昧な要件文を・どの仕様候補に・
どの確信度で対応づけるかという **現場判断の自動化** = ドメイン知が凝縮される場所。これは
bin-picking の判定エンジンと同じ「コア」の系列であり、`core/` (レイヤ B) が受け持つ。

この ADR は、その切り出された責務を `core/` が受け持つための **設計方針と seam (接合面) を
固定する**申し送り。実装当初は方針・seam のみを確定し、本物の embeddings / 外部サービス実装
は ADR-056 の出力形が固まってから着手する順序を取った (Layout DSL の厳密形を DSL 正本に
委ねた ADR-075 §adapter の規律と同じ)。

## Decision (確定済みの高レベル方針)

### 1. 責務 (propose のみ。decide しない)

- recommendation lane は曖昧な対応づけを embeddings / 外部サービスで **propose / rank** する
  だけ。**等価性を decide しない**。
- 等価性を *決める* のは curated canonical form (決定論的・検査可能・DSL 契約側の器)。
  lane は等価性の *候補を提案する* だけ。
- この **動詞の違い (decide=DSL 契約 / propose=recommendation lane) が境界そのもの**。
  grasp-contract の wire-schema (公開された契約) と判定エンジンの分離、および
  ADR-053 の測定器/検証 seam (副作用層が operand を出し、純粋層は決めるだけ) と
  構造的に同型。

### 2. seam (接合面) = 入力と出力の境界

- **入力**: public の決定論的出力 (canonical signature / structural diff / reconcile
  correspondence) + 要件文 / 参照候補。lane はこれらを **消費する** だけで、canonical form
  そのものを再定義・拡張しない (拡張は public ADR-056 側で行う)。
- **出力**: 等価性 *候補* のランキング。各候補は similarity (0-1) / structural distance
  (0-1) / confidence / evidence を持つ。**決して真偽値 (等価か否か) を返さない**。
  真偽値を返した瞬間に lane が decide 側に踏み込み、壁が溶ける。

### 3. 設計規律 (ADR-075 踏襲)

- **純粋部** (構造 diff の整形・候補ランキング・絶対基準 0-1 正規化) と **副作用部**
  (embeddings / 外部サービス呼び出し) を分離する。
- 外部依存は **Protocol 注入** (engine の `IkSolver` / `CollisionChecker` と同形)。
  本物の embedding service / similarity model は Protocol の差し替えで対応し、純粋コアは
  Protocol にしか依存しない。
- 各指標は **絶対基準で 0-1 正規化** してから扱う。その回の候補集合に依存する相対正規化は
  禁止 (テンプレ間比較可能性 = 商品価値。ADR-075 §3 と同じ規律)。

### 4. 置き場所 (実装は後続)

- `core/easy_extrude_core/recommendation/` を `engine/` と並置する。pure 部 / Protocol /
  orchestration の分割は `engine/` (candidates / feasibility / objectives / scoring /
  pipeline) を手本にする。
- HTTP で公開する場合も api 層 (ADR-076) の作法を踏襲: `contractVersion` ガードは
  エンドポイント層、エラーは共通 envelope (`api/errors.py`)、外部サービスは DI で注入、
  外部認証 (内部トークン) の背後に隠す。

### 5. 不変条件 (壁の番人)

- **「DSL 契約側が equivalence を decide / lane は propose のみ」**。
- lane が等価性を決め始めた瞬間に recommendation lane の知能が契約側の判定を侵食し、壁が溶ける。
  `never decides equivalence inside the core` をこの境界の番人として固定する
  (この文言は `CLAUDE.md` にも同一表現で置く)。

## 実装状況

ADR-056 の確定を待たず、その wire 形に依存しない範囲で **propose-only の純粋コア**を
実装した。DSL 契約側から来る決定論的出力は **不透明値 (opaque)** として消費し、wire 形は
一切固定していない (ADR-075 §adapter の規律維持)。

実装 (`core/easy_extrude_core/recommendation/`, engine と並置・同形):
- `types.py`: 入力 (RequirementQuery / ReferenceCandidate / CanonicalSignature /
  StructuralDiff = public 出力の不透明な消費物) と出力 (EquivalenceProposal /
  ProposalEvidence)。**出力に真偽値フィールドを持たせない**ことで §5 不変条件を型で担保。
- `similarity.py`: similarity model の Protocol 注入境界 + 外部依存ゼロの naive 既定
  (token Jaccard, 決定論的)。本物の embeddings は Protocol 差し替えで載る (engine の
  IkSolver / CollisionChecker と同形)。
- `normalization.py`: 絶対基準 NormSpec で生信号を 0-1 化 (相対正規化は禁止)。public が
  構造距離を出していない場合は保守的に最遠 + 裏付けなしとして扱う (decide しない)。
- `ranking.py`: 等価性候補の組み立て + 決定論的ランキング (純粋, propose のみ)。
- `lane.py`: orchestration (副作用境界)。ドメイン `propose` と、契約 wire を入出力する
  `recommend` (RecommendationRequest -> RecommendationResponse) の adapter。注入 model
  呼び出しはここだけ。

HTTP 境界 + 契約配線 (ADR-076 / ADR-074 踏襲):
- `contract/recommendation_models.py`: BFF <-> コアAPI の wire 契約 (現状の正本)。
  canonical signature は不透明文字列、structural distance は DSL 契約側が decide した 0-1 を
  消費 (再計算しない)。出力 wire にも **真偽値フィールドを置かない** (§5 を wire 境界まで貫く)。
- `api/app.py`: `POST /recommendation` を追加。grasp-search と同じ作法 (contractVersion
  検証 -> 400 / 形違い -> 422 / 内部トークン認証 -> 401 / threadpool + 実行時間ガード /
  共通エラー envelope)。similarity model は DI で注入 (省略時 naive 既定)。
- テスト: `test_recommendation.py` (純粋コア 14) / `test_recommendation_contract.py`
  (wire round-trip + opaque 消費 + 真偽値なし 6) / `test_recommendation_api.py`
  (HTTP 往復 + エラー約束 + 認証 + DI 7)。全 64 件 green。

判断: 入力 wire は当面 **契約 (vendor-contract) を信頼の境界**とし、ADR-056 の実装完了を
待たずに配線した。canonical form / structural diff の **内部表現は不透明に消費**する
ため、ADR-056 の形が後で変わっても contractVersion を上げるだけで吸収できる
(decide 側の壁は溶けない)。

## Still deferred (引き続き後で実装する)

- 本物の embeddings / 外部サービスを使う similarity 実装 — Protocol 差し替えで対応
  (seam と naive 既定と DI 配線は実装済み。実 model を差し込むだけ)。
- vendor-contract への recommendation wire スキーマ (中立 JSON Schema) の追加と、grasp と
  同様の conformance テスト (現状は pydantic 正本のみ)。
- ランキング各指標の NormSpec 基準値 (絶対基準) の確定 — 現状は素朴な暫定値
  (`METRIC_SPECS` / `DEFAULT_SIMILARITY_WEIGHTS`)。本物のモデルのスコア分布に合わせて調整。

## Consequences

- ADR-056 は canonical form / diff / reconcile / curated dictionary = 器 = 契約として
  DSL 側に留まる。`core/` に置くのは、その上に乗る「曖昧な対応づけを embeddings / 外部知で
  提案・ランキングする層」の **実装だけ**。
- ADR-056 には seam の存在 (「a layer sits on top, consumes these outputs」) まで書いて
  よいが、その中身は ADR-056 側では扱わない。
- 今回の core/lane 分離は、grasp-contract の wire-schema / 判定エンジン分離、および
  ADR-053 の測定器/検証 seam と **同じ原則の再来**。設計の一貫性として相互参照する。
- 実装に入る後続セッションは本 ADR の Decision (propose のみ・seam・pure/副作用分離・絶対正規化・
  Protocol 注入) を起点に、ADR-056 の確定した出力形を入力として配線する。
