"""操作紀錄依操作者篩選、伺服器端搜尋；站內通知翻頁與計數（2026-10-14 規格 §4、§5）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.auth.models import User
from app.notifications.models import NotificationInboxItem
from app.operations.models import AuditLogEntry

API = "/api/website/v1"


async def _entry(db_session, *, action: str, actor_id=None, campus_key="yihua", metadata=None, target_type="visit_schedule",
                 target_id="yihua", ip=None, user_agent=None, ago_seconds=0) -> uuid.UUID:
    entry = AuditLogEntry(
        id=uuid.uuid4(),
        actor_user_id=actor_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        campus_key=campus_key,
        metadata_json=metadata or {},
        created_at=datetime.now(timezone.utc) - timedelta(seconds=ago_seconds),
        ip_address=ip,
        user_agent=user_agent,
    )
    db_session.add(entry)
    await db_session.commit()
    return entry.id


async def _user_id(db_session, email: str) -> uuid.UUID:
    return (await db_session.execute(select(User.id).where(User.email == email))).scalar_one()


def _ids(response) -> set[str]:
    assert response.status_code == 200, response.text
    return {row["id"] for row in response.json()}


@pytest.mark.asyncio
async def test_actor_filter_by_account_and_system(admin_client, minghua_client, db_session):
    admin_id = await _user_id(db_session, "admin@ivy.example")
    mine = await _entry(db_session, action="visit_exception.create", actor_id=admin_id)
    system = await _entry(db_session, action="retention.run", actor_id=None)

    by_admin = _ids(await admin_client.get(f"{API}/admin/audit-log", params={"actor": str(admin_id), "exclude_login": "true"}))
    by_system = _ids(await admin_client.get(f"{API}/admin/audit-log", params={"actor": "system"}))

    assert str(mine) in by_admin and str(system) not in by_admin
    assert by_system == {str(system)}
    bad = await admin_client.get(f"{API}/admin/audit-log", params={"actor": "nobody"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "INVALID_ACTOR"


@pytest.mark.asyncio
async def test_search_terms_match_codes_actor_and_chinese_metadata(admin_client, db_session):
    admin_id = await _user_id(db_session, "admin@ivy.example")
    closure = await _entry(db_session, action="visit_closure.create", actor_id=admin_id, metadata={"reason": "颱風停班停課", "date": "2026-10-16"})
    holiday = await _entry(db_session, action="visit_exception.create", metadata={"date": "2026-10-20"})
    other = await _entry(db_session, action="media.upload", metadata={"filename": "100%_done.jpg"})

    # 中文原字比對 metadata 原文（存的是 \\uXXXX）。
    assert _ids(await admin_client.get(f"{API}/admin/audit-log", params={"q": "颱風"})) == {str(closure)}
    # 後台把「休假」展開成動作代碼一起送；任一個詞符合就列。
    assert _ids(
        await admin_client.get(f"{API}/admin/audit-log", params=[("q", "休假"), ("q", "visit_exception.create")])
    ) == {str(holiday)}
    # 操作者的 email 與顯示名稱。
    assert str(closure) in _ids(await admin_client.get(f"{API}/admin/audit-log", params={"q": "ADMIN@ivy"}))
    # % 與 _ 是字面值，不是萬用字元。
    assert _ids(await admin_client.get(f"{API}/admin/audit-log", params={"q": "100%_"})) == {str(other)}
    assert _ids(await admin_client.get(f"{API}/admin/audit-log", params={"q": "%"})) == {str(other)}
    too_many = await admin_client.get(f"{API}/admin/audit-log", params=[("q", f"t{i}") for i in range(31)])
    assert too_many.status_code == 422 and too_many.json()["detail"]["code"] == "INVALID_SEARCH"


@pytest.mark.asyncio
async def test_search_reaches_beyond_the_first_page_and_keeps_the_cursor(admin_client, db_session):
    target = await _entry(db_session, action="visit_closure.create", metadata={"reason": "颱風"}, ago_seconds=500)
    for index in range(5):
        await _entry(db_session, action="media.upload", ago_seconds=index)

    first = await admin_client.get(f"{API}/admin/audit-log", params={"q": "颱風", "limit": 1})
    assert [row["id"] for row in first.json()] == [str(target)]
    last = first.json()[-1]
    nothing_more = await admin_client.get(
        f"{API}/admin/audit-log", params={"q": "颱風", "limit": 1, "before": last["created_at"], "before_id": last["id"]}
    )
    assert nothing_more.json() == []


@pytest.mark.asyncio
async def test_target_account_name_is_searchable(admin_client, db_session):
    minghua_admin = User(
        id=uuid.uuid4(), email="teacher-lin@ivy.example", password_hash="x", role="campus_admin", is_active=True,
        display_name="林老師", created_at=datetime.now(timezone.utc),
    )
    db_session.add(minghua_admin)
    await db_session.commit()
    entry = await _entry(db_session, action="user.role_change", target_type="user", target_id=str(minghua_admin.id), campus_key=None)

    assert str(entry) in _ids(await admin_client.get(f"{API}/admin/audit-log", params={"q": "林老師"}))


@pytest.mark.asyncio
async def test_only_headquarters_can_search_ip(admin_client, minghua_client, db_session):
    entry = await _entry(db_session, action="visit_exception.create", campus_key="minghua", target_id="minghua", ip="203.0.113.7")

    assert str(entry) in _ids(await admin_client.get(f"{API}/admin/audit-log", params={"campus_key": "minghua", "q": "203.0.113"}))
    assert str(entry) not in _ids(await minghua_client.get(f"{API}/admin/audit-log", params={"campus_key": "minghua", "q": "203.0.113"}))


@pytest.mark.asyncio
async def test_actor_options_follow_the_same_scope(admin_client, minghua_client, db_session):
    admin_id = await _user_id(db_session, "admin@ivy.example")
    await _entry(db_session, action="visit_exception.create", actor_id=admin_id, campus_key="yihua", ago_seconds=60)
    await _entry(db_session, action="retention.run", actor_id=None, campus_key="minghua", target_id="minghua")

    everyone = await admin_client.get(f"{API}/admin/audit-log/actors")
    assert everyone.status_code == 200, everyone.text
    ids = [row["actor_user_id"] for row in everyone.json()]
    assert None in ids and str(admin_id) in ids
    assert next(row for row in everyone.json() if row["actor_user_id"] == str(admin_id))["email"] == "admin@ivy.example"

    minghua_only = await minghua_client.get(f"{API}/admin/audit-log/actors", params={"campus_key": "minghua"})
    assert [row["actor_user_id"] for row in minghua_only.json()] == [None]
    assert (await minghua_client.get(f"{API}/admin/audit-log/actors", params={"campus_key": "yihua"})).status_code == 404
    assert (await minghua_client.get(f"{API}/admin/audit-log/actors")).status_code == 403


# ---------------------------------------------------------------------------
# 站內通知翻頁
# ---------------------------------------------------------------------------


async def _inbox(db_session, campus_key: str, count: int, *, read_every: int | None = None) -> list[NotificationInboxItem]:
    now = datetime.now(timezone.utc)
    items = [
        NotificationInboxItem(
            id=uuid.uuid4(),
            campus_key=campus_key,
            kind="visit_request_created",
            payload={"receipt_id": str(uuid.uuid4())},
            # 兩則一組同一時間：翻頁要靠 id 排出固定順序。
            created_at=now - timedelta(seconds=index // 2),
            read_at=now if read_every and index % read_every == 0 else None,
        )
        for index in range(count)
    ]
    db_session.add_all(items)
    await db_session.commit()
    return items


@pytest.mark.asyncio
async def test_inbox_pages_past_the_first_hundred_without_gaps(admin_client, db_session):
    items = await _inbox(db_session, "yihua", 7)
    seen: list[str] = []
    params: dict = {"limit": 3}
    while True:
        page = (await admin_client.get(f"{API}/admin/notifications", params=params)).json()
        seen += [row["id"] for row in page]
        if len(page) < 3:
            break
        params = {"limit": 3, "before": page[-1]["created_at"], "before_id": page[-1]["id"]}

    assert sorted(seen) == sorted(str(item.id) for item in items)
    assert len(seen) == len(set(seen))
    half = await admin_client.get(f"{API}/admin/notifications", params={"before_id": str(items[0].id)})
    assert half.status_code == 422 and half.json()["detail"]["code"] == "INVALID_CURSOR"


@pytest.mark.asyncio
async def test_unread_only_and_counts(admin_client, minghua_client, db_session):
    await _inbox(db_session, "yihua", 6, read_every=2)  # 3 則已讀、3 則未讀
    await _inbox(db_session, "minghua", 2)

    unread = (await admin_client.get(f"{API}/admin/notifications", params={"unread_only": "true"})).json()
    assert len(unread) == 5 and all(row["read_at"] is None for row in unread)
    counts = (await admin_client.get(f"{API}/admin/notifications/counts")).json()
    assert counts == {
        "total": 8,
        "unread": 5,
        "unread_by_campus": [{"campus_key": "minghua", "unread": 2}, {"campus_key": "yihua", "unread": 3}],
    }

    own = (await minghua_client.get(f"{API}/admin/notifications/counts")).json()
    assert own == {"total": 2, "unread": 2, "unread_by_campus": [{"campus_key": "minghua", "unread": 2}]}
    assert (await minghua_client.get(f"{API}/admin/notifications/counts", params={"campus_key": "yihua"})).status_code == 404
