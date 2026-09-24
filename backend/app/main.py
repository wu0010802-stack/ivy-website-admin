from __future__ import annotations

import logging
import os

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.auth.routes import router as auth_router
from app.common.body_limit import BodySizeLimitMiddleware
from app.auth.google import configure_google_oauth, router as google_auth_router
from app.auth.line import configure_line_oauth, router as line_auth_router
from app.booking.access_routes import router as booking_access_router
from app.booking.routes import router as booking_router
from app.booking.schedule_routes import router as booking_schedule_router
from app.campuses.routes import router as campuses_router
from app.content.routes import router as content_router
from app.media.routes import public_router as media_public_router
from app.media.routes import router as media_router
from app.notifications.routes import router as notifications_router
from app.operations.routes import router as operations_router
from app.config import Settings, get_settings
from app.db import create_engine, create_session_factory

logger = logging.getLogger("app")

_INTERNAL_ERROR_BODY = {
    "detail": {"code": "INTERNAL_ERROR", "message": "系統發生未預期的錯誤，請稍後再試"}
}


def _register_exception_handlers(app: FastAPI) -> None:
    """未預期的例外一律回統一格式，不把 traceback 或 SQL 吐給呼叫端。

    SQLAlchemyError 註冊在 ExceptionMiddleware（會回應、不再往外拋），
    所以像 IntegrityError／MultipleResultsFound 這類資料層例外不會變成
    裸 500；Exception 這一支註冊在 ServerErrorMiddleware，回應後仍會
    重新拋出，讓 uvicorn 記錄完整堆疊、測試也能看到真正的錯。"""

    @app.exception_handler(SQLAlchemyError)
    async def _handle_db_error(request: Request, exc: SQLAlchemyError) -> JSONResponse:
        logger.exception("資料層未預期例外：%s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content=_INTERNAL_ERROR_BODY
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("未預期例外：%s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, content=_INTERNAL_ERROR_BODY
        )


def create_app(settings: Settings | None = None) -> FastAPI:
    """Application factory；可注入隔離測試設定，import 本模組不連真實 DB。"""
    settings = settings or get_settings()

    app = FastAPI(title="Ivy Website Admin API", version="0.1.0")
    app.state.settings = settings
    app.state.engine = create_engine(settings)
    app.state.session_factory: async_sessionmaker = create_session_factory(
        app.state.engine
    )
    _register_exception_handlers(app)
    app.add_middleware(BodySizeLimitMiddleware)
    configure_google_oauth(app)
    configure_line_oauth(app)

    @app.middleware("http")
    async def parent_access_privacy_headers(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/website/v1/public/visit-manage/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
            response.headers["X-Robots-Tag"] = "noindex, nofollow"
        return response

    @app.get("/api/website/v1/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "environment": settings.environment,
            "fixture_enabled": settings.enable_fixture,
        }

    app.include_router(auth_router)
    app.include_router(google_auth_router)
    app.include_router(line_auth_router)
    app.include_router(campuses_router)
    app.include_router(media_router)
    app.include_router(media_public_router)
    app.include_router(content_router)
    app.include_router(booking_router)
    app.include_router(booking_schedule_router)
    app.include_router(booking_access_router)
    app.include_router(notifications_router)
    app.include_router(operations_router)

    return app


def _build_default_app() -> FastAPI | None:
    """僅供 `uvicorn app.main:app` 使用。測試以 conftest 設定
    WEBSITE_SKIP_DEFAULT_APP=1，避免純 import 因缺環境變數而失敗；
    正常啟動時設定錯誤仍會如實拋出，訊息不含密碼。"""
    if os.environ.get("WEBSITE_SKIP_DEFAULT_APP") == "1":
        return None
    return create_app()


app = _build_default_app()
