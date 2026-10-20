"""幼兒園與托嬰的名單比對與異動紀錄（2026-10-14 規格 §4、裁定 P3–P9）。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.babycare import BabycareRow
from app.admissions.geo.closure_backfill import ClosureBackfill
from app.admissions.geo.kindergartens import KindergartenRow
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.providers import (
    SHRUNK_MESSAGE,
    ProviderShrunk,
    apply_babycare,
    apply_closure_backfill,
    apply_kindergartens,
    months_ago,
    nearby_changes,
    safe_apply_closure_backfill,
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
    capacity: int | None = 100, name: str | None = None, address: str = "某路1號",
) -> KindergartenRow:
    return KindergartenRow(
        source_id=source_id, reg_no=None, name=name or f"幼兒園{source_id}", kind=kind, pre_public_period=period,
        district="三民區", address=address, lat=22.64, lng=120.34, approved_capacity=capacity,
        monthly_fee_estimate=None, has_penalty=False, phone=None, registered_on=registered_on,
    )


def many_babycare(count: int) -> list[BabycareRow]:
    return [bc(f"b{index:02d}") for index in range(count)]


async def put_babycare(db, rows, *, now=NOW, force=False):
    report = await apply_babycare(db, rows, synced_at=now, force=force)
    await db.commit()
    return report


async def put_kindergartens(db, rows, *, now=NOW, school_year=115, force=False, backfill=None, listed_places=None):
    report = await apply_kindergartens(
        db, rows, synced_at=now, school_year=school_year, force=force, backfill=backfill, listed_places=listed_places,
    )
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


async def test_a_kindergarten_back_within_30_days_with_a_new_type_keeps_only_the_kind_change(db_session):
    """停辦後 30 天內回來（來源漏收）：停辦事件撤掉、不寫重新營業；但類型真的變了，這筆照寫（規格 §4 第 3 步）。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2", kind="private")])
    await put_kindergartens(db_session, [kg("k1")], now=later(3))
    report = await put_kindergartens(db_session, [kg("k1"), kg("k2", kind="nonprofit")], now=later(10))
    assert (report.cancelled_closures, report.opened, report.kind_changed) == (1, 0, 1)
    assert await events(db_session) == [("kindergarten", "k2", "kind_changed", date(2026, 10, 24), "private", "nonprofit")]


async def test_a_kindergarten_back_after_30_days_with_a_new_type_writes_all_three_events(db_session):
    """第 31 天才回來：停辦、重新營業，類型變了再加一筆（同一天的 opened 在 kind_changed 前面）。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2", kind="private")])
    await put_kindergartens(db_session, [kg("k1")], now=later(3))
    report = await put_kindergartens(db_session, [kg("k1"), kg("k2", kind="nonprofit")], now=later(34))
    assert (report.cancelled_closures, report.opened, report.kind_changed) == (0, 1, 1)
    assert await events(db_session) == [
        ("kindergarten", "k2", "closed", date(2026, 10, 17), None, None),
        ("kindergarten", "k2", "opened", date(2026, 11, 17), None, None),
        ("kindergarten", "k2", "kind_changed", date(2026, 11, 17), "private", "nonprofit"),
    ]


async def test_existing_rows_are_updated_in_place(db_session):
    await put_kindergartens(db_session, [kg("k1", name="舊名", capacity=100)])
    await put_kindergartens(db_session, [kg("k1", name="新名", capacity=120, registered_on=date(2026, 2, 13))], now=later(7))
    row = await db_session.get(GeoKindergarten, "k1")
    assert (row.name, row.approved_capacity, row.registered_on, row.synced_at) == ("新名", 120, date(2026, 2, 13), later(7))
    assert await events(db_session) == []


# ---- 幼兒園：改名與換承辦（2026-10-15 規格 §4） ----

OPENED = date(1996, 10, 14)


async def test_a_renamed_kindergarten_is_retired_without_a_closure(db_session):
    """同地址、同設立日的另一筆出現：舊名下架、不寫停辦；新名的設立日很舊，也不算新設。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1"), kg("new", address="堅如路46號", registered_on=OPENED)], now=later(7)
    )
    assert (report.closed, report.renamed, report.backfilled) == (0, 1, 0)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1", "new"]


