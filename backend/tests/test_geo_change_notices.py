"""公開地理資料同步後的園所異動與裁罰通知（docs/specs/2026-11-16-area-compare-notices-design.md §7）。

義華校址是門牌樣本座標（peers fixture 發布）；周邊園所在義華正北方的不同距離（peer_fees_helpers.add_kindergarten）：
own 0 m（本機構）、p1 300 m、p2 600 m、p3 900 m、p4 1,200 m、far 4,000 m（3 公里外）。其他四校沒有座標。"""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo import matcher
from app.admissions.geo.models import (
    GeoChangeNotice,
    GeoChangeNoticeBaseline,
    GeoKindergarten,
    GeoKindergartenPenalty,
    GeoProviderEvent,
)
from app.admissions.geo import notices
from app.notifications.area_kinds import AREA_NOTICE_KINDS, AREA_PENALTY, AREA_PROVIDER_CHANGE
from app.notifications.models import NotificationInboxItem
from tests.peer_fees_helpers import add_kindergarten, peers  # noqa: F401

TODAY = date(2026, 11, 16)
NOW = datetime(2026, 11, 16, 4, 0, tzinfo=timezone.utc)


def _event(source_id: str, change: str, day: date, *, old=None, new=None) -> GeoProviderEvent:
    return GeoProviderEvent(
        provider="kindergarten", source_id=source_id, change=change, occurred_on=day, old_value=old, new_value=new
    )


def _penalty(source_id: str | None, name: str, day: date, doc_no: str = "高市教幼字第1號", law: str = "幼兒教育及照顧法第58條", digest: str = "a"):
    return GeoKindergartenPenalty(
        source_id=source_id, school_name=name, occurred_on=day, doc_no=doc_no, law=law, content="內容", kind="fine",
        amount=6000, subject="operator", punishment_hash=digest, synced_at=NOW,
    )


async def _run(db) -> int:
    sent = await notices.check_change_notices(db, today=TODAY)
    await db.commit()
    return sent


async def _items(db, kind: str | None = None) -> list[NotificationInboxItem]:
    stmt = select(NotificationInboxItem).where(NotificationInboxItem.kind.in_(AREA_NOTICE_KINDS))
    if kind:
        stmt = stmt.where(NotificationInboxItem.kind == kind)
    return list((await db.execute(stmt.order_by(NotificationInboxItem.created_at))).scalars())


async def _count(db, model) -> int:
    return await db.scalar(select(func.count()).select_from(model))


async def test_first_run_only_records_baseline(db_session, peers):
    db_session.add_all([
        _event("p1", "closed", TODAY - timedelta(days=5)),
        _event("p2", "opened", TODAY - timedelta(days=9)),
        _penalty("p1", "高雄市私立甲幼兒園", TODAY - timedelta(days=30)),
        _penalty("p2", "高雄市私立乙幼兒園", TODAY - timedelta(days=40), doc_no="第2號"),
        _penalty("p3", "高雄市私立丙幼兒園", TODAY - timedelta(days=50), doc_no="第3號"),
    ])
    await db_session.commit()
    assert await _run(db_session) == 0
    assert await _items(db_session) == []
    rows = (await db_session.execute(select(GeoChangeNotice))).scalars().all()
    assert len(rows) == 5 and not any(row.notified for row in rows)
    baselines = {(row.campus_key, row.kind) for row in (await db_session.execute(select(GeoChangeNoticeBaseline))).scalars()}
    assert baselines == {("yihua", AREA_PROVIDER_CHANGE), ("yihua", AREA_PENALTY)}


async def test_quiet_first_run_then_next_event_notifies(db_session, peers):
    assert await _run(db_session) == 0
    assert await _count(db_session, GeoChangeNoticeBaseline) == 2
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=1)))
    await db_session.commit()
    assert await _run(db_session) == 1
    [item] = await _items(db_session)
    assert item.kind == AREA_PROVIDER_CHANGE and item.campus_key == "yihua"
    assert item.payload["change"] == "closed" and item.payload["source_id"] == "p1" and item.payload["radius_km"] == 3
    assert item.payload["name"] == "高雄市私立甲幼兒園" and item.payload["distance_m"] == 300
    assert item.payload["date"] == (TODAY - timedelta(days=1)).isoformat() and item.payload["provider"] == "kindergarten"


async def test_second_run_only_new(db_session, peers):
    assert await _run(db_session) == 0
    db_session.add_all([
        _event("p2", "opened", TODAY - timedelta(days=2)),
        _penalty("p3", "高雄市私立丙幼兒園", TODAY - timedelta(days=3)),
    ])
    await db_session.commit()
    assert await _run(db_session) == 2
    assert await _run(db_session) == 0
    kinds = sorted(item.kind for item in await _items(db_session))
    assert kinds == [AREA_PENALTY, AREA_PROVIDER_CHANGE]
    [penalty] = await _items(db_session, AREA_PENALTY)
    assert penalty.payload["name"] == "高雄市私立丙幼兒園" and penalty.payload["laws"] == ["幼兒教育及照顧法第58條"]
    assert penalty.payload["doc_no"] == "高市教幼字第1號" and abs(penalty.payload["distance_m"] - 900) <= 2


