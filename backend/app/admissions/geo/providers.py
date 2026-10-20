"""幼兒園與托嬰的名單比對與異動紀錄（2026-10-14 規格 §3、§4、§5）。

同步下載到的名單不再「刪光重寫」，而是依 source_id 和資料表比對：
- 這次名單沒有、上次營業中的 → 標成停辦（is_active 假，列留著）並寫 closed 事件；
  幼兒園另有兩個例外（2026-10-15）：回補檔指定的依檔處理；同地址同設立日的另一筆在新名單上＝改名或換承辦，只下架；
- 這次有、上次是停辦的 → 重新營業；但 30 天內才寫了 closed 事件的，視為來源漏收，撤掉那筆事件、
  不寫 opened（P6）；
- 托嬰名單裡新出現的（資料表原本有列）→ opened 事件；幼兒園的新設看設立日（registered_on，讀的時候算），
  不靠事件——來源晚收錄的老園所不是新園（P3）；
- 幼兒園類型變了 → kind_changed 事件。舊的類型用這次同步當下的學年重算（P7）：準公共期間是學年區間，
  學年更替時沒改過資料的園所類型會自己變，直接比會冒出一批假異動；
  新舊都是私立基底且都有準公共期間時視為續約，不算（加入、退出、公立／非營利／私立之間的改變才算）。
回補檔裡更早停辦、資料表沒有或早已停辦的園所，每輪同步另由 apply_closure_backfill 補一列並補停辦事件（2026-10-20，
可重跑、SAVEPOINT 包住）；事件保留 72 個月。
資料表原本是空的（托嬰第一次）只建立基準，不寫任何事件（P8）。新名單營業中的數量比上次少太多視為
殘缺檔，不換版（P9）。事件靠唯一約束冪等；同一個交易做完，由呼叫端 commit。"""

from __future__ import annotations

import calendar
import logging
import math
from collections.abc import Callable, Mapping
from collections.abc import Set as AbstractSet
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.babycare import BabycareRow
from app.admissions.geo.closure_backfill import ClosureBackfill
from app.admissions.geo.kindergartens import KindergartenRow, kind_as_of
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.projection import haversine_m
from app.common.timezones import today_local

logger = logging.getLogger(__name__)

# 幼兒園、托嬰每 7 天看一次來源（P10）；門牌、人口維持 sync.REFRESH_AFTER 的 30 天。
PROVIDER_REFRESH_AFTER = timedelta(days=7)
CHANGE_WINDOW_MONTHS = 12  # 畫面與 API 看近 12 個月（P11）
EVENT_RETENTION_MONTHS = 72  # 事件保留 72 個月（六年）：停辦回補檔從 2022-08 起，畫面仍只看近 12 個月
REOPEN_CANCELS_CLOSURE = timedelta(days=30)  # P6
TRUNCATION_RATIO = 0.8  # P9
TRUNCATION_MIN_PREVIOUS = 20
SHRUNK_MESSAGE = "名單營業中的數量比上次少了兩成以上，疑似殘缺，未更新"
_METERS_PER_DEGREE = 111_320.0


class ProviderShrunk(RuntimeError):
    """新名單營業中的數量比上次少太多（P9）；訊息會原樣寫進 geo_dataset_status.last_error。"""


@dataclass(frozen=True)
class ChangeReport:
    active: int  # 這次名單裡營業中的數量
    opened: int = 0
    closed: int = 0
    kind_changed: int = 0
    cancelled_closures: int = 0  # 30 天內回來而撤掉的停辦事件
    renamed: int = 0  # 幼兒園改名或換承辦：下架、不寫停辦（2026-10-15）
    backfilled: int = 0  # 幼兒園依回補檔處理的下架（有日期的寫停辦事件，沒日期的只下架）


@dataclass(frozen=True)
class ProviderChange:
    """附近園所的一筆變化（API 的 items 就是這個）。date_basis：registered＝設立日、observed＝我們同步到的日期。"""

    provider: str
    source_id: str
    name: str
    kind: str
    change: str
    date: date
    date_basis: str
    distance_m: int
    old_kind: str | None
    new_kind: str | None


