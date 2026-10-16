"""附近同業收費的測試資料：義華周邊自己放幾所幼兒園與收費（不依賴樣本名單裡有哪幾所）。"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import delete

from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenFee
from tests.geo_helpers import YIHUA_POINT, load_geo_samples, publish_campus_address

OWN_ITEMS = {"tuition": 19900, "misc_fee": 5500, "materials": 24750, "activities": 23100, "lunch": 8250, "snack": 8250, "after_care_monthly": 1200}


def add_kindergarten(db, source_id: str, name: str, kind: str, north_m: float, **extra) -> None:
    lat, lng = YIHUA_POINT
    db.add(GeoKindergarten(
        source_id=source_id, name=name, kind=kind, district="三民區", address="某路1號",
        lat=lat + north_m / 111_320.0, lng=lng, approved_capacity=extra.pop("approved_capacity", 100),
        has_penalty=False, is_active=extra.pop("is_active", True), synced_at=datetime.now(timezone.utc), **extra,
    ))


def add_fee(db, source_id: str, age: int, total: int, *, months: Decimal | None = Decimal("5.5"), school_year: int = 114, **items) -> None:
    db.add(GeoKindergartenFee(
        source_id=source_id, age=age, school_year=school_year, months=months, semester_total=total,
        synced_at=datetime.now(timezone.utc), **items,
    ))


@pytest.fixture
async def peers(db_session):
    """義華（門牌樣本座標）周邊：本校、私立 4 所（1 所沒收費）、準公共、公立、非營利各 1、4 公里外私立 1、停辦 1。
    3 歲收費：本校 89,750；私立 75,000／93,000／40,200；準公共 63,190；公立 17,965；4 公里外 120,000；停辦 999,999。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    await db_session.execute(delete(GeoKindergartenFee))
    await db_session.execute(delete(GeoKindergarten))
    add_kindergarten(db_session, "own", "高雄市私立常春藤幼兒園", "private", 0, approved_capacity=210)
    add_kindergarten(db_session, "p1", "高雄市私立甲幼兒園", "private", 300)
    add_kindergarten(db_session, "p2", "高雄市私立乙幼兒園", "private", 600)
    add_kindergarten(db_session, "p3", "高雄市私立丙幼兒園", "private", 900)
    add_kindergarten(db_session, "p4", "高雄市私立丁幼兒園", "private", 1200)
    add_kindergarten(db_session, "q1", "高雄市私立戊幼兒園", "quasi_public", 400, pre_public_period="113-115")
    add_kindergarten(db_session, "pub", "高雄市立己幼兒園", "public", 500)
    add_kindergarten(db_session, "np", "高雄市庚非營利幼兒園", "nonprofit", 700)
    add_kindergarten(db_session, "far", "高雄市私立遠幼兒園", "private", 4000)
    add_kindergarten(db_session, "gone", "高雄市私立停幼兒園", "private", 200, is_active=False)
    await db_session.flush()
    add_fee(db_session, "own", 3, 89750, **OWN_ITEMS, transport_note="單 770 雙 1540")
    add_fee(db_session, "own", 2, 105950)
    add_fee(db_session, "p1", 3, 75000, tuition=15000)
    add_fee(db_session, "p2", 3, 93000, tuition=16000)
    add_fee(db_session, "p3", 3, 40200, tuition=12000, months=None)
    add_fee(db_session, "q1", 3, 63190)
    add_fee(db_session, "pub", 3, 17965)
    add_fee(db_session, "far", 3, 120000)
    add_fee(db_session, "gone", 3, 999999)
    now = datetime.now(timezone.utc)
    db_session.add(GeoDatasetStatus(dataset="kindergarten_fees", active_version="114", label="114", synced_at=now, checked_at=now))
    await db_session.commit()
