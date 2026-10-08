"""招生區域分析 API（2026-10-08 區域分析規格 §8）：層級與口徑、與 /stats 一致、權限、
開關、校區未定位、幼兒園、里界。"""

from __future__ import annotations

import pytest

from app.admissions import area
from app.admissions.geo import matcher
from app.main import create_app
from tests.admissions_area_helpers import AREA, API, add_visit, seed_area
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

TERM = "school_year=115&semester=1"
# 義華校址在門牌樣本裡的座標（tests/geo_helpers.YIHUA_POINT）。
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133


def _point(campus_key: str, lat: float | None, lng: float | None, error: str | None = None) -> matcher.CampusPoint:
    return matcher.CampusPoint(campus_key=campus_key, lat=lat, lng=lng, locate_error=error)


@pytest.fixture
def located_campus(monkeypatch):
    """seed_area 直接寫 distance_m，測試庫沒有已發布的校址；R6 規定校區沒座標時距離一律
    歸 none，所以要距離分組有數字的測試先把校區定位。"""

    async def located(db, campus_key):
        return _point(campus_key, YIHUA_LAT, YIHUA_LNG)

    monkeypatch.setattr(matcher, "campus_point", located)


def test_distance_band_edges():
    assert [area.distance_band(m) for m in (None, 0, 999, 1000, 2999, 3000, 5999, 6000, 20000)] == [
        "none", "0-1", "0-1", "1-3", "1-3", "3-6", "3-6", "6+", "6+",
    ]