@dataclass(frozen=True)
class _Spec:
    provider: str  # geo_provider_events.provider
    model: type
    dataset: str  # geo_dataset_status.dataset
    new_row_is_event: bool  # 資料表已有列時，新出現的算 opened（托嬰）；幼兒園看設立日，不靠事件


# 一所要下架時的判斷（2026-10-15 規格 §4）：None＝一般停辦（寫在同步當天）；
# 否則 (計數名稱 "renamed"／"backfilled", 停辦事件的日期或 None＝只下架)。
Retire = Callable[[Any], tuple[str, date | None] | None]


_KINDERGARTEN = _Spec("kindergarten", GeoKindergarten, "kindergartens", False)
_BABYCARE = _Spec("babycare", GeoBabycare, "babycare", True)


def months_ago(day: date, months: int) -> date:
    """往前推 months 個月、同日；那個月沒有這一天（2/29、月底）取該月最後一天。"""
    index = day.year * 12 + (day.month - 1) - months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


async def _cancel_recent_closure(db: AsyncSession, provider: str, source_id: str, today: date) -> bool:
    """30 天內（含第 30 天）寫過的 closed 事件刪掉，回傳有沒有刪到東西（P6）。"""
    result = await db.execute(
        delete(GeoProviderEvent)
        .where(
            GeoProviderEvent.provider == provider,
            GeoProviderEvent.source_id == source_id,
            GeoProviderEvent.change == "closed",
            GeoProviderEvent.occurred_on >= today - REOPEN_CANCELS_CLOSURE,
        )
        .returning(GeoProviderEvent.id)
    )
    return result.first() is not None


async def _insert_events(db: AsyncSession, pending: list[dict]) -> dict[str, int]:
    """寫事件；同一天、同一所、同一種已經有就略過。回傳實際寫入的各種數量。"""
    if not pending:
        return {}
    result = await db.execute(
        pg_insert(GeoProviderEvent)
        .values(pending)
        .on_conflict_do_nothing(constraint="uq_geo_provider_events_once")
        .returning(GeoProviderEvent.change)
    )
    counts: dict[str, int] = {}
    for (change,) in result.all():
        counts[change] = counts.get(change, 0) + 1
    return counts


