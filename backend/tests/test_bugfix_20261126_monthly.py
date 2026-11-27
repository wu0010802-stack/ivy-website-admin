"""每月彙總不能被「當天的 90 天清除先跑」蓋掉（2026-11-26 修正，docs/specs/2026-11-20-analytics-more-design.md §1）。

engagement_visits 最早的一天會被清除往後推：清除先跑之後，earliest 就是清除界線，舊的判斷會把「月初已被清掉」
的月份當成整月都還在，先刪掉那個月的彙總再用只剩後半段的紀錄寫回。原始紀錄已經清掉，沒辦法復原。
部署重啟（程序內的「今天算過了」歸零）、午夜訪客回報比定期工作早到，都會讓清除先跑。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.operations import engagement_service, monthly_service
from app.operations.models import EngagementMonthly
from tests.test_analytics_more import _visit_row

# 正式站的成效統計起算日（config.analytics_stats_start）。
STATS_START = date(2026, 11, 13)


def test_months_to_rollup_ignores_earliest_pushed_by_purge():
    # 2027-03-15 的清除界線是 2026-12-15；清完之後最早一天就是 12-15，12 月的月初已經沒了，不能重算。
    today = date(2027, 3, 15)
    expected = [
        (date(2027, 1, 1), date(2027, 1, 1), date(2027, 1, 31)),
        (date(2027, 2, 1), date(2027, 2, 1), date(2027, 2, 28)),
        (date(2027, 3, 1), date(2027, 3, 1), date(2027, 3, 14)),
    ]
    assert monthly_service.months_to_rollup(today, None, date(2026, 12, 15)) == expected
    assert monthly_service.months_to_rollup(today, STATS_START, date(2026, 12, 15)) == expected
    # 起算日在月中：2027-02-12 的界線是 2026-11-14，起算日 11-13 那天已被清掉，11 月不再動。
    assert monthly_service.months_to_rollup(date(2027, 2, 12), STATS_START, date(2026, 11, 14))[0] == (
        date(2026, 12, 1), date(2026, 12, 1), date(2026, 12, 31),
    )
    # 起算日那天還在（界線剛好是起算日）：11 月照樣從起算日重算。
    assert monthly_service.months_to_rollup(date(2027, 2, 11), STATS_START, STATS_START)[0] == (
        date(2026, 11, 1), STATS_START, date(2026, 11, 30),
    )


async def _totals(db) -> dict[date, tuple[int, date, date]]:
    db.expire_all()
    rows = (await db.execute(
        select(EngagementMonthly).where(EngagementMonthly.kind == "total")
    )).scalars().all()
    return {row.month: (row.sessions, row.first_day, row.last_day) for row in rows}


@pytest.mark.asyncio
async def test_purge_before_rollup_keeps_complete_months(db_session):
    # 起算日到 2027-03-31 每天一筆造訪、各自一個 session：每個月的造訪數就是那個月有紀錄的天數。
    day = STATS_START
    while day <= date(2027, 3, 31):
        db_session.add(_visit_row(day, session=uuid.uuid4(), device="desktop" if day.day % 2 else "mobile"))
        day += timedelta(days=1)
    await db_session.commit()

    complete = {
        date(2026, 11, 1): (18, STATS_START, date(2026, 11, 30)),
        date(2026, 12, 1): (31, date(2026, 12, 1), date(2026, 12, 31)),
        date(2027, 1, 1): (31, date(2027, 1, 1), date(2027, 1, 31)),
        date(2027, 2, 1): (28, date(2027, 2, 1), date(2027, 2, 28)),
        date(2027, 3, 1): (31, date(2027, 3, 1), date(2027, 3, 31)),
    }
    try:
        # 每天都是「清除先跑、再彙總」，而且每天都像剛部署重啟過（程序內的記號歸零）。
        # 2027-02-12 起 11 月的起算日被清、2027-03-02 起 12 月的月初被清；之後兩個月都不能再被改寫。
        for today in (
            date(2026, 12, 1), date(2027, 1, 1), date(2027, 2, 1), date(2027, 2, 11), date(2027, 2, 12),
            date(2027, 3, 1), date(2027, 3, 2), date(2027, 3, 15), date(2027, 3, 31), date(2027, 4, 1),
        ):
            engagement_service._last_purge = None
            await engagement_service.purge_old_visits_once_a_day(db_session, today)
            await db_session.commit()
            monthly_service.reset_rollup_clock()
            await monthly_service.rollup_once_a_day(db_session, STATS_START, today)

            totals = await _totals(db_session)
            for month, numbers in complete.items():
                if today >= monthly_service.next_month(month):
                    assert totals[month] == numbers, (today, month, totals[month])
    finally:
        engagement_service._last_purge = None

    # 2027-04-01 清到 2027-01-01 之前，11、12 月的紀錄已經全沒了，仍是完整時的數字；各分類也沒有被換成後半段。
    devices = {
        row.key: row.sessions for row in (await db_session.execute(
            select(EngagementMonthly).where(EngagementMonthly.month == date(2026, 12, 1), EngagementMonthly.kind == "device")
        )).scalars()
    }
    assert devices == {"desktop": 16, "mobile": 15}
    summary = await monthly_service.get_monthly(db_session, frozenset(), STATS_START)
    months = {item["month"]: item for item in summary["months"]}
    assert (months["2026-11"]["sessions"], months["2026-11"]["first_day"], months["2026-11"]["complete"]) == (
        18, STATS_START, True,
    )
    assert (months["2026-12"]["sessions"], months["2026-12"]["first_day"], months["2026-12"]["complete"]) == (
        31, date(2026, 12, 1), True,
    )
