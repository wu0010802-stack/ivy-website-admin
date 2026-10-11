"""幼兒園公開資料：kiang 整理的全國教保資訊網 preschools.json（規格 §4、§5.2）。

只留高雄市、營業中（is_active＝1）的園所；不存負責人姓名（owner），也不讀
punish_all.json（以行為人姓名為鍵）。類型對照：公立→public、非營利→nonprofit、
私立且 pre_public 學年區間涵蓋目前學年→quasi_public、其餘私立→private。月費是
kiang 依收費明細估算的值，畫面上要標「估」。kiang 的資料有一筆座標是字串，一律轉 float。"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten
from app.admissions.geo.projection import haversine_m

SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），月費為估計值"
_KIND_BY_TYPE = {"公立": "public", "非營利": "nonprofit", "私立": "private"}
_PRE_PUBLIC = re.compile(r"(\d{3})-(\d{3})")
_POSTAL_PREFIX = re.compile(r"^\[\d+\]")
_METERS_PER_DEGREE = 111_320.0


class KindergartenFormatError(ValueError):
    """preschools.json 不是預期的格式（或一所高雄市營業中的園所都沒有）。"""


@dataclass(frozen=True)
class KindergartenRow:
    source_id: str
    reg_no: str | None
    name: str
    kind: str
    pre_public_period: str | None
    district: str
    address: str
    lat: float
    lng: float
    approved_capacity: int | None
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None


@dataclass(frozen=True)
class NearbyKindergarten:
    source_id: str
    name: str
    kind: str
    pre_public_period: str | None
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None


def _int_or_none(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value)) if math.isfinite(value) else None
    try:
        number = float(re.sub(r"[,\s]", "", str(value or "")))
    except ValueError:
        return None
    return int(round(number)) if math.isfinite(number) else None


def _text_or_none(value: object) -> str | None:
    cleaned = str(value or "").strip()
    return cleaned or None


def _kind(type_name: str, pre_public: str | None, school_year: int) -> str | None:
    kind = _KIND_BY_TYPE.get(type_name)
    if kind == "private" and pre_public:
        matched = _PRE_PUBLIC.fullmatch(pre_public)
        if matched and int(matched.group(1)) <= school_year <= int(matched.group(2)):
            return "quasi_public"
    return kind


def parse_preschools(data: dict, *, school_year: int) -> list[KindergartenRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise KindergartenFormatError("幼兒園資料不是 GeoJSON FeatureCollection")
    rows: list[KindergartenRow] = []
    for feature in features:
        props = feature.get("properties") or {}
        if str(props.get("city") or "").replace("臺", "台") != "高雄市" or str(props.get("is_active")) != "1":
            continue
        try:
            lng, lat = (float(value) for value in feature["geometry"]["coordinates"][:2])
        except (KeyError, TypeError, ValueError):
            continue
        pre_public = _text_or_none(props.get("pre_public"))
        pre_public = None if pre_public == "無" else pre_public
        kind = _kind(str(props.get("type") or ""), pre_public, school_year)
        source_id = _text_or_none(props.get("id"))
        name = _text_or_none(props.get("title"))
        if kind is None or source_id is None or name is None:
            continue
        rows.append(
            KindergartenRow(
                source_id=source_id,
                reg_no=_text_or_none(props.get("reg_no")),
                name=name,
                kind=kind,
                pre_public_period=pre_public,
                district=str(props.get("town") or "").strip(),
                address=_POSTAL_PREFIX.sub("", str(props.get("address") or "").strip()),
                lat=lat,
                lng=lng,
                approved_capacity=_int_or_none(props.get("count_approved")),
                monthly_fee_estimate=_int_or_none(props.get("monthly")),
                has_penalty=str(props.get("penalty") or "") == "有",
                phone=_text_or_none(props.get("tel")),
            )
        )
    if not rows:
        raise KindergartenFormatError("幼兒園資料裡沒有高雄市營業中的園所")
    return rows


async def replace_kindergartens(db: AsyncSession, rows: list[KindergartenRow], *, synced_at: datetime) -> int:
    """整批換新並更新狀態列（不 commit）。約 700 筆，一個交易做完。"""
    await db.execute(delete(GeoKindergarten))
    await db.execute(
        insert(GeoKindergarten),
        [{**asdict(row), "is_active": True, "synced_at": synced_at} for row in rows],
    )
    status = await db.get(GeoDatasetStatus, "kindergartens", with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset="kindergartens")
        db.add(status)
    status.active_version = synced_at.date().isoformat()
    status.label = synced_at.date().isoformat()
    status.synced_at = synced_at
    status.checked_at = synced_at
    status.last_error = None
    return len(rows)


async def nearby(db: AsyncSession, lat: float, lng: float, radius_m: int) -> list[NearbyKindergarten]:
    """半徑 radius_m 內的營業中園所，依距離（公尺，四捨五入）、名稱排序。先用經緯度
    方框篩，再算大圓距離。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.lat.between(lat - dlat, lat + dlat),
            GeoKindergarten.lng.between(lng - dlng, lng + dlng),
        )
    )
    items: list[NearbyKindergarten] = []
    for row in result.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        items.append(
            NearbyKindergarten(
                source_id=row.source_id,
                name=row.name,
                kind=row.kind,
                pre_public_period=row.pre_public_period,
                address=row.address,
                lat=row.lat,
                lng=row.lng,
                distance_m=round(distance),
                approved_capacity=row.approved_capacity,
                monthly_fee_estimate=row.monthly_fee_estimate,
                has_penalty=row.has_penalty,
                phone=row.phone,
            )
        )
    items.sort(key=lambda item: (item.distance_m, item.name))
    return items
