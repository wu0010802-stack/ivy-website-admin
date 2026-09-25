"""權限一律走 app/auth/permissions.py 的 capability 表與校區範圍 helper。

路由裡各自寫 `role != SUPER_ADMIN` 的後果是：放寬或收緊某個角色時要逐檔
找，漏一處就出現「後台看得到按鈕、API 卻 403」或反過來的權限漏洞。這裡
用靜態掃描擋住新的硬編角色判斷，並補上原本沒測到的總管理者限定端點。"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from app.auth.models import Role
from app.auth.permissions import campus_scope, covers_campus, roles_with

APP_DIR = Path(__file__).resolve().parents[1] / "app"

# 角色本身的領域規則（總管理者不需要校區、最後一位總管理者不能停用、
# bootstrap 建立第一位總管理者）留在 auth 與 CLI，其他地方不該直接看角色。
_ROLE_LOGIC_ALLOWED = {APP_DIR / "auth", APP_DIR / "cli.py"}
_ROLE_CHECK = re.compile(
    r"\.role(\.value)?\s*(==|!=|not in\b|in\b)|role\.in_\(\s*\[|Role\.(SUPER_ADMIN|CAMPUS_ADMIN|EDITOR|RECEPTION|READONLY)"
)


def _is_allowed(path: Path) -> bool:
    return any(path == allowed or allowed in path.parents for allowed in _ROLE_LOGIC_ALLOWED)


def test_no_hard_coded_role_checks_outside_permission_table():
    offenders = []
    for path in sorted(APP_DIR.rglob("*.py")):
        if _is_allowed(path):
            continue
        for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if _ROLE_CHECK.search(line):
                offenders.append(f"{path.relative_to(APP_DIR.parent)}:{lineno}: {line.strip()}")
    assert not offenders, "改用 require_scope／has_capability／campus_scope：\n" + "\n".join(offenders)


def test_super_admin_only_capabilities():
    for capability in (
        "campuses.activate",
        "booking.cross_campus",
        "audit.read_all",
        "site_settings.manage",
        "retention.manage",
        "content.release_restore",
    ):
        assert roles_with(capability) == {Role.SUPER_ADMIN}, capability


def test_unknown_capability_is_a_programming_error():
    with pytest.raises(ValueError):
        roles_with("booking.typo")


class _Scope:
    def __init__(self, key: str) -> None:
        self.campus_key = key


class _User:
    def __init__(self, role: Role, keys: list[str]) -> None:
        self.role = role
        self.campus_scopes = [_Scope(k) for k in keys]


def test_campus_scope_helpers():
    super_admin = _User(Role.SUPER_ADMIN, [])
    campus_admin = _User(Role.CAMPUS_ADMIN, ["minghua"])
    assert campus_scope(super_admin) is None
    assert covers_campus(super_admin, "renwu")
    assert campus_scope(campus_admin) == {"minghua"}
    assert covers_campus(campus_admin, "minghua")
    assert not covers_campus(campus_admin, "yihua")


async def test_site_settings_update_requires_super_admin(minghua_client):
    response = await minghua_client.patch(
        "/api/website/v1/admin/site-settings",
        json={
            "title": "x",
            "description": "x",
            "share_image": None,
            "noindex": True,
            "privacy_policy_version": "v1",
        },
    )
    assert response.status_code == 403


@pytest.mark.parametrize("path", ["/api/website/v1/admin/retention/dry-run", "/api/website/v1/admin/retention/run"])
async def test_retention_requires_super_admin(minghua_client, path):
    response = await minghua_client.post(path)
    assert response.status_code == 403
    # 不是「真跑未開放」那個 403：分校管理者連預覽都不該拿到。
    assert "dry_run_preview" not in response.text
