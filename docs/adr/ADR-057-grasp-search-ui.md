# 057. Grasp Search UI — 右ドックの宣言/検証パネル（スコア優先・ゴーストは後続）

- Status: Accepted (実装済)
- Date: 2026-06-30
- Deciders: yuubae215, Claude
- Supersedes / Superseded by: なし
- Implementation: 新設 `src/controller/GraspController.js`（uiStore 注入）+ `src/controller/GraspController.test.js`（11 件）。`context.grasp` を判別共用体化（`uiStore.js`、`contextSetGrasp` 丸ごと置換・`graspPanelOpen`/`setGraspPanelOpen` 削除）。`GraspSearchPanel.jsx` を中央モーダル→`ContextLayer` の `'grasp'` タブへ（`objectiveScores` バー + クライアントソート + `selectedRank` ハイライト）。`ContextController` から grasp ロジック撤去、`AppController._graspCtrl`、Header `onOpenGrasp`、UIShell standalone 撤去。`test:context` 300/300・`tsc --noEmit`・`vite build` クリーン。契約・BFF・ドメイン無改変。
- References: ADR-054（UI→DSL→BFF→grasp walkthrough）, ADR-050（Context-first / 持続オーバーレイ）, ADR-047（オーバーレイは setMode ではない / ゴースト系譜）, ADR-053（ロボティクス測定器・幾何は deferred）, ADR-049（KPI/score）, ADR-052（Why）, ADR-055（scene⇄DSL は Context フロー非配線）, ADR-059（後続: 候補→空間ゴースト、deferred した G3）

## Context — Goal と力学（§1.2 Goal）

ユーザ要件は「grasp-search をフロント UI から実行する画面」という **解の形**で来た。
§1.2 に従い達成したい *性質* へ持ち上げると、Goal は二つ:

- **G1（検証の可読化）**: ADR-054 が確立した正規スレッド
  `UI → 正準 Layout DSL → BFF.compileLayout（往復検証）→ BFF.graspSearch（上流委譲）`
  を、ユーザが *操れて・どこで失敗したか分かる* 形で提示する。
- **G2（順位の説明可能性）**: 返ってきた候補が *なぜその順位か* を、契約が既に持つ
  `score.objectiveScores`（objective 名→0–1 正規化、リクエスト横断で比較可能）で説明する。

派生 Goal として **G3（空間価値: 候補→3D 姿勢）** があるが、これは下記「力学」により
**依存ブロック**されており、本 ADR の射程外（後続 ADR で扱う）。

**力学・制約（このリポジトリ特有の前提）**:

1. **スコープ境界（解かない層）**: UI は *宣言と表示* のみ。IK/干渉/リーチ/ランキングは
   外部 grasp-search サービスの責務（CLAUDE.md スコープ境界）。UI は契約 I/O の
   *外側*にいる黒箱消費者（§1.3 黒箱/契約）。
2. **契約は上流所有（§1.1 真実の源は一つ）**: request/response の正本は
   `@easy-extrude/grasp-contract`（JSON Schema）。BFF も UI も *導出*するだけで定義しない。
3. **`pose` は契約境界で opaque**: response schema の `poseCandidate.pose` は
   `additionalProperties:true`・"exact shape owned by the service implementation"。
   **直交 TCP 姿勢が入る保証がない。** したがって UI が候補を 3D ゴーストとして
   *確実に* 置く材料は契約にない（§1.3: 黒箱の内側へ手を伸ばさない）。
4. **ロボット幾何は ADR-053 で deferred**: フルロボットゴーストには urdf-loader 等の
   実リンク幾何が要るが未導入。よって G3 はこの二点（契約の姿勢保証 + 幾何）に
   依存し、今は払えない。
5. **正準 Layout DSL の唯一の抽出点**: `ContextService.getCompiled()?.layoutDsl`
   （ADR-054）。シーン逆コンパイル（ADR-055）は Context フローに *非配線* のまま
   （正準2重化回避）。
