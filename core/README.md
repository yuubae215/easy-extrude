# core/ (レイヤ B: 判定エンジン = コア資産)

把持姿勢探索の判定 (2b)。

## 開発 (uv)
Python パッケージは [uv](https://docs.astral.sh/uv/) で管理する (`core/` が uv プロジェクト、
`core/uv.lock` が固定)。

```sh
cd core
uv sync --extra dev --extra serve   # 依存 + ローカル ASGI サーバを .venv に入れる
uv run pytest                        # テスト
uv run python -m easy_extrude_core.api  # ローカル起動 (既定 127.0.0.1:4001 = BFF upstream に一致)
```

依存の追加は `uv add <pkg>` (実行時) / `uv add --optional dev <pkg>` (extra)。
`uv.lock` はコミットする (再現性)。`.venv/` は gitignore 済み。

## 段階0 (実装済み: `easy_extrude_core/engine/`)
離散候補生成 -> 安い順フィルタ (リーチ -> IK 可解 -> 干渉) -> objectives を加重和スコア -> 上位N件。
最適化ソルバではなく「評価関数つき全探索」。数百〜数千候補なら一瞬。詳細設計は ADR-075。

公開エントリは `engine.search(GraspSearchRequest) -> GraspSearchResponse` (契約 = ADR-074)。

### モジュール構成
- `engine/types.py`      : ドメイン型 + 数値ヘルパ (純粋。Vec3 / Pose / Problem ほか)。
- `engine/candidates.py` : 離散候補生成 (純粋)。
- `engine/feasibility.py`: リーチ判定 (純粋) + IK/干渉の注入 Protocol + naive 既定実装。
- `engine/objectives.py` : objective の raw 計算 + 絶対基準 0-1 正規化 (純粋)。
- `engine/scoring.py`    : 正規化済み値の加重平均 (純粋)。
- `engine/pipeline.py`   : 探索 orchestration (副作用境界。注入ソルバを呼ぶのはここだけ)。
- `engine/pose_codec.py` : Pose <-> 契約境界の不透明 payload 変換。

## HTTP 境界 (実装済み: `easy_extrude_core/api/`)
純粋エンジンを「BFF が呼べる外部サービス」に変える薄い HTTP 境界 (ADR-076)。
`フロント -> BFF -> コアAPI` の経路の **コアAPI 側 (呼ばれる側)**。

公開エントリは `api.create_app(...) -> FastAPI` (ASGI アプリ factory)。

- `POST /grasp-search`: body=`GraspSearchRequest` (camelCase wire) -> `GraspSearchResponse`
  (`by_alias=True` で camelCase)。判定は engine に委譲し、境界は整形のみ。
- `GET /healthz`: `{"status":"ok","contractVersion":N}` (可観測性 + デプロイ照合)。
- エラーの約束: 400 (contractVersion 不一致, expected/received 付き) / 422 (形違い) /
  401 (内部トークン無し) / 413 (body 上限) / 504 (実行時間ガード) / 500 (想定外)。
  envelope は `{"error":{"code","message",...}}` で統一。

### モジュール構成
- `api/app.py`      : FastAPI アプリ factory + ルート + 例外ハンドラ (副作用境界)。
- `api/settings.py` : 内部トークン / body 上限 / タイムアウトの設定 (env 注入。値オブジェクト)。
- `api/errors.py`   : エラー envelope の型とコード (整形のみ。判定は持たない)。
- `api/__main__.py` : `python -m easy_extrude_core.api` のローカル起動 (uvicorn, 既定 loopback)。

起動: `uv sync --extra serve` 後に `uv run python -m easy_extrude_core.api`
(内部トークンは `GRASP_API_INTERNAL_TOKEN` で注入。本番は必須、dev は未設定で認証無効 + warning)。

## 設計規律
- 純粋関数 (候補生成・制約判定・正規化・スコア計算) と副作用 (pipeline / api) を分離。
- IK ソルバ / 干渉チェッカは Protocol で注入 (段階0 は外部依存ゼロの naive 既定を同梱)。
  注入の配線点は `api.create_app` (将来 実ソルバへの差し替えは境界に閉じる)。
- 数値的安定性を最優先、次に計算時間。
- objectives は絶対基準で 0-1 正規化してから重み付け (テンプレ間比較可能性)。
- contractVersion 検証はエンドポイント層 (`api/`) の責務。engine は検証済み宣言を受ける計算に徹する。
- コアAPI は BFF の背後に隠す: URL/認証/内部仕様は repo に焼かず env で注入する。
