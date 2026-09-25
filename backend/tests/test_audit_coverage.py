"""規格 L261、L303：後台與帳號的每一個寫入動作都要留稽核紀錄。

靜態檢查：列出所有 /admin/ 與 /auth/ 底下的寫入端點（POST、PUT、PATCH、
DELETE），從端點函式往下追它呼叫的 app 內函式（最多三層），其中要有人呼叫
audit_service.log_action。真的不需要稽核的端點明列在 _EXEMPT 並寫理由；新增
寫入端點卻忘了寫稽核，這個測試就會失敗。
"""
from __future__ import annotations

import ast
import inspect
import textwrap
import types

import pytest

from app.main import create_app

_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_PREFIXES = ("/api/website/v1/admin/", "/api/website/v1/auth/")
_MAX_DEPTH = 3

# (方法, 路徑) → 為什麼不需要稽核。
_EXEMPT = {
    ("POST", "/api/website/v1/auth/login"): "登入建立 session（sessions 表記錄時間與帳號），失敗有限流；不另寫稽核",
    ("POST", "/api/website/v1/auth/logout"): "只刪自己的 session",
    ("POST", "/api/website/v1/auth/line/link"): "只產生 LINE 授權網址，真正綁定在 callback 記 user.link_line",
    ("POST", "/api/website/v1/admin/content-items/{kind}/revisions"): (
        "存草稿本身就是一筆 revision（含 created_by 與時間），不影響官網；發布、送審、還原另有稽核"
    ),
    ("POST", "/api/website/v1/admin/notifications/{notification_id}/read"): "站內通知已讀狀態",
    ("POST", "/api/website/v1/admin/my-notifications/{notification_id}/read"): "個人通知已讀狀態",
    ("POST", "/api/website/v1/admin/my-notifications/read-all"): "個人通知已讀狀態",
    ("POST", "/api/website/v1/admin/retention/dry-run"): "只試算筆數，不改任何資料",
}


def _resolve(node: ast.expr, namespace: dict):
    """把呼叫目標（`name(...)` 或 `module.name(...)`）對回實際的函式。"""
    if isinstance(node, ast.Name):
        return namespace.get(node.id)
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name):
        owner = namespace.get(node.value.id)
        if isinstance(owner, types.ModuleType):
            return getattr(owner, node.attr, None)
    return None


def _writes_audit(func, depth: int = 0, seen: set | None = None) -> bool:
    seen = seen if seen is not None else set()
    func = inspect.unwrap(func)
    if func in seen:
        return False
    seen.add(func)
    source = textwrap.dedent(inspect.getsource(func))
    if "log_action(" in source:
        return True
    if depth >= _MAX_DEPTH:
        return False
    namespace = func.__globals__
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        target = _resolve(node.func, namespace)
        if (
            inspect.isfunction(target)
            and target.__module__.startswith("app.")
            and _writes_audit(target, depth + 1, seen)
        ):
            return True
    return False


def _write_routes() -> list[tuple[str, str, object]]:
    app = create_app()
    routes = []
    for route in app.routes:
        methods = (getattr(route, "methods", None) or set()) & _WRITE_METHODS
        path = getattr(route, "path", "")
        if not methods or not path.startswith(_PREFIXES):
            continue
        for method in sorted(methods):
            routes.append((method, path, route.endpoint))
    return routes


def test_every_admin_write_endpoint_writes_audit():
    routes = _write_routes()
    # 避免路由表讀錯變成空轉。
    assert len(routes) > 50
    missing = [
        f"{method} {path}"
        for method, path, endpoint in routes
        if (method, path) not in _EXEMPT and not _writes_audit(endpoint)
    ]
    assert missing == []


def test_exemptions_are_still_needed():
    """例外清單裡的端點若已經寫了稽核或已刪除，要從清單拿掉。"""
    routes = {(method, path): endpoint for method, path, endpoint in _write_routes()}
    stale = [key for key in _EXEMPT if key not in routes or _writes_audit(routes[key])]
    assert stale == []


@pytest.mark.parametrize(
    "func_path",
    ["app.booking.routes.confirm_visit_request", "app.media.routes.archive_media"],
)
def test_checker_follows_direct_and_nested_calls(func_path):
    """自我檢查：直接呼叫（confirm）與經過 service 層（封存）的都認得出來。"""
    module_name, _, name = func_path.rpartition(".")
    module = __import__(module_name, fromlist=[name])
    assert _writes_audit(getattr(module, name))
