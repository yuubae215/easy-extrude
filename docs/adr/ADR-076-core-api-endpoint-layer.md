# ADR-076: コアAPI エンドポイント層 (HTTP 境界) の設計方針

- Status: Accepted (高レベル方針 + 詳細設計を確定し、素朴版を実装)
- Date: 2026-06-21 (Proposed) / 2026-06-21 詳細設計確定 + 実装
- 関連: ADR-074 (BFF <-> コアAPI 契約) / ADR-075 (段階0 判定エンジン) /
  実装 `core/easy_extrude_core/api/`

## Context

ADR-075 で段階0 判定エンジン (`core/easy_extrude_core/engine/`) を実装した。これは純粋な
計算 = `search(GraspSearchRequest) -> GraspSearchResponse` であり、**ネットワーク越しに
呼べる口 (HTTP エンドポイント) がまだ無い**。

目指す経路は:

```
フロント  ->  BFF (薄い窓口)  ->  コアAPI (判定の実装)
```

この経路を成立させるには、純粋エンジンを「BFF が呼べる外部サービス」に変える **HTTP 境界**
が要る。本 ADR はその境界 (= コアAPI エンドポイント層) の設計方針を確定する。

なお BFF 側の配線は本 ADR の対象外。契約パッケージの中立化 (移設 -> 確認 -> 配線) を
先に済ませる順序制約があり、本 ADR はコアAPI 側で先に「呼ばれる側」を用意するところまで。

## Decision (確定済みの高レベル方針)

### 1. 責務 (薄い境界に徹する)

- エンドポイント層は **データ整形とパイプライン構築のみ** (グローバル CLAUDE.md / 単一責任)。
  - 入力 (wire JSON) を契約型 `GraspSearchRequest` に写す。
  - `engine.search` を呼ぶ。
  - 結果 `GraspSearchResponse` を wire 形 (camelCase) にして返す。
- **判定ロジックは一切持たない** (IK / 干渉 / リーチ / 安定性の実装は engine に閉じる)。
  境界に計算を書き始めない (責務のにじみ防止)。

### 2. contractVersion ガードの位置 = ここ (ADR-074/002 の確定事項の実装)

- 受信した `contractVersion` を `contract.check_contract_version` で検証し、不一致なら
  **400 で即拒否**する。これは ADR-074 §4 と ADR-075 §4 が「エンジンの外、エンドポイント層の
  責務」と明記したものの実装。
- engine は検証済み宣言を受け取る純粋計算に徹する (ガードを engine に持ち込まない)。
- ADR-074 の「最初の 1 エンドポイントから contractVersion 検証を入れる (後でセキュアに、は
  手遅れ)」を、最初のエンドポイントで満たす。

### 3. 入出力とエラーの約束 (契約の 4 つ目 = エラー約束を確定)

- **1 エンドポイント**: `POST /grasp-search` (素朴版は単一)。
- body = `GraspSearchRequest` (camelCase wire)。response = `GraspSearchResponse`
  (`model_dump(by_alias=True)` で camelCase)。
- エラーの約束:
  - `contractVersion` 不一致 -> **400** (`ContractVersionMismatch` を写す)。
  - リクエストが契約スキーマに合わない (pydantic 検証失敗) -> **422** (形が違う)。
  - engine 内部の想定外例外 -> **500**。
- ADR-074 は「BFF が知るのは 入力の形 / 出力の形 / contractVersion / エラーの約束 の 4 つ」
  と言う。本 ADR でその 4 つ目 (エラーの約束) を上記に確定する。

### 4. 隔離 (コアAPI は BFF の背後に置く)

- コアAPI は **BFF の背後に隠し、外から直接叩けないようにする**。フロントが直接叩く構成は禁止
  (ネットワークタブに URL / リクエスト形が露出 = 攻撃面の拡大)。
- 実現方式 (内部ネットワークのみ bind / BFF だけが持つ内部トークン要求) の具体は Open
  (ADR-074 Open「BFF だけが通れる内部認証の具体方式」を継続)。設計としては「BFF からしか
  呼ばれない前提」を置き、認証は差し込める形にしておく。

### 5. 依存性注入 (engine の注入境界を活かす)

- engine.search は IK ソルバ / 干渉チェッカを Protocol で注入できる (ADR-075)。エンドポイント
  層が naive 既定を渡す配線点になる。将来 実ソルバ / 外部サービスに差し替えるとき、変更は
  エンドポイント層の組み立てに閉じ、契約も engine の純粋コアも無変更でいられる。

### 6. レイヤ分離 (純粋 / 副作用)

- エンドポイント層は副作用 (HTTP I/O) を持つ。判定の純粋コアとは別ディレクトリに切る
  (`core/easy_extrude_core/api/`)。engine (純粋 + 注入境界) と api (HTTP 境界) を混ぜない。

## Decision (詳細設計, 本セッション確定)

高レベル方針を起点に Open の論点を詰め、素朴版を `core/easy_extrude_core/api/` に実装した。
各論点の確定内容と実装位置:

- **フレームワーク選定** (`api/app.py`): **FastAPI** を採用 (pydantic 既存依存と相性が良く、
  契約型 `GraspSearchRequest` をそのまま body 型に使える = 形違いは自動 422)。`core/pyproject.toml`
  の本体依存に `fastapi`、起動用 ASGI サーバ `uvicorn` は optional extra `serve` に分けた
  (実行時のみ必要)。アプリは `create_app(...)` factory で組む (テスト/DI 容易性)。
