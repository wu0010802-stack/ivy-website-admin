"""總管理者系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）。

前半（Task 1）：各列的判斷，純函式與讀庫。後半（Task 2）：API、權限、測試信、總覽數字。"""

from __future__ import annotations

import asyncio
import json
import smtplib
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from app.admissions.geo.models import DATASETS, GeoDatasetStatus
from app.auth.models import Role
from app.booking.models import OutboxMessage, OutboxStatus
from app.content.models import ContentItem, ContentRevision, PublishJob
from app.media.models import MediaJob, MediaStatus
from app.notifications.email_adapter import EmailNotConfigured
from app.common import ratelimit
from app.operations import audit_service, system_status
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, freeze_rate_limit_clock, legacy_request
from tests.test_media_list_paging import _asset

NOW = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)


def _settings(app, **changes):
    # model_copy 不跑驗證：可以直接造出「production 沒設寄信」之類的組合。
    return app.state.settings.model_copy(update=changes)


def _by_key(items):
    return {item.key: item for item in items}


def _maintenance_loop(*, completed=None, clean=None, failed=(), started=None):
    return SimpleNamespace(last_completed_at=completed, last_clean_at=clean, last_failed_steps=list(failed), started_at=started)


def _geo_loop(*, running=True, last_run=None, started=None):
    return SimpleNamespace(running=running, last_run_at=last_run, started_at=started)


def _media_settings(app, mode="background"):
    return _settings(app, media_video_processing=mode)


def _media_loop(*, running=True):
    return SimpleNamespace(running=running, last_processed_at=NOW if running else None)


def _status(dataset: str, **fields) -> GeoDatasetStatus:
    return GeoDatasetStatus(dataset=dataset, **fields)


def _checked_days_ago(dataset: str, days: int) -> GeoDatasetStatus:
    """最近一次確認來源在 days 天前、上次換版更早（週期判斷看較新的那個）。"""
    return _status(dataset, label="x", synced_at=NOW - timedelta(days=90), checked_at=NOW - timedelta(days=days))


async def _media_job(db_session, name: str, status: str) -> None:
    media_id = await _asset(db_session, name, status=MediaStatus.READY)
    db_session.add(MediaJob(
        media_id=uuid.UUID(media_id), kind="process", status=status, next_attempt_at=NOW, created_at=NOW,
    ))
    await db_session.commit()


async def _failed_publish_job(db_session, *, acknowledged: bool = False) -> None:
    # 未處理條件要和 content_items 的 published_at 一起看，所以內容與版本都得有。
    item = ContentItem(id=uuid.uuid4(), kind=f"status_test_{uuid.uuid4().hex[:8]}", campus_key=None, latest_version=1)
    revision = ContentRevision(id=uuid.uuid4(), content_item_id=item.id, version=1, payload={}, created_at=NOW)
    db_session.add_all([item, revision])
    await db_session.flush()
    db_session.add(PublishJob(
        id=uuid.uuid4(), content_item_id=item.id, revision_id=revision.id, publish_at=NOW, status="failed",
        error="測試", created_at=NOW, finished_at=NOW, acknowledged_at=NOW if acknowledged else None,
    ))
    await db_session.commit()


def _outbox(visit_request_id: str, status: OutboxStatus) -> OutboxMessage:
    return OutboxMessage(
        id=uuid.uuid4(), visit_request_id=uuid.UUID(visit_request_id), kind="visit_request_created", payload={},
        created_at=NOW, next_attempt_at=NOW, status=status.value, attempts=5,
    )


# --- 對外服務設定 -------------------------------------------------------------


async def test_smtp_row_shows_host_and_sender_but_never_credentials(app):
    settings = _settings(
        app, smtp_host="smtp.example.com", smtp_port=465, smtp_security="ssl", smtp_from="noreply@ivy.example",
        smtp_username="smtp-user-secret", smtp_password="smtp-pass-secret",
    )
    smtp = _by_key(system_status.service_items(settings, policy_auto_run=False))["smtp"]
    assert smtp.level == "ok"
    assert smtp.detail == {"host": "smtp.example.com", "port": 465, "security": "ssl", "sender": "noreply@ivy.example"}


