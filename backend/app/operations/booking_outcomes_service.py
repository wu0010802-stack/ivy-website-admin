"""成效統計的「預約結果」（2026-09-30 招生分析報告第 3、4 節，階段 1）。

- 計數單位是預約案件數：同一個孩子預約兩校算兩筆，同一支電話不合併（3.1）。
- 期間依案件的送出時間（created_at，台北日界線、兩端都含）切，是「同批案件」的口徑；
  漏斗（analytics_service.get_campus_funnel）依事件發生日期計數，兩邊不能互相相除（3.2）。
- 到場率＝已到場 ÷（已到場＋未到場）。參觀時間已過但還沒標記的另列
  awaiting_attendance，不算進分母，也不當成到場（3.2：不能用預定日期已過判定已到場）。
- 待處理兩種（open_now）是現在的狀態，不受期間影響，條件在 booking/pending_kinds.py，
  和總覽、案件列表同一份。
- 標記排除的測試／重複案件（2026-10-15，booking/exclusion.py）不算進 cases、各結果、班別與待處理；
  期間內送出的已排除筆數另回 excluded_cases，畫面註明「另有 N 筆已排除」。
- 不回傳任何個資。2026-10-16 起和招生統計一起限總管理者（admissions.stats）。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic
from app.admissions.constants import GRADES
from app.admissions.stats import pct
from app.booking import exclusion, pending_kinds
from app.booking.models import BookingConfig, VisitRequest, VisitRequestSource, VisitRequestStatus
from app.campuses.models import Campus
from app.common.timezones import now_utc
from app.operations.analytics_service import UNKNOWN, FunnelRange
from app.operations.models import CANCEL_REASONS, ENGAGEMENT_SOURCES

# 每筆案件剛好落在其中一種，加總＝cases。已確認一定有場次（資料庫約束），所以沒有「沒場次」這一種。
OUTCOMES = ("upcoming", "awaiting_attendance", "completed", "no_show", "cancelled")
CANCEL_REASON_KEYS = (*CANCEL_REASONS, UNKNOWN)


def _rate(numerator: int, denominator: int) -> dict:
    return {"value": pct(numerator, denominator), "numerator": numerator, "denominator": denominator}


def _outcome(now: datetime):
    status = VisitRequest.status
    return case(
        (status == VisitRequestStatus.CANCELLED.value, literal("cancelled")),
        (status == VisitRequestStatus.COMPLETED.value, literal("completed")),
        (status == VisitRequestStatus.NO_SHOW.value, literal("no_show")),
        (pending_kinds.condition("awaiting_attendance", now), literal("awaiting_attendance")),
        else_=literal("upcoming"),
    )


def _empty_counts() -> dict:
    return {
        "cases": 0,
        "web_cases": 0,
        # 期間內送出、已排除的測試／重複案件（2026-10-15），不在 cases 裡。
        "excluded_cases": 0,
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
    for key in ("cases", "web_cases", "excluded_cases", *OUTCOMES):
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
        .where(VisitRequest.campus_key.in_(campus_keys), *period.on(VisitRequest.created_at), exclusion.not_excluded())
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
    excluded_rows = (
        await db.execute(
            select(VisitRequest.campus_key, func.count())
            .where(VisitRequest.campus_key.in_(campus_keys), *period.on(VisitRequest.created_at), exclusion.excluded())
            .group_by(VisitRequest.campus_key)
        )
    ).all()
    for campus_key, count in excluded_rows:
        counts[campus_key]["excluded_cases"] = count

    open_rows = (
        await db.execute(
            select(
                VisitRequest.campus_key,
                *[func.count().filter(pending_kinds.condition(kind, current)) for kind in pending_kinds.PENDING_KINDS],
            )
            .where(VisitRequest.campus_key.in_(campus_keys), exclusion.not_excluded())
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
            .where(VisitRequest.campus_key == campus_key, *period.on(VisitRequest.created_at), exclusion.not_excluded())
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
    excluded_cases = await db.scalar(
        select(func.count())
        .select_from(VisitRequest)
        .where(VisitRequest.campus_key == campus_key, *period.on(VisitRequest.created_at), exclusion.excluded())
    )
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
        "excluded_cases": int(excluded_cases or 0),
    }


# ── 網站來源（2026-11-16，docs/specs/2026-11-16-cookie-features-design.md §1）────────────────────────────
# 官網送單依「第一次進站」或「預約前最後一次不是直接進站」的來源分組，看各管道帶來的預約有多少真的到場、預繳。
# 只算官網表單送出的案件（人工補登沒有網站來源）；口徑同上面的預約結果：期間依送出時間、排除的案件不算。
# 「最後一次」沒有記錄（這個瀏覽器從沒從外面點進來過）而第一次有記錄的，算直接進站。
# 送單時沒有 cookie 的（2026-11-16 以前、DNT／GPC、瀏覽器擋 cookie）歸「沒有記錄」。
ATTRIBUTION_TOUCHES = ("first", "last")
UNRECORDED = "unrecorded"


def _deposited():
    """招生訪視預繳過（現在已預繳、已轉正式，或從已預繳／已轉正式退出）。"""
    from app.admissions.models import RecruitmentVisit

    v = RecruitmentVisit
    return (
        select(literal(1))
        .where(
            v.visit_request_id == VisitRequest.id,
            (v.has_deposit.is_(True)) | (v.enrolled.is_(True)) | (v.withdrawn_from.in_(("deposited", "enrolled"))),
        )
        .correlate(VisitRequest)
        .exists()
    )


def _attribution_counts() -> dict:
    return {"cases": 0, "completed": 0, "no_show": 0, "deposited": 0}


def _attribution_rates(counts: dict) -> dict:
    marked = counts["completed"] + counts["no_show"]
    return {
        **counts,
        # 已到場 ÷（已到場＋未到場），同預約結果。
        "attendance_rate": _rate(counts["completed"], marked),
        # 預繳 ÷ 已到場。
        "deposit_rate": _rate(counts["deposited"], counts["completed"]),
    }


async def attribution_outcomes(
    db: AsyncSession, campus_keys: list[str], period: FunnelRange, touch: str, now: datetime | None = None
) -> dict:
    current = now or now_utc()
    if touch == "first":
        source, campaign = VisitRequest.first_touch_source, VisitRequest.first_touch_campaign
    else:
        source = case(
            (VisitRequest.last_touch_source.is_not(None), VisitRequest.last_touch_source),
            (VisitRequest.first_touch_source.is_not(None), literal("direct")),
            else_=None,
        )
        campaign = VisitRequest.last_touch_campaign
    per_case = (
        select(
            func.coalesce(source, literal(UNRECORDED)).label("source"),
            campaign.label("campaign"),
            _outcome(current).label("outcome"),
            _deposited().label("deposited"),
        )
        .where(
            VisitRequest.campus_key.in_(campus_keys),
            VisitRequest.source == VisitRequestSource.WEB.value,
            *period.on(VisitRequest.created_at),
            exclusion.not_excluded(),
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(per_case.c.source, per_case.c.campaign, per_case.c.outcome, per_case.c.deposited, func.count())
            .group_by(per_case.c.source, per_case.c.campaign, per_case.c.outcome, per_case.c.deposited)
        )
    ).all()
    sources: dict[str, dict] = {}
    campaigns: dict[tuple[str, str], dict] = {}
    totals = _attribution_counts()
    for source_key, campaign_key, outcome, deposited, count in rows:
        buckets = [totals, sources.setdefault(source_key, _attribution_counts())]
        if campaign_key:
            buckets.append(campaigns.setdefault((source_key, campaign_key), _attribution_counts()))
        for bucket in buckets:
            bucket["cases"] += count
            if outcome in ("completed", "no_show"):
                bucket[outcome] += count
            if deposited:
                bucket["deposited"] += count
    order = {key: index for index, key in enumerate((*ENGAGEMENT_SOURCES, UNRECORDED))}
    out_rows = []
    for source_key in sorted(sources, key=lambda key: (-sources[key]["cases"], order.get(key, 99))):
        children = sorted(
            ((name, counts) for (parent, name), counts in campaigns.items() if parent == source_key),
            key=lambda item: (-item[1]["cases"], item[0]),
        )
        out_rows.append({
            "source": source_key,
            **_attribution_rates(sources[source_key]),
            "campaigns": [{"campaign": name, **_attribution_rates(counts)} for name, counts in children],
        })
    return {
        "as_of": current,
        "date_from": period.date_from,
        "date_to": period.date_to,
        "touch": touch,
        "rows": out_rows,
        "totals": _attribution_rates(totals),
    }
