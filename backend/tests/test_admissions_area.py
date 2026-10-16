"""招生區域分析 API（2026-10-08 區域分析規格 §8）：層級與口徑、與 /stats 一致、權限、
開關、校區未定位、幼兒園、里界。"""

from __future__ import annotations

import json
from dataclasses import asdict

import pytest
from sqlalchemy import event, func, select

from app.admissions import area
from app.admissions.geo import boundaries
from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo import matcher
from app.admissions.geo.kindergartens import NearbyKindergarten
from app.campuses.models import CAMPUS_KEYS
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_area_helpers import AREA, API, add_visit, seed_area
from tests.admissions_helpers import ADMISSIONS, create_record, readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.geo_helpers import SAMPLE_ADDRESSES, load_geo_samples, publish_campus_address

TERM = "school_year=115&semester=1"
# 義華校址在門牌樣本裡的座標（tests/geo_helpers.YIHUA_POINT）。
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133


def _point(campus_key: str, lat: float | None, lng: float | None, error: str | None = None) -> matcher.CampusPoint:
    return matcher.CampusPoint(campus_key=campus_key, lat=lat, lng=lng, locate_error=error, district="三民區")


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
                              "locate_error": None, "district": "三民區"}
    assert body["districts"] == [
        {"district": "三民區", "visit": 5, "deposit": 2, "visit_to_deposit_rate": 40.0,
         "visit_to_deposit_range": {"low": 14.7, "high": 44.1}},
        {"district": "左營區", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 7.2, "high": 37.3}},
    ]
    villages = [(row["district"], row["village"], row["visit"], row["deposit"], row["visit_to_deposit_rate"])
                for row in body["villages"]]
    assert villages == [("三民區", "鼎金里", 2, 1, 50.0), ("三民區", "寶業里", 1, 1, 100.0)]
    assert [row["visit_to_deposit_range"] for row in body["villages"]] == [
        {"low": 12.4, "high": 44.5}, {"low": 13.7, "high": 48.2},
    ]
    assert body["villages"][0]["village_code"] == "64000050001"
    assert body["distance_bands"] == [
        {"band": "0-1", "visit": 1, "deposit": 1, "visit_to_deposit_rate": 100.0,
         "visit_to_deposit_range": {"low": 13.7, "high": 48.2}},
        {"band": "1-3", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 7.2, "high": 37.3}},
        {"band": "3-6", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None, "visit_to_deposit_range": None},
        {"band": "6+", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None, "visit_to_deposit_range": None},
        {"band": "none", "visit": 9, "deposit": 1, "visit_to_deposit_rate": 11.1,
         "visit_to_deposit_range": {"low": 7.4, "high": 29.0}},
    ]
    assert body["data_status"]["boundary_version"]
    assert body["data_status"]["doorplate_version"] is None  # 這個測試沒匯入門牌樣本