async def test_missing_smtp_is_attention_only_in_production(app):
    prod = _settings(app, environment="production", smtp_host=None, notification_email_sink_dir=None)
    assert _by_key(system_status.service_items(prod, policy_auto_run=False))["smtp"].level == "attention"
    sink = _settings(app, smtp_host=None, notification_email_sink_dir="/tmp/ivy-website-test-mail")
    row = _by_key(system_status.service_items(sink, policy_auto_run=False))["smtp"]
    assert (row.level, row.detail) == ("info", {"sink": True})
    bare = _settings(app, smtp_host=None, notification_email_sink_dir=None)
    assert _by_key(system_status.service_items(bare, policy_auto_run=False))["smtp"].level == "info"


async def test_optional_services_are_never_attention(app):
    rows = _by_key(system_status.service_items(_settings(app, turnstile_site_key=None, turnstile_secret_key=None), policy_auto_run=False))
    for key in ("line_messaging", "turnstile", "google_login", "line_login", "media_storage", "admissions", "geo_auto_sync", "retention_auto_run"):
        assert rows[key].level != "attention", key
    assert rows["turnstile"].detail == {"configured": False}
    on = _by_key(system_status.service_items(_settings(app, turnstile_site_key="site", turnstile_secret_key="secret"), policy_auto_run=False))
    assert on["turnstile"].level == "ok"
    assert rows["media_storage"].detail == {"storage": "local"}


async def test_switches_report_on_or_off(app):
    off = _by_key(system_status.service_items(
        _settings(app, admissions_enabled=False, geo_auto_sync=True, retention_allow_real_run=True), policy_auto_run=False,
    ))
    assert off["admissions"].level == "off"
    # 招生關閉時同步迴圈不會啟動（main.py:148），所以算關閉。
    assert (off["geo_auto_sync"].level, off["geo_auto_sync"].detail) == ("off", {"enabled": False})
    assert (off["retention_auto_run"].level, off["retention_auto_run"].detail) == ("off", {"env_allowed": True, "policy_enabled": False})
    on = _by_key(system_status.service_items(
        _settings(app, admissions_enabled=True, geo_auto_sync=True, retention_allow_real_run=True), policy_auto_run=True,
    ))
    assert (on["admissions"].level, on["geo_auto_sync"].level, on["retention_auto_run"].level) == ("info", "info", "info")


# --- 背景工作 -------------------------------------------------------------------


async def test_maintenance_off_when_interval_is_zero(app):
    item = system_status.maintenance_item(_settings(app, background_jobs_interval_seconds=0), None, NOW)
    assert (item.level, item.detail) == ("off", {"running": False})


async def test_maintenance_ok_stalled_and_failed(app):
    settings = _settings(app, background_jobs_interval_seconds=60)
    ok = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW - timedelta(minutes=1), clean=NOW - timedelta(minutes=1)), NOW)
    assert ok.level == "ok"
    assert ok.detail["stale_minutes"] == 5
    stalled = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW - timedelta(minutes=6)), NOW)
    assert stalled.level == "attention" and stalled.detail["stalled"] is True
    failed = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW, failed=["outbox"]), NOW)
    assert failed.level == "attention" and failed.detail["failed_steps"] == ["outbox"] and failed.detail["stalled"] is False


async def test_maintenance_enabled_without_a_loop_is_attention(app):
    settings = _settings(app, background_jobs_interval_seconds=60)
    item = system_status.maintenance_item(settings, None, NOW)
    assert item.level == "attention" and item.detail["running"] is False and item.detail["stalled"] is True