async def _apply(
    db: AsyncSession,
    spec: _Spec,
    incoming: dict[str, dict[str, Any]],
    *,
    synced_at: datetime,
    force: bool,
    kind_change: Callable[[Any, dict[str, Any]], tuple[str, str] | None] | None = None,
    retire: Retire | None = None,
) -> ChangeReport:
    today = today_local(synced_at)
    existing = {row.source_id: row for row in (await db.execute(select(spec.model))).scalars()}
    previous_active = sum(1 for row in existing.values() if row.is_active)
    if not force and previous_active >= TRUNCATION_MIN_PREVIOUS and len(incoming) < previous_active * TRUNCATION_RATIO:
        raise ProviderShrunk(SHRUNK_MESSAGE)
    had_rows = bool(existing)
    pending: list[dict] = []
    cancelled = 0

    def add_event(
        source_id: str, change: str, old: str | None = None, new: str | None = None, *, on: date | None = None
    ) -> None:
        pending.append(
            {
                "provider": spec.provider, "source_id": source_id, "change": change,
                "occurred_on": on or today, "old_value": old, "new_value": new,
            }
        )

    for source_id, values in incoming.items():
        row = existing.get(source_id)
        if row is None:
            db.add(spec.model(**values, is_active=True, synced_at=synced_at))
            if had_rows and spec.new_row_is_event:
                add_event(source_id, "opened")
            continue
        # 類型要在覆寫欄位之前比（要用舊列的準公共期間重算）。停辦中的列也比：回來時類型變了照寫。
        changed_kind = kind_change(row, values) if kind_change is not None else None
        reopened = not row.is_active
        for column, value in values.items():
            setattr(row, column, value)
        row.is_active = True
        row.synced_at = synced_at
        if reopened:
            if await _cancel_recent_closure(db, spec.provider, source_id, today):
                cancelled += 1
            else:
                add_event(source_id, "opened")
        if changed_kind is not None:
            add_event(source_id, "kind_changed", *changed_kind)
    retired = {"renamed": 0, "backfilled": 0}
    for source_id, row in existing.items():
        if row.is_active and source_id not in incoming:
            row.is_active = False
            decision = retire(row) if retire is not None else None
            if decision is None:
                add_event(source_id, "closed")
                continue
            counter, closed_on = decision
            retired[counter] += 1
            if closed_on is not None:
                add_event(source_id, "closed", on=closed_on)
    await db.flush()
    counts = await _insert_events(db, pending)
    await db.execute(
        delete(GeoProviderEvent).where(
            GeoProviderEvent.provider == spec.provider,
            GeoProviderEvent.occurred_on < months_ago(today, EVENT_RETENTION_MONTHS),
        )
    )
    status = await db.get(GeoDatasetStatus, spec.dataset, with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset=spec.dataset)
        db.add(status)
    # 版本日期照園方所在時區（台北）：UTC 日期在台北 00–08 點還是前一天。
    day = today.isoformat()
    status.active_version = day
    status.label = day
    status.synced_at = synced_at
    status.checked_at = synced_at
    status.last_error = None
    if status.baseline_on is None:
        status.baseline_on = today
    return ChangeReport(
        active=len(incoming),
        opened=counts.get("opened", 0),
        closed=counts.get("closed", 0),
        kind_changed=counts.get("kind_changed", 0),
        cancelled_closures=cancelled,
        renamed=retired["renamed"],
        backfilled=retired["backfilled"],
    )


async def apply_kindergartens(
    db: AsyncSession,
    rows: list[KindergartenRow],
    *,
    synced_at: datetime,
    school_year: int,
    force: bool = False,
    backfill: Mapping[str, ClosureBackfill] | None = None,
    listed_places: AbstractSet[tuple[str, date]] | None = None,
) -> ChangeReport:
    """幼兒園名單換新並記錄異動（不 commit）。school_year：這一輪解析名單用的學年，舊列的類型用它重算（P7）。
    backfill：回補檔（2026-10-15 規格 §5），只在某所這一輪要下架時查。listed_places：教育部名單上的（地址、設立日），
    新名稱還沒有座標、不在 rows 裡時也認得出改名（規格 §4）；rows 本身的（地址、設立日）一律算進去。"""

    private_base = ("private", "quasi_public")
    incoming = {row.source_id: asdict(row) for row in rows}
    same_place = {
        (values["address"], values["registered_on"]) for values in incoming.values() if values["registered_on"] is not None
    }
    same_place |= set(listed_places or ())

    def kind_change(old: GeoKindergarten, values: dict[str, Any]) -> tuple[str, str] | None:
        # 舊、新都是私立基底而且兩邊都有準公共期間：這是續約或換期間（例如 113-115 → 116-118），不是類型變動。
        # 否則高雄 735 所裡約 268 所「113-115」在 116 學年續約那一輪，三公里內會冒出一串假異動
        # （來源在學年更替前先公布 → 寫成「準公共 → 私立」，之後才公布 → 寫成「私立 → 準公共」，都是假的）。
        # 加入（舊列沒有期間）、退出（新期間為空）、公立／非營利／私立之間的改變，仍然照算。
        if (
            old.kind in private_base and values["kind"] in private_base
            and old.pre_public_period and values["pre_public_period"]
        ):
            return None
        before = kind_as_of(old.kind, old.pre_public_period, school_year)
        return (before, values["kind"]) if before != values["kind"] else None

    def retire(old: GeoKindergarten) -> tuple[str, date | None] | None:
        # 回補檔優先，其次同地址同設立日＝改名或換承辦（設立日不明不比），最後一般停辦。
        entry = (backfill or {}).get(old.source_id)
        if entry is not None:
            return ("renamed", None) if entry.reason == "renamed" else ("backfilled", entry.left_on)
        if old.registered_on is not None and (old.address, old.registered_on) in same_place:
            return ("renamed", None)
        return None

    return await _apply(
        db, _KINDERGARTEN, incoming,
        synced_at=synced_at, force=force, kind_change=kind_change, retire=retire,
    )


