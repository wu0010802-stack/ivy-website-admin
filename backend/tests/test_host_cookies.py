"""正式環境的登入 cookie 加 __Host- 前綴（2026-11-12 資安強化，app/common/host_cookies.py）。

子網域被拿下時可以對整個網域寫 cookie（cookie tossing），把攻擊者的 session 或 OAuth 握手
塞進管理者的瀏覽器。__Host- 前綴的 cookie 子網域寫不進來；沒有前綴的同名 cookie 一律不採信。
"""
from __future__ import annotations

import httpx
import pytest

from app.auth.models import Role
from app.common.host_cookies import HostPrefixCookieMiddleware, rewrite_request_cookie, rewrite_set_cookie
from tests.conftest import _create_user

LOGIN = "/api/website/v1/auth/login"
ME = "/api/website/v1/auth/me"


def test_set_cookie_gets_host_prefix_root_path_and_secure():
    out = rewrite_set_cookie("ivy_line_oauth=abc; Domain=ivy.example; HttpOnly; Max-Age=600; Path=/api/website/v1/auth/line; SameSite=lax")
    assert out.startswith("__Host-ivy_line_oauth=abc;")
    assert "Domain" not in out and "domain" not in out
    assert out.count("Path=") == 1 and out.endswith("Path=/; Secure")
    assert rewrite_set_cookie("ivy_admin_session=t; HttpOnly; Path=/; SameSite=lax; Secure").count("Secure") == 1
    assert rewrite_set_cookie('ivy_parent_session=""; expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; Path=/').startswith('__Host-ivy_parent_session="";')
    # 其他 cookie 不動
    assert rewrite_set_cookie("other=1; Path=/x") == "other=1; Path=/x"


def test_request_cookie_unprefixes_and_drops_plain_names():
    header, dropped = rewrite_request_cookie("ivy_admin_session=tossed; theme=dark; __Host-ivy_admin_session=real; __Host-other=x")
    assert dropped == {"ivy_admin_session"}
    parts = [p.strip() for p in header.split(";")]
    assert "ivy_admin_session=real" in parts
    assert "ivy_admin_session=tossed" not in parts
    assert "theme=dark" in parts and "__Host-other=x" in parts
    assert rewrite_request_cookie("") == ("", set())


def test_create_app_installs_middleware_outermost(app):
    outer = app.user_middleware[0]
    assert outer.cls is HostPrefixCookieMiddleware
    # 測試環境是 http，沒開；正式環境才開（main.create_app）。
    assert outer.kwargs == {"enabled": False}


@pytest.mark.asyncio
async def test_login_flow_uses_host_prefixed_cookie_and_ignores_tossed_plain_cookie(app, db_session):
    await _create_user(db_session, "host-cookie@ivy.example", "host-cookie-password-123", Role.SUPER_ADMIN)
    wrapped = HostPrefixCookieMiddleware(app, enabled=True)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="https://test") as client:
        login = await client.post(LOGIN, json={"email": "host-cookie@ivy.example", "password": "host-cookie-password-123"})
        assert login.status_code == 200, login.text
        set_cookie = login.headers["set-cookie"]
        assert set_cookie.startswith("__Host-ivy_admin_session=")
        assert "Path=/" in set_cookie and "Secure" in set_cookie and "Domain" not in set_cookie
        token = client.cookies.get("__Host-ivy_admin_session")
        assert token
        assert (await client.get(ME)).status_code == 200

    # 子網域塞進來的（或改版前留下的）沒有前綴的 cookie：不採信，並在回應裡清掉。
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="https://test") as tossed:
        response = await tossed.get(ME, headers={"cookie": f"ivy_admin_session={token}"})
        assert response.status_code == 401
        assert "ivy_admin_session=; Max-Age=0; Path=/" in response.headers.get("set-cookie", "")

    # 同一個瀏覽器同時有兩個時，只認有前綴的那個。
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url="https://test") as both:
        response = await both.get(ME, headers={"cookie": f"ivy_admin_session=attacker; __Host-ivy_admin_session={token}"})
        assert response.status_code == 200
        assert response.json()["user"]["email"] == "host-cookie@ivy.example"
