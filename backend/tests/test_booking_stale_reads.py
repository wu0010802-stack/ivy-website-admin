"""取鎖之前讀到的場次，不能拿來判斷鎖之後才發生的事（2026-10-13 審查兩條）。

兩條都是交錯：另一個交易先持有案件列的鎖、把案件改到別的場次，請求在那之前已經讀過案件，
卡在鎖上，等對方 commit 之後才往下走。測試用真的並發重現，不 mock：
  1. 後台改家長 Email 時，連結的效期與要不要補發，要看改期之後的場次；
  2. 家長取消、改資料、再改期，期限要用鎖內讀到的場次判斷（園方剛把預約改到 24 小時內就不能再動）。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone
from datetime import time as clock_time

import pytest
from sqlalchemy import select, text
from sqlalchemy.orm import selectinload

from app.booking import access_service, workflow_service
from app.booking.history import SYSTEM
from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ
from tests.conftest import book_slot, create_slot

pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1"


async def _wait_until_blocked(app, task: asyncio.Task, *, seconds: float = 8.0) -> None:
    """等到有一條連線正在等鎖（請求已經讀完案件、卡在 FOR UPDATE）。請求自己先結束了就直接報它的結果。

    每次輪詢都開新連線：pg_stat_activity 在同一個交易裡會沿用第一次讀到的快照，用長開的 db_session 輪詢，
    之後出現的等待者永遠看不到，請求卻會在 lock_timeout（10 秒）後被取消回 500。"""
    for _ in range(int(seconds / 0.05)):
        if task.done():
            outcome = task.exception() or task.result()
            raise AssertionError(f"請求還沒卡到鎖就結束了：{outcome!r} {getattr(outcome, 'text', '')[:300]}")
        async with app.state.engine.connect() as conn:
            waiting = await conn.scalar(
                text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
            )
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("請求沒有卡在案件列鎖上，交錯沒有發生")


async def _reschedule_while_request_waits(app, db_session, receipt_id: str, new_slot_id: str, request):
    """另一個交易鎖住案件、改到 new_slot_id 但還沒 commit；這時送出 request（一個 awaitable），
    等它卡在鎖上才讓改期 commit。回傳 request 的結果。"""
    async with app.state.session_factory() as other:
        visit = (
            await other.execute(
                select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == uuid.UUID(receipt_id))
            )
        ).scalar_one()
        await workflow_service.reschedule(other, visit, uuid.UUID(new_slot_id), actor=SYSTEM)
        task = asyncio.create_task(request)
        await _wait_until_blocked(app, task)
        await other.commit()
    return await task


async def _move_slot_to(db_session, slot_id: str, starts: datetime) -> None:
    slot = await db_session.get(VisitSlot, uuid.UUID(slot_id))
    local = starts.astimezone(OPERATING_TZ)
    slot.slot_date = local.date()
    # 結束時間跟著放到當天最後，開始時間晚於原本的結束時間也不會違反「結束晚於開始」。
    slot.start_time = local.time().replace(second=0, microsecond=0, tzinfo=None)
    slot.end_time = clock_time(23, 59, 59)
    await db_session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("old_slot_started", [False, True], ids=["old-slot-ahead", "old-slot-started"])
async def test_staff_email_change_right_after_a_reschedule_uses_the_new_slot(
    app, admin_client, public_client, db_session, old_slot_started
):
    """園方同時改期（原場次 3 天後）與改 Email：新連結要照新場次（30 天後）算效期，不是最短 14 天；
    原場次已經開始時也要補發新連結並寄信，不能只撤銷。"""
    booked = await book_slot(
        admin_client, public_client, days_ahead=3, idempotency_key=f"stale-staff-{old_slot_started}", email="old@example.com"
    )
    receipt = booked["receipt_id"]
    link = await admin_client.post(f"{BASE}/admin/visit-requests/{receipt}/access-link")
    assert link.status_code == 200, link.text
    far_slot = await create_slot(admin_client, days_ahead=30)
    if old_slot_started:
        await _move_slot_to(db_session, booked["slot_id"], datetime.now(timezone.utc) - timedelta(days=1))

    patch = admin_client.patch(
        f"{BASE}/admin/visit-requests/{receipt}/details", json={"expected_version": 1, "email": "new@example.com"}
    )
    response = await _reschedule_while_request_waits(app, db_session, receipt, far_slot, patch)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["access_link_reset"] is True
    assert body["email_notified"] is True, "改期之後場次是 30 天後，要補發新連結並寄到新信箱"
    token = await access_service.active_access_token(db_session, uuid.UUID(receipt))
    assert token is not None, "舊連結撤銷之後必須有新連結"
    assert token.expires_at > datetime.now(timezone.utc) + timedelta(days=30), "效期要照新場次（30 天後）算，不是最短 14 天"


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["cancel", "details", "reschedule"])
async def test_parent_change_is_refused_when_the_visit_was_just_moved_inside_the_deadline(
    app, admin_client, public_client, db_session, action
):
    """已通過期限檢查的家長請求，卡在鎖上等園方把預約改到 24 小時內：鎖內重讀場次，期限已過就 409，
    不能再取消、改資料或改期。"""
    booked = await book_slot(admin_client, public_client, days_ahead=3, idempotency_key=f"stale-parent-{action}")
    receipt = booked["receipt_id"]
    link = await admin_client.post(f"{BASE}/admin/visit-requests/{receipt}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    exchange = await public_client.post(f"{BASE}/public/visit-manage/exchange", json={"token": token})
    assert exchange.status_code == 200 and exchange.json()["can_cancel"] is True

    # 另開一個時段（和已預約的 10:00 錯開，不然 SLOT_DUPLICATE），再把它搬到 12 小時後。
    soon_slot = await create_slot(admin_client, days_ahead=3, start_time="14:00:00", end_time="15:00:00")
    await _move_slot_to(db_session, soon_slot, datetime.now(timezone.utc) + timedelta(hours=12))
    other_slot = await create_slot(admin_client, days_ahead=5)

    manage = f"{BASE}/public/visit-manage"
    request = {
        "cancel": lambda: public_client.post(f"{manage}/cancel", json={"visit_request_id": receipt}),
        "details": lambda: public_client.patch(
            f"{manage}/me", json={"visit_request_id": receipt, "expected_version": 1, "parent_name": "陳爸爸"}
        ),
        "reschedule": lambda: public_client.post(
            f"{manage}/reschedule", json={"visit_request_id": receipt, "slot_id": other_slot}
        ),
    }[action]()
    response = await _reschedule_while_request_waits(app, db_session, receipt, soon_slot, request)

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "CHANGE_DEADLINE_PASSED"
    db_session.expire_all()
    visit = await db_session.get(VisitRequest, uuid.UUID(receipt))
    assert visit.status == VisitRequestStatus.CONFIRMED.value
    assert str(visit.slot_id) == soon_slot, "園方改的場次維持不變，家長的請求什麼都沒改"
    assert visit.parent_name == "陳媽媽"
