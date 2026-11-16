"""廣告成效計算（docs/specs/2026-11-16-ad-roi-design.md §7）：各廣告平台的花費對照預約、到場、預繳。

- compute_ad_roi 是純函式（不碰資料庫與網路），規則都在這裡，單元測試直接餵資料。
- query_buckets 只負責把案件依（平台、校區、結果、是否預繳、是否考慮中）分組計數；歸屬規則同
  operations/booking_outcomes_service.attribution_outcomes（最後點擊沒有但有第一次點擊 → direct）。
- 花費：google 取 GA4（Task 3），手填平台取 ad_spend_entries；offline 只有花費，不算成本。"""

from __future__ import annotations

import calendar
import re
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from typing import Literal

from sqlalchemy import and_, case, exists, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.models import MANUAL_SPEND_PLATFORMS, RecruitmentVisit
from app.booking import exclusion
from app.booking.models import VisitRequest, VisitRequestSource
from app.campuses.models import CAMPUS_KEYS
from app.common.timezones import OPERATING_TZ
from app.insights.ga4_ads import Ga4AdsReport
from app.operations.booking_outcomes_service import _deposited, _outcome

ROW_KEYS = ("google", "openai", "meta", "line", "other", "unknown", "offline", "organic", "unrecorded")
MAX_MONTHS = 24
# 廣告列（§7.4 pending、by_campus 只數這些）：google～unknown。
AD_ROW_KEYS = ROW_KEYS[:6]
_MANUAL_ROWS = ("openai", "meta", "line", "other")
MIN_YEAR = 2000  # 與 ad_roi_routes.parse_month 同下限
_MONTH_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def _parse(value: str) -> tuple[int, int]:
    found = _MONTH_RE.fullmatch(value)
    if not found:
        raise ValueError("月份格式要是 YYYY-MM")
    return int(found.group(1)), int(found.group(2))


def parse_month_range(month_from: str, month_to: str, today: date) -> list[str]:
    """「YYYY-MM」區間展開成月份清單（含頭尾）。結束月份晚於本月就截到本月；開始晚於結束、
    或超過 24 個月丟 ValueError（訊息直接給畫面用，§7.1）。"""
    start, end = _parse(month_from), _parse(month_to)
    if start[0] < MIN_YEAR or end[0] < MIN_YEAR:
        raise ValueError("月份格式要是 YYYY-MM")
    end = min(end, (today.year, today.month))
    if start > end:
        raise ValueError("開始月份不能晚於結束月份")
    count = (end[0] - start[0]) * 12 + end[1] - start[1] + 1
    if count > MAX_MONTHS:
        raise ValueError(f"最多 {MAX_MONTHS} 個月")
    return [f"{(start[0] * 12 + start[1] - 1 + i) // 12:04d}-{(start[0] * 12 + start[1] - 1 + i) % 12 + 1:02d}" for i in range(count)]


@dataclass(frozen=True)
class CaseBucket:
    platform: str  # ROW_KEYS 之一（不會是 offline）
    campus_key: str
    outcome: str
    deposited: bool
    considering: bool
    count: int
    month: str  # 建立當下的台北月份 "YYYY-MM"


@dataclass(frozen=True)
class SpendRow:
    month: str
    platform: str
    amount: int


@dataclass(frozen=True)
class GoogleState:
    configured: bool
    error: str | None = None
    report: Ga4AdsReport | None = None


def _ratio(spend: int | None, denominator: int) -> int | None:
    """成本＝花費 ÷ 分母四捨五入；沒花費或分母 0 回 None（§7.3）。"""
    if spend is None or denominator <= 0:
        return None
    return round(spend / denominator)


