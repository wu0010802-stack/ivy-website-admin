"""總管理者寄重設密碼連結（2026-10-03）：資料表與服務層。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.models import PasswordResetToken, Role
from tests.conftest import _create_user
from app.auth import password_reset
from app.auth.models import User
from app.config import Settings

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


def _settings(**overrides) -> Settings:
    base = dict(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    return Settings(**{**base, **overrides})


def test_email_enabled_needs_admin_origin_and_a_mail_channel():
    assert password_reset.email_enabled(_settings()) is False
    # 沒有後台網址就組不出信裡的連結。
    assert password_reset.email_enabled(_settings(notification_email_sink_dir="/tmp/x")) is False
    assert password_reset.email_enabled(_settings(admin_origin="http://test", notification_email_sink_dir="/tmp/x")) is True
    assert password_reset.email_enabled(
        _settings(admin_origin="http://test", smtp_host="smtp.example", smtp_from="noreply@ivy.example")
    ) is True
    # 正式環境只認 SMTP，本機 sink 不算（model_copy 不跑 production 檢查，只換環境名稱）。
    prod = _settings(admin_origin="https://ivy.example", notification_email_sink_dir="/tmp/x").model_copy(
        update={"environment": "production"}
    )
    assert password_reset.email_enabled(prod) is False


def test_reset_url_puts_token_after_hash():
    assert password_reset.reset_url("https://ivy.example/", "abc") == "https://ivy.example/admin/reset-password#token=abc"
    assert password_reset.reset_url("https://ivy.example", "abc") == "https://ivy.example/admin/reset-password#token=abc"


def test_email_names_account_and_deadline_in_taipei_time():
    user = User(email=STAFF, display_name="阿芬")
    actor = User(email="boss@ivy.example", display_name=None)
    # 2026-10-03 06:52Z＝台北 10/03（六）14:52
    expires = datetime(2026, 10, 3, 6, 52, tzinfo=timezone.utc)
    url = "https://ivy.example/admin/reset-password#token=abc"
    subject, body = password_reset.build_email(user=user, actor=actor, url=url, expires_at=expires)
    assert subject == "【常春藤官網後台】重設密碼連結"
    assert body.startswith("阿芬 您好：")
    assert "總管理者 boss@ivy.example" in body
    assert f"（{STAFF}）" in body
    assert "10/03（六）14:52 前" in body
    assert url in body
    assert "原本的密碼照常可用" in body


async def test_issue_revokes_the_previous_live_link(db_session):
    user = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    boss = await _create_user(db_session, "boss@ivy.example", "boss-password-1234", Role.SUPER_ADMIN)
    first = await password_reset.issue(db_session, user, actor_id=boss.id)
    second = await password_reset.issue(db_session, user, actor_id=boss.id)
    await db_session.commit()

    assert first.replaced_previous is False
    assert second.replaced_previous is True
    old = await password_reset.find_token(db_session, first.raw_token)
    new = await password_reset.find_token(db_session, second.raw_token)
    now = datetime.now(timezone.utc)
    assert password_reset.rejection(old, user, now) == password_reset.REJECT_REVOKED
    assert password_reset.rejection(new, user, now) is None
    assert new.expires_at - new.created_at == password_reset.RESET_LINK_TTL
    assert new.created_by == boss.id
    # 存的是雜湊，不是原始 token。
    assert new.token_hash == password_reset.hash_token(second.raw_token)
    assert second.raw_token not in new.token_hash


async def test_expired_link_does_not_count_as_replaced(db_session):
    user = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    first = await password_reset.issue(db_session, user, actor_id=user.id)
    token = await password_reset.find_token(db_session, first.raw_token)
    token.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.flush()
    second = await password_reset.issue(db_session, user, actor_id=user.id)
    assert second.replaced_previous is False


async def test_find_token_ignores_empty_and_oversized_input(db_session):
    assert await password_reset.find_token(db_session, "") is None
    assert await password_reset.find_token(db_session, "x" * 200) is None


def test_rejection_order_inactive_then_used_then_revoked_then_expired():
    now = datetime(2026, 10, 3, 6, 0, tzinfo=timezone.utc)
    active = User(email=STAFF, is_active=True)
    inactive = User(email=STAFF, is_active=False)

    def token(**fields) -> PasswordResetToken:
        base = dict(used_at=None, revoked_at=None, expires_at=now + timedelta(minutes=1))
        return PasswordResetToken(**{**base, **fields})

    past = now - timedelta(minutes=1)
    # 帳號停用最優先：下一步一律是聯絡總管理者，不是去找最新一封信。
    assert password_reset.rejection(token(used_at=past, revoked_at=past, expires_at=past), inactive, now) == "inactive"
    assert password_reset.rejection(token(revoked_at=past), inactive, now) == "inactive"
    assert password_reset.rejection(token(expires_at=now), inactive, now) == "inactive"
    assert password_reset.rejection(token(), inactive, now) == "inactive"
    assert password_reset.rejection(token(), None, now) == "inactive"
    assert password_reset.rejection(token(used_at=past, revoked_at=past, expires_at=past), active, now) == "link_used"
    assert password_reset.rejection(token(revoked_at=past, expires_at=past), active, now) == "link_revoked"
    assert password_reset.rejection(token(expires_at=now), active, now) == "link_expired"
    assert password_reset.rejection(token(), active, now) is None