6. **クエリであってドキュメント変異ではない**: grasp 検索はジオメトリ不変ゆえ
   CommandStack を通さない（ADR-054 既定）。
7. **右エッジは共有資源（PHILOSOPHY #26）**: N-panel + Context Inspector が既に
   右 280px 列を取り合う。新パネルは占有を *調停*しなければ黙って重なる。

**グラフ上の位置（blast radius の見積り, §1.3）**: フロントのオーバーレイ層。
消費ノード = `getCompiled().layoutDsl`（ADR-054）, `BffClient.compileLayout/graspSearch`
（ADR-054、無改変）, `context.grasp` uiStore スライス。**契約・BFF・ドメインは無改変。**

## Options considered

**配置（パネルをどこに置くか）**
- A: 中央モーダル（現状 `GraspSearchPanel.jsx`）— tradeoff: 最小実装だがキャンバスを覆い、
  将来の空間表示と接続しづらい。
- **B: 右ドック（Inspector 列にタブ同居）** — tradeoff: キャンバスが見えたまま、既存の
  Inspector タブ様式を再利用。右エッジ占有は増えるが #26 のオフセット機構で調停可能。
- C: ボトム結果トレイ — tradeoff: 右エッジと無衝突だが新しいレイアウト土台が要り、
  既存 Inspector 様式と二系統になる。

**空間フィードバック（候補→3D）の射程**
- D: フルロボットゴースト — tradeoff: 価値最大だが力学#3/#4 により外部依存（上流契約 +
  ADR-053 幾何）が前提で重い。
- E: 防御的 TCP ゴースト（opaque pose に直交値があれば置く）— tradeoff: 価値を早く出すが
  *未規定フィールドを読む* = §1.3 黒箱規律にやや反し、上流が pose 形を変えると黙って壊れる。
- **F: スコア優先・ゴーストは後続 ADR** — tradeoff: 空間価値を今は出さないが、契約規律が
  最も純粋（opaque に触れない）で完全 in-scope・即出荷可能。

**インタラクションモデル**
- G: `setMode()` FSM 状態として実装 — tradeoff: orbit/select/grab を殺す。検索中も
  シーンを触りたいので不適（ADR-047 §2.1）。
- **H: 持続オーバーレイ + 専用 `GraspController`**（`ContextController`/`MapModeController`
  と並列）— tradeoff: 前例どおり。下のレイヤ（orbit/select）が生きたまま。

## Decision — Strategy（§1.2 Strategy）

**B + F + H** を採る。すなわち:

1. **`GraspController`（持続オーバーレイ, §H）**: `ContextController` と並列の専用
   コーディネータ。`getCompiled().layoutDsl` を消費し、`context.grasp` スライスのみ
   読み書きする。リクエストは **クエリ**ゆえ CommandStack 非経由。`setMode()` 状態では
   ない（下層の orbit/select/grab は生きる）。現状 `ContextController.runGraspSearch`
   にある grasp ロジックをこの専用コーディネータへ移す（単一責任 / §1.1）。

2. **配置 = 本番 `ContextLayer` の新タブ `'grasp'`（§B）**: `GraspSearchPanel` を中央
   モーダルから、本番 Context オーバーレイ `ContextLayer`（context スライス、desktop で
   既に `right:0 width:280px`）の **negotiate モード内タブ**へ移す。grasp はこの既存 280px
   ドックに **相乗り**するので、**新たなエッジ占有も新しい `_updateGizmoOffset` 項も
   発生しない**（#26 を *増やさない* のが相乗りの肝）。エントリは Context ▾/⋯ の
   モーダル起動ではなく **タブ選択**（負担と状態が一つ減る — §1.1）。これに伴い
   top-level モーダルフラグ `graspPanelOpen` は **廃止**し、エントリの権威を
   `context.inspectorTab === 'grasp'` 一点へ寄せる。

   *観測（スコープ外として明示）*: 現状の `_updateGizmoOffset()` は `demo.inspectorTab`
   と `nPanelVisible` のみを勘定し、本番 `ContextLayer` の 280px を勘定していない（既存の
   潜在 #26 ギャップ）。grasp タブはその `ContextLayer` の挙動を *継承するだけ* なので
   本 ADR はこのギャップを **変えず触れない**（別件・別 ADR）。