async def test_area_totals_invariants_on_data_made_by_the_real_pipeline(admin_client, db_session):
    """R5 的不變式，用真的建立流程（API 建訪視、比對器比對）產生的資料驗，而不是照著答案寫進資料庫的種子：
    有地址的四個層級加起來＝有地址；有地址＋沒地址＋已匿名化＝全部；而且明細列表（另一條程式路徑）
    數出來的筆數對得上。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    for key in ("yihua_exact", "yihua_nearby", "district_only", "outside", "ambiguous"):
        await create_record(admin_client, address=SAMPLE_ADDRESSES[key])
    await create_record(admin_client)  # 沒填地址
    totals = (await admin_client.get(f"{AREA}?campus_key=yihua")).json()["totals"]
    assert totals["visit"] == 6
    assert (totals["village_level"], totals["district_level"], totals["unlocated"], totals["pending"]) == (2, 2, 1, 0)
    assert (totals["no_address"], totals["anonymized"]) == (1, 0)
    assert totals["village_level"] + totals["district_level"] + totals["unlocated"] + totals["pending"] == totals["with_address"]
    assert totals["with_address"] + totals["no_address"] + totals["anonymized"] == totals["visit"]
    listed = (await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&page_size=100")).json()
    assert len(listed) == totals["visit"]
    no_village = (await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&geo=no_village&page_size=100")).json()
    assert len(no_village) == totals["with_address"] - totals["village_level"]


async def test_area_totals_invariants_with_odd_rows(admin_client, db_session):
    """邊角資料也要守住不變式：只有空白的地址算沒地址（同訪視明細 geo=no_village 的判斷）；
    有地址、但資料庫裡存的比對結果是 no_address 的（這裡直接寫入；真的比對「-」會得到 no_doorplate，
    不會是 no_address）仍算有地址、未定位，且不進原因清單——層級看地址欄，不看原因欄。"""
    await seed_area(db_session)
    await add_visit(db_session, address="   ", geo={"level": "unlocated", "reason": "no_address"})
    await add_visit(db_session, address="-", geo={"level": "unlocated", "reason": "no_address"})
    await add_visit(db_session, address="高雄市三民區測試路2號", geo={"level": "unlocated", "reason": "no_doorplate"})
    await db_session.commit()
    totals = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["totals"]
    assert totals["visit"] == 14
    assert totals["no_address"] == 2  # V6 與只有空白的地址
    assert totals["with_address"] == 10
    assert totals["unlocated"] == 3  # V7、地址是 "-" 的（存的原因是 no_address）、查無門牌的
    assert totals["village_level"] + totals["district_level"] + totals["unlocated"] + totals["pending"] == totals["with_address"]
    assert totals["with_address"] + totals["no_address"] + totals["anonymized"] == totals["visit"]
    assert {item["reason"]: item["count"] for item in totals["unlocated_reasons"]} == {
        "outside_kaohsiung": 1, "no_doorplate": 1, "ambiguous_village": 1,
    }


async def test_area_visit_without_address_and_without_geo_row_is_no_address(admin_client, db_session):
    """地址是 NULL、也沒有比對結果列（上線前建立的、沒填地址的舊訪視）：算沒填地址，不算待比對。"""
    await add_visit(db_session, address=None)
    await add_visit(db_session)  # 有地址、沒有比對結果列：待比對
    await db_session.commit()
    totals = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()["totals"]
    assert (totals["visit"], totals["no_address"], totals["pending"], totals["with_address"]) == (2, 1, 1, 1)


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


async def test_area_reads_the_dataset_status_rows_once(db_session):
    """門牌月份直接取自已讀到的狀態列，不再為它多查一次 geo_dataset_status。"""
    await load_geo_samples(db_session)
    statements: list[str] = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        statements.append(" ".join(statement.split()).lower())

    engine = db_session.bind.sync_engine
    event.listen(engine, "before_cursor_execute", _record)
    try:
        result = await area.query_area(db_session, "yihua", school_year=115, semester=1)
    finally:
        event.remove(engine, "before_cursor_execute", _record)
    assert result["data_status"]["doorplate_version"] == "115-10"
    # 狀態列的讀取：data_status 一次；本校座標（campus_point）另外讀一次門牌版本，總共兩次。
    status_reads = [sql for sql in statements if "from geo_dataset_status" in sql]
    assert len(status_reads) == 2, status_reads


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


async def test_area_campus_district_before_doorplates(admin_client, db_session):
    """門牌還沒匯入（正式站開同步前）：本校沒有座標，但帶校址的行政區，地圖才能先框住那一區。"""
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["campus"]["key"] == "yihua"
    assert (body["campus"]["lat"], body["campus"]["lng"]) == (None, None)
    assert (body["campus"]["locate_error"], body["campus"]["district"]) == ("pending", "三民區")
    kindergartens = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua")).json()
    assert kindergartens["campus"]["district"] == "三民區"


async def test_area_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    """2026-10-16 起限總管理者（admissions.stats）：分校、接待、editor、readonly 一律 403，不論本校或他校。"""
    path = f"{AREA}?campus_key="
    for client in (reception_yihua_client, minghua_client, editor_client, readonly_yihua_client):
        assert (await client.get(path + "yihua")).status_code == 403
        assert (await client.get(path + "minghua")).status_code == 403
    assert (await admin_client.get(path + "yihua")).status_code == 200
    assert (await admin_client.get(path + "minghua")).status_code == 200
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


def _kindergarten(source_id: str, distance_m: int, lat: float, lng: float) -> NearbyKindergarten:
    return NearbyKindergarten(
        source_id=source_id,
        name=f"高雄市私立{source_id}幼兒園",
        kind="private",
        pre_public_period=None,
        address="高雄市三民區測試路1號",
        lat=lat,
        lng=lng,
        distance_m=distance_m,
        approved_capacity=60,
        monthly_fee_estimate=5000,
        has_penalty=False,
        phone=None,
    )


async def test_kindergartens_mark_own_and_pass_radius(admin_client, monkeypatch):
    calls: list[tuple[float, float, int]] = []

    async def all_points(db):
        return {"yihua": _point("yihua", 22.65, 120.32), "minghua": _point("minghua", 22.68, 120.30),
                "renwu": _point("renwu", None, None, "no_doorplate")}

    async def fake_nearby(db, lat, lng, radius_m):
        calls.append((lat, lng, radius_m))
        # 與真的 nearby 一樣已依距離排好；API 不再重排。
        return [
            _kindergarten("own", 0, 22.65001, 120.32001),
            _kindergarten("near", 900, 22.658, 120.32),
            _kindergarten("far", 2500, 22.672, 120.32),
            # 明華校址旁 30 公尺左右：也是本機構。
            _kindergarten("sister", 3300, 22.68025, 120.30),
        ]

    monkeypatch.setattr(matcher, "campus_points", all_points)
    monkeypatch.setattr(geo_kindergartens, "nearby", fake_nearby)
    response = await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua&radius_km=6")
    assert response.status_code == 200, response.text
    body = response.json()
    assert calls == [(22.65, 120.32, 6000)]
    assert body["radius_km"] == 6
    assert body["source_note"] == "資料來源：全國教保資訊網（kiang 整理）"
    assert [(item["source_id"], item["is_own"]) for item in body["items"]] == [
        ("own", True), ("near", False), ("far", False), ("sister", True),
    ]
    # 公開資料的欄位原樣透傳（不只 source_id）：NearbyKindergarten 有的欄位整筆比對，
    # 回應只多 is_own 與 2026-10-15 的四個同業比較欄位（解析端還沒給時是 null，給了就一併透傳）。
    expected = [asdict(item) for item in await fake_nearby(None, 0, 0, 0)]
    assert [{key: item[key] for key in want} for item, want in zip(body["items"], expected, strict=True)] == expected
    peer_keys = {"indoor_m2_per_child", "outdoor_m2_per_child", "has_shuttle", "after_school_capacity"}
    assert set(body["items"][0]) == set(expected[0]) | {"is_own"} | peer_keys


async def test_kindergartens_default_radius_is_three(admin_client, monkeypatch):
    calls: list[int] = []

    async def all_points(db):
        return {"yihua": _point("yihua", 22.65, 120.32)}

    async def fake_nearby(db, lat, lng, radius_m):
        calls.append(radius_m)
        return []

    monkeypatch.setattr(matcher, "campus_points", all_points)
    monkeypatch.setattr(geo_kindergartens, "nearby", fake_nearby)
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua")).json()
    assert calls == [3000]
    assert body["radius_km"] == 3


@pytest.mark.parametrize("radius", ["2", "0", "-1", "7", "abc", "", "3.5", "1,3", "%E4%B8%89"])
async def test_kindergartens_reject_any_radius_but_1_3_6_with_the_same_error_code(admin_client, radius):
    """不在 1、3、6 之內的、以及根本不是整數的（abc、3.5、空字串）都回同一個 INVALID_RADIUS，
    不是 FastAPI 預設的驗證錯誤結構（陣列）。"""
    response = await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_kindergartens_bad_radius_does_not_skip_the_login_check(public_client, reception_yihua_client):
    """半徑檢查不能搶在登入之前：沒登入的人帶著錯的半徑仍然是 401，不是 422。"""
    path = f"{AREA}/kindergartens?campus_key=yihua&radius_km=abc"
    assert (await public_client.get(path)).status_code == 401
    assert (await reception_yihua_client.get(path)).status_code == 422


async def test_kindergartens_when_campus_not_located(admin_client, monkeypatch):
    """Review Focus 4：校址比對不到時回空清單與原因，不查園所、不 500。"""
    async def unlocated(db):
        return {key: _point(key, None, None, "no_doorplate") for key in CAMPUS_KEYS}

    async def must_not_query(db, lat, lng, radius_m):
        raise AssertionError("校區沒有座標時不應查園所")

    monkeypatch.setattr(matcher, "campus_points", unlocated)
    monkeypatch.setattr(geo_kindergartens, "nearby", must_not_query)
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua")).json()
    assert body["items"] == []
    assert body["campus"]["locate_error"] == "no_doorplate"


async def test_kindergartens_from_samples_are_sorted(admin_client, db_session):
    """接上 A 的樣本：校址發布後才有座標，清單非空、照距離排序、帶同步時間。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua&radius_km=6")).json()
    assert body["synced_at"] is not None
    assert body["items"], body
    distances = [item["distance_m"] for item in body["items"]]
    assert distances == sorted(distances)


