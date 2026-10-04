from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from fastapi.utils import is_body_allowed_for_status_code
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.auth.routes import router as auth_router
from app.auth.password_reset_routes import router as password_reset_router
from app.common.body_limit import BodySizeLimitMiddleware
from app.common.request_id import REQUEST_ID_HEADER, RequestIdMiddleware, request_id_of
from app.common.ratelimit import RateLimiter
from app.auth.google import configure_google_oauth, router as google_auth_router
from app.auth.line import configure_line_oauth, router as line_auth_router
from app.booking.access_routes import router as booking_access_router
from app.admissions.routes import router as admissions_router
from app.booking.routes import router as booking_router
from app.booking.schedule_routes import router as booking_schedule_router
from app.campuses.routes import router as campuses_router
from app.content.release_routes import router as content_release_router
from app.content.routes import router as content_router
from app.media.routes import public_router as media_public_router
from app.media.routes import router as media_router
from app.notifications.line_routes import router as line_router
from app.notifications.routes import router as notifications_router
from app.operations.routes import router as operations_router
from app.config import Settings, get_settings
from app.logging_config import configure_logging
from app.db import create_engine, create_rate_limit_engine, create_session_factory
from app.workers.maintenance import MaintenanceLoop
from app.workers.media_loop import MediaJobLoop

logger = logging.getLogger("app")

_INTERNAL_ERROR = {"code": "INTERNAL_ERROR", "message": "系統發生未預期的錯誤，請稍後再試"}

# 後台與登入的回應（家長個資清單、CSV 匯出、一次性家長連結、session 資訊）
# 不能留在瀏覽器或中間快取；路由自己設了 Cache-Control（例如素材縮圖）就尊重。
_NO_STORE_PREFIXES = ("/api/website/v1/admin/", "/api/website/v1/auth/")


def _error_body(detail, request_id: str | None) -> dict:
    """錯誤本文維持 {"detail": ...}（前後台都這樣解析），另外帶 request_id：
    detail 是物件就放進去，字串與 422 的陣列則放在最外層，不改原本的形狀。"""
    if isinstance(detail, dict) and request_id:
        detail = {**detail, "request_id": request_id}
    body = {"detail": detail}
    if request_id:
        body["request_id"] = request_id
    return body


def _error_response(request: Request, status_code: int, detail, headers: dict | None = None) -> JSONResponse:
    request_id = request_id_of(request)
    merged = dict(headers or {})
    if request_id:
        merged[REQUEST_ID_HEADER] = request_id
    return JSONResponse(status_code=status_code, content=_error_body(detail, request_id), headers=merged)


def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _error_code(detail) -> str | None:
    return detail.get("code") if isinstance(detail, dict) else None


