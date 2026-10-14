"""里的變化 API（2026-10-14 里的變化規格 §5、§6）：這一年淨增與分級、近 12 個月出生與淨遷入、出生和前一年
同月份比、里界調整合併、算不出來的原因、所得中位數（C 段）、國小學區（D 段）、本校沒座標、半徑、權限與開關。

義華校址固定在門牌樣本的座標；公開資料直接寫資料庫。1 公里內（里界面積重心）有本揚里 287 m、寶業里 329 m、
寶國里 458 m、本上里 489 m 等 12 個里；本武里 1.5 公里。「三民區測試舊里」（64000059999）是假的已廢止代碼：
只出現在一年前的年齡與 115-07 之前的遷入遷出，和 115-07 行政區域調整過的本上里合併成一組。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

from app.admissions import trends
from app.admissions.geo import boundaries, matcher
from app.admissions.geo import school_districts as sd
from app.admissions.geo import village_series as series_io
from app.admissions.geo.models import (
    GeoDatasetStatus,
    GeoVillageAges,
    GeoVillageBirths,
    GeoVillageIncome,
    GeoVillageMigration,
    GeoVillagePopulation,
)
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_area_helpers import AREA, add_visit
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

TRENDS = f"{AREA}/trends"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
NOW = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)
CURRENT, YEAR_AGO = "115-09", "114-09"
OLD_CODE = "64000059999"
BENYANG = boundaries.village_code("三民區", "本揚里")
BAOYE = boundaries.village_code("三民區", "寶業里")
BAOGUO = boundaries.village_code("三民區", "寶國里")
BENSHANG = boundaries.village_code("三民區", "本上里")
BENWU = boundaries.village_code("三民區", "本武里")
BAOHUA = boundaries.village_code("三民區", "寶華里")
# 代碼 → (本月每一歲 2–5 歲的人數, 一年前每一歲 1–4 歲的人數)；None＝那個月份沒有這個代碼。
AGES = {
    BENYANG: (30, 25),  # 120 對 100：+20（+20%）增加多
    BAOYE: (25, 25),  # 100 對 100：0 差不多
    BAOGUO: (20, 25),  # 80 對 100：−20（−20%）減少多
    BENSHANG: (10, 5),  # 和舊里合併：40 對 20＋24
    OLD_CODE: (None, 6),
    BENWU: (4, 4),  # 一年前 1–4 歲 16 位：孩子少
}
NAMES = {OLD_CODE: ("三民區", "測試舊里")}


@pytest.fixture
def located_campus(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district="三民區")

    monkeypatch.setattr(matcher, "campus_point", located)


def _name(code: str) -> tuple[str, str]:
    return NAMES.get(code) or boundaries.village_names()[code]


def _ages_row(month: str, code: str, per_age: int, band: tuple[int, int]) -> GeoVillageAges:
    district, village = _name(code)
    values = {f"age_{age}": (per_age if band[0] <= age <= band[1] else 0) for age in range(7)}
    return GeoVillageAges(month=month, village_code=code, district=district, village=village, people_total=3000, **values)


async def _seed(
    db,
    *,
    year_ago: bool = True,
    migration_months: list[str] | None = None,
    births: bool = True,
    population: bool = True,
) -> None:
    if population:
        for code, (now, _) in AGES.items():
            if now is None:
                continue
            district, village = _name(code)
            db.add(
                GeoVillagePopulation(
                    village_code=code, district=district, village=village, age_0=0, age_1=0,
                    age_2=now, age_3=now, age_4=now, age_5=now, age_6=0, people_total=3000,
                )
            )
            db.add(_ages_row(CURRENT, code, now, (2, 5)))
        db.add(GeoDatasetStatus(dataset="population", active_version=CURRENT, label=CURRENT, synced_at=NOW))
    if year_ago:
        for code, (_, before) in AGES.items():
            db.add(_ages_row(YEAR_AGO, code, before, (1, 4)))
    months = series_io.window(CURRENT, 12) if migration_months is None else migration_months
    for month in months:
        for code in AGES:
            if code == OLD_CODE and month >= "115-07":
                continue
            district, village = _name(code)
            moves = (10, 4, 2, 1) if code == BENYANG else (0, 0, 0, 0)
            # 本上里 115-07 有 100 人行政區域調整（≥ 20 人且 ≥ 3,000 人的 1%）。
            boundary = 100 if code == BENSHANG and month == "115-07" else 0
            db.add(
                GeoVillageMigration(
                    month=month, village_code=code, district=district, village=village,
                    moved_in=moves[0], moved_out=moves[1], address_in=moves[2], address_out=moves[3],
                    boundary_in=boundary, boundary_out=0,
                )
            )
    if months:
        db.add(GeoDatasetStatus(dataset="migration", active_version=max(months), label=max(months), synced_at=NOW))
    if births:
        for month in series_io.window(CURRENT, 24):
            for code in AGES:
                if code == OLD_CODE:
                    continue
                district, village = _name(code)
                count = 0
                if code == BENYANG:
                    count = 2 if month > YEAR_AGO else 3
                db.add(GeoVillageBirths(month=month, village_code=code, district=district, village=village, births=count))
        db.add(GeoDatasetStatus(dataset="births", active_version=CURRENT, label=CURRENT, synced_at=NOW))
    await db.commit()


async def _seed_births(db, months: list[str], count_of) -> None:
    """出生表：本揚里每月 count_of(month) 位、其他里 0；月份裡沒列出的就是缺月。"""
    for month in months:
        for code in AGES:
            if code == OLD_CODE:
                continue
            district, village = _name(code)
            count = count_of(month) if code == BENYANG else 0
            db.add(GeoVillageBirths(month=month, village_code=code, district=district, village=village, births=count))
    db.add(GeoDatasetStatus(dataset="births", active_version=CURRENT, label=CURRENT, synced_at=NOW))
    await db.commit()


def _per_period(counts: list[int]):
    """第 k 期（從最新往回，每期 12 個月）每月 counts[k] 位。"""

    def count_of(month: str) -> int:
        index = (int(CURRENT[:3]) * 12 + int(CURRENT[4:]) - (int(month[:3]) * 12 + int(month[4:]))) // 12
        return counts[index]

    return count_of


async def _get(client, query: str = "radius_km=1") -> dict:
    response = await client.get(f"{TRENDS}?campus_key=yihua&{query}")
    assert response.status_code == 200, response.text
    return response.json()


def _by_key(body: dict) -> dict[str, dict]:
    return {row["key"]: row for row in body["villages"]}


def _school(name: str, *, partial: bool = False, free_zone: bool = False) -> dict:
    """一列對到的國小（測試用的校名都只有一所）。"""
    (school,) = [school for school in sd.schools().values() if school.name == name]
    return {"code": school.code, "name": name, "district": school.district, "partial": partial, "free_zone": free_zone}


def _school_row(body: dict, name: str) -> dict:
    (row,) = [row for row in body["schools"] if row["name"] == name]
    return row


def test_kids_level_thresholds():
    assert trends.kids_level(None, 100) == "unknown"
    assert trends.kids_level(5, 19) == "few"
    assert trends.kids_level(10, 100) == "up2"
    assert trends.kids_level(9, 100) == "up1"  # +9% 還不到 10%
    assert trends.kids_level(4, 40) == "up1"  # +10% 但不到 5 位
    assert trends.kids_level(3, 100) == "up1"
    assert trends.kids_level(2, 20) == "flat"  # +10% 但不到 3 位
    assert trends.kids_level(-3, 100) == "down1"
    assert trends.kids_level(-10, 100) == "down2"
    assert trends.kids_level(-4, 44) == "down1"
    assert trends.kids_level(0, 100) == "flat"


async def test_trends_one_km(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["radius_km"] == 1 and body["kids_unavailable"] is None
    assert body["sources"]["population"] == {"month": CURRENT, "year_ago_month": YEAR_AGO}
    assert body["sources"]["births"] == {"latest": CURRENT, "months": series_io.window(CURRENT, 12), "missing": []}
    assert body["sources"]["migration"]["months"] == series_io.window(CURRENT, 12)
    assert "內政部戶政司" in body["sources"]["note"]
    assert body["sources"]["income"] == {"year": None, "note": ""}
    rows = _by_key(body)
    assert rows[BENYANG] == {
        "key": BENYANG, "district": "三民區", "village": "本揚里", "codes": [BENYANG], "merged": False,
        "distance_m": 300, "children": 120, "kids_net": 20, "kids_base": 100, "kids_level": "up2",
        # 每月出生 2 位；每月遷入 10 − 遷出 4 ＋ 住址變更入 2 − 出 1＝7 人。
        "births_12m": 24, "migration_net_12m": 84, "income_median": None, "income_boundary_changed": False,
        "schools": [_school("東光國小")],
    }
    assert (rows[BAOYE]["kids_net"], rows[BAOYE]["kids_level"]) == (0, "flat")
    assert (rows[BAOGUO]["kids_net"], rows[BAOGUO]["kids_level"]) == (-20, "down2")
    # 沒有任何資料的近鄰里：數字是 null，不是 0。
    assert rows[BAOHUA] | {"distance_m": 0} == {
        "key": BAOHUA, "district": "三民區", "village": "寶華里", "codes": [BAOHUA], "merged": False, "distance_m": 0,
        "children": None, "kids_net": None, "kids_base": None, "kids_level": "unknown",
        "births_12m": None, "migration_net_12m": None, "income_median": None, "income_boundary_changed": False,
        "schools": [_school("光武國小")],
    }
    # 排序：淨增由大到小，算不出來的在最後。
    keys = [row["key"] for row in body["villages"]]
    assert keys[:4] == [BENYANG, BAOYE, f"group:三民區:{BENSHANG}", BAOGUO]
    assert all(row["kids_net"] is None for row in body["villages"][4:])


async def test_boundary_adjusted_villages_are_merged_with_the_old_codes(admin_client, db_session, located_campus):
    await _seed(db_session)
    group = _by_key(await _get(admin_client))[f"group:三民區:{BENSHANG}"]
    # 本上里 115-07 調整過、舊里 115-07 起不見了：同區合併成一列，數字整組相加（舊里只有一年前有孩子）。
    assert group == {
        "key": f"group:三民區:{BENSHANG}", "district": "三民區", "village": "本上里", "codes": [BENSHANG, OLD_CODE],
        "merged": True, "distance_m": 500, "children": 40, "kids_net": 40 - 44, "kids_base": 44, "kids_level": "down1",
        "births_12m": 0, "migration_net_12m": 0, "income_median": None, "income_boundary_changed": False,
        "schools": [_school("東光國小")],
    }


async def test_small_routine_adjustments_do_not_merge(admin_client, db_session, located_campus):
    """每月常有幾個人的鄰界調整：不到門檻（20 人且 1%）不合併。"""
    await _seed(db_session)
    small = (await db_session.execute(
        select(GeoVillageMigration).where(GeoVillageMigration.village_code == BAOYE, GeoVillageMigration.month == "115-05")
    )).scalar_one()
    small.boundary_out = 19
    await db_session.commit()
    rows = _by_key(await _get(admin_client))
    assert rows[BAOYE]["merged"] is False


async def test_baseline_sums_rows_and_compares_births_with_the_same_months(admin_client, db_session, located_campus):
    await _seed(db_session)
    baseline = (await _get(admin_client))["baseline"]
    assert baseline == {
        "villages": 12,
        "children": 120 + 100 + 80 + 40,
        "kids_net": 20 + 0 - 20 - 4,
        "kids_base": 100 + 100 + 100 + 44,
        # 本揚里近 12 個月每月 2 位、前一年每月 3 位：少 33.3%。
        "births_12m": 24, "births_months": 12, "births_compared_months": 12, "births_change_pct": -33.3,
        "births_series": [
            {"starts": "114-10", "ends": "115-09", "months": 12, "missing": [], "births": 24, "change_pct": -33.3},
            {"starts": "113-10", "ends": "114-09", "months": 12, "missing": [], "births": 36, "change_pct": None},
        ],
        "migration_net_12m": 84, "migration_months": 12,
    }


async def test_birth_gaps_are_listed_and_too_few_compared_months_are_not_compared(admin_client, db_session, located_campus):
    await _seed(db_session)
    # 前一年只留 5 個月：比較的月份不到 6 個，不比；本期缺 115-02 也照列。
    keep_previous = {"114-05", "114-06", "114-07", "114-08", "114-09"}
    for row in (await db_session.execute(select(GeoVillageBirths))).scalars():
        if (row.month <= YEAR_AGO and row.month not in keep_previous) or row.month == "115-02":
            await db_session.delete(row)
    await db_session.commit()
    body = await _get(admin_client)
    assert body["sources"]["births"]["missing"] == ["115-02"]
    assert (body["baseline"]["births_months"], body["baseline"]["births_compared_months"]) == (11, 5)
    assert body["baseline"]["births_change_pct"] is None
    assert body["baseline"]["births_12m"] == 22


async def test_births_series_lists_the_periods_newest_first(admin_client, db_session, located_campus):
    """每月出生（每期）：2、2、3、3、4、4；111-03 來源查無，那一期 11 個月、增減只比兩期都有的月份。"""
    await _seed(db_session, births=False)
    months = [month for month in series_io.window(CURRENT, 72) if month != "111-03"]
    await _seed_births(db_session, months, _per_period([2, 2, 3, 3, 4, 4]))
    baseline = (await _get(admin_client))["baseline"]
    assert baseline["births_series"] == [
        {"starts": "114-10", "ends": "115-09", "months": 12, "missing": [], "births": 24, "change_pct": 0.0},
        {"starts": "113-10", "ends": "114-09", "months": 12, "missing": [], "births": 24, "change_pct": -33.3},
        {"starts": "112-10", "ends": "113-09", "months": 12, "missing": [], "births": 36, "change_pct": 0.0},
        # 112-03 的前一年同月份是缺月 111-03，只比 11 個月：33 對 44，是 −25.0，不是 36 對 44 的 −18.2。
        {"starts": "111-10", "ends": "112-09", "months": 12, "missing": [], "births": 36, "change_pct": -25.0},
        {"starts": "110-10", "ends": "111-09", "months": 11, "missing": ["111-03"], "births": 44, "change_pct": 0.0},
        # 最舊一期沒有前一期（表裡沒有 108-10 以前）。
        {"starts": "109-10", "ends": "110-09", "months": 12, "missing": [], "births": 48, "change_pct": None},
    ]
    assert (baseline["births_12m"], baseline["births_compared_months"], baseline["births_change_pct"]) == (24, 12, 0.0)


async def test_a_period_with_fewer_than_ten_months_is_not_listed(admin_client, db_session, located_campus):
    """回補到一半：只有 20 個月。第一期湊滿 12 個月；第二期只有 8 個月（< 10）不列；增減只比有前一年同月份的 8 個月。"""
    await _seed(db_session, births=False)
    await _seed_births(db_session, series_io.window(CURRENT, 20), lambda month: 2 if month > YEAR_AGO else 3)
    series = (await _get(admin_client))["baseline"]["births_series"]
    assert series == [
        {"starts": "114-10", "ends": "115-09", "months": 12, "missing": [], "births": 24, "change_pct": -33.3}
    ]


async def test_a_change_needs_twenty_births_in_the_previous_period(admin_client, db_session, located_campus):
    """前一年同月份合計只有 12 位（< 20）：不給百分比（含 baseline），月份數照實寫。"""
    await _seed(db_session, births=False)
    await _seed_births(db_session, series_io.window(CURRENT, 24), lambda month: 2 if month > YEAR_AGO else 1)
    baseline = (await _get(admin_client))["baseline"]
    assert (baseline["births_compared_months"], baseline["births_change_pct"]) == (12, None)
    assert baseline["births_series"][0]["change_pct"] is None


async def test_without_births_the_series_is_empty(admin_client, db_session, located_campus):
    await _seed(db_session, births=False)
    baseline = (await _get(admin_client))["baseline"]
    assert baseline["births_series"] == [] and baseline["births_12m"] is None


async def _seed_income(db) -> None:
    """112 年度所得：本揚里、寶國里、寶業里、本上里（合併組）。寶國里 114-06（所得年度之後、近 12 個月之前）有
    100 人行政區域調整；寶業里 112-06（所得年度之內）調整過。"""
    for code, median in ((BENYANG, 500), (BAOGUO, 400), (BAOYE, 450), (BENSHANG, 600)):
        district, village = _name(code)
        db.add(
            GeoVillageIncome(
                village_code=code, district=district, village=village, year=112,
                taxpayers=1000, median=median, q1=median // 2, q3=median * 2, mean=median + 100,
            )
        )
    for code, month in ((BAOGUO, "114-06"), (BAOYE, "112-06")):
        district, village = _name(code)
        db.add(
            GeoVillageMigration(
                month=month, village_code=code, district=district, village=village,
                moved_in=0, moved_out=0, address_in=0, address_out=0, boundary_in=100, boundary_out=0,
            )
        )
    db.add(GeoDatasetStatus(dataset="income", active_version="112", label="112", synced_at=NOW))
    await db.commit()


async def test_income_is_background_only(admin_client, db_session, located_campus):
    await _seed(db_session)
    await _seed_income(db_session)
    body = await _get(admin_client)
    assert body["sources"]["income"]["year"] == 112
    note = body["sources"]["income"]["note"]
    assert note.startswith("資料來源：財政部財政資訊中心（2026）") and "（112年度）" in note and "不宜逕作為衡量所得差距之參據" in note
    rows = _by_key(body)
    assert (rows[BENYANG]["income_median"], rows[BENYANG]["income_boundary_changed"]) == (500, False)
    # 寶國里在所得年度之後調整過界線：照列，另標記；不因此合併（調整在近 12 個月之前）。
    assert (rows[BAOGUO]["income_median"], rows[BAOGUO]["income_boundary_changed"], rows[BAOGUO]["merged"]) == (400, True, False)
    # 所得年度之內的調整不算。
    assert (rows[BAOYE]["income_median"], rows[BAOYE]["income_boundary_changed"]) == (450, False)
    # 合併組不列（中位數不能相加）；沒有所得的里是 null。
    group = rows[f"group:三民區:{BENSHANG}"]
    assert (group["income_median"], group["income_boundary_changed"]) == (None, False)
    assert rows[BAOHUA]["income_median"] is None
    # 不排序：順序和沒有所得時一樣（淨增由大到小）。
    assert [row["key"] for row in body["villages"]][:4] == [BENYANG, BAOYE, f"group:三民區:{BENSHANG}", BAOGUO]
    assert "income" not in str(body["baseline"])


async def test_each_row_lists_its_elementary_schools(admin_client, db_session, located_campus):
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["sources"]["school_districts"]["school_year"] == 115
    assert "115 學年度國民小學學區劃分一覽表" in body["sources"]["school_districts"]["note"]
    rows = _by_key(body)
    # 寶業里拆鄰分給光武、陽明：兩所都是部分。
    assert rows[BAOYE]["schools"] == [_school("光武國小", partial=True), _school("陽明國小", partial=True)]


async def test_schools_sum_their_whole_district(admin_client, db_session, located_campus):
    """依國小學區：學區碰到半徑內的國小，每所合計整個學區（含半徑外的里）；部分里同時算進每一所。"""
    await _seed(db_session)
    for village, count in (("本揚里", 3), ("本元里", 1), ("本武里", 2)):
        for _ in range(count):
            await add_visit(db_session, district="三民區", geo={"level": "exact", "village": village, "distance_m": 500})
    # 不在母體：明華的參觀、只到區的參觀。
    await add_visit(db_session, campus_key="minghua", district="三民區", geo={"level": "exact", "village": "本揚里"})
    await add_visit(db_session, district="三民區", geo={"level": "district"})
    await db_session.commit()
    body = await _get(admin_client)
    names = [row["name"] for row in body["schools"]]
    assert {"東光國小", "光武國小", "陽明國小"} <= set(names)
    # 東光國小：本上、本安、本揚整里，本元部分；有人口的是本揚 120、本上 40。淨增只加算得出的本揚（本上里界調整過）。
    dongguang = _school_row(body, "東光國小")
    assert dongguang | {"code": "", "district": ""} == {
        "code": "", "name": "東光國小", "district": "", "enrollment": "district",
        "villages_full": 3, "villages_partial": 1, "children": 160, "kids_net": 20, "kids_partial": True,
        "visit": 4, "rate": 2.5,
    }
    # 陽明國小：本武整里（本校 1.5 公里，不在 1 公里內也算進學區）、寶國與寶業部分。
    yangming = _school_row(body, "陽明國小")
    assert (yangming["children"], yangming["kids_net"], yangming["visit"]) == (16 + 80 + 100, 0 - 20 + 0, 3)
    # 依參觀人數由大到小。
    visits = [row["visit"] for row in body["schools"]]
    assert visits == sorted(visits, reverse=True) and names[0] == "東光國小"


async def test_schools_without_the_year_ago_ages(admin_client, db_session, located_campus):
    await _seed(db_session, year_ago=False)
    row = _school_row(await _get(admin_client), "東光國小")
    assert (row["children"], row["kids_net"], row["kids_partial"], row["visit"], row["rate"]) == (160, None, False, 0, 0.0)


async def test_without_the_year_ago_ages_kids_are_not_counted(admin_client, db_session, located_campus):
    await _seed(db_session, year_ago=False)
    body = await _get(admin_client)
    assert body["kids_unavailable"] == "no_year_ago"
    assert body["sources"]["population"]["year_ago_month"] is None
    rows = _by_key(body)
    assert (rows[BENYANG]["kids_net"], rows[BENYANG]["kids_level"], rows[BENYANG]["children"]) == (None, "unknown", 120)
    assert rows[BENYANG]["births_12m"] == 24
    assert body["baseline"]["kids_net"] is None


async def test_without_enough_migration_months_kids_are_not_counted(admin_client, db_session, located_campus):
    await _seed(db_session, migration_months=series_io.window(CURRENT, 9))
    body = await _get(admin_client)
    assert body["kids_unavailable"] == "no_migration"
    assert body["baseline"]["migration_months"] == 9


async def test_without_population(admin_client, db_session, located_campus):
    await _seed(db_session, population=False, year_ago=False)
    body = await _get(admin_client)
    assert body["kids_unavailable"] == "no_population"
    assert body["sources"]["population"] == {"month": None, "year_ago_month": None}
    assert body["baseline"]["children"] is None
    assert _by_key(body)[BENYANG]["births_12m"] == 24


async def test_nothing_imported(admin_client, located_campus):
    body = await _get(admin_client)
    assert body["kids_unavailable"] == "no_population"
    assert body["sources"]["births"] == {"latest": None, "months": [], "missing": []}
    # 學區對照檔隨程式提交：沒有人口也列學校，孩子數是 null、參觀率是 null。
    row = _school_row(body, "東光國小")
    assert (row["children"], row["kids_net"], row["visit"], row["rate"]) == (None, None, 0, None)
    assert body["baseline"]["births_12m"] is None and body["baseline"]["migration_net_12m"] is None
    assert all(row["births_12m"] is None for row in body["villages"])


async def test_three_km_includes_farther_villages(admin_client, db_session, located_campus):
    await _seed(db_session)
    rows = _by_key(await _get(admin_client, "radius_km=3"))
    assert rows[BENWU]["distance_m"] == 1500
    assert (rows[BENWU]["kids_net"], rows[BENWU]["kids_level"]) == (0, "few")
    assert BENWU not in _by_key(await _get(admin_client, "radius_km=1"))


async def test_when_campus_not_located(admin_client, db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="no_doorplate", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _seed(db_session)
    body = await _get(admin_client)
    assert body["campus"]["locate_error"] == "no_doorplate"
    assert body["baseline"] is None and body["villages"] == [] and body["schools"] == []
    assert body["sources"]["population"]["month"] == CURRENT


@pytest.mark.parametrize("radius", ["2", "0", "abc", "", "3.5"])
async def test_rejects_bad_radius(admin_client, radius):
    response = await admin_client.get(f"{TRENDS}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    path = f"{TRENDS}?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_needs_login(public_client):
    assert (await public_client.get(f"{TRENDS}?campus_key=yihua")).status_code == 401


async def test_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{TRENDS}?campus_key=yihua")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_never_writes_audit_entries(admin_client, db_session, located_campus):
    await _seed(db_session)
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    await _get(admin_client)
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before
