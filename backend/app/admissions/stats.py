"""招生統計（規格第 9 節）。

移植園務 ivy-backend dfd230c3 的 api/recruitment/stats.py::_query_stats 與 api/recruitment/shared.py
（_visit_metric_cases、_metric_snapshot、_select_reference_month、_build_month_over_month、
_build_ytd_snapshot、_build_alerts、_build_action_queue、_find_source_imbalance）。
只讀：不 flush、不 commit、不寫稽核。

刻意與園務不同（contracts/ivy-recruitment/README.md「## 刻意與園務不同的地方」）：
- 比率分母 0 回 None（園務回 0）；月比任一邊是 None，delta 也是 None。
- 來源不做別名合併；不做童年綠地、行政區、預計就讀月份。
- 同票排序加第二鍵：標籤字串升序。
- 行動入口「查看區域機會」改為「查看來源結構」（REVIEW_SOURCE），只在來源失衡時出現。
- 未預繳的逾期、冷名單看參觀日（台北日期），園務看 created_at（2026-10-06，第 16 點）。
- 參考月份格式錯丟 InvalidReferenceMonth（路由轉 422）；園務是未處理的 ValueError。
- SQL 只 GROUP BY 原始欄位，「未填寫」「未分類」在 Python 合併：asyncpg 用伺服器端參數，
  GROUP BY coalesce(x, $2) 與 SELECT coalesce(x, $1) 會被判定成不同運算式。
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Any, Callable, Iterable

from sqlalchemy import String, and_, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import intake
from app.admissions.academic import ROC_MONTH_RE, shift_roc_month
from app.admissions.constants import NO_DEPOSIT_PRIORITY
from app.admissions.models import RecruitmentVisit
from app.common.timezones import now_utc, today_local

# 門檻（園務 shared.py:54、77-82）。
TOP_SOURCES_COUNT = 10
FUNNEL_DROP_THRESHOLD = 10.0
HIGH_POTENTIAL_BACKLOG_THRESHOLD = 5
DEFAULT_OVERDUE_DAYS = 14
COLD_LEAD_DAYS = 90
SOURCE_IMBALANCE_SHARE_THRESHOLD = 40.0
ACTION_QUEUE_LIMIT = 3
ROLLING_SHORT_DAYS = 30
ROLLING_LONG_DAYS = 90

# 官網 month 必填，資料不會走到「未知」與 roc_month_sort_key／_by_year 的防禦分支；照搬以利對照園務。
UNKNOWN_MONTH = "未知"
UNFILLED = "未填寫"
UNCLASSIFIED_REASON = "未分類"
MONTH_TOTAL = "合計"

COUNT_FIELDS = ("visit", "deposit", "enrolled", "transfer_term", "pending_deposit", "effective_deposit")
RATE_FIELDS = ("visit_to_deposit_rate", "visit_to_enrolled_rate", "deposit_to_enrolled_rate", "effective_to_enrolled_rate")
_MOM_COUNT_FIELDS = ("visit", "deposit", "enrolled", "effective_deposit", "pending_deposit")
_FUNNEL_FIELDS = ("visit", "deposit", "enrolled", "transfer_term", "effective_deposit", "pending_deposit")
_REASON_PRIORITY = {reason: level for level, reasons in NO_DEPOSIT_PRIORITY.items() for reason in reasons}
_SUMMARY_FIELDS = ("high_potential_count", "overdue_followup_count", "cold_count", "high_potential_backlog_count")


class InvalidReferenceMonth(ValueError):
    """參考月份不是「民國年.月」。訊息照園務 utils/roc_month_utils.py 原文。"""


def pct(num: int, den: int) -> float | None:
    """百分比到小數一位；分母 0 回 None（規格 9.2，園務回 0）。"""
    return round(num / den * 100, 1) if den else None


def metric_snapshot(
    visit: int = 0,
    deposit: int = 0,
    enrolled: int = 0,
    transfer_term: int = 0,
    pending_deposit: int = 0,
    effective_deposit: int = 0,
) -> dict[str, Any]:
    return {
        "visit": visit,
        "deposit": deposit,
        "enrolled": enrolled,
        "transfer_term": transfer_term,
        "pending_deposit": pending_deposit,
        "effective_deposit": effective_deposit,
        "visit_to_deposit_rate": pct(deposit, visit),
        "visit_to_enrolled_rate": pct(enrolled, visit),
        "deposit_to_enrolled_rate": pct(enrolled, deposit),
        "effective_to_enrolled_rate": pct(enrolled, effective_deposit),
    }


def normalize_roc_month(value: str | None) -> str | None:
    """「115.3」→「115.03」；空值回 None；格式錯丟 InvalidReferenceMonth。"""
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    parts = text.split(".")
    if len(parts) != 2:
        raise InvalidReferenceMonth("月份格式應為 民國年.月，如 115.03")
    try:
        year, month = int(parts[0]), int(parts[1])
    except ValueError as exc:
        raise InvalidReferenceMonth("月份格式錯誤") from exc
    if year <= 0:
        raise InvalidReferenceMonth(f"年份須為正整數，收到 {parts[0]}")
    if not 1 <= month <= 12:
        raise InvalidReferenceMonth(f"月份須在 1-12 之間，收到 {month}")
    return f"{year}.{month:02d}"


def _safe_normalize(value: str | None) -> str | None:
    try:
        return normalize_roc_month(value)
    except InvalidReferenceMonth:
        stripped = (value or "").strip()
        return stripped or None


def roc_month_sort_key(value: str | None) -> tuple[int, int, str]:
    """園務 roc_month_sort_key：無法解析的排倒數第二，空值與「未知」排最後。
    官網 month 必填，資料不會走到 999998／999999 兩個分支；照搬以利對照園務。"""
    normalized = _safe_normalize(value)
    if normalized in (None, "", UNKNOWN_MONTH):
        return (999999, 99, normalized or "")
    parts = normalized.split(".")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        return (999998, 99, normalized)
    return (int(parts[0]), int(parts[1]), normalized)


def _month_parts(value: str) -> tuple[int, int]:
    normalized = normalize_roc_month(value)
    if normalized is None:
        raise InvalidReferenceMonth("月份格式錯誤")
    year, month = normalized.split(".")
    return int(year), int(month)


def _previous_month(month: str | None) -> str | None:
    if not month:
        return None
    try:
        _month_parts(month)
    except InvalidReferenceMonth:
        return None
    return shift_roc_month(month, -1)


def _label(value: str | None, fallback: str) -> str:
    return fallback if value is None else value


def _metric_cases() -> dict[str, Any]:
    """園務 _visit_metric_cases：effective＝預繳且未轉學期；pending＝預繳、未註冊、未轉學期。"""
    v = RecruitmentVisit
    return {
        "deposit": case((v.has_deposit.is_(True), 1), else_=0),
        "enrolled": case((v.enrolled.is_(True), 1), else_=0),
        "transfer_term": case((v.transfer_term.is_(True), 1), else_=0),
        "pending_deposit": case(
            (and_(v.has_deposit.is_(True), v.enrolled.is_(False), v.transfer_term.is_(False)), 1), else_=0
        ),
        "effective_deposit": case((and_(v.has_deposit.is_(True), v.transfer_term.is_(False)), 1), else_=0),
    }


def _count_columns() -> list[Any]:
    return [
        func.count(RecruitmentVisit.id).label("visit"),
        *(func.coalesce(func.sum(expr), 0).label(name) for name, expr in _metric_cases().items()),
    ]


def _counts(row: Any) -> dict[str, int]:
    return {name: int(getattr(row, name) or 0) for name in COUNT_FIELDS}


def _base_filters(campus_key: str, school_year: int | None, semester: int | None) -> list[Any]:
    filters: list[Any] = [RecruitmentVisit.campus_key == campus_key]
    if school_year is not None:
        filters.append(RecruitmentVisit.target_school_year == school_year)
    if semester is not None:
        filters.append(RecruitmentVisit.target_semester == semester)
    return filters


async def _aggregate(db: AsyncSession, filters: list[Any]) -> dict[str, Any]:
    row = (await db.execute(select(*_count_columns()).where(*filters))).one()
    return metric_snapshot(**_counts(row))


async def _grouped(db: AsyncSession, filters: list[Any], *columns: Any) -> list[Any]:
    stmt = select(*columns, *_count_columns()).where(*filters).group_by(*columns)
    return list((await db.execute(stmt)).all())


def _merge(rows: Iterable[Any], key: Callable[[Any], Any]) -> dict[Any, dict[str, int]]:
    """依標籤合併計數：NULL 與字面上的「未填寫」併成同一組（園務 SQL 分組後也是同一個標籤）。"""
    merged: dict[Any, dict[str, int]] = {}
    for row in rows:
        bucket = merged.setdefault(key(row), dict.fromkeys(COUNT_FIELDS, 0))
        for name, value in _counts(row).items():
            bucket[name] += value
    return merged


async def _unique_counts(db: AsyncSession, filters: list[Any]) -> tuple[int, int]:
    """園務 stats.py:122-139：coalesce(姓名,'')||'|'||coalesce(生日字串,'')，不 trim、不分大小寫。
    已匿名化的列姓名都是同一段固定文字、生日為空，照園務的鍵會被併成同一個孩子；
    改用列 id 當鍵，一筆算一個。"""
    person_key = func.coalesce(RecruitmentVisit.child_name, "") + "|" + func.coalesce(cast(RecruitmentVisit.birthday, String), "")
    key = case(
        (RecruitmentVisit.anonymized_at.is_not(None), "anonymized|" + cast(RecruitmentVisit.id, String)),
        else_=person_key,
    )
    deposit_key = case((RecruitmentVisit.has_deposit.is_(True), key), else_=None)
    row = (
        await db.execute(select(func.count(func.distinct(key)), func.count(func.distinct(deposit_key))).where(*filters))
    ).one()
    return int(row[0] or 0), int(row[1] or 0)


def _monthly(rows: list[Any]) -> list[dict[str, Any]]:
    merged = _merge(rows, lambda row: _label(row.month, UNKNOWN_MONTH))
    return sorted(
        ({"month": month, **metric_snapshot(**counts)} for month, counts in merged.items()),
        key=lambda item: roc_month_sort_key(item["month"]),
    )


def _by_year(monthly: list[dict[str, Any]]) -> list[dict[str, Any]]:
    yearly: dict[str, dict[str, int]] = {}
    for row in monthly:
        label = row["month"]
        # 官網 month 必填，不會有「未知」；照搬園務以利對照。
        if label in (None, "", UNKNOWN_MONTH) or "." not in label:
            continue
        bucket = yearly.setdefault(label.split(".", 1)[0], dict.fromkeys(COUNT_FIELDS, 0))
        for name in COUNT_FIELDS:
            bucket[name] += row[name]
    order = sorted(yearly, key=lambda year: (int(year) if year.isdigit() else 999999, year))
    return [{"year": year, **metric_snapshot(**yearly[year])} for year in order]


def _by_grade(rows: list[Any]) -> list[dict[str, Any]]:
    merged = _merge(rows, lambda row: _label(row.grade, UNFILLED))
    result = [
        {
            "grade": grade,
            "visit": c["visit"],
            "deposit": c["deposit"],
            "enrolled": c["enrolled"],
            "visit_to_deposit_rate": pct(c["deposit"], c["visit"]),
            "visit_to_enrolled_rate": pct(c["enrolled"], c["visit"]),
            "deposit_to_enrolled_rate": pct(c["enrolled"], c["deposit"]),
        }
        for grade, c in merged.items()
    ]
    return sorted(result, key=lambda item: (-item["visit"], item["grade"]))


def _month_grade(rows: list[Any]) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for row in rows:
        bucket = result.setdefault(_label(row.month, UNKNOWN_MONTH), {})
        grade = _label(row.grade, UNFILLED)
        bucket[grade] = bucket.get(grade, 0) + row.visit
        bucket[MONTH_TOTAL] = bucket.get(MONTH_TOTAL, 0) + row.visit
    return result


def _by_source(rows: list[Any]) -> list[dict[str, Any]]:
    merged = _merge(rows, lambda row: _label(row.source, UNFILLED))
    result = [
        {"source": source, "visit": c["visit"], "deposit": c["deposit"], "visit_to_deposit_rate": pct(c["deposit"], c["visit"])}
        for source, c in merged.items()
    ]
    return sorted(result, key=lambda item: (-item["visit"], -item["deposit"], item["source"]))


def _by_referrer(rows: list[Any]) -> list[dict[str, Any]]:
    referrers: dict[str, dict[str, Any]] = {}
    for row in rows:
        name = _label(row.referrer, UNFILLED)
        bucket = referrers.setdefault(name, {"referrer": name, "visit": 0, "deposit": 0, "by_grade": {}})
        counts = _counts(row)
        bucket["visit"] += counts["visit"]
        bucket["deposit"] += counts["deposit"]
        cell = bucket["by_grade"].setdefault(_label(row.grade, UNFILLED), {"visit": 0, "deposit": 0})
        cell["visit"] += counts["visit"]
        cell["deposit"] += counts["deposit"]
    result = [{**bucket, "visit_to_deposit_rate": pct(bucket["deposit"], bucket["visit"])} for bucket in referrers.values()]
    return sorted(result, key=lambda item: (-item["visit"], item["referrer"]))


def _referrer_source_cross(rows: list[Any], top_source_names: list[str]) -> dict[str, Any]:
    raw: dict[str, dict[str, int]] = {}
    for row in rows:
        sources = raw.setdefault(_label(row.referrer, UNFILLED), {})
        source = _label(row.source, UNFILLED)
        sources[source] = sources.get(source, 0) + row.visit
    referrers = [
        {"referrer": name, "sources": {s: counts.get(s, 0) for s in top_source_names}, "total": sum(counts.values())}
        for name, counts in raw.items()
    ]
    referrers.sort(key=lambda item: (-item["total"], item["referrer"]))
    return {"referrers": referrers, "sources": list(top_source_names)}


def _no_deposit_reasons(rows: list[Any]) -> list[dict[str, Any]]:
    reasons: dict[str, dict[str, Any]] = {}
    for row in rows:
        reason = _label(row.no_deposit_reason, UNCLASSIFIED_REASON)
        bucket = reasons.setdefault(
            reason, {"reason": reason, "count": 0, "by_grade": {}, "priority": _REASON_PRIORITY.get(reason)}
        )
        grade = _label(row.grade, UNFILLED)
        bucket["count"] += row.visit
        bucket["by_grade"][grade] = bucket["by_grade"].get(grade, 0) + row.visit
    return sorted(reasons.values(), key=lambda item: (-item["count"], item["reason"]))


def _priority_totals(reasons: list[dict[str, Any]]) -> dict[str, int]:
    totals = {"high": 0, "medium": 0, "low": 0, "other": 0}
    for row in reasons:
        totals[row["priority"] or "other"] += row["count"]
    return totals


def _visit_cutoff(now: datetime, days: int) -> date:
    """參觀滿 days 天的截止日：參觀日 <= 這天就算（台北日期）。逾期、冷名單看參觀日（2026-10-06 起，
    和園務看 created_at 分歧）：補登舊訪視、預約隔很多天才按已到場，都不會從建檔那天重新起算。"""
    return today_local(now) - timedelta(days=days)


async def _no_deposit_summary(db: AsyncSession, filters: list[Any], now: datetime) -> dict[str, int]:
    """園務 /no-deposit-analysis 的 summary 與 alerts 的積壓數（/stats 只回數字；名單在 C2b 的 no_deposit_records）。"""
    v = RecruitmentVisit
    high = v.no_deposit_reason.in_(NO_DEPOSIT_PRIORITY["high"])
    overdue = v.visit_date <= _visit_cutoff(now, DEFAULT_OVERDUE_DAYS)
    cold = v.visit_date <= _visit_cutoff(now, COLD_LEAD_DAYS)
    row = (
        await db.execute(
            select(
                func.count(v.id).filter(high).label("high_potential_count"),
                func.count(v.id).filter(overdue).label("overdue_followup_count"),
                func.count(v.id).filter(cold).label("cold_count"),
                func.count(v.id).filter(and_(high, overdue)).label("high_potential_backlog_count"),
            ).where(*filters)
        )
    ).one()
    return {name: int(getattr(row, name) or 0) for name in _SUMMARY_FIELDS}


async def _find_source_imbalance(db: AsyncSession, filters: list[Any], window_start: datetime) -> dict[str, Any] | None:
    """園務 shared.py:494-534：近 90 天占比 >= 40% 且預繳率低於整體（各自先 round 一位再比）。
    同占比時取標籤升序的第一個（園務取 SQL 回傳順序）。"""
    rows = await _grouped(db, [*filters, RecruitmentVisit.created_at >= window_start], RecruitmentVisit.source)
    merged = _merge(rows, lambda row: _label(row.source, UNFILLED))
    total_visit = sum(c["visit"] for c in merged.values())
    if not total_visit:
        return None
    total_deposit = sum(c["deposit"] for c in merged.values())
    overall_rate = round(total_deposit / total_visit * 100, 1)
    candidate: dict[str, Any] | None = None
    for source in sorted(merged):
        visit, deposit = merged[source]["visit"], merged[source]["deposit"]
        if not visit:
            continue
        share = round(visit / total_visit * 100, 1)
        deposit_rate = round(deposit / visit * 100, 1)
        if share >= SOURCE_IMBALANCE_SHARE_THRESHOLD and deposit_rate < overall_rate:
            if candidate is None or share > candidate["share"]:
                candidate = {
                    "source": source, "visit": visit, "deposit": deposit,
                    "share": share, "deposit_rate": deposit_rate, "overall_rate": overall_rate,
                }
    return candidate


def _ytd_snapshot(reference_month: str | None, monthly_map: dict[str, dict[str, Any]]) -> dict[str, Any]:
    if not reference_month:
        return metric_snapshot()
    ref_year, ref_month = _month_parts(reference_month)
    totals = dict.fromkeys(COUNT_FIELDS, 0)
    for label, row in monthly_map.items():
        try:
            year, month = _month_parts(label)
        except InvalidReferenceMonth:
            continue
        if year != ref_year or month > ref_month:
            continue
        for name in COUNT_FIELDS:
            totals[name] += row[name]
    return metric_snapshot(**totals)


def _month_over_month(
    current_month: str | None, previous_month: str | None, monthly_map: dict[str, dict[str, Any]]
) -> dict[str, Any]:
    empty = metric_snapshot()
    current = monthly_map.get(current_month, empty) if current_month else empty
    previous = monthly_map.get(previous_month, empty) if previous_month else empty
    result: dict[str, Any] = {"current_month": current_month, "previous_month": previous_month}
    for name in _MOM_COUNT_FIELDS:
        result[name] = {"current": current[name], "previous": previous[name], "delta": current[name] - previous[name]}
    for name in RATE_FIELDS:
        cur, prev = current[name], previous[name]
        delta = round(cur - prev, 1) if cur is not None and prev is not None else None
        result[name] = {"current": cur, "previous": prev, "delta": delta}
    return result


def _points(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f}"


def _alerts(
    month_over_month: dict[str, Any], backlog: int, imbalance: dict[str, Any] | None, reference_month: str | None
) -> list[dict[str, Any]]:
    """園務 shared.py:377-439，文案逐字照抄（含「占比 x% ，」的半形空格與全形句號）。"""
    alerts: list[dict[str, Any]] = []
    to_deposit = month_over_month["visit_to_deposit_rate"]["delta"]
    to_enrolled = month_over_month["visit_to_enrolled_rate"]["delta"]
    dropped = [delta for delta in (to_deposit, to_enrolled) if delta is not None and delta <= -FUNNEL_DROP_THRESHOLD]
    if dropped and reference_month:
        alerts.append({
            "code": "FUNNEL_DROP",
            "level": "warning",
            "title": "本月漏斗轉換下滑",
            "message": f"{reference_month} 參觀轉預繳 {_points(to_deposit)} 個百分點，參觀轉註冊 {_points(to_enrolled)} 個百分點。",
            "target_tab": "records",
            "target_filter": {"month": reference_month},
        })
    if backlog >= HIGH_POTENTIAL_BACKLOG_THRESHOLD:
        alerts.append({
            "code": "HIGH_POTENTIAL_BACKLOG",
            "level": "danger",
            "title": "高潛力未預繳名單堆積",
            "message": f"參觀超過 {DEFAULT_OVERDUE_DAYS} 天仍未預繳的高潛力名單有 {backlog} 筆。",
            "target_tab": "nodeposit",
            "target_filter": {"priority": "high", "overdue_days": DEFAULT_OVERDUE_DAYS},
        })
    if imbalance:
        alerts.append({
            "code": "SOURCE_IMBALANCE",
            "level": "info",
            "title": "來源結構失衡",
            "message": (
                f"{imbalance['source']} 近 90 天占比 {imbalance['share']:.1f}% ，"
                f"預繳率 {imbalance['deposit_rate']:.1f}% 低於整體 {imbalance['overall_rate']:.1f}%。"
            ),
            "target_tab": "source",
            "target_filter": {"source": imbalance["source"]},
        })
    return alerts


def _action_queue(current_month: str | None, backlog: int, imbalance: dict[str, Any] | None) -> list[dict[str, Any]]:
    """園務 shared.py:442-491。官網不做行政區，AREA_OPPORTUNITY 改成 REVIEW_SOURCE。"""
    actions: list[dict[str, Any]] = []
    if backlog:
        actions.append({
            "code": "FOLLOW_HIGH_POTENTIAL",
            "title": "查看高風險未預繳",
            "description": f"目前有 {backlog} 筆高潛力名單逾期未追。",
            "target_tab": "nodeposit",
            "target_filter": {"priority": "high", "overdue_days": DEFAULT_OVERDUE_DAYS},
        })
    if current_month:
        actions.append({
            "code": "REVIEW_CURRENT_MONTH",
            "title": "查看本月明細",
            "description": f"切換到 {current_month} 明細，檢查本月漏斗掉點。",
            "target_tab": "records",
            "target_filter": {"month": current_month},
        })
    if imbalance:
        actions.append({
            "code": "REVIEW_SOURCE",
            "title": "查看來源結構",
            "description": f"{imbalance['source']} 近 90 天占比 {imbalance['share']:.1f}%，預繳率低於整體，先看這個來源的後續追蹤。",
            "target_tab": "source",
            "target_filter": {"source": imbalance["source"]},
        })
    return actions[:ACTION_QUEUE_LIMIT]


async def query_stats(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    reference_month: str | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """單校統計。school_year／semester 為 None 時不篩（同園務）；沒填入學學期的訪視在有篩選時不算。"""
    now = now or now_utc()
    requested_month = normalize_roc_month(reference_month)
    # A 的 shift_roc_month 只收三位數年份（99.12 會丟一般 ValueError）：這裡一併擋下。
    if requested_month is not None and ROC_MONTH_RE.match(requested_month) is None:
        raise InvalidReferenceMonth("月份格式應為 民國年.月，如 115.03")
    filters = _base_filters(campus_key, school_year, semester)
    v = RecruitmentVisit

    kpi = await _aggregate(db, filters)
    unique_visit, unique_deposit = await _unique_counts(db, filters)
    monthly = _monthly(await _grouped(db, filters, v.month))
    by_source = _by_source(await _grouped(db, filters, v.source))
    top_source_names = [row["source"] for row in by_source[:TOP_SOURCES_COUNT]]

    # 未預繳母體排除已退出（園務 stats.py:395-435）：退預繳／退註冊會清 has_deposit，
    # 不排除的話會把「預繳過又退掉」算成從未預繳，舊的高潛力原因也會灌進積壓數。
    no_deposit_filters = [*filters, v.has_deposit.is_(False), v.withdrawn_at.is_(None)]
    no_deposit_reasons = _no_deposit_reasons(await _grouped(db, no_deposit_filters, v.no_deposit_reason, v.grade))
    summary = await _no_deposit_summary(db, no_deposit_filters, now)

    monthly_map = {(_safe_normalize(row["month"]) or row["month"]): row for row in monthly}
    resolved_month = requested_month or (_safe_normalize(monthly[-1]["month"]) if monthly else None)
    previous_month = _previous_month(resolved_month)
    current_row = monthly_map.get(resolved_month) if resolved_month else None
    current_snapshot = metric_snapshot(**{name: current_row[name] for name in COUNT_FIELDS}) if current_row else metric_snapshot()
    month_over_month = _month_over_month(resolved_month, previous_month, monthly_map)
    imbalance = await _find_source_imbalance(db, filters, now - timedelta(days=ROLLING_LONG_DAYS))
    backlog = summary["high_potential_backlog_count"]

    return {
        "as_of": now,
        "filters": {
            "campus_key": campus_key, "school_year": school_year, "semester": semester, "reference_month": requested_month,
        },
        "reference_month": resolved_month,
        "kpi": {**kpi, "unique_visit": unique_visit, "unique_deposit": unique_deposit},
        "decision_summary": {
            "current_month": current_snapshot,
            # 近 30／90 天依 created_at（園務 stats.py:502-507），不看 month 欄。
            "rolling_30d": await _aggregate(db, [*filters, v.created_at >= now - timedelta(days=ROLLING_SHORT_DAYS)]),
            "rolling_90d": await _aggregate(db, [*filters, v.created_at >= now - timedelta(days=ROLLING_LONG_DAYS)]),
            "ytd": _ytd_snapshot(resolved_month, monthly_map),
        },
        "funnel_snapshot": {name: current_snapshot[name] for name in _FUNNEL_FIELDS},
        "month_over_month": month_over_month,
        "alerts": _alerts(month_over_month, backlog, imbalance, resolved_month),
        "top_action_queue": _action_queue(resolved_month, backlog, imbalance),
        "monthly": monthly,
        "by_year": _by_year(monthly),
        "by_grade": _by_grade(await _grouped(db, filters, v.grade)),
        "month_grade": _month_grade(await _grouped(db, filters, v.month, v.grade)),
        "by_source": by_source,
        "top_source_names": top_source_names,
        "by_referrer": _by_referrer(await _grouped(db, filters, v.referrer, v.grade)),
        "referrer_source_cross": _referrer_source_cross(await _grouped(db, filters, v.referrer, v.source), top_source_names),
        "no_deposit_reasons": no_deposit_reasons,
        "no_deposit_total": sum(row["count"] for row in no_deposit_reasons),
        "no_deposit_priority": _priority_totals(no_deposit_reasons),
        "no_deposit_summary": summary,
    }


def _rate(numerator: int, denominator: int) -> dict[str, Any]:
    return {"value": pct(numerator, denominator), "numerator": numerator, "denominator": denominator}


async def compare(
    db: AsyncSession, campus_keys: list[str], *, school_year: int, semester: int | None, now: datetime | None = None
) -> dict[str, Any]:
    """五校比較（官網延伸，規格 9.3）。依 campus_keys 的順序每校一列；呼叫端負責只傳授權範圍內的校區。

    件數：semester 有帶就只算該學期，沒帶就算整學年（母體規則同 query_stats）。
    名額剩餘：名額規劃是逐學期設定，沒帶 semester 時用上學期，實際用的學期放 seat_semester。"""
    now = now or now_utc()
    seat_semester = semester or 1
    v = RecruitmentVisit
    term_filters = [v.target_semester == semester] if semester is not None else []
    rows = (
        await db.execute(
            select(v.campus_key, *_count_columns())
            .where(v.campus_key.in_(campus_keys), v.target_school_year == school_year, *term_filters)
            .group_by(v.campus_key)
        )
    ).all()
    counts_by_campus = {row.campus_key: _counts(row) for row in rows}
    result: list[dict[str, Any]] = []
    for campus_key in campus_keys:
        c = counts_by_campus.get(campus_key, dict.fromkeys(COUNT_FIELDS, 0))
        plan = await intake.intake_plan(db, campus_key, school_year, seat_semester)
        configured = [row for row in plan["rows"] if row["target_seats"] is not None]
        result.append({
            "campus_key": campus_key,
            **c,
            "visit_to_deposit_rate": _rate(c["deposit"], c["visit"]),
            "visit_to_enrolled_rate": _rate(c["enrolled"], c["visit"]),
            "deposit_to_enrolled_rate": _rate(c["enrolled"], c["deposit"]),
            "effective_to_enrolled_rate": _rate(c["enrolled"], c["effective_deposit"]),
            "target_seats": plan["totals"]["target_seats"],
            "remaining_seats": plan["totals"]["remaining"],
            "grades_with_target": len(configured),
        })
    return {
        "as_of": now, "school_year": school_year, "semester": semester, "seat_semester": seat_semester, "rows": result,
    }


_LEADING_DIGITS = re.compile(r"\d+")
_NO_DEPOSIT_SUMMARY_FIELDS = ("high_potential_count", "overdue_followup_count", "cold_count")


def seq_sort_key(seq_no: str | None) -> tuple[int, int, str]:
    """序號依開頭數字升序（「2」在「10」前面）；沒有開頭數字的排在有數字的後面，沒有序號的排最後。"""
    if seq_no is None:
        return (2, 0, "")
    digits = _LEADING_DIGITS.match(seq_no)
    if digits is None:
        return (1, 0, seq_no)
    return (0, int(digits.group()), seq_no)


async def no_deposit_records(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    reason: str | None,
    grade: str | None,
    priority: str | None,
    overdue_days: int | None,
    cold_only: bool | None,
    page: int,
    page_size: int,
    now: datetime | None = None,
) -> dict[str, Any]:
    """未預繳明細（園務 GET /no-deposit-analysis，stats.py:938-1005）。只讀。

    母體同 query_stats 的未預繳：篩校區與入學學年學期、未預繳且未退出（退預繳會清 has_deposit，
    不排除的話統計寫 N 筆、名單會多出已退出的）。reason／grade 名單與 summary 都套；
    priority／overdue_days／cold_only 只篩名單，其中 overdue_days 也決定 summary 的逾期天數（沒給用 14）。
    排序與園務不同：園務 ORDER BY month DESC, seq_no 是字串排序（同月「10」在「2」前面），
    官網用 roc_month_sort_key 降序、seq_sort_key 升序，再以 created_at、id 收尾，換頁結果可重現。
    """
    now = now or now_utc()
    v = RecruitmentVisit
    filters = [*_base_filters(campus_key, school_year, semester), v.has_deposit.is_(False), v.withdrawn_at.is_(None)]
    if reason:
        filters.append(v.no_deposit_reason == reason)
    if grade:
        filters.append(v.grade == grade)
    overdue_cutoff = _visit_cutoff(now, overdue_days or DEFAULT_OVERDUE_DAYS)
    cold_cutoff = _visit_cutoff(now, COLD_LEAD_DAYS)

    summary_row = (
        await db.execute(
            select(
                func.count(v.id).filter(v.no_deposit_reason.in_(NO_DEPOSIT_PRIORITY["high"])).label("high_potential_count"),
                func.count(v.id).filter(v.visit_date <= overdue_cutoff).label("overdue_followup_count"),
                func.count(v.id).filter(v.visit_date <= cold_cutoff).label("cold_count"),
            ).where(*filters)
        )
    ).one()
    summary = {name: int(getattr(summary_row, name) or 0) for name in _NO_DEPOSIT_SUMMARY_FIELDS}

    list_filters = list(filters)
    if priority:
        list_filters.append(v.no_deposit_reason.in_(NO_DEPOSIT_PRIORITY[priority]))
    if overdue_days is not None:
        list_filters.append(v.visit_date <= overdue_cutoff)
    if cold_only:
        list_filters.append(v.visit_date <= cold_cutoff)
    rows = (
        await db.execute(
            select(
                v.id, v.month, v.seq_no, v.child_name, v.grade, v.no_deposit_reason, v.no_deposit_reason_detail,
                v.source, v.referrer, v.parent_response, v.created_at, v.visit_date,
            ).where(*list_filters)
        )
    ).all()
    # Python 的排序是穩定的（reverse=True 也是）：先排最次要的鍵，最後排月份。
    ordered = sorted(rows, key=lambda row: (row.created_at, str(row.id)))
    ordered.sort(key=lambda row: seq_sort_key(row.seq_no))
    ordered.sort(key=lambda row: roc_month_sort_key(row.month), reverse=True)
    start = (page - 1) * page_size
    records = [
        {
            "id": row.id,
            "month": row.month,
            "seq_no": row.seq_no,
            "child_name": row.child_name,
            "grade": row.grade,
            "no_deposit_reason": row.no_deposit_reason,
            "no_deposit_reason_detail": row.no_deposit_reason_detail,
            "source": row.source,
            "referrer": row.referrer,
            "parent_response": row.parent_response,
            "created_at": row.created_at,
            "priority": _REASON_PRIORITY.get(row.no_deposit_reason) if row.no_deposit_reason else None,
            "cold": row.visit_date <= cold_cutoff,
        }
        for row in ordered[start : start + page_size]
    ]
    return {"total": len(ordered), "page": page, "page_size": page_size, "summary": summary, "records": records}
