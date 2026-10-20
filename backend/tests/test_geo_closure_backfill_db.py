"""隨程式提交的真回補檔寫進資料庫（2026-10-20 招生潛力第二、三波，總審查補洞）。

conftest 的 _no_shipped_closure_backfill 讓同步測試不吃真檔，單元測試又只用 tmp 檔；沒有人守「真檔 + apply_closure_backfill」
實際寫出什麼。這裡用真檔、固定 synced_at 驗：寫入的停辦事件數、義華 3 公里內來源一用的那 11 所與核定名額合計。"""

from __future__ import annotations

import csv
from datetime import date, datetime, timezone

from sqlalchemy import func, select

from app.admissions.geo.closure_backfill import BACKFILL_FILE, load_closure_backfill
from app.admissions.geo.models import GeoKindergarten, GeoProviderEvent
from app.admissions.geo.projection import haversine_m
from app.admissions.geo.providers import EVENT_RETENTION_MONTHS, apply_closure_backfill, months_ago

SYNCED_AT = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)  # 台北 2026-10-20 12:00
TODAY = date(2026, 10, 20)
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
FIRST_WINDOW_START = date(2022, 10, 1)


def _file_rows() -> list[dict]:
    with BACKFILL_FILE.open(encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def _expected_event_ids() -> set[str]:
    """closed、有 left_on、left_on 在 72 個月保留期內、有座標的 source_id（不經載入器，直接讀檔）。"""
    oldest = months_ago(TODAY, EVENT_RETENTION_MONTHS)
    return {
        row["source_id"]
        for row in _file_rows()
        if row["reason"] == "closed" and row["left_on"] and date.fromisoformat(row["left_on"]) >= oldest
        and row["lat"] and row["lng"]
    }


async def test_the_shipped_file_writes_one_closed_event_per_eligible_school(db_session):
    expected = _expected_event_ids()
    assert len(expected) > 50  # 檔本身的守門：數字掉到很少代表檔被截了

    written = await apply_closure_backfill(db_session, load_closure_backfill(), synced_at=SYNCED_AT)

    assert written == len(expected)
    event_ids = set((await db_session.execute(select(GeoProviderEvent.source_id).where(GeoProviderEvent.change == "closed"))).scalars())
    assert event_ids == expected
    rows = (await db_session.execute(select(func.count()).select_from(GeoKindergarten).where(GeoKindergarten.is_active.is_(False)))).scalar_one()
    assert rows == len(expected)  # 資料表原本是空的：每個寫事件的園所都補了一列停辦的


async def test_a_second_run_writes_nothing_more(db_session):
    backfill = load_closure_backfill()
    await apply_closure_backfill(db_session, backfill, synced_at=SYNCED_AT)

    assert await apply_closure_backfill(db_session, backfill, synced_at=SYNCED_AT) == 0


async def test_yihua_has_eleven_closures_with_1578_seats_within_3_km_since_2022_10(db_session):
    await apply_closure_backfill(db_session, load_closure_backfill(), synced_at=SYNCED_AT)

    rows = (
        await db_session.execute(
            select(GeoProviderEvent.occurred_on, GeoKindergarten)
            .join(GeoKindergarten, GeoKindergarten.source_id == GeoProviderEvent.source_id)
            .where(GeoProviderEvent.provider == "kindergarten", GeoProviderEvent.change == "closed")
            .where(GeoProviderEvent.occurred_on >= FIRST_WINDOW_START)
        )
    ).all()
    near = [school for _, school in rows if haversine_m(YIHUA_LAT, YIHUA_LNG, school.lat, school.lng) <= 3000]

    assert len({school.source_id for school in near}) == len(near) == 11
    assert sum(school.approved_capacity or 0 for school in near) == 1578
