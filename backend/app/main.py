from __future__ import annotations

import os

from fastapi import FastAPI
from sqlalchemy.ext.asyncio import async_sessionmaker

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

    return app


def _build_default_app() -> FastAPI | None:
    """僅供 `uvicorn app.main:app` 使用。測試以 conftest 設定
    WEBSITE_SKIP_DEFAULT_APP=1，避免純 import 因缺環境變數而失敗；
    正常啟動時設定錯誤仍會如實拋出，訊息不含密碼。"""
    if os.environ.get("WEBSITE_SKIP_DEFAULT_APP") == "1":
        return None
    return create_app()


app = _build_default_app()
