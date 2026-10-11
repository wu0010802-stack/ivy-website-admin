"""訪視地址 → 行政區＋里＋到本校直線距離（docs/specs/2026-10-08-admissions-area-design.md §6）。
只查官網自己的資料庫，家長地址不送任何外部服務。

比對等級依序：
- exact：門牌完全對到（之號對不到時退回同號之 0）；
- nearby：同街路段、同巷弄，號碼最近（差距 NEARBY_MAX_GAP 號以內，同單雙號優先）；
- street：巷弄、巷、整條街路段，由窄到寬其中一層的門牌全在同一個里（沒有座標）；
- district：只知道區；
- unlocated：沒有地址、外縣市、解析不出高雄市的區。
精確門牌對到兩個里時不硬選：district＋ambiguous_village。里一律以門牌表為準，
不採信地址裡寫的里。門牌表還沒匯入時是 pending（區照樣從地址解析）。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import distinct, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.address import parse_address
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, RecruitmentVisitGeo
from app.admissions.geo.projection import haversine_m
from app.admissions.models import RecruitmentVisit
from app.campuses.models import CAMPUS_KEYS
from app.content import service as content_service

NEARBY_MAX_GAP = 30


@dataclass(frozen=True)
class GeoMatch:
    district: str | None
    village: str | None
    match_level: str
    unlocated_reason: str | None
    lat: float | None
    lng: float | None


@dataclass(frozen=True)
class CampusPoint:
    campus_key: str
    lat: float | None
    lng: float | None
    locate_error: str | None  # "no_address" | "no_doorplate" | "pending"；有座標時 None


def _unlocated(reason: str) -> GeoMatch:
    return GeoMatch(None, None, "unlocated", reason, None, None)


async def active_doorplate_version(db: AsyncSession) -> str | None:
    """使用中的門牌批次標記（「115-10#a1b2c3」）；還沒匯入過回 None。"""
    return await db.scalar(
        select(GeoDatasetStatus.active_version).where(GeoDatasetStatus.dataset == "doorplates")
    )


async def doorplate_label(db: AsyncSession) -> str | None:
    """畫面上顯示的門牌資料月份（「115-10」）；還沒匯入過回 None。"""
    return await db.scalar(select(GeoDatasetStatus.label).where(GeoDatasetStatus.dataset == "doorplates"))


async def locate(db: AsyncSession, address: str | None, *, version: str | None) -> GeoMatch:
    parsed = parse_address(address)
    if parsed is None:
        return _unlocated("no_address")
    if parsed.outside_kaohsiung:
        return _unlocated("outside_kaohsiung")
    if parsed.district is None:
        return _unlocated("no_doorplate")
    district = parsed.district
    if version is None:
        return GeoMatch(district, None, "pending", None, None, None)
    if parsed.street:
        base = (
            GeoDoorplate.dataset_version == version,
            GeoDoorplate.town_code == CODE_OF_DISTRICT[district],
            GeoDoorplate.street == parsed.street,
        )
        same_unit = (GeoDoorplate.lane == (parsed.lane or ""), GeoDoorplate.alley == (parsed.alley or ""))
        if parsed.number is not None:
            picked = await _exact_rows(db, base, same_unit, parsed.number, parsed.number_sub)
            villages = {row.village for row in picked}
            if len(villages) == 1:
                return GeoMatch(district, picked[0].village, "exact", None, picked[0].lat, picked[0].lng)
            if len(villages) > 1:
                return GeoMatch(district, None, "district", "ambiguous_village", None, None)
            near = (
                await db.execute(
                    select(GeoDoorplate.village, GeoDoorplate.lat, GeoDoorplate.lng)
                    .where(*base, *same_unit, func.abs(GeoDoorplate.number - parsed.number) <= NEARBY_MAX_GAP)
                    # 同單雙號（同一側街廓）優先，再看號碼差距：里界常沿街道中線劃分。
                    .order_by(
                        func.mod(GeoDoorplate.number + parsed.number, 2),
                        func.abs(GeoDoorplate.number - parsed.number),
                        GeoDoorplate.number_sub,
                        GeoDoorplate.id,
                    )
                    .limit(1)
                )
            ).first()
            if near is not None:
                return GeoMatch(district, near.village, "nearby", None, near.lat, near.lng)
        for extra in (same_unit, same_unit[:1], ()):
            villages_found = (
                await db.execute(select(distinct(GeoDoorplate.village)).where(*base, *extra).limit(2))
            ).scalars().all()
            if len(villages_found) == 1:
                return GeoMatch(district, villages_found[0], "street", None, None, None)
            if len(villages_found) > 1:
                break
    return GeoMatch(district, None, "district", None, None, None)


