"""預繳速度（2026-10-12 規格 §4–§6）。訪視與事件直接寫資料庫，才能控制參觀日與預繳時間。"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from app.admissions import deposit_pace, stats
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


async def query(db, campus_key="chongde", reference_month=None):
    return await stats.query_stats(db, campus_key, school_year=None, semester=None, reference_month=reference_month, now=NOW)


async def test_funnel_drop_not_raised_early_in_month(db_session):
    """舊判斷：115.09 預繳率 0% 對 115.06 的 40% → 月比 −40 會報；新判斷：才參觀 3 天，預期 0.5 筆 → 不報。"""
    seed_june_baseline(db_session)
    for _ in range(5):
        add_visit(db_session, visit_date=date(2026, 9, 28))
    await db_session.commit()

    result = await query(db_session)

    assert result["reference_month"] == "115.09"
    assert "FUNNEL_DROP" not in [alert["code"] for alert in result["alerts"]]
    assert result["deposit_pace"] == {
        "evaluable": True, "reason": None, "month": "115.09", "visits": 5, "expected": 0.5, "observed": 0, "slow": False,
    }


async def test_funnel_drop_raised_when_truly_slow(db_session):
    seed_june_baseline(db_session)
    for _ in range(14):
        add_visit(db_session, visit_date=date(2026, 9, 11))
    deposited_after(db_session, visit_date=date(2026, 9, 11), days=2)
    await db_session.commit()

    result = await query(db_session)

    assert result["alerts"][0] == {
        "code": "FUNNEL_DROP", "level": "warning", "title": "本月預繳比過去慢",
        "message": "115.09 參觀的 15 位家長，依過去的預繳速度到今天應有約 6.0 筆預繳，實際預繳過 1 筆（含之後退出）。",
        "target_tab": "records", "target_filter": {"month": "115.09"},
    }
    assert result["deposit_pace"]["slow"] is True
    assert result["deposit_timing"]["status"] == "ok"


async def test_funnel_drop_skipped_with_insufficient_baseline(db_session):
    seed_june_baseline(db_session, deposits=9)
    for _ in range(15):
        add_visit(db_session, visit_date=date(2026, 9, 11))
    await db_session.commit()

    result = await query(db_session)

    assert result["alerts"] == []
    assert result["deposit_pace"]["reason"] == "insufficient_baseline"
    assert result["deposit_timing"]["status"] == "insufficient"


async def test_pace_uses_selected_reference_month(db_session):
    """Review Focus 2：手選 115.06，比較組是其他月份（包含之後的 115.09）。"""
    seed_june_baseline(db_session)
    for day in range(1, 11):
        deposited_after(db_session, visit_date=date(2026, 9, 1), days=day)
    await db_session.commit()

    result = await query(db_session, reference_month="115.06")

    assert result["reference_month"] == "115.06"
    pace = result["deposit_pace"]
    assert (pace["month"], pace["evaluable"], pace["visits"], pace["observed"]) == ("115.06", True, 30, 12)


def seed_source_scenario(db, *, fb_visit_date: date, fb_deposits: int) -> None:
    """近 90 天窗口內（created_at ≥ 07-03）：親友介紹 07-10 參觀 30 筆（第 1..12 天各預繳 1 筆，累積第 1 天 3.3%、
    第 12 天起 40%）；FB 廣告 25 筆，建檔＝參觀日，其中 fb_deposits 筆在參觀隔天預繳。FB 占 25/55＝45.5%（≥ 40%）。
    比較組＝同一窗口內的其他來源（親友介紹）。"""
    july = date(2026, 7, 10)
    for day in range(1, 13):
        deposited_after(db, visit_date=july, days=day, source="親友介紹")
    for _ in range(18):
        add_visit(db, visit_date=july, source="親友介紹")
    for index in range(25):
        if index < fb_deposits:
            deposited_after(db, visit_date=fb_visit_date, days=1, source="FB 廣告")
        else:
            add_visit(db, visit_date=fb_visit_date, source="FB 廣告")


async def test_source_imbalance_not_raised_for_new_source(db_session):
    # FB 廣告 09-30 才參觀（1 天）：依親友介紹的速度預期約 0.8 筆，實際 0 → 少不到 2 筆，不報。
    seed_source_scenario(db_session, fb_visit_date=date(2026, 9, 30), fb_deposits=0)
    await db_session.commit()

    result = await query(db_session)

    assert "SOURCE_IMBALANCE" not in [alert["code"] for alert in result["alerts"]]
    assert "REVIEW_SOURCE" not in [action["code"] for action in result["top_action_queue"]]


async def test_source_imbalance_raised_when_source_is_slow(db_session):
    # FB 廣告 09-01 參觀（30 天）：親友介紹第 30 天累積 40% → 預期 10.0 筆，實際 1 筆 → 報。
    seed_source_scenario(db_session, fb_visit_date=date(2026, 9, 1), fb_deposits=1)
    await db_session.commit()

    result = await query(db_session)

    imbalance = next(alert for alert in result["alerts"] if alert["code"] == "SOURCE_IMBALANCE")
    assert imbalance == {
        "code": "SOURCE_IMBALANCE", "level": "info", "title": "來源結構失衡",
        "message": "FB 廣告 近 90 天占比 45.5%，依其他來源的預繳速度應有約 10.0 筆預繳，實際預繳過 1 筆（含之後退出）。",
        "target_tab": "source", "target_filter": {"source": "FB 廣告"},
    }
    review = next(action for action in result["top_action_queue"] if action["code"] == "REVIEW_SOURCE")
    assert review["description"] == "FB 廣告 近 90 天占比 45.5%，預繳比其他來源慢，先看這個來源的後續追蹤。"


async def test_source_imbalance_compares_within_same_window(db_session):
    """季節：06-01 的親友介紹（窗口外）很快，近 90 天大家都慢。FB 和同窗口的親友介紹一樣慢 → 不報；
    若拿不限時間的其他來源當比較組，預期 14.2 筆、實際 8 筆會誤報（2026-10-12 最終審查裁定）。"""
    june = date(2026, 6, 1)
    for _ in range(24):
        deposited_after(db_session, visit_date=june, days=1, source="親友介紹")
    for _ in range(6):
        add_visit(db_session, visit_date=june, source="親友介紹")
    july = date(2026, 7, 10)
    for day in range(20, 30):
        deposited_after(db_session, visit_date=july, days=day, source="親友介紹")
    for _ in range(20):
        add_visit(db_session, visit_date=july, source="親友介紹")
    for day in range(20, 28):
        deposited_after(db_session, visit_date=july, days=day, source="FB 廣告")
    for _ in range(17):
        add_visit(db_session, visit_date=july, source="FB 廣告")
    await db_session.commit()

    result = await query(db_session)

    assert "SOURCE_IMBALANCE" not in [alert["code"] for alert in result["alerts"]]


async def test_stats_rows_have_ranges(db_session):
    seed_june_baseline(db_session, source="親友介紹")
    await db_session.commit()

    result = await query(db_session)

    # 全體 12/30 → prior (12+1)/(30+2)；只有一個來源，那一列的範圍就是 rate_range(12, 30, 13/32)。
    from app.admissions import estimation
    expected = estimation.rate_range(12, 30, 13 / 32)
    assert result["by_source"][0]["visit_to_deposit_range"] == expected
    assert result["by_grade"][0]["visit_to_deposit_range"] == expected
    assert result["by_tour_guide"][0]["visit_to_deposit_range"] == expected


def pace_visit(*, visit_date: date, deposit_day: int | None = None) -> deposit_pace.PaceVisit:
    """不碰資料庫的 PaceVisit（純函式測試用）。"""
    return deposit_pace.PaceVisit(
        visit_id=uuid.uuid4(), month=roc_month(visit_date), source=None, created_at=noon(visit_date),
        visit_date=visit_date, deposited=deposit_day is not None,
        deposit_date=visit_date + timedelta(days=deposit_day) if deposit_day is not None else None,
    )


def test_pace_check_needs_both_conditions():
    """規格 §6.1 第 5 點：p ≤ 0.10 和少 2 筆以上要同時成立。"""
    old = date(2026, 6, 23)     # 到 10-01 已 100 天
    recent = date(2026, 9, 21)  # 10 天
    # 比較組第 1 天就 95% 預繳；2 筆都沒預繳：p = 0.05² ≈ 0.0025，但只少 1.9 筆 → 不算偏慢。
    base95 = [pace_visit(visit_date=old, deposit_day=1) for _ in range(19)] + [pace_visit(visit_date=old)]
    few = [pace_visit(visit_date=recent) for _ in range(2)]
    assert deposit_pace.pace_check(few, base95, TODAY) == deposit_pace.PaceResult(
        evaluable=True, reason=None, visits=2, expected=1.9, observed=0, slow=False,
    )
    # 比較組 50%；60 筆實際 27：少 3 筆，但 P(X ≤ 27) ≈ 0.26 > 0.10 → 不算偏慢。
    base50 = [pace_visit(visit_date=old, deposit_day=1) for _ in range(10)] + [pace_visit(visit_date=old) for _ in range(10)]
    many = [pace_visit(visit_date=recent, deposit_day=1) for _ in range(27)] + [pace_visit(visit_date=recent) for _ in range(33)]
    assert deposit_pace.pace_check(many, base50, TODAY) == deposit_pace.PaceResult(
        evaluable=True, reason=None, visits=60, expected=30.0, observed=27, slow=False,
    )
