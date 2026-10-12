"""預繳速度（2026-10-12 規格 §4–§6）。訪視與事件直接寫資料庫，才能控制參觀日與預繳時間。"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from app.admissions import deposit_pace
from app.admissions.academic import roc_month
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.admissions.stats import _base_filters

# 台北 2026-10-01 12:00（同 test_admissions_stats.NOW）。
NOW = datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 1)


def noon(day: date) -> datetime:
    """台北那天中午（UTC 04:00）。"""
    return datetime(day.year, day.month, day.day, 4, 0, tzinfo=timezone.utc)


def add_visit(db, *, campus_key="chongde", visit_date: date, source: str | None = None, has_deposit=False,
              withdrawn_at: datetime | None = None, anonymized=False, created_at: datetime | None = None,
              target_school_year=115, target_semester=1) -> RecruitmentVisit:
    created = created_at or noon(visit_date)
    visit = RecruitmentVisit(
        id=uuid.uuid4(), campus_key=campus_key, month=roc_month(visit_date), seq_no=None, visit_date=visit_date,
        child_name="測試幼生", birthday=None, grade=None, source=source, referrer=None, tour_guide_name=None,
        has_deposit=has_deposit, rides_bus=False, enrolled=False, enrolled_on=None, transfer_term=False,
        no_deposit_reason=None, withdrawn_at=withdrawn_at, withdrawn_from="deposited" if withdrawn_at else None,
        withdraw_reason="家長改送他校" if withdrawn_at else None, provisional_grade=None,
        target_school_year=target_school_year, target_semester=target_semester,
        anonymized_at=created if anonymized else None,
        version=1, created_at=created, updated_at=created,
    )
    db.add(visit)
    return visit


def add_event(db, visit: RecruitmentVisit, at: datetime, event_type: str = "deposit_added") -> None:
    to_stage = "visited" if event_type == "deposit_removed" else "deposited"
    db.add(RecruitmentEventLog(
        id=uuid.uuid4(), recruitment_visit_id=visit.id, event_type=event_type, from_stage=None, to_stage=to_stage,
        reason=None, actor_user_id=None, metadata_json=None, created_at=at,
    ))


def deposited_after(db, *, visit_date: date, days: int, **fields) -> RecruitmentVisit:
    """一筆參觀後第 days 天（台北中午）標記預繳的訪視。"""
    visit = add_visit(db, visit_date=visit_date, has_deposit=True, **fields)
    add_event(db, visit, noon(visit_date + timedelta(days=days)))
    return visit


def seed_june_baseline(db, *, source: str | None = None, deposits: int = 12, total: int = 30) -> None:
    """06-01 參觀 total 筆（到 10-01 已 122 天）：第 1..deposits 天各預繳 1 筆，其他沒預繳。
    deposits=12、total=30 時累積預繳率：第 2 天 6.7%、第 3 天 10.0%、第 7 天 23.3%、第 12 天起 40.0%。"""
    june = date(2026, 6, 1)
    for day in range(1, deposits + 1):
        deposited_after(db, visit_date=june, days=day, source=source)
    for _ in range(total - deposits):
        add_visit(db, visit_date=june, source=source)


async def load(db, campus_key="chongde"):
    return await deposit_pace.load_visits(db, _base_filters(campus_key, None, None))


async def test_load_visits_definitions(db_session):
    """規格 §4.2、§4.3（Review Focus 4）。"""
    d = date(2026, 9, 1)
    a = deposited_after(db_session, visit_date=d, days=2)                                     # 一般預繳
    b = add_visit(db_session, visit_date=d, withdrawn_at=noon(date(2026, 9, 20)))             # 預繳後退出
    add_event(db_session, b, noon(date(2026, 9, 4)))
    c = add_visit(db_session, visit_date=d)                                                   # 退預繳回已訪視
    add_event(db_session, c, noon(date(2026, 9, 5)))
    add_event(db_session, c, noon(date(2026, 9, 6)), "deposit_removed")
    missing = add_visit(db_session, visit_date=d, has_deposit=True)                           # 已預繳但沒事件
    anon = deposited_after(db_session, visit_date=d, days=3, anonymized=True)                 # 已匿名化
    again = add_visit(db_session, visit_date=d, has_deposit=True)                             # 退預繳後再預繳
    add_event(db_session, again, noon(date(2026, 9, 3)))
    add_event(db_session, again, noon(date(2026, 9, 5)), "deposit_removed")
    add_event(db_session, again, noon(date(2026, 9, 10)))
    future = add_visit(db_session, visit_date=date(2026, 10, 5))                              # 參觀日在未來
    other = add_visit(db_session, campus_key="yihua", visit_date=d, has_deposit=True)         # 別校
    await db_session.commit()

    rows = {visit.visit_id: visit for visit in await load(db_session)}

    assert other.id not in rows
    assert (rows[a.id].deposited, rows[a.id].deposit_date) == (True, date(2026, 9, 3))
    assert (rows[b.id].deposited, rows[b.id].deposit_date) == (True, date(2026, 9, 4))
    assert (rows[c.id].deposited, rows[c.id].deposit_date) == (False, None)
    assert (rows[missing.id].deposited, rows[missing.id].missing_time) == (True, True)
    assert (rows[anon.id].deposited, rows[anon.id].deposit_date) == (True, date(2026, 9, 4))
    assert rows[again.id].deposit_date == date(2026, 9, 10)
    assert rows[future.id].visit_date == date(2026, 10, 5)

    timing = deposit_pace.deposit_timing(list(rows.values()), TODAY)
    # 列入曲線：a b c anon again（missing 沒時間、future 在未來都不列）→ 5 筆，其中預繳 4（a b anon again）。
    assert timing == {
        "status": "insufficient", "visits": 5, "deposited": 4, "missing_time": 1, "min_events": 10,
        "checkpoints": [], "half_by_day": None,
    }


async def test_deposit_date_uses_taipei_date(db_session):
    """Review Focus 1：台北 09-03 23:30＝UTC 09-03 15:30；台北 09-04 00:30＝UTC 09-03 16:30。"""
    d = date(2026, 9, 1)
    late = add_visit(db_session, visit_date=d, has_deposit=True)
    add_event(db_session, late, datetime(2026, 9, 3, 15, 30, tzinfo=timezone.utc))
    after_midnight = add_visit(db_session, visit_date=d, has_deposit=True)
    add_event(db_session, after_midnight, datetime(2026, 9, 3, 16, 30, tzinfo=timezone.utc))
    await db_session.commit()

    rows = {visit.visit_id: visit for visit in await load(db_session)}
    assert rows[late.id].deposit_date == date(2026, 9, 3)
    assert rows[after_midnight.id].deposit_date == date(2026, 9, 4)


async def test_deposit_timing_checkpoints_and_half(db_session):
    seed_june_baseline(db_session)
    await db_session.commit()

    timing = deposit_pace.deposit_timing(await load(db_session), TODAY)

    assert timing["status"] == "ok"
    assert (timing["visits"], timing["deposited"], timing["missing_time"]) == (30, 12, 0)
    assert timing["checkpoints"] == [
        {"day": 7, "cumulative_rate": 23.3, "visits_reached": 30},
        {"day": 14, "cumulative_rate": 40.0, "visits_reached": 30},
        {"day": 30, "cumulative_rate": 40.0, "visits_reached": 30},
        {"day": 60, "cumulative_rate": 40.0, "visits_reached": 30},
        {"day": 90, "cumulative_rate": 40.0, "visits_reached": 30},
    ]
    # F(90)=40% 的一半 20%：第 6 天 6/30=20% 第一次達到。
    assert timing["half_by_day"] == 6


async def test_deposit_timing_null_when_nobody_reached_the_day(db_session):
    # 09-01 參觀（到 10-01 才 30 天）：第 60、90 天還沒有人參觀滿 → null；也就沒有一半時間。
    for day in range(1, 11):
        deposited_after(db_session, visit_date=date(2026, 9, 1), days=day)
    await db_session.commit()

    timing = deposit_pace.deposit_timing(await load(db_session), TODAY)

    assert timing["status"] == "ok"
    by_day = {point["day"]: point for point in timing["checkpoints"]}
    assert by_day[30] == {"day": 30, "cumulative_rate": 100.0, "visits_reached": 10}
    assert by_day[60] == {"day": 60, "cumulative_rate": None, "visits_reached": 0}
    assert by_day[90]["cumulative_rate"] is None
    assert timing["half_by_day"] is None


async def test_pace_check_early_month_is_not_slow(db_session):
    seed_june_baseline(db_session)
    for _ in range(5):
        add_visit(db_session, visit_date=date(2026, 9, 28))   # 才參觀 3 天、0 筆預繳
    await db_session.commit()
    visits = await load(db_session)
    test = [v for v in visits if v.month == "115.09"]
    baseline = [v for v in visits if v.month != "115.09"]

    result = deposit_pace.pace_check(test, baseline, TODAY)

    # 第 3 天的累積預繳率 10% × 5 筆＝預期 0.5 筆；少 0.5 筆 < 2 → 不算偏慢。
    assert result == deposit_pace.PaceResult(
        evaluable=True, reason=None, visits=5, expected=0.5, observed=0, slow=False,
    )


async def test_pace_check_slow_cohort(db_session):
    seed_june_baseline(db_session)
    for _ in range(14):
        add_visit(db_session, visit_date=date(2026, 9, 11))   # 參觀 20 天
    deposited_after(db_session, visit_date=date(2026, 9, 11), days=2)
    await db_session.commit()
    visits = await load(db_session)
    test = [v for v in visits if v.month == "115.09"]
    baseline = [v for v in visits if v.month != "115.09"]

    result = deposit_pace.pace_check(test, baseline, TODAY)

    # 第 20 天 40% × 15 筆＝6.0；實際 1；P(X ≤ 1)≈0.005 ≤ 0.10 且少 5 筆 → 偏慢。
    assert result == deposit_pace.PaceResult(
        evaluable=True, reason=None, visits=15, expected=6.0, observed=1, slow=True,
    )


async def test_pace_check_insufficient_baseline_and_no_visits(db_session):
    seed_june_baseline(db_session, deposits=9)
    for _ in range(15):
        add_visit(db_session, visit_date=date(2026, 9, 11))
    await db_session.commit()
    visits = await load(db_session)
    test = [v for v in visits if v.month == "115.09"]
    baseline = [v for v in visits if v.month != "115.09"]

    assert deposit_pace.pace_check(test, baseline, TODAY) == deposit_pace.PaceResult(
        evaluable=False, reason="insufficient_baseline", visits=15, expected=None, observed=0, slow=False,
    )
    assert deposit_pace.pace_check([], baseline, TODAY) == deposit_pace.PaceResult(
        evaluable=False, reason="no_visits", visits=0, expected=None, observed=0, slow=False,
    )
    assert deposit_pace.pace_dict(deposit_pace.pace_check([], baseline, TODAY), "115.09") == {
        "evaluable": False, "reason": "no_visits", "month": "115.09", "visits": 0, "expected": None,
        "observed": 0, "slow": False,
    }
