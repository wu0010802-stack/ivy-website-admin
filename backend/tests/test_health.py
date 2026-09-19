from __future__ import annotations

import httpx
import pytest

from app.config import Settings
from app.main import create_app


@pytest.mark.asyncio
async def test_health_check_reports_environment():
    settings = Settings(
        database_url="sqlite+aiosqlite:///:memory:",
        environment="test",
        test_database_url="sqlite+aiosqlite:///:memory:?test=1",
        session_secret="test-only-secret",
    )
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport, base_url="http://test"
    ) as client:
        response = await client.get("/api/website/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["environment"] == "test"
    assert body["fixture_enabled"] is False
