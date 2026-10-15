"""招生機會（docs/specs/2026-10-13-admissions-opportunity-design.md §5）：/admin/admissions/area/opportunity。

只讀：不 flush、不 commit、不寫稽核。回應只有里層級的聚合數字與公開人口資料，不含家長個資。
母體沿用 stats.py 的 _base_filters（校區＋入學學年學期），參觀人數＝筆數。

做法（規格 1.2 的實作裁定 O1–O7）：
- 「附近」＝里界面積重心在本校半徑內的里（boundaries.village_centroids）。
- 孩子＝2–5 歲（幼兒園年紀）；另列 0–1 歲（兩年內到幼兒園年紀）。
- 附近平均＝附近各里參觀合計 ÷ 2–5 歲孩子合計；每個里「照附近應有」＝孩子數 × 附近平均。
- 判讀用 Poisson 單尾機率 ≤ 0.10（和兩個招生警示同一個門檻）：完全正常的里約一成會被標。
  這是拿實際參觀和公開人口做描述性比較，不預測、不對任何一戶打分（規格 1.3）。

只算比對到里、未匿名化的訪視；只到區、未定位、待比對、沒填地址、已匿名化的合計成
unplaced_visit（其中沒填地址的另回 no_address_visit，畫面分開寫），到了里但在半徑外的合計成
outside_visit，兩者都不進附近平均。
在半徑內、但人口表沒有那個里（人口批次只要 850 個里就能換版）的里列在 no_population_villages：
沒有孩子數可除，參觀同樣不進附近平均，也不算半徑外。"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import estimation, records
from app.admissions.area import campus_out
from app.admissions.geo import boundaries
from app.admissions.geo import population as population_io
from app.admissions.geo.models import VILLAGE_LEVELS, GeoDatasetStatus, GeoVillagePopulation, RecruitmentVisitGeo
from app.admissions.geo.projection import haversine_m
from app.admissions.models import RecruitmentVisit
from app.admissions.stats import _base_filters, pct

# 2–5 歲：幼幼班到大班的年紀（統計月底足歲；6 歲多半已上小一）。0–1 歲：兩年內會到幼兒園年紀。
AGE_BAND = (2, 5)
INFANT_BAND = (0, 1)
AGE_BAND_KEY = "2-5"
# 半徑內參觀合計不到這個數字，整張表不判斷（同預繳速度「比較組少於 10 筆不判斷」）。
MIN_BASELINE_VISITS = 10
# 照附近應有不到 1 位的里：0 位也不算少，寫「孩子少，看不出來」。
MIN_EXPECTED = 1.0
# 單尾機率門檻，和「本月預繳比過去慢」「來源結構失衡」相同。
SIGNAL_P = 0.10
DISTANCE_ROUND_M = 100


def _sum_ages(row: GeoVillagePopulation, band: tuple[int, int]) -> int:
    return sum(getattr(row, f"age_{age}") for age in range(band[0], band[1] + 1))


def judge(visit: int, expected: float | None, *, judged: bool) -> str:
    """一個里的判讀（規格 O5、O6）。expected 是照附近應有的參觀人數；沒有附近平均時是 None。"""
    if not judged or expected is None:
        return "not_judged"
    if expected < MIN_EXPECTED:
        return "few_children"
    if visit <= expected and estimation.poisson_cdf(visit, expected) <= SIGNAL_P:
        return "below"
    if visit >= expected and estimation.poisson_sf(visit, expected) <= SIGNAL_P:
        return "above"
    return "typical"


def _round_distance(meters: float) -> int:
    return int(round(meters / DISTANCE_ROUND_M) * DISTANCE_ROUND_M)


async def population_status(db: AsyncSession) -> dict[str, Any]:
    """各里人口的版本（狀態列與這支 API 共用）：月份「115-09」，還沒匯入是 null。"""
    status = await db.get(GeoDatasetStatus, "population")
    imported = status is not None and status.active_version is not None
    return {
        "version": status.label if imported else None,
        "synced_at": status.synced_at if imported else None,
    }


async def visits_by_village(
    db: AsyncSession, campus_key: str, school_year: int | None, semester: int | None
) -> tuple[dict[str, int], int, int]:
    """(里代碼 → 參觀人數, 沒對到里的參觀人數, 其中沒填地址的)。到里的訪視以 (區, 里) 轉代碼；里界檔裡沒有
    那個 (區, 里)（理論上不會發生，門牌與里界的里名已對齊）也算沒對到里。沒填地址的判斷同區域分析的
    totals.no_address（未匿名化、records.has_address 為假；已匿名化的地址也清掉了，但不算在這裡）。"""
    v, g = RecruitmentVisit, RecruitmentVisitGeo
    active = v.anonymized_at.is_(None)
    addressed = records.has_address()
    stmt = (
        select(
            v.district, g.village, g.match_level, active.label("active"), addressed.label("has_address"),
            func.count(v.id).label("visit"),
        )
        .select_from(v)
        .outerjoin(g, g.visit_id == v.id)
        .where(*_base_filters(campus_key, school_year, semester))
        .group_by(v.district, g.village, g.match_level, active, addressed)
    )
    by_code: dict[str, int] = {}
    unplaced = no_address = 0
    for row in (await db.execute(stmt)).all():
        count = int(row.visit or 0)
        code = (
            boundaries.village_code(row.district, row.village)
            if row.active and row.match_level in VILLAGE_LEVELS and row.district and row.village
            else None
        )
        if code is None:
            unplaced += count
            if row.active and not row.has_address:
                no_address += count
        else:
            by_code[code] = by_code.get(code, 0) + count
    return by_code, unplaced, no_address


async def query_opportunity(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    radius_km: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    campus = await campus_out(db, campus_key)
    status = await population_status(db)
    result: dict[str, Any] = {
        "as_of": now or datetime.now(timezone.utc),
        "filters": {"campus_key": campus_key, "school_year": school_year, "semester": semester},
        "radius_km": radius_km,
        "population": {**status, "age_band": AGE_BAND_KEY, "source_note": population_io.SOURCE_NOTE},
        "campus": campus,
        "baseline": None,
        "outside_visit": 0,
        "unplaced_visit": 0,
        "no_address_visit": 0,
        "no_population_villages": [],
        "villages": [],
    }
    visits, unplaced, no_address = await visits_by_village(db, campus_key, school_year, semester)
    result["unplaced_visit"] = unplaced
    result["no_address_visit"] = no_address
    if status["version"] is None or campus["lat"] is None or campus["lng"] is None:
        # 沒有人口或本校沒座標：算不出附近有哪些里。到里的參觀全部算在半徑外沒有意義，照實放進 outside_visit
        # 會讓畫面寫出「N 位來自 3 公里外」的錯話，所以留 0，由畫面寫原因。
        return result

    # 「附近」只看里界重心的距離（規格 O2），不看人口表有沒有那個里。人口批次有 850 個里就能換版，附近的里
    # 可能沒有人口列；它的參觀若被當成半徑外，距本校 287 m 的里會被寫成「3 公里外」。
    radius_m = radius_km * 1000
    near: dict[str, int] = {}
    for code, point in boundaries.village_centroids().items():
        distance = haversine_m(campus["lat"], campus["lng"], *point)
        if distance <= radius_m:
            near[code] = _round_distance(distance)
    population = (await db.execute(select(GeoVillagePopulation))).scalars().all()
    nearby = [(row, near[row.village_code]) for row in population if row.village_code in near]
    result["outside_visit"] = sum(count for code, count in visits.items() if code not in near)
    # 附近但人口表沒有的里：沒有孩子數可除，參觀不進附近平均；列出來讓畫面交代，參觀多的排前面。
    with_population = {row.village_code for row in population}
    names = boundaries.village_names()
    result["no_population_villages"] = sorted(
        (
            {
                "district": names[code][0],
                "village": names[code][1],
                "village_code": code,
                "distance_m": distance,
                "visit": visits.get(code, 0),
            }
            for code, distance in near.items()
            if code not in with_population
        ),
        key=lambda item: (-item["visit"], item["distance_m"], item["district"], item["village"]),
    )

    children_total = sum(_sum_ages(row, AGE_BAND) for row, _ in nearby)
    visit_total = sum(visits.get(row.village_code, 0) for row, _ in nearby)
    judged = visit_total >= MIN_BASELINE_VISITS
    rate = visit_total / children_total if children_total else None
    result["baseline"] = {
        "villages": len(nearby),
        "children": children_total,
        "infants": sum(_sum_ages(row, INFANT_BAND) for row, _ in nearby),
        "visit": visit_total,
        "rate": pct(visit_total, children_total),
        "judged": judged,
    }

    villages = []
    for row, distance in nearby:
        children = _sum_ages(row, AGE_BAND)
        visit = visits.get(row.village_code, 0)
        expected = children * rate if rate is not None else None
        villages.append(
            {
                "district": row.district,
                "village": row.village,
                "village_code": row.village_code,
                "distance_m": distance,
                "children": children,
                "infants": _sum_ages(row, INFANT_BAND),
                "visit": visit,
                "rate": pct(visit, children),
                "expected": round(expected, 1) if expected is not None else None,
                "shortfall": round(expected - visit, 1) if expected is not None else None,
                "signal": judge(visit, expected, judged=judged),
            }
        )
    # 少最多的里排最前面（O7）；沒有附近平均時依孩子數。同值依孩子數、再依區與里名，順序固定。
    villages.sort(key=lambda item: (-(item["shortfall"] or 0.0), -item["children"], item["district"], item["village"]))
    result["villages"] = villages
    return result