3. **状態機械を *クラスより先に*（§1.4）**: grasp リクエストは 3 状態以上を持ち、
   不正遷移（compile 成功前に solve、結果を error 状態で描画）が事故になるので、
   状態を論理設計してから実装する。**不正状態を表現不能に**するため、`context.grasp` を
   緩いフィールドの寄せ集めから **判別共用体（discriminated union on `status`）** へ
   締める（下記 §State machine）。

4. **スコア優先描画（§F）**: 契約が既に持つ `score.objectiveScores`（$defs.scoreBreakdown）
   を objective 別の比較バーとして出し、候補を totalScore / 各 objective で **ソート可能**に。
   3 ブール（withinReach/ikSolvable/interferenceFree）+ totalScore は維持。
   **opaque な `pose` には手を伸ばさない**（§1.3）。

5. **ゴーストは後続 ADR へ明示分離**: G3 は本 ADR の Non-goal。後続（仮 ADR-058
   「Grasp 候補の空間ゴースト」）の **前提条件を名指し**で残す:
   (a) 上流契約 `@easy-extrude/grasp-contract` に *optional な直交 TCP 姿勢*を追加し
   `contractVersion` を上げる（上流で行う。本リポジトリでは定義しない — §1.1）、
   (b) ADR-053 のロボット幾何（urdf-loader/実メッシュ）。両者が揃うまで UI は
   候補を空間化しない（§5 証拠なき完了禁止: 払えない依存を「できる」と書かない）。
   FSM には将来のフック用に `selectedRank` の席だけ先に用意する（§State machine）。

**変える/新設する契約**: なし（契約 = 上流所有、BFF = 無改変）。新設は **フロント内部の
UI 状態契約** のみ = `context.grasp` の判別共用体形。

## State machine（§1.4 — クラスより先に）

実体 = **1 回の grasp リクエストのライフサイクル**。様態は *逐次フロー*（declare→compile→
solve→render）なので **BPMN 的 = 線形 FSM**（事象駆動の CMMN ではない, §1.3 様態）。

状態集合（`status` で判別、各状態が持てるデータも固定）:

| status | 意味 | 保持データ |
|---|---|---|
| `idle` | 未実行（パネル開・レイアウト既知） | layout |
| `no-layout` | 導出ガード: `layoutDsl` 不在/空（blank・requirements-only doc） | — |
| `compiling` | BFF 往復 compile 実行中 | layout |
| `solving` | compile 成功後、grasp 検索実行中 | layout, request |
| `results` | 候補返却（空配列 = 実行可能解なし も正当） | layout, request, candidates, selectedRank\|null |
| `error` | 失敗 | stage('compile'\|'solve'\|'bff'), httpStatus, message, details |

遷移と guard:

- `idle`/`results`/`error` --**Run**--> `compiling`  （guard: `layoutDsl` 非空。空なら `no-layout` で Run 不可）
- `compiling` --ok--> `solving`  /  --fail--> `error{stage:'compile'}`
- `solving` --ok--> `results`  /  --fail--> `error{stage:'solve'}`
- いずれの BFF 不通も --> `error{stage:'bff'}`（503/ネットワーク）
- `results` --**selectCandidate(rank)**--> `results{selectedRank:rank}`（将来のゴーストフック席）
- 任意 --close / `contextEnd`--> reset（`idle` か `no-layout`）

禁止遷移: compile 成功を経ない `solving`; `compiling`/`solving` 中の Run（Run は disabled）;
`results` 以外での候補描画。

不正状態を表現不能に（判別共用体）— 「error なのに candidates を持つ」「solving なのに
results を描画」を型で禁止する:

