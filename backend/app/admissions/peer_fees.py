"""附近同業收費（2026-10-15 附近同業比較規格 §5）：本校一學期公告收費在半徑內私立一般園所裡的位置。只讀。

排名、中位數、項目對照只用私立一般（F2）；準公共、公立、非營利只列家數與公告收費當背景。
本機構（任一校 50 公尺內）不算同業；本校＝距本校 50 公尺內最近的營業中園所（F12、F13）。
收費是哪一學年的公告，園所類型就用那一學年的（kind_as_of）：名單同步存的是當時目前學年的類型，
準公共期間剛好從下一學年才開始的園所，在公告收費的學年還是私立一般，不能和準公共混在一起分組。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area
from app.admissions.academic import current_term
from app.admissions.geo import fees as geo_fees
from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo import matcher
from app.admissions.geo.kindergartens import NearbyKindergarten
from app.admissions.geo.models import FEE_AGES, GeoDatasetStatus, GeoKindergartenFee
from app.admissions.geo.projection import haversine_m
from app.common.timezones import today_local

AGE_CHOICES = FEE_AGES
GROUP_ORDER = ("private", "quasi_public", "public", "nonprofit")


def _items(fee: GeoKindergartenFee | None) -> dict[str, int | None]:
    return {key: (getattr(fee, key) if fee is not None else None) for key in geo_fees.ITEM_KEYS}


def _group(
    kind: str, members: list[NearbyKindergarten], fees: dict[str, GeoKindergartenFee], own_total: int | None = None
) -> dict[str, Any]:
    totals = [fees[item.source_id].semester_total for item in members if item.source_id in fees]
    group: dict[str, Any] = {
        "kind": kind, "schools": len(members), "with_fee": len(totals), "median": geo_fees.median(totals),
        "lowest": min(totals, default=None), "highest": max(totals, default=None), "own_rank": None, "rank_total": None,
    }
    if own_total is not None:
        group["own_rank"] = sum(1 for total in totals if total > own_total) + 1
        group["rank_total"] = len(totals) + 1
    return group


async def query_peer_fees(db: AsyncSession, campus_key: str, *, radius_km: int, age: int) -> dict[str, Any]:
    points = await matcher.campus_points(db)
    campus = await area.campus_out(db, campus_key, points[campus_key])
    status = await db.get(GeoDatasetStatus, "kindergarten_fees")
    current_school_year, _ = current_term(today_local())
    result: dict[str, Any] = {
        "campus": campus,
        "radius_km": radius_km,
        "age": age,
        "school_year": int(status.active_version) if status is not None and status.active_version else None,
        "current_school_year": current_school_year,
        "synced_at": status.synced_at if status is not None else None,
        "source_note": geo_fees.SOURCE_NOTE,
        "own": None,
        "own_missing": None,
        "groups": [_group(kind, [], {}) for kind in GROUP_ORDER],
        "items": [],
        "schools": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    lat, lng = campus["lat"], campus["lng"]
    own_points = [(point.lat, point.lng) for point in points.values() if point.lat is not None and point.lng is not None]
    found = await geo_kindergartens.nearby(db, lat, lng, radius_km * 1000)
    ids = [item.source_id for item in found]
    fees: dict[str, GeoKindergartenFee] = {}
    if ids:
        rows = await db.execute(
            select(GeoKindergartenFee).where(GeoKindergartenFee.age == age, GeoKindergartenFee.source_id.in_(ids))
        )
        fees = {row.source_id: row for row in rows.scalars()}
    own_flags = {
        item.source_id: any(haversine_m(item.lat, item.lng, a, b) <= area.OWN_CAMPUS_RADIUS_M for a, b in own_points)
        for item in found
    }
    own_school, own_fee = await geo_fees.own_fee(db, lat, lng, age=age, radius_m=area.OWN_CAMPUS_RADIUS_M)
    if own_school is None:
        result["own_missing"] = "not_found"
    elif own_fee is None:
        result["own_missing"] = "no_fee"
    else:
        result["own"] = {
            "source_id": own_school.source_id,
            "name": own_school.name,
            "semester_total": own_fee.semester_total,
            "months": float(own_fee.months) if own_fee.months is not None else None,
            "monthly_average": geo_fees.monthly_average(own_fee.semester_total, own_fee.months),
            "items": _items(own_fee),
            "transport_note": own_fee.transport_note,
        }
    fee_year = result["school_year"]

    def kind_of(kind: str, pre_public_period: str | None) -> str:
        return kind if fee_year is None else geo_kindergartens.kind_as_of(kind, pre_public_period, fee_year)

    kinds = {item.source_id: kind_of(item.kind, item.pre_public_period) for item in found}
    peers = [item for item in found if not own_flags[item.source_id]]
    # 本校本身是私立一般才排名（F14）：不同類型的公告收費不能互相排名。
    own_is_private = own_fee is not None and kind_of(own_school.kind, own_school.pre_public_period) == "private"
    rank_against = own_fee.semester_total if own_fee is not None and own_is_private else None
    result["groups"] = [
        _group(kind, [item for item in peers if kinds[item.source_id] == kind], fees, rank_against if kind == "private" else None)
        for kind in GROUP_ORDER
    ]
    private_fees = [fees[item.source_id] for item in peers if kinds[item.source_id] == "private" and item.source_id in fees]
    items = []
    for key in geo_fees.ITEM_KEYS:
        values = [value for fee in private_fees if (value := getattr(fee, key)) is not None]
        items.append({
            "key": key, "own": getattr(own_fee, key) if own_fee is not None else None,
            "peer_median": geo_fees.median(values), "peer_count": len(values),
        })
    result["items"] = items
    result["schools"] = [
        {
            "source_id": item.source_id,
            "name": item.name,
            "kind": kinds[item.source_id],
            "distance_m": item.distance_m,
            "is_own": own_flags[item.source_id],
            "semester_total": fees[item.source_id].semester_total if item.source_id in fees else None,
            "monthly_average": (
                geo_fees.monthly_average(fees[item.source_id].semester_total, fees[item.source_id].months)
                if item.source_id in fees else None
            ),
            "items": _items(fees.get(item.source_id)),
            "transport_note": fees[item.source_id].transport_note if item.source_id in fees else None,
        }
        for item in found
    ]
    return result
