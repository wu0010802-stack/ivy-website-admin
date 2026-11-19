"""Search Console 與 CrUX 的設定（docs/specs/2026-11-12-external-integrations-design.md §3、§4）：
預設全關、兩個變數成對、服務帳戶 JSON 啟動時驗證、任何錯誤訊息與 repr 都不含金鑰內容。"""

from __future__ import annotations

import json

import pytest
from pydantic import ValidationError

from app.config import Settings
from tests.google_helpers import CRUX_KEY, PROPERTY, make_service_account


def _settings(**overrides) -> Settings:
    base = dict(
        database_url="postgresql://localhost/ivy_website_dev",
        environment="test",
        test_database_url="postgresql://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    return Settings(**{**base, **overrides})


def test_everything_is_off_by_default():
    settings = _settings()
    assert settings.google_sc_service_account_json is None
    assert settings.google_sc_property is None
    assert settings.crux_api_key is None
    assert settings.search_console_enabled is False
    assert settings.crux_enabled is False


def test_search_console_enabled_with_both_variables():
    account = make_service_account()
    settings = _settings(google_sc_service_account_json=account.json_text, google_sc_property=PROPERTY)
    assert settings.search_console_enabled is True
    assert settings.google_sc_service_account.client_email.endswith(".iam.gserviceaccount.com")
    assert settings.google_sc_service_account.private_key == account.private_pem


@pytest.mark.parametrize("which", ["json_only", "property_only"])
def test_search_console_variables_come_in_pairs(which):
    account = make_service_account()
    overrides = (
        {"google_sc_service_account_json": account.json_text}
        if which == "json_only" else {"google_sc_property": PROPERTY}
    )
    with pytest.raises(ValidationError) as exc:
        _settings(**overrides)
    assert "WEBSITE_GOOGLE_SC_SERVICE_ACCOUNT_JSON" in str(exc.value)
    assert "WEBSITE_GOOGLE_SC_PROPERTY" in str(exc.value)
    assert account.private_pem not in str(exc.value)


def test_blank_values_count_as_unset():
    settings = _settings(google_sc_service_account_json="  ", google_sc_property=" ", crux_api_key="  ")
    assert settings.search_console_enabled is False
    assert settings.crux_enabled is False


@pytest.mark.parametrize("builder", [
    lambda account: "not json at all " + account.private_pem,
    lambda account: json.dumps([account.private_pem]),
    lambda account: json.dumps({"client_email": "reader@x.iam.gserviceaccount.com"}),
    lambda account: json.dumps({"private_key": account.private_pem}),
    lambda account: json.dumps({"client_email": "no-at-sign", "private_key": account.private_pem}),
    lambda account: json.dumps({"client_email": "reader@x.iam.gserviceaccount.com", "private_key": "plain secret text"}),
    lambda account: json.dumps({"client_email": 123, "private_key": account.private_pem}),
])
def test_invalid_service_account_json_is_rejected_without_echoing_it(builder):
    account = make_service_account()
    raw = builder(account)
    with pytest.raises(ValidationError) as exc:
        _settings(google_sc_service_account_json=raw, google_sc_property=PROPERTY)
    message = str(exc.value)
    assert "WEBSITE_GOOGLE_SC_SERVICE_ACCOUNT_JSON" in message
    assert account.private_pem not in message
    assert "BEGIN PRIVATE KEY" not in message
    assert "plain secret text" not in message
    assert "not json at all" not in message


@pytest.mark.parametrize("value", ["ivykidschool.com", "sc-domain:", "ftp://www.ivykidschool.com/", "sc-domain:bad domain.com", "https://"])
def test_property_must_be_domain_or_url_prefix(value):
    account = make_service_account()
    with pytest.raises(ValidationError, match="WEBSITE_GOOGLE_SC_PROPERTY"):
        _settings(google_sc_service_account_json=account.json_text, google_sc_property=value)


@pytest.mark.parametrize("value", ["sc-domain:ivykidschool.com", "https://www.ivykidschool.com/", "https://www.ivykidschool.com"])
def test_property_accepts_domain_and_url_prefix(value):
    account = make_service_account()
    settings = _settings(google_sc_service_account_json=account.json_text, google_sc_property=value)
    assert settings.google_sc_property == value


def test_secrets_are_hidden_from_repr():
    account = make_service_account()
    settings = _settings(
        google_sc_service_account_json=account.json_text, google_sc_property=PROPERTY, crux_api_key=CRUX_KEY
    )
    text = repr(settings) + str(settings)
    assert account.private_pem not in text
    assert "BEGIN PRIVATE KEY" not in text
    assert CRUX_KEY not in text
    assert settings.crux_enabled is True


def test_crux_origin_comes_from_the_public_site_setting():
    assert _settings(crux_api_key=CRUX_KEY).crux_origin is None
    assert _settings(crux_api_key=CRUX_KEY, admin_origin="https://admin.example.org/").crux_origin == "https://admin.example.org"
    both = _settings(crux_api_key=CRUX_KEY, admin_origin="https://admin.example.org", public_origin="https://www.example.org/")
    assert both.crux_origin == "https://www.example.org"