```ts
type GraspState =
  | { status: 'idle';      layout: LayoutMeta }
  | { status: 'no-layout' }
  | { status: 'compiling'; layout: LayoutMeta }
  | { status: 'solving';   layout: LayoutMeta; request: GraspRequest }
  | { status: 'results';   layout: LayoutMeta; request: GraspRequest;
                           candidates: PoseCandidate[]; selectedRank: number | null }
  | { status: 'error';     stage: 'compile'|'solve'|'bff';
                           httpStatus: number | null; message: string; details: string[] }
```

補助型は **契約から導出**する（再定義しない — §1.1 / `contract.response.d.ts`）:

```ts
// LayoutMeta: パネルが既に出している軽量メタ（getCompiled().layoutDsl から）
type LayoutMeta = { version: string; entities: number }

// GraspRequest: contract request の UI が組む部分（contractVersion は BFF が stamp）
type GraspRequest = { layoutVersion: string;
                      graspSearch: { objectiveWeights: Record<string, number>; topN: number } }

// PoseCandidate / score: contract response $defs をそのまま（pose は opaque = 触れない）
type PoseCandidate = { rank: number; pose?: unknown; score: ScoreBreakdown }
type ScoreBreakdown = { withinReach: boolean; ikSolvable: boolean; interferenceFree: boolean;
                        objectiveScores?: Record<string, number>; totalScore: number }
```

これは現状の緩い `{ status:string, candidates?, error?, … }` スライスを締めるだけで、
権威は一箇所（`GraspController` が遷移を起こし、パネルは読むだけ — §1.1 / PHILOSOPHY #5）。
`pose: unknown` が「opaque に手を伸ばさない」を *型で* 強制する（§1.3）。

## Rendering — スコア優先（§F の具体）

候補カードは契約 `ScoreBreakdown` だけで構成し、`pose` は解釈しない:

- **ブール 3 チップ**: `withinReach` / `ikSolvable` / `interferenceFree`（現状維持）。
- **objective バー**: `objectiveScores`（objective 名→0..1、*absolute basis でリクエスト
  横断比較可能* と契約が明記）を **ラベル付き横バー**で。キーは動的
  （`additionalProperties`）で、リクエストの `objectiveWeights` キーと対応する（契約注記）。
  `objectiveScores` 不在の候補（旧サービス）はバーを出さず totalScore のみ（degrade、
  §1.3 黒箱: 無い物を描かない）。
- **ソート**: 既定 `totalScore` 降順。objective ラベルのクリックでその objective 降順へ。
  *クライアント側の並べ替えのみ*（再 Run しない — クエリ不変）。
- **pose**: opaque ゆえ 3D 化しない。`pose.joints` 等があれば *生テキストの参考表示* に留め、
  「空間表示は後続 ADR」を一文明示（PHILOSOPHY #11: 黙って出さない・誇張しない）。
- **selectCandidate(rank)**: 行ハイライトのみ（`selectedRank`）。これが後続ゴーストの
  *接続席*で、本 ADR では 3D 副作用を持たない。

## Consequences — Evidence と tradeoff（§1.2 Evidence）

**肯定的**:
- 検証スレッドが「declare→compile→solve」の進行として読め、どの境界（400/502/503）で
  落ちたかが分かる（G1）。
- `objectiveScores` で候補の順位理由が比較できる（G2）。契約に既存・3D 不要・完全 in-scope。
- キャンバスが見えたまま（右ドック）。将来ゴーストを足してもシーンが残る。
- 契約規律が純粋: opaque pose に触れず、契約・BFF・ドメイン無改変。即出荷可能。

**受け入れるコスト / 否定的**:
- 空間フィードバック（最も価値の高い G3）は今出ない。後続 ADR + 外部依存に先送り。
- 新パネルは増えないが、negotiate のタブ行が既に 6 個あり、`'grasp'` で 7 個に増える
  （タブの過密。将来オーバーフロー処理が要るかは別途）。grasp は negotiate モード前提
  （= Context ロード済み）に縛られる — 単独起動はできない（v1 の意図的制約）。