async def apply_closure_backfill(
    db: AsyncSession, backfill: Mapping[str, ClosureBackfill], *, synced_at: datetime | None = None
) -> int:
    """把回補檔裡「closed 且有 left_on」的停辦補進資料庫（2026-10-20 招生潛力第二、三波）；回傳新寫的事件數，不 commit。

    和 retire() 是兩條獨立的路：retire() 只在某所「這一輪才下架」時查檔，更早停辦的園所在表裡早已是停辦、
    甚至根本沒有那一列，只能靠這裡每輪檢查一次補上，所以可重跑：
    - 表裡沒有這一所 → 補一列停辦的（名稱、核定、座標、類型取自檔；地址、行政區檔裡沒有存空字串；
      類型沒填取 private，價格係數查不到收費時是中性的）。檔裡沒有座標就不補列、不寫事件（lat、lng 非空）；
    - 表裡已是停辦 → 只補事件；
    - 營業中的不碰，真的還在營業的交給 retire() 那條路處理；
    - 同一所已經有停辦事件（不論日期）就略過，免得先前一般停辦寫在同步當天、這裡又用檔裡的日期補第二筆；
    - 離開日比事件保留期還舊的略過（寫了下一輪也會被清掉）。
    renamed 與沒有日期的 closed 不寫事件。事件靠唯一約束冪等；新設不寫事件（維持 P3 讀設立日）。"""
    synced_at = synced_at or datetime.now(timezone.utc)
    oldest = months_ago(today_local(synced_at), EVENT_RETENTION_MONTHS)
    wanted = {
        source_id: entry for source_id, entry in backfill.items()
        if entry.reason == "closed" and entry.left_on is not None and entry.left_on >= oldest
    }
    if not wanted:
        return 0
    known = dict(
        (await db.execute(
            select(GeoKindergarten.source_id, GeoKindergarten.is_active).where(GeoKindergarten.source_id.in_(wanted))
        )).all()
    )
    recorded = set(
        (await db.execute(
            select(GeoProviderEvent.source_id).where(
                GeoProviderEvent.provider == _KINDERGARTEN.provider,
                GeoProviderEvent.change == "closed",
                GeoProviderEvent.source_id.in_(wanted),
            )
        )).scalars()
    )
    new_rows: list[dict] = []
    pending: list[dict] = []
    for source_id, entry in wanted.items():
        if known.get(source_id) or source_id in recorded:
            continue
        if source_id not in known:
            if entry.lat is None or entry.lng is None:
                continue
            new_rows.append(
                {
                    "source_id": source_id, "name": entry.name, "kind": entry.kind or "private", "district": "",
                    "address": "", "lat": entry.lat, "lng": entry.lng, "approved_capacity": entry.approved_capacity,
                    "has_penalty": False, "is_active": False, "synced_at": synced_at,
                }
            )
        pending.append(
            {
                "provider": _KINDERGARTEN.provider, "source_id": source_id, "change": "closed",
                "occurred_on": entry.left_on, "old_value": None, "new_value": None,
            }
        )
    if new_rows:
        await db.execute(pg_insert(GeoKindergarten).values(new_rows).on_conflict_do_nothing(index_elements=["source_id"]))
    return (await _insert_events(db, pending)).get("closed", 0)


