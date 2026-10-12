"""招生區域分析（2026-10-08 區域分析規格 §8）：/admin/admissions/area 與 /area/kindergartens。

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
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import estimation, records
from app.admissions.geo import boundaries, matcher
from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo.models import VILLAGE_LEVELS, GeoDatasetStatus, RecruitmentVisitGeo
from app.admissions.geo.projection import haversine_m
from app.admissions.models import RecruitmentVisit
from app.admissions.stats import _base_filters, _count_columns, pct
from app.campuses.models import Campus

DISTANCE_BANDS = ("0-1", "1-3", "3-6", "6+", "none")
# 有地址卻沒到里的原因，筆數相同時照這個順序列。no_address、anonymized 不在其中：
# 它們各有自己的層級與筆數（totals.no_address、totals.anonymized）。
REASON_ORDER = ("outside_kaohsiung", "no_doorplate", "ambiguous_village")
RADIUS_CHOICES = (1, 3, 6)
# 與任一校區座標相距這個距離內的園所視為本機構（規格 §8.2）。
OWN_CAMPUS_RADIUS_M = 50
KINDERGARTEN_SOURCE_NOTE = geo_kindergartens.SOURCE_NOTE


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


async def campus_out(db: AsyncSession, campus_key: str) -> dict[str, Any]:
    campus = await db.get(Campus, campus_key)
    point = await matcher.campus_point(db, campus_key)
    return {
        "key": campus_key,
        "name": campus.name if campus is not None else campus_key,
        "lat": point.lat,
        "lng": point.lng,
        "locate_error": point.locate_error,
    }


async def _data_status(db: AsyncSession) -> dict[str, Any]:
    statuses = {status.dataset: status for status in (await db.execute(select(GeoDatasetStatus))).scalars()}
    doorplates = statuses.get("doorplates")
    kindergartens = statuses.get("kindergartens")
    return {
        # 畫面顯示月份「115-10」；active_version 是內部批次標記（A 階段定案）。
        "doorplate_version": await matcher.doorplate_label(db),
        "doorplates_synced_at": doorplates.synced_at if doorplates is not None else None,
        "kindergartens_synced_at": kindergartens.synced_at if kindergartens is not None else None,
        "boundary_version": boundaries.BOUNDARY_VERSION,
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
    campus = await campus_out(db, campus_key)
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
    own_points = [
        (point.lat, point.lng)
        for point in (await matcher.campus_points(db)).values()
        if point.lat is not None and point.lng is not None
    ]
    found = await geo_kindergartens.nearby(db, campus["lat"], campus["lng"], radius_km * 1000)
    result["items"] = [
        {
            **asdict(item),
            "is_own": any(haversine_m(item.lat, item.lng, lat, lng) <= OWN_CAMPUS_RADIUS_M for lat, lng in own_points),
        }
        for item in sorted(found, key=lambda kindergarten: (kindergarten.distance_m, kindergarten.name))
    ]
    return result
