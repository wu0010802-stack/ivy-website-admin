"""附近園所異動與裁罰通知的權限過濾（docs/specs/2026-11-16-area-compare-notices-design.md §7.4）：
只有 admissions.stats（總管理者）看得到、改得到；分校管理者與櫃台的列表、計數、全部已讀、單筆已讀都排除這兩種。"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select

from app.notifications.area_kinds import AREA_PENALTY, AREA_PROVIDER_CHANGE
from app.notifications.models import NotificationInboxItem
from app.notifications.service import notification_label
from tests.admissions_helpers import campus_admin_yihua_client, reception_yihua_client  # noqa: F401

NOTIFICATIONS = "/api/website/v1/admin/notifications"
NOW = datetime(2026, 11, 16, 4, 0, tzinfo=timezone.utc)


async def _seed(db) -> dict[str, uuid.UUID]:
    ids = {}
    for name, kind, payload in (
        ("change", AREA_PROVIDER_CHANGE, {"provider": "kindergarten", "source_id": "p1", "name": "甲幼兒園", "change": "closed"}),
        ("penalty", AREA_PENALTY, {"source_id": "p1", "name": "甲幼兒園", "laws": ["法"]}),
        ("visit", "visit_request_created", {"visit_request_id": str(uuid.uuid4())}),
    ):
        item = NotificationInboxItem(id=uuid.uuid4(), campus_key="yihua", kind=kind, payload=payload, created_at=NOW)
        db.add(item)
        ids[name] = item.id
    await db.commit()
    return ids


async def _read_at(db, item_id: uuid.UUID):
    db.expire_all()
    return (await db.execute(select(NotificationInboxItem.read_at).where(NotificationInboxItem.id == item_id))).scalar_one()


def test_titles():
    assert notification_label(AREA_PROVIDER_CHANGE) == "附近園所異動"
    assert notification_label(AREA_PENALTY) == "附近幼兒園裁罰"


async def test_super_admin_sees_and_reads_all(admin_client, db_session):
    ids = await _seed(db_session)
    body = (await admin_client.get(NOTIFICATIONS)).json()
    assert len(body) == 3
    assert (await admin_client.get(f"{NOTIFICATIONS}/counts")).json()["total"] == 3
    assert (await admin_client.post(f"{NOTIFICATIONS}/read-all")).json() == {"updated": 3}
    for item_id in ids.values():
        assert await _read_at(db_session, item_id) is not None


async def test_super_admin_can_mark_one_area_notice(admin_client, db_session):
    ids = await _seed(db_session)
    assert (await admin_client.post(f"{NOTIFICATIONS}/{ids['change']}/read")).status_code == 200
    assert await _read_at(db_session, ids["change"]) is not None


async def test_campus_admin_does_not_see_or_touch_area_notices(campus_admin_yihua_client, db_session):
    ids = await _seed(db_session)
    client = campus_admin_yihua_client
    listed = (await client.get(NOTIFICATIONS)).json()
    assert [row["kind"] for row in listed] == ["visit_request_created"]
    assert (await client.get(f"{NOTIFICATIONS}/counts")).json()["total"] == 1
    # 帶 campus_key 也只是少兩則，不是 403。
    scoped = await client.get(f"{NOTIFICATIONS}?campus_key=yihua")
    assert scoped.status_code == 200 and [row["kind"] for row in scoped.json()] == ["visit_request_created"]
    assert (await client.get(f"{NOTIFICATIONS}/counts?campus_key=yihua")).json()["total"] == 1
    # 單筆已讀：硬打回 404，沒被改到。
    assert (await client.post(f"{NOTIFICATIONS}/{ids['change']}/read")).status_code == 404
    assert (await client.post(f"{NOTIFICATIONS}/{ids['penalty']}/read")).status_code == 404
    # 全部已讀：只標到自己看得到的那一則。
    assert (await client.post(f"{NOTIFICATIONS}/read-all")).json() == {"updated": 1}
    assert await _read_at(db_session, ids["change"]) is None and await _read_at(db_session, ids["penalty"]) is None
    assert await _read_at(db_session, ids["visit"]) is not None


async def test_reception_sees_only_the_visit_notice(reception_yihua_client, db_session):
    await _seed(db_session)
    listed = (await reception_yihua_client.get(NOTIFICATIONS)).json()
    assert [row["kind"] for row in listed] == ["visit_request_created"]
    assert (await reception_yihua_client.get(f"{NOTIFICATIONS}/counts")).json()["total"] == 1
