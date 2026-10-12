"""預繳速度（2026-10-12 預繳速度與可能範圍規格 §4–§6）。

每筆訪視取參觀日與最後一筆 deposit_added 事件的台北日期，算「參觀後第 N 天的累積預繳率」
（Kaplan–Meier），並比較某一組訪視的預繳是否比另一組慢（Poisson-binomial）。
警示怎麼分組（本月 vs 其他月份、某來源 vs 其他來源）由 stats.py 決定；這裡不知道月份與來源的口徑。
只讀：不 flush、不 commit。
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import estimation
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import OPERATING_TZ

PACE_MIN_EVENTS = 10
PACE_P_THRESHOLD = 0.10
PACE_MIN_SHORTFALL = 2.0
TIMING_CHECKPOINTS = (7, 14, 30, 60, 90)
HALF_HORIZON = 90
# 浮點誤差：F(d) 剛好等於 F(90) 的一半時也要算達到。
_HALF_TOLERANCE = 1e-12


@dataclass(frozen=True)
class PaceVisit:
    visit_id: uuid.UUID
    month: str
    source: str | None
    created_at: datetime
    visit_date: date
    # 預繳過＝目前已預繳，或已退出（只有已預繳、已註冊可以退出）。規格 §4.2。
    deposited: bool
    # 最後一筆 deposit_added 的台北日期；沒預繳過、或預繳過卻沒有事件時是 None。規格 §4.3。
    deposit_date: date | None

    @property
    def missing_time(self) -> bool:
        return self.deposited and self.deposit_date is None


async def load_visits(db: AsyncSession, filters: list[Any]) -> list[PaceVisit]:
    """母體同 /stats（filters 由 stats._base_filters 產生），已匿名化的照算（事件在匿名化後保留）。"""
    v, e = RecruitmentVisit, RecruitmentEventLog
    last_deposit = (
        select(e.recruitment_visit_id.label("visit_id"), func.max(e.created_at).label("deposit_at"))
        .where(e.event_type == "deposit_added")
        .group_by(e.recruitment_visit_id)
        .subquery()
    )
    stmt = (
        select(v.id, v.month, v.source, v.created_at, v.visit_date, v.has_deposit, v.withdrawn_at, last_deposit.c.deposit_at)
        .select_from(v)
        .outerjoin(last_deposit, last_deposit.c.visit_id == v.id)
        .where(*filters)
    )
    visits: list[PaceVisit] = []
    for row in (await db.execute(stmt)).all():
        deposited = bool(row.has_deposit) or row.withdrawn_at is not None
        deposit_date = row.deposit_at.astimezone(OPERATING_TZ).date() if deposited and row.deposit_at is not None else None
        visits.append(PaceVisit(
            visit_id=row.id, month=row.month, source=row.source, created_at=row.created_at,
            visit_date=row.visit_date, deposited=deposited, deposit_date=deposit_date,
        ))
    return visits


def _observation(visit: PaceVisit, today: date) -> tuple[int, bool] | None:
    """(天數, 是否預繳)；參觀日在未來、預繳過卻沒有時間的不列入（規格 §4.1、§4.3）。"""
    if visit.visit_date > today or visit.missing_time:
        return None
    if visit.deposited and visit.deposit_date is not None:
        return max(0, (visit.deposit_date - visit.visit_date).days), True
    return (today - visit.visit_date).days, False


def _pct(value: float | None) -> float | None:
    return None if value is None else round(value * 100, 1)


def deposit_timing(visits: list[PaceVisit], today: date) -> dict[str, Any]:
    """/stats 的 deposit_timing（規格 §5、§9.1）。"""
    counted = [visit for visit in visits if _observation(visit, today) is not None]
    observations = [_observation(visit, today) for visit in counted]
    deposited = sum(1 for obs in observations if obs is not None and obs[1])
    base = {
        "visits": len(counted),
        "deposited": deposited,
        "missing_time": sum(1 for visit in visits if visit.missing_time),
        "min_events": PACE_MIN_EVENTS,
    }
    if deposited < PACE_MIN_EVENTS:
        return {**base, "status": "insufficient", "checkpoints": [], "half_by_day": None}
    curve = estimation.kaplan_meier(obs for obs in observations if obs is not None)
    ages = [(today - visit.visit_date).days for visit in counted]
    checkpoints = []
    for day in TIMING_CHECKPOINTS:
        reached = sum(1 for age in ages if age >= day)
        value = estimation.cumulative_at(curve, day) if reached else None
        checkpoints.append({"day": day, "cumulative_rate": _pct(value), "visits_reached": reached})
    half = None
    if any(age >= HALF_HORIZON for age in ages):
        horizon = estimation.cumulative_at(curve, HALF_HORIZON)
        if horizon > 0:
            half = next(day for day, value in curve if value >= horizon / 2 - _HALF_TOLERANCE)
    return {**base, "status": "ok", "checkpoints": checkpoints, "half_by_day": half}


@dataclass(frozen=True)
class PaceResult:
    evaluable: bool
    reason: str | None
    visits: int
    expected: float | None
    observed: int
    slow: bool


def pace_check(test: list[PaceVisit], baseline: list[PaceVisit], today: date) -> PaceResult:
    """test 這組到今天的預繳，是否明顯比 baseline 的速度少（規格 §6.1）。"""
    tested = [visit for visit in test if _observation(visit, today) is not None]
    if not tested:
        return PaceResult(evaluable=False, reason="no_visits", visits=0, expected=None, observed=0, slow=False)
    observed = sum(1 for visit in tested if visit.deposited)
    base_observations = [obs for visit in baseline if (obs := _observation(visit, today)) is not None]
    if sum(1 for _, deposited in base_observations if deposited) < PACE_MIN_EVENTS:
        return PaceResult(
            evaluable=False, reason="insufficient_baseline", visits=len(tested), expected=None, observed=observed, slow=False,
        )
    curve = estimation.kaplan_meier(base_observations)
    probabilities = [estimation.cumulative_at(curve, (today - visit.visit_date).days) for visit in tested]
    expected = sum(probabilities)
    p_value = estimation.poisson_binomial_cdf(probabilities, observed)
    slow = p_value <= PACE_P_THRESHOLD and expected - observed >= PACE_MIN_SHORTFALL
    return PaceResult(
        evaluable=True, reason=None, visits=len(tested), expected=round(expected, 1), observed=observed, slow=slow,
    )


def pace_dict(result: PaceResult, month: str | None) -> dict[str, Any]:
    """/stats 的 deposit_pace（規格 §9.1）。"""
    return {**asdict(result), "month": month}
