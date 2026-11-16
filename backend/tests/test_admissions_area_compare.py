"""五校周邊環境比較 API（docs/specs/2026-11-16-area-compare-notices-design.md §6）：/area/compare。

測試資料：義華周邊用 peer_fees_helpers 的幼兒園與收費；人口與一年前年齡用里的變化測試的 _seed。
located_campus 讓五校都落在義華的座標（數字一樣，才好驗各列各自成敗）。"""

from __future__ import annotations

import pytest
from sqlalchemy import update
from sqlalchemy.exc import ProgrammingError
from sqlalchemy import text

from app.admissions import area as area_service
from app.admissions.geo import matcher
from app.admissions.geo.models import GeoKindergarten
from app.campuses.models import CAMPUS_KEYS
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.geo_helpers import load_babycare_sample
from tests.peer_fees_helpers import peers  # noqa: F401
from tests.test_admissions_trends import _seed, located_campus  # noqa: F401

COMPARE = f"{AREA}/compare"
YIHUA = f"campus_key=yihua&radius_km=3"


async def _rows(client, radius: int = 3) -> dict[str, dict]:
    response = await client.get(f"{COMPARE}?radius_km={radius}")
    assert response.status_code == 200, response.text
    return {row["campus_key"]: row for row in response.json()["rows"]}


async def test_rows_for_visible_campuses(admin_client, db_session, located_campus, peers):
    response = await admin_client.get(COMPARE)
    assert response.status_code == 200
    body = response.json()
    assert body["radius_km"] == 3
    assert [row["campus_key"] for row in body["rows"]] == list(CAMPUS_KEYS)


async def test_numbers_match_single_campus_endpoints(admin_client, db_session, located_campus, peers):
    await _seed(db_session)
    await load_babycare_sample(db_session)
    row = (await _rows(admin_client))["yihua"]
    opportunity = (await admin_client.get(f"{AREA}/opportunity?{YIHUA}")).json()
    trends = (await admin_client.get(f"{AREA}/trends?{YIHUA}")).json()
    fees = (await admin_client.get(f"{AREA}/fees?{YIHUA}&age=3")).json()
    changes = (await admin_client.get(f"{AREA}/changes?{YIHUA}")).json()
    babycare = (await admin_client.get(f"{AREA}/babycare?{YIHUA}")).json()
    assert row["unavailable"] is None
    assert row["children"] == opportunity["baseline"]["children"] and row["children"] > 0
    assert row["kids_net"] == trends["baseline"]["kids_net"] and row["kids_net"] is not None
    assert row["kids_unavailable"] == trends["kids_unavailable"]
    private, quasi, public, nonprofit = fees["groups"]
    assert row["kindergartens"] == {
        "private": private["schools"], "quasi_public": quasi["schools"], "public": public["schools"], "nonprofit": nonprofit["schools"],
    }
    # 常春藤本校不算同業：義華周邊私立 4 所（甲乙丙丁）、準公共、公立、非營利各 1。
    assert row["kindergartens"] == {"private": 4, "quasi_public": 1, "public": 1, "nonprofit": 1}
    assert (row["own_fee"], row["own_kind"], row["own_missing"]) == (89750, "private", None)
    assert (row["fee_median"], row["fee_rank"], row["fee_rank_total"]) == (private["median"], private["own_rank"], private["rank_total"])
    assert (row["fee_rank"], row["fee_rank_total"]) == (2, 4)
    assert row["changes_12m"] == len(changes["items"])
    assert row["babycare"] == babycare["summary"]["count"]


async def test_campus_without_point(admin_client, db_session, monkeypatch, peers):
    real = matcher.campus_point

    async def selective(db, campus_key):
        if campus_key == "minghua":
            return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district="")
        return await real(db, campus_key)

    monkeypatch.setattr(matcher, "campus_point", selective)
    rows = await _rows(admin_client)
    assert rows["minghua"]["unavailable"] == "no_campus_point" and rows["minghua"]["locate_error"] == "no_doorplate"
    for key in ("children", "kids_net", "kindergartens", "babycare", "own_fee", "fee_median", "fee_rank", "changes_12m"):
        assert rows["minghua"][key] is None
    assert rows["yihua"]["unavailable"] is None and rows["yihua"]["own_fee"] == 89750


async def test_one_campus_error_does_not_poison_others(admin_client, db_session, located_campus, peers, monkeypatch):
    real = area_service.query_babycare

    async def flaky(db, campus_key, *, radius_km):
        if campus_key == "minghua":
            await db.execute(text("select * from this_table_does_not_exist"))
        return await real(db, campus_key, radius_km=radius_km)

    monkeypatch.setattr(area_service, "query_babycare", flaky)
    response = await admin_client.get(COMPARE)
    assert response.status_code == 200
    rows = {row["campus_key"]: row for row in response.json()["rows"]}
    assert rows["minghua"]["unavailable"] == "error" and rows["minghua"]["own_fee"] is None
    for key in CAMPUS_KEYS:
        if key != "minghua":
            assert rows[key]["unavailable"] is None, key
            assert rows[key]["babycare"] is not None and rows[key]["kindergartens"] is not None, key
    assert ProgrammingError  # 例外型別在 savepoint 內真的發生過（上面的壞 SQL）


async def test_quasi_public_campus_fee_cell(admin_client, db_session, located_campus, peers):
    await db_session.execute(
        update(GeoKindergarten).where(GeoKindergarten.source_id == "own").values(kind="quasi_public", pre_public_period="113-115")
    )
    await db_session.commit()
    row = (await _rows(admin_client))["yihua"]
    assert row["own_kind"] == "quasi_public" and row["own_fee"] == 89750
    assert row["fee_rank"] is None and row["fee_rank_total"] is None
    assert row["fee_median"] == 75000


@pytest.mark.parametrize("radius", ["2", "abc"])
async def test_rejects_bad_radius(admin_client, radius):
    response = await admin_client.get(f"{COMPARE}?radius_km={radius}")
    assert response.status_code == 422 and response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_permissions_and_visible_campuses(admin_client, reception_yihua_client, readonly_yihua_client, minghua_client, located_campus, peers):
    for client in (reception_yihua_client, readonly_yihua_client, minghua_client):
        assert (await client.get(COMPARE)).status_code == 403
    assert (await admin_client.get(COMPARE)).status_code == 200