async def test_maintenance_just_started_is_not_stalled(app):
    settings = _settings(app, background_jobs_interval_seconds=60)
    fresh = system_status.maintenance_item(settings, _maintenance_loop(started=NOW - timedelta(minutes=2)), NOW)
    assert fresh.level == "ok"
    never = system_status.maintenance_item(settings, _maintenance_loop(started=NOW - timedelta(minutes=6)), NOW)
    assert never.level == "attention" and never.detail["stalled"] is True


async def test_maintenance_threshold_follows_long_intervals(app):
    settings = _settings(app, background_jobs_interval_seconds=600)
    item = system_status.maintenance_item(settings, _maintenance_loop(completed=NOW - timedelta(minutes=40)), NOW)
    assert item.level == "ok" and item.detail["stale_minutes"] == 50


async def test_geo_loop_levels(app):
    assert system_status.geo_loop_item(_settings(app, geo_auto_sync=False), None, NOW).level == "off"
    settings = _settings(app, admissions_enabled=True, geo_auto_sync=True, geo_sync_check_seconds=86400)
    assert system_status.geo_loop_item(settings, None, NOW).level == "attention"
    assert system_status.geo_loop_item(settings, _geo_loop(running=False, started=NOW), NOW).level == "attention"
    ok = system_status.geo_loop_item(settings, _geo_loop(last_run=NOW - timedelta(hours=25), started=NOW - timedelta(days=3)), NOW)
    assert ok.level == "ok" and ok.detail["stale_hours"] == 26
    late = system_status.geo_loop_item(settings, _geo_loop(last_run=NOW - timedelta(hours=27), started=NOW - timedelta(days=3)), NOW)
    assert late.level == "attention" and late.detail["stalled"] is True
    # 剛啟動、第一輪還沒跑完（30 秒後才開始）：不算停擺。
    fresh = system_status.geo_loop_item(settings, _geo_loop(started=NOW - timedelta(minutes=1)), NOW)
    assert fresh.level == "ok"
    # 對照：啟動已超過門檻（3 天）卻還沒有任何一輪結果，不能一直當「剛啟動」放過。
    never_ran = system_status.geo_loop_item(settings, _geo_loop(started=NOW - timedelta(days=3)), NOW)
    assert never_ran.level == "attention" and never_ran.detail["stalled"] is True


async def test_media_failed_assets_are_attention_but_deleted_ones_are_not(app, db_session):
    settings, loop = _media_settings(app), _media_loop()
    assert (await system_status.media_item(db_session, settings, loop)).level == "ok"
    await _asset(db_session, "gone.mp4", status=MediaStatus.FAILED, deleted=True)
    assert (await system_status.media_item(db_session, settings, loop)).detail["failed_assets"] == 0
    await _asset(db_session, "broken.mp4", status=MediaStatus.FAILED)
    item = await system_status.media_item(db_session, settings, loop)
    assert item.level == "attention" and item.detail["failed_assets"] == 1


async def test_media_queue_counts_only_pending_and_running_jobs(app, db_session):
    await _media_job(db_session, "queued-1.mp4", "pending")
    await _media_job(db_session, "queued-2.mp4", "pending")
    await _media_job(db_session, "busy.mp4", "running")
    await _media_job(db_session, "finished.mp4", "done")
    await _media_job(db_session, "broken.mp4", "failed")
    item = await system_status.media_item(db_session, _media_settings(app), _media_loop())
    assert (item.detail["pending"], item.detail["running"]) == (2, 1)


async def test_media_loop_not_running_is_attention(app, db_session):
    dead = await system_status.media_item(db_session, _media_settings(app), _media_loop(running=False))
    assert dead.detail["loop_running"] is False and dead.level == "attention"
    missing = await system_status.media_item(db_session, _media_settings(app), None)
    assert missing.detail["loop_running"] is False and missing.level == "attention"
    assert (await system_status.media_item(db_session, _media_settings(app), _media_loop())).level == "ok"


