"""總管理者系統狀態頁（2026-10-15 規格 docs/specs/2026-10-15-admin-system-status-design.md）。

前半（Task 1）：各列的判斷，純函式與讀庫。後半（Task 2）：API、權限、測試信、總覽數字。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.admissions.geo.models import DATASETS, GeoDatasetStatus
from app.booking.models import OutboxMessage, OutboxStatus
from app.content.models import ContentItem, ContentRevision, PublishJob
from app.media.models import MediaJob, MediaStatus
from app.operations import system_status
from tests.conftest import legacy_request
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
    )
    status = await system_status.build_status(db_session, state, off, NOW)
    assert status.datasets is None
    assert status.attention_count == 1  # 只有寄信沒設
    on = await system_status.build_status(
        db_session, state, _settings(app, admissions_enabled=True, background_jobs_interval_seconds=0, media_video_processing="inline"), NOW,
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