def _google_section(state: GoogleState) -> dict:
    out = {
        "configured": state.configured, "error": state.error, "currency": None, "time_zone": None, "fetched_at": None, "campaigns": [],
    }
    report = state.report
    if not (state.configured and state.error is None and report is not None):
        return out
    merged: dict[str, dict] = {}
    for row in report.rows:  # 同一活動跨月加總，名稱取最後一個月的
        entry = merged.setdefault(
            row.campaign_id,
            {"campaign_id": row.campaign_id, "campaign_name": row.campaign_name, "cost": 0, "clicks": 0, "impressions": 0, "leads": 0},
        )
        entry["campaign_name"] = row.campaign_name
        for key in ("cost", "clicks", "impressions", "leads"):
            entry[key] += getattr(row, key)
    campaigns = sorted(merged.values(), key=lambda c: (-c["cost"], c["campaign_id"]))
    for campaign in campaigns:
        campaign["cost_per_click"] = _ratio(campaign["cost"], campaign["clicks"])
    out.update(currency=report.currency, time_zone=report.time_zone, fetched_at=report.fetched_at, campaigns=campaigns)
    return out


def compute_ad_roi(months: list[str], buckets: list[CaseBucket], spend: list[SpendRow], google: GoogleState) -> dict:
    """純函式：回傳形狀＝AdRoiOut 去掉 as_of、touch（§7.2–7.4）。"""
    google_out = _google_section(google)
    google_ok = google.configured and google.error is None and google.report is not None
    counts = {key: {"cases": 0, "completed": 0, "no_show": 0, "deposited": 0} for key in ROW_KEYS}
    by_month: dict[str, dict[str, dict[str, int]]] = {key: {} for key in ROW_KEYS}
    pending = {"upcoming": 0, "awaiting_attendance": 0, "considering": 0}
    campus_counts: dict[tuple[str, str], dict] = {}
    for bucket in buckets:
        key = bucket.platform if bucket.platform in counts else "unknown"
        row = counts[key]
        row["cases"] += bucket.count
        month_row = by_month[key].setdefault(bucket.month, {"cases": 0, "completed": 0, "deposited": 0})
        month_row["cases"] += bucket.count
        if bucket.outcome == "completed":
            month_row["completed"] += bucket.count
        if bucket.deposited:
            month_row["deposited"] += bucket.count
        if bucket.outcome in ("completed", "no_show"):
            row[bucket.outcome] += bucket.count
        if bucket.deposited:
            row["deposited"] += bucket.count
        if key in AD_ROW_KEYS:
            if bucket.outcome in ("upcoming", "awaiting_attendance"):
                pending[bucket.outcome] += bucket.count
            if bucket.considering:
                pending["considering"] += bucket.count
            cell = campus_counts.setdefault((bucket.campus_key, key), {"cases": 0, "completed": 0, "deposited": 0})
            cell["cases"] += bucket.count
            cell["completed"] += bucket.count if bucket.outcome == "completed" else 0
            cell["deposited"] += bucket.count if bucket.deposited else 0

    month_set = set(months)
    filled: dict[str, dict[str, int]] = {}
    for entry in spend:
        if entry.month in month_set and entry.platform in MANUAL_SPEND_PLATFORMS:
            filled.setdefault(entry.platform, {})[entry.month] = entry.amount

    rows = []
    for key in ROW_KEYS:
        c = counts[key]
        state, amount, missing, clicks = "none", None, 0, None
        denominators = {"cases": c["cases"], "completed": c["completed"], "deposited": c["deposited"]}
        partial = False
        if key == "google":
            if not google.configured:
                state = "not_configured"
            elif not google_ok:
                state = "error"
            else:
                state = "ok"
                amount = sum(row.cost for row in google.report.rows)
                clicks = sum(row.clicks for row in google.report.rows)
        elif key in MANUAL_SPEND_PLATFORMS:
            months_filled = filled.get(key, {})
            state = "ok" if months_filled else "unset"
            if months_filled:
                amount = sum(months_filled.values())
                missing = len(months) - len(months_filled)
                # 成本只除以「有填花費的月份」的案件，沒填的月份不讓成本被低估（§7.3）。
                denominators = {
                    name: sum(by_month[key].get(month, {}).get(name, 0) for month in months_filled)
                    for name in denominators
                }
                partial = missing > 0 and key in _MANUAL_ROWS  # offline 不算成本
        has_record = key in filled
        if key == "google" or key == "organic":
            listed = True
        elif key in _MANUAL_ROWS:
            listed = has_record or c["cases"] > 0
        elif key == "offline":
            listed = has_record
        else:  # unknown、unrecorded
            listed = c["cases"] > 0
        if not listed:
            continue
        priced = key != "offline"
        rows.append({
            "key": key,
            "spend": amount,
            "spend_state": state,
            "missing_months": missing,
            "clicks": clicks,
            **c,
            "cost_per_case": _ratio(amount, denominators["cases"]) if priced else None,
            "cost_per_completed": _ratio(amount, denominators["completed"]) if priced else None,
            "cost_per_deposit": _ratio(amount, denominators["deposited"]) if priced else None,
            "cost_partial": partial,
        })

    campus_order = {key: index for index, key in enumerate(CAMPUS_KEYS)}
    by_campus = [
        {"campus_key": campus, "platform": platform, **cell}
        for (campus, platform), cell in sorted(
            campus_counts.items(), key=lambda item: (campus_order.get(item[0][0], 99), ROW_KEYS.index(item[0][1]))
        )
        if cell["cases"] > 0
    ]
    return {"months": list(months), "google": google_out, "rows": rows, "pending": pending, "by_campus": by_campus}