async def test_media_inline_mode_has_no_queue_to_report(app, db_session):
    inline = await system_status.media_item(db_session, _media_settings(app, "inline"), None)
    assert (inline.level, inline.detail) == ("info", {"mode": "inline"})


async def test_old_failed_job_rows_do_not_keep_media_red(app, db_session):
    await _media_job(db_session, "fixed.mp4", "failed")
    settings, loop = _media_settings(app), _media_loop()
    item = await system_status.media_item(db_session, settings, loop)
    assert item.level == "ok" and item.detail["failed_assets"] == 0
    # 對照：素材本身是失敗狀態才會變紅。
    await _asset(db_session, "still-broken.mp4", status=MediaStatus.FAILED)
    assert (await system_status.media_item(db_session, settings, loop)).level == "attention"


async def test_loops_record_when_they_started(app):
    from app.workers.geo_loop import GeoSyncLoop
    from app.workers.maintenance import MaintenanceLoop

    for loop in (
        MaintenanceLoop(app.state.session_factory, app.state.settings, interval_seconds=3600),
        GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=86400),
    ):
        assert loop.started_at is None
        loop.start()
        try:
            assert loop.started_at is not None
        finally:
            await loop.stop()


# --- 公開資料 -------------------------------------------------------------------


async def test_doorplates_stale_after_35_days():
    fresh = system_status.dataset_item(
        "doorplates", _status("doorplates", label="115-10", synced_at=NOW - timedelta(days=34)), NOW, auto_sync=True,
    )
    assert fresh.level == "ok"
    # 門牌只看換版時間：最近確認過來源沒變也不算數（每月要手動匯入新版）。
    old = system_status.dataset_item(
        "doorplates", _status("doorplates", label="115-09", synced_at=NOW - timedelta(days=36), checked_at=NOW), NOW, auto_sync=True,
    )
    assert old.level == "attention" and old.detail["stale"] is True and old.detail["stale_days"] == 35


async def test_doorplate_error_is_attention_even_before_35_days():
    item = system_status.dataset_item(
        "doorplates", _status("doorplates", label="115-10", synced_at=NOW - timedelta(days=31), last_error="連不上 data.kcg.gov.tw"),
        NOW, auto_sync=True,
    )
    assert item.level == "attention"
    assert item.detail["stale"] is False and item.detail["error"] == "連不上 data.kcg.gov.tw"


@pytest.mark.parametrize(
    ("dataset", "ok_days", "stale_days"),
    [("population", 33, 34), ("births", 33, 34), ("income", 33, 34), ("kindergartens", 10, 11), ("babycare", 10, 11)],
)
async def test_other_datasets_use_refresh_plus_three_days(dataset, ok_days, stale_days):
    assert system_status.dataset_item(dataset, _checked_days_ago(dataset, ok_days), NOW, auto_sync=True).level == "ok"
    stale = system_status.dataset_item(dataset, _checked_days_ago(dataset, stale_days), NOW, auto_sync=True)
    assert stale.level == "attention" and stale.detail["stale"] is True


async def test_stale_dataset_is_only_info_when_auto_sync_is_off():
    row = _checked_days_ago("population", 34)
    off = system_status.dataset_item("population", row, NOW, auto_sync=False)
    # 沒開自動同步就不會有人去更新它：還是標示過期，但不算要注意（P-3）。
    assert off.level == "info" and off.detail["stale"] is True and off.detail["auto_sync_off"] is True
    on = system_status.dataset_item("population", row, NOW, auto_sync=True)
    assert on.level == "attention" and on.detail["stale"] is True and on.detail["auto_sync_off"] is False


async def test_dataset_error_is_attention_even_when_auto_sync_is_off():
    row = _status("population", label="115-09", synced_at=NOW, checked_at=NOW, last_error="HTTP 500")
    item = system_status.dataset_item("population", row, NOW, auto_sync=False)
    assert item.level == "attention" and item.detail["error"] == "HTTP 500" and item.detail["auto_sync_off"] is True


