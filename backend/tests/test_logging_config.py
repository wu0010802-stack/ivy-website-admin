"""uvicorn 存取紀錄不能把查詢字串（後台搜尋的家長電話、姓名）寫進平台日誌。"""
from __future__ import annotations

import logging

from app.logging_config import StripQueryString


def _access_record(path: str) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 0,
        '%s - "%s %s HTTP/%s" %d', ("10.0.0.1:5000", "GET", path, "1.1", 200), None,
    )


def test_access_log_drops_query_string():
    record = _access_record("/api/website/v1/admin/visit-requests?q=0912345678&page=1")
    assert StripQueryString().filter(record)
    message = record.getMessage()
    assert "0912345678" not in message
    assert "/api/website/v1/admin/visit-requests" in message and '" 200' in message


def test_access_log_without_query_is_unchanged():
    record = _access_record("/api/website/v1/health")
    StripQueryString().filter(record)
    assert record.getMessage() == '10.0.0.1:5000 - "GET /api/website/v1/health HTTP/1.1" 200'


async def test_api_docs_are_off_in_production():
    import httpx

    from app.config import Settings
    from app.main import create_app

    def app_for(environment: str):
        return create_app(
            Settings(
                environment=environment,
                database_url="postgresql+asyncpg://localhost/ivy_website_dev",
                test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
                session_secret="test-only-secret-please-rotate-xxxxxxxx",
                # production 啟動檢查要求不含路徑的 HTTPS 後台網址（2026-09-29 資安稽核）。
                admin_origin="https://admin.example.org",
            )
        )

    production = app_for("production")
    try:
        assert production.openapi_url is None and production.docs_url is None and production.redoc_url is None
        assert production.openapi()["paths"], "契約匯出仍要能產生 schema"
        # 經 web 同源代理繞到 API 根目錄（%2e%2e）也拿不到任何一條文件路由。
        transport = httpx.ASGITransport(app=production)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            for path in ("/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"):
                assert (await client.get(path)).status_code == 404, path
    finally:
        await production.state.engine.dispose()
        await production.state.rate_limit_engine.dispose()
    assert app_for("test").openapi_url == "/openapi.json"
