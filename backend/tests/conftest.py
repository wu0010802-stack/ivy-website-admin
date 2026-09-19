from __future__ import annotations

import os

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

import pytest

from app.config import Settings


@pytest.fixture
def isolated_settings() -> Settings:
    """階段 A 使用的最小隔離設定；真正的 admin/public client fixtures
    （public_client、admin_client、minghua_client、editor_client、
    inquiry_payload、slot_payload、db_session 等，見計畫 Task 1 契約段落）
    待 Task 3 起隨 auth/campuses/booking 一併補上，此處先提供設定層驗證。"""
    return Settings(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
