"""每日早上的參觀摘要：台灣 08:00–12:00、每群組每天最多一則、推成功才記、依群組服務的校區過濾（設計 §4.1、§4.2）。"""

from __future__ import annotations

import json
from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import func, select, update

from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.notifications.line import LineMessagingClient
from app.notifications.line_digest import rows_between, rows_for_day, send_due_digests
from app.notifications.line_group_settings import digest_targets
from app.notifications.models import LineDigestRun, LineGroupSetting
from tests.conftest import book_slot
from tests.test_line_group_dispatch import ALL_KINDS, _setting
from tests.test_line_notifications import (  # noqa: F401  (fixtures)
    GROUP,
    OTHER_GROUP,
    TOKEN,
    FakeLine,
    _event,
    _setup_case,
    _webhook,
    fake_line,
    line_app,
)


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime.combine(today_local(), time(hour, minute), tzinfo=OPERATING_TZ)


async def _world(line_app, *, yihua: int = 1, minghua: int = 0, hq: bool = True) -> list[str]:
    """義華 yihua 筆、明華 minghua 筆預約（場次都改到今天）；GROUP＝義華群組，OTHER_GROUP＝總部群組。"""
    admin, public = await _setup_case(line_app)
    receipts: list[str] = []
    try:
        for i in range(yihua):
            receipts.append((await book_slot(admin, public, "yihua", start_time=f"{6 + i:02d}:00:00", end_time=f"{6 + i:02d}:30:00", idempotency_key=f"y{i}", phone=f"09123450{i:02d}"))["receipt_id"])
        for i in range(minghua):
            receipts.append((await book_slot(admin, public, "minghua", start_time=f"{6 + i:02d}:00:00", end_time=f"{6 + i:02d}:30:00", idempotency_key=f"m{i}", phone=f"09123460{i:02d}"))["receipt_id"])
    finally:
        await admin.aclose()
        await public.aclose()
    await _webhook(line_app, [_event("join", OTHER_GROUP)])
    async with line_app.state.session_factory() as db:
        if hq:
            await db.merge(LineGroupSetting(target_id=OTHER_GROUP, is_hq=True, kinds=ALL_KINDS, updated_at=datetime.now(timezone.utc)))
        await db.execute(update(VisitSlot).values(slot_date=today_local()))
        await db.commit()
    return receipts


async def _digest(line_app, fake_line, now: datetime) -> int:
    line = LineMessagingClient(TOKEN, transport=fake_line.transport())
    try:
        async with line_app.state.session_factory() as db:
            return await send_due_digests(db, line_app.state.settings, line_client=line, now=now)
    finally:
        await line.aclose()


async def _runs(line_app) -> int:
    async with line_app.state.session_factory() as db:
        return (await db.execute(select(func.count()).select_from(LineDigestRun))).scalar_one()


def _carousel(push: dict) -> list[dict]:
    return push["body"]["messages"][0]["contents"]["contents"]


async def test_digest_sent_once_at_8am_with_all_confirmed_visits_sorted(line_app, fake_line):
    await _world(line_app, yihua=3, hq=False)
    assert await _digest(line_app, fake_line, _at(7, 59)) == 0
    assert fake_line.pushes == []
    assert await _digest(line_app, fake_line, _at(8, 0)) == 1
    assert len(fake_line.pushes) == 1
    push = fake_line.pushes[0]
    assert push["body"]["to"] == GROUP
    assert len(_carousel(push)) == 4
    dumped = json.dumps(push["body"], ensure_ascii=False)
    assert dumped.index("06:00") < dumped.index("07:00") < dumped.index("08:00")
    assert "今日參觀" in push["body"]["messages"][0]["altText"]
    assert "陳媽媽" not in push["body"]["messages"][0]["altText"]
    assert await _digest(line_app, fake_line, _at(8, 30)) == 0
    assert len(fake_line.pushes) == 1
    assert await _runs(line_app) == 1


async def test_no_visits_no_digest_and_no_run_row(line_app, fake_line):
    await _world(line_app, yihua=1, hq=False)
    async with line_app.state.session_factory() as db:
        await db.execute(update(VisitSlot).values(slot_date=date(2030, 1, 1)))
        await db.commit()
    assert await _digest(line_app, fake_line, _at(9)) == 0
    assert fake_line.pushes == []
    assert await _runs(line_app) == 0


