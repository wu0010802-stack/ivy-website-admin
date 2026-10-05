"""成效統計的「預約結果」（2026-09-30 招生分析報告第 3、4 節，階段 1）。

- 計數單位是預約案件數：同一個孩子預約兩校算兩筆，同一支電話不合併（3.1）。
- 期間依案件的送出時間（created_at，台北日界線、兩端都含）切，是「同批案件」的口徑；
  漏斗（analytics_service.get_campus_funnel）依事件發生日期計數，兩邊不能互相相除（3.2）。
- 到場率＝已到場 ÷（已到場＋未到場）。參觀時間已過但還沒標記的另列
  awaiting_attendance，不算進分母，也不當成到場（3.2：不能用預定日期已過判定已到場）。
- 待處理兩種（open_now）是現在的狀態，不受期間影響，條件在 booking/pending_kinds.py，
  和總覽、案件列表同一份。
- 不回傳任何個資；只有 analytics.read 的角色也能看。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic
from app.admissions.constants import GRADES
from app.admissions.stats import pct
from app.booking import pending_kinds
from app.booking.models import BookingConfig, VisitRequest, VisitRequestSource, VisitRequestStatus
from app.campuses.models import Campus
from app.common.timezones import now_utc
from app.operations.analytics_service import UNKNOWN, FunnelRange
from app.operations.models import CANCEL_REASONS

# 每筆案件剛好落在其中一種，加總＝cases。unscheduled：還沒結案卻沒有場次的舊流程資料。
OUTCOMES = ("upcoming", "awaiting_attendance", "completed", "no_show", "cancelled", "unscheduled")
CANCEL_REASON_KEYS = (*CANCEL_REASONS, UNKNOWN)


def _rate(numerator: int, denominator: int) -> dict:
    return {"value": pct(numerator, denominator), "numerator": numerator, "denominator": denominator}


def _outcome(now: datetime):
    status = VisitRequest.status
    return case(
        (status == VisitRequestStatus.CANCELLED.value, literal("cancelled")),
        (status == VisitRequestStatus.COMPLETED.value, literal("completed")),
        (status == VisitRequestStatus.NO_SHOW.value, literal("no_show")),
        (VisitRequest.slot_id.is_(None), literal("unscheduled")),
        (pending_kinds.condition("awaiting_attendance", now), literal("awaiting_attendance")),
        else_=literal("upcoming"),
    )


def _empty_counts() -> dict:
    return {
        "cases": 0,
        "web_cases": 0,
        **{outcome: 0 for outcome in OUTCOMES},
        "cancelled_by_reason": {reason: 0 for reason in CANCEL_REASON_KEYS},
    }


def _with_rates(counts: dict) -> dict:
    marked = counts["completed"] + counts["no_show"]
    return {
        **counts,
        "attendance_rate": _rate(counts["completed"], marked),
        "no_show_rate": _rate(counts["no_show"], marked),
        "cancel_rate": _rate(counts["cancelled"], counts["cases"]),
    }


def _add_into(total: dict, counts: dict) -> None:
    for key in ("cases", "web_cases", *OUTCOMES):
        total[key] += counts[key]
    for reason, value in counts["cancelled_by_reason"].items():
        total["cancelled_by_reason"][reason] += value


async def booking_outcomes(
    db: AsyncSession, campus_keys: list[str], period: FunnelRange, now: datetime | None = None
) -> dict:
    """campus_keys 由呼叫端依權限決定（照 CAMPUS_KEYS 的順序），每校一列。"""
    current = now or now_utc()

    # 先在子查詢算出每筆的結果再分組：CASE 裡的參數（時間、字串）若在 SELECT 與
    # GROUP BY 各綁一次，PostgreSQL 會當成兩個不同的式子而報錯。
    per_case = (
        select(
            VisitRequest.campus_key.label("campus_key"),
            _outcome(current).label("outcome"),
            VisitRequest.cancel_reason.label("cancel_reason"),
            (VisitRequest.source == VisitRequestSource.WEB.value).label("is_web"),
        )
        .where(VisitRequest.campus_key.in_(campus_keys), *period.on(VisitRequest.created_at))
        .subquery()
    )
    rows = (
        await db.execute(
            select(per_case.c.campus_key, per_case.c.outcome, per_case.c.cancel_reason, per_case.c.is_web, func.count())
            .group_by(per_case.c.campus_key, per_case.c.outcome, per_case.c.cancel_reason, per_case.c.is_web)
        )
    ).all()
    counts = {key: _empty_counts() for key in campus_keys}
    for campus_key, outcome, reason, is_web, count in rows:
        bucket = counts[campus_key]
        bucket["cases"] += count
        bucket[outcome] += count
        if is_web:
            bucket["web_cases"] += count
        if outcome == "cancelled":
            bucket["cancelled_by_reason"][reason if reason in CANCEL_REASONS else UNKNOWN] += count

    open_rows = (
        await db.execute(
            select(
                VisitRequest.campus_key,
                *[func.count().filter(pending_kinds.condition(kind, current)) for kind in pending_kinds.PENDING_KINDS],
            )
            .where(VisitRequest.campus_key.in_(campus_keys))
            .group_by(VisitRequest.campus_key)
        )
    ).all()
    open_now = {key: {kind: 0 for kind in pending_kinds.PENDING_KINDS} for key in campus_keys}
    for campus_key, *values in open_rows:
        open_now[campus_key] = dict(zip(pending_kinds.PENDING_KINDS, values, strict=True))

    meta_rows = (
        await db.execute(
            select(Campus.key, Campus.active, BookingConfig.mode)
            .outerjoin(BookingConfig, BookingConfig.campus_key == Campus.key)
            .where(Campus.key.in_(campus_keys))
        )
    ).all()
    meta = {key: (active, mode.value if mode is not None else None) for key, active, mode in meta_rows}

    totals = _empty_counts()
    open_totals = {kind: 0 for kind in pending_kinds.PENDING_KINDS}
    campuses = []
    for key in campus_keys:
        _add_into(totals, counts[key])
        for kind, value in open_now[key].items():
            open_totals[kind] += value
        active, mode = meta.get(key, (True, None))
        campuses.append(
            {"campus_key": key, "active": active, "booking_mode": mode, "open_now": open_now[key], **_with_rates(counts[key])}
        )
    return {
        "as_of": current,
        "date_from": period.date_from,
        "date_to": period.date_to,
        "unit": "visit_request",
        "campuses": campuses,
        "totals": _with_rates(totals),
        "open_now_totals": open_totals,
    }


async def class_distribution(
    db: AsyncSession, campus_key: str, period: FunnelRange, school_year: int, now: datetime | None = None
) -> dict:
    """期間內送出的案件（含已取消），孩子生日換算成 school_year 學年度的班別。換算同
    招生入學（academic.grade_for_birthday，共用案例 contracts/ivy-recruitment/grade-cases.json）；
    這是年齡對照，不是報名或入學結果。沒有生日（舊案只有年齡文字、補登沒問、已匿名化）
    算 unrecorded；有生日但不在幼幼班～大班算 out_of_range。依生日分組在 SQL，換算在 Python。"""
    rows = (
        await db.execute(
            select(VisitRequest.child_birthdate, func.count())
            .where(VisitRequest.campus_key == campus_key, *period.on(VisitRequest.created_at))
            .group_by(VisitRequest.child_birthdate)
        )
    ).all()
    grades = {grade: 0 for grade in GRADES}
    out_of_range = 0
    unrecorded = 0
    for birthday, count in rows:
        if birthday is None:
            unrecorded += count
            continue
        grade = academic.grade_for_birthday(birthday, school_year)
        if grade is None:
            out_of_range += count
        else:
            grades[grade] += count
    return {
        "as_of": now or now_utc(),
        "campus_key": campus_key,
        "date_from": period.date_from,
        "date_to": period.date_to,
        "school_year": school_year,
        "unit": "visit_request",
        "total": unrecorded + out_of_range + sum(grades.values()),
        "grades": [{"grade": grade, "count": count} for grade, count in grades.items()],
        "out_of_range": out_of_range,
        "unrecorded": unrecorded,
    }
