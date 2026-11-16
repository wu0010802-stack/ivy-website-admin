"""公開資料同步後檢查五校附近的園所異動與裁罰，寫進站內通知（docs/specs/2026-11-16-area-compare-notices-design.md §7）。

- 每校（有座標的）3 公里內：園所新設、停辦、類型變動（nearby_changes）與新公布的裁罰（geo_kindergarten_penalties）。
  常春藤各校自己（距任一校 50 m 內）不通知；同一園所在兩校範圍內各發一則。
- 記帳：geo_change_notices 每件事一列（dedupe_key 含校區、唯一），INSERT … ON CONFLICT DO NOTHING，只有真的插入成功
  的那一筆才寫通知——兩個同步重疊也不會發兩則。notified＝false 是只記帳不發。
- 首輪：這個校區這一種還沒有基準列 → 當下符合的全部記帳不發、寫基準列。之後才有座標的校區同理。
- 時間窗：有基準之後，異動日期早於 90 天前、裁罰處分日早於 365 天前也只記帳不發；同一所同一種異動 90 天內已發過
  就不再發（兩種來源日期不同時防重複）。
- 通知直接寫 NotificationInboxItem（不經 outbox、不推播）；呼叫端持有同步的 advisory lock，commit 與記帳在同一個交易。"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.area import OWN_CAMPUS_RADIUS_M
from app.admissions.geo import matcher
from app.admissions.geo import providers as geo_providers
from app.admissions.geo.models import (
    GeoBabycare,
    GeoChangeNotice,
    GeoChangeNoticeBaseline,
    GeoKindergarten,
    GeoKindergartenPenalty,
)
from app.admissions.geo.projection import haversine_m
from app.campuses.models import CAMPUS_KEYS
from app.notifications.area_kinds import AREA_PENALTY, AREA_PROVIDER_CHANGE
from app.notifications.models import NotificationInboxItem

logger = logging.getLogger(__name__)

NOTICE_RADIUS_KM = 3
CHANGE_FRESH_DAYS = 90
PENALTY_FRESH_DAYS = 365
REPEAT_GUARD_DAYS = 90
_FRESH_DAYS = {AREA_PROVIDER_CHANGE: CHANGE_FRESH_DAYS, AREA_PENALTY: PENALTY_FRESH_DAYS}


@dataclass(frozen=True)
class _Candidate:
    dedupe_suffix: str
    day: date
    payload: dict[str, Any]
    # 只有異動有：90 天內同一所同一種已發過就不再發。
    repeat_prefix: str | None = None


def _box(lat: float, lng: float, radius_m: int) -> tuple[float, float, float, float]:
    dlat = radius_m / 111_320.0
    dlng = radius_m / (111_320.0 * max(0.01, math.cos(math.radians(lat))))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


async def _provider_points(db: AsyncSession, changes: list[geo_providers.ProviderChange]) -> dict[tuple[str, str], tuple[float, float]]:
    points: dict[tuple[str, str], tuple[float, float]] = {}
    for provider, model in (("kindergarten", GeoKindergarten), ("babycare", GeoBabycare)):
        ids = {item.source_id for item in changes if item.provider == provider}
        if not ids:
            continue
        rows = await db.execute(select(model.source_id, model.lat, model.lng).where(model.source_id.in_(ids)))
        points.update({(provider, source_id): (lat, lng) for source_id, lat, lng in rows.all()})
    return points


def _is_own(lat: float, lng: float, own_points: list[tuple[float, float]]) -> bool:
    return any(haversine_m(lat, lng, a, b) <= OWN_CAMPUS_RADIUS_M for a, b in own_points)


async def _change_candidates(
    db: AsyncSession, campus_key: str, lat: float, lng: float, own_points: list[tuple[float, float]], today: date
) -> list[_Candidate]:
    found = await geo_providers.nearby_changes(db, lat, lng, NOTICE_RADIUS_KM * 1000, today=today)
    points = await _provider_points(db, found)
    result = []
    for item in found:
        point = points.get((item.provider, item.source_id))
        if point is not None and _is_own(point[0], point[1], own_points):
            continue
        prefix = f"{campus_key}:{item.provider}:{item.source_id}:{item.change}:"
        result.append(
            _Candidate(
                dedupe_suffix=f"{item.provider}:{item.source_id}:{item.change}:{item.date.isoformat()}",
                day=item.date,
                repeat_prefix=prefix,
                payload={
                    "radius_km": NOTICE_RADIUS_KM, "provider": item.provider, "source_id": item.source_id, "name": item.name,
                    "change": item.change, "kind": item.kind, "old_kind": item.old_kind, "new_kind": item.new_kind,
                    "distance_m": item.distance_m, "date": item.date.isoformat(), "date_basis": item.date_basis,
                },
            )
        )
    return result


async def _penalty_candidates(
    db: AsyncSession, lat: float, lng: float, own_points: list[tuple[float, float]]
) -> list[_Candidate]:
    south, north, west, east = _box(lat, lng, NOTICE_RADIUS_KM * 1000)
    rows = await db.execute(
        select(GeoKindergartenPenalty, GeoKindergarten)
        .join(GeoKindergarten, GeoKindergarten.source_id == GeoKindergartenPenalty.source_id)
        .where(GeoKindergarten.lat.between(south, north), GeoKindergarten.lng.between(west, east))
    )
    grouped: dict[tuple[str, date, str], dict[str, Any]] = {}
    laws: dict[tuple[str, date, str], set[str]] = defaultdict(set)
    for penalty, school in rows.all():
        distance = haversine_m(lat, lng, school.lat, school.lng)
        if distance > NOTICE_RADIUS_KM * 1000 or _is_own(school.lat, school.lng, own_points):
            continue
        key = (penalty.school_name, penalty.occurred_on, penalty.doc_no)
        grouped.setdefault(key, {"source_id": school.source_id, "distance_m": round(distance)})
        if penalty.law:
            laws[key].add(penalty.law)
    result = []
    for (name, day, doc_no), info in grouped.items():
        result.append(
            _Candidate(
                dedupe_suffix=f"penalty:{name}:{day.isoformat()}:{doc_no}",
                day=day,
                payload={
                    "radius_km": NOTICE_RADIUS_KM, "source_id": info["source_id"], "name": name, "occurred_on": day.isoformat(),
                    "doc_no": doc_no, "laws": sorted(laws[(name, day, doc_no)]), "distance_m": info["distance_m"],
                },
            )
        )
    return sorted(result, key=lambda item: (item.day, item.dedupe_suffix))


async def _recently_notified(db: AsyncSession, prefix: str, now: datetime) -> bool:
    row = await db.scalar(
        select(GeoChangeNotice.id)
        .where(
            GeoChangeNotice.dedupe_key.startswith(prefix, autoescape=True),
            GeoChangeNotice.notified.is_(True),
            GeoChangeNotice.created_at >= now - timedelta(days=REPEAT_GUARD_DAYS),
        )
        .limit(1)
    )
    return row is not None


async def check_change_notices(db: AsyncSession, *, today: date) -> int:
    """檢查並寫通知與記帳，只 flush，回傳這次寫了幾則通知。呼叫端 commit。"""
    now = datetime.now(timezone.utc)
    points = await matcher.campus_points(db)
    own_points = [(point.lat, point.lng) for point in points.values() if point.lat is not None and point.lng is not None]
    sent = 0
    for campus_key in CAMPUS_KEYS:
        point = points.get(campus_key)
        if point is None or point.lat is None or point.lng is None:
            continue  # 沒座標：不寫基準列，之後有座標的那一輪才是首輪
        groups = (
            (AREA_PROVIDER_CHANGE, await _change_candidates(db, campus_key, point.lat, point.lng, own_points, today)),
            (AREA_PENALTY, await _penalty_candidates(db, point.lat, point.lng, own_points)),
        )
        for kind, candidates in groups:
            baseline = await db.get(GeoChangeNoticeBaseline, (campus_key, kind))
            cutoff = today - timedelta(days=_FRESH_DAYS[kind])
            for candidate in candidates:
                repeated = (
                    candidate.repeat_prefix is not None and await _recently_notified(db, candidate.repeat_prefix, now)
                )
                notify = baseline is not None and candidate.day >= cutoff and not repeated
                inserted = await db.scalar(
                    pg_insert(GeoChangeNotice)
                    .values(
                        campus_key=campus_key, dedupe_key=f"{campus_key}:{candidate.dedupe_suffix}", kind=kind,
                        notified=notify, created_at=now,
                    )
                    .on_conflict_do_nothing(index_elements=["dedupe_key"])
                    .returning(GeoChangeNotice.id)
                )
                if inserted is not None and notify:
                    db.add(NotificationInboxItem(campus_key=campus_key, kind=kind, payload=candidate.payload, created_at=now))
                    sent += 1
            if baseline is None:
                await db.execute(
                    pg_insert(GeoChangeNoticeBaseline)
                    .values(campus_key=campus_key, kind=kind, established_at=now)
                    .on_conflict_do_nothing(index_elements=["campus_key", "kind"])
                )
    await db.flush()
    return sent


async def run_change_notices(session_factory: async_sessionmaker[AsyncSession], *, today: date) -> tuple[str, int]:
    """開一個 session、一個交易：寫通知與記帳一起 commit。失敗只記 log（含 traceback），不讓同步失敗。"""
    try:
        async with session_factory() as session:
            sent = await check_change_notices(session, today=today)
            await session.commit()
        return "updated", sent
    except Exception:  # noqa: BLE001
        logger.exception("附近園所異動與裁罰通知檢查失敗")
        return "failed", 0
