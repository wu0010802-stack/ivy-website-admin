"""招生區域分析（2026-10-08 區域分析規格 §8）：/admin/admissions/area 與 /area/kindergartens、/area/babycare 與 /area/changes。

只讀：不 flush、不 commit、不寫稽核。回應只有聚合數字與公開園所資料，不含家長個資。
口徑沿用 stats.py：母體 _base_filters（校區＋入學學年學期），參觀人數＝筆數、預繳人數＝
has_deposit，預繳率 pct（分母 0 回 None）。

每筆訪視歸到一個層級（_level），數字以「有地址」為母數（主控裁定 R5）：
- anonymized：已匿名化（地址已清掉，不算有地址；行政區保留，所以仍會出現在行政區表）。
- no_address：未匿名化、沒填地址（判斷同訪視明細的 geo=no_village，見 records.has_address）。
- 其餘是有地址的四層：
  - village：比對到里（exact／nearby／street）。
  - district：只到區（含里有歧義）。
  - unlocated：查無門牌、非高雄市。
  - pending：門牌還沒匯入，或上線前的舊訪視還沒重算（沒有比對結果）。

SQL 只 GROUP BY 原始欄位與 IS NULL，層級在 Python 判斷（同 stats.py 檔頭：asyncpg
伺服器端參數會讓 GROUP BY 裡帶參數的運算式對不上 SELECT）。"""

from __future__ import annotations

from dataclasses import asdict
from datetime import date, datetime, timezone
from typing import Any, get_args

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import estimation, records
from app.admissions.geo import boundaries, matcher
from app.admissions.geo import babycare as geo_babycare
from app.admissions.geo import fees as geo_fees
from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo import providers as geo_providers
from app.admissions.geo.models import VILLAGE_LEVELS, GeoDatasetStatus, RecruitmentVisitGeo
from app.admissions.geo.projection import haversine_m
from app.admissions.models import RecruitmentVisit
from app.admissions.schemas import AreaUnlocatedReason
from app.admissions.stats import _base_filters, _count_columns, pct
from app.campuses.models import Campus
from app.common.timezones import today_local

DISTANCE_BANDS = ("0-1", "1-3", "3-6", "6+", "none")
# 有地址卻沒到里的原因，筆數相同時照這個順序列。no_address、anonymized 不在其中：
# 它們各有自己的層級與筆數（totals.no_address、totals.anonymized）。與 API 的 Literal 同一個來源。
REASON_ORDER: tuple[str, ...] = get_args(AreaUnlocatedReason)
RADIUS_CHOICES = (1, 3, 6)
# 與任一校區座標相距這個距離內的園所視為本機構（規格 §8.2）。
OWN_CAMPUS_RADIUS_M = 50
KINDERGARTEN_SOURCE_NOTE = geo_kindergartens.SOURCE_NOTE
BABYCARE_SOURCE_NOTE = geo_babycare.SOURCE_NOTE


def distance_band(distance_m: int | None) -> str:
    """直線距離分組（規格 §6.5）：剛好 1、3、6 公里算外面那一組。"""
    if distance_m is None:
        return "none"
    if distance_m < 1000:
        return "0-1"
    if distance_m < 3000:
        return "1-3"
    if distance_m < 6000:
        return "3-6"
    return "6+"


def _level(row: Any) -> tuple[str, str | None]:
    """(層級, 未定位原因)。row 帶 active、has_address、match_level、unlocated_reason。
    原因只對 district、unlocated 兩層有意義。"""
    if not row.active:
        return "anonymized", None
    if not row.has_address:
        return "no_address", None
    if row.match_level is None or row.match_level == "pending":
        return "pending", None
    if row.match_level in VILLAGE_LEVELS:
        return "village", None
    if row.match_level == "district":
        return "district", row.unlocated_reason
    return "unlocated", row.unlocated_reason


def _counter() -> dict[str, int]:
    return {"visit": 0, "deposit": 0}


def _add(bucket: dict[str, int], row: Any) -> None:
    bucket["visit"] += int(row.visit or 0)
    bucket["deposit"] += int(row.deposit or 0)


def _row(bucket: dict[str, int], prior: float | None, **labels: Any) -> dict[str, Any]:
    return {
        **labels,
        "visit": bucket["visit"],
        "deposit": bucket["deposit"],
        "visit_to_deposit_rate": pct(bucket["deposit"], bucket["visit"]),
        # 可能範圍（2026-10-12 規格 §7）：全體＝距離帶相加（每筆訪視恰好落在一個距離帶）。
        "visit_to_deposit_range": estimation.rate_range(bucket["deposit"], bucket["visit"], prior),
    }


