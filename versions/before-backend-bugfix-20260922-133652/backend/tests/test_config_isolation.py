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


def test_reject_missing_test_dsn_in_test_environment():
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