async def safe_apply_closure_backfill(
    db: AsyncSession, backfill: Mapping[str, ClosureBackfill], *, synced_at: datetime | None = None
) -> int:
    """apply_closure_backfill 包 SAVEPOINT：失敗只退回自己、記 warning 並回 0，不拖累同一個交易裡的名單同步
    （比照 september.safe_backfill；回補是附加資料，下一輪同步會再補）。"""
    try:
        async with db.begin_nested():
            return await apply_closure_backfill(db, backfill, synced_at=synced_at)
    except Exception:  # noqa: BLE001 - 附加資料失敗不擋名單同步
        logger.warning("幼兒園停辦回補寫入失敗，名單照常更新，下一輪再補", exc_info=True)
        return 0


async def apply_babycare(
    db: AsyncSession, rows: list[BabycareRow], *, synced_at: datetime, force: bool = False
) -> ChangeReport:
    """托嬰名單換新並記錄異動（不 commit）。"""
    return await _apply(db, _BABYCARE, {row.source_id: asdict(row) for row in rows}, synced_at=synced_at, force=force)


def _box(lat: float, lng: float, radius_m: int) -> tuple[float, float, float, float]:
    """經緯度方框（先用索引篩，再算大圓距離）：(南, 北, 西, 東)。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


async def nearby_changes(
    db: AsyncSession, lat: float, lng: float, radius_m: int, *, today: date
) -> list[ProviderChange]:
    """半徑內近 12 個月的變化（規格 §5）：事件＋幼兒園的設立日新設。同一所同一種只留一筆，設立日優先；
    依日期新到舊、距離近到遠、名稱排序。停辦的園所不在 nearby 清單裡，這裡 join 對應的園所表取名稱與座標。"""
    since = months_ago(today, CHANGE_WINDOW_MONTHS)
    south, north, west, east = _box(lat, lng, radius_m)
    found: dict[tuple[str, str, str], ProviderChange] = {}
    for provider, model in (("kindergarten", GeoKindergarten), ("babycare", GeoBabycare)):
        result = await db.execute(
            select(GeoProviderEvent, model)
            .join(model, model.source_id == GeoProviderEvent.source_id)
            .where(
                GeoProviderEvent.provider == provider,
                GeoProviderEvent.occurred_on >= since,
                GeoProviderEvent.occurred_on <= today,
                model.lat.between(south, north),
                model.lng.between(west, east),
            )
            .order_by(GeoProviderEvent.occurred_on)  # 同一所同一種有好幾天時，最近的蓋掉較早的
        )
        for event, row in result.all():
            distance = haversine_m(lat, lng, row.lat, row.lng)
            if distance > radius_m:
                continue
            kind_changed = event.change == "kind_changed"
            # 停辦列的 kind 是「最後一次同步寫入的值」：幼兒園停辦後經過學年更替、準公共期間過期時不會再重算，可能已過期。
            # 目前畫面不讀這個欄位（只用名稱與新舊類型），所以無害；日後若要顯示幼兒園停辦列的類型，要改用
            # kind_as_of(row.kind, row.pre_public_period, 目前學年)。
            found[(provider, row.source_id, event.change)] = ProviderChange(
                provider=provider, source_id=row.source_id, name=row.name, kind=row.kind, change=event.change,
                date=event.occurred_on, date_basis="observed", distance_m=round(distance),
                old_kind=event.old_value if kind_changed else None,
                new_kind=event.new_value if kind_changed else None,
            )
    registered = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.registered_on >= since,
            GeoKindergarten.registered_on <= today,  # 來源把設立日打成未來不算新設
            GeoKindergarten.lat.between(south, north),
            GeoKindergarten.lng.between(west, east),
        )
    )
    for row in registered.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        found[("kindergarten", row.source_id, "opened")] = ProviderChange(
            provider="kindergarten", source_id=row.source_id, name=row.name, kind=row.kind, change="opened",
            date=row.registered_on, date_basis="registered", distance_m=round(distance), old_kind=None, new_kind=None,
        )
    return sorted(found.values(), key=lambda item: (-item.date.toordinal(), item.distance_m, item.name))
