"""預約全程漏斗與退出時點（2026-10-15 預約全程規格 §3）。

預約案件 → 到場 → 有招生訪視 → 預繳 → 註冊，以及家庭離開的時點。本檔分兩層：
- `compute_journey` 只吃整理好的案件列（`CaseInfo`／`VisitInfo`，日期都是台北日），純函式、不碰資料庫；
- 查庫與整理案件列在檔案後半（`query_journey`）。
一批家庭＝預定參觀日落在期間內、已過參觀時間的預約案件，一案一筆；所有階段都從同一批往下數，所以數字
只會遞減。只描述過去，不預測。標記排除的測試／重複案件（booking/exclusion.py）不進批次，筆數另放 coverage.excluded_cases。"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from statistics import median
from typing import Any

from sqlalchemy import Date, and_, cast, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.admissions.stats import COLD_LEAD_DAYS, DEFAULT_OVERDUE_DAYS, pct
from app.booking import exclusion
from app.booking.models import VisitRequest, VisitRequestEvent, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, now_utc, today_local
from app.operations.booking_outcomes_service import _outcome  # 與「預約結果」同一份分類（計畫裁定 P4）

SOURCES = ("web", "phone", "line", "walk_in", "external")
# 預約結果的四類（尚未到參觀時間的 upcoming 在查庫時就丟掉，不會進來）。
OUTCOMES = ("completed", "no_show", "cancelled", "awaiting_attendance")
CANCEL_GROUPS = ("parent", "staff", "other")
# 取消日距預定參觀日：after_visit＝參觀日之後才取消（園方事後取消）。
CANCEL_BUCKETS = ("after_visit", "same_day", "day_1", "days_2_3", "days_4_7", "days_8_plus")


@dataclass(frozen=True)
class VisitInfo:
    """連到預約的招生訪視。日期都是台北日；deposit_on 是最後一筆 deposit_added 的台北日（沒有事件是 None）。"""

    visit_date: date
    has_deposit: bool
    enrolled: bool
    enrolled_on: date | None
    withdrawn_on: date | None
    withdrawn_from: str | None
    deposit_on: date | None

    @property
    def deposited(self) -> bool:
        # 預繳過：目前已預繳、已註冊、或已退出（退出的一定預繳過；註冊的一定預繳過，舊資料可能沒有旗標）。
        return self.has_deposit or self.enrolled or self.withdrawn_on is not None

    @property
    def ever_enrolled(self) -> bool:
        return self.enrolled or self.withdrawn_from == "enrolled"


@dataclass(frozen=True)
class CaseInfo:
    source: str
    outcome: str
    created_on: date
    visited_on: date
    cancelled_on: date | None
    cancel_reason: str | None
    rescheduled: bool
    visit: VisitInfo | None


def _rate(key: str, numerator: int, denominator: int) -> dict[str, Any]:
    return {"key": key, "numerator": numerator, "denominator": denominator, "pct": pct(numerator, denominator)}


def _days(values: list[int], excluded: int) -> dict[str, Any]:
    return {"median": round(float(median(values)), 1) if values else None, "n": len(values), "excluded": excluded}


def _cancel_bucket(days_before: int) -> str:
    if days_before < 0:
        return "after_visit"
    if days_before == 0:
        return "same_day"
    if days_before == 1:
        return "day_1"
    if days_before <= 3:
        return "days_2_3"
    if days_before <= 7:
        return "days_4_7"
    return "days_8_plus"


def _gap(start: date | None, end: date | None, values: list[int]) -> bool:
    """end − start 的天數加進 values；缺日期或負值回 True（呼叫端記成「不納入」）。"""
    if start is None or end is None:
        return True
    days = (end - start).days
    if days < 0:
        return True
    values.append(days)
    return False


def compute_journey(
    cases: list[CaseInfo], *, today: date, visits_without_request: int, undated_cases: int, excluded_cases: int = 0
) -> dict[str, Any]:
    by_source = dict.fromkeys(SOURCES, 0)
    outcomes = dict.fromkeys(OUTCOMES, 0)
    cancelled = dict.fromkeys(CANCEL_GROUPS, 0)
    waiting = {"observing": 0, "overdue": 0, "cold": 0}
    withdrawn = {"from_deposit": 0, "from_enrolled": 0}
    with_visit = deposited = enrolled = without_visit = rescheduled = 0
    lead: list[int] = []
    lead_excluded = 0
    cancel_counts = {group: dict.fromkeys(CANCEL_BUCKETS, 0) for group in CANCEL_GROUPS}
    cancel_n = cancel_excluded = 0
    to_deposit: list[int] = []
    to_deposit_excluded = 0
    to_enrolled: list[int] = []
    to_enrolled_excluded = 0
    to_withdrawn: list[int] = []
    to_withdrawn_excluded = 0

    for item in cases:
        if item.outcome not in outcomes:
            raise ValueError(f"不認得的預約結果：{item.outcome}")
        by_source[item.source] = by_source.get(item.source, 0) + 1
        outcomes[item.outcome] += 1
        if item.rescheduled:
            rescheduled += 1
        lead_excluded += _gap(item.created_on, item.visited_on, lead)
        if item.outcome == "cancelled":
            group = item.cancel_reason if item.cancel_reason in ("parent", "staff") else "other"
            cancelled[group] += 1
            if item.cancelled_on is None:
                cancel_excluded += 1
            else:
                cancel_counts[group][_cancel_bucket((item.visited_on - item.cancelled_on).days)] += 1
                cancel_n += 1
        if item.outcome != "completed":
            continue
        found = item.visit
        if found is None:
            without_visit += 1
            continue
        with_visit += 1
        if found.deposited:
            deposited += 1
            to_deposit_excluded += _gap(found.visit_date, found.deposit_on, to_deposit)
        else:
            age = (today - found.visit_date).days
            waiting["cold" if age >= COLD_LEAD_DAYS else "overdue" if age >= DEFAULT_OVERDUE_DAYS else "observing"] += 1
        if found.ever_enrolled:
            enrolled += 1
            to_enrolled_excluded += _gap(found.deposit_on, found.enrolled_on, to_enrolled)
        if found.withdrawn_on is not None:
            withdrawn["from_enrolled" if found.withdrawn_from == "enrolled" else "from_deposit"] += 1
            to_withdrawn_excluded += _gap(found.deposit_on, found.withdrawn_on, to_withdrawn)

    total = len(cases)
    marked = outcomes["completed"] + outcomes["no_show"]
    withdrawn_total = withdrawn["from_deposit"] + withdrawn["from_enrolled"]
    return {
        "cases": {"total": total, "by_source": by_source},
        "visit_outcomes": {
            "completed": outcomes["completed"],
            "no_show": outcomes["no_show"],
            "cancelled": {"total": outcomes["cancelled"], **cancelled},
            "unmarked": outcomes["awaiting_attendance"],
        },
        "admissions": {
            "with_visit": with_visit,
            "completed_without_visit": without_visit,
            "deposited": deposited,
            "enrolled": enrolled,
            "withdrawn": {"total": withdrawn_total, **withdrawn},
            "not_deposited": waiting,
        },
        "rates": [
            _rate("attendance", outcomes["completed"], marked),
            _rate("cancel", outcomes["cancelled"], total),
            _rate("with_visit", with_visit, outcomes["completed"]),
            _rate("deposit", deposited, with_visit),
            _rate("enrolled", enrolled, deposited),
            _rate("withdrawn", withdrawn_total, deposited),
        ],
        "timing": {
            "lead_days": _days(lead, lead_excluded),
            "cancel_before_visit": {"n": cancel_n, "excluded": cancel_excluded, **cancel_counts},
            "visit_to_deposit": _days(to_deposit, to_deposit_excluded),
            "deposit_to_enrolled": _days(to_enrolled, to_enrolled_excluded),
            "deposit_to_withdrawn": _days(to_withdrawn, to_withdrawn_excluded),
        },
        "rescheduled": {"cases": rescheduled, "total": total},
        "coverage": {
            "visits_without_request": visits_without_request,
            "completed_without_visit": without_visit,
            "undated_cases": undated_cases,
            # 標記排除的測試／重複案件（不是各段天數裡「不納入」的 excluded）。
            "excluded_cases": excluded_cases,
        },
    }


CHUNK = 1000


def _taipei_day(column):
    return cast(func.timezone(OPERATING_TZ.key, column), Date)


def _chunks(items: list[uuid.UUID]):
    for start in range(0, len(items), CHUNK):
        yield items[start : start + CHUNK]


def _visited_on():
    """預定參觀日：同單案列表（booking/routes.py `_visited_on_column`）。有場次用場次日期；提早到場、約之後日子
    的案件釋出了場次，沒有場次、而且已完成，改取最後一筆 completed 歷程的台北日；其餘是 None。"""
    slot_date = (
        select(VisitSlot.slot_date).where(VisitSlot.id == VisitRequest.slot_id).correlate(VisitRequest).scalar_subquery()
    )
    completed_on = (
        select(func.max(_taipei_day(VisitRequestEvent.created_at)))
        .where(
            VisitRequestEvent.visit_request_id == VisitRequest.id,
            VisitRequestEvent.event_type == "completed",
            VisitRequest.status == VisitRequestStatus.COMPLETED.value,
        )
        .correlate(VisitRequest)
        .scalar_subquery()
    )
    return func.coalesce(slot_date, completed_on)


def _slot_not_started(now: datetime):
    """案件的場次還沒開始（台北現在之後）。已取消的案件 `_outcome` 一律歸 cancelled、不會變 upcoming，
    今天稍晚的場次被取消時要靠這個條件擋在批次外（J3：已過參觀時間才進批次）。"""
    local = now.astimezone(OPERATING_TZ)
    return exists().where(
        VisitSlot.id == VisitRequest.slot_id,
        or_(
            VisitSlot.slot_date > local.date(),
            and_(VisitSlot.slot_date == local.date(), VisitSlot.start_time > local.time().replace(tzinfo=None)),
        ),
    ).correlate(VisitRequest)


async def load_cases(
    db: AsyncSession, campus_key: str, date_from: date, date_to: date, source: str, now: datetime
) -> tuple[list[CaseInfo], int, int]:
    """批次案件（含連到的招生訪視）、「預定參觀日算不出來」的筆數（P2：以送出日在期間內計入）與批次內
    已排除的筆數（2026-10-15）。"""
    visited_on = _visited_on()
    created_on = _taipei_day(VisitRequest.created_at)
    rescheduled = exists().where(
        VisitRequestEvent.visit_request_id == VisitRequest.id, VisitRequestEvent.event_type == "rescheduled"
    ).correlate(VisitRequest)
    stmt = select(
        VisitRequest.id,
        VisitRequest.source,
        _outcome(now).label("outcome"),
        created_on.label("created_on"),
        _taipei_day(VisitRequest.cancelled_at).label("cancelled_on"),
        VisitRequest.cancel_reason,
        visited_on.label("visited_on"),
        rescheduled.label("rescheduled"),
        _slot_not_started(now).label("not_started"),
        exclusion.excluded().label("excluded"),
    ).where(
        VisitRequest.campus_key == campus_key,
        or_(visited_on.between(date_from, date_to), and_(visited_on.is_(None), created_on.between(date_from, date_to))),
    )
    if source == "web":
        stmt = stmt.where(VisitRequest.source == "web")
    elif source == "assisted":
        stmt = stmt.where(VisitRequest.source != "web")
    rows = (await db.execute(stmt)).all()

    # 還沒到參觀時間的不進批次：還沒結案的（upcoming），以及場次還沒開始就取消的。
    rows = [row for row in rows if row.outcome != "upcoming" and not (row.outcome == "cancelled" and row.not_started)]
    # 排除的測試／重複案件（2026-10-15）不進批次，另回筆數給涵蓋說明（計畫裁定 P11：和各段天數的 excluded 不同）。
    # 在上面的批次篩選之後才數：本來就不在批次的（還沒結案、場次沒開始就取消）不算；預定參觀日算不出來的算。
    excluded_cases = sum(1 for row in rows if row.excluded)
    rows = [row for row in rows if not row.excluded]
    undated = sum(1 for row in rows if row.visited_on is None)
    kept = [row for row in rows if row.visited_on is not None]
    completed_ids = [row.id for row in kept if row.outcome == "completed"]
    visits = await _load_visits(db, completed_ids)
    cases = [
        CaseInfo(
            source=row.source, outcome=row.outcome, created_on=row.created_on, visited_on=row.visited_on,
            cancelled_on=row.cancelled_on, cancel_reason=row.cancel_reason, rescheduled=bool(row.rescheduled),
            visit=visits.get(row.id),
        )
        for row in kept
    ]
    return cases, undated, excluded_cases


async def _load_visits(db: AsyncSession, request_ids: list[uuid.UUID]) -> dict[uuid.UUID, VisitInfo]:
    """連到這些預約的招生訪視；預繳日＝最後一筆 deposit_added 的台北日（同預繳速度，已匿名化的照算）。"""
    v, e = RecruitmentVisit, RecruitmentEventLog
    found: dict[uuid.UUID, VisitInfo] = {}
    for chunk in _chunks(request_ids):
        last_deposit = (
            select(e.recruitment_visit_id.label("visit_id"), func.max(e.created_at).label("deposit_at"))
            .join(v, v.id == e.recruitment_visit_id)
            .where(e.event_type == "deposit_added", v.visit_request_id.in_(chunk))
            .group_by(e.recruitment_visit_id)
            .subquery()
        )
        rows = await db.execute(
            select(
                v.visit_request_id, v.visit_date, v.has_deposit, v.enrolled, v.enrolled_on, v.withdrawn_at,
                v.withdrawn_from, last_deposit.c.deposit_at,
            )
            .select_from(v)
            .outerjoin(last_deposit, last_deposit.c.visit_id == v.id)
            .where(v.visit_request_id.in_(chunk))
        )
        for row in rows.all():
            found[row.visit_request_id] = VisitInfo(
                visit_date=row.visit_date,
                has_deposit=row.has_deposit,
                enrolled=row.enrolled,
                enrolled_on=row.enrolled_on,
                withdrawn_on=row.withdrawn_at.astimezone(OPERATING_TZ).date() if row.withdrawn_at is not None else None,
                withdrawn_from=row.withdrawn_from,
                deposit_on=row.deposit_at.astimezone(OPERATING_TZ).date() if row.deposit_at is not None else None,
            )
    return found


async def count_visits_without_request(db: AsyncSession, campus_key: str, date_from: date, date_to: date) -> int:
    """期間內（參觀日）沒有預約案件的招生訪視：手動新增的現場參觀、舊名單補登、連結被刪的。"""
    v = RecruitmentVisit
    return int(
        await db.scalar(
            select(func.count())
            .select_from(v)
            .where(v.campus_key == campus_key, v.visit_request_id.is_(None), v.visit_date.between(date_from, date_to))
        )
        or 0
    )


async def query_journey(
    db: AsyncSession, campus_key: str, date_from: date, date_to: date, source: str, now: datetime | None = None
) -> dict[str, Any]:
    """唯讀：不 flush、不 commit。date_from／date_to 是台北日（含），呼叫端已驗證並把 date_to 截到今天。"""
    current = now or now_utc()
    cases, undated, excluded_cases = await load_cases(db, campus_key, date_from, date_to, source, current)
    without_request = await count_visits_without_request(db, campus_key, date_from, date_to)
    result = compute_journey(
        cases,
        today=today_local(current),
        visits_without_request=without_request,
        undated_cases=undated,
        excluded_cases=excluded_cases,
    )
    return {
        "filters": {"campus_key": campus_key, "date_from": date_from, "date_to": date_to, "source": source},
        "as_of": current,
        **result,
    }
