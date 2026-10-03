"""總管理者寄重設密碼連結（2026-10-03）：資料表與服務層。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.models import PasswordResetToken, Role
from tests.conftest import _create_user

STAFF = "staff@ivy.example"
STAFF_PW = "staff-password-123"


async def test_token_hash_is_unique(db_session):
    user = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    now = datetime.now(timezone.utc)
    for _ in range(2):
        db_session.add(
            PasswordResetToken(
                id=uuid.uuid4(), user_id=user.id, token_hash="a" * 64,
                created_at=now, expires_at=now + timedelta(minutes=30),
            )
        )
    with pytest.raises(IntegrityError):
        await db_session.commit()
