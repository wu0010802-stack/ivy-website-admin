from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_reject_existing_business_database():
    with pytest.raises(ValidationError, match="獨立"):
        Settings(
            database_url="postgresql://localhost/ivymanagement",
            environment="test",
            test_database_url="postgresql://localhost/ivy_website_test",
            session_secret="test-only-secret",
        )


def test_reject_test_dsn_not_marked_as_test():
    with pytest.raises(ValidationError, match="測試"):
        Settings(
            database_url="postgresql://localhost/ivy_website_dev",
            environment="test",
            test_database_url="postgresql://localhost/ivy_website_dev",
            session_secret="test-only-secret",
        )


def test_reject_missing_test_dsn_in_test_environment(monkeypatch):
    monkeypatch.delenv("WEBSITE_TEST_DATABASE_URL", raising=False)
    with pytest.raises(ValidationError, match="WEBSITE_TEST_DATABASE_URL"):
        Settings(
            database_url="postgresql://localhost/ivy_website_dev",
            environment="test",
            session_secret="test-only-secret",
        )


def test_reject_weak_or_missing_session_secret():
    with pytest.raises(ValidationError, match="SESSION_SECRET"):
        Settings(
            database_url="postgresql://localhost/ivy_website_dev",
            environment="development",
            session_secret="short",
        )


def test_reject_fixture_in_production():
    with pytest.raises(ValidationError, match="production"):
        Settings(
            database_url="postgresql://localhost/ivy_website_dev",
            environment="production",
            session_secret="production-secret-value-123",
            enable_fixture=True,
        )


def test_error_messages_never_contain_secret():
    secret = "super-secret-value-should-not-leak"
    try:
        Settings(
            database_url="postgresql://localhost/ivymanagement",
            environment="test",
            test_database_url="postgresql://localhost/ivy_website_test",
            session_secret=secret,
        )
    except ValidationError as exc:
        assert secret not in str(exc)
    else:
        pytest.fail("應該拒絕啟動")


def test_valid_settings_construct_successfully():
    settings = Settings(
        database_url="postgresql://localhost/ivy_website_dev",
        environment="test",
        test_database_url="postgresql://localhost/ivy_website_test",
        session_secret="test-only-secret",
    )
    assert settings.active_database_url() == "postgresql://localhost/ivy_website_test"
    assert settings.indexing_enabled is False
    assert settings.enable_fixture is False


@pytest.mark.parametrize("overrides", [
    {"google_client_id": "test-client"},
    {"google_redirect_uri": "http://example.org/api/website/v1/auth/google/callback"},
    {"google_redirect_uri": "https://example.org/wrong"},
    {"google_redirect_uri": "https://example.org/api/website/v1/auth/google/callback?next=outside"},
    {"admin_origin": "https://another.example.org"},
])
def test_google_config_rejects_partial_or_unsafe_settings(overrides):
    google = {
        "google_client_id": "test-client", "google_client_secret": "never-print-this-test-secret",
        "google_redirect_uri": "https://example.org/api/website/v1/auth/google/callback",
    }
    if overrides == {"google_client_id": "test-client"}:
        google = overrides
    else:
        google.update(overrides)
    with pytest.raises(ValidationError) as exc:
        Settings(database_url="postgresql://localhost/ivy_website_test", session_secret="test-session-secret", **google)
    assert "never-print-this-test-secret" not in str(exc.value)


def test_google_config_accepts_https_and_hides_secret():
    settings = Settings(
        database_url="postgresql://localhost/ivy_website_test", session_secret="test-session-secret",
        environment="production", admin_origin="https://example.org",
        google_client_id="test-client", google_client_secret="never-print-this-test-secret",
        google_redirect_uri="https://example.org/api/website/v1/auth/google/callback",
    )
    assert settings.google_oauth_enabled
    assert "never-print-this-test-secret" not in repr(settings)