def month_bounds_utc(months: list[str]) -> tuple[datetime, datetime]:
    """第一個月 1 號 00:00 到最後一個月底 24:00（台北）對應的 UTC [起, 訖)。"""
    first_year, first_month = _parse(months[0])
    last_year, last_month = _parse(months[-1])
    start = datetime.combine(date(first_year, first_month, 1), time.min, tzinfo=OPERATING_TZ)
    last_day = date(last_year, last_month, calendar.monthrange(last_year, last_month)[1])
    end = datetime.combine(last_day + timedelta(days=1), time.min, tzinfo=OPERATING_TZ)
    return start, end


async def query_buckets(
    db: AsyncSession, campus_keys: list[str], months: list[str], touch: Literal["last", "first"], now: datetime
) -> list[CaseBucket]:
    """官網案件依歸屬平台分組計數（§7.1）。後台補登與已排除的案件不算。"""
    if touch == "first":
        source, platform_raw = VisitRequest.first_touch_source, VisitRequest.first_touch_ad_platform
    else:
        source = case(
            (VisitRequest.last_touch_source.is_not(None), VisitRequest.last_touch_source),
            (VisitRequest.first_touch_source.is_not(None), literal("direct")),
            else_=None,
        )
        # 來源是退而求其次的 direct 時沒有平台。
        platform_raw = case((VisitRequest.last_touch_source.is_not(None), VisitRequest.last_touch_ad_platform), else_=None)
    platform = case(
        (source.is_(None), literal("unrecorded")),
        (source == "ads", func.coalesce(platform_raw, literal("unknown"))),
        else_=literal("organic"),
    )
    started, ended = month_bounds_utc(months)
    withdrawn = exists().where(RecruitmentVisit.visit_request_id == VisitRequest.id, RecruitmentVisit.withdrawn_at.is_not(None))
    outcome, deposited = _outcome(now), _deposited()
    per_case = (
        select(
            platform.label("platform"),
            VisitRequest.campus_key.label("campus_key"),
            func.to_char(func.timezone(OPERATING_TZ.key, VisitRequest.created_at), "YYYY-MM").label("month"),
            outcome.label("outcome"),
            deposited.label("deposited"),
            and_(outcome == "completed", ~deposited, ~withdrawn).label("considering"),
        )
        .where(
            VisitRequest.source == VisitRequestSource.WEB.value,
            VisitRequest.campus_key.in_(campus_keys),
            VisitRequest.created_at >= started,
            VisitRequest.created_at < ended,
            exclusion.not_excluded(),
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                per_case.c.platform, per_case.c.campus_key, per_case.c.outcome, per_case.c.deposited, per_case.c.considering,
                per_case.c.month, func.count(),
            )
            .group_by(
                per_case.c.platform, per_case.c.campus_key, per_case.c.outcome, per_case.c.deposited, per_case.c.considering,
                per_case.c.month,
            )
        )
    ).all()
    return [CaseBucket(p, c, o, bool(d), bool(k), n, m) for p, c, o, d, k, m, n in rows]
