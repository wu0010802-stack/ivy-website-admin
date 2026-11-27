"""招生統計逐人授權（2026-11-27 業主裁定）：分校管理者被授予 admissions.stats 後只看自己負責的校區；
全站數字（admissions.stats_site）與資料匯入（admissions.imports）仍只有總管理者。
另含同一輪整理：audit.read、content.browse、content.shared_publish、使用者清單的最後登入時間。"""
from __future__ import annotations

import pytest
from sqlalchemy import update

from app.auth.models import ADMISSIONS_STATS, SHARED_CONTENT, Role, User
from app.auth.permissions import _CAPABILITY_ROLES, effective_capabilities, has_capability, roles_with
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"


async def _client(app, db_session, email: str, role: Role, campus_keys: list[str], grants: list[str] | None = None):
    user = await _create_user(db_session, email, "a-long-test-password-123", role, campus_keys=campus_keys)
    if grants:
        await db_session.execute(update(User).where(User.id == user.id).values(capabilities=grants))
        await db_session.commit()
    return await _logged_in_client(app, email, "a-long-test-password-123")


def test_site_wide_and_import_capabilities_stay_super_admin_only():
    for capability in ("admissions.stats_site", "admissions.imports"):
        assert roles_with(capability) == {Role.SUPER_ADMIN}, capability
    # 逐人授權的一項不能只看角色。
    with pytest.raises(ValueError):
        roles_with(ADMISSIONS_STATS)
    assert _CAPABILITY_ROLES[ADMISSIONS_STATS] == {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN}


async def test_campus_admin_without_grant_cannot_see_stats(minghua_client):
    response = await minghua_client.get(f"{API}/admin/admissions/stats", params={"campus_key": "minghua", "school_year": 115})
    assert response.status_code == 403
    me = await minghua_client.get(f"{API}/auth/me")
    assert ADMISSIONS_STATS not in me.json()["user"]["effective_capabilities"]


async def test_granted_campus_admin_sees_only_own_campus(app, db_session):
    client = await _client(app, db_session, "stats-minghua@ivy.example", Role.CAMPUS_ADMIN, ["minghua"], [ADMISSIONS_STATS])
    try:
        me = (await client.get(f"{API}/auth/me")).json()["user"]
        assert ADMISSIONS_STATS in me["effective_capabilities"]
        assert "admissions.stats_site" not in me["effective_capabilities"]
        assert "admissions.imports" not in me["effective_capabilities"]

        own = await client.get(f"{API}/admin/admissions/stats", params={"campus_key": "minghua", "school_year": 115})
        assert own.status_code == 200, own.text
        # 別校＝這個物件對你不存在。
        other = await client.get(f"{API}/admin/admissions/stats", params={"campus_key": "yihua", "school_year": 115})
        assert other.status_code == 404

        compare = await client.get(f"{API}/admin/admissions/compare", params={"school_year": 115})
        assert compare.status_code == 200, compare.text
        assert "yihua" not in compare.text and "minghua" in compare.text

        outcomes = await client.get(f"{API}/admin/analytics/booking-outcomes")
        assert outcomes.status_code == 200, outcomes.text
        assert "yihua" not in outcomes.text

        # 全站數字與匯入：仍是總管理者的事。
        for path in (
            "/admin/admissions/ad-spend",
            "/admin/admissions/ad-roi?from=2026-10&to=2026-11",
            "/admin/admissions/ad-conversions",
            "/admin/business-profile",
            "/admin/search-demand",
            "/admin/search-insights",
            "/admin/crux",
            "/admin/line-insights",
        ):
            assert (await client.get(f"{API}{path}")).status_code == 403, path
        imports = await client.get(f"{API}/admin/admissions/imports/status", params={"campus_key": "minghua"})
        assert imports.status_code == 403
    finally:
        await client.aclose()


async def test_super_admin_keeps_site_wide_and_imports(admin_client):
    assert (await admin_client.get(f"{API}/admin/admissions/ad-spend")).status_code == 200
    imports = await admin_client.get(f"{API}/admin/admissions/imports/status", params={"campus_key": "minghua"})
    assert imports.status_code == 200, imports.text
    caps = (await admin_client.get(f"{API}/auth/me")).json()["user"]["effective_capabilities"]
    for capability in (ADMISSIONS_STATS, "admissions.stats_site", "admissions.imports", "audit.read", "content.browse", "content.shared_publish"):
        assert capability in caps, capability