async def test_stale_items_recorded_silently(db_session, peers):
    assert await _run(db_session) == 0
    db_session.add_all([
        _event("p1", "closed", TODAY - timedelta(days=91)),
        _penalty("p2", "高雄市私立乙幼兒園", TODAY - timedelta(days=366)),
    ])
    await db_session.commit()
    assert await _run(db_session) == 0
    assert await _items(db_session) == []
    stale = (await db_session.execute(select(GeoChangeNotice))).scalars().all()
    assert len(stale) == 2 and not any(row.notified for row in stale)


async def test_overlap_two_campuses(db_session, peers, monkeypatch):
    real = await matcher.campus_points(db_session)
    both = {**real, "minghua": matcher.CampusPoint(campus_key="minghua", lat=real["yihua"].lat, lng=real["yihua"].lng, locate_error=None, district="三民區")}

    async def points(db):
        return both

    monkeypatch.setattr(matcher, "campus_points", points)
    assert await _run(db_session) == 0
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=1)))
    await db_session.commit()
    assert await _run(db_session) == 2
    assert sorted(item.campus_key for item in await _items(db_session)) == ["minghua", "yihua"]


async def test_own_campus_excluded(db_session, peers):
    assert await _run(db_session) == 0
    db_session.add_all([
        _event("own", "kind_changed", TODAY - timedelta(days=1), old="private", new="quasi_public"),
        _penalty("own", "高雄市私立常春藤幼兒園", TODAY - timedelta(days=1)),
    ])
    await db_session.commit()
    assert await _run(db_session) == 0
    assert await _count(db_session, GeoChangeNotice) == 0


async def test_penalty_multiple_laws_one_notice(db_session, peers):
    assert await _run(db_session) == 0
    day = TODAY - timedelta(days=2)
    db_session.add_all([
        _penalty("p1", "高雄市私立甲幼兒園", day, law="幼兒教育及照顧法第58條", digest="a"),
        _penalty("p1", "高雄市私立甲幼兒園", day, law="幼兒園管理辦法第12條", digest="b"),
    ])
    await db_session.commit()
    assert await _run(db_session) == 1
    [item] = await _items(db_session, AREA_PENALTY)
    assert item.payload["laws"] == ["幼兒園管理辦法第12條", "幼兒教育及照顧法第58條"]


async def test_penalty_without_matching_school_is_ignored(db_session, peers):
    assert await _run(db_session) == 0
    db_session.add(_penalty(None, "已經不存在的幼兒園", TODAY - timedelta(days=2)))
    await db_session.commit()
    assert await _run(db_session) == 0
    assert await _count(db_session, GeoChangeNotice) == 0


async def test_repeat_guard(db_session, peers):
    assert await _run(db_session) == 0
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=30)))
    await db_session.commit()
    assert await _run(db_session) == 1
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=1)))
    await db_session.commit()
    assert await _run(db_session) == 0
    assert len(await _items(db_session)) == 1
    assert await _count(db_session, GeoChangeNotice) == 2  # 兩個日期都記帳


async def test_campus_without_point_skipped(db_session, peers, monkeypatch):
    real = await matcher.campus_points(db_session)
    assert real["minghua"].lat is None
    assert await _run(db_session) == 0
    baselines = {row.campus_key for row in (await db_session.execute(select(GeoChangeNoticeBaseline))).scalars()}
    assert baselines == {"yihua"}  # 沒座標的校區不寫基準列
    # 之後有座標：下一輪才是它的首輪（不發）。
    both = {**real, "minghua": matcher.CampusPoint(campus_key="minghua", lat=real["yihua"].lat, lng=real["yihua"].lng, locate_error=None, district="三民區")}

    async def points(db):
        return both

    monkeypatch.setattr(matcher, "campus_points", points)
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=1)))
    await db_session.commit()
    assert await _run(db_session) == 1  # 義華照發；明華是首輪，只記帳
    assert [item.campus_key for item in await _items(db_session)] == ["yihua"]
    assert "minghua" in {row.campus_key for row in (await db_session.execute(select(GeoChangeNoticeBaseline))).scalars()}


async def test_concurrent_runs_do_not_double_send(app, db_session, peers):
    assert await _run(db_session) == 0
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=1)))
    await db_session.commit()

    async def run_once() -> int:
        async with app.state.session_factory() as session:
            sent = await notices.check_change_notices(session, today=TODAY)
            await asyncio.sleep(0.2)  # 兩邊都插入之後才 commit：後到的在唯一鍵上等先到的
            await session.commit()
            return sent

    results = await asyncio.gather(run_once(), run_once())
    assert sorted(results) == [0, 1]
    assert len(await _items(db_session)) == 1


async def test_run_change_notices_failure_isolated(app, peers, monkeypatch, caplog):
    async def boom(db, *, today):
        raise RuntimeError("壞掉了")

    monkeypatch.setattr(notices, "check_change_notices", boom)
    assert await notices.run_change_notices(app.state.session_factory, today=TODAY) == ("failed", 0)
    assert "壞掉了" in caplog.text


async def test_run_change_notices_commits_and_reports_count(app, db_session, peers):
    assert await notices.run_change_notices(app.state.session_factory, today=TODAY) == ("updated", 0)
    db_session.add(_event("p1", "closed", TODAY - timedelta(days=1)))
    await db_session.commit()
    assert await notices.run_change_notices(app.state.session_factory, today=TODAY) == ("updated", 1)
