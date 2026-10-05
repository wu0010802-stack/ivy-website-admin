"""待處理兩種（招生分析報告 3.4）只有一份定義：總覽、案件列表的篩選與成效統計共用
booking/pending_kinds.py，總覽的數字點進清單才會是同一批案件。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.booking import pending_kinds
from app.booking.models import VisitRequest
from tests.analytics_fixtures import add_case, add_slot

BASE = "/api/website/v1/admin"


async def _seed(db) -> None:
    past = await add_slot(db, days_from_today=-1)
    future = await add_slot(db, days_from_today=3)
    due = datetime.now(timezone.utc) - timedelta(hours=1)
    await add_case(db, status="confirmed", slot_id=past)  # 參觀時間過了、還沒標記
    await add_case(db, status="confirmed", slot_id=future, follow_up_at=due)  # 到期待追蹤
    await add_case(db, status="completed", slot_id=past, follow_up_at=due)  # 已到場：哪一種都不算
    await add_case(db, status="cancelled", slot_id=future, follow_up_at=due, cancel_reason="staff")  # 已取消：不算
    await add_case(db, status="confirmed", slot_id=future, follow_up_at=datetime.now(timezone.utc) + timedelta(days=1))
    await db.commit()


async def _list_count(client, query: str) -> int:
    response = await client.get(f"{BASE}/visit-requests?{query}&page_size=100")
    assert response.status_code == 200, response.text
    return len(response.json())


@pytest.mark.asyncio
async def test_condition_counts_each_kind(db_session):
    await _seed(db_session)
    counts = {
        kind: (
            await db_session.execute(select(func.count()).select_from(VisitRequest).where(pending_kinds.condition(kind)))
        ).scalar_one()
        for kind in pending_kinds.PENDING_KINDS
    }
    assert counts == {"awaiting_attendance": 1, "follow_up_due": 1}


@pytest.mark.asyncio
async def test_dashboard_and_list_filters_agree(admin_client, db_session):
    await _seed(db_session)
    dashboard = (await admin_client.get(f"{BASE}/dashboard")).json()
    assert dashboard["awaiting_attendance"] == 1
    assert dashboard["pending_follow_up"] == 1
    assert await _list_count(admin_client, "group=past&status=confirmed") == 1
    assert await _list_count(admin_client, "follow_up_due=true") == 1


def test_unknown_kind_is_a_programming_error():
    with pytest.raises(ValueError):
        pending_kinds.condition("contact_later")
