"""區域分析歷年 2–5 歲人口 API（docs/specs/2026-11-16-area-compare-notices-design.md §5）。

義華校址固定在門牌樣本座標；里界重心到義華：本揚里 287 m、寶業里 329 m、寶國里 458 m、本上里 489 m
（1 公里內）、三民區本武里 1,530 m（3 公里內）、小港區青島里約 8 公里（3 公里外）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import (
    GeoDatasetStatus,
    GeoVillageAgesSeptember,
    GeoVillageMigration,
    GeoVillagePopulation,
)
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401

HISTORY = f"{AREA}/children-history"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
NOW = datetime(2026, 11, 16, 4, 0, tzinfo=timezone.utc)
BEN_YANG = ("三民區", "本揚里")
BAO_YE = ("三民區", "寶業里")
BEN_SHANG = ("三民區", "本上里")
QING_DAO = ("小港區", "青島里")


@pytest.fixture
def located_campus(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district="三民區")

    monkeypatch.setattr(matcher, "campus_point", located)


def _code(key: tuple[str, str]) -> str:
    return boundaries.village_code(*key)


def _ages(per_age: int) -> dict[str, int]:
    return {f"age_{n}": per_age for n in range(7)} | {"people_total": per_age * 30}


async def _population(db, rows: dict[tuple[str, str], int], *, label: str | None = "115-10") -> None:
    for key, per_age in rows.items():
        db.add(GeoVillagePopulation(village_code=_code(key), district=key[0], village=key[1], **_ages(per_age)))
    db.add(GeoDatasetStatus(dataset="population", active_version=label, label=label, synced_at=NOW if label else None))
    await db.flush()


async def _september(db, year: int, rows: dict[tuple[str, str], int]) -> None:
    for key, per_age in rows.items():
        db.add(GeoVillageAgesSeptember(year=year, village_code=_code(key), district=key[0], village=key[1], **_ages(per_age)))
    await db.flush()


async def _seed(db) -> None:
    await _population(db, {BEN_YANG: 100, BAO_YE: 50, BEN_SHANG: 10, QING_DAO: 200})
    await _september(db, 107, {BEN_YANG: 90, BAO_YE: 40})
    await _september(db, 108, {BEN_YANG: 95, BAO_YE: 45})
    await _september(db, 115, {BEN_YANG: 98, BAO_YE: 49, BEN_SHANG: 9, QING_DAO: 190})
    await db.commit()


def _by_village(body: dict) -> dict[str, dict]:
    return {row["village"]: row for row in body["villages"]}


async def test_years_and_counts(admin_client, db_session, located_campus):
    await _seed(db_session)
    response = await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=1")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["years"] == [107, 108, 115]
    assert body["latest"]["label"] == "115-10"
    assert body["unavailable"] is None
    rows = _by_village(body)
    # 2–5 歲＝四個年齡相加。
    assert rows["本揚里"]["counts"] == {"107": 360, "108": 380, "115": 392, "latest": 400}
    assert rows["寶業里"]["counts"] == {"107": 160, "108": 180, "115": 196, "latest": 200}
    assert rows["本揚里"]["distance_m"] == 300
    assert body["max_children"] == 400
    # 距離由近到遠。
    distances = [row["distance_m"] for row in body["villages"]]
    assert distances == sorted(distances) and len(distances) == 3


async def test_new_village_has_null_before_it_existed(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = (await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=1")).json()
    row = _by_village(body)["本上里"]
    assert row["counts"]["107"] is None and row["counts"]["108"] is None
    assert row["counts"]["115"] == 36 and row["counts"]["latest"] == 40


async def test_retired_listed_only_in_same_district(admin_client, db_session, located_campus):
    await _seed(db_session)
    near_code = _code(BEN_YANG)
    same_district_retired = near_code[:7] + "9001"
    other_district_retired = _code(QING_DAO)[:7] + "9001"
    assert same_district_retired not in boundaries.village_names()
    for year, code, name in (
        (107, same_district_retired, "舊本里"),
        (108, same_district_retired, "舊本里"),
        (107, other_district_retired, "舊青里"),
    ):
        db_session.add(GeoVillageAgesSeptember(year=year, village_code=code, district="三民區", village=name, **_ages(10)))
    await db_session.commit()
    body = (await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=1")).json()
    assert body["retired"] == [
        {"village_code": same_district_retired, "district": "三民區", "village": "舊本里", "years": [107, 108]}
    ]
    assert all(row["village_code"] != same_district_retired for row in body["villages"])


async def test_adjusted_month_flagged(admin_client, db_session, located_campus):
    await _seed(db_session)
    # 本揚里人口 3,000 人（1% ＝ 30）：30 人才過；寶業里只有 19 人，不到 20 人的底線。
    for key, moved in ((BEN_YANG, 30), (BAO_YE, 19)):
        db_session.add(
            GeoVillageMigration(
                month="115-07", village_code=_code(key), district=key[0], village=key[1],
                moved_in=0, moved_out=0, address_in=0, address_out=0, boundary_in=moved, boundary_out=0,
            )
        )
    await db_session.commit()
    rows = _by_village((await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=1")).json())
    assert rows["本揚里"]["adjusted"] == ["115-07"]
    assert rows["寶業里"]["adjusted"] == []


async def test_campus_without_point(admin_client, db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _seed(db_session)
    body = (await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=3")).json()
    assert body["unavailable"] == "no_campus_point"
    assert body["villages"] == [] and body["campus"]["locate_error"] == "no_doorplate"


async def test_no_history(admin_client, db_session, located_campus):
    await _population(db_session, {BEN_YANG: 100})
    await db_session.commit()
    body = (await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=3")).json()
    assert body["unavailable"] == "no_history"
    assert body["years"] == []


@pytest.mark.parametrize("radius", ["2", "abc"])
async def test_rejects_bad_radius(admin_client, radius):
    response = await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_permissions_and_unknown_campus(admin_client, reception_yihua_client, readonly_yihua_client):
    for client in (reception_yihua_client, readonly_yihua_client):
        assert (await client.get(f"{HISTORY}?campus_key=yihua&radius_km=3")).status_code == 403
    assert (await admin_client.get(f"{HISTORY}?campus_key=nope&radius_km=3")).status_code == 404


async def test_only_villages_within_radius(admin_client, db_session, located_campus):
    await _seed(db_session)
    near = _by_village((await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=3")).json())
    assert "青島里" not in near and "本揚里" in near
    wide = _by_village((await admin_client.get(f"{HISTORY}?campus_key=yihua&radius_km=6")).json())
    assert "青島里" not in wide  # 約 8 公里
