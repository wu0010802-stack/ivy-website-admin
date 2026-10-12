"""幼兒園公開資料：kiang 整理的全國教保資訊網 preschools.json（規格 §4、§5.2）。

只留高雄市、營業中（is_active＝1）的園所；不存負責人姓名（owner），也不讀
punish_all.json（以行為人姓名為鍵）。類型對照：公立→public、非營利→nonprofit、
私立且 pre_public 學年區間涵蓋目前學年→quasi_public、其餘私立→private。月費是
kiang 依收費明細估算的值，畫面上要標「估」。kiang 的資料有一筆座標是字串，一律轉 float。

高雄市營業中的園所若缺必要欄位、欄位超過資料表欄寬、座標不是有限數或不在高雄市外框內、
source_id 重複，整筆略過並計入 ParseReport.skipped（高雄市以外、停業的本來就不要，不算）；
不讓一筆壞資料使整批寫入失敗。數量欄位（核定人數、月費）超出 int4 當成未知。"""

from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from datetime import datetime

from sqlalchemy import delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kaohsiung import in_kaohsiung
from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten
from app.admissions.geo.projection import haversine_m
from app.common.timezones import today_local

SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），月費為估計值"
_KIND_BY_TYPE = {"公立": "public", "非營利": "nonprofit", "私立": "private"}
_PRE_PUBLIC = re.compile(r"(\d{3})-(\d{3})")
_POSTAL_PREFIX = re.compile(r"^\[\d+\]")
_METERS_PER_DEGREE = 111_320.0
_INT4_MAX = 2_147_483_647
# 文字欄位上限，以資料表欄寬為準。
_WIDTHS = {
    name: GeoKindergarten.__table__.c[name].type.length
    for name in ("source_id", "reg_no", "name", "pre_public_period", "district", "address", "phone")
}


class KindergartenFormatError(ValueError):
    """preschools.json 不是預期的格式（或一所高雄市營業中的園所都沒有）。"""


@dataclass
class ParseReport:
    """parse_preschools 的略過數（給同步摘要用）。"""

    skipped: int = 0


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
    """數量欄位 → 整數；不是數字、不是有限數、超出 int4（寫入會失敗）都是 None。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        number = value
    else:
        try:
            parsed = value if isinstance(value, float) else float(re.sub(r"[,\s]", "", str(value or "")))
        except ValueError:
            return None
        if not math.isfinite(parsed):
            return None
        number = int(round(parsed))
    return number if -_INT4_MAX <= number <= _INT4_MAX else None


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


def parse_preschools(data: dict, *, school_year: int, report: ParseReport | None = None) -> list[KindergartenRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise KindergartenFormatError("幼兒園資料不是 GeoJSON FeatureCollection")
    report = report if report is not None else ParseReport()
    rows: list[KindergartenRow] = []
    seen: set[str] = set()
    for feature in features:
        props = (feature.get("properties") or {}) if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            report.skipped += 1
            continue
        if str(props.get("city") or "").replace("臺", "台") != "高雄市" or str(props.get("is_active")) != "1":
            continue
        row = _row(feature, props, school_year)
        if row is None or row.source_id in seen:
            report.skipped += 1
            continue
        seen.add(row.source_id)
        rows.append(row)
    if not rows:
        raise KindergartenFormatError("幼兒園資料裡沒有高雄市營業中的園所")
    return rows


def _row(feature: dict, props: dict, school_year: int) -> KindergartenRow | None:
    """一筆高雄市營業中的園所 → 資料列；缺必要欄位、欄位放不進資料表、座標不合格回 None。"""
    try:
        lng, lat = (float(value) for value in feature["geometry"]["coordinates"][:2])
    except (KeyError, TypeError, ValueError):
        return None
    if not in_kaohsiung(lat, lng):
        return None
    pre_public = _text_or_none(props.get("pre_public"))
    pre_public = None if pre_public == "無" else pre_public
    kind = _kind(str(props.get("type") or ""), pre_public, school_year)
    source_id = _text_or_none(props.get("id"))
    name = _text_or_none(props.get("title"))
    if kind is None or source_id is None or name is None:
        return None
    row = KindergartenRow(
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
    if any(len(getattr(row, column) or "") > width for column, width in _WIDTHS.items()):
        return None
    return row


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
    # 版本日期照園方所在時區（台北）：UTC 日期在台北 00–08 點還是前一天。
    day = today_local(synced_at).isoformat()
    status.active_version = day
    status.label = day
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