async def test_same_address_with_a_different_opening_date_is_a_closure(db_session):
    """同地址換了一所新立案的園（設立日不同）：舊的照記停辦。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1"), kg("new", address="堅如路46號", registered_on=date(2026, 9, 1))], now=later(7)
    )
    assert (report.closed, report.renamed) == (1, 0)
    assert await events(db_session) == [("kindergarten", "old", "closed", date(2026, 10, 21), None, None)]


async def test_without_an_opening_date_the_rename_rule_does_not_apply(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號")])
    report = await put_kindergartens(db_session, [kg("k1"), kg("new", address="堅如路46號")], now=later(7))
    assert (report.closed, report.renamed) == (1, 0)


async def test_a_rename_is_recognised_from_the_registry_before_the_new_entry_has_coordinates(db_session):
    """新名在名單上、但 kiang 還沒算座標（這一輪 rows 沒有它）：用名單的（地址、設立日）認出改名，不寫假停辦。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1")], now=later(7), listed_places=frozenset({("堅如路46號", OPENED)})
    )
    assert (report.closed, report.renamed) == (0, 1)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


# ---- 幼兒園：回補（2026-10-15 規格 §5） ----


async def test_a_backfilled_closure_is_dated_when_it_left_the_list(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    backfill = {"k2": ClosureBackfill("closed", date(2026, 9, 15))}
    report = await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill=backfill)
    assert (report.closed, report.backfilled, report.renamed) == (1, 1, 0)
    assert await events(db_session) == [("kindergarten", "k2", "closed", date(2026, 9, 15), None, None)]
    await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill=backfill)  # 同一天重跑
    await put_kindergartens(db_session, [kg("k1")], now=later(14), backfill=backfill)  # 下一輪
    assert len(await events(db_session)) == 1


async def test_a_backfilled_closure_without_a_date_is_retired_quietly(db_session):
    """2025-06 前就離開名單的：只下架，不在 2026 年冒出一筆停辦。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    report = await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill={"k2": ClosureBackfill("closed", None)})
    assert (report.closed, report.backfilled) == (0, 1)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


async def test_a_backfilled_rename_is_retired_quietly(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    report = await put_kindergartens(
        db_session, [kg("k1")], now=later(7), backfill={"k2": ClosureBackfill("renamed", date(2026, 3, 25))}
    )
    assert (report.closed, report.renamed, report.backfilled) == (0, 1, 0)
    assert await events(db_session) == []


async def test_the_backfill_file_wins_over_the_rename_rule(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1"), kg("new", address="堅如路46號", registered_on=OPENED)], now=later(7),
        backfill={"old": ClosureBackfill("closed", date(2026, 9, 15))},
    )
    assert (report.closed, report.renamed, report.backfilled) == (1, 0, 1)
    assert await events(db_session) == [("kindergarten", "old", "closed", date(2026, 9, 15), None, None)]


async def test_backfill_entries_only_matter_when_a_kindergarten_leaves(db_session):
    """檔裡的園所還在名單上、或資料表根本沒有它：什麼都不做。"""
    backfill = {"k1": ClosureBackfill("closed", date(2026, 9, 15)), "ghost": ClosureBackfill("closed", date(2026, 9, 1))}
    await put_kindergartens(db_session, [kg("k1")])
    report = await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill=backfill)
    assert (report.closed, report.backfilled) == (0, 0)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


async def test_a_backfilled_kindergarten_that_comes_back_later_reopens(db_session):
    """回補日期 09-15 離回來那天 10-28 超過 30 天：不是漏收，停辦留著、另寫重新營業。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    await put_kindergartens(
        db_session, [kg("k1")], now=later(7), backfill={"k2": ClosureBackfill("closed", date(2026, 9, 15))}
    )
    report = await put_kindergartens(db_session, [kg("k1"), kg("k2")], now=later(14))
    assert (report.opened, report.cancelled_closures) == (1, 0)
    assert await events(db_session) == [
        ("kindergarten", "k2", "closed", date(2026, 9, 15), None, None),
        ("kindergarten", "k2", "opened", date(2026, 10, 28), None, None),
    ]


# ---- 幼兒園：回補檔補列與停辦事件（2026-10-20 招生潛力第二、三波） ----

LEFT = date(2026, 3, 1)  # 離 TODAY 近 12 個月內：nearby_changes 看得到


def gone(left_on: date | None = LEFT, **overrides) -> ClosureBackfill:
    values = {"name": "高雄市私立舊幼兒園", "approved_capacity": 90, "lat": 22.64, "lng": 120.34, "kind": "nonprofit"}
    return ClosureBackfill("closed", left_on, **{**values, **overrides})


async def put_backfill(db, backfill, *, now=NOW):
    count = await apply_closure_backfill(db, backfill, synced_at=now)
    await db.commit()
    return count


