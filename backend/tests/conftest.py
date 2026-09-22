from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import service
from app.auth.models import Role, User
from app.campuses.models import Campus
from app.config import Settings
from app.main import create_app


MEDIA_FIXTURE_DIR = Path("/tmp/media-fixtures")


@pytest.fixture(scope="session", autouse=True)
def _ensure_media_fixtures() -> Path:
    """產生 test_media.py 需要的素材樣本。

    這些檔案原本是假設「已經存在於 /tmp/media-fixtures」，但 repo 裡沒有
    任何產生它們的腳本，所以在乾淨機器上（或 /tmp 被清過之後）整個 media
    測試檔會有 12 項直接失敗。改成測試自己產生，套件才是自給自足的。"""
    MEDIA_FIXTURE_DIR.mkdir(parents=True, exist_ok=True)

    jpg = MEDIA_FIXTURE_DIR / "test.jpg"
    png = MEDIA_FIXTURE_DIR / "test.png"
    fake = MEDIA_FIXTURE_DIR / "fake.jpg"
    mp4 = MEDIA_FIXTURE_DIR / "test.mp4"

    if not jpg.exists() or not png.exists():
        from PIL import Image

        # 測試會斷言 width/height 為 100x80，尺寸不能改。
        Image.new("RGB", (100, 80), (78, 184, 122)).save(jpg, "JPEG")
        Image.new("RGB", (100, 80), (45, 143, 90)).save(png, "PNG")

    if not fake.exists():
        # 副檔名是 .jpg 但內容是純文字，用來驗證「只信任實際解碼結果」。
        fake.write_bytes(b"this is not an image, just text pretending to be a jpeg\n" * 3)

    if not mp4.exists() and shutil.which("ffmpeg"):
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-f", "lavfi", "-i", "color=c=green:s=160x120:d=2",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", str(mp4),
            ],
            check=False,
            capture_output=True,
            timeout=60,
        )
    return MEDIA_FIXTURE_DIR


@pytest.fixture
def isolated_settings() -> Settings:
    return Settings(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )


def _test_settings() -> Settings:
    return Settings(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
        media_root="/tmp/ivy-website-test-media",
        notification_email_sink_dir="/tmp/ivy-website-test-mail",
    )


@pytest_asyncio.fixture
async def app():
    return create_app(_test_settings())


@pytest_asyncio.fixture(autouse=True)
async def _clean_tables(app):
    """每個測試前清空 users/sessions/user_campus_scopes（保留五校 seed），
    確保情境 fixture 彼此隔離，不共用交易假測併發。"""
    async with app.state.engine.begin() as conn:
        await conn.execute(
            text(
                "TRUNCATE TABLE sessions, user_campus_scopes, users, "
                "media_usages, media_variants, media_assets, "
                "site_release_entries, site_releases, site_state, "
                "content_revisions, content_items, "
                "audit_log_entries, analytics_events, site_settings, "
                "notification_deliveries, notification_inbox_items, "
                "reschedule_requests, parent_sessions, parent_access_tokens, "
                "outbox_messages, visit_request_events, visit_contact_notes, "
                "visit_requests, visit_slots, "
                "booking_configs RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    """限流器是 process 記憶體內的滑動窗口，會跨測試累積。測試共用同一個
    來源 IP 與少數幾個手機號碼，不重置的話後面的測試會被前面的測試擋掉。
    限流本身的行為由 test_rate_limits.py 明確驗證。"""
    from app.auth import service as auth_service
    from app.booking import routes as booking_routes
    from app.operations import analytics_service

    auth_service.reset_login_rate_limits()
    booking_routes._SUBMIT_LIMITER_BY_PHONE.clear()
    booking_routes._SUBMIT_LIMITER_BY_CLIENT.clear()
    analytics_service._CLICK_ATTEMPTS.clear()
    yield


@pytest_asyncio.fixture
async def db_session(app):
    async with app.state.session_factory() as session:
        yield session


async def _create_user(
    db: AsyncSession, email: str, password: str, role: Role, campus_keys: list[str] | None = None
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=service.hash_password(password),
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.flush()
    if campus_keys:
        await service.set_campus_scopes(db, user, campus_keys)
    await db.commit()
    return user


async def _logged_in_client(app, email: str, password: str) -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=app)
    client = httpx.AsyncClient(transport=transport, base_url="http://test")
    response = await client.post(
        "/api/website/v1/auth/login", json={"email": email, "password": password}
    )
    assert response.status_code == 200, response.text
    csrf_token = response.json()["csrf_token"]
    client.headers["x-csrf-token"] = csrf_token
    return client


@pytest_asyncio.fixture
async def public_client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def second_public_client(app):
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        yield client


@pytest_asyncio.fixture
async def admin_client(app, db_session):
    await _create_user(db_session, "admin@ivy.example", "super-admin-password-123", Role.SUPER_ADMIN)
    client = await _logged_in_client(app, "admin@ivy.example", "super-admin-password-123")
    yield client
    await client.aclose()


@pytest_asyncio.fixture
async def minghua_client(app, db_session):
    await _create_user(
        db_session,
        "minghua-admin@ivy.example",
        "minghua-admin-password-123",
        Role.CAMPUS_ADMIN,
        campus_keys=["minghua"],
    )
    client = await _logged_in_client(app, "minghua-admin@ivy.example", "minghua-admin-password-123")
    yield client
    await client.aclose()


@pytest.fixture
def failing_mail_adapter():
    class _FailingAdapter:
        def send(self, *, to: str, subject: str, body: str) -> None:
            raise RuntimeError("模擬寄信失敗")

    return _FailingAdapter()


@pytest.fixture
def recording_mail_adapter():
    class _RecordingAdapter:
        def __init__(self) -> None:
            self.sent: list[dict] = []

        def send(self, *, to: str, subject: str, body: str) -> None:
            self.sent.append({"to": to, "subject": subject, "body": body})

    return _RecordingAdapter()


@pytest_asyncio.fixture
async def run_outbox_once(db_session):
    from app.workers.runner import process_outbox_batch

    async def _run(mail_adapter):
        result = await process_outbox_batch(db_session, mail_adapter, limit=50)
        return result

    return _run


@pytest_asyncio.fixture
async def editor_client(app, db_session):
    await _create_user(
        db_session,
        "editor-yihua@ivy.example",
        "editor-yihua-password-123",
        Role.EDITOR,
        campus_keys=["yihua"],
    )
    client = await _logged_in_client(app, "editor-yihua@ivy.example", "editor-yihua-password-123")
    yield client
    await client.aclose()
