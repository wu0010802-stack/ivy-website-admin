from __future__ import annotations

import os

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.auth.routes import router as auth_router
from app.booking.access_routes import router as booking_access_router
from app.booking.routes import router as booking_router
from app.campuses.routes import router as campuses_router
from app.content.routes import router as content_router
from app.media.routes import router as media_router
from app.notifications.routes import router as notifications_router
from app.operations.routes import router as operations_router
from app.config import Settings, get_settings
from app.db import create_engine, create_session_factory


def create_app(settings: Settings | None = None) -> FastAPI:
    """Application factory；可注入隔離測試設定，import 本模組不連真實 DB。"""
    settings = settings or get_settings()

    app = FastAPI(title="Ivy Website Admin API", version="0.1.0")
    app.state.settings = settings
    app.state.engine = create_engine(settings)
    app.state.session_factory: async_sessionmaker = create_session_factory(
        app.state.engine
    )

    @app.get("/api/website/v1/health")
    async def health() -> dict:
        return {
            "status": "ok",
            "environment": settings.environment,
            "fixture_enabled": settings.enable_fixture,
        }

    app.include_router(auth_router)
    app.include_router(campuses_router)
    app.include_router(media_router)
    app.include_router(content_router)
    app.include_router(booking_router)
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
