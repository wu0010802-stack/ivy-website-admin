"""定期工作的兩個清理步驟（2026-11-12）：

- 操作紀錄的來源 IP 與 User-Agent 只留 WEBSITE_AUDIT_CLIENT_INFO_RETENTION_DAYS 天（預設 365），過了清成 NULL，
  紀錄本身照留；
- 撤銷或到期超過 30 天的後台 session、用過／作廢／過期的重設連結、家長受限 session 刪掉
  （原本永遠不刪）；家長修改連結不刪（original_manage_path 要靠發過幾條判斷送單重播）。"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.auth import service as auth_service
from app.auth.models import PasswordResetToken, Role, Session
from app.booking.access_models import ParentAccessToken, ParentSession
from app.booking.models import VisitRequest
from app.config import Settings
from app.operations.models import AuditLogEntry
from app.workers import maintenance
from app.workers.maintenance import run_cycle
from tests.conftest import _create_user, book_slot

API = "/api/website/v1"

# 家長 session 要掛在真的案件上（預約表單要有已發布的同意文字）。
pytestmark = pytest.mark.usefixtures("booking_consent")


def _settings(app, **overrides) -> Settings:
    return app.state.settings.model_copy(
        update={"notification_email_sink_dir": None, "smtp_host": None, **overrides}
    )


def _hash(label: str) -> str:
    return hashlib.sha256(label.encode()).hexdigest()


def _audit(created_at: datetime, *, ip: str | None = "203.0.113.7", ua: str | None = "Mozilla/5.0 Test") -> AuditLogEntry:
    return AuditLogEntry(
        id=uuid.uuid4(),
        actor_user_id=None,
        action="user.login",
        target_type="user",
        target_id="someone",
        metadata_json={"note": "保留"},
        created_at=created_at,
        ip_address=ip,
        user_agent=ua,
    )


async def _audits(db_session) -> dict[uuid.UUID, AuditLogEntry]:
    db_session.expire_all()
    return {entry.id: entry for entry in (await db_session.execute(select(AuditLogEntry))).scalars()}


def test_audit_client_info_retention_days_setting():
    base = {"environment": "development", "database_url": "postgresql://localhost/ivy_website_dev", "session_secret": "x" * 40}
    assert Settings(**base).audit_client_info_retention_days == 365
    assert Settings(**base, audit_client_info_retention_days=30).audit_client_info_retention_days == 30
    for too_small in (0, 29):
        with pytest.raises(ValidationError):
            Settings(**base, audit_client_info_retention_days=too_small)


async def test_cycle_clears_old_audit_client_info_but_keeps_the_entries(app, db_session):
    now = datetime.now(timezone.utc)
    old = _audit(now - timedelta(days=400))
    old_ua_only = _audit(now - timedelta(days=366), ip=None)
    already_clear = _audit(now - timedelta(days=500), ip=None, ua=None)
    within = _audit(now - timedelta(days=364))
    recent = _audit(now - timedelta(minutes=5))
    db_session.add_all([old, old_ua_only, already_clear, within, recent])
    await db_session.commit()
    ids = [entry.id for entry in (old, old_ua_only, already_clear, within, recent)]
    before = len(await _audits(db_session))

    result = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")

    assert result.failed_steps == []
    assert result.audit_client_info_cleared == 2
    assert result.did_anything
    rows = await _audits(db_session)
    assert len(rows) == before, "紀錄本身不刪"
    cleared = [rows[i] for i in ids[:3]]
    assert all(row.ip_address is None and row.user_agent is None for row in cleared)
    assert all(row.action == "user.login" and row.metadata_json == {"note": "保留"} for row in cleared)
    assert [(rows[i].ip_address, rows[i].user_agent) for i in ids[3:]] == [("203.0.113.7", "Mozilla/5.0 Test")] * 2

    again = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")
    assert again.audit_client_info_cleared == 0

    # 保留天數可以調短（下限 30 天）：364 天前的那筆也清掉，5 分鐘前的照留。
    shorter = await run_cycle(app.state.session_factory, _settings(app, audit_client_info_retention_days=30), worker_id="test")
    assert shorter.audit_client_info_cleared == 1
    rows = await _audits(db_session)
    assert rows[ids[3]].ip_address is None and rows[ids[4]].ip_address == "203.0.113.7"


async def test_client_info_backlog_is_cleared_in_batches_across_cycles(app, db_session, monkeypatch):
    monkeypatch.setattr(maintenance, "HOUSEKEEPING_BATCH", 2)
    monkeypatch.setattr(maintenance, "HOUSEKEEPING_MAX_BATCHES", 2)
    old = datetime.now(timezone.utc) - timedelta(days=400)
    db_session.add_all([_audit(old - timedelta(minutes=i)) for i in range(5)])
    await db_session.commit()

    first = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")
    second = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")

    assert (first.audit_client_info_cleared, second.audit_client_info_cleared) == (4, 1)
    rows = await _audits(db_session)
    assert not [row for row in rows.values() if row.created_at < old + timedelta(minutes=1) and row.ip_address]


async def _visit_request_id(admin_client, public_client, db_session) -> uuid.UUID:
    await book_slot(admin_client, public_client)
    return (await db_session.execute(select(VisitRequest.id))).scalars().one()


async def test_cycle_purges_auth_rows_dead_for_more_than_30_days(app, admin_client, public_client, db_session):
    now = datetime.now(timezone.utc)
    long_ago, recently = now - timedelta(days=31), now - timedelta(days=29)
    user = await _create_user(db_session, "staff@ivy.example", "staff-password-123", Role.EDITOR, ["yihua"])
    visit_request_id = await _visit_request_id(admin_client, public_client, db_session)

    def session(label: str, *, expires_at: datetime, revoked_at: datetime | None = None) -> Session:
        return Session(
            id=_hash(label), user_id=user.id, csrf_token="c" * 32,
            created_at=expires_at - timedelta(hours=2), expires_at=expires_at, revoked_at=revoked_at,
        )

    def token(label: str, *, expires_at: datetime, used_at: datetime | None = None, revoked_at: datetime | None = None):
        return PasswordResetToken(
            id=uuid.uuid4(), user_id=user.id, token_hash=_hash(label), created_by=None,
            created_at=expires_at - timedelta(minutes=30), expires_at=expires_at, used_at=used_at, revoked_at=revoked_at,
        )

    def parent_session(label: str, *, expires_at: datetime, revoked_at: datetime | None = None) -> ParentSession:
        return ParentSession(
            id=_hash(label), visit_request_id=visit_request_id,
            created_at=expires_at - timedelta(hours=2), expires_at=expires_at, revoked_at=revoked_at,
        )

    gone = {
        "sessions": [
            session("s-revoked-long-ago", expires_at=now + timedelta(hours=1), revoked_at=long_ago),
            session("s-expired-long-ago", expires_at=long_ago),
        ],
        "tokens": [
            token("t-expired", expires_at=long_ago),
            token("t-used", expires_at=now - timedelta(days=40), used_at=now - timedelta(days=40, minutes=10)),
            token("t-revoked", expires_at=now - timedelta(days=60), revoked_at=now - timedelta(days=60, minutes=20)),
        ],
        "parent_sessions": [
            parent_session("p-revoked-long-ago", expires_at=now + timedelta(hours=1), revoked_at=long_ago),
            parent_session("p-expired-long-ago", expires_at=long_ago),
        ],
    }
    kept = {
        "sessions": [
            session("s-revoked-recently", expires_at=now + timedelta(hours=1), revoked_at=recently),
            session("s-expired-recently", expires_at=recently),
            session("s-active", expires_at=now + timedelta(hours=1)),
        ],
        "tokens": [
            token("t-expired-recently", expires_at=recently),
            token("t-used-recently", expires_at=recently, used_at=recently - timedelta(minutes=5)),
            token("t-fresh", expires_at=now + timedelta(minutes=20)),
        ],
        "parent_sessions": [
            parent_session("p-expired-recently", expires_at=recently),
            parent_session("p-active", expires_at=now + timedelta(hours=1)),
        ],
    }
    # 家長修改連結不清：作廢很久的舊連結也留著（送單重播靠發過幾條判斷）。
    old_link = ParentAccessToken(
        id=uuid.uuid4(), visit_request_id=visit_request_id, token_hash=_hash("old-link"),
        created_at=now - timedelta(days=90), expires_at=now - timedelta(days=60), revoked_at=now - timedelta(days=80),
    )
    db_session.add_all([*sum(gone.values(), []), *sum(kept.values(), []), old_link])
    await db_session.commit()
    gone_ids = {kind: {row.id for row in rows} for kind, rows in gone.items()}
    kept_ids = {kind: {row.id for row in rows} for kind, rows in kept.items()}
    links_before = await db_session.scalar(select(func.count()).select_from(ParentAccessToken))

    result = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")

    assert result.failed_steps == []
    assert result.stale_auth_rows_purged == 7
    db_session.expire_all()
    stored = {
        "sessions": set((await db_session.execute(select(Session.id))).scalars()),
        "tokens": set((await db_session.execute(select(PasswordResetToken.id))).scalars()),
        "parent_sessions": set((await db_session.execute(select(ParentSession.id))).scalars()),
    }
    for kind in stored:
        assert not stored[kind] & gone_ids[kind], kind
        assert kept_ids[kind] <= stored[kind], kind
    assert await db_session.scalar(select(func.count()).select_from(ParentAccessToken)) == links_before
    # 正在用的後台登入不受影響。
    assert (await admin_client.get(f"{API}/auth/me")).status_code == 200

    again = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")
    assert again.stale_auth_rows_purged == 0


async def test_one_failing_purge_does_not_block_the_others(app, db_session, monkeypatch):
    now = datetime.now(timezone.utc)
    user = await _create_user(db_session, "staff@ivy.example", "staff-password-123", Role.EDITOR, ["yihua"])
    db_session.add(
        PasswordResetToken(
            id=uuid.uuid4(), user_id=user.id, token_hash=_hash("t-expired"), created_by=None,
            created_at=now - timedelta(days=60, minutes=30), expires_at=now - timedelta(days=60),
        )
    )
    db_session.add(_audit(now - timedelta(days=400)))
    await db_session.commit()

    async def broken(db, cutoff, *, limit):
        raise RuntimeError("session 表壞掉")

    monkeypatch.setattr(auth_service, "purge_stale_sessions", broken)
    result = await run_cycle(app.state.session_factory, _settings(app), worker_id="test")

    assert result.failed_steps == ["stale_auth"]
    assert result.stale_auth_rows_purged == 1  # 重設連結照樣清掉
    assert result.audit_client_info_cleared == 1
    assert await db_session.scalar(select(func.count()).select_from(PasswordResetToken)) == 0