- **エラー応答 body の形** (`api/errors.py`): 全エラーを envelope
  `{"error": {"code", "message", expected?, received?}}` に統一。`code` は BFF が分岐に使う
  安定識別子 (`contract_version_mismatch` / `validation_error` / `unauthorized` /
  `payload_too_large` / `request_timeout` / `internal_error`)。contractVersion 不一致時のみ
  `expected` / `received` を載せ、片側だけ古いデプロイのズレを即特定可能にする (ADR-074 の狙い)。
  これで ADR-074 の「エラーの約束」(契約の 4 つ目) を具体化した。
- **contractVersion ガード位置** (`api/app.py` の `/grasp-search`): pydantic 検証通過後に
  `check_contract_version(payload.contract_version)` を呼び、不一致なら `ContractVersionMismatch`
  -> 400 (例外ハンドラで写す)。engine はガードを持たない純粋計算のまま (ADR-075 §4 / ADR-076 §2)。
- **エラー写像**: 400 (version 不一致) / 422 (`RequestValidationError` = 形違い) / 401
  (認証失敗) / 413 (body 上限超過) / 504 (実行時間超過) / 500 (想定外)。500/401 の message は
  中立に保ち内部詳細を漏らさない。
- **内部認証** (`api/app.py` `_default_authenticator` + `api/settings.py`): BFF だけが通れる
  内部トークンを `X-Internal-Token` ヘッダで受け、定数時間比較 (`hmac.compare_digest`) で照合。
  トークンは env (`GRASP_API_INTERNAL_TOKEN`) で注入し repo に焼かない。
  未設定 (dev) なら認証無効 + 起動時 warning。`authenticator` 差し替えも可能 (ADR-076 §4 の
  「差し込める形」)。**具体方式は共有シークレットの最小形**で、mTLS/JWT 等への強化は引き続き Open。
- **入力上限 / 実行時間ガード** (`api/settings.py` + `api/app.py`): リクエスト body は
  Content-Length での前段ガード (既定 1 MB 超で 413)。探索は `run_in_threadpool` +
  `asyncio.wait_for` で実行時間をガード (既定 10s 超で 504)。両者とも env で調整可
  (`GRASP_API_MAX_BODY_BYTES` / `GRASP_API_REQUEST_TIMEOUT_SECONDS`)。タイムアウトは
  client 向けレイテンシの上限であり worker スレッド自体は止めない最小形 (ADR-075 性能目標と接続)。
- **DI** (`api/app.py` `create_app`): `ik_solver` / `collision_checker` を `create_app` に渡せる
  配線点。省略時は engine の naive 既定。将来 実ソルバ/外部サービスに差し替えても変更はこの
  配線点に閉じ、契約も engine も無変更 (ADR-076 §5)。
- **API 表面の隠蔽** (`api/app.py` `create_app`): FastAPI 既定の `/docs` `/redoc` `/openapi.json`
  は URL / I/O 形 / スコア内訳スキーマを丸ごと晒し、loopback 既定の隠蔽 (§4) を打ち消す。
  そこで docs 公開を `auth_enabled` に連動させ、**本番 (内部トークン設定済み) では閉じ (404)、
  dev (トークン未設定) のみ開ける**。「トークンを入れた瞬間に API 表面も閉じる」で認証と隠蔽を
  同時に有効化し、運用を一貫させる (§4 の実装)。
- **可観測性** (`api/app.py` `/healthz`): `GET /healthz` が `{"status":"ok","contractVersion":N}`
  を返す (片側だけ古いデプロイの照合材料)。エラーは logger で記録 (500 は stacktrace)。
- **conformance** (`core/tests/test_api.py`): エンドポイントの HTTP 往復出力を中立 Schema
  (`packages/grasp-contract/schema/grasp-search-response.schema.json`) に突き合わせるテストを追加。
  型レベル (`test_contract_conformance.py`) に加え HTTP 往復でも契約準拠を担保。
- **起動エントリ** (`api/__main__.py`): `python -m easy_extrude_core.api` で uvicorn 起動。
  既定 bind は loopback (`127.0.0.1`) = フロント直叩き不可を既定にする。外部 bind は
  明示的な env (`GRASP_API_HOST`) でのみ。

## Still deferred (素朴版では最小形に留め、後で強化する)

- 内部認証の強化 (共有トークン -> mTLS / 署名付き内部 JWT 等) と本番ホスティング先の確定
  (内部 bind か専用ネットワークか)。ADR-074 Open から継続。
- 実行時間ガードの厳密化 (worker スレッドの実停止 / プロセス分離 / 候補数の事前枝刈り)。
  現状は client 向けレイテンシ上限のみ。実測で予算超過が常態化したら着手 (聞かれていない
  最適化を先に入れない規律)。
- レート制限 / メトリクス (件数・レイテンシ分布) の本格化。現状はログのみ。
- TS 側の HTTP 往復 conformance (BFF が中立 Schema に突き合わせる) は public 配線回で追加
  (公開配線タイミングの申し送り事項)。

## Consequences

- 本 ADR の実装で、`フロント -> BFF -> コアAPI` の経路の **コアAPI 側 (呼ばれる側)** が揃う。
  BFF 側の配線は契約の中立化 (移設 -> 確認 -> 配線) を先に済ませてから別途行う。順序を逆に
  しない (BFF を先にコアAPI へ直接配線 = 境界が崩れる)。
- contractVersion ガードを最初のエンドポイントから入れることで、片側だけ古いデプロイのズレを
  デバッグ一瞬で特定できる (ADR-074 の狙い)。
- エンドポイント層は判定を持たないので、engine が段階0 から将来の最適化版に進化しても
  境界は無変更でいられる (疎結合の維持)。
- public 視点では委譲先は「外部サービス / grasp-search service」。URL / 認証 / 内部仕様は
  リポジトリに焼かず環境変数等で注入する。