async def test_fresh_dataset_is_ok_whether_or_not_auto_sync_is_on():
    row = _checked_days_ago("population", 1)
    assert system_status.dataset_item("population", row, NOW, auto_sync=False).level == "ok"
    assert system_status.dataset_item("population", row, NOW, auto_sync=True).level == "ok"


async def test_stale_doorplates_stay_attention_when_auto_sync_is_off():
    old = _status("doorplates", label="115-09", synced_at=NOW - timedelta(days=36))
    item = system_status.dataset_item("doorplates", old, NOW, auto_sync=False)
    # 門牌本來就是手動匯入，自動同步開不開都一樣（S6、P4）。
    assert item.level == "attention" and item.detail["stale"] is True and item.detail["auto_sync_off"] is False


async def test_dataset_never_imported_is_info_unless_it_failed():
    assert system_status.dataset_item("income", None, NOW, auto_sync=True).level == "info"
    failed = system_status.dataset_item("income", _status("income", last_error="HTTP 503"), NOW, auto_sync=True)
    assert failed.level == "attention" and failed.detail == {"imported": False, "error": "HTTP 503", "stale": False}


async def test_dataset_error_is_attention_even_when_fresh():
    item = system_status.dataset_item(
        "kindergartens", _status("kindergartens", label="10/14", synced_at=NOW, checked_at=NOW, last_error="HTTP 500"),
        NOW, auto_sync=True,
    )
    assert item.level == "attention"


async def test_dataset_list_follows_backend_datasets(db_session):
    db_session.add(GeoDatasetStatus(dataset="doorplates", label="115-10", synced_at=NOW))
    await db_session.commit()
    items = await system_status.dataset_items(db_session, NOW, auto_sync=True)
    assert [item.key for item in items] == [name for name in DATASETS if name != "campuses"]
    assert items[0].detail["label"] == "115-10"


# --- 通知與發布、整頁 -------------------------------------------------------------


async def test_failed_outbox_messages_are_counted_but_not_attention(db_session):
    receipt = await legacy_request(db_session, status="confirmed")
    db_session.add_all([_outbox(receipt, OutboxStatus.FAILED), _outbox(receipt, OutboxStatus.SENT)])
    await db_session.commit()
    row = _by_key(await system_status.notification_items(db_session))["failed_outbox"]
    assert (row.level, row.detail) == ("info", {"count": 1})


async def test_failed_publish_jobs_count_only_the_unresolved_ones(db_session):
    assert _by_key(await system_status.notification_items(db_session))["failed_publish_jobs"].detail == {"count": 0}
    await _failed_publish_job(db_session)
    await _failed_publish_job(db_session, acknowledged=True)
    row = _by_key(await system_status.notification_items(db_session))["failed_publish_jobs"]
    assert (row.level, row.detail) == ("info", {"count": 1})


async def test_no_failures_means_notification_rows_are_ok(db_session):
    items = await system_status.notification_items(db_session)
    assert [(item.key, item.level, item.detail) for item in items] == [
        ("failed_outbox", "ok", {"count": 0}),
        ("failed_publish_jobs", "ok", {"count": 0}),
    ]


async def test_build_status_counts_attention_and_hides_datasets_when_admissions_off(app, db_session):
    state = SimpleNamespace(maintenance=None, media_jobs=None, geo_sync=None)
    off = _settings(
        app, environment="production", smtp_host=None, notification_email_sink_dir=None,
        background_jobs_interval_seconds=0, media_video_processing="inline", admissions_enabled=False,
        geo_auto_sync=False,
    )
    status = await system_status.build_status(db_session, state, off, NOW)
    assert status.datasets is None
    assert status.attention_count == 1  # 只有寄信沒設
    on = await system_status.build_status(
        db_session, state,
        _settings(
            app, admissions_enabled=True, geo_auto_sync=False, background_jobs_interval_seconds=0, media_video_processing="inline",
        ),
        NOW,
    )
    assert on.datasets is not None and len(on.datasets) == len(DATASETS) - 1
    assert on.generated_at == NOW
    assert on.attention_count == 0  # 非 production 沒設寄信、公開資料都還沒匯入：都只是資訊


