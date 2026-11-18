import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import OutboxMessage
from app.content.models import ContentItem
from app.content.service import get_or_create_content_item
from app.notifications import service as notifications
from app.workers import lease_service
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot


@pytest.mark.parametrize("campus", [None, "yihua"])
async def test_concurrent_first_content_load_reuses_the_same_item(app, monkeypatch, campus):
    gate = asyncio.Barrier(2)
    original = AsyncSession.execute
    first_reads = set()

    async def execute(db, statement, *args, **kwargs):
        result = await original(db, statement, *args, **kwargs)
        if "FROM content_items" in str(statement) and db not in first_reads:
            first_reads.add(db)
            await asyncio.wait_for(gate.wait(), 5)
        return result

    async def open_editor():
        async with app.state.session_factory() as db:
            item = await get_or_create_content_item(db, "qa_initial_content", campus)
            await db.commit()
            return item.id

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "execute", execute)
        item_a, item_b = await asyncio.gather(open_editor(), open_editor())
    assert item_a == item_b
    async with app.state.session_factory() as db:
        assert await db.scalar(
            select(func.count()).select_from(ContentItem).where(
                ContentItem.kind == "qa_initial_content", ContentItem.campus_key == campus,
            )
        ) == 1


async def only_one_pending_message(db):
    message_id = await db.scalar(select(OutboxMessage.id).where(OutboxMessage.kind == "visit_request_created"))
    assert message_id is not None
    await db.execute(update(OutboxMessage).where(OutboxMessage.id != message_id).values(status="sent"))
    await db.commit()
    return message_id


async def expire_lease(db, message_id):
    await db.execute(update(OutboxMessage).where(OutboxMessage.id == message_id).values(
        leased_until=datetime.now(timezone.utc) - timedelta(seconds=1),
    ))
    await db.commit()


@pytest.mark.usefixtures("booking_consent")
async def test_expired_lease_cannot_start_second_dispatch_while_first_is_running(
    app, admin_client, public_client, db_session, monkeypatch,
):
    await book_slot(admin_client, public_client)
    message_id = await only_one_pending_message(db_session)
    started = asyncio.Event()
    resume = asyncio.Event()
    dispatches = []

    async def dispatch(db, *, outbox_message_id, **kwargs):
        dispatches.append(outbox_message_id)
        if len(dispatches) == 1:
            # 實際的 dispatcher 送完一個管道就提交，再處理下一個。
            await db.scalar(select(OutboxMessage.id).where(OutboxMessage.id == outbox_message_id))
            await db.commit()
            started.set()
            await asyncio.wait_for(resume.wait(), 10)
        return True

    monkeypatch.setattr(notifications, "dispatch_outbox_message", dispatch)
    async with app.state.session_factory() as first, app.state.session_factory() as second:
        first_batch = asyncio.create_task(process_outbox_batch(first, None, worker_id="A", limit=1))
        try:
            await asyncio.wait_for(started.wait(), 5)
            future = datetime.now(timezone.utc) + timedelta(seconds=lease_service.DEFAULT_LEASE_SECONDS + 1)

            class FutureClock:
                @staticmethod
                def now(_timezone):
                    return future

            monkeypatch.setattr(lease_service, "datetime", FutureClock)
            second_result = await asyncio.wait_for(process_outbox_batch(second, None, worker_id="B", limit=1), 5)
        finally:
            resume.set()
            finished = await first_batch
        assert second_result == {"sent": 0, "failed": 0, "skipped": 0}
    assert finished["sent"] == 1
    assert dispatches == [message_id]


@pytest.mark.usefixtures("booking_consent")
@pytest.mark.parametrize("action", ["ack", "skip", "fail"])
async def test_stale_worker_cannot_finish_reclaimed_notification(
    app, admin_client, public_client, db_session, action,
):
    await book_slot(admin_client, public_client)
    message_id = await only_one_pending_message(db_session)
    async with app.state.session_factory() as stale, app.state.session_factory() as current:
        old = await lease_service.claim_next(stale, "A")
        assert old is not None and old.id == message_id
        await stale.commit()
        await expire_lease(db_session, message_id)
        new = await lease_service.claim_next(current, "B")
        assert new is not None and new.id == message_id
        await current.commit()

        kwargs = {"error_code": "QA"} if action == "fail" else {}
        await getattr(lease_service, action)(stale, old, **kwargs)
        await stale.commit()
        await current.refresh(new)
        assert (new.status, new.leased_by, new.attempts) == ("leased", "B", 0)
