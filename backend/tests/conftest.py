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
        test_database_url=os.environ.get(
            "WEBSITE_TEST_DATABASE_URL", "postgresql+asyncpg://localhost/ivy_website_test"
        ),
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
                "page_view_daily, web_vital_samples, "
                "notification_deliveries, notification_inbox_items, user_notifications, "
                "reschedule_requests, parent_sessions, parent_access_tokens, "
                "outbox_messages, visit_request_events, visit_contact_notes, "
                "visit_requests, visit_slots, visit_rules, visit_exceptions, publish_jobs, "
                "booking_configs, rate_limit_counters, line_campus_targets, line_groups, "
                "retention_policies, retention_runs "
                "RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest.fixture(autouse=True)
def _reset_process_caches():
    """限流計數在 rate_limit_counters，由 _clean_tables 每個測試清空；這裡
    只重置仍留在 process 記憶體內、會跨測試累積的節流與快取。"""
    from app.operations import traffic_service
    from app.media import service as media_service

    traffic_service._last_purge = None
    media_service._release_media_cache = None
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


VISIT_SUBMIT_PATH = "/api/website/v1/public/visit-requests"
TEST_CONSENT_TEXT = "我同意園方使用本次填寫的資料聯絡與安排參觀（測試）。"


class ParentClient(httpx.AsyncClient):
    """官網家長端。官網送參觀需求一定會帶參觀人數，以及當時看到的同意說明版本
    （公開預約設定的 consent_revision_id）；測試沒寫的就比照官網補上。要驗這兩個
    欄位的測試自己帶值（包括明確帶 None）。"""

    async def post(self, url, *args, **kwargs):  # type: ignore[override]
        body = kwargs.get("json")
        if str(url).endswith(VISIT_SUBMIT_PATH) and isinstance(body, dict):
            body = dict(body)
            body.setdefault("party_size", 2)
            if "consent_revision_id" not in body and body.get("campus_key"):
                config = await self.get(f"/api/website/v1/public/booking-config/{body['campus_key']}")
                if config.status_code == 200:
                    body["consent_revision_id"] = config.json().get("consent_revision_id")
            kwargs["json"] = body
        return await super().post(url, *args, **kwargs)


def parent_client(app) -> ParentClient:
    return ParentClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test", headers={"X-Ivy-Parent": "1"}
    )


@pytest_asyncio.fixture
async def public_client(app):
    async with parent_client(app) as client:
        yield client


@pytest_asyncio.fixture
async def second_public_client(app):
    async with parent_client(app) as client:
        yield client


async def publish_booking_consent(db: AsyncSession, **overrides) -> uuid.UUID:
    """發布一版「預約文案」（含同意文字）。啟用 inquiry／slots 與官網送單都要有
    已發布的同意文字；回傳 revision id。"""
    from app.content import service as content_service

    payload = {
        "cta_label": "預約參觀",
        "cta_label_en": "Book a Visit",
        "consent_text": TEST_CONSENT_TEXT,
        "banner_title_template": "歡迎預約參觀{campus}",
        "banner_body": "期待與你相遇。",
        "banner_button_label": "預約校園參觀",
        "privacy_title": "",
        "privacy_sections": [],
        **overrides,
    }
    item = await content_service.get_or_create_content_item(db, "booking_content", None)
    revision = await content_service.create_revision(db, item, payload, item.latest_version, None)
    await content_service.publish_revision(db, item, revision, None)
    await db.commit()
    return revision.id


@pytest_asyncio.fixture
async def booking_consent(db_session) -> uuid.UUID:
    """已發布的同意文字。預約相關的測試檔用 pytestmark 帶入。"""
    return await publish_booking_consent(db_session)


async def set_booking_mode(admin_client, campus_key: str = "yihua", **config) -> httpx.Response:
    """測試前置：把某校切到指定的預約方式（config 是 PATCH 的其餘欄位）。

    切到 slots 卻因為「沒有可預約場次也沒有每週規則」被擋時，補一條每週規則
    再送一次——很多測試是先開 slots 再建自己的場次。先建好場次的測試不會被補
    規則，不影響依規則產生時段、休假日這類要算場次數的測試。"""
    url = f"/api/website/v1/admin/booking-config/{campus_key}"
    current = await admin_client.get(url)
    body = {"expected_version": current.json()["version"], **config}
    response = await admin_client.patch(url, json=body)
    if (
        response.status_code == 400
        and config.get("mode") == "slots"
        and [r["code"] for r in response.json()["detail"].get("reasons", [])] == ["NO_SLOTS_OR_RULES"]
    ):
        await add_weekly_rule(admin_client, campus_key)
        response = await admin_client.patch(url, json=body)
    return response


async def add_weekly_rule(admin_client, campus_key: str = "yihua") -> None:
    """啟用 slots 需要官網可預約的場次或至少一條每週規則。先開 slots 再建場次
    的測試用這個補一條規則（不會自己產生場次，要等定期工作或手動產生）。"""
    current = (await admin_client.get(f"/api/website/v1/admin/visit-schedule/{campus_key}")).json()
    if current["rules"]:
        return
    response = await admin_client.put(
        f"/api/website/v1/admin/visit-schedule/{campus_key}",
        json={
            "expected_version": current["version"],
            "min_lead_hours": current["min_lead_hours"],
            "max_advance_days": current["max_advance_days"],
            "rules": [{"weekday": 5, "start_time": "09:00:00", "end_time": "10:00:00", "slot_minutes": 60, "capacity": 1}],
        },
    )
    assert response.status_code == 200, response.text


async def case_version(client, case_id: str) -> int:
    detail = await client.get(f"/api/website/v1/admin/visit-requests/{case_id}")
    assert detail.status_code == 200, detail.text
    return detail.json()["version"]


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
