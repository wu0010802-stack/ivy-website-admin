"""幼兒園與托嬰的名單比對與異動紀錄（2026-10-14 規格 §4、裁定 P3–P9）。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.babycare import BabycareRow
from app.admissions.geo.kindergartens import KindergartenRow
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.providers import (
    SHRUNK_MESSAGE,
    ProviderShrunk,
    apply_babycare,
    apply_kindergartens,
    months_ago,
)

# 台北 2026-10-14 12:00（UTC 04:00，兩邊同一天）。
NOW = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 14)


def later(days: int) -> datetime:
    return NOW + timedelta(days=days)


def bc(source_id: str, *, enrolled: int | None = 10, name: str | None = None) -> BabycareRow:
    return BabycareRow(
        source_id=source_id, name=name or f"托嬰{source_id}", kind="center", address="高雄市三民區某路1號",
        lat=22.64, lng=120.34, approved_capacity=20, enrolled=enrolled, phone=None,
    )


def kg(
    source_id: str, *, kind: str = "private", period: str | None = None, registered_on: date | None = None,
    capacity: int | None = 100, name: str | None = None,
) -> KindergartenRow:
    return KindergartenRow(
        source_id=source_id, reg_no=None, name=name or f"幼兒園{source_id}", kind=kind, pre_public_period=period,
        district="三民區", address="某路1號", lat=22.64, lng=120.34, approved_capacity=capacity,
        monthly_fee_estimate=None, has_penalty=False, phone=None, registered_on=registered_on,
    )


def many_babycare(count: int) -> list[BabycareRow]:
    return [bc(f"b{index:02d}") for index in range(count)]


async def put_babycare(db, rows, *, now=NOW, force=False):
    report = await apply_babycare(db, rows, synced_at=now, force=force)
    await db.commit()
    return report


async def put_kindergartens(db, rows, *, now=NOW, school_year=115, force=False):
    report = await apply_kindergartens(db, rows, synced_at=now, school_year=school_year, force=force)
    await db.commit()
    return report


async def events(db):
    result = await db.execute(select(GeoProviderEvent).order_by(GeoProviderEvent.id))
    return [(e.provider, e.source_id, e.change, e.occurred_on, e.old_value, e.new_value) for e in result.scalars()]


async def active_ids(db, model):
    result = await db.execute(select(model.source_id).where(model.is_active.is_(True)).order_by(model.source_id))
    return list(result.scalars())


# ---- 基準 ----


async def test_first_babycare_sync_only_sets_the_baseline(db_session):
    """資料表是空的（托嬰第一次）：只建立基準，不能寫任何 opened 事件，否則上線第一天就有一百多筆「新設」。"""
    report = await put_babycare(db_session, [bc("b1"), bc("b2")])
    assert (report.active, report.opened, report.closed) == (2, 0, 0)
    assert await events(db_session) == []
    status = await db_session.get(GeoDatasetStatus, "babycare")
    assert (status.baseline_on, status.label, status.active_version, status.synced_at) == (TODAY, "2026-10-14", "2026-10-14", NOW)
    assert status.last_error is None
    assert await db_session.scalar(select(func.count()).select_from(GeoBabycare)) == 2


async def test_baseline_is_set_once(db_session):
    await put_babycare(db_session, [bc("b1")])
    await put_babycare(db_session, [bc("b1")], now=later(30))
    status = await db_session.get(GeoDatasetStatus, "babycare")
    assert (status.baseline_on, status.label) == (TODAY, "2026-11-13")


async def test_an_existing_status_row_without_a_baseline_gets_one(db_session):
    """舊程式留下的狀態列沒有基準日：第一次用新程式同步時補上。"""
    db_session.add(GeoDatasetStatus(dataset="kindergartens", active_version="2026-10-12", label="2026-10-12", synced_at=NOW, checked_at=NOW))
    await db_session.commit()
    await put_kindergartens(db_session, [kg("k1")])
    assert (await db_session.get(GeoDatasetStatus, "kindergartens")).baseline_on == TODAY


async def test_kindergarten_rows_left_by_the_old_sync_are_compared_on_the_first_run(db_session):
    """幼兒園資料表原本就有列（舊程式寫的，沒有設立日）：第一次也照常比對，不當成空表。"""
    for source_id in ("k1", "k2"):
        db_session.add(
            GeoKindergarten(
                source_id=source_id, name=f"舊{source_id}", kind="private", district="三民區", address="某路1號",
                lat=22.64, lng=120.34, is_active=True, synced_at=NOW,
            )
        )
    await db_session.commit()
    report = await put_kindergartens(db_session, [kg("k1")])
    assert report.closed == 1
    assert await events(db_session) == [("kindergarten", "k2", "closed", TODAY, None, None)]


# ---- 托嬰：新增、停辦、回來 ----


async def test_a_new_babycare_after_the_baseline_is_an_opened_event(db_session):
    await put_babycare(db_session, [bc("b1")])
    report = await put_babycare(db_session, [bc("b1"), bc("b3")], now=later(7))
    assert (report.opened, report.closed) == (1, 0)
    assert await events(db_session) == [("babycare", "b3", "opened", date(2026, 10, 21), None, None)]


async def test_a_babycare_missing_from_the_list_is_closed_once(db_session):
    await put_babycare(db_session, [bc("b1"), bc("b2")])
    report = await put_babycare(db_session, [bc("b1")], now=later(7))
    assert report.closed == 1
    assert await active_ids(db_session, GeoBabycare) == ["b1"]
    assert await db_session.scalar(select(func.count()).select_from(GeoBabycare)) == 2  # 列留著
    await put_babycare(db_session, [bc("b1")], now=later(14))  # 下一次仍然沒有它：不再寫事件
    assert await events(db_session) == [("babycare", "b2", "closed", date(2026, 10, 21), None, None)]


@pytest.mark.parametrize(
    ("back_day", "expected"),
    [(10, []), (33, []), (34, ["closed", "opened"])],
    ids=["10 天後回來", "剛好 30 天後回來", "31 天後回來"],
)
async def test_coming_back_within_30_days_cancels_the_closure(db_session, back_day, expected):
    """停辦事件寫在第 3 天。30 天內（含第 30 天）又出現＝來源漏收：兩筆事件都不留；第 31 天才回來才算停辦＋重新營業。"""
    await put_babycare(db_session, [bc("b1"), bc("b2")])
    await put_babycare(db_session, [bc("b1")], now=later(3))
    report = await put_babycare(db_session, [bc("b1"), bc("b2")], now=later(back_day))
    assert [event[2] for event in await events(db_session)] == expected
    assert await active_ids(db_session, GeoBabycare) == ["b1", "b2"]
    assert report.cancelled_closures == (0 if expected else 1)


async def test_rerunning_the_same_list_the_same_day_adds_no_events(db_session):
    await put_babycare(db_session, [bc("b1"), bc("b2")])
    for _ in range(2):
        await put_babycare(db_session, [bc("b1")], now=later(7))
    for _ in range(2):
        await put_babycare(db_session, [bc("b1"), bc("b3")], now=later(7))
    assert await events(db_session) == [
        ("babycare", "b2", "closed", date(2026, 10, 21), None, None),
        ("babycare", "b3", "opened", date(2026, 10, 21), None, None),
    ]


# ---- 幼兒園 ----


async def test_new_kindergartens_never_write_events(db_session):
    """新設看設立日（讀的時候算），不靠事件：剛被來源收錄的老園所不能被當成新設。"""
    await put_kindergartens(db_session, [kg("k1")])
    await put_kindergartens(db_session, [kg("k1"), kg("k2", registered_on=date(2026, 9, 1))], now=later(7))
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1", "k2"]


async def test_a_kindergarten_closed_and_reopened_later(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    await put_kindergartens(db_session, [kg("k1")], now=later(7))
    await put_kindergartens(db_session, [kg("k1"), kg("k2")], now=later(60))
    assert await events(db_session) == [
        ("kindergarten", "k2", "closed", date(2026, 10, 21), None, None),
        ("kindergarten", "k2", "opened", date(2026, 12, 13), None, None),
    ]


async def test_existing_rows_are_updated_in_place(db_session):
    await put_kindergartens(db_session, [kg("k1", name="舊名", capacity=100)])
    await put_kindergartens(db_session, [kg("k1", name="新名", capacity=120, registered_on=date(2026, 2, 13))], now=later(7))
    row = await db_session.get(GeoKindergarten, "k1")
    assert (row.name, row.approved_capacity, row.registered_on, row.synced_at) == ("新名", 120, date(2026, 2, 13), later(7))
    assert await events(db_session) == []


async def test_a_school_year_rollover_alone_is_not_a_kind_change(db_session):
    """8 月學年更替：準公共期間沒改（113-115），116 學年解析出來自然變成私立。舊的類型用 116 學年重算，所以不算變動。"""
    await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="113-115")], school_year=115)
    report = await put_kindergartens(db_session, [kg("k1", kind="private", period="113-115")], now=later(300), school_year=116)
    assert report.kind_changed == 0 and await events(db_session) == []
    assert (await db_session.get(GeoKindergarten, "k1")).kind == "private"  # 資料表照新的更新


async def test_a_changed_quasi_public_period_is_a_kind_change(db_session):
    await put_kindergartens(db_session, [kg("k1", kind="private")], school_year=116)
    report = await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="116-118")], now=later(7), school_year=116)
    assert report.kind_changed == 1
    assert await events(db_session) == [("kindergarten", "k1", "kind_changed", date(2026, 10, 21), "private", "quasi_public")]


async def test_a_changed_school_type_is_a_kind_change(db_session):
    await put_kindergartens(db_session, [kg("k1", kind="nonprofit")])
    await put_kindergartens(db_session, [kg("k1", kind="public")], now=later(7))
    assert await events(db_session) == [("kindergarten", "k1", "kind_changed", date(2026, 10, 21), "nonprofit", "public")]


# ---- 殘缺檔 ----


async def test_a_truncated_list_is_refused_and_nothing_is_closed(db_session):
    """上次營業中 25 所，新檔只剩 19 所（< 80%）：不換版、不寫事件。"""
    await put_babycare(db_session, many_babycare(25))
    with pytest.raises(ProviderShrunk, match=SHRUNK_MESSAGE):
        await put_babycare(db_session, many_babycare(19), now=later(7))
    await db_session.rollback()
    assert len(await active_ids(db_session, GeoBabycare)) == 25
    assert await events(db_session) == []
    assert (await db_session.get(GeoDatasetStatus, "babycare")).label == "2026-10-14"  # 沒換版


async def test_exactly_eighty_percent_is_accepted(db_session):
    await put_babycare(db_session, many_babycare(25))
    report = await put_babycare(db_session, many_babycare(20), now=later(7))
    assert report.closed == 5


async def test_a_small_previous_list_is_not_checked(db_session):
    await put_babycare(db_session, many_babycare(10))
    assert (await put_babycare(db_session, many_babycare(1), now=later(7))).closed == 9


async def test_force_skips_the_truncation_check(db_session):
    await put_babycare(db_session, many_babycare(25))
    assert (await put_babycare(db_session, many_babycare(5), now=later(7), force=True)).closed == 20


# ---- 事件保留期 ----


async def test_events_older_than_24_months_are_pruned_per_provider(db_session):
    await put_babycare(db_session, [bc("b1")])
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="old", change="closed", occurred_on=date(2024, 10, 13)),
            GeoProviderEvent(provider="babycare", source_id="edge", change="closed", occurred_on=date(2024, 10, 14)),
            GeoProviderEvent(provider="kindergarten", source_id="kold", change="closed", occurred_on=date(2020, 1, 1)),
        ]
    )
    await db_session.commit()
    await put_babycare(db_session, [bc("b1")])  # 同一天再跑：今天 2026-10-14，保留期從 2024-10-14 起
    assert {(event[0], event[1]) for event in await events(db_session)} == {("babycare", "edge"), ("kindergarten", "kold")}


@pytest.mark.parametrize(
    ("day", "months", "expected"),
    [
        (date(2026, 10, 14), 12, date(2025, 10, 14)),
        (date(2026, 10, 14), 0, date(2026, 10, 14)),
        (date(2024, 2, 29), 12, date(2023, 2, 28)),  # 閏日往前推一年：取 2/28
        (date(2028, 2, 29), 12, date(2027, 2, 28)),
        (date(2026, 3, 31), 1, date(2026, 2, 28)),  # 月底往前推：取該月最後一天
        (date(2026, 1, 15), 24, date(2024, 1, 15)),
        (date(2026, 2, 28), 12, date(2025, 2, 28)),
    ],
)
def test_months_ago(day, months, expected):
    assert months_ago(day, months) == expected
