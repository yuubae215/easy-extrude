"""コアAPI エンドポイント層 = HTTP 境界 (ADR-076)。

目指す経路: フロント -> BFF -> コアAPI。
本モジュールは純粋エンジン (`engine.search`) を「BFF が呼べる外部サービス」に変える薄い境界。

エンドポイント:
- POST /grasp-search: 段階0 判定エンジン (`engine.search`, ADR-075)。
- POST /recommendation: 推薦/類似レーン (`recommendation.recommend`, ADR-077)。等価性
  *候補* を propose / rank する (decide はしない)。
- POST /pick-sequence: bin-picking シーン層 (`scene.pick_sequence`, ADR-078)。属性付き
  エンティティから per-pick の障害物を導出し、最上面順に反復ピックして把持ランキングを返す。

責務 (ADR-076 §1, 薄い境界に徹する):
- 入力 wire JSON を契約型に写す (pydantic 検証 = 形が違えば 422)。
- contractVersion を検証し、不一致なら 400 (ADR-076 §2 / ADR-074 §4)。
- コア (`engine.search` / `recommendation.recommend`) を呼ぶ (naive 既定を注入する配線点)。
- 結果を wire 形 (camelCase, by_alias) で返す。

**判定ロジックは一切持たない** (IK/干渉/リーチ/安定性/類似計算の実装はコアに閉じる)。
副作用 (HTTP I/O) はここに閉じ、判定の純粋コアとはディレクトリで分ける (ADR-076 §6)。
"""

from __future__ import annotations

import asyncio
import hmac
import logging
from typing import Awaitable, Callable, Optional

from fastapi import Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from ..contract import (
    CONTRACT_VERSION,
    ContractVersionMismatch,
    GraspSearchRequest,
    PickSequenceRequest,
    RecommendationRequest,
    check_contract_version,
)
from ..engine import (
    CollisionChecker,
    IkSolver,
    search,
)
from ..recommendation import SimilarityModel, recommend
from ..scene import pick_sequence
from .errors import (
    ErrorCode,
    InternalAuthError,
    RequestTimeoutError,
    error_payload,
)
from .settings import ApiSettings

logger = logging.getLogger("easy_extrude_core.api")

# 認証フック型: request を見て通過なら None、拒否なら例外を上げる (差し込める形 = ADR-076 §4)。
Authenticator = Callable[[Request], Awaitable[None]]

_INTERNAL_TOKEN_HEADER = "x-internal-token"


def _default_authenticator(settings: ApiSettings) -> Authenticator:
    """設定の内部トークンで BFF だけを通す既定認証 (ADR-076 §4 の最小形)。

    トークン未設定 (dev) なら認証無効。設定済みなら定数時間比較で照合し、
    不一致/欠如は InternalAuthError (-> 401)。
    """

    async def authenticate(request: Request) -> None:
        token = settings.internal_token
        if token is None:
            return  # dev: 認証無効。起動時に warning 済み。
        presented = request.headers.get(_INTERNAL_TOKEN_HEADER)
        if presented is None or not hmac.compare_digest(presented, token):
            raise InternalAuthError()

    return authenticate


