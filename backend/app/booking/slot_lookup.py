"""新預約表單讀場次的每日彙總（場次使用情況，2026-10-13 規格 §2）。

只存「最早能約的場次離今天幾天」的區間次數：沒有 IP、裝置、cookie、時間點，也沒有任何能辨識
家長的欄位，所以計數單位是「次」（同一位家長重新整理算兩次）。寫入由 GET /public/slots 在
purpose=new_booking 時呼叫，失敗不得影響回應（見 routes.list_public_slots）。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from fastapi import Request

from app.booking.models import LOOKUP_BUCKETS, SlotLookupDaily
from app.common import ratelimit
from app.operations import public_caps

LOOKUP_WINDOW_DAYS = 28

# 匿名寫入的上限（2026-10-20 稽核，比照 telemetry 與點擊的 public_caps）：單一來源每分鐘 60 次的
# 查場次限流擋不住多個來源一起灌。真實家長一天開預約頁的次數遠低於這些數字；超過只是不記，
# 照樣回場次。每來源每日只在代理有帶訪客 IP 時套用（沒有時全站會共用一個桶）。
LOOKUP_GLOBAL_PER_MINUTE = ratelimit.Limit("slot_lookup_global", 60, 120)
LOOKUP_SOURCE_DAILY = ratelimit.Limit("slot_lookup_source_daily", public_caps.DAY_SECONDS, 30, sliding=False)
LOOKUP_GLOBAL_DAILY = ratelimit.Limit("slot_lookup_daily", public_caps.DAY_SECONDS, 3_000, sliding=False)


async def admit(request: Request) -> bool:
    """這次查詢能不能記。上限滿了或限流池拿不到連線都回 False（不記），不丟錯。"""
    caps: list[public_caps.Cap] = [(LOOKUP_GLOBAL_PER_MINUTE, public_caps.GLOBAL_KEY)]
    if ratelimit.trusted_client_ip(request):
        caps.append((LOOKUP_SOURCE_DAILY, ratelimit.client_key(request)))
    caps.append((LOOKUP_GLOBAL_DAILY, public_caps.GLOBAL_KEY))
    return await public_caps.admit(ratelimit.limiter(request), caps)


def bucket_for(days: int | None) -> str:
    """最早能約的場次離今天幾天 → 區間；None＝整段沒有場次。"""
    if days is None:
        return "none"
    if days <= 1:
        return "within_1"
    if days <= 3:
        return "days_2_3"
    if days <= 7:
        return "days_4_7"
    return "over_7"


async def record_lookup(db: AsyncSession, *, campus_key: str, earliest: date | None, today: date) -> None:
    """累加一次。不 commit：呼叫端決定交易邊界。"""
    days = None if earliest is None else (earliest - today).days
    stmt = insert(SlotLookupDaily).values(
        id=uuid.uuid4(), day=today, campus_key=campus_key, bucket=bucket_for(days), lookups=1
    )
    await db.execute(
        stmt.on_conflict_do_update(
            constraint="uq_slot_lookup_daily_bucket", set_={"lookups": SlotLookupDaily.lookups + 1}
        )
    )


async def lookup_summary(db: AsyncSession, campus_key: str, today: date) -> dict:
    """近 LOOKUP_WINDOW_DAYS 個台北日（含今天）的各區間次數；first_recorded_day 是這個校區最早有紀錄的那天（全期）。"""
    date_from = today - timedelta(days=LOOKUP_WINDOW_DAYS - 1)
    rows = await db.execute(
        select(SlotLookupDaily.bucket, func.sum(SlotLookupDaily.lookups))
        .where(SlotLookupDaily.campus_key == campus_key, SlotLookupDaily.day >= date_from, SlotLookupDaily.day <= today)
        .group_by(SlotLookupDaily.bucket)
    )
    counts = {bucket: int(total) for bucket, total in rows.all()}
    first = await db.scalar(select(func.min(SlotLookupDaily.day)).where(SlotLookupDaily.campus_key == campus_key))
    buckets = [{"key": key, "count": counts.get(key, 0)} for key in LOOKUP_BUCKETS]
    return {
        "date_from": date_from,
        "date_to": today,
        "first_recorded_day": first,
        "total": sum(item["count"] for item in buckets),
        "buckets": buckets,
    }
