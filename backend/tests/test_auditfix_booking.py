"""2026-10-20 稽核修正（預約與通知組）：
#02 停課日的預約成功／變更信、#04 場次使用情況的匿名灌寫、#07 最遠開放超過 60 天、
#08 寄信當下已過的修改期限、#09 重新產生連結在鎖內重讀場次。"""
from __future__ import annotations

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import select, update

from app.booking import slot_lookup, workflow_service
from app.booking.models import BookingConfig, SlotLookupDaily, VisitRequest
from app.common import ratelimit
from app.common.timezones import slot_start_utc, today_local
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, create_slot_record, open_manage, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
ORIGIN = "https://www.ivy.example"


def _enable_smtp(app) -> None:
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"


async def _run_outbox(db_session, app, adapter):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


async def _set_deadline_hours(admin_client, hours: int) -> None:
    config = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    patched = await admin_client.patch(
        f"{API}/admin/booking-config/yihua",
        json={"expected_version": config["version"], "mode": "slots", "parent_change_deadline_hours": hours},
    )
    assert patched.status_code == 200, patched.text


async def _close_day(admin_client, day: str) -> None:
    closed = await admin_client.post(
        f"{API}/admin/visit-closures",
        json={"closure_date": day, "campus_keys": ["yihua"], "reason": "颱風停班停課", "notify_parents": True, "dry_run": False},
    )
    assert closed.status_code in (200, 201), closed.text


async def _set_max_advance_days(db_session, days: int, campus_key: str = "yihua") -> None:
    await db_session.execute(
        update(BookingConfig).where(BookingConfig.campus_key == campus_key).values(max_advance_days=days)
    )
    await db_session.commit()