async def test_build_status_downgrades_stale_datasets_when_auto_sync_is_off(app, db_session):
    db_session.add(GeoDatasetStatus(
        dataset="population", label="115-08", synced_at=NOW - timedelta(days=90), checked_at=NOW - timedelta(days=40),
    ))
    await db_session.commit()
    state = SimpleNamespace(maintenance=None, media_jobs=None, geo_sync=None)
    quiet = dict(admissions_enabled=True, background_jobs_interval_seconds=0, media_video_processing="inline")
    off = await system_status.build_status(db_session, state, _settings(app, geo_auto_sync=False, **quiet), NOW)
    assert _by_key(off.datasets)["population"].level == "info"
    on = await system_status.build_status(db_session, state, _settings(app, geo_auto_sync=True, **quiet), NOW)
    assert _by_key(on.datasets)["population"].level == "attention"


# --- API、權限、測試信、總覽（Task 2） --------------------------------------------

STATUS = "/api/website/v1/admin/system-status"
TEST_EMAIL = f"{STATUS}/test-email"
DASHBOARD = "/api/website/v1/admin/dashboard"


async def test_only_super_admin_can_read_system_status(app, admin_client, minghua_client, public_client, db_session):
    ok = await admin_client.get(STATUS)
    assert ok.status_code == 200, ok.text
    assert {"generated_at", "attention_count", "services", "background", "datasets", "notifications"} <= ok.json().keys()
    assert (await minghua_client.get(STATUS)).status_code == 403
    assert (await minghua_client.post(TEST_EMAIL)).status_code == 403
    await _create_user(db_session, "desk-status@ivy.example", "desk-status-password-1", Role.RECEPTION, ["yihua"])
    desk = await _logged_in_client(app, "desk-status@ivy.example", "desk-status-password-1")
    try:
        assert (await desk.get(STATUS)).status_code == 403
        assert (await desk.post(TEST_EMAIL)).status_code == 403
    finally:
        await desk.aclose()
    assert (await public_client.get(STATUS)).status_code == 401


async def test_status_response_never_contains_secrets(app, admin_client):
    secrets = {
        "smtp_username": "smtp-user-should-not-leak",
        "smtp_password": "smtp-pass-should-not-leak",
        "line_messaging_channel_secret": "line-secret-should-not-leak",
        "line_messaging_access_token": "line-token-should-not-leak",
        "turnstile_secret_key": "turnstile-secret-should-not-leak",
        "google_client_secret": "google-secret-should-not-leak",
        "line_channel_secret": "line-login-secret-should-not-leak",
        "s3_secret_access_key": "s3-secret-should-not-leak",
    }
    app.state.settings = _settings(app, **{
        **secrets,
        "smtp_host": "smtp.example.com",
        "smtp_from": "noreply@ivy.example",
        "turnstile_site_key": "site-key",
        "google_client_id": "google-id",
        "google_redirect_uri": "https://admin.example/api/website/v1/auth/google/callback",
    })
    response = await admin_client.get(STATUS)
    assert response.status_code == 200, response.text
    for value in secrets.values():
        assert value not in response.text
    smtp = next(item for item in response.json()["services"] if item["key"] == "smtp")
    assert smtp == {"key": "smtp", "level": "ok", "detail": {"host": "smtp.example.com", "port": 587, "security": "starttls", "sender": "noreply@ivy.example"}}


async def test_dashboard_has_system_attention_only_for_super_admin(admin_client, minghua_client):
    mine = await admin_client.get(DASHBOARD)
    assert mine.status_code == 200, mine.text
    assert isinstance(mine.json()["system_attention"], int)
    theirs = await minghua_client.get(DASHBOARD)
    assert theirs.json()["system_attention"] is None