async def test_kindergartens_permissions(
    reception_yihua_client, readonly_yihua_client, editor_client, minghua_client, admin_client
):
    """2026-10-16 起限總管理者（admissions.stats）：其他角色不論本校或他校一律 403。"""
    path = f"{AREA}/kindergartens?campus_key="
    for client in (reception_yihua_client, editor_client, readonly_yihua_client, minghua_client):
        assert (await client.get(path + "yihua")).status_code == 403
        assert (await client.get(path + "minghua")).status_code == 403
    assert (await admin_client.get(path + "yihua")).status_code == 200
    assert (await admin_client.get(path + "minghua")).status_code == 200
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_kindergartens_reads_the_campus_point_once(db_session, monkeypatch):
    """本校座標算一次：以前先算本校、又為了「哪些是本機構」把五校全算一遍（本校算了兩次）。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])
    calls: list[str] = []
    real = matcher._campus_point_at

    async def counting(db, campus_key, version):
        calls.append(campus_key)
        return await real(db, campus_key, version)

    monkeypatch.setattr(matcher, "_campus_point_at", counting)
    result = await area.query_kindergartens(db_session, "yihua", radius_km=3)
    assert sorted(calls) == sorted(CAMPUS_KEYS)  # 每一校剛好一次
    assert result["campus"]["lat"] is not None


async def test_area_reads_the_campus_point_once(db_session, monkeypatch):
    calls: list[str] = []
    real = matcher._campus_point_at

    async def counting(db, campus_key, version):
        calls.append(campus_key)
        return await real(db, campus_key, version)

    monkeypatch.setattr(matcher, "_campus_point_at", counting)
    await area.query_area(db_session, "yihua", school_year=115, semester=1)
    assert calls == ["yihua"]


async def test_area_endpoints_never_write_audit_entries(admin_client, db_session):
    """區域分析三個端點都只讀：不寫稽核（規格 §8）。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", SAMPLE_ADDRESSES["yihua_exact"])

    async def audit_count() -> int:
        return await db_session.scalar(select(func.count()).select_from(AuditLogEntry))

    before = await audit_count()
    for path in (
        f"{AREA}?campus_key=yihua&{TERM}",
        f"{AREA}/kindergartens?campus_key=yihua&radius_km=6",
        f"{AREA}/boundaries",
    ):
        assert (await admin_client.get(path)).status_code == 200, path
    assert await audit_count() == before


