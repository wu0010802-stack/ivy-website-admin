from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage, OutboxStatus, VisitRequest
from app.workers import lease_service
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot


# 預約表單要有已發布的同意文字（切 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")


async def _book_and_get_id(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    return booked["receipt_id"]


async def _created_message(db_session) -> OutboxMessage:
    """園方「新的參觀需求」那一筆（家長信與已確認通知不在此列）。"""
    result = await db_session.execute(
        select(OutboxMessage).where(OutboxMessage.kind == "visit_request_created")
    )
    return result.scalars().one()


@pytest.mark.asyncio
async def test_mail_failure_does_not_lose_request(
    admin_client, public_client, run_outbox_once, failing_mail_adapter, db_session
):
    from uuid import UUID

    receipt_id = await _book_and_get_id(admin_client, public_client)

    result = await run_outbox_once(failing_mail_adapter)
    # 園方兩則（新需求、已確認）加家長確認信，寄信全數失敗。
    assert result["failed"] == 3

    request = await db_session.get(VisitRequest, UUID(receipt_id))
    assert request is not None
    assert request.status == "confirmed"  # 案件本身完全不受通知失敗影響


@pytest.mark.asyncio
async def test_failed_job_is_retried_and_succeeds_later(
    admin_client, public_client, run_outbox_once, failing_mail_adapter, recording_mail_adapter, db_session
):
    await _book_and_get_id(admin_client, public_client)

    first = await run_outbox_once(failing_mail_adapter)
    assert first["failed"] == 3

    # 還沒到 next_attempt_at，這時用好的 adapter 重跑也不該被認領到。
    message = await _created_message(db_session)
    assert message.status == OutboxStatus.PENDING.value
    assert message.attempts == 1
    assert message.next_attempt_at > datetime.now(timezone.utc)

    # 手動把 next_attempt_at 往前調，模擬時間到了（測試不用真的等 10 秒）。
    message.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    second = await run_outbox_once(recording_mail_adapter)
    assert second["sent"] == 1
    assert len(recording_mail_adapter.sent) == 1  # 只會有一份對應通知，不會重複

    await db_session.refresh(message)
    assert message.status == OutboxStatus.SENT.value


@pytest.mark.asyncio
async def test_max_attempts_marks_failed_for_manual_retry(
    admin_client, public_client, db_session, failing_mail_adapter
):
    await _book_and_get_id(admin_client, public_client)

    message = await _created_message(db_session)

    for _ in range(lease_service.MAX_ATTEMPTS):
        message.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db_session.commit()
        await process_outbox_batch(db_session, failing_mail_adapter, limit=1)
        await db_session.refresh(message)

    assert message.status == OutboxStatus.FAILED.value
    assert message.attempts == lease_service.MAX_ATTEMPTS


@pytest.mark.asyncio
async def test_worker_crash_lease_recovers(admin_client, public_client, db_session, recording_mail_adapter):
    """模擬 worker 認領後沒有 ack 就當掉：租約過期後，另一個 worker
    應該能重新認領同一筆工作，不會卡死。"""
    await _book_and_get_id(admin_client, public_client)

    message = await lease_service.claim_next(db_session, worker_id="worker-crashed")
    assert message is not None
    await db_session.commit()

    # 模擬租約已過期（worker 當掉，沒有 ack 也沒有 fail）。
    message.leased_until = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    reclaimed = await lease_service.claim_next(db_session, worker_id="worker-2")
    assert reclaimed is not None
    assert reclaimed.id == message.id
    await lease_service.ack(db_session, reclaimed)
    await db_session.commit()

    await db_session.refresh(message)
    assert message.status == OutboxStatus.SENT.value


@pytest.mark.asyncio
async def test_notification_inbox_scoped_by_campus(
    admin_client, minghua_client, public_client, run_outbox_once, recording_mail_adapter
):
    await _book_and_get_id(admin_client, public_client)
    await run_outbox_once(recording_mail_adapter)

    yihua_view = await admin_client.get("/api/website/v1/admin/notifications?campus_key=yihua")
    # 站內通知只有園方兩則（新需求、已確認）；家長確認信只寄 Email，不進收件匣。
    assert sorted(item["kind"] for item in yihua_view.json()) == [
        "visit_request_confirmed",
        "visit_request_created",
    ]

    minghua_view = await minghua_client.get("/api/website/v1/admin/notifications?campus_key=minghua")
    assert len(minghua_view.json()) == 0

    # minghua 沒有 yihua 的權限，查 yihua 的通知應該被擋。
    forbidden = await minghua_client.get("/api/website/v1/admin/notifications?campus_key=yihua")
    assert forbidden.status_code == 404


@pytest.mark.asyncio
async def test_inactive_user_excluded_from_recipients(
    admin_client, public_client, db_session, recording_mail_adapter, run_outbox_once
):
    from tests.conftest import _create_user
    from app.auth.models import Role

    other_admin = await _create_user(
        db_session, "other-super@ivy.example", "other-super-password-123", Role.SUPER_ADMIN
    )
    # 停權這個帳號
    me = await admin_client.get("/api/website/v1/admin/users")
    target = next(u for u in me.json() if u["email"] == "other-super@ivy.example")
    await admin_client.patch(
        f"/api/website/v1/admin/users/{target['id']}/active", json={"is_active": False}
    )

    await _book_and_get_id(admin_client, public_client)
    await run_outbox_once(recording_mail_adapter)

    recipients = [entry["to"] for entry in recording_mail_adapter.sent]
    assert "other-super@ivy.example" not in recipients
    assert "admin@ivy.example" in recipients
