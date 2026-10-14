"""家長管理連結與 session 的撤權交錯（2026-10-13 深度掃描 1、5、7、10、11 項）。

這幾條都是「先檢查、後動作」之間被園方的更正或換發插進來；測試用真的並發重現，不 mock 資料庫：
  1. 寄信 worker 讀到舊 Email 後，園方更正 Email 並換發連結，新連結不能寄回舊信箱；
  5. 家長異動通過 session 初驗後卡在案件列鎖上，園方撤銷存取，鎖後必須回 401；
  7. 家長自己更正信箱，誤寄對象手上的連結與 session 要一併作廢（家長自己的 session 留著）；
 10. 送單重播回傳連結用一次查詢，不能在兩個查詢之間取到園方剛換發的新連結；
 11. 連結到期但 session 還活著時，園方更正或清空 Email 也要撤銷 session。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select, text, update

from app.booking import access_service, workflow_service
from app.booking.access_models import ParentAccessToken, ParentSession
from app.booking.models import VisitRequest, VisitRequestStatus
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, open_manage
from tests.test_booking_stale_reads import _wait_until_blocked

pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1"
ORIGIN = "https://www.ivy.example"


def _token_of(manage_path: str) -> str:
    return manage_path.split("token=", 1)[1]


async def _run_worker(db_session, app, adapter):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


async def _active_link(app, receipt: str) -> str | None:
    async with app.state.session_factory() as db:
        return await access_service.current_manage_path(
            db, uuid.UUID(receipt), secret=app.state.settings.session_secret
        )


# ---------------------------------------------------------------------------
# 1. 寄信 worker：收件人與連結要是同一個世代
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_old_address_never_gets_the_link_issued_by_a_concurrent_email_correction(
    app, admin_client, public_client, db_session, recording_mail_adapter, monkeypatch
):
    booked = await book_slot(admin_client, public_client, email="old@example.com", idempotency_key="race-mail-01")
    receipt = booked["receipt_id"]

    reached, go = asyncio.Event(), asyncio.Event()
    original = access_service.current_manage_path

    async def paused(db, visit_request_id, *, secret):
        # worker 已經讀完案件（含 Email）、正要查「目前有效連結」：停在這裡，讓園方的更正插進來。
        reached.set()
        await go.wait()
        return await original(db, visit_request_id, secret=secret)

    monkeypatch.setattr(access_service, "current_manage_path", paused)
    worker = asyncio.create_task(_run_worker(db_session, app, recording_mail_adapter))
    await asyncio.wait_for(reached.wait(), 10)

    correction = asyncio.create_task(
        admin_client.patch(f"{BASE}/admin/visit-requests/{receipt}/details", json={"expected_version": 1, "email": "new@example.com"})
    )
    await asyncio.sleep(0.5)  # 沒有修正時，更正在這段時間就會 commit 完
    go.set()
    await asyncio.wait_for(worker, 20)
    response = await asyncio.wait_for(correction, 20)
    assert response.status_code == 200, response.text

    replacement = await _active_link(app, receipt)
    assert replacement is not None and replacement != booked["manage_path"]
    to_old = [mail for mail in recording_mail_adapter.sent if mail["to"] == "old@example.com"]
    assert to_old, "worker 讀到舊 Email 時，確認信照寄（連結在更正時已撤銷）"
    assert all(replacement not in mail["body"] for mail in to_old), "新連結不能寄到舊信箱"

    monkeypatch.undo()
    await _run_worker(db_session, app, recording_mail_adapter)
    to_new = [mail for mail in recording_mail_adapter.sent if mail["to"] == "new@example.com"]
    assert len(to_new) == 1 and f"{ORIGIN}{replacement}" in to_new[0]["body"]


# ---------------------------------------------------------------------------
# 5. 家長異動：鎖後重驗 session
# ---------------------------------------------------------------------------


async def _revoke_while_request_waits(app, receipt: str, request):
    """另一個交易鎖住案件、撤銷存取但還沒 commit；這時送出 request，等它卡在鎖上才讓撤銷 commit。"""
    async with app.state.session_factory() as other:
        visit = await other.get(VisitRequest, uuid.UUID(receipt))
        await workflow_service.lock_status(other, visit)
        await access_service.revoke_access_for_visit_request(other, visit.id)
        task = asyncio.create_task(request)
        await _wait_until_blocked(app, task)
        await other.commit()
    return await task


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["cancel", "details", "reschedule"])
async def test_parent_change_that_passed_the_session_check_is_refused_after_access_was_revoked(
    app, admin_client, public_client, db_session, action
):
    booked = await book_slot(admin_client, public_client, email="parent@example.com", idempotency_key=f"race-s-{action}")
    receipt = booked["receipt_id"]
    await open_manage(public_client, booked["manage_path"])
    other_slot = await create_slot(admin_client, days_ahead=6)

    manage = f"{BASE}/public/visit-manage"
    request = {
        "cancel": lambda: public_client.post(f"{manage}/cancel", json={"visit_request_id": receipt}),
        "details": lambda: public_client.patch(
            f"{manage}/me", json={"visit_request_id": receipt, "expected_version": 1, "email": "attacker@example.com"}
        ),
        "reschedule": lambda: public_client.post(f"{manage}/reschedule", json={"visit_request_id": receipt, "slot_id": other_slot}),
    }[action]()
    response = await _revoke_while_request_waits(app, receipt, request)

    assert response.status_code == 401, response.text
    db_session.expire_all()
    visit = await db_session.get(VisitRequest, uuid.UUID(receipt))
    assert visit.status == VisitRequestStatus.CONFIRMED.value
    assert str(visit.slot_id) == booked["slot_id"]
    assert visit.email == "parent@example.com"
    assert await _active_link(app, receipt) is None, "撤銷後不能因為舊請求又長出新連結"


@pytest.mark.asyncio
async def test_revoke_access_waits_for_the_case_lock_before_touching_any_row(app, admin_client, public_client):
    """revoke-access 要先鎖案件列再撤銷：案件列鎖被別人握著時，它得在動任何 token／session 之前就排隊。
    沒鎖的話撤銷的 UPDATE 會先落在 session 列上（未 commit），卡在鎖上的家長異動重驗時讀得到舊值。
    用 FOR UPDATE NOWAIT 探測：session 列沒被它碰過才拿得到。"""
    booked = await book_slot(admin_client, public_client, email="parent@example.com", idempotency_key="race-revoke-lock")
    receipt = booked["receipt_id"]
    await open_manage(public_client, booked["manage_path"])
    async with app.state.session_factory() as other:
        visit = await other.get(VisitRequest, uuid.UUID(receipt))
        await workflow_service.lock_status(other, visit)
        revoke = asyncio.create_task(admin_client.post(f"{BASE}/admin/visit-requests/{receipt}/revoke-access"))
        await _wait_until_blocked(app, revoke)
        async with app.state.engine.begin() as probe:
            rows = await probe.execute(
                text("SELECT id FROM parent_sessions WHERE visit_request_id = :id FOR UPDATE NOWAIT"), {"id": receipt}
            )
            assert rows.all(), "探測的案件應該有 session"
        await other.commit()
    assert (await revoke).status_code == 204


# ---------------------------------------------------------------------------
# 7. 家長自己更正信箱
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parent_correcting_the_email_cuts_off_the_old_recipient_but_not_themselves(
    app, admin_client, public_client, second_public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client, email="typo@example.com", idempotency_key="race-parent-email")
    receipt = booked["receipt_id"]
    old_token = _token_of(booked["manage_path"])
    await open_manage(public_client, booked["manage_path"])  # 真正的家長
    await open_manage(second_public_client, booked["manage_path"])  # 誤寄信箱的持有人

    response = await public_client.patch(
        f"{BASE}/public/visit-manage/me",
        json={"visit_request_id": receipt, "expected_version": 1, "email": "right@example.com"},
    )
    assert response.status_code == 200, response.text

    assert (await second_public_client.get(f"{BASE}/public/visit-manage/me")).status_code == 401, "舊收件人的 session 要失效"
    assert (await public_client.get(f"{BASE}/public/visit-manage/me")).status_code == 200, "家長自己的 session 不被登出"
    again = await second_public_client.post(f"{BASE}/public/visit-manage/exchange", json={"token": old_token})
    assert again.status_code == 401, "舊連結要失效"

    replacement = await _active_link(app, receipt)
    assert replacement is not None and _token_of(replacement) != old_token
    await _run_worker(db_session, app, recording_mail_adapter)
    # 排隊中的確認信與變更信都在寄件當下讀 Email，兩封都寄到新信箱，帶的都是新連結。
    to_right = [mail for mail in recording_mail_adapter.sent if mail["to"] == "right@example.com"]
    assert to_right and all(f"{ORIGIN}{replacement}" in mail["body"] for mail in to_right)
    assert all(old_token not in mail["body"] for mail in to_right)
    assert not [mail for mail in recording_mail_adapter.sent if mail["to"] == "typo@example.com"]


@pytest.mark.asyncio
async def test_parent_editing_other_fields_keeps_the_link_and_every_session(
    app, admin_client, public_client, second_public_client
):
    booked = await book_slot(admin_client, public_client, email="parent@example.com", idempotency_key="race-parent-name")
    receipt = booked["receipt_id"]
    await open_manage(public_client, booked["manage_path"])
    await open_manage(second_public_client, booked["manage_path"])

    response = await public_client.patch(
        f"{BASE}/public/visit-manage/me",
        json={"visit_request_id": receipt, "expected_version": 1, "parent_name": "陳爸爸"},
    )

    assert response.status_code == 200, response.text
    assert (await second_public_client.get(f"{BASE}/public/visit-manage/me")).status_code == 200
    assert await _active_link(app, receipt) == booked["manage_path"]


# ---------------------------------------------------------------------------
# 10. 送單重播
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replay_link_is_decided_in_a_single_query(app, admin_client, public_client):
    """先數筆數、再另查「目前有效連結」是兩個查詢，中間被換發就會回新連結；現在一次查完再判斷。"""
    booked = await book_slot(admin_client, public_client, email="parent@example.com", idempotency_key="race-replay")
    statements: list[str] = []

    def count(conn, cursor, statement, parameters, context, executemany):
        if "parent_access_tokens" in statement:
            statements.append(statement)

    engine = app.state.engine.sync_engine
    event.listen(engine, "before_cursor_execute", count)
    try:
        async with app.state.session_factory() as db:
            path = await access_service.original_manage_path(
                db, uuid.UUID(booked["receipt_id"]), secret=app.state.settings.session_secret
            )
    finally:
        event.remove(engine, "before_cursor_execute", count)

    assert path == booked["manage_path"]
    assert len(statements) == 1


@pytest.mark.asyncio
async def test_replay_after_the_link_was_regenerated_or_expired_returns_nothing(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, email="parent@example.com", idempotency_key="race-replay-2")
    receipt = uuid.UUID(booked["receipt_id"])
    secret = app.state.settings.session_secret

    await db_session.execute(
        update(ParentAccessToken).where(ParentAccessToken.visit_request_id == receipt).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()
    assert await access_service.original_manage_path(db_session, receipt, secret=secret) is None

    await db_session.execute(update(ParentAccessToken).where(ParentAccessToken.visit_request_id == receipt).values(expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
    await db_session.commit()
    assert await access_service.original_manage_path(db_session, receipt, secret=secret) == booked["manage_path"]
    regenerated = await admin_client.post(f"{BASE}/admin/visit-requests/{receipt}/access-link")
    assert regenerated.status_code == 200, regenerated.text
    db_session.expire_all()
    assert await access_service.original_manage_path(db_session, receipt, secret=secret) is None


# ---------------------------------------------------------------------------
# 11. 連結已到期、session 還活著
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("correction", [{"email": "new@example.com"}, {"email": None}], ids=["corrected", "cleared"])
async def test_email_correction_revokes_sessions_even_after_the_link_expired(
    app, admin_client, public_client, second_public_client, db_session, correction
):
    booked = await book_slot(admin_client, public_client, email="typo@example.com", idempotency_key=f"race-expired-{len(correction)}-{correction['email']}")
    receipt = booked["receipt_id"]
    await open_manage(second_public_client, booked["manage_path"])  # 連結到期前換到的 session
    await db_session.execute(
        update(ParentAccessToken).where(ParentAccessToken.visit_request_id == uuid.UUID(receipt)).values(expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()
    assert (await second_public_client.get(f"{BASE}/public/visit-manage/me")).status_code == 200

    response = await admin_client.patch(
        f"{BASE}/admin/visit-requests/{receipt}/details", json={"expected_version": 1, **correction}
    )

    assert response.status_code == 200, response.text
    assert (await second_public_client.get(f"{BASE}/public/visit-manage/me")).status_code == 401


@pytest.mark.asyncio
async def test_first_time_email_does_not_touch_existing_sessions(
    app, admin_client, public_client, second_public_client, db_session
):
    """原本沒有 Email（連結是園方直接交給家長的），補填 Email 不撤銷任何東西。"""
    booked = await book_slot(admin_client, public_client, idempotency_key="race-first-email")
    receipt = booked["receipt_id"]
    await open_manage(second_public_client, booked["manage_path"])
    await db_session.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt)).values(email=None))
    await db_session.commit()

    response = await admin_client.patch(
        f"{BASE}/admin/visit-requests/{receipt}/details", json={"expected_version": 1, "email": "first@example.com"}
    )

    assert response.status_code == 200, response.text
    assert (await second_public_client.get(f"{BASE}/public/visit-manage/me")).status_code == 200


@pytest.mark.asyncio
async def test_session_never_outlives_the_link_it_was_exchanged_from(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, email="parent@example.com", idempotency_key="race-session-ttl")
    receipt = uuid.UUID(booked["receipt_id"])
    soon = datetime.now(timezone.utc) + timedelta(minutes=10)
    await db_session.execute(update(ParentAccessToken).where(ParentAccessToken.visit_request_id == receipt).values(expires_at=soon))
    await db_session.commit()

    await open_manage(public_client, booked["manage_path"])

    sessions = (await db_session.execute(select(ParentSession).where(ParentSession.visit_request_id == receipt))).scalars().all()
    assert len(sessions) == 1 and sessions[0].expires_at <= soon