async def test_backfill_inserts_missing_kindergarten_and_event(db_session):
    """資料表沒有的停辦園所：補一列停辦的，名稱、核定、座標、類型取自檔，停辦事件寫在離開名單那天。"""
    assert await put_backfill(db_session, {"gone": gone()}) == 1
    row = await db_session.get(GeoKindergarten, "gone")
    assert (row.is_active, row.name, row.approved_capacity, row.kind) == (False, "高雄市私立舊幼兒園", 90, "nonprofit")
    assert (row.lat, row.lng, row.synced_at, row.has_penalty) == (22.64, 120.34, NOW, False)
    assert await events(db_session) == [("kindergarten", "gone", "closed", LEFT, None, None)]
    # 補的列 join 得到名稱與座標：三公里內的近 12 個月變化看得到它
    changes = await nearby_changes(db_session, 22.64, 120.34, 3000, today=TODAY)
    assert [(c.source_id, c.name, c.change, c.date) for c in changes] == [("gone", "高雄市私立舊幼兒園", "closed", LEFT)]


async def test_backfill_writes_the_event_for_a_row_that_is_already_closed(db_session):
    """表裡已有這一所、而且是停辦的：不動那一列，只補事件。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", name="表裡的名字")])
    await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill={"old": ClosureBackfill("renamed", None)})
    assert await events(db_session) == []
    assert await put_backfill(db_session, {"old": gone(name="檔裡的名字")}, now=later(14)) == 1
    row = await db_session.get(GeoKindergarten, "old")
    assert (row.is_active, row.name) == (False, "表裡的名字")
    assert await events(db_session) == [("kindergarten", "old", "closed", LEFT, None, None)]


async def test_backfill_idempotent(db_session):
    backfill = {"gone": gone()}
    assert await put_backfill(db_session, backfill) == 1
    assert await put_backfill(db_session, backfill, now=later(7)) == 0
    assert await put_backfill(db_session, backfill, now=later(14)) == 0
    assert len(await events(db_session)) == 1
    assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 1
    assert (await db_session.get(GeoKindergarten, "gone")).synced_at == NOW  # 第二輪沒有碰那一列


async def test_backfill_does_not_double_count_a_closure_that_was_already_recorded(db_session):
    """同一所已經有停辦事件（例如先前一般停辦寫在同步當天）：不再用檔裡的日期補第二筆。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    await put_kindergartens(db_session, [kg("k1")], now=later(7))  # k2 一般停辦，事件 2026-10-21
    assert await put_backfill(db_session, {"k2": gone()}, now=later(14)) == 0
    assert await events(db_session) == [("kindergarten", "k2", "closed", date(2026, 10, 21), None, None)]


async def test_backfill_skips_active_and_no_coords(db_session):
    await put_kindergartens(db_session, [kg("k1")])
    backfill = {
        "k1": gone(),  # 營業中：交給 retire 流程，這裡不碰
        "no-lat": gone(lat=None, lng=None),  # 表裡沒有、檔裡也沒有座標：欄位非空，不補列
        "half": gone(lat=22.64, lng=None),
        "renamed": ClosureBackfill("renamed", LEFT, name="改名", lat=22.64, lng=120.34, kind="private"),
        "no-date": gone(left_on=None),  # 回補窗口前就消失：沒有日期，不寫事件也不補列
        "ok": gone(),
    }
    assert await put_backfill(db_session, backfill) == 1
    assert await events(db_session) == [("kindergarten", "ok", "closed", LEFT, None, None)]
    assert sorted((await db_session.scalars(select(GeoKindergarten.source_id))).all()) == ["k1", "ok"]
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


async def test_backfill_fills_in_defaults_for_a_missing_kind_and_capacity(db_session):
    await put_backfill(db_session, {"gone": gone(kind=None, approved_capacity=None)})
    row = await db_session.get(GeoKindergarten, "gone")
    assert (row.kind, row.approved_capacity, row.is_active) == ("private", None, False)


async def test_backfill_ignores_closures_older_than_the_retention(db_session):
    """比保留期還舊的不寫（寫了下一輪也會被刪掉，列也不必補）。"""
    old = months_ago(TODAY, 73)
    assert await put_backfill(db_session, {"gone": gone(left_on=old)}) == 0
    assert await events(db_session) == []
    assert await db_session.get(GeoKindergarten, "gone") is None


async def test_backfill_survives_the_next_sync_and_the_retention_sweep(db_session):
    """補上的停辦（2022 年）不被同一輪的保留期清掃刪掉，下一輪同步也不會改動它。"""
    left = date(2022, 10, 1)  # 約 48 個月前
    await put_kindergartens(db_session, [kg("k1")])
    await put_backfill(db_session, {"gone": gone(left_on=left)})
    await put_kindergartens(db_session, [kg("k1")], now=later(7))
    assert await events(db_session) == [("kindergarten", "gone", "closed", left, None, None)]
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


