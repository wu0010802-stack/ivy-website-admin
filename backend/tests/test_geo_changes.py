"""附近園所的變化（2026-10-14 規格 §5）：12 個月視窗、半徑、設立日新設、去重、排序。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.admissions.geo.models import GeoBabycare, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.providers import nearby_changes
from tests.geo_helpers import YIHUA_POINT

TODAY = date(2026, 10, 14)
SYNCED = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)


def add_kg(db, source_id, *, name=None, kind="private", dlat=0.0, active=True, registered_on=None):
    lat, lng = YIHUA_POINT
    db.add(
        GeoKindergarten(
            source_id=source_id, name=name or f"幼兒園{source_id}", kind=kind, district="三民區", address="某路1號",
            lat=lat + dlat, lng=lng, is_active=active, registered_on=registered_on, synced_at=SYNCED,
        )
    )


def add_bc(db, source_id, *, name=None, kind="center", dlat=0.0, active=True):
    lat, lng = YIHUA_POINT
    db.add(
        GeoBabycare(
            source_id=source_id, name=name or f"托嬰{source_id}", kind=kind, address="高雄市三民區某路1號",
            lat=lat + dlat, lng=lng, is_active=active, synced_at=SYNCED,
        )
    )


def add_event(db, provider, source_id, change, day, old=None, new=None):
    db.add(GeoProviderEvent(provider=provider, source_id=source_id, change=change, occurred_on=day, old_value=old, new_value=new))


async def changes(db, radius_m=3000, today=TODAY):
    return await nearby_changes(db, *YIHUA_POINT, radius_m, today=today)


async def test_the_window_includes_the_same_day_twelve_months_ago_and_excludes_the_day_before(db_session):
    add_bc(db_session, "in", active=False)
    add_bc(db_session, "out", active=False)
    add_event(db_session, "babycare", "in", "closed", date(2025, 10, 14))
    add_event(db_session, "babycare", "out", "closed", date(2025, 10, 13))
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session)] == ["in"]


async def test_the_window_start_follows_the_leap_day_rule(db_session):
    """今天是 2028/2/29：12 個月前取 2027/2/28，那一天算、前一天不算。"""
    add_bc(db_session, "in", active=False)
    add_bc(db_session, "out", active=False)
    add_event(db_session, "babycare", "in", "closed", date(2027, 2, 28))
    add_event(db_session, "babycare", "out", "closed", date(2027, 2, 27))
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session, today=date(2028, 2, 29))] == ["in"]


async def test_the_radius_filters_events_and_new_schools(db_session):
    add_kg(db_session, "near", dlat=0.001, active=False)  # 約 111 m
    add_kg(db_session, "far", dlat=0.05, active=False)  # 約 5.6 km
    add_kg(db_session, "far-new", dlat=0.05, registered_on=date(2026, 9, 1))
    add_event(db_session, "kindergarten", "near", "closed", date(2026, 10, 1))
    add_event(db_session, "kindergarten", "far", "closed", date(2026, 10, 1))
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session, 1000)] == ["near"]
    assert {item.source_id for item in await changes(db_session, 6000)} == {"near", "far", "far-new"}


async def test_a_school_registered_within_the_window_is_new_without_any_event(db_session):
    add_kg(db_session, "new", registered_on=TODAY - timedelta(days=30))
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.provider, item.change, item.date_basis, item.date) == ("kindergarten", "opened", "registered", TODAY - timedelta(days=30))
    assert item.kind == "private" and item.old_kind is None and item.new_kind is None


async def test_registered_dates_that_do_not_count(db_session):
    add_kg(db_session, "old", registered_on=date(2025, 10, 13))  # 視窗前一天
    add_kg(db_session, "future", registered_on=TODAY + timedelta(days=1))  # 來源打錯的未來日期
    add_kg(db_session, "unknown", registered_on=None)
    add_kg(db_session, "closed", registered_on=TODAY - timedelta(days=5), active=False)  # 停辦的不算新設
    add_kg(db_session, "edge", registered_on=date(2025, 10, 14))  # 視窗第一天
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session)] == ["edge"]


async def test_the_registered_date_wins_over_a_reopen_event_for_the_same_school(db_session):
    add_kg(db_session, "k1", registered_on=TODAY - timedelta(days=20))
    add_event(db_session, "kindergarten", "k1", "opened", TODAY - timedelta(days=2))
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.date_basis, item.date) == ("registered", TODAY - timedelta(days=20))


async def test_a_kind_change_carries_the_old_and_new_kind(db_session):
    add_kg(db_session, "k1", kind="quasi_public")
    add_event(db_session, "kindergarten", "k1", "kind_changed", TODAY - timedelta(days=3), "private", "quasi_public")
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.change, item.kind, item.old_kind, item.new_kind, item.date_basis) == (
        "kind_changed", "quasi_public", "private", "quasi_public", "observed",
    )


async def test_closed_providers_are_listed_even_though_they_are_inactive(db_session):
    add_bc(db_session, "b1", name="托嬰已停辦", kind="home", active=False)
    add_event(db_session, "babycare", "b1", "closed", TODAY - timedelta(days=5))
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.provider, item.name, item.kind, item.change, item.old_kind, item.new_kind) == (
        "babycare", "托嬰已停辦", "home", "closed", None, None,
    )


async def test_a_kindergarten_and_a_babycare_with_the_same_id_do_not_mix(db_session):
    add_kg(db_session, "x", name="幼兒園X", dlat=0.001, active=False)
    add_bc(db_session, "x", name="托嬰X", dlat=0.002, active=False)
    add_event(db_session, "kindergarten", "x", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "x", "closed", date(2026, 10, 2))
    await db_session.commit()
    assert [(item.provider, item.name) for item in await changes(db_session)] == [("babycare", "托嬰X"), ("kindergarten", "幼兒園X")]


async def test_an_event_without_a_provider_row_is_ignored(db_session):
    add_event(db_session, "babycare", "orphan", "closed", TODAY - timedelta(days=1))
    await db_session.commit()
    assert await changes(db_session) == []


async def test_sorted_by_date_then_distance_then_name(db_session):
    for source_id, name, dlat in (("a", "乙托嬰", 0.002), ("b", "甲托嬰", 0.002), ("c", "丙托嬰", 0.001), ("d", "丁托嬰", 0.0005)):
        add_bc(db_session, source_id, name=name, dlat=dlat, active=False)
    add_event(db_session, "babycare", "a", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "b", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "c", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "d", "closed", date(2026, 9, 1))
    await db_session.commit()
    # 同日先看距離（丙最近），距離相同看名稱（乙 U+4E59 在甲 U+7532 前面）；較早的丁最後。
    assert [item.name for item in await changes(db_session)] == ["丙托嬰", "乙托嬰", "甲托嬰", "丁托嬰"]
