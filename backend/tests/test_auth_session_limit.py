"""/auth/me 帶登入上限時間（2026-10-03 第八輪：到期前提醒先儲存）。"""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select

from app.auth import service
from app.auth.models import Session


@pytest.mark.asyncio
async def test_me_reports_twelve_hour_limit(admin_client, db_session):
    response = await admin_client.get("/api/website/v1/auth/me")
    assert response.status_code == 200
    session = (await db_session.execute(select(Session).where(Session.revoked_at.is_(None)))).scalars().one()
    reported = datetime.fromisoformat(response.json()["session_max_expires_at"].replace("Z", "+00:00"))
    assert reported == session.created_at + service.SESSION_TTL