async def test_boundaries_etag_and_cache(admin_client):
    first = await admin_client.get(f"{AREA}/boundaries")
    assert first.status_code == 200, first.text
    assert first.headers["content-type"].startswith("application/geo+json")
    assert first.headers["cache-control"] == "private, max-age=86400"
    etag = first.headers["etag"]
    assert etag == boundaries.boundary_etag()
    data = first.json()
    assert data["type"] == "FeatureCollection"
    # 筆數讀實際的檔案，不寫死（界圖換版時不用改測試）。
    assert len(data["features"]) == len(json.loads(boundaries.boundary_bytes())["features"]) > 0
    again = await admin_client.get(f"{AREA}/boundaries", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag
    assert again.headers["cache-control"] == "private, max-age=86400"  # 304 也要帶，瀏覽器才知道續用多久


@pytest.mark.parametrize(
    ("header", "not_modified"),
    [
        ("{etag}", True),
        ("W/{etag}", True),  # 弱比對值（代理或瀏覽器可能這樣帶回來）
        ('"villages-old", {etag}', True),  # 多個值，其中一個符合
        ('"villages-old",W/{etag}', True),
        ("*", True),
        ('"villages-115-08-17-000000000000"', False),  # 版本相同、內容指紋不同
        ('"villages-old"', False),
        ("{etag}x", False),
        ("", False),
        ("W/", False),
    ],
)
async def test_boundaries_if_none_match_forms(admin_client, header, not_modified):
    etag = (await admin_client.get(f"{AREA}/boundaries")).headers["etag"]
    response = await admin_client.get(f"{AREA}/boundaries", headers={"If-None-Match": header.format(etag=etag)})
    assert response.status_code == (304 if not_modified else 200)
    assert response.headers["etag"] == etag


async def test_boundaries_permissions(reception_yihua_client, editor_client, readonly_yihua_client, admin_client):
    """2026-10-16 起限總管理者（admissions.stats）。"""
    path = f"{AREA}/boundaries"
    assert (await admin_client.get(path)).status_code == 200
    assert (await reception_yihua_client.get(path)).status_code == 403
    assert (await editor_client.get(path)).status_code == 403
    assert (await readonly_yihua_client.get(path)).status_code == 403
