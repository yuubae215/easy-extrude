# ADR-054 — Grasp-Search BFF 委譲と UI 配線: 契約導出デリゲータ ＋ 内部トークン transport ＋ UI 接続計画

**Status**: Accepted (BFF 委譲 + 内部トークン transport 実装済 / UI 配線は Proposed)
**Date**: 2026-06-22
**Related**: ADR-015 (BFF + Microservices), ADR-017 (WebSocket / Geometry Service), ADR-045 (Layout DSL / compileLayout), ADR-049 (Requirement/Conflict — within_reach/no_collision の参照名), ADR-053 (Robotics KPI Methods — 測定器/ComputeBackend), `@easy-extrude/grasp-contract` (neutral JSON Schema 契約パッケージ)

**Implementation**:
- **実装済** = BFF `POST /api/grasp/search`（`server/src/routes/grasp.js`）が neutral 契約から導出した検証で両端ドリフトを守り、外部 grasp-search service へ委譲（`server/src/grasp/{contract.js,graspClient.js}`）。`callGraspSearch` は外部サービスの**内部仕様**である `X-Internal-Token` ヘッダを env `GRASP_SEARCH_TOKEN` 設定時のみ付与（値は env のみ・未設定なら無送信＝後方互換）。実機 FastAPI grasp-search に対し 503(未到達)→401(到達・token無)→200(token有・upstream 認証ON) のウォークスルー確認済。`pnpm test:contract` 12/12。
- **Proposed（後続）** = フロントエンド UI から BFF `/api/grasp/search` までのテスト配線（§4）。

---

## 1. Context — このリポジトリは「宣言」、解法は外部サービス

CLAUDE.md「スコープ境界」のとおり、本リポジトリは Layout DSL の**宣言とスキーマ**を
持ち、制約の**解法 (solving)** は持たない。`graspSearch` 宣言（`within_reach` /
`no_collision` / `ik_solvable` などの参照名と objectives/weights）を投げると、IK・干渉・
リーチ・ランキングを**外部 grasp-search service** が解いて、Top-N の姿勢候補とスコア内訳を
返す。BFF はその境界で「契約に忠実な検証付きデリゲータ」として振る舞う。

契約（BFF ⇔ 外部サービスの I/O）の正本は neutral JSON Schema パッケージ
`@easy-extrude/grasp-contract`（submodule `vendor/grasp-contract`、`workspace:*`）にある。
BFF は Schema から型と ajv バリデータを**導出**するだけで、契約を**定義/拡張しない**。

## 2. Decision — 検証付きデリゲータ（実装済）

`POST /api/grasp/search` は次を強制する（`server/src/routes/grasp.js`）:

1. **inbound version 境界** — `contractVersion` が present かつ不一致 → **400**（absent は許容、BFF が outbound でスタンプ）。
2. **inbound schema 適合** — neutral request schema 非適合 → **400**。
3. **委譲** — canonical `CONTRACT_VERSION` を outbound にスタンプし `callGraspSearch` で `GRASP_SEARCH_URL`（既定 `localhost:4001/grasp-search`）へ転送。
4. **outbound version 境界** — upstream の `contractVersion` 不一致 → **502**。
5. **outbound schema 適合** — upstream 応答が契約違反 → **502**（黙って通さない、PHILOSOPHY #11）。
6. **到達不能/タイムアウト** → **503**。

`contract.js` は `contract-version.json` とスキーマ JSON を package から読むだけ
（`CONTRACT_VERSION` をハードコードしない）。`graspClient.js` は wire の往復のみで
解法ロジックを持たない。`server/test/grasp.contract.test.js`（`pnpm test:contract`）が
code-vs-contract と instance-vs-contract のドリフトを検出する。

### 2.1 内部トークン transport（本セッション実装）

外部 grasp-search service はその `/grasp-search` を **BFF 専用**とし、内部トークンで
ゲートする（外部サービスの private spec）。これに合わせ `callGraspSearch` は:

- env `GRASP_SEARCH_TOKEN` が**設定されている時のみ** `X-Internal-Token` ヘッダを付与。
- 値は **env からのみ**読み、コードに焼かない。
- 未設定なら従来どおりヘッダを送らない（**後方互換**、既存スタブ/テストは無改変で通る）。

**なぜ `contract.js` でなく `graspClient.js` か**: トークンは neutral 契約の一部では
なく、ランキングの解法でもない。「外部サービスの内部仕様 = wire transport の認証」で
あるため、契約導出層ではなく転送クライアントに置く。BFF は外部サービスが信頼する
唯一の呼び出し元として振る舞い、認証情報は env 注入のみで扱う（秘密値を成果物・ログ・
チャットに残さない）。