# ---------------------------------------------------------------------------
# #02 停課日：預約成功／變更信改寫成停課內容，不寫照常參觀與修改期限
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resend_and_new_link_on_a_closed_day_send_the_closure_wording(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    # 參觀前 14 天截止：一般期限早就過了，只有停課才讓家長還能線上改。
    await _set_deadline_hours(admin_client, 336)
    await _close_day(admin_client, booked["slot_date"])
    await _run_outbox(db_session, app, recording_mail_adapter)
    recording_mail_adapter.sent.clear()

    resent = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")
    assert resent.status_code == 202, resent.text
    relinked = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")
    assert relinked.status_code == 200, relinked.text
    await _run_outbox(db_session, app, recording_mail_adapter)

    mails = [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"]
    assert len(mails) == 2
    for mail in mails:
        assert mail["subject"].startswith("【常春藤義華】參觀日停課，請改約時間：")
        assert "參觀預約成功" not in mail["subject"] and "已變更" not in mail["subject"]
        assert "這天停課" in mail["body"]
        assert "期待與您見面" not in mail["body"]
        assert "前可以線上修改" not in mail["body"]
        assert f"{ORIGIN}/visit/manage#token=" in mail["body"]


@pytest.mark.asyncio
async def test_parent_edit_on_a_closed_day_mails_closure_wording(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    await _set_deadline_hours(admin_client, 336)
    await _close_day(admin_client, booked["slot_date"])
    await _run_outbox(db_session, app, recording_mail_adapter)
    recording_mail_adapter.sent.clear()

    me = await open_manage(public_client, booked["manage_path"])
    assert me["day_closed"] is True
    edited = await public_client.patch(
        f"{API}/public/visit-manage/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "child_name": "小明"},
    )
    assert edited.status_code == 200, edited.text
    await _run_outbox(db_session, app, recording_mail_adapter)

    (mail,) = [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"]
    assert mail["subject"].startswith("【常春藤義華】參觀日停課，請改約時間：")
    assert "這天停課" in mail["body"]
    assert "前可以線上修改" not in mail["body"]


# ---------------------------------------------------------------------------
# #08 寄信當下修改期限已過：不寫已過的截止時間、不附改不了的連結
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_booked_mail_does_not_promise_a_deadline_that_already_passed(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    _enable_smtp(app)
    await create_slot(admin_client, days_ahead=20, start_time="14:00:00", end_time="15:00:00")
    await _set_deadline_hours(admin_client, 336)
    # 三天後的場次：最短提前時間（24 小時）過得了，參觀前 14 天的修改期限送出時就已經過了。
    await book_slot(admin_client, public_client, days_ahead=3)
    await _run_outbox(db_session, app, recording_mail_adapter)

    (mail,) = [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"]
    assert mail["subject"].startswith("【常春藤義華】參觀預約成功")
    assert "前可以線上修改" not in mail["body"]
    assert "#token=" not in mail["body"]
    assert "已過線上修改期限" in mail["body"]


@pytest.mark.asyncio
async def test_booked_mail_keeps_the_deadline_while_it_is_still_open(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    _enable_smtp(app)
    await book_slot(admin_client, public_client, days_ahead=5)
    await _run_outbox(db_session, app, recording_mail_adapter)

    (mail,) = [m for m in recording_mail_adapter.sent if m["to"] == "parent@example.com"]
    assert "前可以線上修改" in mail["body"]
    assert f"{ORIGIN}/visit/manage#token=" in mail["body"]


# ---------------------------------------------------------------------------
# #09 重新產生連結：鎖內重讀場次，用改期後的場次算效期
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_new_link_expiry_uses_the_slot_read_inside_the_lock(
    app, admin_client, public_client, db_session, monkeypatch
):
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    later = await create_slot_record(admin_client, days_ahead=50, start_time="14:00:00", end_time="15:00:00")
    original_lock = workflow_service.lock_status

    async def lock_after_colleague_moved_it(db, visit_request):
        # 同事的改期在這個請求讀完案件、等鎖的空檔提交。
        await db_session.execute(
            update(VisitRequest).where(VisitRequest.id == visit_request.id).values(slot_id=later["id"])
        )
        await db_session.commit()
        await original_lock(db, visit_request)

    monkeypatch.setattr(workflow_service, "lock_status", lock_after_colleague_moved_it)
    response = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")
    assert response.status_code == 200, response.text

    from datetime import date, datetime, time

    later_start = slot_start_utc(date.fromisoformat(later["slot_date"]), time.fromisoformat(later["start_time"]))
    expires_at = datetime.fromisoformat(response.json()["expires_at"])
    assert expires_at >= later_start + timedelta(days=7)


# ---------------------------------------------------------------------------
# #07 最遠開放超過 60 天：官網、家長改期、後台都查得到 61 天以後的場次
# ---------------------------------------------------------------------------


def _window(days: int = 365) -> str:
    today = today_local()
    return f"date_from={today.isoformat()}&date_to={(today + timedelta(days=days)).isoformat()}"


@pytest.mark.asyncio
async def test_slots_beyond_60_days_are_listed_when_the_campus_opens_90_days(admin_client, public_client, db_session):
    far = await create_slot_record(admin_client, days_ahead=80)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    await _set_max_advance_days(db_session, 90)

    public = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window()}")
    assert public.status_code == 200, public.text
    assert far["id"] in {s["id"] for s in public.json()}

    staff = await admin_client.get(f"{API}/admin/slots?campus_key=yihua&{_window()}")
    assert staff.status_code == 200, staff.text
    assert far["id"] in {s["id"] for s in staff.json()}


@pytest.mark.asyncio
async def test_long_queries_stop_at_the_campus_window(admin_client, public_client, db_session):
    inside = await create_slot_record(admin_client, days_ahead=50)
    outside = await create_slot_record(admin_client, days_ahead=75)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    # 預設開放 60 天：查一整年也只查到開放範圍為止，75 天後那場不列。
    public = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window()}")
    assert public.status_code == 200, public.text
    assert {s["id"] for s in public.json()} >= {inside["id"]}
    assert outside["id"] not in {s["id"] for s in public.json()}
    staff = await admin_client.get(f"{API}/admin/slots?campus_key=yihua&{_window()}")
    assert staff.status_code == 200, staff.text
    assert outside["id"] not in {s["id"] for s in staff.json()}
    # 62 天以內的查詢照舊不截（後台月曆看得到開放範圍外加開的場次）。
    month = await admin_client.get(
        f"{API}/admin/slots?campus_key=yihua&date_from={(today_local() + timedelta(days=40)).isoformat()}"
        f"&date_to={(today_local() + timedelta(days=100)).isoformat()}"
    )
    assert month.status_code == 200, month.text
    assert outside["id"] in {s["id"] for s in month.json()}


@pytest.mark.parametrize("days_behind", [1, 2])
@pytest.mark.asyncio
async def test_a_query_starting_just_before_today_still_reads_the_90_day_window(
    admin_client, public_client, db_session, days_behind
):
    # 家長在午夜前打開表單、或手機／後台電腦時鐘慢一點：date_from 會比伺服器的今天早一兩天。
    far = await create_slot_record(admin_client, days_ahead=80)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    await _set_max_advance_days(db_session, 90)
    start = today_local() - timedelta(days=days_behind)
    query = f"campus_key=yihua&date_from={start.isoformat()}&date_to={(start + timedelta(days=365)).isoformat()}"

    public = await public_client.get(f"{API}/public/slots?{query}")
    assert public.status_code == 200, public.text
    assert far["id"] in {s["id"] for s in public.json()}
    staff = await admin_client.get(f"{API}/admin/slots?{query}")
    assert staff.status_code == 200, staff.text
    assert far["id"] in {s["id"] for s in staff.json()}


@pytest.mark.asyncio
async def test_far_past_wide_ranges_are_still_rejected(admin_client, public_client):
    past = today_local() - timedelta(days=400)
    query = f"campus_key=yihua&date_from={past.isoformat()}&date_to={today_local().isoformat()}"
    assert (await public_client.get(f"{API}/public/slots?{query}")).status_code == 400
    assert (await admin_client.get(f"{API}/admin/slots?{query}")).status_code == 400


# ---------------------------------------------------------------------------
# #04 場次使用情況：只記官網新預約表單的完整查詢，並有全站與每來源上限
# ---------------------------------------------------------------------------


async def _lookups(db_session) -> dict[tuple[str, str], int]:
    await db_session.rollback()
    return {(r.campus_key, r.bucket): r.lookups for r in (await db_session.scalars(select(SlotLookupDaily))).all()}


@pytest.mark.asyncio
async def test_lookup_is_recorded_only_for_the_full_window_starting_today(admin_client, public_client, db_session):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    today = today_local()
    far_future = (
        f"date_from={(today + timedelta(days=3000)).isoformat()}&date_to={(today + timedelta(days=3001)).isoformat()}"
    )
    assert (await public_client.get(f"{API}/public/slots?campus_key=yihua&{far_future}&purpose=new_booking")).status_code == 200
    short = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window(2)}&purpose=new_booking")
    assert short.status_code == 200
    backwards = f"date_from={today.isoformat()}&date_to={(today - timedelta(days=5)).isoformat()}"
    assert (await public_client.get(f"{API}/public/slots?campus_key=yihua&{backwards}&purpose=new_booking")).status_code == 200
    assert await _lookups(db_session) == {}

    full = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window()}&purpose=new_booking")
    assert full.status_code == 200 and len(full.json()) == 1
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 1}


@pytest.mark.asyncio
async def test_lookup_bucket_sees_slots_beyond_60_days(admin_client, public_client, db_session):
    # 先開到 90 天再切自選場次，set_booking_mode 才不會另外補一個 58 天的場次。
    assert (await admin_client.get(f"{API}/admin/booking-config/yihua")).status_code == 200
    await _set_max_advance_days(db_session, 90)
    await create_slot(admin_client, days_ahead=80)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window()}&purpose=new_booking")
    assert response.status_code == 200 and len(response.json()) == 1
    assert await _lookups(db_session) == {("yihua", "over_7"): 1}


@pytest.mark.asyncio
async def test_lookup_writes_stop_at_the_site_wide_cap(admin_client, public_client, db_session, monkeypatch):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    monkeypatch.setattr(slot_lookup, "LOOKUP_GLOBAL_PER_MINUTE", ratelimit.Limit("slot_lookup_global", 60, 2))
    for _ in range(4):
        response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window()}&purpose=new_booking")
        # 超過上限只是不記，家長照樣拿到場次。
        assert response.status_code == 200 and len(response.json()) == 1
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 2}