- `ContextController.runGraspSearch` の `GraspController` への移設は局所リファクタを伴う
  （振る舞い不変・テストで担保）。

**検証（証拠 — 主張ではなく）**:
- 契約境界は既に証明済み: `pnpm test:contract` **12/12 pass**（本セッションで実行確認）。
  request/response 実インスタンス vs schema + contractVersion 一致 + 400/502 端到端。
- `objectiveScores` の存在は契約スキーマで確認:
  `grasp-search-response.schema.json` `$defs.scoreBreakdown.objectiveScores`
  （objective 名→0..1）。パネルが未使用なのも確認済（`GraspSearchPanel.jsx` は
  3 ブール + totalScore のみ描画）。
- FSM は検証可能成果物: `GraspController` の遷移を fake `BffClient` で単体テスト
  （`ContextService.test.js` 同様 THREE-free）。パネルは presentational。
- **未充足（正直に明示, §5）**: G3 ゴーストの証拠は無い（依存未充足）。よって本 ADR は
  G3 を *約束しない*。本体（B+F+H）が採択されれば Accepted、G3 は別 ADR で Proposed 起票。

**波及（blast radius）**:
- 新規 `src/controller/GraspController.js`（`runGraspSearch`/`openGrasp`/`selectCandidate`/
  `_graspError` を `ContextController` から移設）。
- `src/components/Grasp/GraspSearchPanel.jsx`（中央モーダル → `ContextLayer` の `'grasp'`
  タブとして描画、`objectiveScores` バー + クライアントソート追加）。`ContextLayer` の
  negotiate タブ配列に `{ id:'grasp', label:'Grasp' }` を追加（`layoutDsl` 導出可能時のみ）。
- `uiStore`: `context.grasp` を判別共用体へ; `context.inspectorTab` 共用体に `'grasp'` 追加;
  top-level `graspPanelOpen` と `setGraspPanelOpen` を **廃止**（エントリ＝タブ選択へ一本化）。
- **`_updateGizmoOffset` は無改変**（grasp は `ContextLayer` の既存 280px に相乗り、新占有なし）。
  Header の Grasp エントリ（Context ▾/⋯）は `openGrasp()`＝negotiate + `setTab('grasp')` に差し替え。
- `AppController`: grasp ロジックの委譲先を `ContextController` から `GraspController` へ。
- Docs: README index, CLAUDE.md ナビ/履歴, CODE_CONTRACTS（GraspController 行 + grasp
  state machine 行 + `graspPanelOpen` 廃止）, SCREEN_DESIGN, LAYOUT_DESIGN, EVENTS,
  STATE_TRANSITIONS（FSM）。ADR-054 の References に本 ADR を相互リンク（実施済）。

## Lens notes

- **§1.3 黒箱/契約**: grasp-search は契約 I/O だけで特性化する黒箱。`pose` が opaque な以上、
  契約が保証しない値を読んで可視化しないのが規律 — これが「スコア優先」の直接の根拠。
- **§1.4 状態機械**: 実体（1 リクエスト）が 3 状態以上 & 不正遷移が事故 → クラスより先に
  状態設計。判別共用体で不正状態を表現不能化。
- **§1.1 真実の源は一つ**: 契約は上流、正準 DSL は `getCompiled().layoutDsl` 一点
  （scene 逆コンパイルは Context 非配線 — ADR-055）。状態権威は `GraspController` 一点。
- **様態（BPMN vs CMMN）**: リクエストスレッドは決め打ちの逐次フロー = BPMN → 線形 FSM。
  事象駆動の裁量処理（CMMN）ではないので分岐状態機械にしない（§5 過剰モデリング禁止）。
- **§1.2 Goal と解の分離**: 「実行画面」→ G1 可読化 / G2 説明可能性 / G3 空間価値 へ分解し、
  G3 を依存ごと切り出したことで本体が安く・純粋になった。
