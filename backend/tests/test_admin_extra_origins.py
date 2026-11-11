"""網域移轉過渡期的 WEBSITE_ADMIN_EXTRA_ORIGINS（2026-11-11）。

正式網域接通後 WEBSITE_ADMIN_ORIGIN 改成正式網域，舊的 Railway 網址放進 EXTRA_ORIGINS，
兩邊的後台寫入、家長修改頁、重設密碼都要能過 Origin 檢查；其他網域照樣 403。
"""
from __future__ import annotations

import pytest

from app.auth.models import Role
from app.config import Settings
from app.main import create_app
from tests.conftest import _create_user, _logged_in_client
from tests.test_secfix_platform import _prod_settings

API = "/api/website/v1"
PRIMARY = "https://www.ivykidschool.com"
RAILWAY = "https://web-production-04caa.up.railway.app"


def test_extra_origins_are_normalized_and_combined():
    settings = _prod_settings(admin_origin=f"{PRIMARY}/", admin_extra_origins=f" {RAILWAY}/ ,https://ivykidschool.com ")
    assert settings.admin_extra_origins == f"{RAILWAY},https://ivykidschool.com"
    assert settings.allowed_origins == frozenset({PRIMARY, RAILWAY, "https://ivykidschool.com"})
    assert settings.origin_allowed(RAILWAY) and settings.origin_allowed(PRIMARY)
    assert settings.origin_allowed(None)
    assert not settings.origin_allowed("https://evil.example")
    assert not settings.origin_allowed(f"{RAILWAY}.evil.example")


def test_extra_origins_default_keeps_single_origin_behaviour():
    settings = _prod_settings(admin_origin=RAILWAY)
    assert settings.admin_extra_origins is None
    assert settings.allowed_origins == frozenset({RAILWAY})
    assert not settings.origin_allowed(PRIMARY)


@pytest.mark.parametrize("value", ["https://x.example/admin", "ftp://x.example", "https://user@x.example", "x.example"])
def test_extra_origins_reject_non_origins(value):
    with pytest.raises(ValueError, match="WEBSITE_ADMIN_EXTRA_ORIGINS"):
        _prod_settings(admin_extra_origins=value)


def test_production_extra_origins_must_be_https():
    with pytest.raises(ValueError, match="HTTPS"):
        _prod_settings(admin_extra_origins="http://web-production-04caa.up.railway.app")


@pytest.mark.asyncio
async def test_writes_accepted_from_primary_and_extra_origin_only(app, db_session):
    settings = Settings(**{
        **app.state.settings.model_dump(),
        "admin_origin": PRIMARY,
        "admin_extra_origins": RAILWAY,
    })
    origin_app = create_app(settings)
    try:
        await _create_user(db_session, "extra-origin@ivy.example", "extra-origin-password-1", Role.SUPER_ADMIN)
        client = await _logged_in_client(origin_app, "extra-origin@ivy.example", "extra-origin-password-1")
        try:
            for origin in (PRIMARY, RAILWAY):
                response = await client.patch(f"{API}/auth/me", json={"display_name": "測試"}, headers={"origin": origin})
                assert response.status_code == 200, (origin, response.text)
            response = await client.patch(f"{API}/auth/me", json={"display_name": "測試"}, headers={"origin": "https://evil.example"})
            assert response.status_code == 403
        finally:
            await client.aclose()
    finally:
        await origin_app.state.engine.dispose()