ウォークスルーで切り分けの遷移を実機確認:
`503`（BFF が 8000 を向いていない）→ `401`（到達したがトークン無し）→
`200`（`GRASP_SEARCH_TOKEN` 注入・upstream 認証 ON、`{"contractVersion":1,"candidates":[]}`）。

## 3. スコープ境界（再確認）

- IK / 干渉 / リーチ / wrench cone / 把持安定性スコア / ランキングの**解き方**はここに書かない（外部サービスの責務）。
- 契約変更は Schema 側で行い `contractVersion` を上げる。BFF・UI はそこから導出するのみ。
- 内部トークンは外部サービスの仕様に追従するだけで、本リポジトリは認証方式を**定義しない**。

## 4. UI 配線計画（Proposed — 次フェーズ）

目的: エディタ UI から「現在のレイアウト宣言で grasp-search を実行 → Top-N 候補を
受け取り、シーン上で可視化/比較できる」までを、既存の MVC・サービス・イベント規約に
沿って配線する。解法には踏み込まない（候補の表示と選択のみ）。

### 4.1 データパイプライン（API レイヤー責務 = 整形とパイプライン構築のみ）

```
Layout DSL (現在のシーン/宣言)
  → graspSearch 宣言の抽出（layoutVersion + objectives/weights/topN）
  → BffClient.graspSearch(request)         // fetch POST /api/grasp/search
  → 契約応答 {candidates:[{rank,pose,score}]}
  → GraspResultView（Top-N をシーンにゴースト表示 / パネルにスコア内訳）
```

- **フロント `BffClient`**（新規・薄い fetch ラッパ、`src/service/` 配下想定）: `/api/grasp/search` を叩き、`contractVersion` を request に載せ、HTTP ステータス（400/502/503）を UI 向けエラーに整形する。型は committed `.d.ts`（`contract.request/response`）から import して**契約から導出**（UI でも契約を再定義しない）。
- **request 整形**: 現在のシーン/Context から `graspSearch` 宣言を取り出す純関数（`src/layout/` か `src/context/` の既存コンパイル結果を再利用、新たな解法ロジックは持たない）。
- **応答の可視化**: `candidates[].pose` は契約上 opaque。表示は ADR-047/053 のゴースト系譜（読み取り専用の出力射影）に倣い、`pose` を最小限デコードして候補姿勢ゴースト＋スコア内訳パネル（`withinReach`/`ikSolvable`/`interferenceFree`/`totalScore`）を出す。選択した候補のみを strong 表示。

### 4.2 状態・イベント・並行性

- **副作用境界**: ネットワーク I/O は service 層（`BffClient` + コーディネータ）に閉じる。純粋な request 整形は分離（PHILOSOPHY #3）。
- **並行戦略**: grasp-search は consistency-critical な一括処理＝**pessimistic**（`isProcessing` + スピナー、二重発火防止、PHILOSOPHY #7）。orbit/select は生かす（オーバーレイ方式、ADR-047/050 の持続オーバーレイに倣う）。
- **イベント**: 結果到着で domain event（例 `graspResult`）を emit し、View は購読で反応（参照を持たない、PHILOSOPHY #5）。
- **エラー UX**: 400/502/503 を**黙って捨てない**（PHILOSOPHY #11）。版ずれ(400/502)・未到達(503)・認証(401, upstream 仕様)を区別したトーストにする。

### 4.3 設定（env）

- フロント → BFF の base URL は dev/prod で切替（既存パターン踏襲）。
- BFF → 外部サービスは `GRASP_SEARCH_URL` と（認証 ON 環境では）`GRASP_SEARCH_TOKEN` を env で設定（§2.1）。UI には秘密を持たせない。

### 4.4 テスト配線

- `BffClient` 単体: スタブ BFF（または MSW 相当）で 200/400/502/503 を網羅。契約 `.d.ts` 由来の型で request/response を固定。
- request 整形の純関数テスト（THREE-free）。
- end-to-end ウォークスルー（手動 or スクリプト）: UI → BFF → スタブ upstream の 200 経路を 1 本通す（本 ADR の §2.1 と同じ切り分けを UI 起点で再現）。

### 4.5 非ゴール（このフェーズ）

- 候補姿勢の再ランキング/再計算（外部サービス責務）。
- `pose` の完全な運動学的再構築（最小デコードのみ）。ADR-053 の測定器/ComputeBackend との統合は別系統で、本 ADR は grasp-search 委譲の UI 露出に限定。

## 5. Consequences

- 良い: 契約の単一正本を UI まで一貫させ、版ずれ/未到達/認証を境界で明示的に扱える。秘密値は env のみで、リポジトリ・ログに残らない。
- 注意: 外部サービスの private spec（トークン名/方式）が変わると `graspClient.js` の追従が要る（契約 schema ではないのでバージョン番号では守られない）。env 名・ヘッダ名は本 ADR と CODE_CONTRACTS に記録して齟齬を防ぐ。