async def test_dashboard_survives_a_failing_system_status(admin_client, monkeypatch):
    # 對照：沒壞的時候總管理者拿得到數字，下面壞掉之後才有「None 是因為查詢失敗」的意義。
    assert isinstance((await admin_client.get(DASHBOARD)).json()["system_attention"], int)

    async def broken(*args, **kwargs):
        raise RuntimeError("模擬系統狀態查詢失敗")

    monkeypatch.setattr(system_status, "build_status", broken)
    response = await admin_client.get(DASHBOARD)
    assert response.status_code == 200, response.text
    assert response.json()["system_attention"] is None
    assert "today_visits" in response.json()


@pytest.fixture
def mailer(monkeypatch, recording_mail_adapter):
    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: recording_mail_adapter)
    return recording_mail_adapter


async def _test_email_audits(db_session) -> list[AuditLogEntry]:
    rows = await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "system.test_email"))
    return list(rows.scalars())


async def test_test_email_goes_to_my_own_address_and_is_audited(admin_client, db_session, mailer):
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "error": None}
    [mail] = mailer.sent
    assert mail["to"] == "admin@ivy.example"
    assert mail["subject"] == "【常春藤官網後台】測試信"
    assert "寄出時間" in mail["body"]
    [entry] = await _test_email_audits(db_session)
    assert entry.metadata_json == {"result": "sent"}
    assert entry.target_type == "user"


@pytest.mark.parametrize(
    ("make_error", "kind"),
    [
        (lambda: smtplib.SMTPAuthenticationError(535, b"bad credentials"), "auth_failed"),
        (lambda: smtplib.SMTPRecipientsRefused({"admin@ivy.example": (550, b"no such user")}), "rejected"),
        (lambda: smtplib.SMTPSenderRefused(553, b"sender", "noreply@ivy.example"), "rejected"),
        (lambda: smtplib.SMTPConnectError(421, b"busy"), "connect_failed"),
        (lambda: ConnectionRefusedError(), "connect_failed"),
        (lambda: TimeoutError(), "timeout"),
        (lambda: RuntimeError("?"), "other"),
    ],
)
async def test_test_email_failure_reports_a_kind_not_the_raw_error(admin_client, db_session, monkeypatch, make_error, kind):
    error = make_error()

    class _Failing:
        def send(self, *, to: str, subject: str, body: str) -> None:
            raise error

    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: _Failing())
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": False, "error": kind}
    [entry] = await _test_email_audits(db_session)
    assert entry.metadata_json == {"result": "failed", "error_code": type(error).__name__}
    assert "admin@ivy.example" not in str(entry.metadata_json)


async def test_test_email_times_out(admin_client, db_session, monkeypatch):
    class _Slow:
        def send(self, *, to: str, subject: str, body: str) -> None:
            time.sleep(0.5)

    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: _Slow())
    monkeypatch.setattr(system_status, "TEST_EMAIL_TIMEOUT_SECONDS", 0.05)
    response = await admin_client.post(TEST_EMAIL)
    assert response.json() == {"ok": False, "error": "timeout"}
    [entry] = await _test_email_audits(db_session)
    assert entry.metadata_json == {"result": "failed", "error_code": "TimeoutError"}


async def test_test_email_without_any_mail_channel_is_409(admin_client, monkeypatch):
    def _none(settings):
        raise EmailNotConfigured("沒有寄信管道")

    monkeypatch.setattr(system_status, "mail_adapter", _none)
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "EMAIL_NOT_CONFIGURED"


async def test_test_email_outside_production_can_use_the_local_sink(app, admin_client, tmp_path):
    sink = tmp_path / "sink"
    app.state.settings = _settings(app, environment="development", smtp_host=None, notification_email_sink_dir=str(sink))
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "error": None}
    [written] = sink.glob("*.json")
    assert json.loads(written.read_text(encoding="utf-8"))["to"] == "admin@ivy.example"