async def campus_out(db: AsyncSession, campus_key: str, point: matcher.CampusPoint | None = None) -> dict[str, Any]:
    """point 由呼叫端給（已經算過這一校的座標）就不再算一次。"""
    campus = await db.get(Campus, campus_key)
    point = point if point is not None else await matcher.campus_point(db, campus_key)
    return {
        "key": campus_key,
        "name": campus.name if campus is not None else campus_key,
        "lat": point.lat,
        "lng": point.lng,
        "locate_error": point.locate_error,
        "district": point.district,
    }


async def _data_status(db: AsyncSession) -> dict[str, Any]:
    statuses = {status.dataset: status for status in (await db.execute(select(GeoDatasetStatus))).scalars()}
    doorplates = statuses.get("doorplates")
    kindergartens = statuses.get("kindergartens")
    babycare = statuses.get("babycare")
    # 各里人口（2026-10-13 招生機會）：只有換版成功過（active_version 有值）才算匯入，失敗只留 last_error 的列不算。
    population = statuses.get("population")
    population_imported = population is not None and population.active_version is not None
    return {
        # 畫面顯示月份「115-10」（label）；active_version 是內部批次標記（A 階段定案）。
        # 取自已讀到的狀態列，不為它再查一次。
        "doorplate_version": doorplates.label if doorplates is not None else None,
        "doorplates_synced_at": doorplates.synced_at if doorplates is not None else None,
        "kindergartens_synced_at": kindergartens.synced_at if kindergartens is not None else None,
        "babycare_synced_at": babycare.synced_at if babycare is not None else None,
        "boundary_version": boundaries.BOUNDARY_VERSION,
        "population_version": population.label if population_imported else None,
        "population_synced_at": population.synced_at if population_imported else None,
    }