async def test_backfill_failure_does_not_block_sync(db_session, caplog):
    """回補寫入出錯（這裡是類型違反約束）：只退回自己的 SAVEPOINT 並記 warning，同一個交易裡的名單同步照常提交。"""
    await put_kindergartens(db_session, [kg("k1")])
    await apply_kindergartens(db_session, [kg("k1"), kg("k2")], synced_at=later(7), school_year=115)  # 還沒 commit
    broken = {"bad": gone(kind="bogus"), "ok": gone()}
    with caplog.at_level("WARNING"):
        assert await safe_apply_closure_backfill(db_session, broken, synced_at=later(7)) == 0
    assert "回補" in caplog.text
    await db_session.commit()
    assert await active_ids(db_session, GeoKindergarten) == ["k1", "k2"]
    assert await db_session.get(GeoKindergarten, "bad") is None
    assert await db_session.get(GeoKindergarten, "ok") is None  # 同一個 SAVEPOINT 全退回
    assert await events(db_session) == []
    # 修好之後下一輪補得上
    assert await safe_apply_closure_backfill(db_session, {"ok": gone()}, synced_at=later(14)) == 1


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


async def test_renewing_the_quasi_public_period_before_the_year_turns_is_not_a_kind_change(db_session):
    """113-115 續約成 116-118，來源在學年更替前先公布（學年 115，新列解析成私立）：續約不是類型變動。"""
    await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="113-115")], school_year=115)
    report = await put_kindergartens(db_session, [kg("k1", kind="private", period="116-118")], now=later(7), school_year=115)
    assert report.kind_changed == 0 and await events(db_session) == []
    row = await db_session.get(GeoKindergarten, "k1")
    assert (row.kind, row.pre_public_period) == ("private", "116-118")  # 資料表照新的更新


async def test_renewing_the_quasi_public_period_after_the_year_turns_is_not_a_kind_change(db_session):
    """續約在學年更替之後才進來（學年 116，舊列是 115 學年存的準公共，新列解析成準公共）：也不算。"""
    await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="113-115")], school_year=115)
    report = await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="116-118")], now=later(300), school_year=116)
    assert report.kind_changed == 0 and await events(db_session) == []


async def test_dropping_the_quasi_public_period_is_a_kind_change(db_session):
    """退出：舊期間涵蓋當學年、新期間為空。"""
    await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="113-115")], school_year=115)
    report = await put_kindergartens(db_session, [kg("k1", kind="private")], now=later(7), school_year=115)
    assert report.kind_changed == 1
    assert await events(db_session) == [("kindergarten", "k1", "kind_changed", date(2026, 10, 21), "quasi_public", "private")]


async def test_joining_the_quasi_public_program_is_a_kind_change(db_session):
    """加入：舊列沒有期間，新期間涵蓋當學年。"""
    await put_kindergartens(db_session, [kg("k1", kind="private")], school_year=115)
    report = await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="115-115")], now=later(7), school_year=115)
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


async def test_events_older_than_72_months_are_pruned_per_provider(db_session):
    await put_babycare(db_session, [bc("b1")])
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="old", change="closed", occurred_on=date(2020, 10, 13)),
            GeoProviderEvent(provider="babycare", source_id="edge", change="closed", occurred_on=date(2020, 10, 14)),
            GeoProviderEvent(provider="kindergarten", source_id="kold", change="closed", occurred_on=date(2015, 1, 1)),
        ]
    )
    await db_session.commit()
    await put_babycare(db_session, [bc("b1")])  # 同一天再跑：今天 2026-10-14，保留期從 2020-10-14 起
    assert {(event[0], event[1]) for event in await events(db_session)} == {("babycare", "edge"), ("kindergarten", "kold")}


async def test_retention_keeps_72_months(db_session):
    """回補檔從 2022-08 起：60 個月前的停辦同步後仍在，80 個月前的才被刪（保留期原本 24 個月）。"""
    await put_kindergartens(db_session, [kg("k1")])
    db_session.add_all(
        [
            GeoProviderEvent(provider="kindergarten", source_id="k60", change="closed", occurred_on=months_ago(TODAY, 60)),
            GeoProviderEvent(provider="kindergarten", source_id="k80", change="closed", occurred_on=months_ago(TODAY, 80)),
        ]
    )
    await db_session.commit()
    await put_kindergartens(db_session, [kg("k1")], now=later(7))
    assert [(event[1], event[3]) for event in await events(db_session)] == [("k60", months_ago(TODAY, 60))]


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