async def test_area_levels_rows_and_bands(admin_client, db_session, located_campus):
    await seed_area(db_session)
    await db_session.commit()
    response = await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1}
    assert body["totals"] == {
        "visit": 11,
        "with_address": 8,
        "village_level": 3,
        "district_level": 2,
        "unlocated": 1,
        "pending": 2,
        "no_address": 1,
        "anonymized": 2,
        # 只算有地址、卻沒到里的原因；V5 里有歧義、V7 外縣市各一筆，同數量時依固定順序。
        "unlocated_reasons": [
            {"reason": "outside_kaohsiung", "count": 1},
            {"reason": "ambiguous_village", "count": 1},
        ],
    }
    assert body["campus"] == {"key": "yihua", "name": body["campus"]["name"], "lat": YIHUA_LAT, "lng": YIHUA_LNG,
                              "locate_error": None}
    assert body["districts"] == [
        {"district": "三民區", "visit": 5, "deposit": 2, "visit_to_deposit_rate": 40.0},
        {"district": "左營區", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
    ]
    villages = [(row["district"], row["village"], row["visit"], row["deposit"], row["visit_to_deposit_rate"])
                for row in body["villages"]]
    assert villages == [("三民區", "鼎金里", 2, 1, 50.0), ("三民區", "寶業里", 1, 1, 100.0)]
    assert body["villages"][0]["village_code"] == "64000050001"
    assert body["distance_bands"] == [
        {"band": "0-1", "visit": 1, "deposit": 1, "visit_to_deposit_rate": 100.0},
        {"band": "1-3", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
        {"band": "3-6", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None},
        {"band": "6+", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None},
        {"band": "none", "visit": 9, "deposit": 1, "visit_to_deposit_rate": 11.1},
    ]
    assert body["data_status"]["boundary_version"]
    assert body["data_status"]["doorplate_version"] is None  # 這個測試沒匯入門牌樣本


async def test_area_totals_invariants_on_seed(admin_client, db_session):
    """R5：有地址的四個層級加起來＝有地址；有地址＋沒地址＋已匿名化＝全部。"""
    await seed_area(db_session)
    await db_session.commit()
    totals = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["totals"]
    assert totals["village_level"] + totals["district_level"] + totals["unlocated"] + totals["pending"] == totals["with_address"]
    assert totals["with_address"] + totals["no_address"] + totals["anonymized"] == totals["visit"]


async def test_area_totals_invariants_with_odd_rows(admin_client, db_session):
    """邊角資料也要守住不變式：只有空白的地址算沒地址（同訪視明細 geo=no_village 的判斷）；
    有地址、但比對說 no_address（地址整串被正規化掉）仍算有地址、未定位，且不進原因清單。"""
    await seed_area(db_session)
    await add_visit(db_session, address="   ", geo={"level": "unlocated", "reason": "no_address"})
    await add_visit(db_session, address="-", geo={"level": "unlocated", "reason": "no_address"})
    await add_visit(db_session, address="高雄市三民區測試路2號", geo={"level": "unlocated", "reason": "no_doorplate"})
    await db_session.commit()
    totals = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["totals"]
    assert totals["visit"] == 14
    assert totals["no_address"] == 2  # V6 與只有空白的地址
    assert totals["with_address"] == 10
    assert totals["unlocated"] == 3  # V7、地址是 "-" 的、查無門牌的
    assert totals["village_level"] + totals["district_level"] + totals["unlocated"] + totals["pending"] == totals["with_address"]
    assert totals["with_address"] + totals["no_address"] + totals["anonymized"] == totals["visit"]
    assert {item["reason"]: item["count"] for item in totals["unlocated_reasons"]} == {
        "outside_kaohsiung": 1, "no_doorplate": 1, "ambiguous_village": 1,
    }


async def test_area_reasons_sorted_by_count_then_fixed_order(admin_client, db_session):
    for _ in range(2):
        await add_visit(db_session, district="三民區", geo={"level": "district", "reason": "ambiguous_village"})
    await add_visit(db_session, geo={"level": "unlocated", "reason": "no_doorplate"})
    await add_visit(db_session, address="臺北市大安區測試路1號", geo={"level": "unlocated", "reason": "outside_kaohsiung"})
    await db_session.commit()
    reasons = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["totals"]["unlocated_reasons"]
    assert reasons == [
        {"reason": "ambiguous_village", "count": 2},
        {"reason": "outside_kaohsiung", "count": 1},
        {"reason": "no_doorplate", "count": 1},
    ]


async def test_area_address_counts_match_the_records_drilldown(admin_client, db_session):
    """畫面上的「未定位到里」筆數要等於按「查看」跳到訪視明細的筆數（同一個有地址判斷）。"""
    await seed_area(db_session)
    await add_visit(db_session, address="   ", geo={"level": "unlocated", "reason": "no_address"})
    await db_session.commit()
    totals = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["totals"]
    listed = await admin_client.get(
        f"{API}/admin/admissions/records?campus_key=yihua&{TERM}&geo=no_village&page_size=100"
    )
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == totals["district_level"] + totals["unlocated"] + totals["pending"]


async def test_area_data_status_reads_doorplate_label(admin_client, db_session):
    """畫面顯示門牌月份（geo_dataset_status.label），不是內部批次標記 active_version。"""
    from tests.geo_helpers import SAMPLE_LABEL, load_geo_samples

    await load_geo_samples(db_session)
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["data_status"]["doorplate_version"] == SAMPLE_LABEL == "115-10"
    assert body["data_status"]["doorplates_synced_at"] is not None
    assert body["data_status"]["kindergartens_synced_at"] is not None


async def test_area_counts_match_stats(admin_client, db_session, located_campus):
    """參觀人數、預繳人數與 /stats 同口徑（同母體、同計數）。"""
    await seed_area(db_session)
    await db_session.commit()
    stats = (await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&{TERM}")).json()
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["totals"]["visit"] == stats["kpi"]["visit"]
    assert sum(band["visit"] for band in body["distance_bands"]) == stats["kpi"]["visit"]
    assert sum(band["deposit"] for band in body["distance_bands"]) == stats["kpi"]["deposit"]


async def test_area_without_term_counts_every_year(admin_client, db_session):
    await seed_area(db_session)
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}?campus_key=yihua")).json()
    assert body["totals"]["visit"] == 12  # V1–V11 加 114 學年的 X2；明華的 X1 不算


async def test_area_empty_campus(admin_client):
    body = (await admin_client.get(f"{AREA}?campus_key=chongde&{TERM}")).json()
    assert body["totals"]["visit"] == 0
    assert body["totals"]["unlocated_reasons"] == []
    assert body["districts"] == [] and body["villages"] == []
    assert [band["visit"] for band in body["distance_bands"]] == [0, 0, 0, 0, 0]


async def test_area_campus_not_located(admin_client, db_session, monkeypatch):
    """Review Focus 4、R6：校址比對不到時照常回 200，campus 帶原因；
    就算訪視存著舊距離，五個距離分組也只有 none 有數字，且等於範圍內的訪視數。"""

    async def unlocated(db, campus_key):
        return _point(campus_key, None, None, "no_doorplate")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await seed_area(db_session)  # V1、V2 存著 800 m、1200 m
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["campus"]["key"] == "yihua"
    assert body["campus"]["name"]
    assert (body["campus"]["lat"], body["campus"]["lng"], body["campus"]["locate_error"]) == (None, None, "no_doorplate")
    assert [(band["band"], band["visit"]) for band in body["distance_bands"]] == [
        ("0-1", 0), ("1-3", 0), ("3-6", 0), ("6+", 0), ("none", 11),
    ]
    assert body["distance_bands"][4]["deposit"] == 2


async def test_area_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    path = f"{AREA}?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_area_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for path in (f"{AREA}?campus_key=yihua", f"{AREA}/kindergartens?campus_key=yihua", f"{AREA}/boundaries"):
            response = await client.get(path)
            assert response.status_code == 404, (path, response.text)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