async def query_area(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    v, g = RecruitmentVisit, RecruitmentVisitGeo
    active = v.anonymized_at.is_(None)
    addressed = records.has_address()
    columns = (v.district, g.village, g.match_level, g.unlocated_reason, g.distance_m)
    stmt = (
        select(*columns, active.label("active"), addressed.label("has_address"), *_count_columns())
        .select_from(v)
        .outerjoin(g, g.visit_id == v.id)
        .where(*_base_filters(campus_key, school_year, semester))
        .group_by(*columns, active, addressed)
    )
    rows = list((await db.execute(stmt)).all())

    campus = await campus_out(db, campus_key)
    # R6：校區沒有座標時，訪視上存的距離是以前的校址算的，不能拿來分組；一律歸 none。
    located = campus["lat"] is not None and campus["lng"] is not None

    levels = dict.fromkeys(("village", "district", "unlocated", "pending", "no_address", "anonymized"), 0)
    reasons = dict.fromkeys(REASON_ORDER, 0)
    districts: dict[str, dict[str, int]] = {}
    villages: dict[tuple[str, str], dict[str, int]] = {}
    bands = {band: _counter() for band in DISTANCE_BANDS}
    for row in rows:
        count = int(row.visit or 0)
        level, reason = _level(row)
        levels[level] += count
        if reason in reasons:
            reasons[reason] += count
        if row.district:
            _add(districts.setdefault(row.district, _counter()), row)
        if level == "village" and row.district and row.village:
            _add(villages.setdefault((row.district, row.village), _counter()), row)
        _add(bands[distance_band(row.distance_m if row.active and located else None)], row)

    prior = estimation.prior_rate(
        sum(bucket["deposit"] for bucket in bands.values()), sum(bucket["visit"] for bucket in bands.values())
    )
    with_address = levels["village"] + levels["district"] + levels["unlocated"] + levels["pending"]
    ranked_reasons = sorted(
        ((reason, count) for reason, count in reasons.items() if count),
        key=lambda item: (-item[1], REASON_ORDER.index(item[0])),
    )
    return {
        "as_of": now or datetime.now(timezone.utc),
        "filters": {"campus_key": campus_key, "school_year": school_year, "semester": semester},
        "data_status": await _data_status(db),
        "campus": campus,
        "totals": {
            "visit": with_address + levels["no_address"] + levels["anonymized"],
            "with_address": with_address,
            "village_level": levels["village"],
            "district_level": levels["district"],
            "unlocated": levels["unlocated"],
            "pending": levels["pending"],
            "no_address": levels["no_address"],
            "anonymized": levels["anonymized"],
            "unlocated_reasons": [{"reason": reason, "count": count} for reason, count in ranked_reasons],
        },
        "districts": [
            _row(bucket, prior, district=name)
            for name, bucket in sorted(districts.items(), key=lambda item: (-item[1]["visit"], item[0]))
        ],
        "villages": [
            _row(bucket, prior, district=district, village=village, village_code=boundaries.village_code(district, village))
            for (district, village), bucket in sorted(villages.items(), key=lambda item: (-item[1]["visit"], item[0]))
        ],
        "distance_bands": [_row(bands[band], prior, band=band) for band in DISTANCE_BANDS],
    }


async def query_kindergartens(db: AsyncSession, campus_key: str, *, radius_km: int) -> dict[str, Any]:
    """本校半徑內的幼兒園（規格 §8.2），依距離排序。校區比對不到座標時回空清單，原因在
    campus.locate_error。is_own：與任一校區座標相距 50 公尺內（本機構，不算競爭園所）。"""
    # 五校座標一次算完：本校的拿來回 campus，全部拿來判斷哪些園所是本機構（本校不算兩次）。
    points = await matcher.campus_points(db)
    campus = await campus_out(db, campus_key, points[campus_key])
    status = await db.get(GeoDatasetStatus, "kindergartens")
    result: dict[str, Any] = {
        "synced_at": status.synced_at if status is not None else None,
        "source_note": KINDERGARTEN_SOURCE_NOTE,
        "campus": campus,
        "radius_km": radius_km,
        "items": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    own_points = [(point.lat, point.lng) for point in points.values() if point.lat is not None and point.lng is not None]
    # nearby 已依距離、名稱排好序（排序鍵只在那裡定義一次）。
    found = await geo_kindergartens.nearby(db, campus["lat"], campus["lng"], radius_km * 1000)
    result["items"] = [
        {
            **asdict(item),
            "is_own": any(haversine_m(item.lat, item.lng, lat, lng) <= OWN_CAMPUS_RADIUS_M for lat, lng in own_points),
        }
        for item in found
    ]
    return result


async def query_babycare(db: AsyncSession, campus_key: str, *, radius_km: int) -> dict[str, Any]:
    """本校半徑內營業中的托嬰中心與托育家園（2026-10-14 規格 §6），依距離排序。校區比對不到座標時回空清單，
    原因在 campus.locate_error；名單從未匯入時 synced_at 是 null（畫面寫尚未匯入，不寫附近沒有）。"""
    campus = await campus_out(db, campus_key)
    status = await db.get(GeoDatasetStatus, "babycare")
    fee_status = await db.get(GeoDatasetStatus, "kindergarten_fees")
    fee_school_year = int(fee_status.active_version) if fee_status is not None and fee_status.active_version else None
    result: dict[str, Any] = {
        "synced_at": status.synced_at if status is not None else None,
        "source_note": BABYCARE_SOURCE_NOTE,
        "campus": campus,
        "radius_km": radius_km,
        "summary": {
            "count": 0, "approved_total": 0, "enrolled_total": 0, "fee_count": 0, "fee_median": None,
            "fee_min": None, "fee_max": None, "own_age2_monthly": None, "fee_school_year": fee_school_year,
        },
        "items": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    found = await geo_babycare.nearby(db, campus["lat"], campus["lng"], radius_km * 1000)
    result["items"] = [asdict(item) for item in found]
    monthly = [item.monthly_fee for item in found if item.monthly_fee is not None]
    # 本校 2 歲班月均（規格 §5）：和托嬰月費擺在一起對照，兩邊都不含延托。
    _, own_fee = await geo_fees.own_fee(db, campus["lat"], campus["lng"], age=2, radius_m=OWN_CAMPUS_RADIUS_M)
    result["summary"] = {
        "count": len(found),
        "approved_total": sum(item.approved_capacity or 0 for item in found),
        "enrolled_total": sum(item.enrolled or 0 for item in found),
        "fee_count": len(monthly),
        "fee_median": geo_fees.median(monthly),
        "fee_min": min(monthly, default=None),
        "fee_max": max(monthly, default=None),
        "own_age2_monthly": geo_fees.monthly_average(own_fee.semester_total, own_fee.months) if own_fee is not None else None,
        "fee_school_year": fee_school_year,
    }
    return result


async def query_changes(
    db: AsyncSession, campus_key: str, *, radius_km: int, today: date | None = None
) -> dict[str, Any]:
    """本校半徑內近 12 個月的新設、停辦、類型變動（規格 §5、§6）。today 只給測試固定日期用，預設台北今天。
    tracking_since 讓畫面老實說從哪天開始記錄。"""
    campus = await campus_out(db, campus_key)
    statuses = {status.dataset: status for status in (await db.execute(select(GeoDatasetStatus))).scalars()}
    kindergartens, babycare = statuses.get("kindergartens"), statuses.get("babycare")
    result: dict[str, Any] = {
        "campus": campus,
        "radius_km": radius_km,
        "window_months": geo_providers.CHANGE_WINDOW_MONTHS,
        "tracking_since": {
            "kindergarten": kindergartens.baseline_on if kindergartens is not None else None,
            "babycare": babycare.baseline_on if babycare is not None else None,
        },
        "items": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    found = await geo_providers.nearby_changes(
        db, campus["lat"], campus["lng"], radius_km * 1000, today=today or today_local()
    )
    result["items"] = [asdict(item) for item in found]
    return result
