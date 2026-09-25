"""個資匯出（booking.export）改為總管理者逐人授予（2026-09-25 業主裁定）。"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select, text

from app.auth.models import Role, User
from app.auth.permissions import effective_capabilities, has_capability, roles_with
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
EXPORT = f"{API}/admin/visit-requests/export"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "e5b1c7a9d402_grant_booking_export_to_campus_admins.py"


async def _grant(admin_client, user_id, caps):
    return await admin_client.patch(f"{API}/admin/users/{user_id}/capabilities", json={"capabilities": caps})


def test_export_needs_explicit_grant_except_for_super_admin():
    assert has_capability(User(role=Role.SUPER_ADMIN, capabilities=[]), "booking.export")
    assert not has_capability(User(role=Role.CAMPUS_ADMIN, capabilities=[]), "booking.export")
    assert has_capability(User(role=Role.CAMPUS_ADMIN, capabilities=["booking.export"]), "booking.export")
    assert has_capability(User(role=Role.RECEPTION, capabilities=["booking.export"]), "booking.export")
    # 看不到案件的角色就算資料裡有授權也不算。
    assert not has_capability(User(role=Role.EDITOR, capabilities=["booking.export"]), "booking.export")
    assert "booking.export" in effective_capabilities(User(role=Role.CAMPUS_ADMIN, capabilities=["booking.export"]))
    # 逐人授權不能只看角色篩人。
    with pytest.raises(ValueError):
        roles_with("booking.export")


@pytest.mark.asyncio
async def test_campus_admin_exports_only_after_super_admin_grants(admin_client, minghua_client, db_session):
    me = (await minghua_client.get(f"{API}/auth/me")).json()["user"]
    assert "booking.export" not in me["effective_capabilities"]
    assert (await minghua_client.get(EXPORT)).status_code == 403

    granted = await _grant(admin_client, me["id"], ["booking.export"])
    assert granted.status_code == 200, granted.text
    assert granted.json()["capabilities"] == ["booking.export"]
    assert "booking.export" in granted.json()["effective_capabilities"]
    assert (await minghua_client.get(f"{EXPORT}?campus_key=minghua")).status_code == 200
    # 授權不擴大校區範圍。
    assert (await minghua_client.get(f"{EXPORT}?campus_key=yihua")).status_code == 404

    # 只有總管理者能授予，分校管理者不能替自己或別人開。
    assert (await _grant(minghua_client, me["id"], ["booking.export", "content.shared"])).status_code == 403

    revoked = await _grant(admin_client, me["id"], [])
    assert revoked.status_code == 200
    assert (await minghua_client.get(EXPORT)).status_code == 403

    audits = (await db_session.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "user.set_capabilities")
        .order_by(AuditLogEntry.created_at)
    )).scalars().all()
    assert [a.metadata_json["after"] for a in audits] == [["booking.export"], []]


@pytest.mark.asyncio
async def test_export_grant_applies_to_reception_but_not_editor(app, admin_client, db_session):
    desk = await _create_user(db_session, "desk-export@ivy.example", "desk-password-1234", Role.RECEPTION, ["yihua"])
    editor = await _create_user(db_session, "ed-export@ivy.example", "editor-password-12", Role.EDITOR, ["yihua"])
    assert (await _grant(admin_client, editor.id, ["booking.export"])).status_code == 400
    readonly = await _create_user(db_session, "ro-export@ivy.example", "readonly-password-1", Role.READONLY, ["yihua"])
    assert (await _grant(admin_client, readonly.id, ["booking.export"])).status_code == 400

    assert (await _grant(admin_client, desk.id, ["booking.export"])).status_code == 200
    client = await _logged_in_client(app, "desk-export@ivy.example", "desk-password-1234")
    try:
        assert (await client.get(f"{EXPORT}?campus_key=yihua")).status_code == 200
    finally:
        await client.aclose()
    # 櫃台不能拿共用內容授權。
    assert (await _grant(admin_client, desk.id, ["booking.export", "content.shared"])).status_code == 400


@pytest.mark.asyncio
async def test_new_campus_admin_has_no_export_until_granted(admin_client):
    created = await admin_client.post(
        f"{API}/admin/users",
        json={"email": "new-ca@ivy.example", "password": "a-long-enough-password", "role": "campus_admin",
              "campus_keys": ["yihua"]},
    )
    assert created.status_code == 201, created.text
    assert created.json()["capabilities"] == []
    assert "booking.export" not in created.json()["effective_capabilities"]

    with_grant = await admin_client.post(
        f"{API}/admin/users",
        json={"email": "new-ca2@ivy.example", "password": "a-long-enough-password", "role": "campus_admin",
              "campus_keys": ["yihua"], "capabilities": ["booking.export", "content.shared"]},
    )
    assert with_grant.status_code == 201, with_grant.text
    assert with_grant.json()["capabilities"] == ["booking.export", "content.shared"]


@pytest.mark.asyncio
async def test_role_change_drops_grants_that_no_longer_apply(admin_client, db_session):
    user = await _create_user(db_session, "mover@ivy.example", "mover-password-123", Role.CAMPUS_ADMIN, ["yihua"])
    await _grant(admin_client, user.id, ["booking.export", "content.shared"])

    to_desk = await admin_client.patch(
        f"{API}/admin/users/{user.id}/role", json={"role": "reception", "campus_keys": ["yihua"]}
    )
    assert to_desk.status_code == 200, to_desk.text
    # 分校管理者降為櫃台：共用內容不適用；匯出雖然櫃台也能接受授權，角色
    # 一換就收回，不默默帶著批次匯出個資的權限過去。
    assert to_desk.json()["capabilities"] == []
    assert "booking.export" not in to_desk.json()["effective_capabilities"]

    # 要保留就由總管理者重新勾選，另記一筆授權變更。
    assert (await _grant(admin_client, user.id, ["booking.export"])).status_code == 200
    # 角色不變、只改校區時保留。
    same_role = await admin_client.patch(
        f"{API}/admin/users/{user.id}/role", json={"role": "reception", "campus_keys": ["yihua", "minghua"]}
    )
    assert same_role.status_code == 200, same_role.text
    assert same_role.json()["capabilities"] == ["booking.export"]

    to_editor = await admin_client.patch(
        f"{API}/admin/users/{user.id}/role", json={"role": "editor", "campus_keys": ["yihua"]}
    )
    assert to_editor.json()["capabilities"] == []

    audits = (await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == "user.set_role").order_by(AuditLogEntry.created_at)
    )).scalars().all()
    assert [a.metadata_json.get("capabilities_removed") for a in audits] == [
        ["booking.export", "content.shared"], None, ["booking.export"],
    ]


@pytest.mark.asyncio
async def test_role_change_keeps_shared_content_grant_when_still_applicable(admin_client, db_session):
    # 只有個資匯出會因換角色收回；共用內容對新角色仍適用就保留。
    user = await _create_user(db_session, "promoted@ivy.example", "promoted-password-1", Role.EDITOR, ["yihua"])
    await _grant(admin_client, user.id, ["content.shared"])
    promoted = await admin_client.patch(
        f"{API}/admin/users/{user.id}/role", json={"role": "campus_admin", "campus_keys": ["yihua"]}
    )
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["capabilities"] == ["content.shared"]


@pytest.mark.asyncio
async def test_super_admin_always_exports(admin_client):
    me = (await admin_client.get(f"{API}/auth/me")).json()["user"]
    assert me["capabilities"] == []
    assert "booking.export" in me["effective_capabilities"]
    assert (await admin_client.get(EXPORT)).status_code == 200


def _load_migration():
    spec = importlib.util.spec_from_file_location("grant_booking_export", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.asyncio
async def test_migration_backfills_active_campus_admins_only(app, db_session):
    """migration 的回填 SQL：只補目前啟用中的分校管理者，已有的不重複、
    其他授權保留；downgrade 移除所有 booking.export。"""
    migration = _load_migration()
    active = await _create_user(db_session, "ca-on@ivy.example", "campus-password-1", Role.CAMPUS_ADMIN, ["yihua"])
    active.capabilities = ["content.shared"]
    inactive = await _create_user(db_session, "ca-off@ivy.example", "campus-password-2", Role.CAMPUS_ADMIN, ["yihua"])
    inactive.is_active = False
    await _create_user(db_session, "desk-mig@ivy.example", "desk-password-99", Role.RECEPTION, ["yihua"])
    already = await _create_user(db_session, "ca-has@ivy.example", "campus-password-3", Role.CAMPUS_ADMIN, ["yihua"])
    already.capabilities = ["booking.export"]
    await db_session.commit()

    captured: list[str] = []

    class _Op:
        @staticmethod
        def execute(statement):
            captured.append(str(statement))

    migration.op = _Op()
    migration.upgrade()
    migration.downgrade()
    upgrade_sql, downgrade_sql = captured

    async def capabilities_by_email() -> dict[str, list[str]]:
        db_session.expire_all()
        rows = (await db_session.execute(select(User.email, User.capabilities))).all()
        return {email: caps for email, caps in rows}

    async with app.state.engine.begin() as conn:
        await conn.execute(text(upgrade_sql))
    after = await capabilities_by_email()
    assert after["ca-on@ivy.example"] == ["booking.export", "content.shared"]
    assert after["ca-off@ivy.example"] == []
    assert after["desk-mig@ivy.example"] == []
    assert after["ca-has@ivy.example"] == ["booking.export"]

    async with app.state.engine.begin() as conn:
        await conn.execute(text(downgrade_sql))
    reverted = await capabilities_by_email()
    assert reverted["ca-on@ivy.example"] == ["content.shared"]
    assert reverted["ca-has@ivy.example"] == []
