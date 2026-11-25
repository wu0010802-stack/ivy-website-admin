"""商家檔案與 Keyword Planner 的設定（docs/specs/2026-11-25-business-profile-keyword-planner-design.md §3）：預設全關、
成對檢查、地點與帳戶編號的格式、錯誤訊息與 repr 都不含密鑰。"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from tests.google_data_helpers import ADS_REFRESH, CLIENT_ID, CLIENT_SECRET, GBP_REFRESH, LOCATION, settings_with


def test_off_by_default():
    settings = settings_with(gbp=False, ads=False, google_api_client_id=None, google_api_client_secret=None)
    assert settings.gbp_enabled is False and settings.google_ads_enabled is False
    assert settings.gbp_oauth is None and settings.google_ads_oauth is None and settings.gbp_location_ids == {}


def test_both_enabled():
    settings = settings_with()
    assert settings.gbp_enabled and settings.google_ads_enabled
    assert settings.gbp_location_ids == {"yihua": LOCATION}
    assert settings.google_ads_customer_id == "5823451021"
    assert settings.gbp_oauth.refresh_token == GBP_REFRESH
    assert settings.google_ads_oauth.refresh_token == ADS_REFRESH
    assert settings.google_ads_api_version == "v26"
    for secret in (CLIENT_SECRET, GBP_REFRESH, ADS_REFRESH):
        assert secret not in repr(settings) and secret not in repr(settings.gbp_oauth)


def test_locations_accept_resource_name_and_several_campuses():
    settings = settings_with(gbp_locations=f" yihua = locations/{LOCATION}, renwu=123456 ")
    assert settings.gbp_location_ids == {"yihua": LOCATION, "renwu": "123456"}


@pytest.mark.parametrize("value", ["yihua", "taipei=123456", "yihua=abc", "yihua=123456,yihua=654321"])
def test_bad_locations_rejected(value):
    with pytest.raises(ValidationError) as exc:
        settings_with(gbp_locations=value)
    assert "WEBSITE_GBP_LOCATIONS" in str(exc.value)


@pytest.mark.parametrize(("overrides", "message"), [
    ({"gbp_locations": None}, "WEBSITE_GBP_REFRESH_TOKEN 與 WEBSITE_GBP_LOCATIONS"),
    ({"google_api_client_secret": None}, "WEBSITE_GOOGLE_API_CLIENT_ID 與 WEBSITE_GOOGLE_API_CLIENT_SECRET"),
    ({"google_api_client_id": None, "google_api_client_secret": None}, "OAuth 用戶端"),
    ({"google_ads_customer_id": None}, "WEBSITE_GOOGLE_ADS_REFRESH_TOKEN 與 WEBSITE_GOOGLE_ADS_CUSTOMER_ID"),
    ({"google_ads_customer_id": "582-345-102"}, "10 碼"),
    ({"google_ads_api_version": "26"}, "google_ads_api_version"),
])
def test_invalid_combinations(overrides, message):
    with pytest.raises(ValidationError) as exc:
        settings_with(**overrides)
    assert message in str(exc.value)
    for secret in (CLIENT_SECRET, GBP_REFRESH, ADS_REFRESH):
        assert secret not in str(exc.value)


def test_optional_ads_settings_need_the_rest():
    with pytest.raises(ValidationError) as exc:
        settings_with(ads=False, google_ads_developer_token="dev-token")
    assert "WEBSITE_GOOGLE_ADS_DEVELOPER_TOKEN" in str(exc.value)
    settings = settings_with(google_ads_login_customer_id="111-222-3333", google_ads_developer_token="dev-token")
    assert settings.google_ads_login_customer_id == "1112223333"


def test_blank_values_are_unset():
    settings = settings_with(gbp=False, ads=False, gbp_refresh_token="  ", gbp_locations=" ", google_ads_customer_id="")
    assert settings.gbp_enabled is False and settings.google_ads_enabled is False
    assert CLIENT_ID
