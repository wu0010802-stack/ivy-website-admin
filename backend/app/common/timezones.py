from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

# 規格 6.3：DB 一律存 UTC，但「今天」「已過期」「最短提前時間」這些
# 營運判斷都要用園方所在時區，否則台北凌晨 0–8 點會整批算成前一天。
OPERATING_TZ = ZoneInfo("Asia/Taipei")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def today_local(now: datetime | None = None) -> date:
    """營運時區的今天。傳入的 now 必須是 aware datetime。"""
    return (now or now_utc()).astimezone(OPERATING_TZ).date()


def local_day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    """回傳營運時區某一天的 [起, 訖) 對應的 UTC 區間，供 DB 查詢使用。"""
    start_local = datetime.combine(day, time.min, tzinfo=OPERATING_TZ)
    end_local = start_local + timedelta(days=1)
    return start_local.astimezone(timezone.utc), end_local.astimezone(timezone.utc)


def slot_start_utc(slot_date: date, start_time: time) -> datetime:
    """把 slot 的「日期＋開始時間」當成營運時區的牆上時間，轉成 UTC。
    slot_date/start_time 在 DB 是 naive 的 Date/Time，本身不帶時區。"""
    return datetime.combine(slot_date, start_time, tzinfo=OPERATING_TZ).astimezone(timezone.utc)
