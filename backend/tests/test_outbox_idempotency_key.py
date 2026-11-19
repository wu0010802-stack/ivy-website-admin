"""2026-11-12 QA L23：Resend 寄信帶 Idempotency-Key。outbox 工作寄出後回應逾時（Resend 其實已收到），
下一輪重試必須用同一把 key，Resend 才會認出是同一封、不重寄；不同收件人、不同 outbox 工作用不同的 key。"""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, update

from app.booking.models import OutboxMessage
from app.notifications.email_adapter import ResendEmailAdapter
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot

pytestmark = pytest.mark.usefixtures("booking_consent")

ORIGIN = "https://www.ivy.example"
KEY_PATTERN = re.compile(r"ivy-outbox-([0-9a-f-]{36})-[0-9a-f]{16}")


class _ResendRecorder:
    """假的 Resend：記下每次請求；家長的第一封回應逾時（請求其實已送達），之後都成功。"""

    def __init__(self) -> None:
        self.requests: list[tuple[str, str | None]] = []  # (收件人, Idempotency-Key)
        self.parent_timeouts_left = 1

    def handler(self, request: httpx.Request) -> httpx.Response:
        to = json.loads(request.content)["to"][0]
        self.requests.append((to, request.headers.get("idempotency-key")))
        if to == "parent@example.com" and self.parent_timeouts_left:
            self.parent_timeouts_left -= 1
            raise httpx.ReadTimeout("response lost", request=request)
        return httpx.Response(200, json={"id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794"})

    def adapter(self) -> ResendEmailAdapter:
        return ResendEmailAdapter(
            api_key="re_test_key_never_real_0123456789", sender="noreply@mail.ivy.example",
            transport=httpx.MockTransport(self.handler),
        )


async def _run(db_session, adapter, app):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


@pytest.mark.asyncio
async def test_retry_after_a_lost_response_reuses_the_same_key(app, admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)
    resend = _ResendRecorder()
    adapter = resend.adapter()

    first = await _run(db_session, adapter, app)
    assert first["failed"] >= 1  # 家長那封回應逾時，outbox 排下次重試

    await db_session.execute(
        update(OutboxMessage)
        .where(OutboxMessage.status == "pending")
        .values(next_attempt_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db_session.commit()
    second = await _run(db_session, adapter, app)
    assert second["failed"] == 0

    parent = [key for to, key in resend.requests if to == "parent@example.com"]
    assert len(parent) == 2 and parent[0] is not None
    assert parent[0] == parent[1], "重試必須用同一把 key，Resend 才會把它當成同一封"

    keys = [key for _, key in resend.requests]
    assert all(key and KEY_PATTERN.fullmatch(key) for key in keys), keys
    # key 裡的 outbox id 是真的 outbox 工作；同一筆工作寄給不同人（園方通知）key 不同。
    outbox_ids = {str(i) for i in (await db_session.execute(select(OutboxMessage.id))).scalars()}
    assert {KEY_PATTERN.fullmatch(key).group(1) for key in keys} <= outbox_ids
    per_recipient = {}
    for to, key in resend.requests:
        per_recipient.setdefault(to, set()).add(key)
    assert all(len(found) == 1 for found in per_recipient.values())
    all_keys = [next(iter(found)) for found in per_recipient.values()]
    assert len(all_keys) == len(set(all_keys)), "不同收件人不能共用 key，否則只有第一個人收得到信"