async def test_test_email_in_production_without_smtp_is_409_even_with_a_sink(app, admin_client, tmp_path):
    # 正式站沒設 SMTP 時，信不能默默寫進本機資料夾卻回「已寄出」（對照：上一個測試，非 production 可以用 sink）。
    sink = tmp_path / "sink"
    app.state.settings = _settings(app, environment="production", smtp_host=None, notification_email_sink_dir=str(sink))
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "EMAIL_NOT_CONFIGURED"
    assert not sink.exists()


async def test_test_email_outside_production_without_smtp_or_sink_is_409(app, admin_client):
    app.state.settings = _settings(app, environment="development", smtp_host=None, notification_email_sink_dir=None)
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "EMAIL_NOT_CONFIGURED"


async def test_test_email_is_limited_to_three_per_ten_minutes(app, admin_client, mailer):
    freeze_rate_limit_clock(app)
    for _ in range(3):
        assert (await admin_client.post(TEST_EMAIL)).status_code == 200
    blocked = await admin_client.post(TEST_EMAIL)
    assert blocked.status_code == 429
    assert int(blocked.headers["retry-after"]) > 0
    # 錯誤本文的 detail 另帶 request_id（main.py _error_body），只比對 code 與 message。
    detail = blocked.json()["detail"]
    assert (detail["code"], detail["message"]) == ("TEST_EMAIL_RATE_LIMITED", "測試信寄太多次了，請 10 分鐘後再試")
    assert len(mailer.sent) == 3


async def test_test_email_says_busy_when_the_rate_limiter_has_no_connection(app, admin_client, mailer, monkeypatch):
    async def unavailable(limit, key):
        raise ratelimit.RateLimiterUnavailable(5)

    monkeypatch.setattr(app.state.rate_limiter, "check", unavailable)
    response = await admin_client.post(TEST_EMAIL)
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "TEST_EMAIL_BUSY"
    assert response.headers["retry-after"] == "5"
    assert mailer.sent == []


async def test_test_email_does_not_hold_a_db_transaction_while_smtp_is_slow(admin_client, db_session, monkeypatch):
    # 寄信可以等 20 秒；這段時間請求的資料庫連線不能卡在「交易中」。寄信執行緒卡住時，從另一條連線看
    # pg_stat_activity 有沒有 idle in transaction。
    started, release = threading.Event(), threading.Event()

    class _Blocking:
        def send(self, *, to: str, subject: str, body: str) -> None:
            started.set()
            release.wait(timeout=10)

    monkeypatch.setattr(system_status, "mail_adapter", lambda settings: _Blocking())

    async def idle_in_transaction() -> list[str]:
        try:
            while not started.is_set():
                await asyncio.sleep(0.01)
            rows = await db_session.execute(text(
                "SELECT state FROM pg_stat_activity WHERE datname = current_database() "
                "AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'"
            ))
            return list(rows.scalars())
        finally:
            release.set()

    response, held = await asyncio.wait_for(asyncio.gather(admin_client.post(TEST_EMAIL), idle_in_transaction()), timeout=30)
    assert response.json() == {"ok": True, "error": None}
    assert started.is_set()
    assert held == []


async def test_test_email_result_survives_an_audit_write_failure(admin_client, db_session, mailer, monkeypatch):
    # 對照：正常寄一封有一筆紀錄。
    assert (await admin_client.post(TEST_EMAIL)).json() == {"ok": True, "error": None}
    assert len(await _test_email_audits(db_session)) == 1

    async def broken(*args, **kwargs):
        raise RuntimeError("模擬操作紀錄寫入失敗")

    monkeypatch.setattr(audit_service, "log_action", broken)
    response = await admin_client.post(TEST_EMAIL)
    # 信已經寄出，紀錄寫不進去不能讓畫面說「沒寄成功」。
    assert response.status_code == 200, response.text
    assert response.json() == {"ok": True, "error": None}
    assert len(mailer.sent) == 2
    assert len(await _test_email_audits(db_session)) == 1