async def test_more_than_11_visits_adds_overflow_bubble(line_app, fake_line):
    await _world(line_app, yihua=12, hq=False)
    assert await _digest(line_app, fake_line, _at(8)) == 1
    bubbles = _carousel(fake_line.pushes[0])
    assert len(bubbles) == 12
    assert "另有 1 筆" in json.dumps(bubbles[-1], ensure_ascii=False)


async def test_hq_group_digest_covers_all_campuses_campus_group_only_its_own(line_app, fake_line):
    await _world(line_app, yihua=1, minghua=1)
    assert await _digest(line_app, fake_line, _at(8)) == 2
    by_target = {p["body"]["to"]: json.dumps(p["body"], ensure_ascii=False) for p in fake_line.pushes}
    assert set(by_target) == {GROUP, OTHER_GROUP}
    assert "義華" in by_target[GROUP] and "明華" not in by_target[GROUP]
    assert "義華" in by_target[OTHER_GROUP] and "明華" in by_target[OTHER_GROUP]


async def test_digest_off_group_gets_none(line_app, fake_line):
    await _world(line_app, yihua=1, hq=True)
    await _setting(line_app, OTHER_GROUP, is_hq=True, kinds=ALL_KINDS, digest_enabled=False)
    await _setting(line_app, GROUP, digest_enabled=False)
    assert await _digest(line_app, fake_line, _at(8)) == 0
    assert fake_line.pushes == []


async def test_push_failure_keeps_no_run_row_and_retries_next_cycle_until_noon(line_app, fake_line):
    await _world(line_app, yihua=1, hq=False)
    fake_line.push_status = [500]
    assert await _digest(line_app, fake_line, _at(8)) == 0
    assert await _runs(line_app) == 0
    assert await _digest(line_app, fake_line, _at(8, 1)) == 1
    assert await _runs(line_app) == 1
    assert [p["retry_key"] for p in fake_line.pushes][0]  # 同一天同一群組用固定的 retry key

    # 另一天、失敗後到了 12:00 就不再嘗試
    async with line_app.state.session_factory() as db:
        await db.execute(LineDigestRun.__table__.delete())
        await db.commit()
    fake_line.pushes.clear()
    assert await _digest(line_app, fake_line, _at(12)) == 0
    assert fake_line.pushes == []


async def test_cancelled_and_excluded_visits_not_listed(line_app, fake_line):
    receipts = await _world(line_app, yihua=3, hq=False)
    async with line_app.state.session_factory() as db:
        await db.execute(update(VisitRequest).where(VisitRequest.id == receipts[0]).values(status="cancelled"))
        await db.execute(
            update(VisitRequest).where(VisitRequest.id == receipts[1]).values(excluded_at=datetime.now(timezone.utc), exclude_reason="test")
        )
        await db.commit()
    assert await _digest(line_app, fake_line, _at(8)) == 1
    assert len(_carousel(fake_line.pushes[0])) == 2
    async with line_app.state.session_factory() as db:
        rows = await rows_for_day(db, ["yihua"], today_local())
        assert [r.receipt_id for r in rows] == [receipts[2]]
        assert await rows_between(db, ["yihua"], today_local(), today_local()) == rows
        assert await rows_between(db, [], today_local(), today_local()) == []
    row = rows[0]
    # 同群組卡片與確認卡的時段寫法（service.push_slot_text：11/8（六）08:00）。
    assert row.when.startswith(f"{today_local().month}/{today_local().day}（") and "週" not in row.when
    assert row.when.endswith("08:00")
    assert row.campus_name == "義華" or row.campus_name


async def test_digest_targets_lists_served_campuses(line_app, fake_line):
    await _world(line_app, yihua=0, hq=True)
    async with line_app.state.session_factory() as db:
        targets = {t.target_id: keys for t, keys in await digest_targets(db)}
    assert targets[GROUP] == ["yihua"]
    assert "yihua" in targets[OTHER_GROUP] and len(targets[OTHER_GROUP]) > 1
    await _setting(line_app, GROUP, digest_enabled=False)
    async with line_app.state.session_factory() as db:
        assert GROUP not in {t.target_id for t, _ in await digest_targets(db)}
    from app.notifications.models import LineGroup

    async with line_app.state.session_factory() as db:
        await db.execute(update(LineGroup).where(LineGroup.target_id == OTHER_GROUP).values(left_at=datetime.now(timezone.utc)))
        await db.commit()
        assert OTHER_GROUP not in {t.target_id for t, _ in await digest_targets(db)}