@pytest.mark.asyncio
async def test_lookup_writes_stop_at_the_per_source_daily_cap(admin_client, public_client, db_session, monkeypatch):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    monkeypatch.setattr(
        slot_lookup, "LOOKUP_SOURCE_DAILY", ratelimit.Limit("slot_lookup_source_daily", 86_400, 1, sliding=False)
    )
    monkeypatch.setattr(ratelimit, "trusted_client_ip", lambda request: "203.0.113.9")
    for _ in range(3):
        response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_window()}&purpose=new_booking")
        assert response.status_code == 200 and len(response.json()) == 1
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 1}


# ---------------------------------------------------------------------------
# 2026-10-20 稽核：停課與家長取消同時發生，已取消的案件不能再拿到新的修改連結
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_closure_skips_a_case_cancelled_after_it_was_listed(
    app, admin_client, public_client, db_session, monkeypatch
):
    from app.booking import closure_service
    from app.booking.models import VisitRequestEvent, VisitRequestStatus

    _enable_smtp(app)
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    case_id = uuid.UUID(booked["receipt_id"])
    original = closure_service._confirmed_visits

    async def listed_then_cancelled(db, campus_key, day):
        visits = await original(db, campus_key, day)
        # 列出之後、發連結之前，家長的取消先提交了（這裡用同一個連線模擬）。
        await db.execute(
            update(VisitRequest)
            .where(VisitRequest.id == case_id)
            .values(status=VisitRequestStatus.CANCELLED.value)
        )
        return visits

    monkeypatch.setattr(closure_service, "_confirmed_visits", listed_then_cancelled)
    await _close_day(admin_client, booked["slot_date"])

    events = (
        await db_session.execute(
            select(VisitRequestEvent.event_type).where(VisitRequestEvent.visit_request_id == case_id)
        )
    ).scalars().all()
    assert closure_service.CLOSURE_NOTICE_EVENT not in events


@pytest.mark.asyncio
async def test_manual_double_submit_racing_for_the_last_seat_replays_the_receipt(admin_client, monkeypatch):
    """2026-10-20 稽核：補登連點兩次，第二個請求開頭查重播時第一個還沒 commit；等到時段鎖時名額已被
    第一個占走，要回原收據（200），不能回 SLOT_FULL。"""
    from app.booking import service

    slot = await create_slot_record(admin_client, capacity=1)
    body = {"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912345678",
            "consent_given": True, "slot_id": slot["id"]}
    first = await admin_client.post(f"{API}/admin/visit-requests", json=body, headers={"Idempotency-Key": "manual-race"})
    assert first.status_code == 201, first.text

    original = service.find_replay
    calls = {"n": 0}

    async def stale_first_lookup(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            return None  # 開頭那次查詢時第一個請求還沒提交
        return await original(*args, **kwargs)

    monkeypatch.setattr(service, "find_replay", stale_first_lookup)
    second = await admin_client.post(f"{API}/admin/visit-requests", json=body, headers={"Idempotency-Key": "manual-race"})
    assert second.status_code == 200, second.text
    assert second.json()["id"] == first.json()["id"]