def create_app(
    *,
    settings: Optional[ApiSettings] = None,
    ik_solver: Optional[IkSolver] = None,
    collision_checker: Optional[CollisionChecker] = None,
    similarity_model: Optional[SimilarityModel] = None,
    authenticator: Optional[Authenticator] = None,
) -> FastAPI:
    """コアAPI の ASGI アプリを組む (factory)。

    DI (ADR-076 §5): ik_solver / collision_checker / similarity_model を渡せる。省略時は
    各レーンの naive 既定 (search / recommend 内で組まれる)。将来 実ソルバ / 実 embeddings /
    外部サービスに差し替えるとき、変更はこの配線点に閉じ、契約もコアの純粋部も無変更で
    いられる。認証も authenticator で差し替え可能 (既定は内部トークン照合)。
    """
    settings = settings or ApiSettings.from_env()
    authenticate = authenticator or _default_authenticator(settings)

    if not settings.auth_enabled:
        # ADR-076 §4: 本番は BFF だけが通れる内部トークン必須。dev のみ無効を許す。
        logger.warning(
            "internal-token auth is DISABLED (no %s). "
            "This is for development only; the core API must sit behind the BFF in production.",
            "GRASP_API_INTERNAL_TOKEN",
        )

    # ADR-076 §4: /docs /redoc /openapi.json は API 表面 (URL/IO 形/スコア内訳
    # スキーマ) を丸ごと晒すため、loopback 既定の隠蔽を打ち消す。本番 (auth 有効 = トークン
    # 設定済み) では閉じ、dev (token 未設定) のみ開ける。auth_enabled に連動させ「トークンを
    # 入れた瞬間に表面も閉じる」で運用を一貫させる。
    docs_enabled = not settings.auth_enabled
    app = FastAPI(
        title="grasp-search service",
        description="Private grasp-pose judgement service. Called only by the BFF.",
        version="0.1.0",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )

    # --- 入力上限 (ADR-076 Open: リクエストサイズ上限の最小形) ---------------
    @app.middleware("http")
    async def limit_body_size(request: Request, call_next):
        # Content-Length での前段ガード (素朴な巨大入力で詰まらないよう)。
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                declared = int(content_length)
            except ValueError:
                declared = 0
            if declared > settings.max_body_bytes:
                return JSONResponse(
                    status_code=413,
                    content=error_payload(
                        ErrorCode.PAYLOAD_TOO_LARGE,
                        f"request body exceeds limit of {settings.max_body_bytes} bytes",
                    ),
                )
        return await call_next(request)

    # --- エラーの約束 (ADR-076 §3): 全エラーを envelope で返す -----------------
    @app.exception_handler(ContractVersionMismatch)
    async def _on_version_mismatch(_: Request, exc: ContractVersionMismatch):
        # 400: contractVersion 不一致。expected/received を載せてズレを即特定可能に (ADR-074)。
        return JSONResponse(
            status_code=400,
            content=error_payload(
                ErrorCode.CONTRACT_VERSION_MISMATCH,
                str(exc),
                expected=exc.expected,
                received=exc.received,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def _on_validation_error(_: Request, exc: RequestValidationError):
        # 422: リクエストが契約スキーマに合わない (形が違う)。
        return JSONResponse(
            status_code=422,
            content=error_payload(
                ErrorCode.VALIDATION_ERROR,
                "request does not conform to the grasp-search contract schema",
            ),
        )

    @app.exception_handler(InternalAuthError)
    async def _on_auth_error(_: Request, __: InternalAuthError):
        # 401: BFF 以外からの直叩き。内部仕様を漏らさないよう message は中立に保つ。
        return JSONResponse(
            status_code=401,
            content=error_payload(ErrorCode.UNAUTHORIZED, "missing or invalid credentials"),
        )

    @app.exception_handler(RequestTimeoutError)
    async def _on_timeout(_: Request, __: RequestTimeoutError):
        # 504: 実行時間ガード超過 (素朴な全探索が予算を超えた)。
        return JSONResponse(
            status_code=504,
            content=error_payload(
                ErrorCode.REQUEST_TIMEOUT,
                f"search exceeded time budget of {settings.request_timeout_seconds}s",
            ),
        )

    @app.exception_handler(Exception)
    async def _on_unexpected(_: Request, exc: Exception):
        # 500: engine 内部の想定外例外。内部詳細は漏らさない (中立 message)。
        logger.exception("unexpected error while handling grasp-search request")
        return JSONResponse(
            status_code=500,
            content=error_payload(ErrorCode.INTERNAL_ERROR, "internal error"),
        )

    # --- 可観測性 (ADR-076 Open): ヘルスチェックの最小形 ----------------------
    @app.get("/healthz")
    async def healthz() -> dict:
        # contractVersion を載せ、片側だけ古いデプロイの照合材料にする。
        return {"status": "ok", "contractVersion": CONTRACT_VERSION}

    # --- 唯一のエンドポイント (ADR-076 §3): POST /grasp-search ----------------
    @app.post("/grasp-search", response_model=None)
    async def grasp_search(
        payload: GraspSearchRequest,
        _auth: None = Depends(authenticate),
    ) -> JSONResponse:
        # contractVersion 検証ガード (ADR-076 §2)。不一致は ContractVersionMismatch -> 400。
        check_contract_version(payload.contract_version)

        # engine.search は CPU バウンドな同期計算。threadpool に逃がしつつ実行時間をガードする。
        # 注: 超過しても worker スレッドは止まらない (client 向けレイテンシの最小ガード)。
        try:
            response = await asyncio.wait_for(
                run_in_threadpool(
                    search,
                    payload,
                    ik_solver=ik_solver,
                    collision_checker=collision_checker,
                ),
                timeout=settings.request_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise RequestTimeoutError() from exc

        # 結果を wire 形 (camelCase) にして返す (ADR-076 §3)。
        return JSONResponse(content=response.model_dump(by_alias=True))

    # --- 推薦/類似レーン (ADR-077): POST /recommendation ---------------------
    # 等価性 *候補* を propose / rank して返す (decide はしない)。grasp-search と同じ
    # HTTP 境界の作法 (contractVersion 検証 / 認証 / threadpool + 実行時間ガード / envelope)。
    @app.post("/recommendation", response_model=None)
    async def recommendation(
        payload: RecommendationRequest,
        _auth: None = Depends(authenticate),
    ) -> JSONResponse:
        # contractVersion 検証ガード (ADR-076 §2)。不一致は ContractVersionMismatch -> 400。
        check_contract_version(payload.contract_version)

        # recommend は CPU バウンド (naive) ないし外部 I/O (実 model) になり得る同期計算。
        # threadpool に逃がしつつ実行時間をガードする (grasp-search と同じ扱い)。
        try:
            response = await asyncio.wait_for(
                run_in_threadpool(recommend, payload, model=similarity_model),
                timeout=settings.request_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise RequestTimeoutError() from exc

        # wire 形 (camelCase) で返す。真偽値は含まない (壁の番人, ADR-077 §5)。
        return JSONResponse(content=response.model_dump(by_alias=True))

    # --- bin-picking シーン層 (ADR-078): POST /pick-sequence -----------------
    # 属性付きエンティティの宣言を受け取り、per-pick の障害物集合を導出して最上面順に
    # 反復ピックし、各ピックの把持ランキングを返す。grasp-search と同じ HTTP 境界の作法
    # (contractVersion 検証 / 認証 / threadpool + 実行時間ガード / envelope)。障害物導出と
    # 把持判定は scene/engine に閉じ、ここは整形のみ (壁の規律, ADR-078 Decision 2)。
    @app.post("/pick-sequence", response_model=None)
    async def pick_sequence_endpoint(
        payload: PickSequenceRequest,
        _auth: None = Depends(authenticate),
    ) -> JSONResponse:
        # contractVersion 検証ガード (ADR-076 §2)。不一致は ContractVersionMismatch -> 400。
        check_contract_version(payload.contract_version)

        # 反復ピックは grasp-search を複数回呼ぶ CPU バウンド計算。threadpool に逃がしつつ
        # 実行時間をガードする (grasp-search / recommendation と同じ扱い)。ソルバ/チェッカは
        # grasp-search と同じ DI 注入点を共有する。
        try:
            response = await asyncio.wait_for(
                run_in_threadpool(
                    pick_sequence,
                    payload,
                    ik_solver=ik_solver,
                    collision_checker=collision_checker,
                ),
                timeout=settings.request_timeout_seconds,
            )
        except asyncio.TimeoutError as exc:
            raise RequestTimeoutError() from exc

        # 結果を wire 形 (camelCase) にして返す (ADR-076 §3)。
        return JSONResponse(content=response.model_dump(by_alias=True))

    return app
