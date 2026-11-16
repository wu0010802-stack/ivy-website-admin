"""五校周邊環境比較（docs/specs/2026-11-16-area-compare-notices-design.md §6）：/admin/admissions/area/compare。

只讀：不 flush、不 commit、不寫稽核。逐校重用單校端點的計算（opportunity、trends 只算孩子、peer_fees、
babycare、changes），數字和單校畫面一致。每校包在 savepoint 裡：某一校的 SQL 出錯，async session 的交易不會被
污染，那一列 unavailable="error"，其他列照常。本校沒座標的那一列寫 locate_error 的原因，數字全 null。"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area, opportunity, peer_fees, trends
from app.admissions.geo import matcher

logger = logging.getLogger(__name__)

FEE_AGE = 3
_NUMBER_KEYS = (
    "children", "kids_net", "kids_unavailable", "kindergartens", "babycare", "own_fee", "own_kind", "own_missing",
    "fee_median", "fee_rank", "fee_rank_total", "changes_12m",
)


def _blank(campus_key: str, unavailable: str, locate_error: str | None) -> dict[str, Any]:
    return {"campus_key": campus_key, "unavailable": unavailable, "locate_error": locate_error, **dict.fromkeys(_NUMBER_KEYS)}


async def _row(db: AsyncSession, campus_key: str, radius_km: int) -> tuple[dict[str, Any], int | None]:
    point = await matcher.campus_point(db, campus_key)
    if point.lat is None or point.lng is None:
        return _blank(campus_key, "no_campus_point", point.locate_error), None
    try:
        # 這一校的所有查詢在同一個 savepoint：出錯只 rollback 到這裡。
        async with db.begin_nested():
            opp = await opportunity.query_opportunity(db, campus_key, school_year=None, semester=None, radius_km=radius_km)
            kids = await trends.query_trends(
                db, campus_key, school_year=None, semester=None, radius_km=radius_km, kids_only=True
            )
            fees = await peer_fees.query_peer_fees(db, campus_key, radius_km=radius_km, age=FEE_AGE)
            babycare = await area.query_babycare(db, campus_key, radius_km=radius_km)
            changes = await area.query_changes(db, campus_key, radius_km=radius_km)
    except Exception:
        logger.exception("五校周邊環境：%s 計算失敗", campus_key)
        return _blank(campus_key, "error", None), None
    groups = {group["kind"]: group for group in fees["groups"]}
    private = groups["private"]
    own = fees["own"]
    row = {
        "campus_key": campus_key,
        "unavailable": None,
        "locate_error": None,
        "children": opp["baseline"]["children"] if opp["baseline"] is not None else None,
        "kids_net": kids["baseline"]["kids_net"] if kids["baseline"] is not None else None,
        "kids_unavailable": kids["kids_unavailable"],
        "kindergartens": {kind: groups[kind]["schools"] for kind in peer_fees.GROUP_ORDER},
        "babycare": babycare["summary"]["count"],
        "own_fee": own["semester_total"] if own is not None else None,
        "own_kind": own["kind"] if own is not None else None,
        "own_missing": fees["own_missing"],
        "fee_median": private["median"],
        "fee_rank": private["own_rank"],
        "fee_rank_total": private["rank_total"],
        "changes_12m": len(changes["items"]),
    }
    return row, fees["school_year"]


async def query_area_compare(db: AsyncSession, campus_keys: list[str], *, radius_km: int) -> dict[str, Any]:
    status = await opportunity.population_status(db)
    rows = []
    fee_school_year: int | None = None
    for campus_key in campus_keys:
        row, school_year = await _row(db, campus_key, radius_km)
        rows.append(row)
        if fee_school_year is None:
            fee_school_year = school_year
    return {
        "radius_km": radius_km,
        "population_version": status["version"],
        "fee_school_year": fee_school_year,
        "rows": rows,
    }