async def test_stats_grant_only_for_campus_admin(admin_client, app, db_session):
    reception = await _create_user(db_session, "desk-grant@ivy.example", "a-long-test-password-123", Role.RECEPTION, campus_keys=["yihua"])
    manager = await _create_user(db_session, "manager-grant@ivy.example", "a-long-test-password-123", Role.CAMPUS_ADMIN, campus_keys=["yihua"])
    rejected = await admin_client.patch(
        f"{API}/admin/users/{reception.id}/capabilities",
        json={"capabilities": [ADMISSIONS_STATS], "current_password": "super-admin-password-123"},
    )
    assert rejected.status_code == 400, rejected.text
    assert "招生統計只能授予分校管理者" in rejected.text
    granted = await admin_client.patch(
        f"{API}/admin/users/{manager.id}/capabilities",
        json={"capabilities": [ADMISSIONS_STATS], "current_password": "super-admin-password-123"},
    )
    assert granted.status_code == 200, granted.text
    assert ADMISSIONS_STATS in granted.json()["effective_capabilities"]
    # 換成不適用的角色，授權跟著清掉，改回來也不會復活。
    demoted = await admin_client.patch(
        f"{API}/admin/users/{manager.id}/role",
        json={"role": "reception", "campus_keys": ["yihua"], "current_password": "super-admin-password-123"},
    )
    assert demoted.status_code == 200, demoted.text
    assert demoted.json()["capabilities"] == []


async def test_reception_cannot_read_campus_audit_log(app, db_session, minghua_client):
    desk = await _client(app, db_session, "desk-audit@ivy.example", Role.RECEPTION, ["minghua"])
    try:
        assert (await desk.get(f"{API}/admin/audit-log", params={"campus_key": "minghua"})).status_code == 403
        assert (await desk.get(f"{API}/admin/audit-log/actors", params={"campus_key": "minghua"})).status_code == 403
    finally:
        await desk.aclose()
    assert (await minghua_client.get(f"{API}/admin/audit-log", params={"campus_key": "minghua"})).status_code == 200
    assert (await minghua_client.get(f"{API}/admin/audit-log", params={"campus_key": "yihua"})).status_code == 404


class _Scope:
    def __init__(self, key: str) -> None:
        self.campus_key = key


class _U:
    def __init__(self, role: Role, grants: list[str] | None = None) -> None:
        self.role = role
        self.capabilities = grants or []
        self.campus_scopes = [_Scope("yihua")]


def test_virtual_and_nav_capabilities():
    # 接待讀得到分校資料，但不列官網內容頁。
    assert has_capability(_U(Role.RECEPTION), "content.read")
    assert "content.browse" not in effective_capabilities(_U(Role.RECEPTION))
    assert "content.browse" in effective_capabilities(_U(Role.READONLY))
    # 共用內容：內容編輯有授權只能編（送審），分校管理者有授權才能直接發布。
    editor = effective_capabilities(_U(Role.EDITOR, [SHARED_CONTENT]))
    assert SHARED_CONTENT in editor and "content.shared_publish" not in editor
    manager = effective_capabilities(_U(Role.CAMPUS_ADMIN, [SHARED_CONTENT]))
    assert SHARED_CONTENT in manager and "content.shared_publish" in manager
    assert "content.shared_publish" not in effective_capabilities(_U(Role.CAMPUS_ADMIN))


async def test_users_list_reports_last_login(admin_client, db_session):
    await _create_user(db_session, "never-in@ivy.example", "a-long-test-password-123", Role.READONLY, campus_keys=["yihua"])
    users = {u["email"]: u for u in (await admin_client.get(f"{API}/admin/users")).json()}
    # admin_client 這個 fixture 剛用密碼登入過。
    assert users["admin@ivy.example"]["last_login_at"] is not None
    assert users["never-in@ivy.example"]["last_login_at"] is None
    # 其他回應不帶（不是使用者清單）。
    assert (await admin_client.get(f"{API}/auth/me")).json()["user"]["last_login_at"] is None


async def test_permission_table_endpoint(admin_client, minghua_client):
    assert (await minghua_client.get(f"{API}/admin/permission-table")).status_code == 403
    rows = {row["key"]: row for row in (await admin_client.get(f"{API}/admin/permission-table")).json()}
    assert rows["users.manage"] == {"key": "users.manage", "roles": ["super_admin"], "grant": None}
    assert rows[ADMISSIONS_STATS] == {"key": ADMISSIONS_STATS, "roles": ["super_admin", "campus_admin"], "grant": ADMISSIONS_STATS}
    assert rows["booking.export"]["roles"] == ["super_admin", "campus_admin", "reception"]
    assert rows[SHARED_CONTENT] == {"key": SHARED_CONTENT, "roles": ["super_admin", "campus_admin", "editor"], "grant": SHARED_CONTENT}
    assert rows["content.shared_publish"] == {"key": "content.shared_publish", "roles": ["super_admin", "campus_admin"], "grant": SHARED_CONTENT}
    # 表裡的每一項都對得上 effective_capabilities 的算法（總管理者全部都有）。
    caps = set((await admin_client.get(f"{API}/auth/me")).json()["user"]["effective_capabilities"])
    assert caps == set(rows)