async def _exact_rows(db: AsyncSession, base: tuple, same_unit: tuple, number: int, number_sub: int) -> list:
    """同號同之號的門牌；之號對不到時退回同號之 0。"""
    rows = (
        await db.execute(
            select(GeoDoorplate.village, GeoDoorplate.lat, GeoDoorplate.lng, GeoDoorplate.number_sub)
            .where(*base, *same_unit, GeoDoorplate.number == number, GeoDoorplate.number_sub.in_({number_sub, 0}))
            .order_by(GeoDoorplate.id)
        )
    ).all()
    return [row for row in rows if row.number_sub == number_sub] or [row for row in rows if row.number_sub == 0]


async def campus_point(db: AsyncSession, campus_key: str) -> CampusPoint:
    """校址取已發布的校區資料（content campus_profile 的 address），用同一套比對取座標；
    只接受 exact／nearby。"""
    profile = await content_service.published_payload(db, "campus_profile", campus_key) or {}
    address = str(profile.get("address") or "").strip()
    if not address:
        return CampusPoint(campus_key, None, None, "no_address")
    version = await active_doorplate_version(db)
    if version is None:
        return CampusPoint(campus_key, None, None, "pending")
    match = await locate(db, address, version=version)
    if match.match_level in ("exact", "nearby"):
        return CampusPoint(campus_key, match.lat, match.lng, None)
    return CampusPoint(campus_key, None, None, "no_doorplate")


async def campus_points(db: AsyncSession) -> dict[str, CampusPoint]:
    return {key: await campus_point(db, key) for key in CAMPUS_KEYS}


def distance_to(match: GeoMatch, point: CampusPoint | None) -> int | None:
    """到校區的直線距離，取整到 100 m；任一邊沒有座標回 None。"""
    if point is None or point.lat is None or point.lng is None or match.lat is None or match.lng is None:
        return None
    return int(round(haversine_m(point.lat, point.lng, match.lat, match.lng) / 100.0)) * 100


async def _upsert_geo(
    db: AsyncSession, visit_id: uuid.UUID, match: GeoMatch, distance_m: int | None, label: str | None
) -> None:
    values = {
        "village": match.village,
        "match_level": match.match_level,
        "unlocated_reason": match.unlocated_reason,
        "distance_m": distance_m,
        "doorplate_version": label,
        "matched_at": datetime.now(timezone.utc),
    }
    await db.execute(
        pg_insert(RecruitmentVisitGeo)
        .values(visit_id=visit_id, **values)
        .on_conflict_do_update(index_elements=[RecruitmentVisitGeo.visit_id], set_=values)
    )


async def apply_visit_geo(db: AsyncSession, visit: RecruitmentVisit) -> None:
    """依 visit.address 比對，upsert recruitment_visit_geo、設定 visit.district。visit 必須
    已 flush（recruitment_visits 已有這一列）。不碰 version、updated_at；不 commit。
    已匿名化的訪視不動（匿名化另外處理，階段 B）。"""
    if visit.anonymized_at is not None:
        return
    version = await active_doorplate_version(db)
    match = await locate(db, visit.address, version=version)
    point = await campus_point(db, visit.campus_key) if match.lat is not None else None
    visit.district = match.district
    await _upsert_geo(db, visit.id, match, distance_to(match, point), await doorplate_label(db))


async def rematch_visits(db: AsyncSession, *, batch_size: int = 100) -> int:
    """重算所有未匿名化訪視（門牌換版、校址變更後由同步工作呼叫）。每批 commit（預設 100 筆：
    一批持有這些列的列鎖，同時編輯其中一筆要等批次 commit，lock_timeout 只有 10 秒）；回傳
    處理筆數。用 Core UPDATE 只寫 district，條件是「地址仍是剛才讀到的值」：使用者同時
    改了地址就不覆蓋（他那筆交易已經用新地址比對過）。不碰 version、updated_at。"""
    version = await active_doorplate_version(db)
    label = await doorplate_label(db)
    points = await campus_points(db)
    processed = 0
    last_id: uuid.UUID | None = None
    while True:
        stmt = (
            select(RecruitmentVisit.id, RecruitmentVisit.campus_key, RecruitmentVisit.address)
            .where(RecruitmentVisit.anonymized_at.is_(None))
            .order_by(RecruitmentVisit.id)
            .limit(batch_size)
        )
        if last_id is not None:
            stmt = stmt.where(RecruitmentVisit.id > last_id)
        rows = (await db.execute(stmt)).all()
        if not rows:
            return processed
        for row in rows:
            match = await locate(db, row.address, version=version)
            updated = await db.execute(
                update(RecruitmentVisit)
                .where(
                    RecruitmentVisit.id == row.id,
                    RecruitmentVisit.address.is_not_distinct_from(row.address),
                    RecruitmentVisit.anonymized_at.is_(None),
                )
                .values(district=match.district)
                .execution_options(synchronize_session=False)
            )
            if updated.rowcount == 1:
                await _upsert_geo(db, row.id, match, distance_to(match, points.get(row.campus_key)), label)
        await db.commit()
        processed += len(rows)
        last_id = rows[-1].id