def _register_exception_handlers(app: FastAPI) -> None:
    """未預期的例外一律回統一格式，不把 traceback 或 SQL 吐給呼叫端。

    SQLAlchemyError 註冊在 ExceptionMiddleware（會回應、不再往外拋），
    所以像 IntegrityError／MultipleResultsFound 這類資料層例外不會變成
    裸 500；Exception 這一支註冊在 ServerErrorMiddleware，回應後仍會
    重新拋出，讓 uvicorn 記錄完整堆疊、測試也能看到真正的錯。

    所有錯誤回應都帶 request_id（本文與 X-Request-ID header），並記一行
    log：4xx 記 info（方法、路徑、狀態、錯誤碼），5xx 記完整堆疊。"""

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        logger.info(
            "HTTP %s %s → %s code=%s request_id=%s",
            request.method, request.url.path, exc.status_code, _error_code(exc.detail), request_id_of(request),
        )
        if not is_body_allowed_for_status_code(exc.status_code):
            return Response(status_code=exc.status_code, headers=exc.headers)
        return _error_response(request, exc.status_code, exc.detail, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def _handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        logger.info(
            "HTTP %s %s → 422 validation request_id=%s", request.method, request.url.path, request_id_of(request)
        )
        return _error_response(
            request, status.HTTP_422_UNPROCESSABLE_ENTITY, jsonable_encoder(exc.errors())
        )

    @app.exception_handler(SQLAlchemyError)
    async def _handle_db_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.exception(
            "資料層未預期例外：%s %s request_id=%s", request.method, request.url.path, request_id_of(request)
        )
        return _error_response(request, status.HTTP_500_INTERNAL_SERVER_ERROR, _INTERNAL_ERROR)

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception(
            "未預期例外：%s %s request_id=%s", request.method, request.url.path, request_id_of(request)
        )
        return _error_response(request, status.HTTP_500_INTERNAL_SERVER_ERROR, _INTERNAL_ERROR)


def create_app(settings: Settings | None = None) -> FastAPI:
    """Application factory；可注入隔離測試設定，import 本模組不連真實 DB。"""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # 排程發布、逾期占位、通知與限流清理原本只有 CLI，沒有任何排程在
        # 呼叫——改由 API 自己定期跑，見 app/workers/maintenance.py。
        interval = settings.background_jobs_interval
        if interval:
            app.state.maintenance = MaintenanceLoop(
                app.state.session_factory, settings, interval_seconds=interval
            )
            app.state.maintenance.start()
        # 影片 poster 與轉檔（app/media/jobs.py）；inline 模式在上傳請求裡做完，不必起迴圈。
        if settings.media_video_processing_mode == "background":
            app.state.media_jobs = MediaJobLoop(
                app.state.session_factory, settings, poll_seconds=settings.media_jobs_poll_seconds
            )
            app.state.media_jobs.start()
        try:
            yield
        finally:
            # 先停轉檔迴圈：做到一半的影片放回佇列，下一個程序馬上接手（不算一次嘗試）。
            if app.state.media_jobs is not None:
                await app.state.media_jobs.stop()
            if app.state.maintenance is not None:
                await app.state.maintenance.stop()
            await app.state.rate_limit_engine.dispose()
            await app.state.engine.dispose()

    # 互動文件只在開發與測試開放：API 雖沒有公開 domain，但 web 同源代理若被
    # dot-segment（%2e%2e）繞到 API 根目錄，就能拿到整份後台 schema。契約由
    # scripts/export_openapi.py 直接呼叫 app.openapi() 產生，不需要這幾條路由。
    docs = settings.environment != "production"
    app = FastAPI(
        title="Ivy Website Admin API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.maintenance = None
    app.state.media_jobs = None
    app.state.settings = settings
    app.state.engine = create_engine(settings)
    app.state.session_factory: async_sessionmaker = create_session_factory(
        app.state.engine
    )
    # 限流用獨立的小連線池，不和請求 session 搶連線（見 app/db.py）。
    app.state.rate_limit_engine = create_rate_limit_engine(settings)
    app.state.rate_limiter = RateLimiter(app.state.rate_limit_engine, settings.session_secret)
    _register_exception_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware)
    # 最後加的在最外層：本文太大被擋下的 413 也帶得到 request id。
    app.add_middleware(RequestIdMiddleware)
    configure_google_oauth(app)
    configure_line_oauth(app)

    @app.middleware("http")
    async def parent_access_privacy_headers(request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path.startswith("/api/website/v1/public/visit-manage/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        elif path.startswith(_NO_STORE_PREFIXES) and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "private, no-store"
        return response

    @app.get("/api/website/v1/health")
    async def health() -> dict:
        maintenance: MaintenanceLoop | None = app.state.maintenance
        media_jobs: MediaJobLoop | None = app.state.media_jobs
        return {
            "status": "ok",
            "environment": settings.environment,
            "fixture_enabled": settings.enable_fixture,
            # 部署後用來確認定期工作真的有在跑（只有時間，不含任何資料）。
            "background_jobs": {
                "enabled": maintenance is not None,
                "last_completed_at": _iso(maintenance.last_completed_at if maintenance else None),
                # 最近一次每一步都成功的時間與最近一輪失敗的步驟：定期工作「有在跑
                # 但一直失敗」時，last_completed_at 仍會更新，要看這兩個欄位。
                "last_clean_at": _iso(maintenance.last_clean_at if maintenance else None),
                "last_failed_steps": list(maintenance.last_failed_steps) if maintenance else [],
            },
            # 影片轉檔的背景迴圈：有沒有開、最近一次完成與失敗的時間。
            "media_jobs": {
                # 迴圈真的還活著才算開著（啟動時拿不到儲存體、異常結束都是 False）。
                "enabled": media_jobs is not None and media_jobs.running,
                "last_processed_at": _iso(media_jobs.last_processed_at if media_jobs else None),
                "last_failed_at": _iso(media_jobs.last_failed_at if media_jobs else None),
            },
        }

    app.include_router(auth_router)
    app.include_router(password_reset_router)
    app.include_router(google_auth_router)
    app.include_router(line_auth_router)
    app.include_router(campuses_router)
    app.include_router(media_router)
    app.include_router(media_public_router)
    app.include_router(content_router)
    app.include_router(content_release_router)
    app.include_router(booking_router)
    app.include_router(booking_schedule_router)
    app.include_router(booking_access_router)
    app.include_router(notifications_router)
    app.include_router(line_router)
    app.include_router(operations_router)
    if settings.admissions_enabled:
        # 預設關閉（見 Settings.admissions_enabled）：沒開就不掛路由，招生端點一律 404。
        app.include_router(admissions_router)

    return app


def _build_default_app() -> FastAPI | None:
    """僅供 `uvicorn app.main:app` 使用。測試以 conftest 設定
    WEBSITE_SKIP_DEFAULT_APP=1，避免純 import 因缺環境變數而失敗；
    正常啟動時設定錯誤仍會如實拋出，訊息不含密碼。"""
    if os.environ.get("WEBSITE_SKIP_DEFAULT_APP") == "1":
        return None
    configure_logging()
    return create_app()


app = _build_default_app()
